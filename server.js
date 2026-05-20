const express = require("express");
const { exec } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const SALESHANDY_BASE = "https://open-api.saleshandy.com/v1";

let currentProcess = null;
let isRunning = false;
let progress = { step: "", pct: 0, log: [] };

function addLog(msg) {
  progress.log.push(msg);
  if (progress.log.length > 100) progress.log.shift();
  console.log(msg);
}

// ── STATS ─────────────────────────────────────────────────────────────────────
app.get("/stats", async (req, res) => {
  const [c, ct] = await Promise.all([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("contacts").select("*", { count: "exact", head: true })
  ]);
  res.json({ companies: c.count || 0, contacts: ct.count || 0 });
});

// ── START PIPELINE ────────────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  if (isRunning) return res.status(400).json({ error: "Already running. Stop first." });

  isRunning = true;
  progress = { step: "Starting", pct: 5, log: [] };
  addLog("Starting pipeline for " + country + "...");
  res.json({ message: "Pipeline started", country });

  // Step 1 — Agent 1
  addLog("Agent 1: Generating search queries for " + country + "...");
  progress.step = "Agent 1";
  progress.pct = 10;

  const agent1 = exec("node agent1-query-builder.js \"" + country + "\"");

  agent1.stdout.on("data", data => {
    addLog(data.trim());
    progress.pct = Math.min(35, progress.pct + 1);
  });
  agent1.stderr.on("data", data => addLog("Warning: " + data.trim()));

  agent1.on("close", code1 => {
    if (code1 !== 0) {
      addLog("Agent 1 failed!");
      isRunning = false;
      progress.step = "Error";
      return;
    }

    addLog("Agent 1 complete! Starting Agent 2...");
    progress.step = "Agent 2";
    progress.pct = 40;

    // Step 2 — Agent 2
    const agent2 = exec("node agent2-discovery.js");
    currentProcess = agent2;

    agent2.stdout.on("data", data => {
      addLog(data.trim());
      progress.pct = Math.min(70, progress.pct + 1);
    });
    agent2.stderr.on("data", data => addLog("Warning: " + data.trim()));

    agent2.on("close", code2 => {
      if (code2 !== 0) {
        addLog("Agent 2 failed!");
        isRunning = false;
        progress.step = "Error";
        currentProcess = null;
        return;
      }

      addLog("Agent 2 complete! Starting Agent 3 enrichment...");
      progress.step = "Agent 3";
      progress.pct = 75;

      // Step 3 — Agent 3
      const agent3 = exec("node agent3-enrichment.js");
      currentProcess = agent3;

      agent3.stdout.on("data", data => {
        addLog(data.trim());
        progress.pct = Math.min(95, progress.pct + 1);
      });
      agent3.stderr.on("data", data => addLog("Warning: " + data.trim()));

      agent3.on("close", code3 => {
        isRunning = false;
        currentProcess = null;
        progress.pct = 100;
        progress.step = "Done";
        addLog("Pipeline complete for " + country + "!");
        addLog("Companies + people saved. Reveal emails from CRM when needed.");
      });
    });
  });
});

// ── STOP ──────────────────────────────────────────────────────────────────────
app.post("/stop", (req, res) => {
  if (currentProcess) { currentProcess.kill(); currentProcess = null; }
  isRunning = false;
  progress.step = "Stopped";
  addLog("Stopped by user.");
  res.json({ message: "Stopped" });
});

// ── STATUS ────────────────────────────────────────────────────────────────────
app.get("/status", (req, res) => res.json({ isRunning, progress }));

// ── COMPANIES ─────────────────────────────────────────────────────────────────
app.get("/companies", async (req, res) => {
  const { country, status } = req.query;
  let query = supabase.from("companies").select("*").order("created_at", { ascending: false });
  if (country) query = query.eq("country", country);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.patch("/companies/:id", async (req, res) => {
  const { error } = await supabase.from("companies").update({ status: req.body.status }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

// ── CONTACTS ──────────────────────────────────────────────────────────────────
app.get("/contacts", async (req, res) => {
  const { company_id, country } = req.query;
  let query = supabase.from("contacts").select("*").order("created_at", { ascending: false });
  if (company_id) query = query.eq("company_id", company_id);
  if (country) query = query.eq("country", country);
  const { data, error } = await query.limit(1000);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── REVEAL EMAIL — uses 1 credit ──────────────────────────────────────────────
app.post("/contacts/:id/reveal-email", async (req, res) => {
  if (!SALESHANDY_API_KEY) return res.status(500).json({ error: "SALESHANDY_API_KEY not set" });

  // Get contact from Supabase
  const { data: contact, error: fetchError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (fetchError || !contact) return res.status(404).json({ error: "Contact not found" });
  if (contact.email_revealed) return res.json({ email: contact.email_1, already_revealed: true });
  if (!contact.saleshandy_person_id) return res.status(400).json({ error: "No Saleshandy person ID for this contact" });

  try {
    // Call Saleshandy reveal API — uses 1 credit
    const revealRes = await fetch(SALESHANDY_BASE + "/enrichment/reveal", {
      method: "POST",
      headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ personId: contact.saleshandy_person_id, revealEmail: true })
    });

    const revealData = await revealRes.json();
    const email = revealData.payload?.email || null;

    if (email) {
      // Save email to Supabase
      await supabase.from("contacts").update({
        email_1: email,
        email_revealed: true,
        email_revealed_at: new Date().toISOString()
      }).eq("id", req.params.id);

      res.json({ email, success: true });
    } else {
      res.json({ email: null, success: false, message: "Email not found in database" });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROOT ──────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "Kishor Lead Engine API running!",
    version: "3.0",
    endpoints: {
      "POST /search": "Start pipeline { country: 'Germany' }",
      "GET /status": "Check progress",
      "POST /stop": "Stop pipeline",
      "GET /companies": "All companies",
      "GET /contacts": "All contacts",
      "POST /contacts/:id/reveal-email": "Reveal email (uses 1 credit)",
      "GET /stats": "Counts"
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Kishor Lead Engine v3.0 running on port " + PORT));

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
  if (!msg || !msg.trim()) return;
  progress.log.push(msg.trim());
  if (progress.log.length > 100) progress.log.shift();
  console.log(msg.trim());
}

// ── STATS
app.get("/stats", async (req, res) => {
  const [c, ct] = await Promise.all([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("contacts").select("*", { count: "exact", head: true })
  ]);
  res.json({ companies: c.count || 0, contacts: ct.count || 0 });
});

// ── START PIPELINE — Saleshandy Direct Search
app.post("/search", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  if (isRunning) return res.status(400).json({ error: "Already running. Stop first." });

  isRunning = true;
  progress = { step: "Starting", pct: 5, log: [] };
  addLog("Starting search for " + country + "...");
  res.json({ message: "Pipeline started", country });

  // Skip Agent 1+2 — go straight to Saleshandy
  addLog("Agent 3: Searching Saleshandy for companies and buyers in " + country + "...");
  progress.step = "Agent 3";
  progress.pct = 20;

  const agent3 = exec("node agent3-enrichment.js \"" + country + "\"");
  currentProcess = agent3;

  agent3.stdout.on("data", data => {
    addLog(data.trim());
    progress.pct = Math.min(95, progress.pct + 2);
  });
  agent3.stderr.on("data", data => addLog("Warning: " + data.trim()));

  agent3.on("close", code => {
    isRunning = false;
    currentProcess = null;
    progress.pct = 100;
    progress.step = "Done";
    if (code !== 0) {
      addLog("Search failed with code " + code);
      progress.step = "Error";
    } else {
      addLog("Search complete for " + country + "!");
      addLog("Check Companies and Contacts tabs!");
    }
  });
});

// ── STOP
app.post("/stop", (req, res) => {
  if (currentProcess) { currentProcess.kill(); currentProcess = null; }
  isRunning = false;
  progress.step = "Stopped";
  addLog("Stopped by user.");
  res.json({ message: "Stopped" });
});

// ── STATUS
app.get("/status", (req, res) => res.json({ isRunning, progress }));

// ── COMPANIES
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

// ── CONTACTS
app.get("/contacts", async (req, res) => {
  const { company_id, country } = req.query;
  let query = supabase.from("contacts").select("*").order("created_at", { ascending: false });
  if (company_id) query = query.eq("company_id", company_id);
  if (country) query = query.eq("country", country);
  const { data, error } = await query.limit(1000);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── REVEAL EMAIL
app.post("/contacts/:id/reveal-email", async (req, res) => {
  if (!SALESHANDY_API_KEY) return res.status(500).json({ error: "SALESHANDY_API_KEY not set" });

  const { data: contact, error: fetchError } = await supabase.from("contacts").select("*").eq("id", req.params.id).single();
  if (fetchError || !contact) return res.status(404).json({ error: "Contact not found" });
  if (contact.email_revealed && contact.email_1) return res.json({ email: contact.email_1, already_revealed: true });

  try {
    let requestBody = {};
    if (contact.linkedin_url) requestBody = { linkedin_url: [contact.linkedin_url] };
    else if (contact.saleshandy_lead_id) requestBody = { lead_id: [parseInt(contact.saleshandy_lead_id)] };
    else if (contact.first_name && contact.company_website) requestBody = { full_name_with_company: [{ first_name: contact.first_name, last_name: contact.last_name || "", company_domain: contact.company_website }] };
    else return res.status(400).json({ error: "Not enough data to reveal email" });

    const enrichRes = await fetch(SALESHANDY_BASE + "/enrich/contact", {
      method: "POST",
      headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    const enrichData = await enrichRes.json();
    const requestId = enrichData.payload?.requestId;
    if (!requestId) return res.status(500).json({ error: "No requestId", detail: enrichData });

    let email = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(SALESHANDY_BASE + "/enrich/status/" + requestId, { headers: { "x-api-key": SALESHANDY_API_KEY } });
      const statusData = await statusRes.json();
      if (statusData.payload?.status === "completed" || statusData.payload?.status === "failed") {
        const resultRes = await fetch(SALESHANDY_BASE + "/enrich/status/result/" + requestId, { headers: { "x-api-key": SALESHANDY_API_KEY } });
        const resultData = await resultRes.json();
        const results = resultData.payload?.results || [];
        if (results.length > 0) email = results[0].email || results[0].work_email || null;
        break;
      }
    }

    if (email) {
      await supabase.from("contacts").update({ email_1: email, email_revealed: true, email_revealed_at: new Date().toISOString() }).eq("id", req.params.id);
      res.json({ email, success: true });
    } else {
      res.json({ email: null, success: false, message: "Email not found" });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CREDITS
app.get("/credits", async (req, res) => {
  if (!SALESHANDY_API_KEY) return res.status(500).json({ error: "No API key" });
  try {
    const r = await fetch(SALESHANDY_BASE + "/credits", { headers: { "x-api-key": SALESHANDY_API_KEY } });
    const data = await r.json();
    res.json(data.payload);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TEST SALESHANDY
app.get("/test-saleshandy", async (req, res) => {
  if (!SALESHANDY_API_KEY) return res.json({ error: "SALESHANDY_API_KEY not set" });
  const results = {};

  try {
    const r = await fetch(SALESHANDY_BASE + "/credits", { headers: { "x-api-key": SALESHANDY_API_KEY } });
    results.credits = await r.json();
  } catch(e) { results.credits = { error: e.message }; }

  try {
    const r = await fetch(SALESHANDY_BASE + "/search/companies", {
      method: "POST",
      headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ company_hq_location: { includes: ["Denmark"] }, company_industry: { includes: ["Apparel and Fashion"] }, page: 1 })
    });
    const data = await r.json();
    const comps = data.payload?.companies || data.payload?.results || [];
    results.company_search = {
      total: data.payload?.total || 0,
      sample: comps.slice(0, 3),
      company_fields: comps[0] ? Object.keys(comps[0]) : [],
      raw_payload_keys: Object.keys(data.payload || {})
    };
  } catch(e) { results.company_search = { error: e.message }; }

  try {
    const r = await fetch(SALESHANDY_BASE + "/search/people", {
      method: "POST",
      headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        job_title: { includes: ["Buying Manager", "Sourcing Director", "Head of Buying"] },
        company_hq_location: { includes: ["Denmark"] },
        company_industry: { includes: ["Apparel and Fashion"] },
        page: 1
      })
    });
    const data = await r.json();
    const leads = data.payload?.leads || data.payload?.results || [];
    results.people_search = {
      total: data.payload?.total || 0,
      sample: leads.slice(0, 3),
      person_fields: leads[0] ? Object.keys(leads[0]) : [],
      raw_payload_keys: Object.keys(data.payload || {})
    };
  } catch(e) { results.people_search = { error: e.message }; }

  res.json(results);
});

// ── ROOT
app.get("/", (req, res) => {
  res.json({
    status: "Kishor Lead Engine API running!",
    version: "4.0",
    description: "Now using Saleshandy direct search — real companies + real buyers!",
    endpoints: {
      "POST /search": "Search { country: 'Denmark' } — finds real companies + buyers",
      "GET /status": "Check progress",
      "POST /stop": "Stop search",
      "GET /companies": "All companies",
      "GET /contacts": "All contacts with buyer details",
      "POST /contacts/:id/reveal-email": "Reveal email (uses 1 credit)",
      "GET /credits": "Check Saleshandy credits",
      "GET /test-saleshandy": "Test Saleshandy API",
      "GET /stats": "Counts"
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Kishor Lead Engine v4.0 running on port " + PORT));

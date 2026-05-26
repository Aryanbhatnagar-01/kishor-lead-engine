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
const HUNTER_KEY = process.env.HUNTER_API_KEY;
const HUNTER_BASE = "https://api.hunter.io/v2";

let currentProcess = null;
let isRunning = false;
let progress = { step: "", pct: 0, log: [] };

function addLog(msg) {
  if (!msg || !msg.trim()) return;
  progress.log.push(msg.trim());
  if (progress.log.length > 100) progress.log.shift();
  console.log(msg.trim());
}

// ── STATS ─────────────────────────────────────────────────────────────────────
app.get("/stats", async (req, res) => {
  const [c, ct] = await Promise.all([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("contacts").select("*", { count: "exact", head: true })
  ]);
  res.json({ companies: c.count || 0, contacts: ct.count || 0 });
});

// ── START SEARCH ──────────────────────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  if (isRunning) return res.status(400).json({ error: "Already running. Stop first." });

  isRunning = true;
  progress = { step: "Starting", pct: 5, log: [] };
  addLog("Starting search for " + country + "...");
  res.json({ message: "Search started", country });

  progress.step = "Agent 3";
  progress.pct = 10;
  addLog("Searching companies and buyers in " + country + "...");

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
    if (code !== 0) {
      addLog("Search failed with code " + code);
      progress.step = "Error";
    } else {
      progress.pct = 100;
      progress.step = "Done";
      addLog("Search complete for " + country + "!");
      addLog("Companies and buyers saved. Reveal emails from CRM.");
    }
  });
});

// ── HUNTER SCRAPER ────────────────────────────────────────────────────────────
app.post("/scrape-hunter", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  if (isRunning) return res.status(400).json({ error: "Already running. Stop first." });

  isRunning = true;
  progress = { step: "Scraping", pct: 5, log: [] };
  addLog(`Starting Hunter UI scraper for ${country}...`);
  addLog("No credits used — UI automation!");
  res.json({ message: "Scraper started", country });

  const scraper = exec(`node hunter-scraper.js "${country}"`);
  currentProcess = scraper;

  scraper.stdout.on("data", data => {
    addLog(data.trim());
    progress.pct = Math.min(95, progress.pct + 3);
  });
  scraper.stderr.on("data", data => addLog("Warning: " + data.trim()));
  scraper.on("close", code => {
    isRunning = false;
    currentProcess = null;
    progress.pct = 100;
    progress.step = code !== 0 ? "Error" : "Done";
    addLog(code !== 0 ? "Scraper failed" : "Scraper complete! Check CRM for results.");
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
  const { country, status, category } = req.query;
  let query = supabase.from("companies").select("*").order("created_at", { ascending: false });
  if (country) query = query.eq("country", country);
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  const { data, error } = await query.limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.patch("/companies/:id", async (req, res) => {
  const { error } = await supabase.from("companies")
    .update({ status: req.body.status })
    .eq("id", req.params.id);
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

// ── REVEAL EMAIL — Hunter email finder ────────────────────────────────────────
app.post("/contacts/:id/reveal-email", async (req, res) => {
  if (!HUNTER_KEY) return res.status(500).json({ error: "HUNTER_API_KEY not set" });

  const { data: contact, error: fetchError } = await supabase
    .from("contacts").select("*").eq("id", req.params.id).single();

  if (fetchError || !contact) return res.status(404).json({ error: "Contact not found" });
  if (contact.email_revealed && contact.email_1) {
    return res.json({ email: contact.email_1, already_revealed: true });
  }

  try {
    if (!contact.company_website) {
      return res.status(400).json({ error: "No company domain to search" });
    }

    const params = new URLSearchParams({
      api_key:    HUNTER_KEY,
      domain:     contact.company_website,
      first_name: contact.first_name || "",
      last_name:  contact.last_name  || "",
    });

    const r    = await fetch(`${HUNTER_BASE}/email-finder?${params}`);
    const data = await r.json();
    const email = data.data?.email || null;

    if (email) {
      await supabase.from("contacts").update({
        email_1:            email,
        email_revealed:     true,
        email_revealed_at:  new Date().toISOString()
      }).eq("id", req.params.id);
      res.json({ email, success: true, confidence: data.data?.score });
    } else {
      res.json({ email: null, success: false, message: "Email not found" });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CREDITS ───────────────────────────────────────────────────────────────────
app.get("/credits", async (req, res) => {
  if (!HUNTER_KEY) return res.status(500).json({ error: "No HUNTER_API_KEY" });
  try {
    const r    = await fetch(`${HUNTER_BASE}/account?api_key=${HUNTER_KEY}`);
    const data = await r.json();
    res.json({
      searches_left:       data.data?.requests?.searches?.available,
      verifications_left:  data.data?.requests?.verifications?.available,
      plan:                data.data?.plan_name
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TEST HUNTER ───────────────────────────────────────────────────────────────
app.get("/test-hunter", async (req, res) => {
  if (!HUNTER_KEY) return res.json({ error: "HUNTER_API_KEY not set" });
  const results = {};

  try {
    const r    = await fetch(`${HUNTER_BASE}/account?api_key=${HUNTER_KEY}`);
    const data = await r.json();
    results.account = {
      plan:                data.data?.plan_name,
      searches_left:       data.data?.requests?.searches?.available,
      verifications_left:  data.data?.requests?.verifications?.available
    };
  } catch(e) { results.account = { error: e.message }; }

  try {
    const params = new URLSearchParams({ api_key: HUNTER_KEY, domain: "bestseller.com", limit: 5 });
    const r    = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
    const data = await r.json();
    results.domain_search = {
      company:      data.data?.organization,
      total_emails: data.meta?.results || 0,
      sample:       (data.data?.emails || []).slice(0, 3).map(e => ({
        name:  `${e.first_name} ${e.last_name}`,
        title: e.position,
        email: e.value
      }))
    };
  } catch(e) { results.domain_search = { error: e.message }; }

  res.json(results);
});

// ── TEST 5 COMPANIES ──────────────────────────────────────────────────────────
app.get("/test-companies", async (req, res) => {
  if (!HUNTER_KEY) return res.json({ error: "HUNTER_API_KEY not set" });

  const TEST_COMPANIES = [
    { name: "BESTSELLER",    domain: "bestseller.com" },
    { name: "Ganni",         domain: "ganni.com" },
    { name: "Samsoe Samsoe", domain: "samsoe.com" },
    { name: "Les Deux",      domain: "lesdeux.com" },
    { name: "Gestuz",        domain: "gestuz.com" },
  ];

  const TARGET_TITLES = ["buyer","buying","sourcing","procurement","purchasing","merchandise","import","supply","director","head"];
  const results = [];

  for (const company of TEST_COMPANIES) {
    try {
      const params = new URLSearchParams({ api_key: HUNTER_KEY, domain: company.domain, limit: 10, type: "personal" });
      const r    = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
      const data = await r.json();
      const allEmails = data.data?.emails || [];
      const buyers = allEmails.filter(e => {
        const title = (e.position || "").toLowerCase();
        return TARGET_TITLES.some(t => title.includes(t));
      });
      results.push({
        company:      company.name,
        domain:       company.domain,
        total_people: data.meta?.results || 0,
        buyers_found: buyers.length,
        buyers:       buyers.map(e => ({
          name:       `${e.first_name || ""} ${e.last_name || ""}`.trim(),
          title:      e.position    || "—",
          email:      e.value       || "—",
          linkedin:   e.linkedin    || null,
          confidence: e.confidence  || null
        }))
      });
      await new Promise(r => setTimeout(r, 800));
    } catch(e) {
      results.push({ company: company.name, error: e.message });
    }
  }
  res.json({ test: "5 Danish Fashion Companies", results });
});

// ── SMTP HELPERS ──────────────────────────────────────────────────────────────
function cleanName(raw) {
  return (raw || '').replace(/^View\s+/i, '').replace(/'s\s+profile$/i, '').trim();
}

function generateCandidates(fullName, domain) {
  const name = cleanName(fullName);
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0], last = parts[parts.length - 1];
  const f = first[0], l = last[0];
  const allInitials = parts.map(p => p[0]).join('');
  const raw = [
    `${first}.${last}`,   // 1. firstname.lastname  (548 in DK data)
    `${first}`,           // 2. firstname            (1116)
    `${f}${l}`,           // 3. fl initials          (647)
    allInitials,          // 4. all initials         (284)
    `${first}${l}`,       // 5. firstnamel           (30)
    `${first}.${l}`,      // 6. firstname.l          (24)
    `${last}`,            // 7. lastname             (14)
    `${f}.${last}`,       // 8. f.lastname           (12)
    `${first}${last}`,    // 9. firstnamelastname    (12)
  ];
  const seen = new Set();
  return raw
    .filter(c => c && c.length > 0)
    .map(c => `${c}@${domain}`)
    .filter(email => {
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    });
}

async function smtpCheck(email) {
  const net = require('net');
  const dns = require('dns').promises;
  return new Promise(async (resolve) => {
    try {
      const emailDomain = email.split('@')[1];
      const mxRecords = await dns.resolveMx(emailDomain).catch(() => null);
      if (!mxRecords || !mxRecords.length) return resolve(false);
      const mx = mxRecords.sort((a, b) => a.priority - b.priority)[0].exchange;
      const socket = net.createConnection(25, mx);
      let buffer = '', step = 0, resolved = false;
      const done = (result) => {
        if (!resolved) { resolved = true; socket.destroy(); resolve(result); }
      };
      socket.setTimeout(8000);
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (step === 0 && buffer.includes('220')) {
          socket.write('EHLO kishorexports.com\r\n'); step = 1; buffer = '';
        } else if (step === 1 && buffer.includes('250')) {
          socket.write('MAIL FROM:<verify@kishorexports.com>\r\n'); step = 2; buffer = '';
        } else if (step === 2 && buffer.includes('250')) {
          socket.write(`RCPT TO:<${email}>\r\n`); step = 3; buffer = '';
        } else if (step === 3) {
          const valid = buffer.includes('250') || buffer.includes('251');
          socket.write('QUIT\r\n');
          done(valid);
        }
      });
    } catch(e) { resolve(false); }
  });
}

// ── SMTP EMAIL VERIFIER ───────────────────────────────────────────────────────

// GET /verify-email?email=john@ganni.com  ← used by new CRM
app.get("/verify-email", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "email query param required" });
  try {
    const valid = await smtpCheck(email);
    res.json({ valid, email, message: valid ? 'Deliverable' : 'Not deliverable' });
  } catch(e) {
    res.json({ valid: false, email, message: 'Error: ' + e.message });
  }
});

// POST /verify-email { full_name, domain }  ← used by old CRM / guessOne button
app.post("/verify-email", async (req, res) => {
  const { full_name, domain } = req.body;
  if (!full_name || !domain) return res.status(400).json({ error: "full_name and domain required" });
  const candidates = generateCandidates(full_name, domain);
  if (!candidates.length) return res.json({ success: false, email: null, method: 'no_name' });
  try {
    for (const email of candidates) {
      const valid = await smtpCheck(email);
      if (valid) return res.json({ success: true, email, method: 'smtp_verified' });
    }
    res.json({ success: false, email: candidates[0], method: 'best_guess' });
  } catch(e) {
    res.json({ success: false, email: candidates[0], method: 'error', error: e.message });
  }
});

// ── ROOT ──────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "Kishor Lead Engine v7.2 — 9-Format SMTP Verifier",
    endpoints: {
      "POST /search":                    "Search by country (uses Hunter API)",
      "POST /scrape-hunter":             "Scrape Hunter UI — NO credits used!",
      "GET /status":                     "Check progress",
      "POST /stop":                      "Stop current job",
      "GET /companies":                  "All companies",
      "GET /contacts":                   "All contacts",
      "POST /contacts/:id/reveal-email": "Reveal email (1 Hunter credit)",
      "GET /verify-email?email=xxx":     "SMTP verify single email (free!)",
      "POST /verify-email":              "SMTP verify by name+domain (free!)",
      "GET /credits":                    "Check Hunter credits",
      "GET /test-hunter":                "Test Hunter API",
      "GET /test-companies":             "Test 5 Danish companies",
      "GET /stats":                      "DB counts"
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Kishor Lead Engine v7.2 running on port " + PORT));

// ── SAVE COMPANY (from Chrome Extension) ─────────────────────────────────────
app.post("/save-company", async (req, res) => {
  const { name, domain, industry, size, country, source } = req.body;
  if (!name && !domain) return res.status(400).json({ error: "No data" });
  try {
    const { error } = await supabase.from("companies").upsert({
      company_name: name || domain,
      website:      domain || null,
      full_url:     domain ? "https://" + domain : null,
      category:     industry || "Fashion",
      industry:     industry || null,
      country:      country  || "unknown",
      company_size: size     || null,
      status:       "discovered",
      enriched:     true,
      source:       source || "extension",
      created_at:   new Date().toISOString()
    }, { onConflict: domain ? "website" : "company_name", ignoreDuplicates: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SAVE CONTACT (from Chrome Extension) ─────────────────────────────────────
app.post("/save-contact", async (req, res) => {
  const { name, title, email, linkedin, company, domain, country, source } = req.body;
  if (!name && !email) return res.status(400).json({ error: "No data" });
  try {
    const nameParts = (name || "").split(" ");
    const row = {
      company_name:    company  || null,
      company_website: domain   || null,
      contact_name:    name     || email?.split("@")[0] || "",
      first_name:      nameParts[0] || null,
      last_name:       nameParts.slice(1).join(" ") || null,
      job_title:       title    || null,
      email_1:         email    || null,
      email_revealed:  !!email,
      linkedin_url:    linkedin || null,
      country:         country  || "unknown",
      source:          source   || "extension",
      status:          "new",
      created_at:      new Date().toISOString()
    };
    const conflict = email ? "email_1" : linkedin ? "linkedin_url" : null;
    if (conflict) {
      await supabase.from("contacts").upsert(row, { onConflict: conflict, ignoreDuplicates: true });
    } else {
      await supabase.from("contacts").insert(row);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

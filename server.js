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

// ── REVEAL EMAIL — Hunter domain search (1 credit) ────────────────────────────
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
      api_key: HUNTER_KEY,
      domain: contact.company_website,
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
    });

    const r = await fetch(`${HUNTER_BASE}/email-finder?${params}`);
    const data = await r.json();
    const email = data.data?.email || null;

    if (email) {
      await supabase.from("contacts").update({
        email_1: email,
        email_revealed: true,
        email_revealed_at: new Date().toISOString()
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
    const r = await fetch(`${HUNTER_BASE}/account?api_key=${HUNTER_KEY}`);
    const data = await r.json();
    res.json({
      searches_left: data.data?.requests?.searches?.available,
      verifications_left: data.data?.requests?.verifications?.available,
      plan: data.data?.plan_name
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TEST HUNTER ───────────────────────────────────────────────────────────────
app.get("/test-hunter", async (req, res) => {
  if (!HUNTER_KEY) return res.json({ error: "HUNTER_API_KEY not set" });
  const results = {};

  // Account info
  try {
    const r = await fetch(`${HUNTER_BASE}/account?api_key=${HUNTER_KEY}`);
    const data = await r.json();
    results.account = {
      plan: data.data?.plan_name,
      searches_left: data.data?.requests?.searches?.available,
      verifications_left: data.data?.requests?.verifications?.available
    };
  } catch(e) { results.account = { error: e.message }; }

  // Test Discover API
  try {
    const url = `${HUNTER_BASE}/discover/companies?api_key=${HUNTER_KEY}&location_country_included[]=DK&q=fashion&limit=5`;
    const r = await fetch(url);
    const text = await r.text();
    if (text.startsWith("<")) {
      results.discover = { error: "Returns HTML — Discover needs paid plan" };
    } else {
      const data = JSON.parse(text);
      results.discover = {
        total: data.meta?.total || 0,
        companies: (data.data?.companies || []).slice(0, 3).map(c => ({
          name: c.name, domain: c.domain, industry: c.industry
        })),
        errors: data.errors || null
      };
    }
  } catch(e) { results.discover = { error: e.message }; }

  // Test Domain Search (BESTSELLER)
  try {
    const params = new URLSearchParams({ api_key: HUNTER_KEY, domain: "bestseller.com", limit: 5 });
    const r = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
    const data = await r.json();
    results.domain_search = {
      company: data.data?.organization,
      total_emails: data.meta?.results || 0,
      sample: (data.data?.emails || []).slice(0, 3).map(e => ({
        name: `${e.first_name} ${e.last_name}`,
        title: e.position,
        email: e.value
      }))
    };
  } catch(e) { results.domain_search = { error: e.message }; }

  res.json(results);
});

// ── TEST COMPANIES (5 Danish brands) ─────────────────────────────────────────
app.get("/test-companies", async (req, res) => {
  if (!HUNTER_KEY) return res.json({ error: "HUNTER_API_KEY not set" });

  const TEST_COMPANIES = [
    { name: "BESTSELLER",    domain: "bestseller.com" },
    { name: "Ganni",         domain: "ganni.com" },
    { name: "Samsoe Samsoe", domain: "samsoe.com" },
    { name: "Les Deux",      domain: "lesdeux.com" },
    { name: "Gestuz",        domain: "gestuz.com" },
  ];

  const TARGET_TITLES = [
    "buyer", "buying", "sourcing", "procurement",
    "purchasing", "merchandise", "import", "supply", "director", "head"
  ];

  const results = [];
  for (const company of TEST_COMPANIES) {
    try {
      const params = new URLSearchParams({ api_key: HUNTER_KEY, domain: company.domain, limit: 10, type: "personal" });
      const r = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
      const data = await r.json();
      const allEmails = data.data?.emails || [];
      const buyers = allEmails.filter(e => {
        const title = (e.position || "").toLowerCase();
        return TARGET_TITLES.some(t => title.includes(t));
      });
      results.push({
        company: company.name,
        domain: company.domain,
        total_people: data.meta?.results || 0,
        buyers_found: buyers.length,
        buyers: buyers.map(e => ({
          name: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
          title: e.position || "—",
          email: e.value || "—",
          linkedin: e.linkedin || null,
          confidence: e.confidence || null
        }))
      });
      await new Promise(r => setTimeout(r, 800));
    } catch(e) {
      results.push({ company: company.name, error: e.message });
    }
  }
  res.json({ test: "5 Danish Fashion Companies", results });
});

// ── TEST HUNTER SEARCH (Discover API test) ────────────────────────────────────
app.get("/test-hunter-search", async (req, res) => {
  if (!HUNTER_KEY) return res.json({ error: "HUNTER_API_KEY not set" });
  const country = req.query.country || "DK";
  const results = {};

  // Try Discover API with correct parameter format
  const formats = [
    `${HUNTER_BASE}/discover/companies?api_key=${HUNTER_KEY}&location_country_included[]=${country}&q=fashion&limit=5`,
    `${HUNTER_BASE}/discover/companies?api_key=${HUNTER_KEY}&location_country_included%5B%5D=${country}&q=fashion&limit=5`,
  ];

  for (let i = 0; i < formats.length; i++) {
    try {
      const r = await fetch(formats[i]);
      const text = await r.text();
      if (text.startsWith("<")) {
        results[`format_${i+1}`] = { error: "HTML response — needs paid plan" };
      } else {
        const data = JSON.parse(text);
        results[`format_${i+1}`] = {
          total: data.meta?.total || 0,
          companies: (data.data?.companies || []).slice(0, 3),
          errors: data.errors || null
        };
      }
    } catch(e) {
      results[`format_${i+1}`] = { error: e.message };
    }
  }

  res.json(results);
});

// ── ROOT ──────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "Kishor Lead Engine v6.0 — Hunter Powered!",
    endpoints: {
      "POST /search": "Search by country",
      "GET /status": "Check progress",
      "GET /companies": "All companies",
      "GET /contacts": "All contacts",
      "POST /contacts/:id/reveal-email": "Reveal email (1 Hunter credit)",
      "GET /credits": "Check Hunter credits",
      "GET /test-hunter": "Test Hunter API",
      "GET /test-companies": "Test 5 Danish companies",
      "GET /test-hunter-search?country=DK": "Test Discover API",
      "GET /stats": "DB counts"
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Kishor Lead Engine v6.0 running on port " + PORT));

// ── TEST 50 COMPANIES — NO CREDITS ────────────────────────────────────────────
app.get("/test-50-companies", async (req, res) => {
  const HUNTER_KEY = process.env.HUNTER_API_KEY;
  if (!HUNTER_KEY) return res.json({ error: "HUNTER_API_KEY not set" });

  const COMPANIES = [
    // Denmark
    { name: "BESTSELLER",        domain: "bestseller.com" },
    { name: "Ganni",             domain: "ganni.com" },
    { name: "Samsoe Samsoe",     domain: "samsoe.com" },
    { name: "Les Deux",          domain: "lesdeux.com" },
    { name: "Gestuz",            domain: "gestuz.com" },
    { name: "Selected",          domain: "selected.com" },
    { name: "Jack Jones",        domain: "jackjones.com" },
    { name: "Vero Moda",         domain: "veromoda.com" },
    { name: "Only",              domain: "only.com" },
    { name: "Name It",           domain: "nameit.com" },
    { name: "Bruuns Bazaar",     domain: "bruunsbazaar.com" },
    { name: "Stine Goya",        domain: "stinegoya.com" },
    { name: "By Malene Birger",  domain: "bymalenebirger.com" },
    { name: "Rotate Birger",     domain: "rotatebirger.com" },
    { name: "Norse Projects",    domain: "norseprojects.com" },
    { name: "Wood Wood",         domain: "woodwood.com" },
    { name: "Soulland",          domain: "soulland.com" },
    { name: "Inwear",            domain: "inwear.com" },
    { name: "Part Two",          domain: "parttwo.com" },
    { name: "Fransa",            domain: "fransa.com" },
    { name: "Kaffe Fashion",     domain: "kaffefashion.com" },
    { name: "Cream Fashion",     domain: "creamfashion.com" },
    { name: "Ichi",              domain: "ichicph.com" },
    { name: "Noa Noa",           domain: "noa-noa.com" },
    { name: "Saint Tropez",      domain: "sainttropez.com" },
    { name: "Soaked in Luxury",  domain: "soakedinluxury.com" },
    { name: "Zizzi",             domain: "zizzi.dk" },
    { name: "Han Kjobenhavn",    domain: "hankjobenhavn.com" },
    { name: "Holzweiler",        domain: "holzweiler.com" },
    { name: "Tiger of Sweden",   domain: "tigerofsweden.com" },
    { name: "Filippa K",         domain: "filippa-k.com" },
    { name: "Mads Norgaard",     domain: "madsnorgaard.com" },
    { name: "Day Birger",        domain: "day.dk" },
    { name: "Remain Birger",     domain: "remaincph.com" },
    { name: "Mamalicious",       domain: "mamalicious.com" },
    { name: "Vila Clothes",      domain: "vila.com" },
    { name: "Noisy May",         domain: "noisymay.com" },
    { name: "Pieces",            domain: "pieces.com" },
    { name: "Object",            domain: "object.dk" },
    { name: "b.young",           domain: "byoung.dk" },
    // Germany
    { name: "Hugo Boss",         domain: "hugoboss.com" },
    { name: "Zalando",           domain: "zalando.com" },
    { name: "s.Oliver",          domain: "soliver.com" },
    { name: "Tom Tailor",        domain: "tom-tailor.com" },
    { name: "Marc O Polo",       domain: "marc-o-polo.com" },
    { name: "Armedangels",       domain: "armedangels.com" },
    { name: "About You",         domain: "aboutyou.com" },
    { name: "Gerry Weber",       domain: "gerryweber.com" },
    { name: "Brax",              domain: "brax.com" },
    { name: "Street One",        domain: "street-one.de" },
  ];

  const results = [];
  let totalPeople = 0;

  for (const company of COMPANIES) {
    try {
      // Domain search — gets all people, NO email verification = NO credits used
      const params = new URLSearchParams({
        api_key: HUNTER_KEY,
        domain:  company.domain,
        limit:   10,
      });

      const r    = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
      const data = await r.json();
      const people = data.data?.emails || [];

      const contacts = people.map(p => ({
        name:       `${p.first_name || ""} ${p.last_name || ""}`.trim(),
        title:      p.position   || "—",
        email:      p.value      || "—",
        linkedin:   p.linkedin   || null,
        confidence: p.confidence || null
      }));

      totalPeople += contacts.length;

      results.push({
        company:      company.name,
        domain:       company.domain,
        total_people: data.meta?.results || 0,
        contacts
      });

      await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      results.push({ company: company.name, domain: company.domain, error: e.message });
    }
  }

  res.json({
    message:          "Hunter Domain Search — 50 companies — NO credits used",
    companies_tested: COMPANIES.length,
    total_people:     totalPeople,
    results
  });
});

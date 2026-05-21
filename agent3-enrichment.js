// agent3-enrichment.js — v3.0 FIXED
// Changes from v2:
//   - REMOVED Gemini dependency (was causing 429 rate limit crashes)
//   - HARDCODED correct Saleshandy industry names
//   - Same endpoints, same save logic — just no AI in the middle

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

// ─── HARDCODED CORRECT FILTERS ───────────────────────────────────────────────
// These are the EXACT industry names Saleshandy recognises
const INDUSTRIES = [
  "Retail Apparel and Fashion",
  "Apparel Manufacturing",
  "Textile Manufacturing",
  "Wholesale Apparel and Sewing Supplies"
];

const JOB_TITLES = [
  "Buying Manager",
  "Head of Buying",
  "Buying Director",
  "Senior Buyer",
  "Buyer",
  "Sourcing Director",
  "Sourcing Manager",
  "Head of Sourcing",
  "Procurement Manager",
  "Category Buyer",
  "Import Manager",
  "Merchandise Manager",
  "Product Director"
];

// ─── SALESHANDY CALL ─────────────────────────────────────────────────────────

async function saleshandy(endpoint, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: "POST",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error("Saleshandy response: " + text.substring(0, 300)); }
}

// ─── SEARCH COMPANIES ────────────────────────────────────────────────────────

async function searchCompanies(country, page) {
  try {
    const data = await saleshandy("/search/companies", {
      company_hq_location: { includes: [country] },
      company_industry: { includes: INDUSTRIES },
      is_b2b: true,
      page: page || 1
    });
    console.log("  Company response keys:", Object.keys(data.payload || {}));
    return data.payload?.companies || data.payload?.results || data.payload?.data || [];
  } catch(e) {
    console.log("  Company search error: " + e.message);
    return [];
  }
}

// ─── SEARCH PEOPLE ───────────────────────────────────────────────────────────

async function searchPeople(country, page) {
  try {
    const data = await saleshandy("/search/people", {
      job_title: { includes: JOB_TITLES },
      company_hq_location: { includes: [country] },
      company_industry: { includes: INDUSTRIES },
      is_b2b: true,
      page: page || 1
    });
    console.log("  People response keys:", Object.keys(data.payload || {}));
    const people = data.payload?.leads || data.payload?.results || data.payload?.data || [];
    const total  = data.payload?.total || data.payload?.totalRecords || people.length;
    return { people, total };
  } catch(e) {
    console.log("  People search error: " + e.message);
    return { people: [], total: 0 };
  }
}

// ─── SAVE COMPANIES ──────────────────────────────────────────────────────────

async function saveCompanies(companies, country) {
  if (!companies.length) return 0;
  const rows = companies.map(c => ({
    company_name: c.name || c.company_name || "Unknown",
    website: c.domain || c.primary_domain || c.website || null,
    full_url: (c.domain || c.primary_domain) ? "https://" + (c.domain || c.primary_domain) : null,
    category: c.industry || "Fashion",
    industry: c.industry || null,
    country: country,
    company_size: c.employee_count ? String(c.employee_count) : null,
    linkedin_company_url: c.linkedin_url || null,
    status: "discovered",
    enriched: true,
    created_at: new Date().toISOString()
  })).filter(c => c.website);

  if (!rows.length) { console.log("  (no companies with domains to save)"); return 0; }
  const { error } = await supabase.from("companies").upsert(rows, { onConflict: "website", ignoreDuplicates: true });
  if (error) console.log("  Save companies error: " + error.message);
  return rows.length;
}

// ─── SAVE PEOPLE ─────────────────────────────────────────────────────────────

async function savePeople(people, country) {
  if (!people.length) return 0;

  const contacts = people.map(p => ({
    company_name:    p.organization_name || p.company_name  || null,
    company_website: p.organization_domain || p.company_domain || null,
    contact_name:    ((p.first_name || "") + " " + (p.last_name || "")).trim(),
    first_name:      p.first_name  || null,
    last_name:       p.last_name   || null,
    job_title:       p.job_title   || p.title || null,
    department:      p.department  || null,
    linkedin_url:    p.linkedin_url || null,
    saleshandy_lead_id: p.id ? String(p.id) : null,
    email_1:         null,
    email_revealed:  false,
    country:         country,
    source:          "saleshandy_search",
    status:          "new",
    created_at:      new Date().toISOString()
  })).filter(p => p.contact_name.trim() !== "");

  const withLinkedin    = contacts.filter(c =>  c.linkedin_url);
  const withoutLinkedin = contacts.filter(c => !c.linkedin_url);
  let saved = 0;

  if (withLinkedin.length > 0) {
    const { error } = await supabase.from("contacts").upsert(withLinkedin, { onConflict: "linkedin_url", ignoreDuplicates: true });
    if (!error) saved += withLinkedin.length;
    else console.log("  Upsert (linkedin) error:", error.message);
  }
  if (withoutLinkedin.length > 0) {
    const { error } = await supabase.from("contacts").insert(withoutLinkedin);
    if (!error) saved += withoutLinkedin.length;
    else console.log("  Insert error:", error.message);
  }
  return saved;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 v3.0 — Saleshandy Lead Finder");
  console.log("No AI dependency. Hardcoded correct filters.");
  console.log("============================================\n");

  if (!SALESHANDY_API_KEY) { console.error("SALESHANDY_API_KEY not set!"); process.exit(1); }

  const country = process.argv[2] || "Denmark";
  console.log("Country: " + country);
  console.log("Industries: " + INDUSTRIES.join(", ") + "\n");

  let totalCompanies = 0;
  let totalPeople    = 0;

  // ── Companies ─────────────────────────────────────────────────────────────
  console.log("1. Searching companies in " + country + "...");
  const companies1 = await searchCompanies(country, 1);
  console.log("   Page 1: " + companies1.length + " companies");
  if (companies1.length > 0) {
    companies1.slice(0, 3).forEach(c => console.log("    -> " + (c.name || c.company_name) + " | " + (c.domain || c.primary_domain || "no domain")));
    totalCompanies += await saveCompanies(companies1, country);
    await sleep(1500);
    const companies2 = await searchCompanies(country, 2);
    console.log("   Page 2: " + companies2.length + " companies");
    if (companies2.length > 0) totalCompanies += await saveCompanies(companies2, country);
  }

  await sleep(2000);

  // ── People ────────────────────────────────────────────────────────────────
  console.log("\n2. Searching buyers in " + country + "...");
  const { people: page1, total } = await searchPeople(country, 1);
  console.log("   Total in Saleshandy database: " + total);
  console.log("   Page 1 returned: " + page1.length + " people");

  if (page1.length > 0) {
    page1.slice(0, 5).forEach(p =>
      console.log("    -> " + (p.first_name||"") + " " + (p.last_name||"") + " | " + (p.job_title||"—") + " | " + (p.organization_name||p.company_name||"—"))
    );
    totalPeople += await savePeople(page1, country);

    const maxPages = Math.min(5, Math.ceil(total / 25));
    for (let page = 2; page <= maxPages; page++) {
      await sleep(2000);
      const { people: more } = await searchPeople(country, page);
      console.log("   Page " + page + ": " + more.length + " people");
      if (more.length > 0) totalPeople += await savePeople(more, country);
    }
  }

  console.log("\n============================================");
  console.log("DONE!");
  console.log("Companies saved: " + totalCompanies);
  console.log("Buyers saved:    " + totalPeople);
  console.log("Email reveal:    1 credit per contact (from CRM)");
  console.log("============================================\n");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

runAgent3().catch(err => { console.error("Fatal: " + err.message); process.exit(1); });

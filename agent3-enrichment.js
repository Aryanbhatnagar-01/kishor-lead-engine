const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

// ── Saleshandy API helper ─────────────────────────────────────────────────────
async function saleshandy(endpoint, method, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: method || "GET",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error("Saleshandy " + res.status + ": " + text.substring(0, 200)); }
}

// ── Buyer job titles for Kishor Export products ───────────────────────────────
const BUYER_TITLES = [
  "Buying Manager", "Head of Buying", "Buying Director",
  "Sourcing Director", "Sourcing Manager", "Head of Sourcing",
  "Procurement Manager", "Category Buyer", "Senior Buyer",
  "Buyer", "Import Manager", "Merchandise Manager",
  "Product Director", "Purchasing Manager", "Head of Product"
];

// ── Industry groups matching Kishor products ──────────────────────────────────
const SEARCH_CONFIGS = [
  {
    name: "Apparel & Fashion",
    category: "Apparel and Fashion",
    industries: ["Retail Apparel and Fashion", "Apparel Manufacturing"]
  },
  {
    name: "Textile & Wholesale",
    category: "Textiles",
    industries: ["Textile Manufacturing", "Wholesale Apparel and Sewing Supplies"]
  },
  {
    name: "Home Textiles & Lifestyle",
    category: "Home Textiles",
    industries: ["Consumer Goods", "Retail", "Luxury Goods and Jewelry", "Home Furnishings"]
  }
];

// ── Search companies ──────────────────────────────────────────────────────────
async function searchCompanies(country, industries, page) {
  try {
    const body = {
      company_hq_location: { includes: [country] },
      is_b2b: true,
      page: page || 1
    };
    if (industries && industries.length > 0) {
      body.company_industry = { includes: industries };
    }
    const data = await saleshandy("/search/companies", "POST", body);
    return {
      companies: data.payload?.companies || data.payload?.results || [],
      total: data.payload?.total || 0,
      error: data.error || null
    };
  } catch(e) {
    console.log("  Company search error: " + e.message);
    return { companies: [], total: 0, error: e.message };
  }
}

// ── Search people ─────────────────────────────────────────────────────────────
async function searchPeople(country, industries, page) {
  try {
    const body = {
      job_title: { includes: BUYER_TITLES },
      company_hq_location: { includes: [country] },
      is_b2b: true,
      page: page || 1
    };
    if (industries && industries.length > 0) {
      body.company_industry = { includes: industries };
    }
    const data = await saleshandy("/search/people", "POST", body);
    return {
      people: data.payload?.leads || data.payload?.results || [],
      total: data.payload?.total || 0,
      error: data.error || null
    };
  } catch(e) {
    console.log("  People search error: " + e.message);
    return { people: [], total: 0, error: e.message };
  }
}

// ── Save companies to Supabase ────────────────────────────────────────────────
async function saveCompanies(companies, country, category) {
  if (!companies || companies.length === 0) return 0;
  const rows = companies.map(c => ({
    company_name: c.name || c.company_name || "Unknown",
    website: c.domain || c.primary_domain || null,
    full_url: c.domain ? "https://" + c.domain : null,
    description: c.description || null,
    category: category,
    country: country,
    company_size: c.employee_count ? String(c.employee_count) : null,
    linkedin_company_url: c.linkedin_url || null,
    industry: c.industry || category,
    status: "discovered",
    enriched: true,
    created_at: new Date().toISOString()
  })).filter(c => c.website);

  if (rows.length === 0) return 0;
  const { error } = await supabase.from("companies")
    .upsert(rows, { onConflict: "website", ignoreDuplicates: true });
  if (error) console.log("  Company save error: " + error.message);
  return rows.length;
}

// ── Save people to Supabase ───────────────────────────────────────────────────
async function savePeople(people, country) {
  if (!people || people.length === 0) return 0;

  const contacts = people.map(p => ({
    company_name: p.organization_name || p.company_name || null,
    company_website: p.organization_domain || p.company_domain || null,
    contact_name: ((p.first_name || "") + " " + (p.last_name || "")).trim(),
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    job_title: p.job_title || p.title || null,
    department: p.department || null,
    linkedin_url: p.linkedin_url || p.profile_url || null,
    saleshandy_lead_id: p.id ? String(p.id) : null,
    email_1: null,
    email_revealed: false,
    country: country,
    source: "saleshandy_search",
    status: "new",
    created_at: new Date().toISOString()
  })).filter(p => p.contact_name && p.contact_name.trim() !== "");

  if (contacts.length === 0) return 0;

  // Split by linkedin presence for upsert key
  const withLinkedin = contacts.filter(c => c.linkedin_url);
  const withoutLinkedin = contacts.filter(c => !c.linkedin_url);
  let saved = 0;

  if (withLinkedin.length > 0) {
    const { error } = await supabase.from("contacts")
      .upsert(withLinkedin, { onConflict: "linkedin_url", ignoreDuplicates: true });
    if (!error) saved += withLinkedin.length;
    else console.log("  LinkedIn upsert error: " + error.message);
  }

  if (withoutLinkedin.length > 0) {
    const { error } = await supabase.from("contacts").insert(withoutLinkedin);
    if (!error) saved += withoutLinkedin.length;
  }
  return saved;
}

// ── Main Agent 3 ──────────────────────────────────────────────────────────────
async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 — Saleshandy Search");
  console.log("Companies + Buyers FREE (emails on demand)");
  console.log("============================================\n");

  if (!SALESHANDY_API_KEY) { console.error("SALESHANDY_API_KEY not set!"); process.exit(1); }

  const country = process.argv[2] || "Denmark";
  console.log("Country: " + country + "\n");

  // Check credits
  try {
    const credits = await saleshandy("/credits");
    console.log("Credits: " + credits.payload?.totalCredits + " total, " + credits.payload?.creditConsumedThisMonth + " used this month\n");
  } catch(e) { console.log("Credits check failed: " + e.message); }

  let totalCompanies = 0;
  let totalPeople = 0;

  // ── Process each search config ──────────────────────────────────────────────
  for (const config of SEARCH_CONFIGS) {
    console.log("=== " + config.name + " ===");

    // STEP 1 — Search companies
    const compResult = await searchCompanies(country, config.industries, 1);
    console.log("Companies found: " + compResult.total);

    if (compResult.error) {
      console.log("Error: " + compResult.error);
    } else if (compResult.companies.length > 0) {
      const saved = await saveCompanies(compResult.companies, country, config.category);
      totalCompanies += saved;
      console.log("Companies saved: " + saved);

      // Get pages 2-5 if more results
      const maxPages = Math.min(5, Math.ceil(compResult.total / 25));
      for (let page = 2; page <= maxPages; page++) {
        await new Promise(r => setTimeout(r, 1500));
        const more = await searchCompanies(country, config.industries, page);
        if (more.companies.length > 0) {
          const moreSaved = await saveCompanies(more.companies, country, config.category);
          totalCompanies += moreSaved;
        }
      }
    }

    await new Promise(r => setTimeout(r, 2000));

    // STEP 2 — Search people (buyers)
    const peopleResult = await searchPeople(country, config.industries, 1);
    console.log("Buyers found: " + peopleResult.total);

    if (peopleResult.error) {
      console.log("Error: " + peopleResult.error);
    } else if (peopleResult.people.length > 0) {
      // Show sample
      peopleResult.people.slice(0, 3).forEach(p => {
        const name = ((p.first_name || "") + " " + (p.last_name || "")).trim();
        const title = p.job_title || p.title || "—";
        const company = p.organization_name || p.company_name || "—";
        console.log("  -> " + name + " | " + title + " | " + company);
      });

      const saved = await savePeople(peopleResult.people, country);
      totalPeople += saved;
      console.log("People saved (page 1): " + saved);

      // Get more pages
      const maxPages = Math.min(5, Math.ceil(peopleResult.total / 25));
      for (let page = 2; page <= maxPages; page++) {
        await new Promise(r => setTimeout(r, 2000));
        const more = await searchPeople(country, config.industries, page);
        if (more.people.length > 0) {
          const moreSaved = await savePeople(more.people, country);
          totalPeople += moreSaved;
          console.log("Page " + page + ": " + moreSaved + " more saved");
        }
      }
    }

    await new Promise(r => setTimeout(r, 2000));
    console.log("");
  }

  console.log("============================================");
  console.log("Agent 3 Complete!");
  console.log("Companies saved: " + totalCompanies);
  console.log("People saved: " + totalPeople);
  console.log("Emails: 0 (click Reveal in CRM = 1 credit each)");
  console.log("============================================\n");
}

runAgent3().catch(err => {
  console.error("Agent 3 fatal error: " + err.message);
  process.exit(1);
});

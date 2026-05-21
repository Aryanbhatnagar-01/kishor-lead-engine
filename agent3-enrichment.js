// agent3-enrichment.js — v5.0 HUNTER.IO
// Flow:
//   1. Hunter Discover API → find Danish fashion companies (FREE)
//   2. Hunter Domain Search API → find emails at each company
//   3. Save companies + contacts to Supabase

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const HUNTER_BASE = "https://api.hunter.io/v2";

// ─── HARDCODED FILTERS ────────────────────────────────────────────────────────

const COUNTRY_CODES = {
  denmark:          "DK",
  germany:          "DE",
  uk:               "GB",
  "united kingdom": "GB",
  sweden:           "SE",
  france:           "FR",
  netherlands:      "NL",
  norway:           "NO",
  spain:            "ES",
  italy:            "IT",
  belgium:          "BE",
  switzerland:      "CH",
};

// Hunter industry keywords for fashion/apparel
const INDUSTRY_KEYWORDS = [
  "apparel",
  "fashion",
  "clothing",
  "textile",
  "garment"
];

// Job titles we want to find at each company
const TARGET_TITLES = [
  "buyer",
  "buying manager",
  "head of buying",
  "sourcing manager",
  "head of sourcing",
  "sourcing director",
  "procurement manager",
  "merchandise manager",
  "import manager"
];

// ─── HUNTER DISCOVER — find companies ────────────────────────────────────────

async function discoverCompanies(countryCode, keyword, page = 1) {
  try {
    const params = new URLSearchParams({
      api_key: HUNTER_API_KEY,
      limit: 100,
      offset: (page - 1) * 100,
      "location_country_included[]": countryCode,
      q: keyword
    });

    const res = await fetch(`${HUNTER_BASE}/discover/companies?${params}`);
    const data = await res.json();

    if (data.errors) {
      console.log(`  ⚠️  Discover error: ${JSON.stringify(data.errors)}`);
      return { companies: [], total: 0 };
    }

    const companies = data.data?.companies || data.data || [];
    const total = data.meta?.total || companies.length;
    return { companies, total };
  } catch(e) {
    console.log(`  ❌ Discover fetch error: ${e.message}`);
    return { companies: [], total: 0 };
  }
}

// ─── HUNTER DOMAIN SEARCH — find emails at a company ─────────────────────────

async function searchDomain(domain) {
  try {
    const params = new URLSearchParams({
      api_key: HUNTER_API_KEY,
      domain: domain,
      limit: 10,
      type: "personal"
    });

    const res = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
    const data = await res.json();

    if (data.errors) return [];

    const emails = data.data?.emails || [];
    // Filter to only buying/sourcing people
    return emails.filter(e => {
      const title = (e.position || "").toLowerCase();
      return TARGET_TITLES.some(t => title.includes(t.split(" ")[0]));
    });
  } catch(e) {
    return [];
  }
}

// ─── SAVE COMPANIES ──────────────────────────────────────────────────────────

async function saveCompany(company, country) {
  try {
    const row = {
      company_name: company.name || company.domain,
      website: company.domain,
      full_url: "https://" + company.domain,
      category: company.industry || "Fashion",
      industry: company.industry || null,
      country: country,
      company_size: company.headcount || null,
      status: "discovered",
      enriched: true,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("companies")
      .upsert(row, { onConflict: "website", ignoreDuplicates: true })
      .select("id")
      .single();

    if (error) return null;
    return data?.id || null;
  } catch(e) {
    return null;
  }
}

// ─── SAVE CONTACTS ────────────────────────────────────────────────────────────

async function saveContacts(emails, companyName, domain, companyId, country) {
  if (!emails.length) return 0;
  let saved = 0;

  for (const e of emails) {
    try {
      const row = {
        company_name: companyName,
        company_website: domain,
        contact_name: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
        first_name: e.first_name || null,
        last_name: e.last_name || null,
        job_title: e.position || null,
        email_1: e.value || null,
        email_revealed: !!e.value,
        linkedin_url: e.linkedin || null,
        country: country,
        source: "hunter_domain_search",
        status: "new",
        created_at: new Date().toISOString()
      };

      if (row.email_1) {
        await supabase.from("contacts").upsert(row, { onConflict: "email_1", ignoreDuplicates: true });
      } else if (row.linkedin_url) {
        await supabase.from("contacts").upsert(row, { onConflict: "linkedin_url", ignoreDuplicates: true });
      } else {
        await supabase.from("contacts").insert(row);
      }
      saved++;
    } catch(e) {
      // skip
    }
  }
  return saved;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 v5.0 — Hunter.io Lead Finder");
  console.log("Discover companies → Find emails → Save CRM");
  console.log("============================================\n");

  if (!HUNTER_API_KEY) { console.error("HUNTER_API_KEY not set!"); process.exit(1); }

  const country = process.argv[2] || "Denmark";
  const countryCode = COUNTRY_CODES[country.toLowerCase()] || "DK";

  console.log(`Country: ${country} (${countryCode})`);
  console.log(`Keywords: ${INDUSTRY_KEYWORDS.join(", ")}\n`);

  let allCompanies = [];

  // Step 1: Discover companies for each keyword
  console.log("STEP 1: Discovering fashion companies...");
  for (const keyword of INDUSTRY_KEYWORDS) {
    console.log(`\n  🔍 Keyword: "${keyword}"`);
    const { companies, total } = await discoverCompanies(countryCode, keyword, 1);
    console.log(`  Found: ${total} total, got ${companies.length}`);

    if (companies.length > 0) {
      companies.slice(0, 2).forEach(c =>
        console.log(`    → ${c.name || c.domain} | ${c.domain} | ${c.industry || "—"}`)
      );
      allCompanies.push(...companies);
    }
    await sleep(1000);
  }

  // Deduplicate by domain
  const seen = new Set();
  allCompanies = allCompanies.filter(c => {
    if (!c.domain || seen.has(c.domain)) return false;
    seen.add(c.domain);
    return true;
  });
  console.log(`\n✅ Total unique companies: ${allCompanies.length}`);

  // Step 2: For each company, save + find emails
  console.log("\nSTEP 2: Finding buyer emails at each company...");
  let totalCompanies = 0;
  let totalContacts = 0;

  for (let i = 0; i < allCompanies.length; i++) {
    const company = allCompanies[i];
    if (!company.domain) continue;

    process.stdout.write(`  [${i+1}/${allCompanies.length}] ${company.name || company.domain}... `);

    // Save company
    const companyId = await saveCompany(company, country);
    if (companyId) totalCompanies++;

    // Find emails (uses credits — only for first 10 companies to be safe)
    if (i < 10) {
      const emails = await searchDomain(company.domain);
      if (emails.length > 0) {
        const saved = await saveContacts(emails, company.name || company.domain, company.domain, companyId, country);
        totalContacts += saved;
        console.log(`✅ ${emails.length} buyers found`);
      } else {
        console.log(`(no buyers found)`);
      }
      await sleep(1200); // respect rate limit
    } else {
      console.log(`(saved, email search skipped to save credits)`);
    }
  }

  console.log("\n============================================");
  console.log("DONE!");
  console.log(`Companies saved: ${totalCompanies}`);
  console.log(`Contacts with emails: ${totalContacts}`);
  console.log(`Remaining companies: reveal emails from CRM`);
  console.log("============================================\n");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

runAgent3().catch(err => { console.error("Fatal: " + err.message); process.exit(1); });

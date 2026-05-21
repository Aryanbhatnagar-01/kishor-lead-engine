// agent3-enrichment.js — v10.0 APOLLO
// Apollo API → finds companies + people by country + industry automatically
// Hunter Domain Search → gets emails FREE
// Fully automatic: type any country → get real buyers

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const APOLLO_BASE = "https://api.apollo.io/v1";
const HUNTER_BASE = "https://api.hunter.io/v2";

// ─── APOLLO INDUSTRY IDs for Fashion/Apparel ──────────────────────────────────
const FASHION_INDUSTRIES = [
  "apparel & fashion",
  "retail",
  "textiles",
  "wholesale"
];

// ─── TARGET JOB TITLES ────────────────────────────────────────────────────────
const BUYER_TITLES = [
  "Buying Manager",
  "Head of Buying",
  "Buying Director",
  "Senior Buyer",
  "Buyer",
  "Sourcing Manager",
  "Head of Sourcing",
  "Sourcing Director",
  "Procurement Manager",
  "Category Buyer",
  "Import Manager",
  "Merchandise Manager",
  "Product Director"
];

// ─── COUNTRY NAME → CODE ──────────────────────────────────────────────────────
const COUNTRY_CODES = {
  denmark:     "Denmark",
  germany:     "Germany",
  uk:          "United Kingdom",
  sweden:      "Sweden",
  france:      "France",
  netherlands: "Netherlands",
  norway:      "Norway",
  spain:       "Spain",
  italy:       "Italy",
  belgium:     "Belgium",
};

// ─── APOLLO PEOPLE SEARCH ─────────────────────────────────────────────────────

async function apolloSearchPeople(countryName, page = 1) {
  try {
    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APOLLO_API_KEY
      },
      body: JSON.stringify({
        page,
        per_page: 25,
        person_titles: BUYER_TITLES,
        organization_industry_tag_ids: [],
        person_locations: [countryName],
        organization_locations: [countryName],
        q_keywords: "fashion apparel clothing textile",
        contact_email_status: ["verified", "guessed", "unavailable", "bounced", "pending_manual_fulfillment"]
      })
    });

    const data = await res.json();
    if (data.error) {
      console.log(`  Apollo error: ${data.error}`);
      return { people: [], total: 0 };
    }

    const people = data.people || data.contacts || [];
    const total  = data.pagination?.total_entries || people.length;
    return { people, total };
  } catch(e) {
    console.log(`  Apollo fetch error: ${e.message}`);
    return { people: [], total: 0 };
  }
}

// ─── HUNTER DOMAIN SEARCH (FREE) ─────────────────────────────────────────────

async function getEmailsFromDomain(domain) {
  try {
    const params = new URLSearchParams({
      api_key: HUNTER_API_KEY,
      domain,
      limit: 10,
      type: "personal"
    });
    const r    = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
    const data = await r.json();
    if (data.errors) return {};

    // Build email lookup by name
    const emailMap = {};
    for (const e of (data.data?.emails || [])) {
      const key = `${e.first_name} ${e.last_name}`.toLowerCase().trim();
      emailMap[key] = e.value;
    }
    return emailMap;
  } catch(e) {
    return {};
  }
}

// ─── SAVE COMPANY ─────────────────────────────────────────────────────────────

async function saveCompany(person, country) {
  try {
    const org = person.organization || {};
    if (!org.name && !person.organization_name) return null;

    const domain = org.primary_domain ||
                   person.organization_domain ||
                   (person.email ? person.email.split("@")[1] : null);

    const row = {
      company_name: org.name || person.organization_name,
      website:      domain || null,
      full_url:     domain ? "https://" + domain : null,
      category:     org.industry || "Fashion",
      industry:     org.industry || null,
      country:      country,
      company_size: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
      status:       "discovered",
      enriched:     true,
      created_at:   new Date().toISOString()
    };

    if (!row.website) return null;

    const { data, error } = await supabase
      .from("companies")
      .upsert(row, { onConflict: "website", ignoreDuplicates: true })
      .select("id").single();

    return data?.id || null;
  } catch(e) { return null; }
}

// ─── SAVE CONTACT ─────────────────────────────────────────────────────────────

async function saveContact(person, email, country) {
  try {
    const org    = person.organization || {};
    const domain = org.primary_domain || person.organization_domain ||
                   (person.email ? person.email.split("@")[1] : null);

    const row = {
      company_name:    org.name || person.organization_name || null,
      company_website: domain   || null,
      contact_name:    person.name || `${person.first_name || ""} ${person.last_name || ""}`.trim(),
      first_name:      person.first_name || null,
      last_name:       person.last_name  || null,
      job_title:       person.title      || null,
      email_1:         email || person.email || null,
      email_revealed:  !!(email || person.email),
      linkedin_url:    person.linkedin_url || null,
      country:         country,
      source:          "apollo",
      status:          "new",
      created_at:      new Date().toISOString()
    };

    if (row.email_1) {
      await supabase.from("contacts").upsert(row, { onConflict: "email_1", ignoreDuplicates: true });
    } else if (row.linkedin_url) {
      await supabase.from("contacts").upsert(row, { onConflict: "linkedin_url", ignoreDuplicates: true });
    } else {
      await supabase.from("contacts").insert(row);
    }
    return true;
  } catch(e) { return false; }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 v10.0 — Apollo + Hunter");
  console.log("Apollo: finds buyers by country automatically");
  console.log("Hunter: gets emails FREE");
  console.log("============================================\n");

  if (!APOLLO_API_KEY) { console.error("APOLLO_API_KEY not set!"); process.exit(1); }

  const country     = (process.argv[2] || "denmark").toLowerCase();
  const countryName = COUNTRY_CODES[country] || "Denmark";
  const maxPages    = parseInt(process.argv[3] || "2");

  console.log(`Country: ${countryName}`);
  console.log(`Pages:   ${maxPages} (${maxPages * 25} max people)\n`);

  let totalCompanies = 0;
  let totalContacts  = 0;
  const domainEmailCache = {}; // cache Hunter results per domain

  // Search people page by page
  for (let page = 1; page <= maxPages; page++) {
    console.log(`\n📄 Page ${page}/${maxPages}...`);
    const { people, total } = await apolloSearchPeople(countryName, page);

    if (page === 1) console.log(`Total found in Apollo: ${total}\n`);
    if (people.length === 0) break;

    for (const person of people) {
      const org    = person.organization || {};
      const domain = org.primary_domain || person.organization_domain ||
                     (person.email ? person.email.split("@")[1] : null);

      process.stdout.write(`  → ${person.name || "Unknown"} | ${person.title || "—"} | ${org.name || "—"}... `);

      // Save company
      await saveCompany(person, country);
      totalCompanies++;

      // Get email — first try Apollo's email, then Hunter
      let email = person.email || null;

      if (!email && domain && !domainEmailCache[domain]) {
        // Fetch Hunter emails for this domain (FREE)
        domainEmailCache[domain] = await getEmailsFromDomain(domain);
        await sleep(300);
      }

      if (!email && domain && domainEmailCache[domain]) {
        const nameKey = `${person.first_name || ""} ${person.last_name || ""}`.toLowerCase().trim();
        email = domainEmailCache[domain][nameKey] || null;
      }

      // Save contact
      await saveContact(person, email, country);
      totalContacts++;

      console.log(email ? `✅ ${email}` : `(no email)`);
    }

    await sleep(1500); // rate limit between pages
  }

  console.log("\n============================================");
  console.log("DONE!");
  console.log(`Companies saved: ${totalCompanies}`);
  console.log(`Contacts saved:  ${totalContacts}`);
  console.log(`Apollo credits:  check apollo.io/settings`);
  console.log(`Hunter credits:  still FREE (domain search)`);
  console.log("============================================\n");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

runAgent3().catch(err => { console.error("Fatal: " + err.message); process.exit(1); });

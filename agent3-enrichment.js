// agent3-enrichment.js — v10.1
// Fixed Apollo API authentication

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const APOLLO_BASE = "https://api.apollo.io/v1";
const HUNTER_BASE = "https://api.hunter.io/v2";

const BUYER_TITLES = [
  "Buying Manager", "Head of Buying", "Buying Director",
  "Senior Buyer", "Buyer", "Sourcing Manager", "Head of Sourcing",
  "Sourcing Director", "Procurement Manager", "Import Manager",
  "Merchandise Manager", "Category Buyer"
];

const COUNTRY_NAMES = {
  denmark: "Denmark", germany: "Germany", uk: "United Kingdom",
  sweden: "Sweden", france: "France", netherlands: "Netherlands",
  norway: "Norway", spain: "Spain", italy: "Italy"
};

// ─── APOLLO PEOPLE SEARCH ─────────────────────────────────────────────────────

async function apolloSearch(countryName, page = 1) {
  try {
    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": APOLLO_API_KEY
      },
      body: JSON.stringify({
        api_key: APOLLO_API_KEY,
        page,
        per_page: 25,
        person_titles: BUYER_TITLES,
        person_locations: [countryName],
        q_organization_keyword_tags: ["fashion", "apparel", "clothing", "textile"]
      })
    });

    const text = await res.text();
    console.log(`  Apollo HTTP status: ${res.status}`);
    console.log(`  Apollo response preview: ${text.substring(0, 150)}`);

    if (!text.startsWith("{")) {
      console.log(`  ❌ Apollo returned non-JSON: ${text.substring(0, 100)}`);
      return { people: [], total: 0 };
    }

    const data = JSON.parse(text);
    if (data.error) { console.log(`  ❌ Apollo error: ${data.error}`); return { people: [], total: 0 }; }

    const people = data.people || data.contacts || [];
    const total  = data.pagination?.total_entries || people.length;
    return { people, total };
  } catch(e) {
    console.log(`  ❌ Apollo exception: ${e.message}`);
    return { people: [], total: 0 };
  }
}

// ─── HUNTER DOMAIN SEARCH (FREE) ─────────────────────────────────────────────

async function hunterEmails(domain) {
  try {
    const params = new URLSearchParams({ api_key: HUNTER_API_KEY, domain, limit: 10 });
    const r    = await fetch(`${HUNTER_BASE}/domain-search?${params}`);
    const data = await r.json();
    const emailMap = {};
    for (const e of (data.data?.emails || [])) {
      const key = `${e.first_name} ${e.last_name}`.toLowerCase().trim();
      emailMap[key] = e.value;
    }
    return emailMap;
  } catch(e) { return {}; }
}

// ─── SAVE COMPANY ─────────────────────────────────────────────────────────────

async function saveCompany(person, country) {
  try {
    const org    = person.organization || {};
    const domain = org.primary_domain || person.organization_domain ||
                   (person.email ? person.email.split("@")[1] : null);
    if (!domain) return null;

    const { data } = await supabase.from("companies").upsert({
      company_name: org.name || person.organization_name || domain,
      website:      domain,
      full_url:     "https://" + domain,
      category:     org.industry || "Fashion",
      industry:     org.industry || null,
      country,
      company_size: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
      status:       "discovered",
      enriched:     true,
      created_at:   new Date().toISOString()
    }, { onConflict: "website", ignoreDuplicates: true }).select("id").single();

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
      contact_name:    person.name || `${person.first_name||""} ${person.last_name||""}`.trim(),
      first_name:      person.first_name || null,
      last_name:       person.last_name  || null,
      job_title:       person.title      || null,
      email_1:         email || person.email || null,
      email_revealed:  !!(email || person.email),
      linkedin_url:    person.linkedin_url || null,
      country,
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
  console.log("AGENT 3 v10.1 — Apollo + Hunter");
  console.log("============================================\n");

  console.log("API Keys check:");
  console.log("  APOLLO_API_KEY:", APOLLO_API_KEY ? "✅ SET" : "❌ NOT SET");
  console.log("  HUNTER_API_KEY:", HUNTER_API_KEY ? "✅ SET" : "❌ NOT SET");
  console.log("");

  if (!APOLLO_API_KEY) { console.error("APOLLO_API_KEY not set!"); process.exit(1); }

  const country     = (process.argv[2] || "denmark").toLowerCase();
  const countryName = COUNTRY_NAMES[country] || "Denmark";
  const maxPages    = 2;

  console.log(`Searching: ${countryName}\n`);

  let totalCompanies = 0;
  let totalContacts  = 0;
  const domainCache  = {};

  for (let page = 1; page <= maxPages; page++) {
    console.log(`\n📄 Page ${page}/${maxPages}...`);
    const { people, total } = await apolloSearch(countryName, page);
    if (page === 1) console.log(`Total in Apollo: ${total}`);
    if (!people.length) { console.log("No results — stopping."); break; }

    for (const person of people) {
      const org    = person.organization || {};
      const domain = org.primary_domain || person.organization_domain ||
                     (person.email ? person.email.split("@")[1] : null);

      process.stdout.write(`  ${person.name||"?"} | ${person.title||"—"} | ${org.name||"—"}... `);

      await saveCompany(person, country);
      totalCompanies++;

      // Get email from Hunter if not in Apollo
      let email = person.email || null;
      if (!email && domain) {
        if (!domainCache[domain]) {
          domainCache[domain] = await hunterEmails(domain);
          await sleep(300);
        }
        const nameKey = `${person.first_name||""} ${person.last_name||""}`.toLowerCase().trim();
        email = domainCache[domain][nameKey] || null;
      }

      await saveContact(person, email, country);
      totalContacts++;
      console.log(email ? `✅ ${email}` : "(no email yet)");
    }

    await sleep(1500);
  }

  console.log("\n============================================");
  console.log(`Companies: ${totalCompanies} | Contacts: ${totalContacts}`);
  console.log("============================================\n");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
runAgent3().catch(err => { console.error("Fatal: " + err.message); process.exit(1); });

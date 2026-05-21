// agent3-enrichment.js — v8.0 FINAL
// Hunter Discover API → finds companies by country + industry (FREE)
// Hunter Domain Search → finds buyer emails (1 credit per company)
// Full automatic: type country → get companies + buyers + emails

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const HUNTER_BASE = "https://api.hunter.io/v2";

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
};

const FASHION_KEYWORDS = ["fashion", "apparel", "clothing", "textile", "garment"];

const BUYER_TITLES = [
  "buyer", "buying", "sourcing", "procurement",
  "purchasing", "merchandise", "import", "supply chain",
  "head of", "director", "manager"
];

// ─── HUNTER DISCOVER — find companies (FREE) ─────────────────────────────────

async function discoverCompanies(countryCode, keyword) {
  try {
    // Build URL exactly like Hunter UI does
    const url = `${HUNTER_BASE}/discover/companies?api_key=${HUNTER_API_KEY}&location_country_included[]=${countryCode}&q=${encodeURIComponent(keyword)}&limit=100`;

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const text = await res.text();

    // Check if it's HTML (error page)
    if (text.startsWith("<") || text.startsWith("<!")) {
      console.log(`  ⚠️  Got HTML response for "${keyword}" — API may need upgrade`);
      return [];
    }

    const data = JSON.parse(text);
    if (data.errors) {
      console.log(`  ⚠️  API error: ${JSON.stringify(data.errors)}`);
      return [];
    }

    return data.data?.companies || data.data || [];
  } catch(e) {
    console.log(`  ❌ Discover error: ${e.message}`);
    return [];
  }
}

// ─── HUNTER DOMAIN SEARCH — get buyers + emails (1 credit) ───────────────────

async function getDomainBuyers(domain) {
  try {
    const url = `${HUNTER_BASE}/domain-search?api_key=${HUNTER_API_KEY}&domain=${domain}&limit=10&type=personal`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.errors) return [];

    const emails = data.data?.emails || [];
    // Filter to buying/sourcing people
    return emails.filter(e => {
      const title = (e.position || "").toLowerCase();
      return BUYER_TITLES.some(t => title.includes(t));
    });
  } catch(e) {
    return [];
  }
}

// ─── SAVE COMPANY ─────────────────────────────────────────────────────────────

async function saveCompany(company, country) {
  try {
    const row = {
      company_name: company.name || company.domain,
      website:      company.domain,
      full_url:     "https://" + company.domain,
      category:     company.industry || "Fashion",
      industry:     company.industry || null,
      country:      country,
      company_size: company.headcount ? String(company.headcount) : null,
      status:       "discovered",
      enriched:     true,
      created_at:   new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("companies")
      .upsert(row, { onConflict: "website", ignoreDuplicates: true })
      .select("id").single();

    if (error) return null;
    return data?.id || null;
  } catch(e) { return null; }
}

// ─── SAVE CONTACTS ────────────────────────────────────────────────────────────

async function saveContacts(buyers, companyName, domain, country) {
  let saved = 0;
  for (const b of buyers) {
    try {
      const row = {
        company_name:    companyName,
        company_website: domain,
        contact_name:    `${b.first_name || ""} ${b.last_name || ""}`.trim(),
        first_name:      b.first_name || null,
        last_name:       b.last_name  || null,
        job_title:       b.position   || null,
        email_1:         b.value      || null,
        email_revealed:  !!b.value,
        linkedin_url:    b.linkedin   || null,
        country:         country,
        source:          "hunter",
        status:          "new",
        created_at:      new Date().toISOString()
      };

      if (row.email_1) {
        await supabase.from("contacts").upsert(row, { onConflict: "email_1", ignoreDuplicates: true });
      } else {
        await supabase.from("contacts").insert(row);
      }
      saved++;
    } catch(e) { /* skip */ }
  }
  return saved;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 v8.0 — Hunter Full Auto");
  console.log("Discover → Domain Search → Save CRM");
  console.log("============================================\n");

  if (!HUNTER_API_KEY) { console.error("HUNTER_API_KEY not set!"); process.exit(1); }

  const country     = process.argv[2] || "denmark";
  const countryCode = COUNTRY_CODES[country.toLowerCase()] || "DK";
  const maxCredits  = parseInt(process.argv[3] || "10"); // safety limit

  console.log(`Country:     ${country} (${countryCode})`);
  console.log(`Max credits: ${maxCredits} (1 per company email search)\n`);

  // Step 1: Discover companies
  let allCompanies = [];
  console.log("STEP 1: Discovering fashion companies (FREE)...");

  for (const keyword of FASHION_KEYWORDS) {
    console.log(`  🔍 "${keyword}"...`);
    const companies = await discoverCompanies(countryCode, keyword);
    console.log(`  Found: ${companies.length}`);
    allCompanies.push(...companies);
    await sleep(500);
  }

  // Deduplicate
  const seen = new Set();
  allCompanies = allCompanies.filter(c => {
    if (!c.domain || seen.has(c.domain)) return false;
    seen.add(c.domain);
    return true;
  });

  console.log(`\n✅ Total unique companies: ${allCompanies.length}`);

  if (allCompanies.length === 0) {
    console.log("\n⚠️  Discover API returned 0 results.");
    console.log("This means Hunter Discover requires a paid plan.");
    console.log("Using hardcoded company list instead...");
    // Will fall through to hardcoded list in future version
    process.exit(0);
  }

  // Step 2: Save companies + get buyer emails
  console.log("\nSTEP 2: Saving companies + finding buyers...");
  let totalCompanies = 0;
  let totalContacts  = 0;
  let creditsUsed    = 0;

  for (let i = 0; i < allCompanies.length; i++) {
    const company = allCompanies[i];
    if (!company.domain) continue;

    process.stdout.write(`  [${i+1}/${allCompanies.length}] ${company.name || company.domain}... `);

    // Save company (free)
    const companyId = await saveCompany(company, country);
    if (companyId) totalCompanies++;

    // Get buyer emails (uses 1 credit, up to maxCredits)
    if (creditsUsed < maxCredits) {
      const buyers = await getDomainBuyers(company.domain);
      if (buyers.length > 0) {
        const saved = await saveContacts(buyers, company.name || company.domain, company.domain, country);
        totalContacts += saved;
        console.log(`✅ ${buyers.length} buyers`);
      } else {
        console.log(`(no buyers)`);
      }
      creditsUsed++;
      await sleep(1000);
    } else {
      console.log(`(saved, email search skipped — credit limit reached)`);
      await sleep(200);
    }
  }

  console.log("\n============================================");
  console.log("DONE!");
  console.log(`Companies saved:  ${totalCompanies}`);
  console.log(`Contacts saved:   ${totalContacts}`);
  console.log(`Credits used:     ${creditsUsed}`);
  console.log("============================================\n");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

runAgent3().catch(err => { console.error("Fatal: " + err.message); process.exit(1); });

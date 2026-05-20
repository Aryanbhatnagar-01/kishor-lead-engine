const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

async function saleshandy(endpoint, method, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: method || "GET",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error("Saleshandy " + res.status + ": " + text.substring(0, 300)); }
}

// Industry keywords for Kishor Export
const INDUSTRIES = [
  "Apparel and Fashion",
  "Textiles",
  "Retail",
  "Wholesale",
  "Consumer Goods",
  "Luxury Goods and Jewelry"
];

// Buyer job titles we want
const JOB_TITLES = [
  "Buying Manager",
  "Head of Buying",
  "Sourcing Director",
  "Sourcing Manager",
  "Procurement Manager",
  "Category Buyer",
  "Head of Sourcing",
  "Import Manager",
  "Merchandise Manager",
  "Product Director",
  "Purchasing Manager",
  "Buying Director",
  "Senior Buyer",
  "Buyer"
];

async function searchCompanies(country, industry, page) {
  try {
    const data = await saleshandy("/search/companies", "POST", {
      company_hq_location: { includes: [country] },
      company_industry: { includes: [industry] },
      page: page || 1
    });
    return {
      companies: data.payload?.companies || data.payload?.results || [],
      total: data.payload?.total || data.payload?.totalRecords || 0
    };
  } catch(e) {
    console.log("  Company search error: " + e.message);
    return { companies: [], total: 0 };
  }
}

async function searchPeople(country, page) {
  try {
    const data = await saleshandy("/search/people", "POST", {
      job_title: { includes: JOB_TITLES },
      company_hq_location: { includes: [country] },
      company_industry: { includes: INDUSTRIES },
      page: page || 1
    });
    return {
      people: data.payload?.leads || data.payload?.results || [],
      total: data.payload?.total || data.payload?.totalRecords || 0
    };
  } catch(e) {
    console.log("  People search error: " + e.message);
    return { people: [], total: 0 };
  }
}

async function saveCompanies(companies, country) {
  if (!companies.length) return;
  const rows = companies.map(c => ({
    company_name: c.name || c.company_name || c.organization_name || "Unknown",
    website: c.domain || c.website || c.primary_domain || null,
    full_url: c.website_url || (c.domain ? "https://" + c.domain : null),
    description: c.description || null,
    category: c.industry || "Fashion",
    country: country,
    company_size: c.employee_count ? String(c.employee_count) : (c.size || null),
    linkedin_company_url: c.linkedin_url || null,
    status: "discovered",
    enriched: true,
    created_at: new Date().toISOString()
  }));

  const unique = rows.filter((c, i, self) =>
    c.website && i === self.findIndex(t => t.website === c.website)
  );

  if (unique.length === 0) return;

  const { error } = await supabase.from("companies")
    .upsert(unique, { onConflict: "website", ignoreDuplicates: true });
  if (error) console.log("  Company save error: " + error.message);
  else console.log("  Saved " + unique.length + " companies");
}

async function savePeople(people, country) {
  if (!people.length) return 0;

  const contacts = people.map(p => ({
    company_name: p.organization_name || p.company_name || p.company || null,
    company_website: p.organization_domain || p.company_domain || p.domain || null,
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
  }));

  // Filter out contacts without linkedin_url (need for upsert key)
  const withLinkedin = contacts.filter(c => c.linkedin_url);
  const withoutLinkedin = contacts.filter(c => !c.linkedin_url);

  let saved = 0;

  if (withLinkedin.length > 0) {
    const { error } = await supabase.from("contacts")
      .upsert(withLinkedin, { onConflict: "linkedin_url", ignoreDuplicates: true });
    if (error) console.log("  Contact save error: " + error.message);
    else saved += withLinkedin.length;
  }

  if (withoutLinkedin.length > 0) {
    const { error } = await supabase.from("contacts").insert(withoutLinkedin);
    if (error) console.log("  Contact insert error: " + error.message);
    else saved += withoutLinkedin.length;
  }

  return saved;
}

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 — Saleshandy Direct Search");
  console.log("Finds: Real companies + Real buyers");
  console.log("Cost: FREE (no credits for search)");
  console.log("============================================\n");

  if (!SALESHANDY_API_KEY) { console.error("SALESHANDY_API_KEY not set!"); process.exit(1); }

  // Get country from command line or Supabase
  const country = process.argv[2] || "Denmark";
  console.log("Country: " + country + "\n");

  // Check credits
  try {
    const credits = await saleshandy("/credits");
    console.log("Credits: " + JSON.stringify(credits.payload));
  } catch(e) { console.log("Credits check failed: " + e.message); }

  let totalCompanies = 0;
  let totalPeople = 0;

  // STEP 1 — Search companies by industry
  console.log("\n--- STEP 1: Finding Companies ---");
  for (const industry of INDUSTRIES) {
    console.log("\nIndustry: " + industry);
    const result = await searchCompanies(country, industry, 1);
    console.log("Found: " + result.total + " companies");

    if (result.companies.length > 0) {
      await saveCompanies(result.companies, country);
      totalCompanies += result.companies.length;

      // Get page 2 if more results
      if (result.total > result.companies.length) {
        const result2 = await searchCompanies(country, industry, 2);
        if (result2.companies.length > 0) {
          await saveCompanies(result2.companies, country);
          totalCompanies += result2.companies.length;
        }
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // STEP 2 — Search buyers directly
  console.log("\n--- STEP 2: Finding Buyers ---");
  const peopleResult = await searchPeople(country, 1);
  console.log("Total buyers found: " + peopleResult.total);

  if (peopleResult.people.length > 0) {
    // Log sample
    console.log("\nSample buyers:");
    peopleResult.people.slice(0, 5).forEach(p => {
      console.log("  -> " + (p.first_name || "") + " " + (p.last_name || "") +
        " | " + (p.job_title || p.title || "—") +
        " | " + (p.organization_name || p.company || "—"));
    });

    const saved = await savePeople(peopleResult.people, country);
    totalPeople += saved;

    // Get more pages
    if (peopleResult.total > peopleResult.people.length) {
      for (let page = 2; page <= Math.min(5, Math.ceil(peopleResult.total / 25)); page++) {
        await new Promise(r => setTimeout(r, 2000));
        const more = await searchPeople(country, page);
        if (more.people.length > 0) {
          const moreSaved = await savePeople(more.people, country);
          totalPeople += moreSaved;
          console.log("Page " + page + ": saved " + moreSaved + " more buyers");
        }
      }
    }
  }

  console.log("\n============================================");
  console.log("Agent 3 Complete!");
  console.log("Companies saved: " + totalCompanies);
  console.log("Buyers saved: " + totalPeople);
  console.log("Credits used: 0 (search is FREE)");
  console.log("Reveal emails from CRM when needed");
  console.log("============================================\n");
}

runAgent3().catch(err => { console.error("Agent 3 error: " + err.message); process.exit(1); });

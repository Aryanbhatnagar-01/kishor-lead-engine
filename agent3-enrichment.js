const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

// ── Saleshandy API call ──────────────────────────────────────────────────────
async function saleshandyRequest(endpoint, method, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: method || "GET",
    headers: {
      "x-api-key": SALESHANDY_API_KEY,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error("Saleshandy HTTP " + res.status + ": " + await res.text());
  return res.json();
}

// ── Enrich company by domain — FREE, no credits ──────────────────────────────
async function enrichCompany(domain) {
  try {
    const data = await saleshandyRequest("/enrichment/company", "POST", {
      domain: domain,
      revealEmail: false,   // FREE — no credits used
      revealPhone: false    // FREE — no credits used
    });
    return data.payload || null;
  } catch(e) {
    console.log("  Company enrichment failed for " + domain + ": " + e.message);
    return null;
  }
}

// ── Get people at company — FREE names+titles, no emails ─────────────────────
async function enrichPeople(domain) {
  try {
    const data = await saleshandyRequest("/enrichment/people", "POST", {
      domain: domain,
      jobTitles: [
        "Buying Manager", "Head of Buying", "Sourcing Director",
        "Sourcing Manager", "Procurement Manager", "Category Buyer",
        "Head of Sourcing", "Import Manager", "Merchandise Manager",
        "Product Director", "Purchasing Manager"
      ],
      limit: 10,
      revealEmail: false,   // FREE — no credits
      revealPhone: false    // FREE — no credits
    });
    return data.payload?.people || [];
  } catch(e) {
    console.log("  People enrichment failed for " + domain + ": " + e.message);
    return [];
  }
}

// ── Reveal email for ONE person — uses credits ────────────────────────────────
async function revealEmail(personId) {
  try {
    const data = await saleshandyRequest("/enrichment/reveal", "POST", {
      personId: personId,
      revealEmail: true,
      revealPhone: false
    });
    return data.payload?.email || null;
  } catch(e) {
    console.log("  Reveal failed for " + personId + ": " + e.message);
    return null;
  }
}

// ── Main Agent 3 ──────────────────────────────────────────────────────────────
async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 — Enrichment (Saleshandy)");
  console.log("Gets: people names + titles FREE");
  console.log("Emails: only when you click reveal in CRM");
  console.log("============================================\n");

  if (!SALESHANDY_API_KEY) { console.error("SALESHANDY_API_KEY not set!"); process.exit(1); }

  // Get all companies from Supabase that haven't been enriched yet
  const { data: companies, error } = await supabase
    .from("companies")
    .select("*")
    .eq("enriched", false)
    .not("website", "is", null)
    .limit(100);

  if (error) { console.error("Supabase error: " + error.message); process.exit(1); }
  if (!companies || companies.length === 0) { console.log("No companies to enrich!"); return; }

  console.log("Companies to enrich: " + companies.length + "\n");

  let enrichedCount = 0;
  let peopleCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log("[" + (i+1) + "/" + companies.length + "] " + company.website);

    // Step 1 — Enrich company data FREE
    const companyData = await enrichCompany(company.website);

    // Step 2 — Get people at company FREE
    const people = await enrichPeople(company.website);

    console.log("  People found: " + people.length);

    // Step 3 — Save people to contacts table (NO emails yet)
    if (people.length > 0) {
      const contacts = people.map(p => ({
        company_name: company.company_name,
        company_id: company.id,
        company_website: company.website,
        contact_name: (p.firstName || "") + " " + (p.lastName || ""),
        first_name: p.firstName || null,
        last_name: p.lastName || null,
        job_title: p.jobTitle || null,
        department: p.department || null,
        linkedin_url: p.linkedinUrl || null,
        saleshandy_person_id: p.id || null,  // saved for later email reveal
        email_1: null,                         // empty — revealed on demand
        email_revealed: false,
        country: company.country,
        source: "saleshandy_enrichment",
        status: "new",
        created_at: new Date().toISOString()
      }));

      const { error: contactError } = await supabase
        .from("contacts")
        .upsert(contacts, { onConflict: "linkedin_url" });

      if (contactError) console.log("  Contact save error: " + contactError.message);
      else {
        peopleCount += people.length;
        people.forEach(p => console.log("  -> " + p.firstName + " " + p.lastName + " | " + p.jobTitle));
      }
    }

    // Step 4 — Mark company as enriched
    const updateData = { enriched: true };
    if (companyData) {
      updateData.company_size = companyData.employeeCount || null;
      updateData.industry = companyData.industry || company.industry;
      updateData.linkedin_company_url = companyData.linkedinUrl || null;
      updateData.description = companyData.description || company.description;
    }

    await supabase.from("companies").update(updateData).eq("id", company.id);
    enrichedCount++;

    // Rate limit — 2 seconds between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\nAgent 3 Complete!");
  console.log("Companies enriched: " + enrichedCount);
  console.log("People found (FREE): " + peopleCount);
  console.log("Emails revealed: 0 (reveal from CRM when needed)");
}

runAgent3().catch(err => { console.error("Agent 3 error: " + err.message); process.exit(1); });

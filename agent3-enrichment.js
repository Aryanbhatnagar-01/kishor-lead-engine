const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

// ── Saleshandy API helper ─────────────────────────────────────────────────────
async function saleshandy(endpoint, method, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: method || "GET",
    headers: {
      "x-api-key": SALESHANDY_API_KEY,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error("Saleshandy " + res.status + ": " + text.substring(0, 200)); }
}

// ── Poll enrichment job until done ───────────────────────────────────────────
async function pollJob(requestId, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await saleshandy("/enrich/status/" + requestId);
    const s = status.payload?.status;
    console.log("  Job status: " + s + " (" + (status.payload?.processed || 0) + "/" + (status.payload?.totalRecords || 0) + ")");
    if (s === "completed" || s === "failed") {
      // Get results
      const results = await saleshandy("/enrich/status/result/" + requestId);
      return results.payload?.results || [];
    }
  }
  return [];
}

// ── Search people by company domain — FREE ───────────────────────────────────
async function searchPeopleByDomain(domain, country) {
  try {
    const data = await saleshandy("/search/people", "POST", {
      company_domain: {
        includes: [domain]
      },
      job_title: {
        includes: [
          "Buying Manager", "Head of Buying", "Sourcing Director",
          "Sourcing Manager", "Procurement Manager", "Category Buyer",
          "Head of Sourcing", "Import Manager", "Merchandise Manager",
          "Product Director", "Purchasing Manager", "Buying Director"
        ]
      },
      page: 1,
      limitPerCompany: 10
    });

    return data.payload?.leads || data.payload?.results || [];
  } catch(e) {
    console.log("  Search failed for " + domain + ": " + e.message);
    return [];
  }
}

// ── Search people by company name ─────────────────────────────────────────────
async function searchPeopleByName(companyName, country) {
  try {
    const data = await saleshandy("/search/people", "POST", {
      company_name: {
        includes: [companyName]
      },
      job_title: {
        includes: [
          "Buying Manager", "Head of Buying", "Sourcing Director",
          "Sourcing Manager", "Procurement Manager", "Category Buyer",
          "Head of Sourcing", "Import Manager", "Merchandise Manager",
          "Product Director", "Purchasing Manager", "Buying Director"
        ]
      },
      location: {
        includes: [country]
      },
      page: 1,
      limitPerCompany: 10
    });

    return data.payload?.leads || data.payload?.results || [];
  } catch(e) {
    console.log("  Name search failed for " + companyName + ": " + e.message);
    return [];
  }
}

// ── Main Agent 3 ──────────────────────────────────────────────────────────────
async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 — People Finder (Saleshandy)");
  console.log("Gets: buyer names + titles + LinkedIn FREE");
  console.log("Emails: click reveal in CRM (1 credit each)");
  console.log("============================================\n");

  if (!SALESHANDY_API_KEY) {
    console.error("SALESHANDY_API_KEY not set!");
    process.exit(1);
  }

  // Check credits first
  try {
    const credits = await saleshandy("/credits");
    console.log("Credits available: " + JSON.stringify(credits.payload));
  } catch(e) {
    console.log("Could not check credits: " + e.message);
  }

  // Get companies that haven't been enriched yet
  const { data: companies, error } = await supabase
    .from("companies")
    .select("*")
    .eq("enriched", false)
    .not("website", "is", null)
    .limit(100);

  if (error) { console.error("Supabase error: " + error.message); process.exit(1); }
  if (!companies || companies.length === 0) {
    console.log("No companies to enrich! All done or no companies found.");
    return;
  }

  console.log("Companies to process: " + companies.length + "\n");

  let enrichedCount = 0;
  let peopleCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log("[" + (i+1) + "/" + companies.length + "] " + company.company_name + " (" + company.website + ")");

    // Step 1 — Search by domain first
    let people = await searchPeopleByDomain(company.website, company.country);
    console.log("  Domain search found: " + people.length + " people");

    // Step 2 — Fallback to company name search if domain finds nothing
    if (people.length === 0 && company.company_name) {
      people = await searchPeopleByName(company.company_name, company.country);
      console.log("  Name search found: " + people.length + " people");
    }

    // Step 3 — Save people to contacts table
    if (people.length > 0) {
      const contacts = people.map(p => ({
        company_name: company.company_name,
        company_id: company.id,
        company_website: company.website,
        contact_name: ((p.first_name || p.firstName || "") + " " + (p.last_name || p.lastName || "")).trim(),
        first_name: p.first_name || p.firstName || null,
        last_name: p.last_name || p.lastName || null,
        job_title: p.job_title || p.jobTitle || p.title || null,
        department: p.department || null,
        linkedin_url: p.linkedin_url || p.linkedinUrl || null,
        saleshandy_lead_id: p.id || p.lead_id || null,
        email_1: null,
        email_revealed: false,
        country: company.country,
        source: "saleshandy_search",
        status: "new",
        created_at: new Date().toISOString()
      }));

      // Save to Supabase — upsert by linkedin_url to avoid duplicates
      const { error: contactError } = await supabase
        .from("contacts")
        .upsert(contacts, { onConflict: "linkedin_url", ignoreDuplicates: true });

      if (contactError) {
        console.log("  Save error: " + contactError.message);
      } else {
        peopleCount += people.length;
        people.forEach(p => {
          const name = ((p.first_name || p.firstName || "") + " " + (p.last_name || p.lastName || "")).trim();
          const title = p.job_title || p.jobTitle || p.title || "—";
          console.log("  -> " + name + " | " + title);
        });
      }
    }

    // Mark company as enriched
    await supabase.from("companies")
      .update({ enriched: true })
      .eq("id", company.id);

    enrichedCount++;

    // Rate limit — 2 sec between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n============================================");
  console.log("Agent 3 Complete!");
  console.log("Companies processed: " + enrichedCount);
  console.log("People found (FREE): " + peopleCount);
  console.log("Emails revealed: 0 (click Reveal in CRM)");
  console.log("============================================\n");
}

runAgent3().catch(err => {
  console.error("Agent 3 error: " + err.message);
  process.exit(1);
});

// test-saleshandy.js
// Run this on Railway to test the API directly
// Add to GitHub → Railway runs it → check logs

const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

async function test() {
  console.log("=== SALESHANDY API TEST ===\n");

  // Test 1 — Check credits
  console.log("TEST 1: Checking credits...");
  const credits = await fetch(API_BASE + "/credits", {
    headers: { "x-api-key": SALESHANDY_API_KEY }
  }).then(r => r.json());
  console.log("Credits:", JSON.stringify(credits.payload, null, 2));

  // Test 2 — Search companies in Denmark fashion
  console.log("\nTEST 2: Searching Danish fashion companies...");
  const companies = await fetch(API_BASE + "/search/companies", {
    method: "POST",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      company_hq_location: { includes: ["Denmark"] },
      company_industry: { includes: ["Apparel and Fashion"] },
      page: 1
    })
  }).then(r => r.json());

  console.log("Company search response:");
  console.log("Total found:", companies.payload?.total || companies.payload?.totalRecords || 0);
  console.log("First 3 companies:");
  const comps = companies.payload?.companies || companies.payload?.results || [];
  comps.slice(0, 3).forEach(c => {
    console.log(" -", c.name || c.company_name, "|", c.domain || c.website, "|", c.industry);
  });

  // Test 3 — Search people in Denmark fashion
  console.log("\nTEST 3: Searching Danish fashion buyers...");
  const people = await fetch(API_BASE + "/search/people", {
    method: "POST",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_title: {
        includes: ["Buying Manager", "Sourcing Director", "Head of Buying"]
      },
      company_hq_location: { includes: ["Denmark"] },
      company_industry: { includes: ["Apparel and Fashion"] },
      page: 1
    })
  }).then(r => r.json());

  console.log("People search response:");
  console.log("Total found:", people.payload?.total || people.payload?.totalRecords || 0);
  console.log("First 3 people:");
  const leads = people.payload?.leads || people.payload?.results || [];
  leads.slice(0, 3).forEach(p => {
    console.log(" -",
      (p.first_name || p.firstName || "") + " " + (p.last_name || p.lastName || ""),
      "|", p.job_title || p.jobTitle || p.title,
      "|", p.company_name || p.companyName,
      "|", p.linkedin_url || p.linkedinUrl || "no linkedin"
    );
  });

  // Test 4 — Full response structure
  console.log("\nTEST 4: Full response keys:");
  console.log("Company keys:", Object.keys(companies.payload || {}));
  console.log("People keys:", Object.keys(people.payload || {}));
  if (leads.length > 0) {
    console.log("Person fields:", Object.keys(leads[0]));
  }
  if (comps.length > 0) {
    console.log("Company fields:", Object.keys(comps[0]));
  }

  console.log("\n=== TEST COMPLETE ===");
}

test().catch(console.error);

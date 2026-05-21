// test-saleshandy-debug.js
// Deploy this to see the EXACT raw response from Saleshandy
// Run: node test-saleshandy-debug.js

const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

async function sh(endpoint, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: "POST",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  console.log("HTTP Status:", res.status);
  console.log("Raw response:", text.substring(0, 1000));
  try { return JSON.parse(text); } catch(e) { return {}; }
}

async function shGet(endpoint) {
  const res = await fetch(API_BASE + endpoint, {
    headers: { "x-api-key": SALESHANDY_API_KEY }
  });
  const text = await res.text();
  console.log("HTTP Status:", res.status);
  console.log("Raw response:", text.substring(0, 500));
}

async function run() {
  console.log("=== SALESHANDY DEBUG TEST ===\n");
  console.log("API Key set:", !!SALESHANDY_API_KEY, "\n");

  // Test 1: Credits
  console.log("--- TEST 1: GET /credits ---");
  await shGet("/credits");

  // Test 2: Companies - current format
  console.log("\n--- TEST 2: POST /search/companies (current format) ---");
  await sh("/search/companies", {
    company_hq_location: { includes: ["Denmark"] },
    company_industry: { includes: ["Retail Apparel and Fashion"] },
    page: 1
  });

  // Test 3: Companies - try alternate format
  console.log("\n--- TEST 3: POST /search/companies (alternate format) ---");
  await sh("/search/companies", {
    location: "Denmark",
    industry: "Retail Apparel and Fashion",
    page: 1
  });

  // Test 4: People - current format  
  console.log("\n--- TEST 4: POST /search/people (current format) ---");
  await sh("/search/people", {
    job_title: { includes: ["Buyer"] },
    company_hq_location: { includes: ["Denmark"] },
    company_industry: { includes: ["Retail Apparel and Fashion"] },
    page: 1
  });

  // Test 5: People - minimal, just country
  console.log("\n--- TEST 5: POST /search/people (just country, no industry) ---");
  await sh("/search/people", {
    job_title: { includes: ["Buyer"] },
    company_hq_location: { includes: ["Denmark"] },
    page: 1
  });

  // Test 6: Check what endpoints exist
  console.log("\n--- TEST 6: GET /credits (check plan) ---");
  await shGet("/enrich/credits");

  console.log("\n=== DONE ===");
}

run().catch(console.error);

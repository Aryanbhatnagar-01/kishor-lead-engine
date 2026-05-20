const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = "https://open-api.saleshandy.com/v1";

const KISHOR_PROMPT = `
You are a B2B lead generation expert for KISHOR EXPORTS, Agra India.

ABOUT KISHOR EXPORTS:
- Factory: 600,000+ garments/month, 3,200+ workers
- Certifications: GOTS, FAIR TRADE, OEKO-TEX, OCS, SEDEX SMETA
- Clients: NEXT UK, OVS Italy, Carol France, Debenhams
- Target: Mid-market to affordable premium fashion brands globally

PRODUCTS WE MAKE:
Babywear: Baby Rompers, Onesies, Dresses, Sleepwear, Swaddles, Blankets
Kidswear: Girls Tops, Boys Shirts, Kids Sweatpants, Joggers, Jackets
Womenswear: Maxi/Midi Dresses, Boho Tops, Blouses, Wide Leg Pants, Skirts, Knitwear
Menswear: Linen Shirts, Oxford Shirts, Hoodies, Sweatshirts, Jeans, Cargo Pants
Home Textiles: Bed Linen, Duvet Covers, Pillow Covers, Tea Towels, Bathrobes

IDEAL BUYERS:
- Fashion brands and retailers sourcing from India/Asia
- B2B companies only, Revenue 2M EUR minimum
- NOT luxury brands, NOT ultra-fast-fashion

JOB TITLES TO TARGET:
Buying Manager, Head of Buying, Buying Director, Sourcing Director,
Sourcing Manager, Head of Sourcing, Procurement Manager, Category Buyer,
Senior Buyer, Buyer, Import Manager, Merchandise Manager, Product Director

VALID SALESHANDY INDUSTRY NAMES (use ONLY these):
- "Retail Apparel and Fashion"
- "Apparel Manufacturing"
- "Textile Manufacturing"
- "Wholesale Apparel and Sewing Supplies"
- "Luxury Goods and Jewelry"
- "Consumer Goods"
- "Retail"
- "Home Furnishings"

Given a country name, return the BEST search filters as JSON.
Return ONLY valid JSON, no markdown, no explanation:
{
  "country": "exact country name",
  "industries": ["industry1", "industry2", "industry3"],
  "job_titles": ["title1", "title2", "title3"],
  "search_reason": "brief reason"
}
`;

async function callGemini(userInput) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_API_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: KISHOR_PROMPT + "\n\nUser input: " + userInput + "\n\nReturn JSON:" }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
    })
  });
  if (!res.ok) throw new Error("Gemini error: " + res.status);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean);
}

async function saleshandy(endpoint, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: "POST",
    headers: { "x-api-key": SALESHANDY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error("Saleshandy: " + text.substring(0, 200)); }
}

async function searchCompanies(country, industries, page) {
  try {
    const data = await saleshandy("/search/companies", {
      company_hq_location: { includes: [country] },
      company_industry: { includes: industries },
      is_b2b: true,
      page: page || 1
    });
    return data.payload?.companies || data.payload?.results || [];
  } catch(e) { console.log("Company search error: " + e.message); return []; }
}

async function searchPeople(country, industries, jobTitles, page) {
  try {
    const data = await saleshandy("/search/people", {
      job_title: { includes: jobTitles },
      company_hq_location: { includes: [country] },
      company_industry: { includes: industries },
      is_b2b: true,
      page: page || 1
    });
    return { people: data.payload?.leads || data.payload?.results || [], total: data.payload?.total || 0 };
  } catch(e) { console.log("People search error: " + e.message); return { people: [], total: 0 }; }
}

async function saveCompanies(companies, country) {
  if (!companies.length) return 0;
  const rows = companies.map(c => ({
    company_name: c.name || "Unknown",
    website: c.domain || c.primary_domain || null,
    full_url: c.domain ? "https://" + c.domain : null,
    category: c.industry || "Fashion",
    industry: c.industry || null,
    country: country,
    company_size: c.employee_count ? String(c.employee_count) : null,
    linkedin_company_url: c.linkedin_url || null,
    status: "discovered",
    enriched: true,
    created_at: new Date().toISOString()
  })).filter(c => c.website);
  if (!rows.length) return 0;
  const { error } = await supabase.from("companies").upsert(rows, { onConflict: "website", ignoreDuplicates: true });
  if (error) console.log("Save error: " + error.message);
  return rows.length;
}

async function savePeople(people, country) {
  if (!people.length) return 0;
  const contacts = people.map(p => ({
    company_name: p.organization_name || p.company_name || null,
    company_website: p.organization_domain || p.company_domain || null,
    contact_name: ((p.first_name || "") + " " + (p.last_name || "")).trim(),
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    job_title: p.job_title || p.title || null,
    department: p.department || null,
    linkedin_url: p.linkedin_url || null,
    saleshandy_lead_id: p.id ? String(p.id) : null,
    email_1: null,
    email_revealed: false,
    country: country,
    source: "saleshandy_ai_search",
    status: "new",
    created_at: new Date().toISOString()
  })).filter(p => p.contact_name.trim() !== "");

  const withLinkedin = contacts.filter(c => c.linkedin_url);
  const withoutLinkedin = contacts.filter(c => !c.linkedin_url);
  let saved = 0;
  if (withLinkedin.length > 0) {
    const { error } = await supabase.from("contacts").upsert(withLinkedin, { onConflict: "linkedin_url", ignoreDuplicates: true });
    if (!error) saved += withLinkedin.length;
  }
  if (withoutLinkedin.length > 0) {
    const { error } = await supabase.from("contacts").insert(withoutLinkedin);
    if (!error) saved += withoutLinkedin.length;
  }
  return saved;
}

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 — AI Powered Lead Finder v2");
  console.log("User types country -> AI does everything!");
  console.log("============================================\n");

  if (!SALESHANDY_API_KEY) { console.error("SALESHANDY_API_KEY not set!"); process.exit(1); }
  if (!GEMINI_API_KEY) { console.error("GEMINI_API_KEY not set!"); process.exit(1); }

  const userInput = process.argv[2] || "Denmark";
  console.log("Searching for: " + userInput + "\n");

  // AI generates perfect filters automatically
  console.log("AI thinking...");
  let filters;
  try {
    filters = await callGemini(userInput);
    console.log("AI filters generated:");
    console.log("  Country: " + filters.country);
    console.log("  Industries: " + filters.industries.join(", "));
    console.log("  Reason: " + filters.search_reason + "\n");
  } catch(e) {
    console.log("AI fallback to defaults: " + e.message);
    filters = {
      country: userInput,
      industries: ["Retail Apparel and Fashion", "Apparel Manufacturing", "Textile Manufacturing"],
      job_titles: ["Buying Manager", "Head of Buying", "Sourcing Director", "Sourcing Manager", "Senior Buyer", "Buyer"]
    };
  }

  const { country, industries, job_titles } = filters;
  let totalCompanies = 0;
  let totalPeople = 0;

  // Search companies
  console.log("Finding companies in " + country + "...");
  const companies = await searchCompanies(country, industries, 1);
  console.log("Found: " + companies.length + " companies");
  if (companies.length > 0) {
    companies.slice(0, 3).forEach(c => console.log("  -> " + c.name + " | " + c.industry));
    totalCompanies += await saveCompanies(companies, country);
    await new Promise(r => setTimeout(r, 1500));
    const page2 = await searchCompanies(country, industries, 2);
    if (page2.length > 0) totalCompanies += await saveCompanies(page2, country);
  }

  await new Promise(r => setTimeout(r, 2000));

  // Search people
  console.log("\nFinding buyers in " + country + "...");
  const { people, total } = await searchPeople(country, industries, job_titles, 1);
  console.log("Found: " + total + " total buyers");

  if (people.length > 0) {
    people.slice(0, 5).forEach(p => {
      console.log("  -> " + (p.first_name||"") + " " + (p.last_name||"") + " | " + (p.job_title||"—") + " | " + (p.organization_name||"—"));
    });
    totalPeople += await savePeople(people, country);

    const maxPages = Math.min(5, Math.ceil(total / 25));
    for (let page = 2; page <= maxPages; page++) {
      await new Promise(r => setTimeout(r, 2000));
      const { people: more } = await searchPeople(country, industries, job_titles, page);
      if (more.length > 0) totalPeople += await savePeople(more, country);
    }
  }

  console.log("\n============================================");
  console.log("Done!");
  console.log("Companies: " + totalCompanies);
  console.log("Buyers: " + totalPeople);
  console.log("Cost: $0 (emails reveal from CRM)");
  console.log("============================================\n");
}

runAgent3().catch(err => { console.error("Error: " + err.message); process.exit(1); });

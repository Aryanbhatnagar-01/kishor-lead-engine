const https = require("https");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// AGENT 2 — COMPANY DISCOVERY
// Input: queries from Agent 1 output file
// Output: raw company list saved to Supabase
// ============================================================

function searchGoogle(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const brightDataUrl = `https://api.brightdata.com/serp/google?q=${encodedQuery}&num=10`;

    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.BRIGHT_DATA_API_KEY}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(brightDataUrl, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: "parse error", raw: data });
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function extractCompanies(searchResults, query, category) {
  const companies = [];

  if (!searchResults.organic) return companies;

  for (const result of searchResults.organic) {
    // Skip non-company results
    if (!result.link || !result.title) continue;

    const domain = new URL(result.link).hostname.replace("www.", "");

    // Skip social media, news sites, directories
    const skipDomains = [
      "linkedin.com",
      "facebook.com",
      "instagram.com",
      "twitter.com",
      "wikipedia.org",
      "youtube.com",
      "pinterest.com",
    ];
    if (skipDomains.some((skip) => domain.includes(skip))) continue;

    companies.push({
      company_name: result.title.split(" - ")[0].split(" | ")[0].trim(),
      website: domain,
      full_url: result.link,
      description: result.snippet || "",
      source_query: query,
      category: category,
      country: "Denmark",
      status: "discovered",
      agent2_score: null,
      created_at: new Date().toISOString(),
    });
  }

  return companies;
}

async function saveToSupabase(companies) {
  if (companies.length === 0) return;

  // Remove duplicates by website
  const unique = companies.filter(
    (c, index, self) =>
      index === self.findIndex((t) => t.website === c.website)
  );

  const { data, error } = await supabase
    .from("companies")
    .upsert(unique, { onConflict: "website" });

  if (error) {
    console.error("❌ Supabase error:", error.message);
  } else {
    console.log(`✅ Saved ${unique.length} companies to Supabase`);
  }

  return data;
}

async function runAgent2() {
  console.log("\n============================================");
  console.log("  KISHOR LEAD ENGINE — Agent 2: Discovery");
  console.log("============================================\n");

  // Load queries from Agent 1 output
  const outputDir = "./output";
  if (!fs.existsSync(outputDir)) {
    console.error("❌ No output directory found. Run Agent 1 first!");
    process.exit(1);
  }

  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith("queries_"))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error("❌ No query files found. Run Agent 1 first!");
    process.exit(1);
  }

  const latestFile = `${outputDir}/${files[0]}`;
  console.log(`📂 Loading queries from: ${latestFile}\n`);

  const queriesData = JSON.parse(fs.readFileSync(latestFile, "utf8"));
  const { country, queries } = queriesData;

  console.log(`🌍 Country: ${country}`);
  console.log(`🔍 Queries to process: ${queries.length}\n`);

  let allCompanies = [];
  let totalFound = 0;

  for (const q of queries) {
    console.log(`\n[${q.id}/${queries.length}] Searching: ${q.category}`);
    console.log(`  Query: ${q.query}`);

    try {
      const results = await searchGoogle(q.query);

      if (results.error) {
        console.log(`  ⚠️ Search error: ${results.error}`);
        continue;
      }

      const companies = extractCompanies(results, q.query, q.category);
      console.log(`  ✅ Found ${companies.length} companies`);

      companies.forEach((c) => {
        console.log(`     → ${c.company_name} (${c.website})`);
      });

      allCompanies = allCompanies.concat(companies);
      totalFound += companies.length;

      // Save to Supabase in batches
      await saveToSupabase(companies);

      // Rate limiting - wait 2 seconds between searches
      await new Promise((r) => setTimeout(r, 2000));
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  // Save all results to file as backup
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const outputPath = `${outputDir}/companies_${country.toLowerCase()}_${Date.now()}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(allCompanies, null, 2));

  console.log(`\n============================================`);
  console.log(`✅ Agent 2 Complete!`);
  console.log(`📊 Total companies found: ${totalFound}`);
  console.log(`💾 Saved to: ${outputPath}`);
  console.log(`🗄️  Also saved to Supabase: companies table`);
  console.log(`🚀 Ready for Agent 3 (Website Verifier)!`);
  console.log(`============================================\n`);
}

runAgent2().catch(console.error);

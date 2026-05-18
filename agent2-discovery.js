const https = require("https");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function searchGoogle(query) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      gl: "dk",
      hl: "en",
      num: "10",
      api_key: process.env.SERP_API_KEY
    });

    const options = {
      hostname: "serpapi.com",
      path: `/search?${params.toString()}`,
      method: "GET"
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch(e) {
          console.log("Parse error, raw:", data.substring(0, 300));
          resolve({ error: "parse error" });
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

async function runAgent2() {
  console.log("\n============================================");
  console.log("  KISHOR LEAD ENGINE — Agent 2: Discovery");
  console.log("============================================\n");

  const outputDir = "./output";
  const files = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter(f => f.startsWith("queries_")).sort().reverse()
    : [];

  if (files.length === 0) {
    console.error("❌ No query files found!");
    return;
  }

  const queriesData = JSON.parse(fs.readFileSync(`${outputDir}/${files[0]}`, "utf8"));
  const { country, queries } = queriesData;

  console.log(`🌍 Country: ${country}`);
  console.log(`🔍 Processing ${queries.length} queries\n`);

  let allCompanies = [];

  for (const q of queries) {
    console.log(`\n[${q.id}/15] ${q.category}`);
    console.log(`  Query: ${q.query}`);

    try {
      const result = await searchGoogle(q.query);

      if (result.error) {
        console.log(`  ⚠️ Error: ${result.error}`);
        continue;
      }

      const organic = result.organic_results || [];
      console.log(`  ✅ Found ${organic.length} results`);

      for (const item of organic) {
        if (!item.link) continue;
        try {
          const domain = new URL(item.link).hostname.replace("www.", "");
          const skipDomains = ["linkedin.com", "facebook.com", "instagram.com", "wikipedia.org", "youtube.com"];
          if (skipDomains.some(s => domain.includes(s))) continue;

          console.log(`     → ${item.title} (${domain})`);

          allCompanies.push({
            company_name: (item.title || domain).split(" - ")[0].split(" | ")[0].trim(),
            website: domain,
            full_url: item.link,
            description: item.snippet || "",
            source_query: q.query,
            category: q.category,
            country: country,
            status: "discovered",
            created_at: new Date().toISOString()
          });
        } catch(e) {}
      }

      // Save in batches + rate limiting
      if (allCompanies.length > 0) {
        const unique = allCompanies.filter((c, i, self) =>
          i === self.findIndex(t => t.website === c.website)
        );
        const { error } = await supabase.from("companies")
          .upsert(unique, { onConflict: "website" });
        if (error) console.error("Supabase error:", error.message);
      }

      await new Promise(r => setTimeout(r, 1000));

    } catch(err) {
      console.error(`  ❌ ${err.message}`);
    }
  }

  console.log("\n============================================");
  console.log(`✅ Agent 2 Complete!`);
  console.log(`📊 Total companies found: ${allCompanies.length}`);
  console.log(`🗄️  Saved to Supabase: companies table`);
  console.log(`🚀 Ready for Agent 3 (Website Verifier)!`);
  console.log("============================================\n");
}

runAgent2().catch(console.error);

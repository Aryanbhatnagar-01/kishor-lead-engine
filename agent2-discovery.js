const https = require("https");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function searchGoogle(query) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.brightdata.com",
      path: `/serp?engine=google&q=${encodeURIComponent(query)}&gl=dk&hl=en`,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${process.env.BRIGHT_DATA_API_KEY}`
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Raw (500 chars): ${data.substring(0, 500)}`);
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve({ error: "parse error", raw: data.substring(0, 200) });
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
    console.error("❌ No query files found. Run Agent 1 first!");
    return;
  }

  const queriesData = JSON.parse(fs.readFileSync(`${outputDir}/${files[0]}`, "utf8"));
  const { country, queries } = queriesData;

  console.log(`🌍 Country: ${country}`);
  console.log(`🔍 Processing ${queries.length} queries\n`);

  let allCompanies = [];

  // Only test first 3 queries to debug
  const testQueries = queries.slice(0, 3);

  for (const q of testQueries) {
    console.log(`\n[${q.id}] ${q.category}: ${q.query}`);

    try {
      const result = await searchGoogle(q.query);

      if (result.error) {
        console.log(`⚠️ Error: ${result.error}`);
        console.log(`Raw: ${result.raw}`);
        continue;
      }

      console.log(`Response keys: ${Object.keys(result).join(", ")}`);

      // Handle different response formats
      const organic = result.organic || result.results || result.organic_results || [];
      console.log(`Found ${organic.length} results`);

      for (const item of organic) {
        if (item.link || item.url) {
          const url = item.link || item.url;
          try {
            const domain = new URL(url).hostname.replace("www.", "");
            const skipDomains = ["linkedin.com", "facebook.com", "instagram.com", "wikipedia.org"];
            if (!skipDomains.some(s => domain.includes(s))) {
              allCompanies.push({
                company_name: (item.title || domain).split(" - ")[0].trim(),
                website: domain,
                full_url: url,
                description: item.snippet || item.description || "",
                source_query: q.query,
                category: q.category,
                country: country,
                status: "discovered",
                created_at: new Date().toISOString()
              });
            }
          } catch(e) {}
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    } catch(err) {
      console.error(`❌ ${err.message}`);
    }
  }

  console.log(`\nTotal companies found: ${allCompanies.length}`);

  if (allCompanies.length > 0) {
    const { error } = await supabase.from("companies").upsert(allCompanies, { onConflict: "website" });
    if (error) console.error("Supabase error:", error.message);
    else console.log(`✅ Saved ${allCompanies.length} to Supabase!`);
  }

  console.log("\n✅ Agent 2 Complete!");
}

runAgent2().catch(console.error);

const https = require("https");
const http = require("http");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function searchDuckDuckGo(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const options = {
      hostname: "html.duckduckgo.com",
      path: `/html/?q=${encoded}`,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        // Extract URLs from HTML
        const results = [];
        const urlRegex = /href="(https?:\/\/[^"]+)"/g;
        let match;
        const seen = new Set();

        while ((match = urlRegex.exec(data)) !== null) {
          const url = match[1];
          if (
            !url.includes("duckduckgo") &&
            !url.includes("google") &&
            !url.includes("facebook") &&
            !url.includes("twitter") &&
            !url.includes("youtube") &&
            !seen.has(url)
          ) {
            seen.add(url);
            results.push(url);
          }
        }

        console.log(`  Found ${results.length} URLs`);
        resolve(results.slice(0, 10));
      });
    });

    req.on("error", (err) => {
      console.log(`  ⚠️ Error: ${err.message}`);
      resolve([]);
    });

    req.end();
  });
}

async function runAgent2() {
  console.log("\n============================================");
  console.log("  KISHOR LEAD ENGINE — Agent 2: Discovery");
  console.log("  (Using DuckDuckGo — Free & Unlimited)");
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
    console.log(`\n[${q.id}/${queries.length}] ${q.category}`);
    console.log(`  Query: ${q.query}`);

    const urls = await searchDuckDuckGo(q.query);

    for (const url of urls) {
      try {
        const domain = new URL(url).hostname.replace("www.", "");
        const skipDomains = [
          "linkedin.com", "facebook.com", "instagram.com",
          "wikipedia.org", "youtube.com", "twitter.com",
          "pinterest.com", "amazon.com", "ebay.com",
          "reddit.com", "quora.com", "medium.com"
        ];

        if (!skipDomains.some(s => domain.includes(s))) {
          console.log(`     → ${domain}`);
          allCompanies.push({
            company_name: domain.split(".")[0],
            website: domain,
            full_url: url,
            description: `Found via: ${q.query}`,
            source_query: q.query,
            category: q.category,
            country: country,
            status: "discovered",
            created_at: new Date().toISOString()
          });
        }
      } catch(e) {}
    }

    // Save to Supabase in batches
    if (allCompanies.length > 0) {
      const unique = allCompanies.filter((c, i, self) =>
        i === self.findIndex(t => t.website === c.website)
      );
      const { error } = await supabase.from("companies")
        .upsert(unique, { onConflict: "website" });
      if (error) console.error("  Supabase error:", error.message);
    }

    // Rate limit — be nice to DuckDuckGo
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log("\n============================================");
  console.log(`✅ Agent 2 Complete!`);
  console.log(`📊 Total companies: ${allCompanies.length}`);
  console.log(`🗄️  Saved to Supabase!`);
  console.log(`🚀 Ready for Agent 3!`);
  console.log("============================================\n");
}

runAgent2().catch(console.error);

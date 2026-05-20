const https = require("https");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SKIP_DOMAINS = [
  "linkedin.com","facebook.com","instagram.com","wikipedia.org",
  "youtube.com","twitter.com","pinterest.com","amazon.com","ebay.com",
  "reddit.com","quora.com","medium.com","duckduckgo.com","google.com",
  "alibaba.com","aliexpress.com","etsy.com","shopify.com"
];

function searchDuckDuckGo(query) {
  return new Promise((resolve) => {
    const options = {
      hostname: "html.duckduckgo.com",
      path: "/html/?q=" + encodeURIComponent(query),
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html"
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const results = [];
        const urlRegex = /href="(https?:\/\/[^"]+)"/g;
        let match;
        const seen = new Set();
        while ((match = urlRegex.exec(data)) !== null) {
          const url = match[1];
          if (!url.includes("duckduckgo") && !url.includes("google") && !seen.has(url)) {
            seen.add(url);
            results.push(url);
          }
        }
        resolve(results.slice(0, 10));
      });
    });
    req.on("error", () => resolve([]));
    req.end();
  });
}

async function runAgent2() {
  console.log("============================================");
  console.log("AGENT 2 — Discovery (DuckDuckGo FREE)");
  console.log("============================================");

  const outputDir = "./output";
  if (!fs.existsSync(outputDir)) { console.error("No output dir! Run Agent 1 first."); process.exit(1); }

  const files = fs.readdirSync(outputDir).filter(f => f.startsWith("queries_")).sort().reverse();
  if (files.length === 0) { console.error("No query files! Run Agent 1 first."); process.exit(1); }

  const queriesData = JSON.parse(fs.readFileSync(outputDir + "/" + files[0], "utf8"));
  const country = queriesData.country;

  // Flatten queries from groups structure
  let queries = [];
  if (queriesData.groups) {
    queries = queriesData.groups.flatMap(g => (g.queries || []).map(q => ({ ...q, category: g.category })));
  } else if (queriesData.queries) {
    queries = queriesData.queries;
  }

  console.log("Country: " + country + " | Queries: " + queries.length);

  let allCompanies = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log("[" + (i+1) + "/" + queries.length + "] " + q.query);

    const urls = await searchDuckDuckGo(q.query);

    for (const url of urls) {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, "");
        if (!SKIP_DOMAINS.some(s => domain.includes(s)) && domain.includes(".")) {
          allCompanies.push({
            company_name: domain.split(".")[0],
            website: domain,
            full_url: url,
            description: "Found via: " + q.query,
            source_query: q.query,
            category: q.category || "General",
            country: country,
            status: "discovered",
            created_at: new Date().toISOString()
          });
        }
      } catch(e) {}
    }

    // Save every 10 queries
    if (i % 10 === 0 || i === queries.length - 1) {
      const unique = allCompanies.filter((c, idx, self) => idx === self.findIndex(t => t.website === c.website));
      const { error } = await supabase.from("companies").upsert(unique, { onConflict: "website" });
      if (error) console.error("Supabase error: " + error.message);
      else console.log("  Saved " + unique.length + " companies");
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log("\nAgent 2 Complete! Companies found: " + allCompanies.length);
}

runAgent2().catch(err => { console.error("Agent 2 error: " + err.message); process.exit(1); });

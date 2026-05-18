const https = require("https");
const fs = require("fs");

const PRODUCT_GROUPS = [
  { id:1, category:"Babywear", group:"Baby Rompers & Onesies", products:["baby rompers","bubble rompers","muslin rompers","printed onesies","bodysuits","ribbed bodysuits"], buyers:["baby romper brand","babywear brand","organic baby clothing brand","baby fashion retailer"] },
  { id:2, category:"Babywear", group:"Baby Dresses & Sets", products:["baby dresses","tiered baby dresses","smocked dresses","embroidered dresses","floral dresses","pinafore dresses","muslin dresses","baby co-ord sets"], buyers:["baby dress brand","children boutique","kidswear retailer","baby fashion brand"] },
  { id:3, category:"Babywear", group:"Baby Sleepwear & Essentials", products:["footed sleepsuits","baby pajama sets","seasonal sleepwear","muslin swaddles","baby blankets","bib sets","newborn gift sets","terry bathrobes"], buyers:["baby essentials brand","newborn clothing brand","organic baby brand","baby gift retailer"] },
  { id:4, category:"Kidswear", group:"Kids Tops & Shirts", products:["girls tops","peplum tops","frill tops","graphic tees","boys shirts","cuban collar shirts","flannel shirts","denim shirts"], buyers:["kidswear brand","children fashion brand","kids clothing retailer","school casualwear brand"] },
  { id:5, category:"Kidswear", group:"Kids Bottoms & Outerwear", products:["kids sweatpants","relaxed joggers","terry towelling sets","waffle knit sets","hooded baby jackets","quilted baby jackets","puffer vests","beanies","scarves","mittens"], buyers:["children outerwear brand","kids activewear brand","kidswear retailer"] },
  { id:6, category:"Womenswear", group:"Womenswear Dresses", products:["maxi dresses","midi dresses","smocked dresses","kaftan dresses","wrap dresses","boho dresses","resort dresses","tiered dresses","slip dresses"], buyers:["womenswear brand","women fashion retailer","resort wear brand","boho fashion brand"] },
  { id:7, category:"Womenswear", group:"Womenswear Tops & Blouses", products:["boho tops","embroidered tops","smocked tops","wrap tops","crop tops","blouses","satin blouses","puff sleeve blouses","linen shirts","camisoles"], buyers:["women clothing brand","blouse brand","womenswear retailer","women boutique brand"] },
  { id:8, category:"Womenswear", group:"Womenswear Bottoms & Skirts", products:["wide leg pants","linen pants","cargo pants","denim jeans","barrel leg pants","tiered skirts","wrap skirts","pleated skirts","satin skirts","denim skirts"], buyers:["womenswear brand","denim brand","women bottoms brand","sustainable fashion brand"] },
  { id:9, category:"Womenswear", group:"Womenswear Knitwear & Sets", products:["sweatshirts","oversized hoodies","knit pullovers","cardigans","crochet styles","quilted jackets","beach cover ups","co-ord sets","lounge sets"], buyers:["knitwear brand","women outerwear brand","loungewear brand","sustainable knitwear buyer"] },
  { id:10, category:"Menswear", group:"Menswear Shirts & Tops", products:["linen shirts","oxford shirts","resort shirts","flannel shirts","overshirts","graphic t-shirts","garment dyed tees","vintage wash tees","polo t-shirts","knit polos"], buyers:["menswear brand","men clothing retailer","resort wear brand","casual menswear brand"] },
  { id:11, category:"Menswear", group:"Menswear Bottoms", products:["relaxed fit jeans","carpenter jeans","cargo pants","utility pants","linen pants","chinos","chino shorts","cargo shorts","denim shorts"], buyers:["menswear brand","denim brand","men bottoms retailer","workwear brand"] },
  { id:12, category:"Menswear", group:"Menswear Knitwear & Outerwear", products:["sweatshirts","hoodies","zip hoodies","knitted sweaters","cardigans","harrington jackets","bomber jackets","lightweight puffers","denim jackets"], buyers:["menswear knitwear brand","men outerwear brand","casual menswear retailer","streetwear brand"] },
  { id:13, category:"Menswear", group:"Menswear Sets & Collections", products:["lounge sets","tracksuits","co-ord sets","washed cotton programs","garment dyed collections","yarn dyed checks","organic cotton styles","resortwear","chinos"], buyers:["menswear brand","resort fashion brand","sustainable menswear brand","Scandinavian basics brand"] },
  { id:14, category:"Home Textiles", group:"Bedding & Quilts", products:["bed linen sets","duvet covers","pillow covers","fitted sheets","organic cotton bedding","linen bedding","washed cotton bedding","muslin quilts","cotton quilts","waffle blankets"], buyers:["home textile brand","bedding brand","organic home brand","linen bedding buyer","sustainable home brand"] },
  { id:15, category:"Home Textiles", group:"Kitchen & Table Textiles", products:["napkins","kitchen textiles","tea towels","aprons"], buyers:["kitchen textile brand","table linen brand","home lifestyle brand","sustainable kitchen brand"] },
  { id:16, category:"Home Textiles", group:"Bath & Scandinavian Home", products:["bathrobes","waffle bathrobes","scandinavian home collections","sustainable home textiles"], buyers:["home textile brand","bathrobe brand","Scandinavian home brand","sustainable lifestyle brand"] },
];

const KISHOR_CONTEXT = `
You are a B2B sourcing agent for KISHOR EXPORTS, Agra India.
Factory: 600,000+ garments/month | 3,200+ workers
Certifications: GOTS, FAIR TRADE, OEKO-TEX, OCS, SEDEX SMETA
Clients: NEXT UK, OVS Italy, Carol France, Debenhams
Target: Mid-market to affordable premium fashion brands globally
Avoid: Luxury brands, ultra-fast-fashion, micro brands under 2M EUR
`;

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
    });
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
          resolve(text);
        } catch(e) { reject(new Error("Parse error: " + data.substring(0,200))); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function buildQueriesForGroup(country, group) {
  const prompt = `${KISHOR_CONTEXT}

TARGET COUNTRY: ${country}
PRODUCT GROUP: ${group.group}
CATEGORY: ${group.category}
PRODUCTS: ${group.products.join(", ")}
BUYER TYPES: ${group.buyers.join(", ")}

Generate 10 specific Google search queries to find ${group.category} brands in ${country} who buy ${group.group}.
- Find ACTUAL BRAND WEBSITES not directories or news
- Include local language if helpful
- Focus on brands sourcing from India/Asia

Return ONLY valid JSON:
{
  "country": "${country}",
  "category": "${group.category}",
  "group": "${group.group}",
  "queries": [{"id":1,"query":"example query here","intent":"why this query"}]
}`;

  const raw = await callGemini(prompt);
  const clean = raw.replace(/\`\`\`json|\`\`\`/g, "").trim();
  try { return JSON.parse(clean); }
  catch(e) { return { country, category: group.category, group: group.group, queries: [] }; }
}

async function runAgent1(country) {
  console.log("\n============================================");
  console.log(`  AGENT 1 — Query Builder (Gemini FREE)`);
  console.log(`  Country: ${country} | Groups: ${PRODUCT_GROUPS.length}`);
  console.log("============================================\n");

  if (!fs.existsSync("./output")) fs.mkdirSync("./output");

  const allQueries = [];
  let totalQueries = 0;

  for (const group of PRODUCT_GROUPS) {
    console.log(`[${group.id}/16] ${group.category} — ${group.group}`);
    try {
      const result = await buildQueriesForGroup(country, group);
      allQueries.push(result);
      totalQueries += result.queries.length;
      console.log(`  Generated ${result.queries.length} queries`);
      result.queries.forEach(q => console.log(`  → ${q.query}`));
      await new Promise(r => setTimeout(r, 4000)); // 15 RPM limit
    } catch(err) {
      console.error(`  Error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const output = {
    country, total_groups: PRODUCT_GROUPS.length,
    total_queries: totalQueries,
    generated_at: new Date().toISOString(),
    groups: allQueries
  };

  const outputPath = `./output/queries_${country.toLowerCase().replace(/\s/g,"_")}_${Date.now()}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✅ Agent 1 Complete!`);
  console.log(`📊 Total queries: ${totalQueries} across ${PRODUCT_GROUPS.length} product groups`);
  console.log(`💾 Saved: ${outputPath}\n`);
  return output;
}

const country = process.argv[2] || "Denmark";
runAgent1(country).catch(console.error);

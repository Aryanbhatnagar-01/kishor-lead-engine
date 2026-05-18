const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// CAG - CACHED COMPANY CONTEXT (preloaded once, reused always)
// ============================================================
const KISHOR_CONTEXT = `
You are an AI sourcing intelligence agent for Kishor Exports, India.

COMPANY PROFILE:
- Name: Kishor Exports
- Location: Ranchi, India (Special Economic Zone)
- Workers: 3,200+ (85% women)
- Capacity: 600,000+ garments/month
- Type: Woven + Knits manufacturer

PRODUCT STRENGTHS:
- Womenswear: dresses, blouses, tops, shirts
- Kidswear: girls dresses, boys shirts, lifestyle collections
- Babywear: rompers, baby dresses, printed babywear
- Fabrics: organic cotton, gauze, linen, chambray, denim, viscose, recycled polyester

CERTIFICATIONS:
- GOTS, FAIR TRADE, OEKO-TEX STANDARD 100, OCS, SEDEX SMETA 4 PILLAR

CSR POSITIONING:
- Sustainable production, ethical manufacturing, living wages
- Solar energy, rainwater harvesting, women empowerment
- Recycled packaging, organic cotton sourcing

EXISTING BRAND EXPERIENCE:
- NEXT (UK), OVS (Italy), Carol (France), Debenhams/Magasin

TARGET: Affordable Sustainable Fashion with Ethical Manufacturing and Competitive Pricing.

IDEAL BUYER PROFILE:
- European fashion brands, retailers, department stores
- Sustainable/ethical/organic positioning
- Mid-market to affordable premium price segment
- Sourcing from India or open to it
- Product categories: womenswear, kidswear, babywear, denim, organic cotton

AVOID:
- Ultra luxury brands
- Brands manufacturing only in Europe
- Ultra fast-fashion with impossible compliance requirements
- Tiny hobby brands with no scale
`;

// ============================================================
// AGENT 1 — QUERY BUILDER
// Input: country name
// Output: 10+ smart Google search queries in JSON
// ============================================================
async function buildSearchQueries(country) {
  console.log(`\n🔍 Agent 1 — Building search queries for: ${country}`);

  const prompt = `
${KISHOR_CONTEXT}

TARGET COUNTRY: ${country}

Your task: Generate 15 highly specific Google search queries to discover fashion brands and buyers in ${country} that are a good fit for Kishor Exports.

Generate queries across these categories:
1. Sustainable/ethical fashion brands in ${country}
2. Kidswear and babywear brands in ${country}
3. Womenswear retailers and brands in ${country}
4. Organic cotton clothing brands in ${country}
5. Department stores and retail chains in ${country} that source from India
6. Fashion importers and buying houses in ${country}
7. Trade fair exhibitors from ${country} (CIFF, Premiere Vision, Pure London, etc.)
8. DTC (direct to consumer) fashion brands in ${country}
9. Private label fashion companies in ${country}
10. Sustainable fashion directories for ${country}

Rules:
- Queries must be specific and Google-searchable
- Include local language terms where helpful
- Focus on companies likely to source from India/Asia
- Prioritize sustainability-focused brands

Return ONLY valid JSON in this exact format:
{
  "country": "${country}",
  "total_queries": 15,
  "queries": [
    {
      "id": 1,
      "category": "Sustainable Fashion",
      "query": "sustainable fashion brands ${country} ethical manufacturing",
      "intent": "Find eco-conscious brands likely to source ethically"
    }
  ]
}
`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].text;

    // Clean JSON (remove markdown fences if any)
    const clean = raw.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    console.log(`✅ Generated ${result.total_queries} queries for ${country}`);
    console.log(`\n📋 QUERIES:\n`);

    result.queries.forEach((q) => {
      console.log(`  [${q.id}] ${q.category}`);
      console.log(`       → ${q.query}`);
      console.log(`       → Intent: ${q.intent}\n`);
    });

    return result;
  } catch (error) {
    console.error("❌ Agent 1 Error:", error.message);
    throw error;
  }
}

// ============================================================
// MAIN — Run Agent 1
// ============================================================
async function main() {
  const country = process.argv[2] || "Denmark";

  console.log("============================================");
  console.log("  KISHOR LEAD ENGINE — Agent 1: Query Builder");
  console.log("============================================");

  const result = await buildSearchQueries(country);

  // Save to file for Agent 2 to pick up
  const fs = require("fs");
  const outputPath = `./output/queries_${country.toLowerCase()}_${Date.now()}.json`;

  if (!fs.existsSync("./output")) fs.mkdirSync("./output");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(`\n💾 Saved to: ${outputPath}`);
  console.log(`\n🚀 Agent 1 complete! Ready for Agent 2 (Discovery).`);
}

main().catch(console.error);

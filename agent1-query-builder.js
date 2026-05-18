const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const KISHOR_CONTEXT = `
You are an AI sourcing intelligence agent for Kishor Exports, India.
Factory: Ranchi, India | 3,200+ workers | 600,000+ garments/month
Products: Womenswear, Kidswear, Babywear, Denim, Organic Cotton
Certifications: GOTS, FAIR TRADE, OEKO-TEX, OCS, SEDEX SMETA
Experience: NEXT (UK), OVS (Italy), Carol (France)
Target: European sustainable mid-market fashion brands
`;

async function buildSearchQueries(country) {
  console.log(`\nKISHOR LEAD ENGINE - Agent 1 running for: ${country}`);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `${KISHOR_CONTEXT}

Generate 15 specific Google search queries to find fashion brands and buyers in ${country} that fit Kishor Exports.

Cover: sustainable brands, kidswear, womenswear, organic cotton, department stores, buying houses, trade fair exhibitors, DTC brands, private label companies.

Return ONLY valid JSON:
{
  "country": "${country}",
  "total_queries": 15,
  "queries": [
    {
      "id": 1,
      "category": "Sustainable Fashion",
      "query": "sustainable fashion brands ${country} ethical manufacturing",
      "intent": "Find eco-conscious brands"
    }
  ]
}`
    }]
  });

  const raw = response.content[0].text;
  const clean = raw.replace(/```json|```/g, "").trim();
  const result = JSON.parse(clean);

  console.log(`\nGenerated ${result.total_queries} queries for ${country}:\n`);
  result.queries.forEach(q => {
    console.log(`[${q.id}] ${q.category}`);
    console.log(`     Query: ${q.query}`);
    console.log(`     Intent: ${q.intent}\n`);
  });

  if (!fs.existsSync("./output")) fs.mkdirSync("./output");
  const path = `./output/queries_${country.toLowerCase()}_${Date.now()}.json`;
  fs.writeFileSync(path, JSON.stringify(result, null, 2));
  console.log(`Saved to: ${path}`);

  return result;
}

const country = process.argv[2] || "Denmark";
buildSearchQueries(country).catch(console.error);

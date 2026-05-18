const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// CAG — CACHED COMPANY INTELLIGENCE (preloaded once, reused)
// This is the full brain of the system. Claude reads this
// context every time to generate smart, targeted queries.
// ============================================================
const KISHOR_CAG = `
You are an AI sourcing intelligence agent for KISHOR EXPORTS, India.
Your job is to find European fashion brands that are ideal buyers for Kishor Exports.

================================================================
KISHOR EXPORTS — COMPLETE COMPANY PROFILE
================================================================

FACTORY DETAILS:
- Name: Kishor Exports
- Location: Agra, India (also has SEZ unit)
- Type: Woven + Knits manufacturer
- Capacity: 600,000+ garments/month
- Workers: 3,200+ (85% women)
- Factory size: Large scale, suitable for mid to large brands

CERTIFICATIONS (All active):
- GOTS (Global Organic Textile Standard)
- FAIR TRADE certified
- OEKO-TEX STANDARD 100
- OCS (Organic Content Standard)
- SEDEX SMETA 4 PILLAR audit

CSR / SUSTAINABILITY:
- Solar energy powered factory
- Rainwater harvesting
- Women empowerment programs
- Living wages
- Recycled packaging
- Organic cotton sourcing
- Carbon footprint reduction initiatives

EXISTING BRAND EXPERIENCE:
- NEXT (UK) — major high street brand
- OVS (Italy) — large European fashion retailer
- Carol (France) — women's fashion brand
- Debenhams/Magasin — department store

================================================================
COMPLETE PRODUCT CATALOGUE
================================================================

BABYWEAR & KIDSWEAR:
Baby Rompers, Bubble Rompers, Muslin Rompers, Sleeveless Rompers,
Printed Onesies, Baby Onepieces, Bodysuits, Ribbed Bodysuits,
Footed Sleepsuits, Baby Pajama Sets, Baby Leggings, Bloomers,
Baby Shorts, Baby Joggers, Baby Sweatshirts, Hooded Baby Jackets,
Quilted Baby Jackets, Knitted Baby Cardigans, Baby Co-Ord Sets,
Baby Dresses, Tiered Baby Dresses, Smocked Dresses, Embroidered Dresses,
Floral Dresses, Pinafore Dresses, Muslin Dresses, Cotton Voile Dresses,
Girls Tops, Peplum Tops, Frill Tops, Puff Sleeve Tops, Graphic Tees,
Boys Shirts, Cuban Collar Shirts, Flannel Shirts, Denim Shirts,
Kids Sweatpants, Relaxed Joggers, Terry Towelling Sets, Waffle Knit Sets,
Rib Knit Programs, Organic Cotton Essentials, Neutral Essentials,
Seasonal Sleepwear, Muslin Swaddles, Baby Blankets, Bib Sets,
Newborn Gift Sets, Terry Bathrobes, Puffer Vests, Beanies, Scarves,
Mittens, School Casualwear, Holiday Capsules, Beachwear Programs,
Resort Kidswear, Scandinavian Minimal Styles, Earth Tone Collections

WOMENSWEAR:
Boho Tops, Embroidered Tops, Lace Tops, Smocked Tops, Peasant Tops,
Wrap Tops, Crop Tops, Tank Tops, Camisoles, Tunics, Blouses,
Satin Blouses, Puff Sleeve Blouses, Oversized Shirts, Linen Shirts,
Shirt Dresses, Maxi Dresses, Midi Dresses, Mini Dresses, Tiered Dresses,
Smocked Dresses, Slip Dresses, Kaftan Dresses, Wrap Dresses, Boho Dresses,
Floral Dresses, Embroidered Dresses, Resort Dresses, Vacation Dresses,
Occasion Dresses, Lounge Dresses, Knit Dresses, Sweat Dresses,
Beach Cover Ups, Co-Ord Sets, Lounge Sets, Relaxed Tailoring,
Wide Leg Pants, Linen Pants, Cargo Pants, Drawstring Pants, Denim Jeans,
Barrel Leg Pants, Shorts, Mini Skirts, Midi Skirts, Maxi Skirts,
Tiered Skirts, Wrap Skirts, Pleated Skirts, Satin Skirts, Denim Skirts,
Sweatshirts, Cropped Sweatshirts, Oversized Hoodies, Knit Pullovers,
Cardigans, Crochet Styles, Open Knit Styles, Quilted Jackets

MENSWEAR:
Linen Shirts, Oxford Shirts, Resort Shirts, Denim Shirts, Flannel Shirts,
Overshirts, Twill Shackets, Harrington Jackets, Bomber Jackets,
Lightweight Puffers, Denim Jackets, Graphic T-Shirts, Heavyweight T-Shirts,
Garment Dyed Tees, Relaxed Fit Tees, Vintage Wash Tees, Henley T-Shirts,
Polo T-Shirts, Knit Polos, Sweatshirts, Oversized Sweatshirts, Hoodies,
Zip Hoodies, Waffle Pullovers, Knitted Sweaters, Cardigans, Crewneck Knits,
Relaxed Fit Jeans, Straight Fit Jeans, Carpenter Jeans, Cargo Pants,
Utility Pants, Pleated Trousers, Linen Pants, Drawstring Pants, Chinos,
Chino Shorts, Cargo Shorts, Denim Shorts, Lounge Sets, Tracksuits,
Co-Ord Sets, Washed Cotton Programs, Garment Dyed Collections,
Yarn Dyed Checks, Stripe Programs, Textured Knitwear, Winter Fleece,
Resortwear, Organic Cotton Styles, Layering Essentials

HOME TEXTILES:
Bed Linen Sets, Duvet Covers, Pillow Covers, Fitted Sheets, Flat Sheets,
Organic Cotton Bedding, Linen Bedding, Washed Cotton Bedding,
Yarn Dyed Stripe Bedding, Textured Bedding, Muslin Quilts, Cotton Quilts,
Waffle Blankets, Napkins, Kitchen Textiles, Tea Towels, Aprons,
Bathrobes, Waffle Bathrobes, Scandinavian Home Collections,
Sustainable Home Textiles

KEY FABRICS:
Organic Cotton, GOTS Cotton, Muslin, Linen, Chambray, Denim,
Viscose, Recycled Polyester, Waffle Knit, Rib Knit, Jersey,
Flannel, Terry, Voile, Satin, Fleece

================================================================
IDEAL BUYER PROFILE — WHO WE WANT TO FIND
================================================================

PERFECT FIT:
- European fashion brands (Scandinavian, UK, German, French, Dutch, Belgian)
- Mid-market to affordable premium price positioning
- Sustainable / ethical / organic positioning
- Sourcing from India or Asia already (or open to it)
- Annual turnover: €5M to €500M (not too small, not luxury)
- Categories: womenswear, kidswear, babywear, menswear, home textiles
- Certifications required: GOTS, OEKO-TEX, FAIR TRADE (we have all)

KNOWN DANISH BRANDS ALREADY RESEARCHED (DO NOT search for these again):
DK Company, Kompagniet af 1991, ZIZZI, GANNI, INDICODE, Konges Sløjd,
UBANG, MOS MOSH, Fransa, Part Two, Samsøe Samsøe, b.young, Gestuz,
Second Female, Soft Rebels, Soaked in Luxury, KnowledgeCotton Apparel,
Saga Copenhagen, Done by Deer, BESTSELLER, Brands4kids, MSCH Copenhagen,
Rosemunde, Skall Studio, SAND Copenhagen

AVOID THESE TYPES:
- Ultra luxury brands (Gucci, Louis Vuitton level)
- Fast fashion with impossible compliance (Shein, Primark level)
- Micro brands (less than €2M turnover)
- Brands manufacturing only in Europe (Italy, Portugal focus)
- Accessories-only brands (shoes, bags only)
- Pure sportswear brands (Nike, Adidas level)

================================================================
SEARCH INTELLIGENCE RULES
================================================================

For each country, find:
1. Brands NOT yet in our database (avoid the Known Danish Brands list above)
2. Brands that source from India/Bangladesh/Asia
3. Brands with sustainability/organic focus
4. Department stores and multi-brand retailers
5. Buying houses and sourcing agents
6. Trade fair participants (CIFF Copenhagen, Premiere Vision, Pure London)
7. B2B wholesale platforms active in that country
8. Private label manufacturers looking for suppliers
9. Baby/kids specialist brands
10. Home textile brands (separate search)
`;

// ============================================================
// AGENT 1 — QUERY BUILDER (with CAG)
// ============================================================
async function buildSearchQueries(country) {
  console.log(`\n🔍 Agent 1 — Building targeted queries for: ${country}`);

  const prompt = `
${KISHOR_CAG}

TARGET COUNTRY: ${country}

Generate 20 highly specific Google search queries to find NEW fashion brands and buyers in ${country} for Kishor Exports.

IMPORTANT: Generate queries that will find companies we have NOT researched yet.
Focus on:
- Brands we don't know about yet
- Home textile buyers (separate category)
- Menswear buyers
- Baby/kids specialist brands
- Department stores and multi-brand retailers
- Buying agents and sourcing houses

Return ONLY valid JSON:
{
  "country": "${country}",
  "total_queries": 20,
  "queries": [
    {
      "id": 1,
      "category": "Sustainable Womenswear",
      "query": "sustainable womenswear brands ${country} organic cotton ethical sourcing",
      "intent": "Find eco-conscious womenswear brands that need ethical manufacturers"
    }
  ]
}
`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].text;
  const clean = raw.replace(/```json|```/g, "").trim();
  const result = JSON.parse(clean);

  console.log(`✅ Generated ${result.total_queries} queries for ${country}\n`);
  result.queries.forEach((q) => {
    console.log(`  [${q.id}] ${q.category}: ${q.query}`);
  });

  if (!fs.existsSync("./output")) fs.mkdirSync("./output");
  const outputPath = `./output/queries_${country.toLowerCase().replace(/\s/g, "_")}_${Date.now()}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Saved to: ${outputPath}`);

  return result;
}

const country = process.argv[2] || "Denmark";
buildSearchQueries(country).catch(console.error);

// agent3-enrichment.js — v7.0
// Step 1: Hunter Company Enrichment (FREE - 0 credits)
//         domain → company name, industry, size, country
// Step 2: Save companies to Supabase
// Step 3: Emails revealed manually from CRM (1 credit each)

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const HUNTER_BASE = "https://api.hunter.io/v2";

// ─── COMPANY DATABASE BY COUNTRY ─────────────────────────────────────────────

const COMPANIES = {
  denmark: [
    { name: "BESTSELLER",        domain: "bestseller.com" },
    { name: "Ganni",             domain: "ganni.com" },
    { name: "Samsoe Samsoe",     domain: "samsoe.com" },
    { name: "Les Deux",          domain: "lesdeux.com" },
    { name: "Gestuz",            domain: "gestuz.com" },
    { name: "Selected",          domain: "selected.com" },
    { name: "Jack Jones",        domain: "jackjones.com" },
    { name: "Vero Moda",         domain: "veromoda.com" },
    { name: "Only",              domain: "only.com" },
    { name: "Name It",           domain: "nameit.com" },
    { name: "Vila Clothes",      domain: "vila.com" },
    { name: "Bruuns Bazaar",     domain: "bruunsbazaar.com" },
    { name: "Stine Goya",        domain: "stinegoya.com" },
    { name: "By Malene Birger",  domain: "bymalenebirger.com" },
    { name: "Mads Norgaard",     domain: "madsnorgaard.com" },
    { name: "Rotate Birger",     domain: "rotatebirger.com" },
    { name: "Norse Projects",    domain: "norseprojects.com" },
    { name: "Wood Wood",         domain: "woodwood.com" },
    { name: "Soulland",          domain: "soulland.com" },
    { name: "Inwear",            domain: "inwear.com" },
    { name: "Part Two",          domain: "parttwo.com" },
    { name: "Fransa",            domain: "fransa.com" },
    { name: "Kaffe Fashion",     domain: "kaffefashion.com" },
    { name: "Cream Fashion",     domain: "creamfashion.com" },
    { name: "Ichi",              domain: "ichicph.com" },
    { name: "Noa Noa",           domain: "noa-noa.com" },
    { name: "Saint Tropez",      domain: "sainttropez.com" },
    { name: "Soaked in Luxury",  domain: "soakedInluxury.com" },
    { name: "Zizzi",             domain: "zizzi.dk" },
    { name: "Han Kjobenhavn",    domain: "hankjobenhavn.com" },
    { name: "Day Birger",        domain: "day.dk" },
    { name: "Holzweiler",        domain: "holzweiler.com" },
    { name: "Tiger of Sweden",   domain: "tigerofsweden.com" },
    { name: "Filippa K",         domain: "filippa-k.com" },
    { name: "b.young",           domain: "byoung.dk" },
    { name: "Noisy May",         domain: "noisymay.com" },
    { name: "Object",            domain: "object.dk" },
    { name: "Pieces",            domain: "pieces.com" },
    { name: "Remain Birger",     domain: "remaincph.com" },
    { name: "Stine Goya",        domain: "stinegoya.com" },
  ],

  germany: [
    { name: "Hugo Boss",         domain: "hugoboss.com" },
    { name: "Zalando",           domain: "zalando.com" },
    { name: "Esprit",            domain: "esprit.com" },
    { name: "s.Oliver",          domain: "soliver.com" },
    { name: "Tom Tailor",        domain: "tom-tailor.com" },
    { name: "Bogner",            domain: "bogner.com" },
    { name: "Marc O Polo",       domain: "marc-o-polo.com" },
    { name: "Closed",            domain: "closed.com" },
    { name: "Armedangels",       domain: "armedangels.com" },
    { name: "About You",         domain: "aboutyou.com" },
  ],

  sweden: [
    { name: "H&M",               domain: "hm.com" },
    { name: "Acne Studios",      domain: "acnestudios.com" },
    { name: "Weekday",           domain: "weekday.com" },
    { name: "Monki",             domain: "monki.com" },
    { name: "Arket",             domain: "arket.com" },
    { name: "Lindex",            domain: "lindex.com" },
    { name: "Kappahl",           domain: "kappahl.com" },
    { name: "Odd Molly",         domain: "oddmolly.com" },
    { name: "Bjorn Borg",        domain: "bjornborg.com" },
    { name: "Peak Performance",  domain: "peakperformance.com" },
  ],

  uk: [
    { name: "ASOS",              domain: "asos.com" },
    { name: "Marks Spencer",     domain: "marksandspencer.com" },
    { name: "Next",              domain: "next.co.uk" },
    { name: "Topshop",           domain: "topshop.com" },
    { name: "River Island",      domain: "riverisland.com" },
    { name: "Joules",            domain: "joules.com" },
    { name: "Fat Face",          domain: "fatface.com" },
    { name: "White Stuff",       domain: "whitestuff.com" },
    { name: "Boden",             domain: "boden.co.uk" },
    { name: "Crew Clothing",     domain: "crewclothing.co.uk" },
  ],

  france: [
    { name: "Sandro",            domain: "sandro-paris.com" },
    { name: "Maje",              domain: "maje.com" },
    { name: "Isabel Marant",     domain: "isabelmarant.com" },
    { name: "A.P.C",             domain: "apc.fr" },
    { name: "Jacquemus",         domain: "jacquemus.com" },
    { name: "Rouje",             domain: "rouje.com" },
    { name: "Balzac Paris",      domain: "balzac-paris.com" },
    { name: "Sessun",            domain: "sessun.com" },
    { name: "Ines de la Fressange", domain: "inesdelafressange.fr" },
    { name: "Ba&sh",             domain: "ba-sh.com" },
  ],

  netherlands: [
    { name: "G-Star Raw",        domain: "g-star.com" },
    { name: "Scotch Soda",       domain: "scotch-soda.com" },
    { name: "Mexx",              domain: "mexx.com" },
    { name: "America Today",     domain: "america-today.com" },
    { name: "Coolcat",           domain: "coolcat.com" },
    { name: "WE Fashion",        domain: "wefashion.com" },
    { name: "Costes Fashion",    domain: "costesfashion.com" },
    { name: "Fabienne Chapot",   domain: "fabiennechapot.com" },
    { name: "Shoeby",            domain: "shoeby.nl" },
    { name: "Vanilia",           domain: "vanilia.com" },
  ]
};

// ─── HUNTER COMPANY ENRICHMENT (FREE) ────────────────────────────────────────

async function enrichCompany(domain) {
  try {
    const params = new URLSearchParams({
      api_key: HUNTER_API_KEY,
      domain: domain
    });
    const res = await fetch(`${HUNTER_BASE}/companies/find?${params}`);
    const data = await res.json();
    if (data.errors) return null;
    return data.data || null;
  } catch(e) {
    return null;
  }
}

// ─── SAVE COMPANY TO SUPABASE ─────────────────────────────────────────────────

async function saveCompany(company, enriched, country) {
  try {
    const row = {
      company_name:  enriched?.name        || company.name,
      website:       company.domain,
      full_url:      "https://" + company.domain,
      category:      enriched?.industry    || "Fashion",
      industry:      enriched?.industry    || null,
      country:       country,
      company_size:  enriched?.size        || null,
      status:        "discovered",
      enriched:      true,
      created_at:    new Date().toISOString()
    };

    const { error } = await supabase
      .from("companies")
      .upsert(row, { onConflict: "website", ignoreDuplicates: true });

    if (error) {
      console.log(`  ⚠️  Save error for ${company.domain}: ${error.message}`);
      return false;
    }
    return true;
  } catch(e) {
    return false;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runAgent3() {
  console.log("============================================");
  console.log("AGENT 3 v7.0 — Hunter Company Loader");
  console.log("FREE mode — no credits used");
  console.log("Emails revealed per-contact from CRM");
  console.log("============================================\n");

  if (!HUNTER_API_KEY) { console.error("HUNTER_API_KEY not set!"); process.exit(1); }

  const country = (process.argv[2] || "denmark").toLowerCase();
  const companies = COMPANIES[country];

  if (!companies) {
    console.error(`No companies for country: ${country}`);
    console.log("Available: " + Object.keys(COMPANIES).join(", "));
    process.exit(1);
  }

  console.log(`Country: ${country}`);
  console.log(`Companies to process: ${companies.length}`);
  console.log(`Credits used: 0 (enrichment is free)\n`);

  let saved = 0;
  let failed = 0;

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    process.stdout.write(`[${i+1}/${companies.length}] ${company.name}... `);

    // Get free company data from Hunter
    const enriched = await enrichCompany(company.domain);

    if (enriched) {
      console.log(`✅ ${enriched.industry || "Fashion"} | ${enriched.size || "?"} employees`);
    } else {
      console.log(`(no enrichment data, saving with defaults)`);
    }

    const ok = await saveCompany(company, enriched, country);
    if (ok) saved++;
    else failed++;

    await sleep(500); // small delay
  }

  console.log("\n============================================");
  console.log("DONE!");
  console.log(`Companies saved: ${saved}`);
  console.log(`Failed: ${failed}`);
  console.log(`Credits used: 0`);
  console.log(`Next step: Open CRM → click any company → reveal buyer emails`);
  console.log("============================================\n");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

runAgent3().catch(err => { console.error("Fatal: " + err.message); process.exit(1); });

// hunter-scraper.js — v2.0
// Uses puppeteer with Render-compatible settings

const puppeteer = require("puppeteer");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HUNTER_EMAIL    = process.env.HUNTER_EMAIL;
const HUNTER_PASSWORD = process.env.HUNTER_PASSWORD;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const rand   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randMs = (min, max) => sleep(rand(min, max));

async function randomMouseMove(page) {
  for (let i = 0; i < rand(3, 6); i++) {
    await page.mouse.move(rand(100, 1200), rand(100, 700), { steps: rand(5, 15) });
    await sleep(rand(50, 150));
  }
}

async function humanType(page, selector, text) {
  await page.click(selector);
  await sleep(rand(200, 400));
  for (const char of text) {
    await page.type(selector, char, { delay: rand(60, 140) });
  }
}

async function launchBrowser() {
  const userAgent = USER_AGENTS[rand(0, USER_AGENTS.length - 1)];

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      `--user-agent=${userAgent}`,
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  const page = await browser.newPage();
  await page.setUserAgent(userAgent);

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
  });

  await page.setViewport({ width: rand(1280, 1920), height: rand(768, 1080) });
  return { browser, page };
}

async function loginHunter(page) {
  console.log("🔐 Logging into Hunter.io...");
  await page.goto("https://hunter.io/users/sign_in", { waitUntil: "networkidle2", timeout: 30000 });
  await randMs(2000, 4000);

  try {
    await humanType(page, 'input[type="email"]', HUNTER_EMAIL);
    await randMs(500, 1000);
    await humanType(page, 'input[type="password"]', HUNTER_PASSWORD);
    await randMs(500, 1000);
    await randomMouseMove(page);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });
    await randMs(2000, 3000);

    const url = page.url();
    if (url.includes("sign_in")) throw new Error("Login failed");
    console.log("✅ Logged in!");
  } catch(e) {
    throw new Error("Login failed: " + e.message);
  }
}

async function scrapeDomainPage(page, domain) {
  console.log(`  👥 Scraping ${domain}...`);
  await page.goto(`https://hunter.io/domain-search?domain=${domain}`, {
    waitUntil: "networkidle2",
    timeout: 30000
  });
  await randMs(3000, 6000);
  await randomMouseMove(page);

  // Wait for email results
  try {
    await page.waitForSelector(".email-list, .emails-list, [class*='email']", { timeout: 8000 });
  } catch(e) {
    console.log(`  (no results for ${domain})`);
    return [];
  }

  // Scroll to load more
  await page.evaluate(() => window.scrollBy(0, 500));
  await randMs(1000, 2000);

  // Take screenshot for debugging
  // await page.screenshot({ path: `/tmp/${domain}.png` });

  const people = await page.evaluate(() => {
    const results = [];

    // Try multiple possible selectors
    const rows = document.querySelectorAll(
      '.email-item, .person-item, [data-email], .result-item, ' +
      '.emails-list li, .email-list li, .lead-item'
    );

    rows.forEach(row => {
      const firstName = row.querySelector('[class*="first"], [data-first]')?.textContent?.trim() || "";
      const lastName  = row.querySelector('[class*="last"], [data-last]')?.textContent?.trim() || "";
      const email     = row.querySelector('[class*="email"] a, [class*="email"] span, .value')?.textContent?.trim() ||
                        row.getAttribute("data-email") || "";
      const position  = row.querySelector('[class*="position"], [class*="title"], [class*="job"]')?.textContent?.trim() || "";
      const linkedin  = row.querySelector('a[href*="linkedin"]')?.href || "";

      if (email && email.includes("@")) {
        results.push({ firstName, lastName, email, position, linkedin });
      }
    });

    return results;
  });

  console.log(`  Found ${people.length} people`);
  return people;
}

async function saveToSupabase(company, people, country) {
  // Save company
  await supabase.from("companies").upsert({
    company_name: company.name || company.domain,
    website:      company.domain,
    full_url:     "https://" + company.domain,
    category:     "Fashion",
    country,
    status:       "discovered",
    enriched:     true,
    created_at:   new Date().toISOString()
  }, { onConflict: "website", ignoreDuplicates: true });

  // Save people
  let saved = 0;
  for (const p of people) {
    try {
      const row = {
        company_name:    company.name,
        company_website: company.domain,
        contact_name:    `${p.firstName} ${p.lastName}`.trim() || p.email.split("@")[0],
        first_name:      p.firstName || null,
        last_name:       p.lastName  || null,
        job_title:       p.position  || null,
        email_1:         p.email     || null,
        email_revealed:  true,
        linkedin_url:    p.linkedin  || null,
        country,
        source:          "hunter_scraper",
        status:          "new",
        created_at:      new Date().toISOString()
      };
      if (row.email_1) {
        await supabase.from("contacts").upsert(row, { onConflict: "email_1", ignoreDuplicates: true });
        saved++;
      }
    } catch(e) { /* skip */ }
  }
  return saved;
}

// Hardcoded companies by country
const COMPANIES = {
  denmark: [
    { name: "BESTSELLER",       domain: "bestseller.com" },
    { name: "Samsoe Samsoe",    domain: "samsoe.com" },
    { name: "Les Deux",         domain: "lesdeux.com" },
    { name: "Gestuz",           domain: "gestuz.com" },
    { name: "Bruuns Bazaar",    domain: "bruunsbazaar.com" },
    { name: "By Malene Birger", domain: "bymalenebirger.com" },
    { name: "Norse Projects",   domain: "norseprojects.com" },
    { name: "Wood Wood",        domain: "woodwood.com" },
    { name: "Day Birger",       domain: "day.dk" },
    { name: "Rotate Birger",    domain: "rotatebirger.com" },
  ],
  germany: [
    { name: "Hugo Boss",        domain: "hugoboss.com" },
    { name: "Armedangels",      domain: "armedangels.com" },
    { name: "Marc O Polo",      domain: "marc-o-polo.com" },
    { name: "Tom Tailor",       domain: "tom-tailor.com" },
    { name: "Gerry Weber",      domain: "gerryweber.com" },
  ],
  sweden: [
    { name: "H&M",              domain: "hm.com" },
    { name: "Acne Studios",     domain: "acnestudios.com" },
    { name: "Tiger of Sweden",  domain: "tigerofsweden.com" },
    { name: "Filippa K",        domain: "filippa-k.com" },
    { name: "Nudie Jeans",      domain: "nudiejeans.com" },
  ],
};

async function runScraper() {
  console.log("============================================");
  console.log("HUNTER SCRAPER v2.0 — Puppeteer");
  console.log("Zero credits used — UI automation");
  console.log("============================================\n");

  if (!HUNTER_EMAIL || !HUNTER_PASSWORD) {
    console.error("❌ HUNTER_EMAIL or HUNTER_PASSWORD not set!");
    process.exit(1);
  }

  const country   = (process.argv[2] || "denmark").toLowerCase();
  const companies = COMPANIES[country] || COMPANIES.denmark;

  console.log(`Country: ${country}`);
  console.log(`Companies: ${companies.length}\n`);

  let { browser, page } = await launchBrowser();
  let totalCompanies = 0;
  let totalContacts  = 0;

  try {
    await loginHunter(page);

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      console.log(`\n[${i+1}/${companies.length}] ${company.name}`);

      // Random human-like delay between companies
      if (i > 0) await randMs(8000, 20000);

      const people = await scrapeDomainPage(page, company.domain);
      const saved  = await saveToSupabase(company, people, country);

      totalCompanies++;
      totalContacts += saved;
      console.log(`  ✅ Saved ${saved} contacts`);

      // Safety limit
      if (i >= 9) {
        console.log("\n⚠️  Session limit (10). Stopping safely.");
        break;
      }
    }
  } catch(e) {
    console.error("Scraper error:", e.message);
  } finally {
    await browser.close();
  }

  console.log("\n============================================");
  console.log(`Companies: ${totalCompanies} | Contacts: ${totalContacts}`);
  console.log("Credits used: 0");
  console.log("============================================\n");
}

runScraper().catch(console.error);

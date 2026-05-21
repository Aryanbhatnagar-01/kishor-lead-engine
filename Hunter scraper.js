// hunter-scraper.js — Puppeteer Hunter UI Scraper
// Logs into Hunter.io, searches companies, scrapes people data
// Anti-detection: random delays, mouse movements, user agent rotation
// Run: node hunter-scraper.js "denmark" "fashion"

const puppeteer = require("puppeteer");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HUNTER_EMAIL    = process.env.HUNTER_EMAIL;
const HUNTER_PASSWORD = process.env.HUNTER_PASSWORD;

// ─── ANTI DETECTION CONFIG ───────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

// ─── UTILS ───────────────────────────────────────────────────────────────────

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const rand   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randMs = (min, max) => sleep(rand(min, max));

// Random mouse movement to simulate human
async function randomMouseMove(page) {
  const moves = rand(3, 8);
  for (let i = 0; i < moves; i++) {
    await page.mouse.move(rand(100, 1200), rand(100, 700), { steps: rand(5, 15) });
    await sleep(rand(50, 200));
  }
}

// Human-like typing
async function humanType(page, selector, text) {
  await page.click(selector);
  await sleep(rand(200, 500));
  for (const char of text) {
    await page.type(selector, char, { delay: rand(50, 150) });
  }
}

// ─── LAUNCH BROWSER ───────────────────────────────────────────────────────────

async function launchBrowser() {
  const userAgent = USER_AGENTS[rand(0, USER_AGENTS.length - 1)];

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-agent=${userAgent}`,
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(userAgent);

  // Hide puppeteer fingerprints
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = { runtime: {} };
  });

  await page.setViewport({
    width:  rand(1280, 1920),
    height: rand(768, 1080),
    deviceScaleFactor: 1,
  });

  return { browser, page };
}

// ─── LOGIN TO HUNTER ─────────────────────────────────────────────────────────

async function loginHunter(page) {
  console.log("🔐 Logging into Hunter.io...");

  await page.goto("https://hunter.io/users/sign_in", { waitUntil: "networkidle2" });
  await randMs(1500, 3000);
  await randomMouseMove(page);

  // Type email
  await humanType(page, 'input[name="email"], input[type="email"]', HUNTER_EMAIL);
  await randMs(500, 1200);

  // Type password
  await humanType(page, 'input[name="password"], input[type="password"]', HUNTER_PASSWORD);
  await randMs(800, 1500);

  await randomMouseMove(page);

  // Click login
  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
  await randMs(2000, 4000);

  const url = page.url();
  if (url.includes("sign_in")) {
    throw new Error("Login failed — check HUNTER_EMAIL and HUNTER_PASSWORD");
  }

  console.log("✅ Logged in successfully!");
}

// ─── SCRAPE DISCOVER PAGE ─────────────────────────────────────────────────────

async function scrapeDiscover(page, country, keyword) {
  console.log(`\n🔍 Searching: ${country} + ${keyword}`);

  // Build URL exactly like Hunter UI
  const countryCode = { denmark: "DK", germany: "DE", uk: "GB", sweden: "SE", france: "FR", netherlands: "NL" }[country.toLowerCase()] || "DK";
  const url = `https://hunter.io/discover?location_country_included[]=${countryCode}&q=${encodeURIComponent(keyword)}`;

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await randMs(3000, 6000);
  await randomMouseMove(page);

  // Wait for results
  try {
    await page.waitForSelector(".company-name, [data-company], .discover-company", { timeout: 10000 });
  } catch(e) {
    console.log("  ⚠️  No results found or page structure changed");
    return [];
  }

  // Scrape company list
  const companies = await page.evaluate(() => {
    const items = document.querySelectorAll(".discover-company-item, .company-row, [data-domain]");
    return Array.from(items).slice(0, 20).map(item => ({
      name:   item.querySelector(".company-name, h3, .name")?.textContent?.trim() || "",
      domain: item.getAttribute("data-domain") || item.querySelector("[data-domain]")?.getAttribute("data-domain") || "",
      industry: item.querySelector(".industry, .category")?.textContent?.trim() || "",
    })).filter(c => c.domain);
  });

  console.log(`  Found ${companies.length} companies`);
  return companies;
}

// ─── SCRAPE DOMAIN PAGE (people data) ────────────────────────────────────────

async function scrapeDomainPeople(page, domain) {
  console.log(`  👥 Scraping people at ${domain}...`);

  await page.goto(`https://hunter.io/domain-search?domain=${domain}`, { waitUntil: "networkidle2", timeout: 30000 });
  await randMs(2000, 5000);
  await randomMouseMove(page);

  // Scroll to load more
  await page.evaluate(() => window.scrollBy(0, rand(300, 600)));
  await randMs(1000, 2000);

  // Scrape people
  const people = await page.evaluate(() => {
    const rows = document.querySelectorAll(".email-row, .person-row, [data-email], .result");
    return Array.from(rows).slice(0, 15).map(row => ({
      firstName: row.querySelector(".first-name, [data-first-name]")?.textContent?.trim() ||
                 row.getAttribute("data-first-name") || "",
      lastName:  row.querySelector(".last-name, [data-last-name]")?.textContent?.trim() ||
                 row.getAttribute("data-last-name") || "",
      title:     row.querySelector(".position, .title, .job-title")?.textContent?.trim() || "",
      email:     row.querySelector(".email-value, .email, [data-email]")?.textContent?.trim() ||
                 row.getAttribute("data-email") || "",
      linkedin:  row.querySelector('a[href*="linkedin"]')?.getAttribute("href") || "",
    })).filter(p => p.firstName || p.email);
  });

  console.log(`  Found ${people.length} people`);
  return people;
}

// ─── SAVE TO SUPABASE ─────────────────────────────────────────────────────────

async function saveToSupabase(company, people, country) {
  // Save company
  if (company.domain) {
    await supabase.from("companies").upsert({
      company_name: company.name || company.domain,
      website:      company.domain,
      full_url:     "https://" + company.domain,
      category:     company.industry || "Fashion",
      country,
      status:       "discovered",
      enriched:     true,
      created_at:   new Date().toISOString()
    }, { onConflict: "website", ignoreDuplicates: true });
  }

  // Save people
  let saved = 0;
  for (const p of people) {
    try {
      const row = {
        company_name:    company.name,
        company_website: company.domain,
        contact_name:    `${p.firstName} ${p.lastName}`.trim(),
        first_name:      p.firstName || null,
        last_name:       p.lastName  || null,
        job_title:       p.title     || null,
        email_1:         p.email     || null,
        email_revealed:  !!p.email,
        linkedin_url:    p.linkedin  || null,
        country,
        source:          "hunter_scraper",
        status:          "new",
        created_at:      new Date().toISOString()
      };

      if (row.email_1) {
        await supabase.from("contacts").upsert(row, { onConflict: "email_1", ignoreDuplicates: true });
      } else {
        await supabase.from("contacts").insert(row);
      }
      saved++;
    } catch(e) { /* skip */ }
  }
  return saved;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runScraper() {
  console.log("============================================");
  console.log("HUNTER SCRAPER — Puppeteer UI Automation");
  console.log("Anti-detection: ✅ Random delays");
  console.log("Anti-detection: ✅ Human mouse movements");
  console.log("Anti-detection: ✅ Rotating user agents");
  console.log("Anti-detection: ✅ Max 10 searches/session");
  console.log("============================================\n");

  if (!HUNTER_EMAIL || !HUNTER_PASSWORD) {
    console.error("Set HUNTER_EMAIL and HUNTER_PASSWORD in environment!");
    process.exit(1);
  }

  const country  = process.argv[2] || "denmark";
  const keywords = ["fashion", "apparel", "clothing", "textile"];
  const maxCompaniesPerKeyword = 5; // safe limit per session

  let { browser, page } = await launchBrowser();

  try {
    // Login
    await loginHunter(page);

    let totalCompanies = 0;
    let totalContacts  = 0;
    const processedDomains = new Set();

    for (const keyword of keywords) {
      // Random long break between keywords (looks human)
      await randMs(5000, 12000);
      await randomMouseMove(page);

      const companies = await scrapeDiscover(page, country, keyword);

      for (let i = 0; i < Math.min(companies.length, maxCompaniesPerKeyword); i++) {
        const company = companies[i];
        if (!company.domain || processedDomains.has(company.domain)) continue;
        processedDomains.add(company.domain);

        // Random delay between company visits (KEY anti-detection)
        await randMs(8000, 20000);
        await randomMouseMove(page);

        const people = await scrapeDomainPeople(page, company.domain);
        const saved  = await saveToSupabase(company, people, country);

        totalCompanies++;
        totalContacts += saved;

        console.log(`  ✅ ${company.name}: ${saved} contacts saved`);

        // Safety: max 10 domains per session
        if (processedDomains.size >= 10) {
          console.log("\n⚠️  Session limit reached (10 domains). Stopping safely.");
          break;
        }
      }

      if (processedDomains.size >= 10) break;
    }

    console.log("\n============================================");
    console.log(`Companies saved: ${totalCompanies}`);
    console.log(`Contacts saved:  ${totalContacts}`);
    console.log(`Credits used:    0 (UI scraping)`);
    console.log("============================================\n");

  } catch(e) {
    console.error("Scraper error:", e.message);
  } finally {
    await browser.close();
  }
}

// Random function available in page context
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

runScraper().catch(console.error);

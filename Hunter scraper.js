// hunter-scraper.js — v3.0 PLAYWRIGHT
// Uses Playwright instead of Puppeteer (works on Render free tier)

const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HUNTER_EMAIL    = process.env.HUNTER_EMAIL;
const HUNTER_PASSWORD = process.env.HUNTER_PASSWORD;

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const rand   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randMs = (min, max) => sleep(rand(min, max));

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
    { name: "Tiger of Sweden",  domain: "tigerofsweden.com" },
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
    { name: "Filippa K",        domain: "filippa-k.com" },
    { name: "Nudie Jeans",      domain: "nudiejeans.com" },
    { name: "Toteme",           domain: "toteme-studio.com" },
  ],
};

async function runScraper() {
  console.log("============================================");
  console.log("HUNTER SCRAPER v3.0 — Playwright");
  console.log("Zero credits — UI automation");
  console.log("============================================\n");

  if (!HUNTER_EMAIL || !HUNTER_PASSWORD) {
    console.error("❌ HUNTER_EMAIL or HUNTER_PASSWORD not set!");
    process.exit(1);
  }

  const country   = (process.argv[2] || "denmark").toLowerCase();
  const companies = COMPANIES[country] || COMPANIES.denmark;

  console.log(`Country: ${country} | Companies: ${companies.length}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport:  { width: 1366, height: 768 },
  });

  // Hide automation
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();
  let totalCompanies = 0;
  let totalContacts  = 0;

  try {
    // ── LOGIN ──────────────────────────────────────────────────────────────
    console.log("🔐 Logging into Hunter.io...");
    await page.goto("https://hunter.io/users/sign_in", { waitUntil: "networkidle" });
    await randMs(2000, 3000);

    await page.fill('input[type="email"]',    HUNTER_EMAIL);
    await randMs(300, 700);
    await page.fill('input[type="password"]', HUNTER_PASSWORD);
    await randMs(300, 700);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard**", { timeout: 15000 });
    await randMs(2000, 3000);
    console.log("✅ Logged in!\n");

    // ── SCRAPE EACH COMPANY ────────────────────────────────────────────────
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      console.log(`[${i+1}/${companies.length}] ${company.name} (${company.domain})`);

      if (i > 0) await randMs(8000, 15000); // human delay

      try {
        await page.goto(`https://hunter.io/domain-search?domain=${company.domain}`, {
          waitUntil: "networkidle",
          timeout:   30000
        });
        await randMs(3000, 5000);

        // Scroll down to load results
        await page.evaluate(() => window.scrollBy(0, 400));
        await randMs(1500, 2500);

        // Scrape people data
        const people = await page.evaluate(() => {
          const results = [];
          // Hunter's email list items
          const items = document.querySelectorAll(
            '.email-item, [class*="EmailItem"], [class*="email-row"], ' +
            '.emails-list > li, .results-list > li, [data-email]'
          );

          items.forEach(item => {
            const emailEl = item.querySelector(
              '[class*="email"] .value, [class*="EmailValue"], ' +
              '.email-address, [data-email], a[href^="mailto"]'
            );
            const email = emailEl?.textContent?.trim() ||
                          item.getAttribute("data-email") ||
                          emailEl?.href?.replace("mailto:", "") || "";

            if (!email || !email.includes("@")) return;

            const nameEl     = item.querySelector('[class*="name"], [class*="Name"]');
            const positionEl = item.querySelector('[class*="position"], [class*="Position"], [class*="title"]');
            const linkedinEl = item.querySelector('a[href*="linkedin.com"]');

            const fullName = nameEl?.textContent?.trim() || "";
            const [firstName, ...rest] = fullName.split(" ");

            results.push({
              firstName: firstName || "",
              lastName:  rest.join(" ") || "",
              email,
              position:  positionEl?.textContent?.trim() || "",
              linkedin:  linkedinEl?.href || "",
            });
          });

          return results;
        });

        console.log(`  Found ${people.length} people`);
        people.slice(0, 3).forEach(p =>
          console.log(`  → ${p.firstName} ${p.lastName} | ${p.position} | ${p.email}`)
        );

        // Save to Supabase
        await supabase.from("companies").upsert({
          company_name: company.name,
          website:      company.domain,
          full_url:     "https://" + company.domain,
          category:     "Fashion",
          country,
          status:       "discovered",
          enriched:     true,
          created_at:   new Date().toISOString()
        }, { onConflict: "website", ignoreDuplicates: true });

        totalCompanies++;

        for (const p of people) {
          if (!p.email) continue;
          try {
            await supabase.from("contacts").upsert({
              company_name:    company.name,
              company_website: company.domain,
              contact_name:    `${p.firstName} ${p.lastName}`.trim() || p.email.split("@")[0],
              first_name:      p.firstName || null,
              last_name:       p.lastName  || null,
              job_title:       p.position  || null,
              email_1:         p.email,
              email_revealed:  true,
              linkedin_url:    p.linkedin  || null,
              country,
              source:          "hunter_scraper",
              status:          "new",
              created_at:      new Date().toISOString()
            }, { onConflict: "email_1", ignoreDuplicates: true });
            totalContacts++;
          } catch(e) { /* skip */ }
        }

        console.log(`  ✅ Saved ${people.length} contacts`);

      } catch(e) {
        console.log(`  ❌ Error: ${e.message}`);
      }

      if (i >= 9) { console.log("\n⚠️  Session limit reached."); break; }
    }

  } catch(e) {
    console.error("Fatal error:", e.message);
  } finally {
    await browser.close();
  }

  console.log("\n============================================");
  console.log(`Companies: ${totalCompanies} | Contacts: ${totalContacts}`);
  console.log("Credits used: 0 ✅");
  console.log("============================================\n");
}

runScraper().catch(console.error);

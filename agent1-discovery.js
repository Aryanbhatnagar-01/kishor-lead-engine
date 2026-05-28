/**
 * Kishor Lead Engine — Agent 1: Company Discovery
 * Finds companies by country using Apollo + Google Custom Search
 * Saves to Supabase companies table
 */

const axios = require('axios');
require('dotenv').config();

const APOLLO_KEY   = process.env.APOLLO_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;

// Country → Apollo geo codes for company HQ filter
const COUNTRY_GEO = {
  'denmark':     '104514075',
  'germany':     '101282230',
  'sweden':      '105117694',
  'norway':      '103819153',
  'netherlands': '102890719',
  'france':      '105015875',
  'uk':          '101165590',
  'usa':         '103644278',
  'italy':       '103350119',
  'spain':       '105646813',
};

// Apollo industry IDs for apparel/fashion
const INDUSTRY_IDS = [
  'retail_apparel_and_fashion',
  'apparel_and_fashion',
  'textiles',
  'wholesale',
  'luxury_goods_and_jewelry',
  'consumer_goods',
];

const SUPABASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
};

function log(msg) { console.log(`[Agent1] ${msg}`); }

// ── SUPABASE UPSERT ────────────────────────────────────────────────────────
async function upsertCompany(company) {
  try {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/companies`,
      company,
      {
        headers: { ...SUPABASE_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
        params: { on_conflict: 'website_url' }
      }
    );
    return true;
  } catch (e) {
    // Try insert without conflict key if website_url is null
    try {
      await axios.post(`${SUPABASE_URL}/rest/v1/companies`, company, {
        headers: { ...SUPABASE_HEADERS, Prefer: 'return=minimal' }
      });
      return true;
    } catch { return false; }
  }
}

// ── APOLLO COMPANY SEARCH ──────────────────────────────────────────────────
async function searchApolloCompanies(country, page = 1) {
  const geoId = COUNTRY_GEO[country.toLowerCase()];
  if (!geoId) { log(`No geo ID for ${country}`); return []; }

  try {
    const body = {
      per_page: 100,
      page,
      organization_locations: [country],
    };
    if (geoId) body.organization_hq_location_ids = [geoId];

    const r = await axios.post(
      'https://api.apollo.io/api/v1/mixed_companies/search',
      body,
      { headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_KEY } }
    );

    const orgs = r.data?.organizations || [];
    log(`Apollo page ${page}: ${orgs.length} companies for ${country}`);
    return orgs;
  } catch (e) {
    log(`Apollo company search error: ${e.response?.data?.message || e.message}`);
    return [];
  }
}

// ── GOOGLE CUSTOM SEARCH ───────────────────────────────────────────────────
async function searchGoogleCompanies(country, keyword = 'apparel brand') {
  const GOOGLE_KEY = process.env.GOOGLE_SEARCH_KEY;
  const GOOGLE_CX  = process.env.GOOGLE_SEARCH_CX;
  if (!GOOGLE_KEY || !GOOGLE_CX) {
    log('No Google Search key — skipping Google source');
    return [];
  }

  const queries = [
    `${keyword} ${country} clothing brand importer`,
    `fashion brand ${country} wholesale apparel`,
    `home textile company ${country} importer`,
    `baby wear brand ${country}`,
  ];

  const results = [];
  for (const q of queries) {
    try {
      const r = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: { key: GOOGLE_KEY, cx: GOOGLE_CX, q, num: 10 }
      });
      for (const item of r.data?.items || []) {
        results.push({
          company_name: item.title?.replace(/ [-|–].*$/, '').trim(),
          website_url:  item.link,
          country,
          source: 'google',
        });
      }
      await sleep(500);
    } catch (e) {
      log(`Google search error: ${e.message}`);
    }
  }
  log(`Google: found ${results.length} companies for ${country}`);
  return results;
}

// ── DUCKDUCKGO SEARCH (no API key needed) ─────────────────────────────────
async function searchDuckDuckGo(country) {
  const queries = [
    `apparel brand ${country} clothing importer site:linkedin.com/company`,
    `fashion wholesale ${country} buyer sourcing`,
    `home textile company ${country} importer`,
  ];

  const results = [];
  for (const q of queries) {
    try {
      const r = await axios.get('https://api.duckduckgo.com/', {
        params: { q, format: 'json', no_html: 1, skip_disambig: 1 },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
      });

      const related = r.data?.RelatedTopics || [];
      for (const topic of related.slice(0, 10)) {
        if (topic.FirstURL && topic.Text) {
          results.push({
            company_name: topic.Text?.split(' - ')[0]?.trim(),
            website_url:  topic.FirstURL,
            country,
            source: 'duckduckgo',
          });
        }
      }
      await sleep(1000);
    } catch (e) {
      log(`DuckDuckGo error: ${e.message}`);
    }
  }
  log(`DuckDuckGo: found ${results.length} results for ${country}`);
  return results;
}

// ── TRADE SHOW SCRAPER ─────────────────────────────────────────────────────
// Returns known exhibitor list URLs per country product focus
function getTradeShowUrls(country) {
  const c = country.toLowerCase();
  const shows = [];

  if (['germany', 'all'].includes(c)) {
    shows.push(
      { name: 'Kind+Jugend 2025', url: 'https://www.kindundjugend.com/en/exhibitor-list', country: 'Germany', focus: 'Baby clothing' },
      { name: 'Heimtextil 2025', url: 'https://heimtextil.messefrankfurt.com/frankfurt/en/exhibitors.html', country: 'Germany', focus: 'Home textiles' },
    );
  }
  if (['france', 'all'].includes(c)) {
    shows.push(
      { name: 'Texworld Paris 2025', url: 'https://www.texworld.com/paris/en/exhibitors.html', country: 'France', focus: 'Garments' },
    );
  }
  if (['usa', 'all'].includes(c)) {
    shows.push(
      { name: 'MAGIC Las Vegas', url: 'https://www.ubmfashion.com/shows/magic', country: 'USA', focus: 'Apparel' },
    );
  }
  if (['denmark', 'all'].includes(c)) {
    shows.push(
      { name: 'Copenhagen Fashion Week', url: 'https://copenhagenfashionweek.com/brands/', country: 'Denmark', focus: 'Apparel' },
    );
  }
  if (['uk', 'all'].includes(c)) {
    shows.push(
      { name: 'Pure London', url: 'https://www.purelondon.com/exhibitors', country: 'UK', focus: 'Apparel' },
    );
  }

  return shows;
}

async function scrapeTradeShowCompanies(country) {
  const shows = getTradeShowUrls(country);
  if (!shows.length) return [];

  const results = [];
  for (const show of shows) {
    log(`Trade show: ${show.name}`);
    try {
      const r = await axios.get(show.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
      });
      // Extract company names from HTML — basic link text extraction
      const html = r.data;
      const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]{3,60})<\/a>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const text = match[2].trim().replace(/\s+/g, ' ');
        const href = match[1];
        if (text.length > 3 && text.length < 60 && !text.includes('{') && !href.includes('#')) {
          results.push({
            company_name:    text,
            website_url:     href.startsWith('http') ? href : null,
            country:         show.country,
            source:          'trade_show',
            event_name:      show.name,
            is_event_company: true,
            product_focus:   show.focus,
          });
        }
      }
      await sleep(1500);
    } catch (e) {
      log(`Trade show scrape failed for ${show.name}: ${e.message}`);
    }
  }
  log(`Trade shows: found ${results.length} companies for ${country}`);
  return results;
}

// ── NORMALIZE & SAVE ───────────────────────────────────────────────────────
function normalizeApolloCompany(org, country) {
  let website = org.website_url || org.primary_domain;
  if (website && !website.startsWith('http')) website = 'https://' + website;

  return {
    company_name:     org.name,
    website_url:      website || null,
    linkedin_url:     org.linkedin_url || null,
    country:          country,
    industry:         org.industry || null,
    company_size:     org.employee_count ? String(org.employee_count) : (org.estimated_num_employees ? String(org.estimated_num_employees) : null),
    source:           'apollo',
    is_event_company: false,
    match_score:      null,
    created_at:       new Date().toISOString(),
  };
}

function normalizeGenericCompany(raw) {
  return {
    company_name:     raw.company_name || 'Unknown',
    website_url:      raw.website_url  || null,
    linkedin_url:     raw.linkedin_url || null,
    country:          raw.country      || 'Unknown',
    industry:         raw.industry     || null,
    company_size:     null,
    source:           raw.source       || 'unknown',
    is_event_company: raw.is_event_company || false,
    event_name:       raw.event_name   || null,
    match_score:      null,
    created_at:       new Date().toISOString(),
  };
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function runAgent1(country, options = {}) {
  const { maxPages = 3, onProgress } = options;
  const progress = (msg) => { log(msg); if (onProgress) onProgress(msg); };

  progress(`Starting Agent 1 for country: ${country}`);
  let totalSaved = 0;

  // 1. Apollo companies
  progress('Searching Apollo.io for companies...');
  for (let page = 1; page <= maxPages; page++) {
    const orgs = await searchApolloCompanies(country, page);
    if (!orgs.length) break;

    for (const org of orgs) {
      const company = normalizeApolloCompany(org, country);
      if (!company.company_name) continue;
      const saved = await upsertCompany(company);
      if (saved) totalSaved++;
    }

    progress(`Apollo: saved ${totalSaved} companies so far (page ${page}/${maxPages})`);
    if (orgs.length < 100) break;
    await sleep(1000);
  }

  // 2. Google search
  progress('Searching Google for companies...');
  const googleCompanies = await searchGoogleCompanies(country);
  for (const raw of googleCompanies) {
    if (!raw.company_name || raw.company_name.length < 3) continue;
    const company = normalizeGenericCompany(raw);
    const saved = await upsertCompany(company);
    if (saved) totalSaved++;
  }
  progress(`Google: total saved now ${totalSaved}`);

  // 3. DuckDuckGo
  progress('Searching DuckDuckGo for companies...');
  const ddgCompanies = await searchDuckDuckGo(country);
  for (const raw of ddgCompanies) {
    if (!raw.company_name || raw.company_name.length < 3) continue;
    const company = normalizeGenericCompany(raw);
    const saved = await upsertCompany(company);
    if (saved) totalSaved++;
  }
  progress(`DuckDuckGo: total saved now ${totalSaved}`);

  // 4. Trade shows
  progress('Scraping trade show exhibitor lists...');
  const showCompanies = await scrapeTradeShowCompanies(country);
  for (const raw of showCompanies) {
    if (!raw.company_name || raw.company_name.length < 3) continue;
    const company = normalizeGenericCompany(raw);
    const saved = await upsertCompany(company);
    if (saved) totalSaved++;
  }
  progress(`Trade shows: total saved now ${totalSaved}`);

  progress(`Agent 1 complete. Total companies saved: ${totalSaved}`);
  return { totalSaved };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runAgent1 };

if (require.main === module) {
  const country = process.argv[2] || 'Denmark';
  runAgent1(country, { maxPages: 2, onProgress: console.log })
    .then(r => { console.log('Done:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

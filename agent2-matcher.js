/**
 * Kishor Lead Engine — Agent 2: Website AI Matcher
 * Visits each company website, extracts text, asks Gemini to score match 0-100%
 * Updates companies table with match_score + match_reason
 */

const axios = require('axios');
require('dotenv').config();

const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SUPABASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const KISHOR_PRODUCTS = `
Kishor Export manufactures and exports:
- Shirts (formal, casual, linen, cotton)
- T-shirts and tops
- Baby clothing and kids wear
- Home textiles: bedding sets, duvet covers, pillowcases, cushion covers, curtains, towels, bath mats
- Soft toys and stuffed animals
- Garments and apparel in general
- Products are manufactured in India, exported to Europe and USA
- We are a B2B supplier — we sell to brands and retailers, not direct to consumers
`;

function log(msg) { console.log(`[Agent2] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── FETCH WEBSITE TEXT ─────────────────────────────────────────────────────
async function fetchWebsiteText(url) {
  if (!url) return null;
  if (!url.startsWith('http')) url = 'https://' + url;

  try {
    const r = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
    });

    const html = r.data || '';

    // Strip scripts, styles, nav, footer
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Return first 3000 chars — enough for Gemini to assess
    return cleaned.substring(0, 3000);
  } catch (e) {
    log(`Fetch failed for ${url}: ${e.message}`);
    return null;
  }
}

// Also try /products or /shop or /about pages for more signal
async function fetchExtraPages(baseUrl) {
  const paths = ['/products', '/shop', '/collections', '/about', '/about-us', '/what-we-do'];
  const texts = [];

  for (const path of paths.slice(0, 2)) {
    try {
      const url = baseUrl.replace(/\/$/, '') + path;
      const r = await axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxRedirects: 3,
      });
      const text = (r.data || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1500);
      if (text.length > 100) texts.push(text);
      await sleep(500);
    } catch { /* skip */ }
  }
  return texts.join(' ').substring(0, 2000);
}

// ── GEMINI SCORER ──────────────────────────────────────────────────────────
async function scoreWithGemini(companyName, websiteText) {
  if (!websiteText || websiteText.length < 50) {
    return { score: 0, reason: 'Website not accessible or empty', reliable: false };
  }

  const prompt = `You are a B2B supplier matching expert. Kishor Export is an Indian manufacturer looking for European/US brands that BUY apparel, home textiles, soft toys, or baby clothing.

KISHOR EXPORT PRODUCTS:
${KISHOR_PRODUCTS}

COMPANY: ${companyName}
WEBSITE TEXT (first 3000 chars):
${websiteText}

TASK: Analyze if this company is a potential BUYER for Kishor Export products.

Score the match 0-100% where:
- 80-100%: Company clearly sells/imports apparel, clothing, home textiles, baby wear, or soft toys. They source from Asia/India. Perfect target.
- 50-79%: Company partially matches — sells some relevant products or is in adjacent space.
- 20-49%: Weak match — tangentially related.
- 0-19%: Not a match — manufactures locally, completely different industry, or website unclear.

REJECT if: company manufactures their own products locally, is a tech company, restaurant, service business, or completely unrelated industry.

Respond in this EXACT JSON format only, no other text:
{"score": 75, "reason": "Fashion retailer selling apparel and home goods, likely sources from Asia", "category": "apparel", "reliable": true}

If website is unclear/broken: {"score": 0, "reason": "Website inaccessible or unclear", "reliable": false}`;

  try {
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      },
      { timeout: 15000 }
    );

    const raw = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { score: 0, reason: 'Gemini parse error', reliable: false };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score:    Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      reason:   parsed.reason || '',
      category: parsed.category || null,
      reliable: parsed.reliable !== false,
    };
  } catch (e) {
    log(`Gemini error for ${companyName}: ${e.message}`);
    return { score: 0, reason: 'Gemini API error: ' + e.message, reliable: false };
  }
}

// ── SUPABASE ───────────────────────────────────────────────────────────────
async function getUnscredCompanies(country, limit = 200) {
  try {
    const r = await axios.get(`${SUPABASE_URL}/rest/v1/companies`, {
      params: {
        select: 'id,company_name,website_url,country,source',
        match_score: 'is.null',
        ...(country ? { country: `eq.${country}` } : {}),
        limit,
        order: 'created_at.asc',
      },
      headers: SUPABASE_HEADERS,
    });
    return r.data || [];
  } catch (e) {
    log(`Supabase fetch error: ${e.message}`);
    return [];
  }
}

async function updateCompanyScore(id, score, reason, category) {
  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`,
      { match_score: score, match_reason: reason, product_category: category, scored_at: new Date().toISOString() },
      { headers: { ...SUPABASE_HEADERS, Prefer: 'return=minimal' } }
    );
    return true;
  } catch (e) {
    log(`Update error for ${id}: ${e.message}`);
    return false;
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function runAgent2(country, options = {}) {
  const { limit = 200, minScore = 50, onProgress } = options;
  const progress = (msg) => { log(msg); if (onProgress) onProgress(msg); };

  progress(`Starting Agent 2 — Website Matcher for ${country || 'all countries'}`);

  const companies = await getUnscredCompanies(country, limit);
  progress(`Found ${companies.length} unscored companies to process`);

  if (!companies.length) {
    progress('No unscored companies found. All done or run Agent 1 first.');
    return { processed: 0, highMatch: 0, mediumMatch: 0, skipped: 0 };
  }

  let processed = 0, highMatch = 0, mediumMatch = 0, skipped = 0;

  for (const company of companies) {
    const name = company.company_name;
    const url  = company.website_url;

    if (!url) {
      await updateCompanyScore(company.id, 0, 'No website URL', null);
      skipped++;
      progress(`[${processed + 1}/${companies.length}] ${name} — no URL, skipping`);
      processed++;
      continue;
    }

    progress(`[${processed + 1}/${companies.length}] Scoring: ${name}`);

    // Fetch website
    const mainText  = await fetchWebsiteText(url);
    const extraText = mainText ? await fetchExtraPages(url) : '';
    const fullText  = [mainText, extraText].filter(Boolean).join(' ').substring(0, 4000);

    // Score with Gemini
    const result = await scoreWithGemini(name, fullText);

    // Save to Supabase
    await updateCompanyScore(company.id, result.score, result.reason, result.category);

    if (result.score >= 80) { highMatch++; progress(`  → HIGH match ${result.score}%: ${result.reason}`); }
    else if (result.score >= minScore) { mediumMatch++; progress(`  → MEDIUM match ${result.score}%: ${result.reason}`); }
    else { progress(`  → LOW match ${result.score}% — skipping for outreach`); }

    processed++;

    // Rate limit: Gemini free tier is ~15 req/min
    await sleep(1200);
  }

  progress(`Agent 2 complete. Processed: ${processed} | High: ${highMatch} | Medium: ${mediumMatch} | Skipped: ${skipped}`);
  return { processed, highMatch, mediumMatch, skipped };
}

module.exports = { runAgent2, scoreWithGemini, fetchWebsiteText };

if (require.main === module) {
  const country = process.argv[2] || 'Denmark';
  const limit   = parseInt(process.argv[3]) || 20;
  runAgent2(country, { limit, onProgress: console.log })
    .then(r => { console.log('Done:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

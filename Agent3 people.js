/**
 * Kishor Lead Engine — Agent 3: People Finder + Name Resolver
 * Step A: Apollo API finds decision makers at matched companies (0 credits)
 * Step B: DuckDuckGo/Google resolves "Anna B." → "Anna Berg" from LinkedIn URL
 * Saves to Supabase people table
 */

const axios = require('axios');
require('dotenv').config();

const APOLLO_KEY   = process.env.APOLLO_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SUPABASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// Job titles we want — in priority order
const TARGET_TITLES = [
  'sourcing manager', 'director of sourcing', 'sourcing director',
  'purchasing manager', 'procurement manager', 'head of procurement',
  'head of buying', 'buying manager', 'senior buyer', 'buyer',
  'import manager', 'supply chain manager', 'supply chain director',
  'ceo', 'co-founder', 'founder', 'managing director', 'owner',
  'head of product', 'merchandising manager', 'product manager',
];

function log(msg) { console.log(`[Agent3] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isTitleRelevant(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return TARGET_TITLES.some(target => t.includes(target.split(' ')[0]) &&
    (target.split(' ').length === 1 || t.includes(target)));
}

// ── APOLLO PEOPLE SEARCH ───────────────────────────────────────────────────
async function findPeopleAtCompany(companyDomain, companyName) {
  if (!APOLLO_KEY) return [];

  // Try domain first, then company name
  const payloads = [];
  if (companyDomain) {
    payloads.push({ q_organization_domains: [companyDomain], per_page: 25 });
  }
  payloads.push({
    q_organization_name: companyName,
    per_page: 25,
  });

  for (const body of payloads) {
    try {
      const r = await axios.post(
        'https://api.apollo.io/api/v1/mixed_people/api_search',
        body,
        { headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_KEY } }
      );

      const people = r.data?.people || [];
      if (people.length) {
        log(`  Apollo: found ${people.length} people at ${companyName}`);
        return people;
      }
    } catch (e) {
      log(`  Apollo error for ${companyName}: ${e.response?.data?.message || e.message}`);
    }
    await sleep(300);
  }
  return [];
}

// ── FULL NAME RESOLVER ─────────────────────────────────────────────────────
// Apollo returns "Anna B." — we need "Anna Berg"
// Strategy: search LinkedIn URL via DuckDuckGo, parse name from URL slug

async function resolveFullName(firstName, lastInitial, companyName, linkedinUrl) {
  // If LinkedIn URL already has full name in slug, extract it
  if (linkedinUrl) {
    const slug = extractNameFromLinkedInUrl(linkedinUrl);
    if (slug) return { fullName: slug, source: 'linkedin_url' };
  }

  // Try DuckDuckGo search
  const ddgResult = await searchDuckDuckGoForName(firstName, lastInitial, companyName);
  if (ddgResult) return { fullName: ddgResult, source: 'duckduckgo' };

  // Fallback: use what Apollo gave us
  const fallback = lastInitial
    ? `${firstName} ${lastInitial}.`
    : firstName;
  return { fullName: fallback, source: 'apollo_partial' };
}

function extractNameFromLinkedInUrl(url) {
  // linkedin.com/in/anna-berg-12345ab → "Anna Berg"
  try {
    const match = url.match(/linkedin\.com\/in\/([a-z0-9\-]+)/i);
    if (!match) return null;

    const slug = match[1];
    // Remove trailing numeric IDs like -12345ab
    const cleaned = slug.replace(/-[0-9a-f]{4,}$/i, '').replace(/-[0-9]+[a-z]{0,3}$/i, '');
    const parts = cleaned.split('-').filter(p => p.length > 1 && !/^\d+$/.test(p));

    if (parts.length >= 2) {
      return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    return null;
  } catch { return null; }
}

async function searchDuckDuckGoForName(firstName, lastInitial, companyName) {
  const query = `"${firstName} ${lastInitial}" "${companyName}" site:linkedin.com/in`;

  try {
    const r = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
    });

    const results = [
      ...(r.data?.RelatedTopics || []),
      ...(r.data?.Results || []),
    ];

    for (const result of results) {
      const url = result.FirstURL || result.url || '';
      if (url.includes('linkedin.com/in/')) {
        const name = extractNameFromLinkedInUrl(url);
        if (name) {
          log(`    DuckDuckGo resolved: ${name}`);
          return name;
        }
      }
    }
  } catch (e) {
    log(`    DuckDuckGo error: ${e.message}`);
  }

  // Also try extracting from abstract text
  return null;
}

// ── EXTRACT DOMAIN FROM WEBSITE URL ───────────────────────────────────────
function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname.replace(/^www\./, '');
  } catch { return null; }
}

// ── SUPABASE ───────────────────────────────────────────────────────────────
async function getMatchedCompanies(country, minScore = 50, limit = 500) {
  try {
    const params = {
      select: 'id,company_name,website_url,linkedin_url,country',
      order:  'match_score.desc',
      limit,
    };
    if (country) params.country = `eq.${country}`;
    params.match_score = `gte.${minScore}`;

    const r = await axios.get(`${SUPABASE_URL}/rest/v1/companies`, {
      params,
      headers: SUPABASE_HEADERS,
    });
    return r.data || [];
  } catch (e) {
    log(`Supabase company fetch error: ${e.message}`);
    return [];
  }
}

async function upsertPerson(person) {
  try {
    // Conflict key: linkedin_url if available, else company_name + full_name
    const conflictCol = person.linkedin_url ? 'linkedin_url' : null;

    if (conflictCol) {
      await axios.post(
        `${SUPABASE_URL}/rest/v1/people`,
        person,
        {
          headers: { ...SUPABASE_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
          params: { on_conflict: conflictCol },
        }
      );
    } else {
      await axios.post(`${SUPABASE_URL}/rest/v1/people`, person, {
        headers: { ...SUPABASE_HEADERS, Prefer: 'return=minimal' },
      });
    }
    return true;
  } catch (e) {
    log(`  Upsert error: ${e.message}`);
    return false;
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function runAgent3(country, options = {}) {
  const { minScore = 50, limit = 200, onProgress } = options;
  const progress = (msg) => { log(msg); if (onProgress) onProgress(msg); };

  progress(`Starting Agent 3 — People Finder for ${country || 'all countries'}`);

  const companies = await getMatchedCompanies(country, minScore, limit);
  progress(`Found ${companies.length} matched companies (score ≥ ${minScore}%) to find people at`);

  if (!companies.length) {
    progress('No matched companies found. Run Agent 2 first.');
    return { companiesProcessed: 0, peopleSaved: 0, namesResolved: 0 };
  }

  let companiesProcessed = 0, peopleSaved = 0, namesResolved = 0;

  for (const company of companies) {
    const domain = extractDomain(company.website_url);
    progress(`[${companiesProcessed + 1}/${companies.length}] Finding people at: ${company.company_name}`);

    const apolloPeople = await findPeopleAtCompany(domain, company.company_name);

    // Filter to relevant job titles only
    const relevant = apolloPeople.filter(p => isTitleRelevant(p.title));
    progress(`  Relevant decision makers: ${relevant.length} / ${apolloPeople.length} total`);

    for (const person of relevant) {
      const firstName    = person.first_name || '';
      const lastInitial  = person.last_name ? person.last_name.charAt(0) : '';
      const rawLastName  = person.last_name || '';
      const linkedinUrl  = person.linkedin_url || null;

      // Resolve full name
      let fullName = `${firstName} ${rawLastName}`.trim();
      let nameSource = 'apollo';

      // If last name looks like just an initial (1-2 chars), try to resolve
      if (rawLastName.length <= 2) {
        progress(`  Resolving full name for: ${firstName} ${lastInitial}.`);
        const resolved = await resolveFullName(firstName, lastInitial, company.company_name, linkedinUrl);
        fullName   = resolved.fullName;
        nameSource = resolved.source;
        if (resolved.source !== 'apollo_partial') namesResolved++;
        await sleep(800); // rate limit DuckDuckGo
      }

      const row = {
        company_id:       company.id,
        company_name:     company.company_name,
        full_name:        fullName,
        first_name:       firstName,
        last_name:        fullName.split(' ').slice(1).join(' ') || rawLastName,
        job_title:        person.title || null,
        linkedin_url:     linkedinUrl,
        country:          company.country || country,
        source:           'apollo',
        name_source:      nameSource,
        email:            null,
        email_status:     'pending',
        created_at:       new Date().toISOString(),
      };

      const saved = await upsertPerson(row);
      if (saved) peopleSaved++;
    }

    companiesProcessed++;
    await sleep(500);
  }

  progress(`Agent 3 complete. Companies: ${companiesProcessed} | People saved: ${peopleSaved} | Names resolved: ${namesResolved}`);
  return { companiesProcessed, peopleSaved, namesResolved };
}

module.exports = { runAgent3, resolveFullName, extractNameFromLinkedInUrl };

if (require.main === module) {
  const country = process.argv[2] || 'Denmark';
  runAgent3(country, { minScore: 50, limit: 50, onProgress: console.log })
    .then(r => { console.log('Done:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

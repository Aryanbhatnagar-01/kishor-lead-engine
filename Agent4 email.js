/**
 * Kishor Lead Engine — Agent 4: Email Engine
 * Builds emails using pattern detection + verifies with email-verifier-check
 * Self-learning: every verified email improves future guesses
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

function log(msg) { console.log(`[Agent4] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── NAME NORMALIZATION ─────────────────────────────────────────────────────
function normalizeName(s) {
  return (s || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function getNameParts(fullName) {
  const parts = (fullName || '').trim().split(/[\s\-]+/).filter(Boolean);
  const first = normalizeName(parts[0] || '');
  const last  = normalizeName(parts[parts.length - 1] || '');
  const f     = first[0] || '';
  const l     = last[0]  || '';
  return { first, last, f, l };
}

// All patterns we try — ordered by frequency
function getCandidates(first, last, f, l) {
  if (!first || !last) return [];
  return [
    { pattern: 'firstname.lastname',  local: `${first}.${last}` },
    { pattern: 'f.lastname',          local: `${f}.${last}` },
    { pattern: 'firstnamelastname',   local: `${first}${last}` },
    { pattern: 'firstname_lastname',  local: `${first}_${last}` },
    { pattern: 'firstname',           local: first },
    { pattern: 'flastname',           local: `${f}${last}` },
    { pattern: 'lastname.firstname',  local: `${last}.${first}` },
    { pattern: 'f-lastname',          local: `${f}-${last}` },
    { pattern: 'firstname-lastname',  local: `${first}-${last}` },
    { pattern: 'firstnamel',          local: `${first}${l}` },
    { pattern: 'lastname',            local: last },
  ].filter((c, i, arr) => c.local && arr.findIndex(x => x.local === c.local) === i); // dedupe
}

function detectPattern(fullName, localPart) {
  const { first, last, f, l } = getNameParts(fullName);
  const local = normalizeName(localPart);
  const candidates = getCandidates(first, last, f, l);
  const match = candidates.find(c => c.local === local);
  return match ? match.pattern : null;
}

function applyPattern(fullName, pattern, domain) {
  const { first, last, f, l } = getNameParts(fullName);
  const candidates = getCandidates(first, last, f, l);
  const match = candidates.find(c => c.pattern === pattern);
  if (!match || !match.local) return null;
  return `${match.local}@${domain}`;
}

function getDomain(email) {
  return email && email.includes('@') ? email.split('@')[1].toLowerCase() : null;
}

// ── PATTERN LEARNING ───────────────────────────────────────────────────────
// Learns from ALL verified emails in Supabase for a given domain
async function learnDomainPattern(domain) {
  try {
    const r = await axios.get(`${SUPABASE_URL}/rest/v1/people`, {
      params: {
        select:       'full_name,email',
        email:        `like.*@${domain}`,
        email_status: `in.(verified,guessed)`,
        limit:        50,
      },
      headers: SUPABASE_HEADERS,
    });

    const people = (r.data || []).filter(p => p.email && p.full_name);
    if (!people.length) return null;

    const detectedPatterns = people
      .map(p => detectPattern(p.full_name, p.email.split('@')[0]))
      .filter(Boolean);

    if (!detectedPatterns.length) return null;

    const counts = detectedPatterns.reduce((acc, p) => {
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topPattern = sorted[0];
    const confidence = Math.round((topPattern[1] / detectedPatterns.length) * 100);

    return {
      pattern:      topPattern[0],
      confidence,
      sourceCount:  topPattern[1],
      totalEmails:  people.length,
    };
  } catch (e) {
    log(`Pattern learning error for ${domain}: ${e.message}`);
    return null;
  }
}

// ── SMTP VERIFICATION (built-in, no library needed) ────────────────────────
async function smtpVerify(email) {
  const net = require('net');
  const dns = require('dns').promises;

  return new Promise(async (resolve) => {
    try {
      const domain   = email.split('@')[1];
      const mxRecs   = await dns.resolveMx(domain).catch(() => null);
      if (!mxRecs || !mxRecs.length) return resolve({ valid: false, reason: 'no_mx' });

      const mx = mxRecs.sort((a, b) => a.priority - b.priority)[0].exchange;
      const socket = net.createConnection(25, mx);
      let buffer = '', step = 0, resolved = false;

      const done = (valid, reason) => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({ valid, reason: reason || (valid ? 'accepted' : 'rejected') });
        }
      };

      socket.setTimeout(20000);
      socket.on('timeout', () => done(false, 'timeout'));
      socket.on('error',   () => done(false, 'connection_error'));
      socket.on('data', chunk => {
        buffer += chunk.toString();
        if (step === 0 && buffer.includes('220')) {
          socket.write('EHLO kishorexports.com\r\n'); step = 1; buffer = '';
        } else if (step === 1 && (buffer.includes('250') || buffer.includes('220'))) {
          socket.write('MAIL FROM:<verify@kishorexports.com>\r\n'); step = 2; buffer = '';
        } else if (step === 2 && buffer.includes('250')) {
          socket.write(`RCPT TO:<${email}>\r\n`); step = 3; buffer = '';
        } else if (step === 3) {
          const valid = buffer.includes('250') || buffer.includes('251');
          socket.write('QUIT\r\n');
          done(valid, valid ? 'accepted' : 'rejected');
        }
      });
    } catch (e) {
      resolve({ valid: false, reason: 'error: ' + e.message });
    }
  });
}

// Catch-all detection: send a fake email to same domain
async function isCatchAllDomain(domain) {
  const fakeEmail = `x9x0noreply_fake_${Date.now()}@${domain}`;
  const result = await smtpVerify(fakeEmail);
  return result.valid; // if fake email is accepted, it's catch-all
}

// ── APOLLO CREDIT REVEAL ───────────────────────────────────────────────────
async function revealViaApollo(linkedinUrl) {
  if (!linkedinUrl || !APOLLO_KEY) return null;
  try {
    const r = await axios.post(
      'https://api.apollo.io/api/v1/people/match',
      { linkedin_url: linkedinUrl, reveal_personal_emails: false },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_KEY } }
    );
    return r.data?.person?.email || null;
  } catch (e) {
    log(`Apollo reveal error: ${e.response?.data?.message || e.message}`);
    return null;
  }
}

// ── SUPABASE HELPERS ───────────────────────────────────────────────────────
async function getPeopleWithoutEmails(country, limit = 500) {
  try {
    const params = {
      select:       'id,full_name,first_name,last_name,company_name,company_id,linkedin_url,country',
      email_status: 'eq.pending',
      limit,
      order:        'created_at.asc',
    };
    if (country) params.country = `eq.${country}`;

    const r = await axios.get(`${SUPABASE_URL}/rest/v1/people`, { params, headers: SUPABASE_HEADERS });
    return r.data || [];
  } catch (e) {
    log(`Supabase people fetch error: ${e.message}`);
    return [];
  }
}

async function getCompanyDomain(companyId, companyName) {
  try {
    // First: check if any person at this company has a verified email
    const r1 = await axios.get(`${SUPABASE_URL}/rest/v1/people`, {
      params: {
        select:       'email',
        company_id:   `eq.${companyId}`,
        email_status: 'in.(verified,guessed)',
        limit:        1,
      },
      headers: SUPABASE_HEADERS,
    });
    if (r1.data?.[0]?.email) return getDomain(r1.data[0].email);

    // Fallback: look up company website
    const r2 = await axios.get(`${SUPABASE_URL}/rest/v1/companies`, {
      params: { select: 'website_url', id: `eq.${companyId}`, limit: 1 },
      headers: SUPABASE_HEADERS,
    });
    const website = r2.data?.[0]?.website_url;
    if (website) {
      try {
        const u = new URL(website.startsWith('http') ? website : 'https://' + website);
        return u.hostname.replace(/^www\./, '');
      } catch { return null; }
    }
    return null;
  } catch { return null; }
}

async function updatePersonEmail(id, email, status, confidence, patternUsed, isCatchAll) {
  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/people?id=eq.${id}`,
      {
        email,
        email_status:     status,
        email_confidence: confidence,
        is_safe_to_send:  status === 'verified' && !isCatchAll,
        pattern_used:     patternUsed,
        is_catch_all:     isCatchAll,
        email_updated_at: new Date().toISOString(),
      },
      { headers: { ...SUPABASE_HEADERS, Prefer: 'return=minimal' } }
    );
    return true;
  } catch (e) {
    log(`  Update error for ${id}: ${e.message}`);
    return false;
  }
}

async function updateCompanyPattern(companyId, pattern, confidence) {
  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/companies?id=eq.${companyId}`,
      { email_pattern: pattern, pattern_confidence: confidence, pattern_updated_at: new Date().toISOString() },
      { headers: { ...SUPABASE_HEADERS, Prefer: 'return=minimal' } }
    );
  } catch { /* non-critical */ }
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function runAgent4(country, options = {}) {
  const { maxApolloCredits = 10, dryRun = false, onProgress } = options;
  const progress = (msg) => { log(msg); if (onProgress) onProgress(msg); };

  progress(`Starting Agent 4 — Email Engine for ${country || 'all countries'} | Credits: ${maxApolloCredits} | DryRun: ${dryRun}`);

  const people = await getPeopleWithoutEmails(country, 500);
  progress(`Found ${people.length} people needing emails`);

  if (!people.length) {
    progress('No pending people. All done or run Agent 3 first.');
    return { emailsBuilt: 0, verified: 0, creditsUsed: 0 };
  }

  // Group by company
  const byCompany = {};
  for (const p of people) {
    const key = p.company_id || p.company_name || 'unknown';
    if (!byCompany[key]) byCompany[key] = { people: [], companyId: p.company_id, companyName: p.company_name };
    byCompany[key].people.push(p);
  }

  progress(`Grouped into ${Object.keys(byCompany).length} companies`);

  let emailsBuilt = 0, verified = 0, creditsUsed = 0;
  const catchAllCache = {}; // domain → boolean

  for (const [key, group] of Object.entries(byCompany)) {
    if (creditsUsed >= maxApolloCredits) {
      progress(`Credit limit reached (${maxApolloCredits}). Stopping safely.`);
      break;
    }

    const { people: groupPeople, companyId, companyName } = group;
    progress(`\n── ${companyName} (${groupPeople.length} people) ──`);

    // 1. Get domain
    const domain = await getCompanyDomain(companyId, companyName);
    if (!domain) {
      progress(`  No domain found for ${companyName} — skipping`);
      continue;
    }
    progress(`  Domain: ${domain}`);

    // 2. Learn pattern from existing emails
    let patternInfo = await learnDomainPattern(domain);

    if (patternInfo) {
      progress(`  Pattern from DB: ${patternInfo.pattern} (${patternInfo.confidence}% confidence, ${patternInfo.sourceCount} emails)`);
    }

    // 3. If no pattern — reveal one email via Apollo credit
    if (!patternInfo || patternInfo.confidence < 60) {
      const target = groupPeople.find(p => p.linkedin_url);
      if (target && creditsUsed < maxApolloCredits) {
        progress(`  Using 1 Apollo credit to reveal email for: ${target.full_name}`);
        if (!dryRun) {
          const revealed = await revealViaApollo(target.linkedin_url);
          creditsUsed++;

          if (revealed) {
            progress(`  Revealed: ${revealed}`);
            const revPattern = detectPattern(target.full_name, revealed.split('@')[0]);
            progress(`  Pattern detected: ${revPattern}`);

            // Save this revealed email
            const catchAll = await checkCatchAll(getDomain(revealed), catchAllCache);
            const conf = catchAll ? 0.6 : 0.95;
            await updatePersonEmail(target.id, revealed, 'verified', conf, revPattern || 'custom', catchAll);
            emailsBuilt++;
            if (!catchAll) verified++;

            if (revPattern) {
              patternInfo = { pattern: revPattern, confidence: 100, sourceCount: 1 };
              await updateCompanyPattern(companyId, revPattern, 100);
            }
          } else {
            progress(`  Apollo returned no email for ${target.full_name}`);
          }
        } else {
          creditsUsed++; // count in dry run too
          progress(`  [DRY RUN] Would spend 1 credit on ${target.full_name}`);
        }
      }
    }

    // 4. Apply pattern to all people in this company
    if (!patternInfo || patternInfo.confidence < 60) {
      progress(`  No reliable pattern for ${companyName} — skipping email generation`);
      continue;
    }

    progress(`  Applying pattern "${patternInfo.pattern}" to ${groupPeople.length} people...`);

    // Check catch-all once per domain
    const catchAll = await checkCatchAll(domain, catchAllCache);
    if (catchAll) progress(`  ⚠️  Domain ${domain} is catch-all — confidence will be lower`);

    await updateCompanyPattern(companyId, patternInfo.pattern, patternInfo.confidence);

    for (const person of groupPeople) {
      const fullName = person.full_name || `${person.first_name} ${person.last_name}`.trim();
      if (!fullName || fullName.length < 3) continue;

      const guessedEmail = applyPattern(fullName, patternInfo.pattern, domain);
      if (!guessedEmail) {
        progress(`  Cannot apply pattern to: ${fullName}`);
        continue;
      }

      if (dryRun) {
        progress(`  [DRY RUN] ${fullName} → ${guessedEmail}`);
        emailsBuilt++;
        continue;
      }

      // SMTP verify
      process.stdout.write(`  ${fullName} → ${guessedEmail} → `);
      const smtpResult = await smtpVerify(guessedEmail);
      console.log(smtpResult.valid ? '✅' : `❌ (${smtpResult.reason})`);

      let status, confidence;
      if (catchAll) {
        // Catch-all: SMTP accepted means nothing — use pattern confidence only
        status     = smtpResult.valid ? 'guessed' : 'failed';
        confidence = smtpResult.valid ? 0.60 : 0.10;
      } else {
        status     = smtpResult.valid ? 'verified' : 'failed';
        confidence = smtpResult.valid ? 0.95 : 0.0;
      }

      await updatePersonEmail(person.id, guessedEmail, status, confidence, patternInfo.pattern, catchAll);
      emailsBuilt++;
      if (status === 'verified') verified++;

      await sleep(600); // rate limit SMTP checks
    }
  }

  progress(`\nAgent 4 complete. Built: ${emailsBuilt} | Verified: ${verified} | Credits used: ${creditsUsed}`);
  return { emailsBuilt, verified, creditsUsed };
}

async function checkCatchAll(domain, cache) {
  if (domain in cache) return cache[domain];
  try {
    const result = await isCatchAllDomain(domain);
    cache[domain] = result;
    return result;
  } catch {
    cache[domain] = false;
    return false;
  }
}

// ── NIGHTLY LEARNING JOB ────────────────────────────────────────────────────
// Run this as a cron — re-learns patterns from all new verified emails
async function runNightlyLearning(onProgress) {
  const progress = (msg) => { log(msg); if (onProgress) onProgress(msg); };
  progress('Nightly learning job started...');

  // Get all verified emails grouped by domain
  const r = await axios.get(`${SUPABASE_URL}/rest/v1/people`, {
    params: {
      select: 'company_id,company_name,full_name,email,email_status',
      email_status: 'in.(verified)',
      limit: 5000,
    },
    headers: SUPABASE_HEADERS,
  });

  const people = r.data || [];
  progress(`Learning from ${people.length} verified emails...`);

  // Group by domain
  const byDomain = {};
  for (const p of people) {
    const domain = getDomain(p.email);
    if (!domain) continue;
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(p);
  }

  let updated = 0;
  for (const [domain, domainPeople] of Object.entries(byDomain)) {
    if (domainPeople.length < 2) continue;
    const patternInfo = await learnDomainPattern(domain);
    if (patternInfo && domainPeople[0].company_id) {
      await updateCompanyPattern(domainPeople[0].company_id, patternInfo.pattern, patternInfo.confidence);
      updated++;
    }
  }

  progress(`Nightly learning complete. Updated patterns for ${updated} domains.`);
  return { updated };
}

module.exports = {
  runAgent4,
  runNightlyLearning,
  detectPattern,
  applyPattern,
  learnDomainPattern,
  smtpVerify,
};

if (require.main === module) {
  const cmd     = process.argv[2] || 'run';
  const country = process.argv[3] || 'Denmark';
  const credits = parseInt(process.argv[4]) || 5;

  if (cmd === 'nightly') {
    runNightlyLearning(console.log).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  } else if (cmd === 'dryrun') {
    runAgent4(country, { maxApolloCredits: credits, dryRun: true, onProgress: console.log })
      .then(r => { console.log('Done:', r); process.exit(0); })
      .catch(e => { console.error(e); process.exit(1); });
  } else {
    runAgent4(country, { maxApolloCredits: credits, dryRun: false, onProgress: console.log })
      .then(r => { console.log('Done:', r); process.exit(0); })
      .catch(e => { console.error(e); process.exit(1); });
  }
}

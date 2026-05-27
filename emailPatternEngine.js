/**
 * Kishor Exports — Email Pattern Engine v2.1
 * Fixed for actual Supabase people table structure:
 * - columns: id, company_name, full_name, title, email, linkedin_url
 * - NO company_domain column — domain extracted from existing emails
 * - NO apollo_id column — use LinkedIn URL for Apollo lookup
 */

const axios = require('axios');
require('dotenv').config();

const APOLLO_API_KEY    = process.env.APOLLO_API_KEY;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;
const SMTP_VERIFIER_URL = process.env.SMTP_VERIFIER_URL || 'https://kishor-lead-engine.onrender.com/verify-email';
const MAX_APOLLO_CREDITS = parseInt(process.env.MAX_APOLLO_CREDITS) || 10;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function normalizeName(s) {
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function splitCamelCase(s) {
  return s.replace(/([A-Z])/g, ' $1').trim().split(/\s+/).filter(Boolean);
}

function getNameParts(fullName) {
  const parts        = fullName.trim().split(/[\s\-]+/).filter(Boolean);
  const allParts     = parts.flatMap(p => splitCamelCase(p));
  const first        = normalizeName(parts[0] || '');
  const last         = normalizeName(parts[parts.length - 1] || '');
  const f            = first[0] || '';
  const initials     = parts.map(p => normalizeName(p)[0]).join('');
  const initials_camel = allParts.map(p => normalizeName(p)[0]).join('');
  return { first, last, f, initials, initials_camel };
}

function getCandidates(first, last, f, initials, initials_camel) {
  return [
    { pattern: 'firstname.lastname',  value: `${first}.${last}` },
    { pattern: 'f.lastname',          value: `${f}.${last}` },
    { pattern: 'firstnamelastname',   value: `${first}${last}` },
    { pattern: 'firstname_lastname',  value: `${first}_${last}` },
    { pattern: 'firstname',           value: first },
    { pattern: 'flastname',           value: `${f}${last}` },
    { pattern: 'lastname.firstname',  value: `${last}.${first}` },
    { pattern: 'initials',            value: initials },
    { pattern: 'initials_camel',      value: initials_camel },
    { pattern: 'first1+last2',        value: first.substring(0,1) + last.substring(0,2) },
    { pattern: 'first2+last1',        value: first.substring(0,2) + last.substring(0,1) },
    { pattern: 'first2+last2',        value: first.substring(0,2) + last.substring(0,2) },
    { pattern: 'first3+last1',        value: first.substring(0,3) + last.substring(0,1) },
  ];
}

function detectPattern(fullName, localPart) {
  const { first, last, f, initials, initials_camel } = getNameParts(fullName);
  const local = normalizeName(localPart);
  for (const c of getCandidates(first, last, f, initials, initials_camel)) {
    if (c.value === local) return c.pattern;
  }
  return null;
}

function applyPattern(fullName, pattern, domain) {
  const { first, last, f, initials, initials_camel } = getNameParts(fullName);
  const map = {};
  for (const c of getCandidates(first, last, f, initials, initials_camel)) {
    map[c.pattern] = c.value;
  }
  const local = map[pattern];
  if (!local) return null;
  return `${local}@${domain}`;
}

function getDomain(email) {
  return email && email.includes('@') ? email.split('@')[1].toLowerCase() : null;
}

// ─── PATTERN LEARNER ─────────────────────────────────────────────────────────
function learnPatternsFromTrainingData(trainingData) {
  const patternDB = {};
  for (const [domain, entries] of Object.entries(trainingData)) {
    if (entries.length < 2) continue;
    const detected = entries.map(e => detectPattern(e.name, e.local)).filter(Boolean);
    if (!detected.length) continue;
    const counts = detected.reduce((acc, p) => { acc[p]=(acc[p]||0)+1; return acc; }, {});
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    patternDB[domain] = {
      pattern:      sorted[0][0],
      confidence:   Math.round(sorted[0][1]/detected.length*100),
      source_count: sorted[0][1],
      total_people: entries.length,
      mixed:        sorted.length > 1 && sorted[1][1]/detected.length > 0.15
    };
  }
  return patternDB;
}

// ─── APOLLO REVEAL ───────────────────────────────────────────────────────────
async function revealEmailFromApollo(linkedinUrl) {
  try {
    const res = await axios.post(
      'https://api.apollo.io/api/v1/people/match',
      { linkedin_url: linkedinUrl, reveal_personal_emails: false },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_API_KEY } }
    );
    return res.data?.person?.email || null;
  } catch (err) {
    console.error(`  Apollo error: ${err.response?.data?.message || err.message}`);
    return null;
  }
}

// ─── SMTP VERIFY ─────────────────────────────────────────────────────────────
async function smtpVerify(email) {
  try {
    const res = await axios.get(SMTP_VERIFIER_URL, { params: { email }, timeout: 15000 });
    return res.data?.valid === true || res.data?.result === 'valid';
  } catch { return false; }
}

// ─── SUPABASE ────────────────────────────────────────────────────────────────
async function supabaseGet(path, params) {
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/${path}`, {
    params,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  return res.data || [];
}

async function supabasePatch(path, data) {
  await axios.patch(`${SUPABASE_URL}/rest/v1/${path}`, data, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    }
  });
}

// ─── MAIN ENGINE ─────────────────────────────────────────────────────────────
async function runPatternEngine(options = {}) {
  const {
    maxCredits       = MAX_APOLLO_CREDITS,
    domainsToProcess = null,
    dryRun           = false,
    trainingDataPath = './training_data.json'
  } = options;

  console.log('='.repeat(60));
  console.log('  KISHOR EMAIL PATTERN ENGINE v2.1');
  console.log(`  Max Apollo Credits: ${maxCredits} | Dry Run: ${dryRun}`);
  console.log('='.repeat(60));

  // Load training patterns
  const trainingData = require(trainingDataPath);
  const patternDB    = learnPatternsFromTrainingData(trainingData);
  console.log(`\n✅ Patterns learned: ${Object.keys(patternDB).length} domains`);

  // Step 1: Get all people WITH emails from Supabase
  // Group by domain → this tells us which domains have known patterns
  console.log('\n📥 Loading people with emails from Supabase...');
  const withEmails = await supabaseGet('people', {
    email: 'not.is.null',
    select: 'id,full_name,email,company_name',
    limit: 5000
  });

  // Build domain → people map from Supabase
  const supabasePatterns = {};
  for (const p of withEmails) {
    const domain = getDomain(p.email);
    if (!domain) continue;
    if (!supabasePatterns[domain]) supabasePatterns[domain] = [];
    supabasePatterns[domain].push(p);
  }
  console.log(`   Found ${Object.keys(supabasePatterns).length} domains with known emails`);

  // Step 2: Learn patterns from Supabase emails
  const livePatternDB = {};
  for (const [domain, people] of Object.entries(supabasePatterns)) {
    if (people.length < 1) continue;
    const detected = people
      .map(p => detectPattern(p.full_name, p.email.split('@')[0]))
      .filter(Boolean);
    if (!detected.length) continue;
    const counts = detected.reduce((a,p)=>{ a[p]=(a[p]||0)+1; return a; }, {});
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    livePatternDB[domain] = {
      pattern:    top[0],
      confidence: Math.round(top[1]/detected.length*100),
      source:     'supabase',
      count:      top[1]
    };
  }
  console.log(`   Patterns from Supabase emails: ${Object.keys(livePatternDB).length}`);

  // Step 3: Get all people WITHOUT emails
  const withoutEmails = await supabaseGet('people', {
    email: 'is.null',
    select: 'id,full_name,linkedin_url,company_name',
    limit: 2000
  });
  console.log(`\n👥 People without emails: ${withoutEmails.length}`);

  if (withoutEmails.length === 0) {
    console.log('✅ Everyone already has an email! Nothing to do.');
    return { creditsUsed: 0, emailsGenerated: 0, emailsVerified: 0 };
  }

  // Group people without emails by company_name
  const byCompany = {};
  for (const p of withoutEmails) {
    const key = p.company_name || 'unknown';
    if (!byCompany[key]) byCompany[key] = [];
    byCompany[key].push(p);
  }
  console.log(`   Across ${Object.keys(byCompany).length} companies\n`);

  // Counters
  let creditsUsed=0, emailsGenerated=0, emailsVerified=0, skipped=0;

  // Step 4: For each company, find pattern and apply
  for (const [companyName, people] of Object.entries(byCompany)) {

    // CREDIT GUARD
    if (creditsUsed >= maxCredits) {
      console.log(`\n⛔ CREDIT LIMIT HIT (${maxCredits}). Stopping safely.`);
      break;
    }

    console.log(`\n── ${companyName} (${people.length} people need emails) ──`);

    // Find pattern for this company
    // First: check if any person in this company already has email → get domain
    const knownPerson = withEmails.find(p => p.company_name === companyName);
    let domain = knownPerson ? getDomain(knownPerson.email) : null;
    let patternInfo = null;

    if (domain) {
      // Check live patterns from Supabase first
      if (livePatternDB[domain] && livePatternDB[domain].confidence >= 70) {
        patternInfo = livePatternDB[domain];
        console.log(`   🗄️  Pattern from Supabase: ${patternInfo.pattern} (${patternInfo.confidence}%)`);
      }
      // Fallback to training data
      if (!patternInfo && patternDB[domain] && patternDB[domain].confidence >= 70) {
        patternInfo = patternDB[domain];
        console.log(`   📚 Pattern from training: ${patternInfo.pattern} (${patternInfo.confidence}%)`);
      }
    }

    // No domain known → try Apollo credit to reveal 1 email
    if (!patternInfo) {
      const target = people.find(p => p.linkedin_url);
      if (!target) {
        console.log(`   ⚠️  No LinkedIn URL and no known email domain. Skipping.`);
        skipped++;
        continue;
      }

      console.log(`   💳 Using Apollo credit ${creditsUsed+1}/${maxCredits}...`);
      const revealed = await revealEmailFromApollo(target.linkedin_url);
      creditsUsed++;

      if (!revealed) {
        console.log(`   ❌ Apollo returned no email.`);
        skipped++;
        continue;
      }

      domain = getDomain(revealed);
      const local = revealed.split('@')[0];
      const p = detectPattern(target.full_name, local);
      console.log(`   📧 Revealed: ${revealed} → Pattern: ${p || 'custom'}`);

      if (!dryRun) {
        await supabasePatch(`people?id=eq.${target.id}`, { email: revealed });
        emailsGenerated++;
      }

      if (!p || !domain) { skipped++; continue; }
      patternInfo = { pattern: p, confidence: 100 };
    }

    if (!domain || patternInfo.confidence < 70) {
      console.log(`   ⚠️  Skipping — no domain or low confidence.`);
      skipped++;
      continue;
    }

    // Apply pattern to all people in this company without emails
    console.log(`   🎯 Pattern: ${patternInfo.pattern} → applying to ${people.length} people...`);

    for (const person of people) {
      const guessed = applyPattern(person.full_name, patternInfo.pattern, domain);
      if (!guessed) {
        console.log(`   ⚠️  Cannot apply to: ${person.full_name}`);
        continue;
      }

      process.stdout.write(`   📨 ${guessed} → `);
      const valid = await smtpVerify(guessed);
      console.log(valid ? '✅ verified' : '❌ invalid');

      if (!dryRun) {
        await supabasePatch(`people?id=eq.${person.id}`, { email: guessed });
      }

      emailsGenerated++;
      if (valid) emailsVerified++;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  RUN COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Apollo credits used:    ${creditsUsed} / ${maxCredits}`);
  console.log(`  Emails generated:       ${emailsGenerated}`);
  console.log(`  Emails verified ✅:     ${emailsVerified}`);
  console.log(`  Companies skipped:      ${skipped}`);
  console.log('='.repeat(60));

  return { creditsUsed, emailsGenerated, emailsVerified };
}

// ─── LOCAL TEST ───────────────────────────────────────────────────────────────
function testLocally(trainingDataPath = './training_data.json') {
  const trainingData = require(trainingDataPath);
  const patternDB    = learnPatternsFromTrainingData(trainingData);
  let correct=0, total=0, reachable=0;

  for (const [domain, entries] of Object.entries(trainingData)) {
    const info = patternDB[domain];
    if (!info || info.confidence < 70) continue;
    for (const entry of entries) {
      const { first, last, f, initials, initials_camel } = getNameParts(entry.name);
      const localNorm = normalizeName(entry.local);
      const allVals = getCandidates(first,last,f,initials,initials_camel).map(c=>c.value);
      if (allVals.includes(localNorm)) reachable++;
      const guessed = applyPattern(entry.name, info.pattern, domain);
      total++;
      if (guessed === entry.email) correct++;
    }
  }

  console.log('\n=== LOCAL ACCURACY TEST ===');
  console.log(`Top-pattern accuracy:      ${correct}/${total} = ${Math.round(correct/total*100)}%`);
  console.log(`Reachable via any pattern: ${reachable}/${total} = ${Math.round(reachable/total*100)}%`);
  const dist = {};
  for (const info of Object.values(patternDB)) { dist[info.pattern]=(dist[info.pattern]||0)+1; }
  console.log('\nPattern Distribution:');
  Object.entries(dist).sort((a,b)=>b[1]-a[1]).forEach(([p,c]) => console.log(`  ${p}: ${c} companies`));
  return Math.round(correct/total*100);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = { runPatternEngine, testLocally, learnPatternsFromTrainingData, detectPattern, applyPattern, normalizeName };

// ─── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const credits = parseInt(arg) || 10;
  if (cmd === 'test') {
    testLocally('./training_data.json');
  } else if (cmd === 'dryrun') {
    runPatternEngine({ maxCredits: credits, dryRun: true }).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
  } else if (cmd === 'run') {
    runPatternEngine({ maxCredits: credits, dryRun: false }).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
  } else {
    console.log('Usage: node emailPatternEngine.js test | dryrun 10 | run 10');
  }
}

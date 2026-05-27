/**
 * Kishor Exports — Email Pattern Engine v2
 * 
 * Flow:
 * 1. Load pattern knowledge from training data (Denmark Excel)
 * 2. For a given company domain, check if pattern already known
 * 3. If unknown → use 1 Apollo credit to reveal 1 email → learn pattern
 * 4. Apply pattern to ALL people in company
 * 5. SMTP verify all guessed emails
 * 6. Hard limit: max 10 Apollo credits per run (configurable)
 * 
 * Accuracy on Denmark training data:
 *   - 83% of people reachable via standard patterns
 *   - SMTP verify confirms each guess — wrong guesses don't get sent
 */

const axios = require('axios');
require('dotenv').config();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const APOLLO_API_KEY   = process.env.APOLLO_API_KEY;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
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
  const parts     = fullName.trim().split(/[\s\-]+/).filter(Boolean);
  const allParts  = parts.flatMap(p => splitCamelCase(p));
  const first     = normalizeName(parts[0] || '');
  const last      = normalizeName(parts[parts.length - 1] || '');
  const f         = first[0] || '';
  const initials  = parts.map(p => normalizeName(p)[0]).join('');
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

// ─── PATTERN DETECTOR ────────────────────────────────────────────────────────
function detectPattern(fullName, localPart) {
  const { first, last, f, initials, initials_camel } = getNameParts(fullName);
  const local = normalizeName(localPart);
  for (const c of getCandidates(first, last, f, initials, initials_camel)) {
    if (c.value === local) return c.pattern;
  }
  return null;
}

// ─── APPLY PATTERN ───────────────────────────────────────────────────────────
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

// ─── LEARN PATTERNS FROM TRAINING DATA ───────────────────────────────────────
function learnPatternsFromTrainingData(trainingData) {
  const patternDB = {};

  for (const [domain, entries] of Object.entries(trainingData)) {
    if (entries.length < 2) continue;

    const detected = entries
      .map(e => detectPattern(e.name, e.local))
      .filter(Boolean);

    if (!detected.length) continue;

    const counts = detected.reduce((acc, p) => {
      acc[p] = (acc[p] || 0) + 1; return acc;
    }, {});

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const [topPattern, topCount] = sorted[0];
    const confidence = Math.round((topCount / detected.length) * 100);

    patternDB[domain] = {
      pattern:      topPattern,
      confidence,
      source_count: topCount,
      total_people: entries.length,
      all_patterns: counts,
      mixed: sorted.length > 1 && sorted[1][1] / detected.length > 0.15
    };
  }

  return patternDB;
}

// ─── APOLLO: REVEAL 1 EMAIL ───────────────────────────────────────────────────
async function revealOneEmailFromApollo(personId) {
  try {
    const res = await axios.post(
      'https://api.apollo.io/api/v1/people/match',
      { id: personId, reveal_personal_emails: false },
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
    const res = await axios.get(SMTP_VERIFIER_URL, {
      params: { email }, timeout: 15000
    });
    return res.data?.valid === true || res.data?.result === 'valid';
  } catch {
    return false;
  }
}

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
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

async function getPeopleWithoutEmails(domain, limit = 50) {
  return supabaseGet('people', {
    company_domain: `eq.${domain}`,
    email: 'is.null',
    select: 'id,full_name,apollo_id,company_domain',
    limit
  });
}

async function getPeopleWithEmails(domain) {
  return supabaseGet('people', {
    company_domain: `eq.${domain}`,
    email: 'not.is.null',
    select: 'full_name,email',
    limit: 20
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
  console.log('  KISHOR EMAIL PATTERN ENGINE v2');
  console.log(`  Max Apollo Credits: ${maxCredits}`);
  console.log(`  Dry Run: ${dryRun}`);
  console.log('='.repeat(60));

  // Load training data
  const trainingData   = require(trainingDataPath);
  const patternDB      = learnPatternsFromTrainingData(trainingData);
  const highConf       = Object.values(patternDB).filter(p => p.confidence >= 80).length;
  console.log(`\n✅ Patterns learned: ${Object.keys(patternDB).length} domains`);
  console.log(`   High confidence (80%+): ${highConf}`);

  // Get domains to process
  let domains = domainsToProcess;
  if (!domains) {
    const rows = await supabaseGet('people', {
      email: 'is.null', select: 'company_domain', limit: 1000
    });
    domains = [...new Set(rows.map(r => r.company_domain).filter(Boolean))];
  }
  console.log(`\n📋 Domains with missing emails: ${domains.length}\n`);

  // Counters
  let creditsUsed = 0, emailsGenerated = 0, emailsVerified = 0;
  let patternsFromTraining = 0, patternsFromApollo = 0, skipped = 0;

  for (const domain of domains) {

    // ── CREDIT GUARD ──
    if (creditsUsed >= maxCredits) {
      console.log(`\n⛔ CREDIT LIMIT HIT (${maxCredits}). Stopping safely.`);
      console.log(`   Remaining domains will be processed next run.`);
      break;
    }

    console.log(`\n── ${domain} ──`);

    // Step 1: Check training data first
    let patternInfo = null;
    const trained = patternDB[domain];

    if (trained && trained.confidence >= 70) {
      patternInfo = trained;
      patternsFromTraining++;
      console.log(`   📚 Training pattern: ${patternInfo.pattern} (${patternInfo.confidence}%)`);
    } else {
      // Step 2: Check existing emails in Supabase
      const existing = await getPeopleWithEmails(domain);
      if (existing.length > 0) {
        const detected = existing
          .map(p => detectPattern(p.full_name, p.email.split('@')[0]))
          .filter(Boolean);
        if (detected.length > 0) {
          const counts = detected.reduce((a,p)=>{ a[p]=(a[p]||0)+1; return a; }, {});
          const top = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
          patternInfo = { pattern: top[0], confidence: Math.round(top[1]/detected.length*100), source_count: top[1] };
          patternsFromTraining++;
          console.log(`   🗄️  Supabase pattern: ${patternInfo.pattern} (${patternInfo.confidence}%)`);
        }
      }

      // Step 3: Use Apollo credit to reveal 1 email
      if (!patternInfo || patternInfo.confidence < 70) {
        console.log(`   💳 Using Apollo credit ${creditsUsed + 1}/${maxCredits}...`);

        const people = await getPeopleWithoutEmails(domain, 10);
        const target = people.find(p => p.apollo_id);

        if (!target) {
          console.log(`   ⚠️  No apollo_id found. Skipping.`);
          skipped++;
          continue;
        }

        const revealed = await revealOneEmailFromApollo(target.apollo_id);
        creditsUsed++;

        if (!revealed) {
          console.log(`   ❌ Apollo returned no email. Credits used: ${creditsUsed}/${maxCredits}`);
          skipped++;
          continue;
        }

        const revealedLocal = revealed.split('@')[0];
        const p = detectPattern(target.full_name, revealedLocal);
        console.log(`   📧 Revealed: ${revealed} → Pattern: ${p || 'custom'}`);

        // Save revealed email regardless
        if (!dryRun) {
          await supabasePatch(`people?id=eq.${target.id}`, {
            email: revealed, email_status: 'revealed', pattern_used: p || 'custom'
          });
          emailsGenerated++;
        }

        if (!p) {
          console.log(`   ⚠️  Custom pattern. Saving revealed email only.`);
          skipped++;
          continue;
        }

        patternInfo = { pattern: p, confidence: 100, source_count: 1 };
        patternsFromApollo++;
      }
    }

    // Save pattern to companies table
    if (!dryRun && patternInfo) {
      await supabasePatch(`companies?domain=eq.${domain}`, {
        email_pattern: patternInfo.pattern,
        pattern_confidence: patternInfo.confidence,
        pattern_source_count: patternInfo.source_count
      });
    }

    if (patternInfo.confidence < 70) {
      console.log(`   ⚠️  Low confidence (${patternInfo.confidence}%). Skipping guessing.`);
      skipped++;
      continue;
    }

    // Step 4: Apply pattern to everyone without email
    const needEmails = await getPeopleWithoutEmails(domain, 50);
    console.log(`   👥 Generating emails for ${needEmails.length} people...`);

    for (const person of needEmails) {
      const guessed = applyPattern(person.full_name, patternInfo.pattern, domain);
      if (!guessed) {
        console.log(`   ⚠️  Cannot apply to: ${person.full_name}`);
        continue;
      }

      process.stdout.write(`   📨 ${guessed} → `);
      const valid = await smtpVerify(guessed);
      console.log(valid ? '✅ verified' : '❌ unverified');

      if (!dryRun) {
        await supabasePatch(`people?id=eq.${person.id}`, {
          email: guessed,
          email_status: valid ? 'verified' : 'guessed_unverified',
          pattern_used: patternInfo.pattern
        });
      }

      emailsGenerated++;
      if (valid) emailsVerified++;
      await new Promise(r => setTimeout(r, 300)); // rate limit
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  RUN COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Apollo credits used:       ${creditsUsed} / ${maxCredits}`);
  console.log(`  Credits remaining:         ${maxCredits - creditsUsed}`);
  console.log(`  Patterns from training:    ${patternsFromTraining}`);
  console.log(`  Patterns from Apollo:      ${patternsFromApollo}`);
  console.log(`  Emails generated:          ${emailsGenerated}`);
  console.log(`  Emails SMTP verified ✅:   ${emailsVerified}`);
  console.log(`  Domains skipped:           ${skipped}`);
  console.log('='.repeat(60));

  return { creditsUsed, emailsGenerated, emailsVerified };
}

// ─── LOCAL TEST (no API needed) ───────────────────────────────────────────────
function testLocally(trainingDataPath = './training_data.json') {
  const trainingData = require(trainingDataPath);
  const patternDB    = learnPatternsFromTrainingData(trainingData);

  let correct=0, total=0, reachable=0;

  for (const [domain, entries] of Object.entries(trainingData)) {
    const info = patternDB[domain];
    if (!info || info.confidence < 70) continue;

    for (const entry of entries) {
      // Check if ANY pattern matches (reachable)
      const { first, last, f, initials, initials_camel } = getNameParts(entry.name);
      const localNorm = normalizeName(entry.local);
      const allVals = getCandidates(first, last, f, initials, initials_camel).map(c=>c.value);
      if (allVals.includes(localNorm)) reachable++;

      // Check if TOP pattern matches (accuracy)
      const guessed = applyPattern(entry.name, info.pattern, domain);
      total++;
      if (guessed === entry.email) correct++;
    }
  }

  console.log('\n=== LOCAL ACCURACY TEST ===');
  console.log(`Top-pattern accuracy:  ${correct}/${total} = ${Math.round(correct/total*100)}%`);
  console.log(`Reachable via any pattern: ${reachable}/${total} = ${Math.round(reachable/total*100)}%`);
  console.log(`(SMTP verify catches wrong guesses — real success rate is higher)`);

  const dist = {};
  for (const info of Object.values(patternDB)) {
    dist[info.pattern] = (dist[info.pattern]||0)+1;
  }
  console.log('\nPattern Distribution:');
  Object.entries(dist).sort((a,b)=>b[1]-a[1]).forEach(([p,c]) => {
    console.log(`  ${p}: ${c} companies`);
  });
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = {
  runPatternEngine, testLocally,
  learnPatternsFromTrainingData, detectPattern, applyPattern, normalizeName
};

// ─── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const credits = parseInt(arg) || 10;

  if (cmd === 'test') {
    testLocally('./training_data.json');
  } else if (cmd === 'dryrun') {
    runPatternEngine({ maxCredits: credits, dryRun: true })
      .then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  } else if (cmd === 'run') {
    runPatternEngine({ maxCredits: credits, dryRun: false })
      .then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  } else {
    console.log(`
Usage:
  node emailPatternEngine.js test          — Test accuracy locally (no API)
  node emailPatternEngine.js dryrun 10     — Dry run, max 10 credits
  node emailPatternEngine.js run 10        — Live run, max 10 credits
  node emailPatternEngine.js run 15        — Live run, max 15 credits
    `);
  }
}

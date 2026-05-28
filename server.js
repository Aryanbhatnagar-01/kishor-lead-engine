/**
 * Kishor Lead Engine — server.js v8.0
 * Full 4-agent pipeline wired together
 * User enters country → all 4 agents run → verified contacts ready
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── AGENTS ────────────────────────────────────────────────────────────────
const { runAgent1 } = require('./agent1-discovery');
const { runAgent2 } = require('./agent2-matcher');
const { runAgent3 } = require('./agent3-people');
const { runAgent4, runNightlyLearning } = require('./agent4-email');

// ── JOB STATE ─────────────────────────────────────────────────────────────
let job = {
  running:  false,
  country:  null,
  stage:    'idle',   // idle | agent1 | agent2 | agent3 | agent4 | done | error
  pct:      0,
  logs:     [],
  results:  { agent1: null, agent2: null, agent3: null, agent4: null },
  startedAt: null,
  error:    null,
};

function addLog(msg) {
  const line = `[${new Date().toTimeString().slice(0,8)}] ${msg}`;
  job.logs.push(line);
  if (job.logs.length > 200) job.logs.shift();
  console.log(line);
}

function setStage(stage, pct) {
  job.stage = stage;
  job.pct   = pct;
  addLog(`── Stage: ${stage} (${pct}%) ──`);
}

// ── PIPELINE RUNNER ────────────────────────────────────────────────────────
async function runFullPipeline(country, options = {}) {
  const { skipAgent1 = false, skipAgent2 = false, maxApolloCredits = 10 } = options;

  job.running   = true;
  job.country   = country;
  job.stage     = 'starting';
  job.pct       = 0;
  job.logs      = [];
  job.error     = null;
  job.results   = { agent1: null, agent2: null, agent3: null, agent4: null };
  job.startedAt = new Date().toISOString();

  addLog(`🚀 Pipeline started for: ${country}`);
  addLog(`Options: skipAgent1=${skipAgent1}, skipAgent2=${skipAgent2}, maxCredits=${maxApolloCredits}`);

  try {
    // ── AGENT 1: Find Companies ──────────────────────────────────────────
    if (!skipAgent1) {
      setStage('agent1', 5);
      addLog('Agent 1: Searching for companies via Apollo + Google + Trade Shows...');
      const r1 = await runAgent1(country, {
        maxPages:   3,
        onProgress: addLog,
      });
      job.results.agent1 = r1;
      addLog(`✅ Agent 1 done: ${r1.totalSaved} companies saved`);
    } else {
      addLog('Agent 1: Skipped (using existing companies in DB)');
    }

    // ── AGENT 2: Score Websites ──────────────────────────────────────────
    if (!skipAgent2) {
      setStage('agent2', 25);
      addLog('Agent 2: Scoring company websites with Gemini AI...');
      const r2 = await runAgent2(country, {
        limit:      300,
        minScore:   50,
        onProgress: addLog,
      });
      job.results.agent2 = r2;
      addLog(`✅ Agent 2 done: ${r2.processed} scored | ${r2.highMatch} high | ${r2.mediumMatch} medium`);
    } else {
      addLog('Agent 2: Skipped (using existing match scores)');
    }

    // ── AGENT 3: Find People ─────────────────────────────────────────────
    setStage('agent3', 55);
    addLog('Agent 3: Finding decision makers via Apollo...');
    const r3 = await runAgent3(country, {
      minScore:   50,
      limit:      200,
      onProgress: addLog,
    });
    job.results.agent3 = r3;
    addLog(`✅ Agent 3 done: ${r3.peopleSaved} people saved | ${r3.namesResolved} names resolved`);

    // ── AGENT 4: Build Emails ────────────────────────────────────────────
    setStage('agent4', 75);
    addLog('Agent 4: Building and verifying emails...');
    const r4 = await runAgent4(country, {
      maxApolloCredits,
      dryRun:     false,
      onProgress: addLog,
    });
    job.results.agent4 = r4;
    addLog(`✅ Agent 4 done: ${r4.emailsBuilt} emails | ${r4.verified} verified | ${r4.creditsUsed} credits used`);

    // ── DONE ─────────────────────────────────────────────────────────────
    setStage('done', 100);
    addLog(`🎉 Pipeline complete for ${country}!`);
    addLog(`Summary: Companies found, websites scored, people found, emails built and verified.`);
    addLog(`Ready to export and send via Saleshandy.`);

  } catch (e) {
    job.stage = 'error';
    job.error = e.message;
    addLog(`❌ Pipeline error: ${e.message}`);
    console.error(e);
  } finally {
    job.running = false;
  }
}

// ── API ROUTES ────────────────────────────────────────────────────────────

// Start full pipeline
app.post('/run', async (req, res) => {
  if (job.running) return res.status(400).json({ error: 'Pipeline already running. Stop it first.' });

  const { country, skipAgent1, skipAgent2, maxApolloCredits } = req.body;
  if (!country) return res.status(400).json({ error: 'country is required' });

  // Run async — don't await
  runFullPipeline(country, {
    skipAgent1:      skipAgent1 || false,
    skipAgent2:      skipAgent2 || false,
    maxApolloCredits: maxApolloCredits || 10,
  });

  res.json({ message: `Pipeline started for ${country}`, country });
});

// Run individual agents
app.post('/run/agent1', async (req, res) => {
  if (job.running) return res.status(400).json({ error: 'Already running' });
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: 'country required' });
  job.running = true; job.stage = 'agent1'; job.logs = [];
  runAgent1(country, { maxPages: 3, onProgress: addLog })
    .then(r => { job.results.agent1 = r; job.running = false; job.stage = 'done'; addLog('Agent 1 done: ' + JSON.stringify(r)); })
    .catch(e => { job.running = false; job.stage = 'error'; addLog('Error: ' + e.message); });
  res.json({ message: 'Agent 1 started for ' + country });
});

app.post('/run/agent2', async (req, res) => {
  if (job.running) return res.status(400).json({ error: 'Already running' });
  const { country, limit } = req.body;
  job.running = true; job.stage = 'agent2'; job.logs = [];
  runAgent2(country, { limit: limit || 200, onProgress: addLog })
    .then(r => { job.results.agent2 = r; job.running = false; job.stage = 'done'; addLog('Agent 2 done: ' + JSON.stringify(r)); })
    .catch(e => { job.running = false; job.stage = 'error'; addLog('Error: ' + e.message); });
  res.json({ message: 'Agent 2 started' });
});

app.post('/run/agent3', async (req, res) => {
  if (job.running) return res.status(400).json({ error: 'Already running' });
  const { country, minScore } = req.body;
  job.running = true; job.stage = 'agent3'; job.logs = [];
  runAgent3(country, { minScore: minScore || 50, onProgress: addLog })
    .then(r => { job.results.agent3 = r; job.running = false; job.stage = 'done'; addLog('Agent 3 done: ' + JSON.stringify(r)); })
    .catch(e => { job.running = false; job.stage = 'error'; addLog('Error: ' + e.message); });
  res.json({ message: 'Agent 3 started' });
});

app.post('/run/agent4', async (req, res) => {
  if (job.running) return res.status(400).json({ error: 'Already running' });
  const { country, maxApolloCredits, dryRun } = req.body;
  job.running = true; job.stage = 'agent4'; job.logs = [];
  runAgent4(country, { maxApolloCredits: maxApolloCredits || 5, dryRun: dryRun || false, onProgress: addLog })
    .then(r => { job.results.agent4 = r; job.running = false; job.stage = 'done'; addLog('Agent 4 done: ' + JSON.stringify(r)); })
    .catch(e => { job.running = false; job.stage = 'error'; addLog('Error: ' + e.message); });
  res.json({ message: 'Agent 4 started' });
});

// Stop
app.post('/stop', (req, res) => {
  job.running = false;
  job.stage   = 'stopped';
  addLog('Stopped by user.');
  res.json({ message: 'Stopped' });
});

// Status — polled by dashboard
app.get('/status', (req, res) => res.json(job));

// ── DATA ROUTES ───────────────────────────────────────────────────────────

// Companies
app.get('/companies', async (req, res) => {
  const { country, min_score, source } = req.query;
  let q = supabase.from('companies').select('*').order('match_score', { ascending: false });
  if (country)   q = q.eq('country', country);
  if (min_score) q = q.gte('match_score', parseInt(min_score));
  if (source)    q = q.eq('source', source);
  const { data, error } = await q.limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// People / contacts
app.get('/people', async (req, res) => {
  const { country, email_status, company_id, min_confidence, is_safe } = req.query;
  let q = supabase.from('people').select('*').order('created_at', { ascending: false });
  if (country)        q = q.eq('country', country);
  if (email_status)   q = q.eq('email_status', email_status);
  if (company_id)     q = q.eq('company_id', company_id);
  if (min_confidence) q = q.gte('email_confidence', parseFloat(min_confidence));
  if (is_safe === 'true') q = q.eq('is_safe_to_send', true);
  const { data, error } = await q.limit(1000);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Stats
app.get('/stats', async (req, res) => {
  const [companies, people, verified, safe] = await Promise.all([
    supabase.from('companies').select('*', { count: 'exact', head: true }),
    supabase.from('people').select('*', { count: 'exact', head: true }),
    supabase.from('people').select('*', { count: 'exact', head: true }).eq('email_status', 'verified'),
    supabase.from('people').select('*', { count: 'exact', head: true }).eq('is_safe_to_send', true),
  ]);
  res.json({
    companies: companies.count || 0,
    people:    people.count    || 0,
    verified:  verified.count  || 0,
    safe:      safe.count      || 0,
  });
});

// Export CSV
app.get('/export/csv', async (req, res) => {
  const { country, min_confidence = 0.6, is_safe } = req.query;
  let q = supabase.from('people')
    .select('full_name,job_title,email,email_status,email_confidence,company_name,country,linkedin_url,is_safe_to_send,pattern_used')
    .gte('email_confidence', parseFloat(min_confidence))
    .not('email', 'is', null)
    .order('email_confidence', { ascending: false });
  if (country) q = q.eq('country', country);
  if (is_safe === 'true') q = q.eq('is_safe_to_send', true);

  const { data, error } = await q.limit(5000);
  if (error) return res.status(500).json({ error });

  const headers = ['Full Name', 'Job Title', 'Email', 'Status', 'Confidence %', 'Company', 'Country', 'LinkedIn URL', 'Safe to Send', 'Pattern Used'];
  const rows = data.map(p => [
    p.full_name || '',
    p.job_title || '',
    p.email     || '',
    p.email_status || '',
    p.email_confidence ? Math.round(p.email_confidence * 100) + '%' : '',
    p.company_name || '',
    p.country      || '',
    p.linkedin_url || '',
    p.is_safe_to_send ? 'YES' : 'NO',
    p.pattern_used || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="kishor_leads_${country || 'all'}_${Date.now()}.csv"`);
  res.send(csv);
});

// Nightly learning job (call via cron or manually)
app.post('/nightly-learning', async (req, res) => {
  if (job.running) return res.status(400).json({ error: 'Pipeline running' });
  addLog('Nightly learning job triggered...');
  runNightlyLearning(addLog)
    .then(r => addLog('Nightly learning done: ' + JSON.stringify(r)))
    .catch(e => addLog('Error: ' + e.message));
  res.json({ message: 'Nightly learning started' });
});

// Verify single email
app.get('/verify-email', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });
  const { smtpVerify } = require('./agent4-email');
  const result = await smtpVerify(email);
  res.json({ email, ...result });
});

// Legacy compatibility routes
app.get('/contacts', async (req, res) => {
  const { country, company_id } = req.query;
  let q = supabase.from('people').select('*').order('created_at', { ascending: false });
  if (country)    q = q.eq('country', country);
  if (company_id) q = q.eq('company_id', company_id);
  const { data, error } = await q.limit(1000);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/crm', (req, res) => {
  res.sendFile(path.join(__dirname, 'people-crm-v2.html'));
});

// Root
app.get('/', (req, res) => {
  res.json({
    name:    'Kishor Lead Engine v8.0',
    status:  job.running ? `Running: ${job.stage}` : 'Idle',
    endpoints: {
      'POST /run':           'Start full pipeline — body: { country, skipAgent1, skipAgent2, maxApolloCredits }',
      'POST /run/agent1':    'Run Agent 1 only — body: { country }',
      'POST /run/agent2':    'Run Agent 2 only — body: { country, limit }',
      'POST /run/agent3':    'Run Agent 3 only — body: { country }',
      'POST /run/agent4':    'Run Agent 4 only — body: { country, maxApolloCredits, dryRun }',
      'POST /stop':          'Stop current job',
      'GET /status':         'Live pipeline status + logs',
      'GET /stats':          'DB counts',
      'GET /companies':      'Companies — ?country=Denmark&min_score=50',
      'GET /people':         'People — ?country=Denmark&email_status=verified&is_safe=true',
      'GET /export/csv':     'Export verified leads as CSV — ?country=Denmark&is_safe=true',
      'GET /verify-email':   'Verify single email — ?email=test@example.com',
      'POST /nightly-learning': 'Trigger nightly pattern learning job',
      'GET /dashboard':      'Main dashboard UI',
      'GET /crm':            'People CRM',
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Kishor Lead Engine v8.0 running on port ${PORT}`));

const express = require('express');
const { exec, spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let currentProcess = null;
let isRunning = false;
let progress = { step: '', pct: 0, log: [] };

// ─── STATS ───────────────────────────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  const [c, ct] = await Promise.all([
    supabase.from('companies').select('*', { count: 'exact', head: true }),
    supabase.from('contacts').select('*', { count: 'exact', head: true })
  ]);
  res.json({ companies: c.count || 0, contacts: ct.count || 0 });
});

// ─── START SEARCH ─────────────────────────────────────────────────────────────
app.post('/search', async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: 'Country required' });
  if (isRunning) return res.status(400).json({ error: 'Already running. Please wait or stop first.' });

  isRunning = true;
  progress = { step: 'Starting', pct: 5, log: [`🚀 Starting search for ${country}...`] };
  res.json({ message: 'Search started', country });

  // ── Step 1: Run Agent 1 (Query Builder) ──
  progress.log.push(`▶ Agent 1: Generating search queries for ${country}...`);
  progress.step = 'Agent 1';
  progress.pct = 10;

  const agent1 = exec(`node agent1-query-builder.js "${country}"`);

  agent1.stdout.on('data', (data) => {
    const line = data.trim();
    if (!line) return;
    progress.log.push(line);
    if (progress.log.length > 100) progress.log.shift();
    progress.pct = Math.min(35, progress.pct + 1);
  });

  agent1.stderr.on('data', (data) => {
    progress.log.push('⚠️ ' + data.trim());
  });

  agent1.on('close', (code1) => {
    if (code1 !== 0) {
      progress.log.push(`❌ Agent 1 failed with code ${code1}`);
      isRunning = false;
      progress.step = 'Error';
      progress.pct = 0;
      return;
    }

    progress.log.push(`✅ Agent 1 complete! Queries generated for ${country}`);
    progress.step = 'Agent 2';
    progress.pct = 40;

    // ── Step 2: Run Agent 2 (Discovery) ──
    progress.log.push(`▶ Agent 2: Discovering companies in ${country}...`);

    const agent2 = exec(`node agent2-discovery.js`);
    currentProcess = agent2;

    agent2.stdout.on('data', (data) => {
      const line = data.trim();
      if (!line) return;
      progress.log.push(line);
      if (progress.log.length > 100) progress.log.shift();
      progress.pct = Math.min(95, progress.pct + 1);
    });

    agent2.stderr.on('data', (data) => {
      progress.log.push('⚠️ ' + data.trim());
    });

    agent2.on('close', (code2) => {
      isRunning = false;
      currentProcess = null;

      if (code2 !== 0) {
        progress.log.push(`❌ Agent 2 failed with code ${code2}`);
        progress.step = 'Error';
        progress.pct = 0;
        return;
      }

      progress.pct = 100;
      progress.step = 'Done';
      progress.log.push(`✅ Agent 2 complete! Companies saved to Supabase.`);
      progress.log.push(`🎉 Search for ${country} finished! Check the Companies tab.`);
    });
  });
});

// ─── STOP ─────────────────────────────────────────────────────────────────────
app.post('/stop', (req, res) => {
  if (currentProcess) {
    currentProcess.kill();
    isRunning = false;
    currentProcess = null;
  }
  progress.step = 'Stopped';
  progress.log.push('⏹ Stopped by user.');
  res.json({ message: 'Stopped' });
});

// ─── STATUS ───────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ isRunning, progress });
});

// ─── COMPANIES ────────────────────────────────────────────────────────────────
app.get('/companies', async (req, res) => {
  const { country, status } = req.query;
  let query = supabase.from('companies').select('*').order('created_at', { ascending: false });
  if (country) query = query.eq('country', country);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.patch('/companies/:id', async (req, res) => {
  const { error } = await supabase
    .from('companies')
    .update({ status: req.body.status })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

// ─── CONTACTS ─────────────────────────────────────────────────────────────────
app.get('/contacts', async (req, res) => {
  const { data, error } = await supabase.from('contacts').select('*').limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ─── ROOT ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'Kishor Lead Engine API is running!',
    version: '2.1',
    endpoints: {
      'POST /search': 'Start search { country: "Germany" }',
      'GET /status': 'Check progress',
      'POST /stop': 'Stop current search',
      'GET /companies': 'Get all companies',
      'GET /stats': 'Get counts',
      'GET /contacts': 'Get all contacts',
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Kishor Lead Engine API running on port ${PORT}`));

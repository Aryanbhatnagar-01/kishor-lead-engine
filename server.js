const express = require('express');
const { exec } = require('child_process');
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

app.get('/stats', async (req, res) => {
  const [c, ct] = await Promise.all([
    supabase.from('companies').select('*', { count: 'exact', head: true }),
    supabase.from('contacts').select('*', { count: 'exact', head: true })
  ]);
  res.json({ companies: c.count || 0, contacts: ct.count || 0 });
});

app.post('/search', async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: 'Country required' });
  if (isRunning) return res.status(400).json({ error: 'Already running' });
  isRunning = true;
  progress = { step: 'Starting', pct: 5, log: [`Starting search for ${country}`] };
  res.json({ message: 'Search started', country });
  currentProcess = exec(`node index.js "${country}"`, (err) => {
    isRunning = false;
    currentProcess = null;
    progress.pct = 100;
    progress.step = 'Done';
    progress.log.push('Search complete!');
  });
  currentProcess.stdout.on('data', (data) => {
    const line = data.trim();
    progress.log.push(line);
    if (progress.log.length > 50) progress.log.shift();
    if (line.includes('Agent 1')) { progress.step = 'Agent 1'; progress.pct = 20; }
    if (line.includes('Agent 2')) { progress.step = 'Agent 2'; progress.pct = 50; }
    if (line.includes('Agent 3')) { progress.step = 'Agent 3'; progress.pct = 80; }
    if (line.includes('complete')) { progress.pct = 100; }
  });
});

app.post('/stop', (req, res) => {
  if (currentProcess) { currentProcess.kill(); isRunning = false; currentProcess = null; }
  progress.step = 'Stopped';
  progress.log.push('Stopped by user');
  res.json({ message: 'Stopped' });
});

app.get('/status', (req, res) => {
  res.json({ isRunning, progress });
});

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
  const { error } = await supabase.from('companies').update({ status: req.body.status }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

app.get('/contacts', async (req, res) => {
  const { data, error } = await supabase.from('contacts').select('*').limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/', (req, res) => {
  res.json({ status: 'Kishor Lead Engine API is running!', version: '2.0' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Kishor Lead Engine API running on port ${PORT}`));

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

// Start search
app.post('/search', async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: 'Country required' });
  if (isRunning) return res.status(400).json({ error: 'Already running' });

  isRunning = true;
  res.json({ message: 'Search started', country });

  currentProcess = exec(`node index.js "${country}"`, (err) => {
    isRunning = false;
    currentProcess = null;
  });
});

// Stop search
app.post('/stop', (req, res) => {
  if (currentProcess) {
    currentProcess.kill();
    isRunning = false;
    currentProcess = null;
  }
  res.json({ message: 'Stopped' });
});

// Get status
app.get('/status', (req, res) => {
  res.json({ isRunning });
});

// Get companies from Supabase
app.get('/companies', async (req, res) => {
  const { country, status } = req.query;
  let query = supabase.from('companies').select('*');
  if (country) query = query.eq('country', country);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Update company status
app.patch('/companies/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { data, error } = await supabase
    .from('companies')
    .update({ status })
    .eq('id', id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Get contacts
app.get('/contacts', async (req, res) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .limit(500);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kishor Lead Engine API running on port ${PORT}`));

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');
const fs      = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app    = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── LOAD CLIENT CONFIGS ──────────────────────────────────
// Each client gets a JSON file in /clients. Add a new restaurant
// by dropping in a new file — no code changes needed.
function loadClients() {
  const dir = path.join(__dirname, 'clients');
  const configs = {};
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          configs[cfg.slug] = cfg;
          console.log(`✅ Loaded client: ${cfg.slug}`);
        } catch (e) {
          console.error(`❌ Failed to load ${f}:`, e.message);
        }
      });
  }
  return configs;
}

const CLIENTS = loadClients();

// Which client this instance serves. Set CLIENT_SLUG env var on Render
// for each deployment. Defaults to 'roosevelts' for backward compat.
const DEFAULT_SLUG = process.env.CLIENT_SLUG || 'roosevelts';

function getClient(slug) {
  return CLIENTS[slug || DEFAULT_SLUG] || null;
}

// ─── PUBLIC CONFIG ENDPOINT ───────────────────────────────
// Returns everything except system_prompt and sheets_url (server-side only)
app.get('/api/config', (req, res) => {
  const cfg = getClient(req.query.slug);
  if (!cfg) return res.status(404).json({ error: 'client not found' });
  const { system_prompt, sheets_url, ...publicCfg } = cfg;
  res.json(publicCfg);
});

// ─── SHEETS LOGGING ───────────────────────────────────────
function logToSheets(sheetsUrl, data) {
  return new Promise((resolve) => {
    if (!sheetsUrl) return resolve(null);
    const body = JSON.stringify(data);
    function doRequest(targetUrl) {
      const parsed = new URL(targetUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req = https.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          https.get(res.headers.location, (r2) => {
            let rb = '';
            r2.on('data', c => rb += c);
            r2.on('end', () => { console.log(`📊 Sheets OK (${r2.statusCode})`); resolve(rb); });
          }).on('error', (err) => { console.error('❌ Redirect error:', err.message); resolve(null); });
          return;
        }
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => { console.log(`📊 Sheets response (${res.statusCode})`); resolve(responseBody); });
      });
      req.on('error', (err) => { console.error('❌ Sheets error:', err.message); resolve(null); });
      req.write(body);
      req.end();
    }
    doRequest(sheetsUrl);
  });
}

// ─── LEAD CAPTURE ─────────────────────────────────────────
const leads = [];

app.post('/api/lead', async (req, res) => {
  const slug = req.query.slug || DEFAULT_SLUG;
  const cfg  = getClient(slug);
  const { name, phone, date, time, party, ts } = req.body;
  const lead = { slug, name, phone, date, time, party, ts, type: 'reservation_lead' };
  leads.push(lead);
  console.log('📋 New lead:', lead);
  if (cfg?.sheets_url) logToSheets(cfg.sheets_url, lead).catch(console.error);
  res.json({ ok: true });
});

app.get('/api/leads', (req, res) => {
  const key = req.query.key;
  if (key !== process.env.LEADS_KEY) return res.status(401).json({ error: 'unauthorized' });
  const slug = req.query.slug;
  res.json(slug ? leads.filter(l => l.slug === slug) : leads);
});

// ─── INQUIRY LOGGING ──────────────────────────────────────
app.post('/api/inquiry', async (req, res) => {
  const slug = req.query.slug || DEFAULT_SLUG;
  const cfg  = getClient(slug);
  const data = { slug, ...req.body, type: req.body.type || 'inquiry', ts: req.body.ts || new Date().toISOString() };
  console.log('💬 New inquiry:', data);
  if (cfg?.sheets_url) logToSheets(cfg.sheets_url, data).catch(console.error);
  res.json({ ok: true });
});

// ─── CHAT ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const slug = req.query.slug || DEFAULT_SLUG;
  const cfg  = getClient(slug);
  if (!cfg) return res.status(404).json({ error: 'client not found' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const sanitized = messages
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    .slice(-20);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: cfg.system_prompt,
      messages: sanitized
    });
    const reply = response.content?.[0]?.text || `Give us a call at ${cfg.phone} and we'll help you out!`;
    res.json({ reply });

    // Log inquiry to Sheets (fire-and-forget, don't block response)
    const lastUserMsg = sanitized.filter(m => m.role === 'user').pop();
    if (cfg.sheets_url && lastUserMsg) {
      logToSheets(cfg.sheets_url, {
        slug,
        type: 'inquiry',
        message: lastUserMsg.content,
        response: reply,
        ts: new Date().toISOString()
      }).catch(console.error);
    }
  } catch (err) {
    console.error('Claude API error:', err.message);
    res.status(500).json({ error: 'API error', reply: `Give us a call at ${cfg?.phone || 'the restaurant'} — a real human will sort you out! 🍺` });
  }
});

// ─── FALLBACK ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lobbii chatbot (${DEFAULT_SLUG}) running on port ${PORT}`));

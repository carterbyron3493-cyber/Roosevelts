const https = require('https');
const CLIENTS = require('./clients-bundle.json');
const DEFAULT_SLUG = process.env.CLIENT_SLUG || 'roosevelts';

function sbInsert(table, row) {
  return new Promise((resolve) => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return resolve(null);
    const body = JSON.stringify(row);
    const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/${table}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => { res.resume(); resolve(null); });
    req.on('error', (e) => { console.error('Supabase error:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

function logToSheets(sheetsUrl, data) {
  return new Promise((resolve) => {
    if (!sheetsUrl) return resolve(null);
    const body = JSON.stringify(data);
    const parsed = new URL(sheetsUrl);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        https.get(res.headers.location, (r2) => { r2.resume(); resolve(null); }).on('error', () => resolve(null));
        return;
      }
      res.resume(); resolve(null);
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function claudeChat(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: systemPrompt,
      messages
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content?.[0]?.text) resolve(parsed.content[0].text);
          else reject(new Error(parsed.error?.message || 'Empty response'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const slug = event.queryStringParameters?.slug || DEFAULT_SLUG;
  const cfg = CLIENTS[slug];
  if (!cfg) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'client not found' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages array required' }) };
  }

  const sanitized = messages
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    .slice(-20);

  try {
    const reply = await claudeChat(cfg.system_prompt, sanitized);
    // Log inquiry fire-and-forget
    const lastUserMsg = sanitized.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      const inquiry = { slug, message: lastUserMsg.content, response: reply, ts: new Date().toISOString() };
      sbInsert('inquiries', inquiry).catch(console.error);
      if (cfg.sheets_url) logToSheets(cfg.sheets_url, { ...inquiry, type: 'inquiry' }).catch(console.error);
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error('Claude API error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'API error', reply: `Give us a call at ${cfg?.phone || 'the restaurant'} — a real human will sort you out! 🍺` })
    };
  }
};

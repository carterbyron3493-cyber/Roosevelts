const https = require('https');
const CLIENTS = require('./clients-bundle.json');
const DEFAULT_SLUG = process.env.CLIENT_SLUG || 'roosevelts';

function sbInsert(table, row) {
  return new Promise((resolve, reject) => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return reject(new Error('Supabase not configured'));
    }
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
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`Supabase ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const slug = event.queryStringParameters?.slug || DEFAULT_SLUG;
  const cfg = CLIENTS[slug];
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { name, phone, date, time, party, sms_opt_in, ts } = body;
  const lead = { slug, name, phone, date, time, party, sms_opt_in: sms_opt_in === true, ts: ts || new Date().toISOString() };

  console.log('📋 New lead:', lead);

  try {
    await sbInsert('leads', lead);
    console.log('✅ Lead saved to Supabase');
    if (cfg?.sheets_url) logToSheets(cfg.sheets_url, { ...lead, type: 'reservation_lead' }).catch(console.error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('❌ Lead save failed:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};

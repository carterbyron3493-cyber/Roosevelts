const https = require('https');
const CLIENTS = require('./clients-bundle.json');

function anthropicPing() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hi' }]
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
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

exports.handler = async () => {
  const modelOk = await anthropicPing();
  return {
    statusCode: modelOk ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: modelOk,
      apiKey: !!process.env.ANTHROPIC_API_KEY,
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      clients: Object.keys(CLIENTS),
      model: 'claude-haiku-4-5-20251001',
      modelOk
    })
  };
};

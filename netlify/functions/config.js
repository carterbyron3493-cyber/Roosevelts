const CLIENTS = require('./clients-bundle.json');
const DEFAULT_SLUG = process.env.CLIENT_SLUG || 'roosevelts';

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug || DEFAULT_SLUG;
  const cfg = CLIENTS[slug];
  if (!cfg) {
    return { statusCode: 404, body: JSON.stringify({ error: 'client not found' }) };
  }
  const { system_prompt, sheets_url, ...publicCfg } = cfg;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(publicCfg)
  };
};

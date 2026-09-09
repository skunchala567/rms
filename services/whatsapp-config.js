'use strict';
const db = require('../db/database');
const ENDPOINT = 'https://backend.api-wa.co/campaign/smartpingbsp/api/v2';
function defaults() {
  return { enabled: String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true',
    apiKey: process.env.SMARTPING_API_KEY || process.env.SMARTPING_AUTH_TOKEN || '',
    studentCampaign: process.env.SMARTPING_CAMPAIGN_NAME || 'staybacktransport',
    confirmationCampaign: process.env.SMARTPING_ADHOC_CONFIRMATION_CAMPAIGN || '',
    rejectionCampaign: process.env.SMARTPING_ADHOC_REJECTION_CAMPAIGN || '',
    userName: process.env.SMARTPING_USERNAME || 'Digital Caampus',
    countryCode: process.env.SMARTPING_COUNTRY_CODE || '',
    contactNo: process.env.SMARTPING_CONTACT_NO || '',
    source: process.env.SMARTPING_SOURCE || 'stay-back-route-management',
    endpoint: process.env.SMARTPING_API_URL || ENDPOINT };
}
async function getConfig() {
  const row = await db.get('SELECT config FROM whatsapp_settings WHERE id=1');
  return row ? { ...JSON.parse(row.config), origin: 'Settings' } : { ...defaults(), origin: 'Environment' };
}
function publicConfig(config) {
  const { apiKey, ...safe } = config;
  return { ...safe, hasApiKey: !!apiKey, endpoint: ENDPOINT };
}
async function saveConfig(body, userId) {
  if (!body || typeof body.enabled !== 'boolean') throw new Error('Choose whether live WhatsApp sending is enabled.');
  const data = { enabled: body.enabled, endpoint: ENDPOINT };
  for (const key of ['studentCampaign','confirmationCampaign','rejectionCampaign','userName','countryCode','contactNo','source']) {
    if (typeof body[key] !== 'string' || body[key].trim().length > 150) throw new Error(`Enter a valid ${key} (at most 150 characters).`);
    data[key] = body[key].trim();
  }
  if (data.countryCode && !/^\d{1,4}$/.test(data.countryCode)) throw new Error('Country code must contain 1–4 digits, without +.');
  if (data.contactNo && !/^\+?[\d ()-]{7,30}$/.test(data.contactNo)) throw new Error('Enter a valid fallback contact number.');
  if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 2000 || /\s/.test(body.apiKey.trim()))) throw new Error('Enter the API key without spaces.');
  if (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') throw new Error('Invalid clear API key setting.');
  await db.transaction(async t => {
    await t.run('INSERT IGNORE INTO whatsapp_settings (id, config) VALUES (1, ?)', [JSON.stringify(defaults())]);
    const existing = JSON.parse((await t.get('SELECT config FROM whatsapp_settings WHERE id=1 FOR UPDATE')).config);
    data.apiKey = body.clearApiKey ? '' : (body.apiKey || '').trim() || existing.apiKey;
    if (data.enabled && (!data.apiKey || !data.userName || !data.studentCampaign || !data.confirmationCampaign || !data.rejectionCampaign)) throw new Error('Live sending requires an API key, sender name, and all three approved campaign names.');
    await t.run('UPDATE whatsapp_settings SET config=?, updated_by=?, updated_at=NOW() WHERE id=1', [JSON.stringify(data), userId]);
  });
  return publicConfig({ ...data, origin: 'Settings' });
}
module.exports = { getConfig, publicConfig, saveConfig };

'use strict';
const db = require('../db/database');

async function getMapsSettings() {
  const saved = await db.get('SELECT browser_key, enabled, updated_at FROM google_maps_settings WHERE id=1');
  if (saved) return { browserKey: saved.browser_key, enabled: !!saved.enabled, source: 'Settings', updatedAt: saved.updated_at };
  const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY || '';
  return { browserKey, enabled: !!browserKey, source: browserKey ? 'Environment' : 'Not configured', updatedAt: null };
}
async function publicMapsConfig(req, res, next) {
  try {
    const config = await getMapsSettings();
    res.set('Cache-Control', 'no-store').json({ browserKey: config.enabled ? config.browserKey : '' });
  } catch (e) { next(e); }
}
module.exports = { getMapsSettings, publicMapsConfig };

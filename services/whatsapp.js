'use strict';

const http = require('http');
const https = require('https');

/**
 * WhatsApp notification service: SmartPing BSP via api-wa.co campaign API.
 *
 * Configure in .env:
 *   WHATSAPP_ENABLED=true
 *   SMARTPING_API_KEY=<your api-wa.co api key>
 *   SMARTPING_CAMPAIGN_NAME=staybacktransport
 *   SMARTPING_USERNAME=Digital Caampus
 *   SMARTPING_API_URL=https://backend.api-wa.co/campaign/smartpingbsp/api/v2
 *   SMARTPING_COUNTRY_CODE=91
 *
 * The approved campaign template's variables are sent in this order:
 *   [student_name, bus_number, tracking_link, contact_no]
 */

const DEFAULT_TEMPLATE =
  'Dear Parent,\n\n' +
  'Your ward {{student_name}} has been assigned to Bus {{bus_number}} for today\'s stay-back transport.\n\n' +
  'Live Tracking:\n{{tracking_link}}\n\n' +
  'Contact No: {{contact_no}}\n\n' +
  'Thank you.';

const DEFAULT_ENDPOINT = 'https://backend.api-wa.co/campaign/smartpingbsp/api/v2';
const TEMPLATE_PARAM_KEYS = ['student_name', 'bus_number', 'tracking_link', 'contact_no'];
const REQUEST_TIMEOUT_MS = Math.max(parseInt(process.env.SMARTPING_TIMEOUT_MS, 10) || 15000, 1000);

function renderTemplate(template, vars) {
  return String(template || DEFAULT_TEMPLATE).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  );
}

function apiKey() {
  return process.env.SMARTPING_API_KEY || process.env.SMARTPING_AUTH_TOKEN || '';
}

function endpoint() {
  return process.env.SMARTPING_API_URL || DEFAULT_ENDPOINT;
}

function isEnabled() {
  return String(process.env.WHATSAPP_ENABLED || '').trim().toLowerCase() === 'true' && !!apiKey();
}

function formatNumber(mobile) {
  let n = String(mobile || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.length === 11 && n.startsWith('0')) n = n.slice(1);

  const cc = String(process.env.SMARTPING_COUNTRY_CODE || '').replace(/\D/g, '');
  if (cc) {
    if (n.length === 10) n = cc + n;
    if (n.length === cc.length + 11 && n.startsWith(`${cc}0`)) n = cc + n.slice(cc.length + 1);
  }

  return n;
}

function isValidDestination(destination) {
  return /^\d{10,15}$/.test(destination);
}

function responseSummary(statusCode, text) {
  return `HTTP ${statusCode}: ${String(text || '').slice(0, 1000)}`;
}

function parseProviderResponse(statusCode, text) {
  const body = String(text || '');
  const result = { ok: statusCode >= 200 && statusCode < 300, data: null };

  try {
    result.data = JSON.parse(body);
  } catch (_) {
    return result;
  }

  const data = result.data || {};
  const values = collectProviderValues(data);

  if (data.success === false || data.ok === false) result.ok = false;
  if (values.some((v) => ['error', 'failed', 'failure', 'fail', 'false', 'rejected', 'unauthorized', 'invalid'].includes(v))) {
    result.ok = false;
  }
  if (values.some((v) => /(invalid|missing|required|denied|unauthori[sz]ed|reject|fail|error|not\s+found)/.test(v))) {
    result.ok = false;
  }
  if (Number(data.statusCode) >= 400 || Number(data.code) >= 400) result.ok = false;

  return result;
}

function collectProviderValues(value, depth = 0) {
  if (value === undefined || value === null || depth > 4) return [];
  if (typeof value !== 'object') return [String(value).toLowerCase()];
  if (Array.isArray(value)) return value.flatMap((item) => collectProviderValues(item, depth + 1));

  const interestingKeys = new Set([
    'success',
    'ok',
    'status',
    'statusCode',
    'code',
    'error',
    'errors',
    'errorMessage',
    'message',
    'reason',
    'description',
  ]);

  return Object.entries(value).flatMap(([key, nested]) =>
    interestingKeys.has(key) || (nested && typeof nested === 'object')
      ? collectProviderValues(nested, depth + 1)
      : []
  );
}

function templateParams(vars) {
  return TEMPLATE_PARAM_KEYS.map((key) => vars[key] || '');
}

async function postJson(url, payload) {
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      return { statusCode: resp.status, text: await resp.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const client = u.protocol === 'http:' ? http : https;

    const req = client.request({
      method: 'POST',
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: `${u.pathname}${u.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

async function sendOne({ mobile, studentName, busNumber, trackingLink, contactNo, template }) {
  const contact = contactNo || process.env.SMARTPING_CONTACT_NO || '';
  const destination = formatNumber(mobile);
  const vars = {
    student_name: studentName || '',
    bus_number: busNumber || '',
    tracking_link: trackingLink || '',
    contact_no: contact,
  };
  const message = renderTemplate(template, vars);

  if (!mobile) {
    return { status: 'Failed', message, response: 'No mobile number on record.' };
  }
  if (!isValidDestination(destination)) {
    return {
      status: 'Failed',
      message,
      response: `Invalid WhatsApp destination after formatting: "${destination || '(empty)'}".`,
    };
  }

  if (!isEnabled()) {
    return {
      status: 'Sent',
      message,
      response: 'SIMULATED (WhatsApp disabled). Set WHATSAPP_ENABLED=true and SMARTPING_API_KEY to send for real.',
    };
  }

  const payload = {
    apiKey: apiKey(),
    campaignName: process.env.SMARTPING_CAMPAIGN_NAME || 'staybacktransport',
    destination,
    userName: process.env.SMARTPING_USERNAME || 'Digital Caampus',
    templateParams: templateParams(vars),
    source: process.env.SMARTPING_SOURCE || 'stay-back-route-management',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
    attributes: {},
    paramsFallbackValue: { FirstName: 'user' },
  };

  try {
    const resp = await postJson(endpoint(), payload);
    const provider = parseProviderResponse(resp.statusCode, resp.text);

    return {
      status: provider.ok ? 'Sent' : 'Failed',
      message,
      response: responseSummary(resp.statusCode, resp.text),
    };
  } catch (err) {
    const reason = err && err.name === 'AbortError'
      ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : err.message;

    return { status: 'Failed', message, response: reason };
  }
}

module.exports = {
  sendOne,
  renderTemplate,
  isEnabled,
  formatNumber,
  isValidDestination,
  parseProviderResponse,
  DEFAULT_TEMPLATE,
  TEMPLATE_PARAM_KEYS,
};

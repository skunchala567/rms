'use strict';

/**
 * WhatsApp notification service — SmartPing BSP via api-wa.co campaign API.
 *
 * Endpoint (from the provided CURL):
 *   POST https://backend.api-wa.co/campaign/smartpingbsp/api/v2
 *   {
 *     "apiKey": "...", "campaignName": "staybacktransport",
 *     "destination": "<mobile>", "userName": "Digital Caampus",
 *     "templateParams": [ ... ], "source": "...",
 *     "media": {}, "buttons": [], "carouselCards": [], "location": {},
 *     "attributes": {}, "paramsFallbackValue": { "FirstName": "user" }
 *   }
 *
 * `templateParams` fills the variables of the approved WhatsApp template that is
 * attached to the "staybacktransport" campaign, IN ORDER. This app sends:
 *     [ student_name, bus_number, tracking_link ]
 * If your approved template has a different number/order of variables, adjust
 * TEMPLATE_PARAMS below to match it.
 *
 * Configure in .env:
 *   WHATSAPP_ENABLED=true
 *   SMARTPING_API_KEY=<your api-wa.co api key>
 *   SMARTPING_CAMPAIGN_NAME=staybacktransport
 *   SMARTPING_USERNAME=Digital Caampus
 *   SMARTPING_API_URL=https://backend.api-wa.co/campaign/smartpingbsp/api/v2
 *   SMARTPING_COUNTRY_CODE=91        (optional: prefixed to 10-digit numbers)
 *
 * While WHATSAPP_ENABLED is not "true" (or no API key is set), it runs in
 * SIMULATION mode: messages are logged as "Sent" but nothing is actually sent.
 */

const DEFAULT_TEMPLATE =
  'Dear Parent,\n\n' +
  'Your ward {{student_name}} has been assigned to Bus {{bus_number}} for today\'s stay-back transport.\n\n' +
  'Live Tracking:\n{{tracking_link}}\n\n' +
  'Thank you.';

const DEFAULT_ENDPOINT = 'https://backend.api-wa.co/campaign/smartpingbsp/api/v2';

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
  return String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true' && !!apiKey();
}

// Normalize a phone number: keep digits, optionally prefix a country code.
function formatNumber(mobile) {
  let n = String(mobile || '').replace(/\D/g, '');
  const cc = (process.env.SMARTPING_COUNTRY_CODE || '').replace(/\D/g, '');
  if (cc && n.length === 10) n = cc + n; // bare 10-digit local number -> add country code
  return n;
}

/**
 * @param {{mobile, studentName, busNumber, trackingLink, template?}} opts
 * @returns {Promise<{status:'Sent'|'Failed', message:string, response:string}>}
 */
async function sendOne({ mobile, studentName, busNumber, trackingLink, template }) {
  const vars = {
    student_name: studentName || '',
    bus_number: busNumber || '',
    tracking_link: trackingLink || '',
  };
  const message = renderTemplate(template, vars); // human-readable copy for the log/preview

  if (!isEnabled()) {
    return {
      status: 'Sent',
      message,
      response: 'SIMULATED (WhatsApp disabled). Set WHATSAPP_ENABLED=true and SMARTPING_API_KEY to send for real.',
    };
  }
  if (!mobile) {
    return { status: 'Failed', message, response: 'No mobile number on record.' };
  }

  // The approved campaign template's variables, in order.
  const TEMPLATE_PARAMS = [studentName || '', busNumber || '', trackingLink || ''];

  const payload = {
    apiKey: apiKey(),
    campaignName: process.env.SMARTPING_CAMPAIGN_NAME || 'staybacktransport',
    destination: formatNumber(mobile),
    userName: process.env.SMARTPING_USERNAME || 'Digital Caampus',
    templateParams: TEMPLATE_PARAMS,
    source: process.env.SMARTPING_SOURCE || 'stay-back-route-management',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
    attributes: {},
    paramsFallbackValue: { FirstName: 'user' },
  };

  try {
    const resp = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();

    let ok = resp.ok;
    try {
      const j = JSON.parse(text);
      // api-wa.co returns 200 with a success flag / message; treat explicit failures as Failed.
      if (j && (j.success === false || j.status === 'error' || j.error || j.errorMessage)) ok = false;
    } catch (_) { /* non-JSON body — rely on HTTP status */ }

    return {
      status: ok ? 'Sent' : 'Failed',
      message,
      response: `HTTP ${resp.status}: ${text.slice(0, 1000)}`,
    };
  } catch (err) {
    return { status: 'Failed', message, response: err.message };
  }
}

module.exports = { sendOne, renderTemplate, isEnabled, DEFAULT_TEMPLATE };

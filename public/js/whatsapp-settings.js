/* SmartPing configuration; secrets are never returned to the browser. */
Pages.whatsappSettings = async function (content) {
  const { esc, toast } = UI;
  content.innerHTML = UI.spinner();
  const config = await API.get('/settings/whatsapp');
  if (!content.isConnected) return;
  const field = (label, key, help = '') => `<div class="field"><label for="wa-${key}">${esc(label)}</label><input id="wa-${key}" name="${key}" maxlength="150" value="${esc(config[key] || '')}">${help ? `<small>${esc(help)}</small>` : ''}</div>`;
  const mappings = [
    ['Student transport allocation', 'studentCampaign', ['Student name','Vehicle number','Tracking link','Driver / fallback contact']],
    ['Adhoc confirmation', 'confirmationCampaign', ['Requestor name','Request reference','Subject','Travel time (IST)','Trip type','Pickup name','Destination name','Passenger count','Vehicle number','Driver name / phone','Attender name / phone','Pickup map link','Destination map link']],
    ['Adhoc rejection', 'rejectionCampaign', ['Requestor name','Request reference','Subject','Travel time (IST)','Rejection reason']],
  ];
  content.innerHTML = `<div class="card"><h2>WhatsApp configuration</h2><p>Connect SmartPing and select the approved campaign for each message sent by the application.</p>
    <form id="whatsapp-settings-form">
      <div class="field"><label for="wa-api-key">SmartPing API key</label><input id="wa-api-key" name="apiKey" type="password" maxlength="2000" autocomplete="new-password" placeholder="${config.hasApiKey ? 'Key saved — leave blank to keep it' : 'Paste your SmartPing API key'}"><small id="wa-key-status">${config.hasApiKey ? 'An API key is configured. The saved value is never displayed.' : 'No API key configured.'}</small></div>
      <p><label><input type="checkbox" name="clearApiKey"> Remove the saved API key</label></p>
      <div class="form-grid">${field('SmartPing user / sender name','userName')}${field('Default country code','countryCode','Digits only, e.g. 91. Used for local 10-digit numbers.')}${field('Fallback contact number (optional)','contactNo','Used when a student allocation has no driver contact.')}${field('Message source','source')}</div>
      <p>Provider endpoint: <code>${esc(config.endpoint)}</code></p>
      <h3>Message campaigns</h3><p>Enter the exact campaign names approved in SmartPing. The application fills the variables below from the student or request record, in this order.</p>
      ${mappings.map(([label,key,variables]) => `<section style="margin:20px 0">${field(label + ' campaign',key)}<details><summary>Template variables (${variables.length})</summary><ol>${variables.map(v => `<li>${esc(v)}</li>`).join('')}</ol></details></section>`).join('')}
      <p>Template wording is managed and approved in SmartPing. These settings select the campaigns; they do not create or approve provider templates.</p>
      <p><label><input type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''}> Enable live WhatsApp sending</label></p>
      <p>When enabled, allocation notifications and adhoc decisions send real messages. Saving these settings sends no messages. Leave disabled until all three campaigns are ready.</p>
      <div id="wa-save-status" role="status" aria-live="polite">${config.enabled ? 'Live sending enabled' : 'Simulation mode — no messages sent'} · ${esc(config.origin)}</div>
      <button class="btn" style="margin-top:16px" type="submit">Save WhatsApp settings</button>
    </form></div>`;
  const form = content.querySelector('form');
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    data.enabled = form.elements.enabled.checked; data.clearApiKey = form.elements.clearApiKey.checked;
    try {
      const saved = await API.put('/settings/whatsapp', data);
      form.elements.apiKey.value = ''; form.elements.clearApiKey.checked = false;
      form.elements.apiKey.placeholder = saved.hasApiKey ? 'Key saved — leave blank to keep it' : 'Paste your SmartPing API key';
      content.querySelector('#wa-key-status').textContent = saved.hasApiKey ? 'API key configured.' : 'No API key configured.';
      content.querySelector('#wa-save-status').textContent = `Saved. ${saved.enabled ? 'Live WhatsApp sending is enabled.' : 'Simulation mode — no messages will be sent.'} Changes apply to the next message; no restart needed.`;
      toast('WhatsApp settings saved.', 'success');
    } catch (e) { content.querySelector('#wa-save-status').textContent = e.message; }
    finally { button.disabled = false; }
  };
};

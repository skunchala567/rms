/* Public submission and authenticated incharge review. */
(() => {
  const { esc, toast } = UI;
  const field = (label, name, type = 'text', extra = '', required = true) => `<div class="field"><label for="tr-${name}">${esc(label)}</label><input id="tr-${name}" name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></div>`;
  const date = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const locationLink = (name, lat, lng) => `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(Number(lat) + ',' + Number(lng))}" title="Open location in Google Maps">${esc(name)}</a>`;
  Pages.publicTransportRequest = async c => {
    const key = crypto.randomUUID();
    c.innerHTML = `<main class="transport-public"><a href="#/login">← Staff sign in</a>
      <div class="section-head"><div><h1>Request adhoc transport</h1><p>No login needed. Submit your journey for review by the transport team.</p></div></div>
      <form id="transport-public-form" class="card">
        <h2>Your details</h2><div class="form-grid">
          ${field('Requestor name', 'requestor_name', 'text', 'maxlength="150" autocomplete="name"')}
          ${field('WhatsApp number (with country code)', 'mobile', 'tel', 'maxlength="30" placeholder="+91 9876543210" autocomplete="tel"')}
        </div><h2>Journey details</h2><div class="form-grid">
          ${field('Subject', 'subject', 'text', 'maxlength="200"')}
          ${field('Number of persons travelling', 'persons', 'number', 'min="1" max="1000" step="1"')}
        </div><div class="field"><label for="tr-reason">Detailed reason for travel</label><textarea id="tr-reason" name="reason" required maxlength="5000" rows="4"></textarea></div>
        <div class="form-grid">
          ${field('Pickup / from location name', 'origin_name', 'text', 'maxlength="200"')}
          ${field('Destination name', 'destination_name', 'text', 'maxlength="200"')}
          <div class="field"><label for="tr-trip_type">Trip type</label><select id="tr-trip_type" name="trip_type"><option>Drop</option><option>Round trip</option></select></div>
          ${field('Travel date and time (IST)', 'travel_at', 'datetime-local')}
          ${field('Expected end / return date and time (IST)', 'end_at', 'datetime-local')}
        </div>
        <h2>Select pickup and destination on the map</h2>
        <p>Search for a pickup and destination, or select which point to place and tap the map. Drag the points to adjust them.</p>
        <div class="form-grid" id="location-search-fields">
          ${['from', 'to'].map(point => `<div class="field"><label for="search-${point}">${point === 'from' ? 'Search pickup in Google Maps' : 'Search destination in Google Maps'}</label><div id="search-host-${point}"><input id="search-${point}" type="search" placeholder="Search a place, address or landmark" autocomplete="off"><button type="button" class="btn secondary sm" data-google-search="${point}">Search Google Maps ↗</button></div><p id="selected-${point}" class="muted" role="status">No ${point === 'from' ? 'pickup' : 'destination'} selected</p></div>`).join('')}
        </div><p id="location-search-help" role="status"></p>
        <div class="btn-row"><label><input type="radio" name="map_point" value="from" checked> Pickup</label><label><input type="radio" name="map_point" value="to"> Destination</label><button type="button" class="btn secondary sm" id="locate-me">Use my location</button></div>
        <div id="transport-map" class="transport-map" aria-label="Journey location map"></div><p id="map-status" role="status"></p>
        ${['from_lat', 'from_lng', 'to_lat', 'to_lng'].map(name => `<input type="hidden" name="${name}">`).join('')}
        <p>The transport team will use your details to review this request and send a confirmation or rejection to your WhatsApp number.</p>
        <div id="request-result" role="status" aria-live="polite"></div>
        <button class="btn" id="submit-transport">Submit transport request</button>
      </form></main>`;
    const form = c.querySelector('form');
    const result = c.querySelector('#request-result');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      if (['from_lat', 'from_lng', 'to_lat', 'to_lng'].some(name => !data[name])) {
        result.textContent = 'Please select both pickup and destination on the map or from search results.';
        result.className = 'alert error';
        c.querySelector('#location-search-fields').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      data.submission_key = key;
      data.travel_at = new Date(data.travel_at + ':00+05:30').toISOString();
      data.end_at = new Date(data.end_at + ':00+05:30').toISOString();
      const button = c.querySelector('#submit-transport'); button.disabled = true; button.textContent = 'Submitting…'; result.textContent = '';
      try {
        const saved = await API.post('/transport-requests', data);
        form.innerHTML = `<div class="transport-success"><h2>Request submitted</h2><p>Your reference is <strong>${esc(saved.reference)}</strong>. Please save it.</p><p>Your request is pending review. The transport team will send the decision to your WhatsApp number.</p><a class="btn secondary" href="#/login">Back to sign in</a></div>`;
      } catch (error) { result.textContent = error.message; result.className = 'alert error'; button.disabled = false; button.textContent = 'Submit transport request'; }
    });
    await TransportLocationPicker.mount(c, form);

  };
  Pages.transportRequests = async c => {
    let status = 'Pending'; let page = 1;
    c.innerHTML = `<div class="section-head"><div><h2>Adhoc transport requests</h2><p>Review journeys, allocate a vehicle, and notify requestors.</p></div><a class="btn secondary" href="#/request-transport" target="_blank" rel="noopener">Open public form</a></div>
      <div class="card"><div class="toolbar"><label for="request-filter">Status</label><select id="request-filter"><option>Pending</option><option>Accepted</option><option>Rejected</option><option>All</option></select><button class="btn secondary" id="refresh-requests">Refresh</button><button class="btn secondary" id="copy-request-link">Copy public form link</button></div><div id="transport-list"></div><div class="pagination" id="transport-pager"></div></div>`;
    const list = c.querySelector('#transport-list');
    async function load() {
      list.innerHTML = UI.spinner();
      try {
        const data = await API.get(`/transport-requests?status=${status}&page=${page}`);
        list.innerHTML = data.rows.length ? data.rows.map(r => `<article class="transport-request"><div class="section-head"><div><strong>${esc(r.subject)}</strong><p>${esc(r.reference)} · ${esc(r.status)}</p></div><button class="btn secondary sm" data-review="${r.id}">${r.status === 'Pending' ? 'Review request' : 'View details'}</button></div><p>${esc(r.requestor_name)} · ${esc(r.persons)} persons · ${esc(r.trip_type)}</p><p>${locationLink(r.origin_name, r.from_lat, r.from_lng)} → ${locationLink(r.destination_name, r.to_lat, r.to_lng)}</p><p>${esc(date(r.travel_at))} — ${esc(date(r.end_at))}</p>${r.message_status ? `<p>WhatsApp: <strong>${esc(r.message_status === 'Sent' ? 'Accepted by provider' : r.message_status)}</strong></p>` : ''}</article>`).join('') : '<div class="empty">No requests in this status.</div>';
        list.querySelectorAll('[data-review]').forEach(button => button.onclick = () => review(data.rows.find(r => String(r.id) === button.dataset.review)));
        c.querySelector('#transport-pager').innerHTML = `<button class="btn secondary sm" id="request-prev" ${page === 1 ? 'disabled' : ''}>Previous</button><span>${data.total} requests · Page ${page}</span><button class="btn secondary sm" id="request-next" ${page * 25 >= data.total ? 'disabled' : ''}>Next</button>`;
        c.querySelector('#request-prev').onclick = () => { page--; load(); }; c.querySelector('#request-next').onclick = () => { page++; load(); };
      } catch (e) { list.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
    }
    async function review(r) {
      let vehicles = [];
      if (r.status === 'Pending') {
        try { vehicles = await API.get(`/transport-requests/${r.id}/vehicles`); } catch (e) { toast(e.message, 'error'); return; }
      }
      UI.modal({ title: r.reference, size: 'lg', body: `<h2>${esc(r.subject)}</h2><p>${esc(r.requestor_name)} · ${esc(r.mobile)}</p><p class="transport-reason">${esc(r.reason)}</p><p>${esc(r.persons)} persons · ${esc(r.trip_type)}</p><p>${esc(date(r.travel_at))} — ${esc(date(r.end_at))}</p><p>From: ${locationLink(r.origin_name, r.from_lat, r.from_lng)}</p><p>To: ${locationLink(r.destination_name, r.to_lat, r.to_lng)}</p>
        ${r.status === 'Pending' ? `<form id="decision-form"><div class="field"><label for="decision-status">Decision</label><select id="decision-status" name="status"><option value="Accepted">Accept and allocate vehicle</option><option value="Rejected">Reject with reason</option></select></div>
          <div id="allocation-fields"><p>Available vehicles have enough seats and no overlapping adhoc booking. Vehicles with school trips on these dates are excluded. Verify other operational commitments before confirming.</p><div class="field"><label for="decision-vehicle">Available vehicle</label><select id="decision-vehicle" name="bus_id" required><option value="">${vehicles.length ? 'Select vehicle' : 'No vehicles available'}</option>${vehicles.map(b => `<option value="${b.id}">${esc(b.bus_number)} · ${b.seating_capacity} seats · Route ${esc(b.route_number)}</option>`).join('')}</select></div><div class="form-grid">
          ${field('Driver name', 'driver_name', 'text', 'maxlength="150"')}${field('Driver mobile', 'driver_mobile', 'tel', 'maxlength="30"')}${field('Attender name (optional)', 'attender_name', 'text', 'maxlength="150"', false)}${field('Attender mobile (optional)', 'attender_mobile', 'tel', 'maxlength="30"', false)}</div></div>
          <div id="rejection-fields" hidden><div class="field"><label for="decision-reason">Rejection reason</label><textarea id="decision-reason" name="rejection_reason" maxlength="2000" rows="4" disabled></textarea></div></div><p>The decision triggers a WhatsApp update using the configured campaign.</p><div id="decision-error" role="alert"></div><button class="btn" id="save-decision">Confirm decision</button></form>` : `<p><strong>${esc(r.status)}</strong>${r.status === 'Accepted' ? ` · Vehicle ${esc(r.vehicle_number)}<br>Driver: ${esc(r.driver_name)} / ${esc(r.driver_mobile)}<br>Attender: ${esc(r.attender_name || 'None')} ${esc(r.attender_mobile || '')}` : `: ${esc(r.rejection_reason)}`}</p><p>WhatsApp: ${esc(r.message_status === 'Sent' ? 'Accepted by provider' : r.message_status || 'Pending')}</p><p>${esc(r.provider_response || '')}</p><pre class="transport-message">${esc(r.message || '')}</pre>${r.message_status !== 'Sent' ? '<p>If a previous attempt timed out, check provider history before retrying to avoid a duplicate message.</p><button class="btn secondary" id="retry-notification">Retry WhatsApp</button>' : ''}`}`,
        onMount: (el, close) => {
          if (r.status !== 'Pending') {
            const retry = el.querySelector('#retry-notification');
            if (retry) retry.onclick = async () => { retry.disabled = true; try { const result = await API.post(`/transport-requests/${r.id}/retry`, {}); toast(`WhatsApp: ${result.status}`); close(); load(); } catch (e) { toast(e.message, 'error'); retry.disabled = false; } };
            return;
          }
          const form = el.querySelector('#decision-form');
          el.querySelector('#decision-vehicle').onchange = e => {
            const b = vehicles.find(v => String(v.id) === e.target.value) || {};
            form.elements.driver_name.value = b.driver_name || ''; form.elements.driver_mobile.value = b.driver_mobile || '';
          };
          el.querySelector('#decision-status').onchange = e => {
            const reject = e.target.value === 'Rejected';
            el.querySelector('#allocation-fields').hidden = reject; el.querySelector('#rejection-fields').hidden = !reject;
            el.querySelectorAll('#allocation-fields input, #allocation-fields select').forEach(input => input.disabled = reject);
            form.elements.rejection_reason.disabled = !reject; form.elements.rejection_reason.required = reject;
          };
          form.onsubmit = async e => {
            e.preventDefault(); if (!form.reportValidity()) return;
            const button = el.querySelector('#save-decision'); button.disabled = true;
            try { const result = await API.post(`/transport-requests/${r.id}/decision`, Object.fromEntries(new FormData(form))); toast(`Decision saved. WhatsApp: ${result.notification.status}`, 'success'); close(); load(); }
            catch (error) { el.querySelector('#decision-error').textContent = error.message; button.disabled = false; }
          };
        },
      });
    }
    c.querySelector('#request-filter').onchange = e => { status = e.target.value; page = 1; load(); };
    c.querySelector('#refresh-requests').onclick = load;
    c.querySelector('#copy-request-link').onclick = async () => { try { await navigator.clipboard.writeText(location.origin + '/#/request-transport'); toast('Public form link copied.', 'success'); } catch (_) { toast('Open the public form and copy its address.', 'error'); } };
    await load();
  };
})();

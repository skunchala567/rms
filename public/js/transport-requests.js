/* Public submission and authenticated incharge review. */
(() => {
  const { esc, toast } = UI;
  const field = (label, name, type = 'text', extra = '', required = true) => `<div class="field"><label for="tr-${name}">${esc(label)}</label><input id="tr-${name}" name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></div>`;
  const IST = { timeZone: 'Asia/Kolkata' };
  const shortDate = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { ...IST, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
  const dayOnly = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { ...IST, day: '2-digit', month: 'short', year: 'numeric' });
  // Listings show the requestor's own location name; the exact position lives behind the link.
  const locationLink = (name, lat, lng) => `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(Number(lat) + ',' + Number(lng))}" title="${esc(name)} — open in Google Maps">${esc(name)}</a>`;
  const boardWhen = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { ...IST, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  // The board works in IST calendar days, so "today" and the month grid are derived in that zone.
  const istToday = () => new Date().toLocaleDateString('en-CA', IST);
  const longDay = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const monthLabel = month => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const shiftMonth = (month, step) => {
    const [year, index] = month.split('-').map(Number);
    const moved = new Date(Date.UTC(year, index - 1 + step, 1));
    return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  // The public board deliberately speaks in requestor terms rather than review terms.
  const PUBLIC_STATUS = { Accepted: { label: 'Confirmed', color: 'green' }, Pending: { label: 'Pending review', color: 'amber' } };
  const requestFormHtml = () => `<form id="transport-public-form">
        <div class="section-head"><div class="head-text"><h2 class="flush">New transport request</h2></div>
          <div class="btn-row"><button type="button" class="btn secondary sm" id="cancel-request">${Icons.svg('x', 14)} Cancel</button></div></div>
        <div class="form-grid three">
          ${field('Requestor name', 'requestor_name', 'text', 'maxlength="150" autocomplete="name"')}
          ${field('WhatsApp number (with country code)', 'mobile', 'tel', 'maxlength="30" placeholder="+91 9876543210" autocomplete="tel"')}
          ${field('Number of persons travelling', 'persons', 'number', 'min="1" max="1000" step="1"')}
          ${field('Pickup / from location name', 'origin_name', 'text', 'maxlength="200"')}
          ${field('Destination name', 'destination_name', 'text', 'maxlength="200"')}
          ${field('Subject', 'subject', 'text', 'maxlength="200"')}
        </div>
        <div class="field"><label for="tr-reason">Detailed reason for travel</label><textarea id="tr-reason" name="reason" required maxlength="5000" rows="2"></textarea></div>
        <div class="form-grid three">
          <div class="field"><label for="tr-trip_type">Trip type</label><select id="tr-trip_type" name="trip_type"><option>Drop</option><option>Round trip</option></select></div>
          ${field('Travel date and time (IST)', 'travel_at', 'datetime-local')}
          ${field('Expected end / return date and time (IST)', 'end_at', 'datetime-local')}
        </div>
        <h2>Select pickup and destination on the map</h2>
        <p>Search for a pickup and destination. To place a pin manually, click the corresponding search box, then tap the map. Drag the pins to adjust them.</p>
        <div class="form-grid" id="location-search-fields">
          ${['from', 'to'].map(point => `<div class="field"><div class="location-heading"><label for="search-${point}">${point === 'from' ? 'Search pickup in Google Maps' : 'Search destination in Google Maps'}</label><button type="button" class="btn secondary sm" data-locate="${point}" aria-label="Use my location for ${point === 'from' ? 'pickup' : 'destination'}" disabled>Use my location</button></div><div id="search-host-${point}"><input id="search-${point}" type="search" placeholder="Search a place, address or landmark" autocomplete="off"><button type="button" class="btn secondary sm" data-google-search="${point}">Search Google Maps ↗</button></div><p id="selected-${point}" class="muted" role="status">No ${point === 'from' ? 'pickup' : 'destination'} selected</p></div>`).join('')}
        </div><p id="location-search-help" role="status"></p>
        <div id="transport-map" class="transport-map" aria-label="Journey location map"></div><p id="map-status" role="status"></p>
        ${['from_lat', 'from_lng', 'to_lat', 'to_lng'].map(name => `<input type="hidden" name="${name}">`).join('')}
        <p>The transport team will use your details to review this request and send a confirmation or rejection to your WhatsApp number.</p>
        <div id="request-result" role="status" aria-live="polite"></div>
        <button class="btn" id="submit-transport">Submit transport request</button>
      </form>`;
  Pages.publicTransportRequest = async c => {
    c.innerHTML = `<main class="transport-public"><a href="#/login">← Staff sign in</a>
      <div class="section-head">
        <div class="head-text"><h1>Adhoc transport</h1>
          <p>No login needed. Check the journeys already planned below — if none of them suits you, request a new trip.</p></div>
        <div class="btn-row"><button class="btn" type="button" id="open-request">${Icons.svg('plus', 16)} Request a trip</button></div>
      </div>
      <div id="request-outcome" role="status" aria-live="polite"></div>
      <section class="card" id="request-panel" hidden></section>
      <section class="card">
        <h2 class="flush">Upcoming trips</h2>
        <p class="muted">Journeys that have not finished yet, soonest first. Confirmed trips already have a vehicle allocated; pending ones are still awaiting a decision. Contact the transport team if one of them suits your journey.</p>
        <div class="tabs" role="tablist" id="up-views">
          <button class="tab" type="button" role="tab" aria-selected="false" data-view="list">${Icons.svg('listChecks', 16)} List</button>
          <button class="tab active" type="button" role="tab" aria-selected="true" data-view="calendar">${Icons.svg('calendar', 16)} Calendar</button>
        </div>
        <div class="toolbar">
          <span class="input-icon">${Icons.svg('search', 16)}<input id="up-search" placeholder="Search subject / location / requestor"></span>
          <select id="up-status" aria-label="Trip status"><option value="All">All upcoming</option><option value="Accepted">Confirmed</option><option value="Pending">Pending review</option></select>
          <select id="up-trip" aria-label="Trip type"><option value="">All trip types</option><option>Drop</option><option>Round trip</option></select>
          <label class="toolbar-date" id="up-from-field" hidden>From <input type="date" id="up-from" aria-label="Travelling on or after"></label>
          <label class="toolbar-date" id="up-to-field" hidden>To <input type="date" id="up-to" aria-label="Travelling on or before"></label>
          <span class="btn-row toolbar-actions"><button class="btn secondary sm" id="up-clear" type="button">${Icons.svg('x', 14)} Clear</button>
          <button class="btn secondary sm" id="up-refresh" type="button">${Icons.svg('refresh', 14)} Refresh</button></span>
        </div>
        <div id="upcoming-scope" class="scope-note" hidden></div>
        <div id="upcoming-list">${UI.spinner()}</div>
        <div class="pagination" id="upcoming-pager"></div>
      </section></main>`;
    const outcome = c.querySelector('#request-outcome');
    const panel = c.querySelector('#request-panel');
    const openButton = c.querySelector('#open-request');
    const list = c.querySelector('#upcoming-list');
    const pager = c.querySelector('#upcoming-pager');
    const scope = c.querySelector('#upcoming-scope');
    const state = { status: 'All', tripType: '', search: '', from: '', to: '', page: 1, highlight: '', view: 'calendar', month: istToday().slice(0, 7) };

    function tripRow(r) {
      const badge = PUBLIC_STATUS[r.status] || { label: r.status, color: 'gray' };
      // data-label drives the stacked card layout the board falls back to on phones.
      return `<tr${r.reference === state.highlight ? ' class="is-new"' : ''}>
        <td data-label="Travel (IST)"><b>${esc(boardWhen(r.travel_at))}</b><br><span class="muted">${r.trip_type === 'Round trip' ? 'returns' : 'ends'} ${esc(boardWhen(r.end_at))}</span></td>
        <td class="cell-wrap" data-label="Subject">${esc(r.subject)}<br><span class="muted">${esc(r.reference)}</span></td>
        <td class="cell-wrap" data-label="Journey"><span class="request-route">${locationLink(r.origin_name, r.from_lat, r.from_lng)} ${Icons.svg('arrowRight', 13)} ${locationLink(r.destination_name, r.to_lat, r.to_lng)}</span><br><span class="trip-meta">${UI.badge(r.trip_type, r.trip_type === 'Drop' ? 'sand' : 'blue')}<span class="muted">${esc(r.persons)} pax</span></span></td>
        <td data-label="Requestor">${esc(r.requestor_name)}</td>
        <td data-label="Status">${UI.badge(badge.label, badge.color)}<br><span class="muted">${r.vehicle_number ? Icons.svg('bus', 12) + ' ' + esc(r.vehicle_number) : 'No vehicle yet'}</span></td>
      </tr>`;
    }

    // A day picked on the calendar narrows the board to that date; say so, and offer a way back.
    function renderScope() {
      const single = state.from && state.from === state.to;
      scope.hidden = !(single && state.view === 'list');
      if (scope.hidden) return;
      scope.innerHTML = `<span>${Icons.svg('calendar', 14)} Showing trips on <strong>${esc(longDay(state.from))}</strong></span>
        <span class="btn-row"><button class="btn secondary sm" type="button" id="scope-back">${Icons.svg('chevLeft', 14)} Back to calendar</button>
        <button class="btn secondary sm" type="button" id="scope-all">${Icons.svg('x', 14)} Show all upcoming</button></span>`;
      scope.querySelector('#scope-back').addEventListener('click', () => setView('calendar'));
      scope.querySelector('#scope-all').addEventListener('click', () => {
        c.querySelector('#up-from').value = ''; c.querySelector('#up-to').value = '';
        apply();
      });
    }

    async function loadList() {
      const params = new URLSearchParams({ status: state.status, trip_type: state.tripType, search: state.search, from_date: state.from, to_date: state.to, page: state.page });
      let data;
      try { data = await API.get(`/transport-requests/public/upcoming?${params}`); }
      catch (e) { list.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; pager.innerHTML = ''; return; }
      const totalPages = data.totalPages || 1;
      if (state.page > totalPages) { state.page = totalPages; return loadList(); }
      list.innerHTML = data.rows.length
        ? `<div class="table-wrap"><table>
            <thead><tr>
              <th class="nosort">Travel (IST)</th><th class="nosort">Subject</th><th class="nosort">Journey</th>
              <th class="nosort">Requestor</th><th class="nosort">Status</th>
            </tr></thead>
            <tbody>${data.rows.map(tripRow).join('')}</tbody></table></div>`
        : '<div class="empty">No upcoming trips match these filters. Request a trip if you still need transport.</div>';
      pager.hidden = false;
      pager.innerHTML = `
        <span class="muted">${data.total} trip(s) · page ${data.page} of ${totalPages}</span>
        <button class="btn secondary sm" id="up-prev" ${data.page <= 1 ? 'disabled' : ''}>${Icons.svg('chevLeft', 15)} Prev</button>
        <button class="btn secondary sm" id="up-next" ${data.page >= totalPages ? 'disabled' : ''}>Next ${Icons.svg('chevRight', 15)}</button>`;
      pager.querySelector('#up-prev').addEventListener('click', () => { state.page--; loadList(); });
      pager.querySelector('#up-next').addEventListener('click', () => { state.page++; loadList(); });
    }

    async function loadCalendar() {
      const params = new URLSearchParams({ status: state.status, trip_type: state.tripType, search: state.search, month: state.month });
      let data;
      try { data = await API.get(`/transport-requests/public/calendar?${params}`); }
      catch (e) { list.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; return; }
      const counts = new Map(data.days.map(d => [d.date, d]));
      const [year, month] = state.month.split('-').map(Number);
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const today = istToday();
      const cells = [];
      for (let i = 0; i < offset; i++) cells.push('<div class="cal-day is-blank" aria-hidden="true"></div>');
      for (let day = 1; day <= days; day++) {
        const date = `${state.month}-${String(day).padStart(2, '0')}`;
        const hit = counts.get(date);
        const classes = ['cal-day'];
        if (hit) classes.push('has-trips');
        if (date === today) classes.push('is-today');
        cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${date}"
          aria-label="${esc(longDay(date))}${hit ? `, ${hit.total} trip(s)` : ', no trips'}">
          <span class="cal-date">${day}</span>
          ${hit ? `<span class="cal-count">${hit.total} trip${hit.total === 1 ? '' : 's'}</span>
            <span class="cal-dots">${hit.accepted ? '<i class="dot green"></i>' : ''}${hit.pending ? '<i class="dot amber"></i>' : ''}</span>` : ''}
        </button>`);
      }
      const total = data.days.reduce((sum, d) => sum + d.total, 0);
      list.innerHTML = `<div class="cal">
        <div class="cal-head">
          <button class="btn secondary sm" type="button" id="cal-prev" aria-label="Previous month">${Icons.svg('chevLeft', 15)}</button>
          <strong>${esc(monthLabel(state.month))}</strong>
          <button class="btn secondary sm" type="button" id="cal-next" aria-label="Next month">${Icons.svg('chevRight', 15)}</button>
        </div>
        <p class="muted cal-hint">${total ? `${total} upcoming trip${total === 1 ? '' : 's'} this month. Select a date to see its trips.` : 'No upcoming trips this month. Select a date to check it, or browse another month.'}</p>
        <div class="cal-grid">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.join('')}
        </div>
        <div class="cal-legend"><span><i class="dot green"></i> Confirmed</span><span><i class="dot amber"></i> Pending review</span></div>
      </div>`;
      pager.hidden = true;
      pager.innerHTML = '';
      list.querySelector('#cal-prev').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); loadCalendar(); });
      list.querySelector('#cal-next').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); loadCalendar(); });
      list.querySelectorAll('.cal-day[data-date]').forEach(button => button.addEventListener('click', () => {
        const date = button.dataset.date;
        c.querySelector('#up-from').value = date;
        c.querySelector('#up-to').value = date;
        setView('list');
      }));
    }

    function load() {
      list.innerHTML = UI.spinner();
      renderScope();
      return state.view === 'calendar' ? loadCalendar() : loadList();
    }

    function setView(view) {
      state.view = view;
      state.page = 1;
      c.querySelectorAll('#up-views .tab').forEach(tab => {
        const on = tab.dataset.view === view;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', String(on));
      });
      // The calendar owns date selection, so its own range inputs would only conflict.
      ['#up-from-field', '#up-to-field'].forEach(id => { c.querySelector(id).hidden = view === 'calendar'; });
      if (view === 'calendar') state.month = (state.from || istToday()).slice(0, 7);
      else { state.from = c.querySelector('#up-from').value; state.to = c.querySelector('#up-to').value; }
      return load();
    }

    const apply = () => {
      state.status = c.querySelector('#up-status').value;
      state.tripType = c.querySelector('#up-trip').value;
      state.search = c.querySelector('#up-search').value.trim();
      state.from = c.querySelector('#up-from').value;
      state.to = c.querySelector('#up-to').value;
      state.page = 1;
      load();
    };
    const resetFilters = () => {
      c.querySelector('#up-search').value = '';
      c.querySelector('#up-status').value = 'All';
      c.querySelector('#up-trip').value = '';
      c.querySelector('#up-from').value = '';
      c.querySelector('#up-to').value = '';
    };
    let debounce;
    c.querySelector('#up-search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(apply, 350); });
    ['#up-status', '#up-trip', '#up-from', '#up-to'].forEach(id => c.querySelector(id).addEventListener('change', apply));
    c.querySelector('#up-clear').addEventListener('click', () => { resetFilters(); apply(); });
    c.querySelector('#up-refresh').addEventListener('click', load);
    c.querySelectorAll('#up-views .tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));

    // Discarding the panel's markup also discards the map instance, so every open starts a clean
    // form with its own submission key.
    function closeForm() { panel.hidden = true; panel.replaceChildren(); openButton.hidden = false; }

    async function openForm() {
      if (!panel.hidden) return;
      const key = crypto.randomUUID();
      panel.innerHTML = requestFormHtml();
      panel.hidden = false;
      openButton.hidden = true;
      const form = panel.querySelector('form');
      const result = panel.querySelector('#request-result');
      panel.querySelector('#cancel-request').addEventListener('click', closeForm);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form));
        if (['from_lat', 'from_lng', 'to_lat', 'to_lng'].some(name => !data[name])) {
          result.textContent = 'Please select both pickup and destination on the map or from search results.';
          result.className = 'alert error';
          panel.querySelector('#location-search-fields').scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        data.submission_key = key;
        data.travel_at = new Date(data.travel_at + ':00+05:30').toISOString();
        data.end_at = new Date(data.end_at + ':00+05:30').toISOString();
        const button = panel.querySelector('#submit-transport'); button.disabled = true; button.textContent = 'Submitting…'; result.textContent = '';
        try {
          const saved = await API.post('/transport-requests', data);
          closeForm();
          outcome.innerHTML = `<div class="alert success">${Icons.svg('checkCircle', 16)}<div><strong>Request submitted.</strong> Your reference is <strong>${esc(saved.reference)}</strong> — please save it. Your request is pending review and now appears in the list below; the transport team will send the decision to your WhatsApp number.</div></div>`;
          state.highlight = saved.reference;
          // Show the unfiltered board so the new journey is visible without hunting for it,
          // in the list view rather than whichever view the requestor happened to be on.
          resetFilters();
          Object.assign(state, { status: 'All', tripType: '', search: '', from: '', to: '', page: 1 });
          outcome.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await setView('list');
        } catch (error) { result.textContent = error.message; result.className = 'alert error'; button.disabled = false; button.textContent = 'Submit transport request'; }
      });
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await TransportLocationPicker.mount(panel, form);
    }
    openButton.addEventListener('click', openForm);
    await setView(state.view);
  };
  // Compact label/value cell for the review modal; `value` is trusted HTML, so callers escape.
  const detail = (label, value, wide = false) => `<div class="detail${wide ? ' wide' : ''}"><span class="detail-label">${esc(label)}</span><span class="detail-value">${value}</span></div>`;
  const istTime = value => esc(shortDate(value)) + ' IST';
  const STATUS_COLOR = { Pending: 'amber', Accepted: 'green', Rejected: 'red' };
  const statusChip = status => UI.badge(status || 'Pending', STATUS_COLOR[status] || 'gray');
  // Compact labels for the table; the review modal spells the provider status out in full.
  const MESSAGE_LABEL = { Sent: 'Sent', Failed: 'Failed', Sending: 'Queued', Pending: 'Queued', Simulated: 'Simulated' };
  const messageLabel = status => `<span title="${esc(status === 'Sent' ? 'Accepted by provider' : status || 'Not sent')}">${esc(MESSAGE_LABEL[status] || 'Not sent')}</span>`;
  Pages.transportRequests = async c => {
    const state = { status: 'Pending', tripType: '', search: '', page: 1 };
    c.classList.add('content-full');
    c.innerHTML = `
      <div class="section-head">
        <div class="head-text"><h2>Adhoc Transport Requests</h2>
          <div class="sub">Review journeys, allocate a vehicle, and notify requestors.</div></div>
        <div class="btn-row">
          <button class="btn secondary" id="copy-request-link">${Icons.svg('message', 16)} Copy Form Link</button>
          <a class="btn" href="#/request-transport" target="_blank" rel="noopener">${Icons.svg('arrowRight', 16)} Open Public Form</a>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <span class="input-icon">${Icons.svg('search', 16)}<input id="tr-search" placeholder="Search reference / subject / requestor / vehicle"></span>
          <select id="tr-status">${['Pending', 'Accepted', 'Rejected'].map(s => `<option ${s === 'Pending' ? 'selected' : ''}>${s}</option>`).join('')}<option value="All">All Status</option></select>
          <select id="tr-trip"><option value="">All Trip Types</option><option>Drop</option><option>Round trip</option></select>
          <button class="btn secondary sm" id="tr-clear" type="button">${Icons.svg('x', 14)} Clear Filters</button>
          <button class="btn secondary sm" id="tr-refresh" type="button">${Icons.svg('refresh', 14)} Refresh</button>
        </div>
        <div id="transport-list">${UI.spinner()}</div>
        <div class="pagination" id="transport-pager"></div>
      </div>`;
    const list = c.querySelector('#transport-list');
    const pager = c.querySelector('#transport-pager');

    function rowHtml(r) {
      const decided = r.status !== 'Pending';
      return `<tr>
        <td><b>${esc(r.reference)}</b><br><span class="muted">${esc(dayOnly(r.created_at))}</span></td>
        <td class="cell-wrap">${esc(r.subject)}</td>
        <td>${esc(r.requestor_name)}<br><span class="muted">${esc(r.mobile)}</span></td>
        <td class="cell-wrap"><span class="request-route">${locationLink(r.origin_name, r.from_lat, r.from_lng)} ${Icons.svg('arrowRight', 13)} ${locationLink(r.destination_name, r.to_lat, r.to_lng)}</span><br><span class="trip-meta">${UI.badge(r.trip_type, r.trip_type === 'Drop' ? 'sand' : 'blue')}<span class="muted">${esc(r.persons)} pax</span></span></td>
        <td>${esc(shortDate(r.travel_at))}<br><span class="muted">to ${esc(shortDate(r.end_at))}</span></td>
        <td>${r.vehicle_number ? `<b>${esc(r.vehicle_number)}</b>${r.driver_name ? '<br><span class="muted">' + esc(r.driver_name) + '</span>' : ''}` : '<span class="muted">-</span>'}</td>
        <td>${statusChip(r.status)}<br><span class="muted msg-status" title="WhatsApp notification">${Icons.svg('message', 12)} ${messageLabel(r.message_status)}</span></td>
        <td><div class="row-actions">
          <button class="icon-btn" data-review="${r.id}" title="${decided ? 'View details' : 'Review request'}">${Icons.svg(decided ? 'listChecks' : 'edit', 15)}</button>
          ${decided && r.message_status && r.message_status !== 'Sent' ? `<button class="icon-btn" data-retry="${r.id}" title="Retry WhatsApp">${Icons.svg('refresh', 15)}</button>` : ''}
        </div></td>
      </tr>`;
    }

    async function load() {
      list.innerHTML = UI.spinner();
      const params = new URLSearchParams({ status: state.status, trip_type: state.tripType, search: state.search, page: state.page });
      let data;
      try { data = await API.get(`/transport-requests?${params}`); }
      catch (e) { list.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; pager.innerHTML = ''; return; }
      const totalPages = data.totalPages || 1;
      if (state.page > totalPages) { state.page = totalPages; return load(); }
      list.innerHTML = data.rows.length ? `<div class="table-wrap"><table class="sticky-actions">
        <thead><tr>
          <th class="nosort">Reference</th><th class="nosort">Subject</th><th class="nosort">Requestor</th>
          <th class="nosort">Journey</th><th class="nosort">Travel (IST)</th>
          <th class="nosort">Vehicle</th><th class="nosort">Status</th><th class="nosort">Actions</th>
        </tr></thead>
        <tbody>${data.rows.map(rowHtml).join('')}</tbody></table></div>`
        : '<div class="empty">No requests match the selected filters.</div>';
      list.querySelectorAll('[data-review]').forEach(b => b.addEventListener('click', () => review(data.rows.find(r => String(r.id) === b.dataset.review))));
      list.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => retry(b.dataset.retry, b)));
      pager.innerHTML = `
        <span class="muted">${data.total} request(s) · page ${data.page} of ${totalPages}</span>
        <button class="btn secondary sm" id="tr-prev" ${data.page <= 1 ? 'disabled' : ''}>${Icons.svg('chevLeft', 15)} Prev</button>
        <button class="btn secondary sm" id="tr-next" ${data.page >= totalPages ? 'disabled' : ''}>Next ${Icons.svg('chevRight', 15)}</button>`;
      pager.querySelector('#tr-prev').addEventListener('click', () => { state.page--; load(); });
      pager.querySelector('#tr-next').addEventListener('click', () => { state.page++; load(); });
    }

    async function retry(id, button) {
      button.disabled = true;
      try { const result = await API.post(`/transport-requests/${id}/retry`, {}); toast(`WhatsApp: ${result.status}`); load(); }
      catch (e) { toast(e.message, 'error'); button.disabled = false; }
    }

    async function review(r) {
      let vehicles = [];
      if (r.status === 'Pending') {
        try { vehicles = await API.get(`/transport-requests/${r.id}/vehicles`); } catch (e) { toast(e.message, 'error'); return; }
      }
      UI.modal({ title: r.reference, size: 'lg', body: `<div class="transport-review"><h2>${esc(r.subject)}</h2>
        <div class="detail-grid">
          ${detail('Requestor', esc(r.requestor_name))}
          ${detail('WhatsApp', esc(r.mobile))}
          ${detail('Travellers', esc(r.persons) + ' persons')}
          ${detail('Trip type', UI.badge(r.trip_type, r.trip_type === 'Drop' ? 'sand' : 'blue'))}
          ${detail('Departs', istTime(r.travel_at))}
          ${detail(r.trip_type === 'Round trip' ? 'Returns' : 'Ends', istTime(r.end_at))}
          ${detail('From', locationLink(r.origin_name, r.from_lat, r.from_lng))}
          ${detail('To', locationLink(r.destination_name, r.to_lat, r.to_lng))}
          ${detail('Reason for travel', `<span class="transport-reason">${esc(r.reason)}</span>`, true)}
        </div>
        ${r.status === 'Pending' ? `<form id="decision-form"><div class="field"><label for="decision-status">Decision</label><select id="decision-status" name="status"><option value="Accepted">Accept and allocate vehicle</option><option value="Rejected">Reject with reason</option></select></div>
          <div id="allocation-fields"><p class="note">Available vehicles have enough seats and no overlapping adhoc booking. Vehicles with school trips on these dates are excluded. Verify other operational commitments before confirming.</p><div class="field"><label for="decision-vehicle">Available vehicle</label>${Forms.searchSelectInput({ name: 'bus_id', inputId: 'decision-vehicle', required: true, placeholder: vehicles.length ? 'Search vehicle number, seats or route' : 'No vehicles available', items: vehicles.map(b => ({ value: b.id, label: `${b.bus_number} · ${b.seating_capacity} seats · Route ${b.route_number}` })) })}</div><div class="form-grid">
          ${field('Driver name', 'driver_name', 'text', 'maxlength="150"')}${field('Driver mobile', 'driver_mobile', 'tel', 'maxlength="30"')}${field('Attender name (optional)', 'attender_name', 'text', 'maxlength="150"', false)}${field('Attender mobile (optional)', 'attender_mobile', 'tel', 'maxlength="30"', false)}</div></div>
          <div id="rejection-fields" hidden><div class="field"><label for="decision-reason">Rejection reason</label><textarea id="decision-reason" name="rejection_reason" maxlength="2000" rows="3" disabled></textarea></div></div><p class="note">The decision triggers a WhatsApp update using the configured campaign.</p><div id="decision-error" role="alert"></div><button class="btn" id="save-decision">Confirm decision</button></form>`
        : `<div class="detail-grid">
          ${detail('Decision', statusChip(r.status))}
          ${r.status === 'Accepted' ? detail('Vehicle', esc(r.vehicle_number || '-')) + detail('Driver', esc(r.driver_name || '-') + '<br>' + esc(r.driver_mobile || '')) + detail('Attender', r.attender_name ? esc(r.attender_name) + '<br>' + esc(r.attender_mobile || '') : 'None') : detail('Rejection reason', esc(r.rejection_reason || '-'), true)}
          ${detail('WhatsApp', esc(r.message_status === 'Sent' ? 'Accepted by provider' : r.message_status || 'Pending'))}
          ${r.provider_response ? detail('Provider response', esc(r.provider_response), true) : ''}
        </div>
        <pre class="transport-message">${esc(r.message || '')}</pre>
        ${r.message_status !== 'Sent' ? '<p class="note">If a previous attempt timed out, check provider history before retrying to avoid a duplicate message.</p><button class="btn secondary" id="retry-notification">Retry WhatsApp</button>' : ''}`}</div>`,
        onMount: (el, close) => {
          if (r.status !== 'Pending') {
            const retry = el.querySelector('#retry-notification');
            if (retry) retry.onclick = async () => { retry.disabled = true; try { const result = await API.post(`/transport-requests/${r.id}/retry`, {}); toast(`WhatsApp: ${result.status}`); close(); load(); } catch (e) { toast(e.message, 'error'); retry.disabled = false; } };
            return;
          }
          const form = el.querySelector('#decision-form');
          Forms.bindSearchSelects(el, { emptyText: 'No matching vehicles' });
          const vehicleInput = el.querySelector('#decision-vehicle');
          // The modal body scrolls, so keep the suggestion list in view when the field is focused.
          vehicleInput.addEventListener('focus', () => setTimeout(() => el.querySelector('.search-select-field .suggest-list').scrollIntoView({ block: 'nearest' }), 0));
          // Typing re-resolves the value on every keystroke; only a genuine vehicle change should
          // overwrite driver details the reviewer may have edited by hand.
          let chosen = '';
          form.elements.bus_id.addEventListener('change', () => {
            if (form.elements.bus_id.value === chosen) return;
            chosen = form.elements.bus_id.value;
            const b = vehicles.find(v => String(v.id) === chosen) || {};
            form.elements.driver_name.value = b.driver_name || ''; form.elements.driver_mobile.value = b.driver_mobile || '';
          });
          el.querySelector('#decision-status').onchange = e => {
            const reject = e.target.value === 'Rejected';
            el.querySelector('#allocation-fields').hidden = reject; el.querySelector('#rejection-fields').hidden = !reject;
            el.querySelectorAll('#allocation-fields input, #allocation-fields select').forEach(input => input.disabled = reject);
            form.elements.rejection_reason.disabled = !reject; form.elements.rejection_reason.required = reject;
          };
          form.onsubmit = async e => {
            e.preventDefault();
            const error = el.querySelector('#decision-error');
            // A hidden input is exempt from constraint validation, so check the vehicle here.
            if (form.elements.status.value === 'Accepted' && !form.elements.bus_id.value) {
              error.textContent = vehicles.length ? 'Select a vehicle from the list.' : 'No vehicles are available for these dates.';
              vehicleInput.focus();
              return;
            }
            if (!form.reportValidity()) return;
            error.textContent = '';
            const button = el.querySelector('#save-decision'); button.disabled = true;
            try { const result = await API.post(`/transport-requests/${r.id}/decision`, Object.fromEntries(new FormData(form))); toast(`Decision saved. WhatsApp: ${result.notification.status}`, 'success'); close(); load(); }
            catch (error) { el.querySelector('#decision-error').textContent = error.message; button.disabled = false; }
          };
        },
      });
    }
    const apply = () => {
      state.status = c.querySelector('#tr-status').value;
      state.tripType = c.querySelector('#tr-trip').value;
      state.search = c.querySelector('#tr-search').value.trim();
      state.page = 1;
      load();
    };
    let debounce;
    c.querySelector('#tr-search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(apply, 350); });
    ['#tr-status', '#tr-trip'].forEach(id => c.querySelector(id).addEventListener('change', apply));
    c.querySelector('#tr-clear').addEventListener('click', () => {
      c.querySelector('#tr-search').value = '';
      c.querySelector('#tr-status').value = 'Pending';
      c.querySelector('#tr-trip').value = '';
      apply();
    });
    c.querySelector('#tr-refresh').addEventListener('click', load);
    c.querySelector('#copy-request-link').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.origin + '/#/request-transport'); toast('Public form link copied.', 'success'); }
      catch (_) { toast('Open the public form and copy its address.', 'error'); }
    });
    await load();
  };
})();

/* All application screens (global `Pages`) */
(function () {
  const { esc, toast, modal, confirm, badge, statusBadge, spinner, occupancyBar, fmtDateTime } = UI;
  const CATEGORIES = ['Stay Back Study Hours', 'Sports', 'IIT/JEE Coaching', 'Cultural Activities', 'Other'];

  function options(list, selected, includeBlank, blankLabel = 'All') {
    let html = includeBlank ? `<option value="">${esc(blankLabel)}</option>` : '';
    html += list.map((v) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(v)}</option>`).join('');
    return html;
  }
  function field(label, inner, required) {
    return `<div class="field"><label>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>${inner}</div>`;
  }
  function optionValues(rows) {
    return (rows || []).filter((r) => r.status !== 'Inactive').map((r) => r.value);
  }
  function uniqueValues(list) {
    return [...new Set((list || []).map((v) => String(v || '').trim()).filter(Boolean))].sort();
  }
  function dataList(id, values) {
    return `<datalist id="${esc(id)}">${uniqueValues(values).map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
  }
  function routeSearchInput(name, value, routes, placeholder = 'Search route number') {
    const listId = `route-list-${Math.random().toString(36).slice(2, 9)}`;
    return `<input name="${esc(name)}" value="${esc(value || '')}" list="${esc(listId)}" placeholder="${esc(placeholder)}" autocomplete="off">${dataList(listId, routes)}`;
  }
  async function getStudentSettings() {
    return API.get('/settings/student-options');
  }

  // ============================ DASHBOARD ============================
  async function dashboard(c) {
    c.innerHTML = spinner();
    const s = await API.get('/dashboard/summary');
    const canSend = API.canAccess('notifications');
    c.innerHTML = `
      <div class="section-head"><div><h2>Welcome back</h2><div class="sub">Here's today's stay-back transport overview.</div></div></div>
      <div class="cards">
        ${statCard('Total Students', s.totalStudents, 'students', '')}
        ${statCard('Awaiting Route Assignment', s.awaitingRoute, 'alert', 'amber')}
        ${statCard('Assigned for 5 PM Trip', s.assignedFor5pm, 'checkCircle', 'green')}
        ${statCard('Total Active Buses', s.activeBuses, 'bus', 'teal')}
        ${statCard('WhatsApp Sent Today', s.whatsappToday, 'message', 'purple')}
      </div>
      <div class="card">
        <h2>Quick Actions</h2>
        <div class="quick-actions">
          ${quickAction('students?add=1', 'plus', 'Add Student')}
          ${quickAction('students?bulk=1', 'upload', 'Bulk Upload')}
          ${canSend ? quickAction('buses', 'bus', 'Manage Buses') : ''}
          ${quickAction('route-assignment', 'route', 'Assign Routes')}
          ${canSend ? quickAction('notifications', 'send', 'Send Notifications') : ''}
          ${quickAction('trips', 'clock', '5 PM Trips')}
        </div>
      </div>`;
  }
  function statCard(label, value, icon, cls) {
    return `<div class="stat-card ${cls}">
      <div class="stat-ic">${Icons.svg(icon, 24)}</div>
      <div class="stat-meta"><div class="value">${value}</div><div class="label">${esc(label)}</div></div>
    </div>`;
  }
  function quickAction(href, icon, label) {
    return `<a class="quick-action" href="#/${href}"><span class="qa-ic">${Icons.svg(icon, 22)}</span>${esc(label)}</a>`;
  }

  // ============================ STUDENTS ============================
  const studentState = { page: 1, pageSize: 20, sort: 'name', dir: 'asc', filters: {}, selected: new Set() };

  async function students(c, query) {
    c.innerHTML = `
      <div class="section-head">
        <h2>Students</h2>
        <div class="btn-row">
          <button class="btn" id="btn-add">${Icons.svg('plus', 16)} Add Student</button>
          <button class="btn secondary" id="btn-bulk">${Icons.svg('upload', 16)} Bulk Upload</button>
          <button class="btn secondary" id="btn-export">${Icons.svg('download', 16)} Export</button>
          ${API.isIncharge() ? `<button class="btn danger" id="btn-bulk-del" disabled>${Icons.svg('trash', 16)} Delete Selected</button>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="toolbar" id="filters"></div>
        <div id="grid">${spinner()}</div>
        <div class="pagination" id="pager"></div>
      </div>`;

    const filters = await API.get('/students/filters');
    renderFilters(c, filters);
    await loadStudents(c);

    c.querySelector('#btn-add').addEventListener('click', () => studentForm(c));
    c.querySelector('#btn-bulk').addEventListener('click', () => bulkUpload(c));
    c.querySelector('#btn-export').addEventListener('click', () =>
      API.download('/reports/students/export', 'students.xlsx').catch((e) => toast(e.message, 'error')));
    const bd = c.querySelector('#btn-bulk-del');
    if (bd) bd.addEventListener('click', () => bulkDelete(c));

    if (query.add) studentForm(c);
    if (query.bulk) bulkUpload(c);
  }

  function renderFilters(c, filters) {
    const f = studentState.filters;
    c.querySelector('#filters').innerHTML = `
      <span class="input-icon">${Icons.svg('search', 16)}<input id="f-search" placeholder="Search name / ID / mobile" value="${esc(f.search || '')}"></span>
      <select id="f-class"><option value="">All Classes</option>${options(filters.classes, f.class)}</select>
      <select id="f-section"><option value="">All Sections</option>${options(filters.sections, f.section)}</select>
      <select id="f-category"><option value="">All Categories</option>${options(CATEGORIES, f.category)}</select>
      ${routeSearchInput('route', f.route || '', filters.routes, 'All Routes')}
      <select id="f-status"><option value="">All Status</option>${options(['Active', 'Inactive'], f.status)}</select>
      <button class="btn secondary sm" id="f-clear" type="button">${Icons.svg('x', 14)} Clear Filters</button>`;
    c.querySelector('input[name="route"]').id = 'f-route';
    const apply = () => {
      studentState.filters = {
        search: c.querySelector('#f-search').value.trim(),
        class: c.querySelector('#f-class').value,
        section: c.querySelector('#f-section').value,
        category: c.querySelector('#f-category').value,
        route: c.querySelector('#f-route').value,
        status: c.querySelector('#f-status').value,
      };
      studentState.page = 1;
      studentState.selected.clear();
      loadStudents(c);
    };
    let t;
    c.querySelector('#f-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 350); });
    c.querySelector('#f-route').addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 350); });
    ['#f-class', '#f-section', '#f-category', '#f-status'].forEach((id) =>
      c.querySelector(id).addEventListener('change', apply));
    c.querySelector('#f-clear').addEventListener('click', () => {
      studentState.filters = {};
      studentState.page = 1;
      studentState.selected.clear();
      renderFilters(c, filters);
      loadStudents(c);
    });
  }

  async function loadStudents(c) {
    const grid = c.querySelector('#grid');
    grid.innerHTML = spinner();
    const f = studentState.filters;
    const params = new URLSearchParams({
      page: studentState.page, pageSize: studentState.pageSize,
      sort: studentState.sort, dir: studentState.dir,
      search: f.search || '', class: f.class || '', section: f.section || '',
      category: f.category || '', route: f.route || '', status: f.status || '',
    });
    let res;
    try { res = await API.get(`/students?${params}`); }
    catch (e) { grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

    if (!res.data.length) { grid.innerHTML = '<div class="empty">No students found.</div>'; updatePager(c, res); return; }
    const incharge = API.canAccess('buses');
    const sortIcon = (col) => studentState.sort === col ? (studentState.dir === 'asc' ? ' ▲' : ' ▼') : '';
    grid.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th class="nosort checkbox-cell"><input type="checkbox" id="sel-all"></th>
          <th data-sort="student_code">Student ID${sortIcon('student_code')}</th>
          <th data-sort="name">Name${sortIcon('name')}</th>
          <th data-sort="class">Class${sortIcon('class')}</th>
          <th data-sort="section">Section${sortIcon('section')}</th>
          <th data-sort="category">Category${sortIcon('category')}</th>
          <th data-sort="route_number">Route No${sortIcon('route_number')}</th>
          <th class="nosort">Assigned Bus</th>
          <th data-sort="status">Status${sortIcon('status')}</th>
          <th class="nosort">Actions</th>
        </tr></thead>
        <tbody>${res.data.map(rowHtml).join('')}</tbody>
      </table></div>`;

    grid.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (studentState.sort === col) studentState.dir = studentState.dir === 'asc' ? 'desc' : 'asc';
      else { studentState.sort = col; studentState.dir = 'asc'; }
      loadStudents(c);
    }));
    grid.querySelector('#sel-all').addEventListener('change', (e) => {
      grid.querySelectorAll('.row-check').forEach((cb) => {
        cb.checked = e.target.checked;
        if (e.target.checked) studentState.selected.add(Number(cb.value)); else studentState.selected.delete(Number(cb.value));
      });
      refreshBulkDel(c);
    });
    grid.querySelectorAll('.row-check').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) studentState.selected.add(Number(cb.value)); else studentState.selected.delete(Number(cb.value));
      refreshBulkDel(c);
    }));
    grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => studentForm(c, JSON.parse(b.dataset.edit))));
    grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteStudent(c, b.dataset.del, b.dataset.name)));

    function rowHtml(s) {
      const checked = studentState.selected.has(s.id) ? 'checked' : '';
      return `<tr>
        <td class="checkbox-cell"><input type="checkbox" class="row-check" value="${s.id}" ${checked}></td>
        <td>${esc(s.student_code)}</td>
        <td>${esc(s.name)}</td>
        <td>${esc(s.class || '-')}</td>
        <td>${esc(s.section || '-')}</td>
        <td>${esc(s.category || '-')}</td>
        <td>${s.route_number ? badge(s.route_number, 'blue') : '<span class="muted">Unassigned</span>'}</td>
        <td>${esc(s.assigned_bus || '-')}</td>
        <td>${statusBadge(s.status)}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit='${esc(JSON.stringify(s))}' title="Edit">${Icons.svg('edit', 15)}</button>
          ${incharge ? `<button class="icon-btn danger" data-del="${s.id}" data-name="${esc(s.name)}" title="Delete">${Icons.svg('trash', 15)}</button>` : ''}
        </div></td>
      </tr>`;
    }
    updatePager(c, res);
    refreshBulkDel(c);
  }

  function refreshBulkDel(c) {
    const b = c.querySelector('#btn-bulk-del');
    if (b) b.disabled = studentState.selected.size === 0;
  }

  function updatePager(c, res) {
    const pager = c.querySelector('#pager');
    pager.innerHTML = `
      <span class="muted">${res.total} students · page ${res.page} of ${res.totalPages}</span>
      <button class="btn secondary sm" id="prev" ${res.page <= 1 ? 'disabled' : ''}>${Icons.svg('chevLeft', 15)} Prev</button>
      <button class="btn secondary sm" id="next" ${res.page >= res.totalPages ? 'disabled' : ''}>Next ${Icons.svg('chevRight', 15)}</button>`;
    pager.querySelector('#prev').addEventListener('click', () => { studentState.page--; loadStudents(c); });
    pager.querySelector('#next').addEventListener('click', () => { studentState.page++; loadStudents(c); });
  }

  async function studentForm(c, student) {
    const editing = !!student;
    const s = student || {};
    let settings;
    let filters;
    try { [settings, filters] = await Promise.all([getStudentSettings(), API.get('/students/filters')]); }
    catch (e) { toast(e.message, 'error'); return; }
    const classOptions = optionValues(settings.class);
    const sectionOptions = optionValues(settings.section);
    const categoryOptions = optionValues(settings.category);
    const routeOptions = uniqueValues([...(filters.routes || []), s.route_number]);
    modal({
      title: editing ? 'Edit Student' : 'Add Student',
      size: 'lg',
      body: `<form id="stu-form">
        <div class="form-grid">
          ${field('Student ID', `<input name="student_code" value="${esc(s.student_code || '')}" maxlength="50" pattern="[A-Za-z0-9][A-Za-z0-9_/-]*" title="Use letters, numbers, slash, hyphen, or underscore." required>`, true)}
          ${field('Student Name', `<input name="name" value="${esc(s.name || '')}" minlength="2" maxlength="150" pattern="[A-Za-z .'-]*[A-Za-z][A-Za-z .'-]*" title="Use letters, spaces, dot, apostrophe, or hyphen." required>`, true)}
          ${field('Class', `<select name="class" required><option value="">-- Select --</option>${options(classOptions, s.class)}</select>`, true)}
          ${field('Section', `<select name="section" required><option value="">-- Select --</option>${options(sectionOptions, s.section)}</select>`, true)}
          ${field('Category of Drop', `<select name="category" required><option value="">-- Select --</option>${options(categoryOptions, s.category)}</select>`, true)}
          ${field('Parent Name', `<input name="parent_name" value="${esc(s.parent_name || '')}" minlength="2" maxlength="150" pattern="[A-Za-z .'-]*[A-Za-z][A-Za-z .'-]*" title="Use letters, spaces, dot, apostrophe, or hyphen." required>`, true)}
          ${field('Parent Mobile Number', `<input name="parent_mobile" type="tel" inputmode="numeric" value="${esc(s.parent_mobile || '')}" pattern="(?:\\+?91|0)?[6-9][0-9]{9}" title="Enter a valid 10-digit Indian mobile number." required>`, true)}
          ${field('Current Route Number', routeSearchInput('route_number', s.route_number, routeOptions, 'Awaiting Route Assignment'))}
          ${field('Status', `<select name="status" required>${options(['Active', 'Inactive'], s.status || 'Active')}</select>`, true)}
        </div>
      </form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button>
               <button class="btn" id="save-stu">${editing ? 'Update' : 'Save'}</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-stu').addEventListener('click', async () => {
          const form = el.querySelector('#stu-form');
          if (!form.reportValidity()) return;
          const data = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));
          const btn = el.querySelector('#save-stu');
          btn.disabled = true;
          try {
            if (editing) await API.put(`/students/${s.id}`, data);
            else await API.post('/students', data);
            toast(`Student ${editing ? 'updated' : 'added'}.`, 'success');
            close();
            loadStudents(c);
          } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
        });
      },
    });
  }

  async function deleteStudent(c, id, name) {
    if (!(await confirm({ title: 'Delete Student', message: `Delete "${name}"? This cannot be undone.`, confirmText: 'Delete', danger: true }))) return;
    try { await API.del(`/students/${id}`); toast('Student deleted.', 'success'); studentState.selected.delete(Number(id)); loadStudents(c); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function bulkDelete(c) {
    const ids = [...studentState.selected];
    if (!ids.length) return;
    if (!(await confirm({ title: 'Delete Students', message: `Delete ${ids.length} selected student(s)?`, confirmText: 'Delete', danger: true }))) return;
    try { await API.post('/students/bulk-delete', { ids }); toast(`${ids.length} students deleted.`, 'success'); studentState.selected.clear(); loadStudents(c); }
    catch (e) { toast(e.message, 'error'); }
  }

  function bulkUpload(c) {
    modal({
      title: 'Bulk Upload Students',
      size: 'lg',
      body: `
        <div class="alert info">Upload an <b>Excel (.xlsx)</b> or <b>CSV</b> with columns:
          <b>Student ID, Student Name, Class, Section, Category, Parent Mobile, Route No</b>.
          <a href="#" id="dl-template">Download template</a></div>
        <div class="field"><input type="file" id="bulk-file" accept=".xlsx,.xls,.csv"></div>
        <div id="bulk-result"></div>`,
      footer: `<button class="btn secondary" data-close>Close</button>
               <button class="btn" id="btn-validate" disabled>Validate</button>
               <button class="btn success" id="btn-import" disabled>Import</button>`,
      onMount: (el, close) => {
        let file = null;
        el.querySelector('#dl-template').addEventListener('click', (e) => {
          e.preventDefault();
          const csv = 'Student ID,Student Name,Class,Section,Category,Parent Mobile,Route No\nS100,John Doe,10,A,Stay Back Study Hours,9876543210,R10\n';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          a.download = 'student-upload-template.csv'; a.click();
        });
        el.querySelector('#bulk-file').addEventListener('change', (e) => {
          file = e.target.files[0];
          el.querySelector('#btn-validate').disabled = !file;
          el.querySelector('#btn-import').disabled = true;
          el.querySelector('#bulk-result').innerHTML = '';
        });
        el.querySelector('#btn-validate').addEventListener('click', async () => {
          if (!file) return;
          const fd = new FormData(); fd.append('file', file);
          el.querySelector('#bulk-result').innerHTML = spinner();
          try {
            const r = await API.postForm('/students/bulk-upload/validate', fd);
            renderBulkResult(el, r);
            el.querySelector('#btn-import').disabled = r.validCount === 0;
          } catch (e) { el.querySelector('#bulk-result').innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
        });
        el.querySelector('#btn-import').addEventListener('click', async () => {
          if (!file) return;
          const fd = new FormData(); fd.append('file', file);
          const btn = el.querySelector('#btn-import'); btn.disabled = true;
          try {
            const r = await API.postForm('/students/bulk-upload/import', fd);
            toast(`Imported ${r.imported} student(s). Skipped ${r.skipped}.`, 'success');
            close(); studentState.page = 1; loadStudents(c);
          } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
        });
      },
    });
    function renderBulkResult(el, r) {
      let html = `<div class="alert ${r.errorCount ? 'warn' : 'info'}">
        ${r.validCount} valid row(s), ${r.errorCount} with errors out of ${r.totalRows}.</div>`;
      if (r.errors.length) {
        html += `<div class="table-wrap"><table><thead><tr><th>Row</th><th>Student ID</th><th>Issues</th></tr></thead><tbody>
          ${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.student_code || '-')}</td><td>${esc(e.messages.join(', '))}</td></tr>`).join('')}
          </tbody></table></div>`;
      }
      el.querySelector('#bulk-result').innerHTML = html;
    }
  }

  // ============================ 5 PM TRIPS ============================
  const tripState = { selected: new Set(), filters: {} };

  async function trips(c) {
    tripState.selected.clear();
    c.innerHTML = `
      <div class="section-head"><h2>5 PM Trip Assignment</h2></div>
      <div class="card">
        <h2>Today's Trip List <span class="muted" id="trip-date"></span></h2>
        <div id="trip-list">${spinner()}</div>
      </div>
      <div class="card">
        <div class="section-head"><h2>Select Students to Add</h2>
          <button class="btn" id="btn-assign-trip" disabled>${Icons.svg('clock', 16)} Assign for 5 PM Trip</button>
        </div>
        <div class="toolbar" id="trip-filters"></div>
        <div id="trip-grid">${spinner()}</div>
      </div>`;
    await Promise.all([loadTripList(c), setupTripSelector(c)]);
    c.querySelector('#btn-assign-trip').addEventListener('click', async () => {
      const ids = [...tripState.selected];
      if (!ids.length) return;
      try {
        const r = await API.post('/trips/assign', { studentIds: ids });
        toast(`${r.assigned} student(s) added to today's trip.`, 'success');
        tripState.selected.clear();
        await loadTripList(c); await loadTripStudents(c);
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function loadTripList(c) {
    const box = c.querySelector('#trip-list');
    const res = await API.get('/trips/today');
    c.querySelector('#trip-date').textContent = `(${res.date}) — ${res.count} assigned`;
    if (!res.data.length) { box.innerHTML = '<div class="empty">No students assigned for today yet.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Student ID</th><th>Name</th><th>Class</th><th>Category</th><th>Route</th><th>Bus</th><th>Action</th></tr></thead>
      <tbody>${res.data.map((t) => `<tr>
        <td>${esc(t.student_code)}</td><td>${esc(t.name)}</td><td>${esc(t.class || '-')}${t.section ? '-' + esc(t.section) : ''}</td>
        <td>${esc(t.category || '-')}</td><td>${t.route_number ? badge(t.route_number, 'blue') : '<span class="muted">-</span>'}</td>
        <td>${esc(t.bus_number || t.route_bus_number || '-')}</td>
        <td><button class="icon-btn danger" data-rm="${t.trip_id}">Remove</button></td></tr>`).join('')}
      </tbody></table></div>`;
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.del(`/trips/${b.dataset.rm}`); toast('Removed from trip.', 'success'); await loadTripList(c); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  async function setupTripSelector(c) {
    const filters = await API.get('/students/filters');
    c.querySelector('#trip-filters').innerHTML = `
      <span class="input-icon">${Icons.svg('search', 16)}<input id="t-search" placeholder="Search"></span>
      <div class="route-select filter-select" id="t-class-select">
        <button type="button" class="route-select-trigger" id="t-class-trigger">
          <span id="t-class-label">All Classes</span>
          ${Icons.svg('chevDown', 16)}
        </button>
        <div class="route-select-menu filter-select-menu hidden" id="t-class-menu">
          <input class="filter-select-search" id="t-class-search" placeholder="Search class" autocomplete="off">
          <div class="route-select-head">
            <span id="t-class-count">0 selected</span>
            <button type="button" class="route-clear" id="t-class-clear">Clear</button>
          </div>
          <div class="route-option-list" id="t-class-list">
            ${uniqueValues(filters.classes).map((cls) => `
              <label class="route-option">
                <input type="checkbox" value="${esc(cls)}">
                <span>${esc(cls)}</span>
              </label>`).join('')}
          </div>
        </div>
      </div>
      <select id="t-section"><option value="">All Sections</option>${options(filters.sections, '')}</select>
      <select id="t-category"><option value="">All Categories</option>${options(CATEGORIES, '')}</select>
      ${routeSearchInput('route', '', filters.routes, 'All Routes')}
      <button class="btn secondary sm" id="t-clear" type="button">${Icons.svg('x', 14)} Clear Filters</button>`;
    c.querySelector('#trip-filters input[name="route"]').id = 't-route';
    const classSelect = c.querySelector('#t-class-select');
    const classMenu = c.querySelector('#t-class-menu');
    const classList = c.querySelector('#t-class-list');
    const updateClassFilter = () => {
      const selected = [...classList.querySelectorAll('input:checked')].map((input) => input.value);
      c.querySelector('#t-class-count').textContent = `${selected.length} selected`;
      c.querySelector('#t-class-label').textContent = selected.length
        ? (selected.length <= 2 ? selected.join(', ') : `${selected.length} classes selected`)
        : 'All Classes';
      classList.querySelectorAll('.route-option').forEach((option) => {
        option.classList.toggle('selected', option.querySelector('input').checked);
      });
      return selected;
    };
    const apply = () => {
      const selectedClasses = updateClassFilter();
      tripState.filters = {
        search: c.querySelector('#t-search').value.trim(),
        class: selectedClasses.join(','), section: c.querySelector('#t-section').value,
        category: c.querySelector('#t-category').value, route: c.querySelector('#t-route').value,
      };
      loadTripStudents(c);
    };
    const closeClassMenu = () => {
      classMenu.classList.add('hidden');
      classSelect.classList.remove('open');
    };
    c.querySelector('#t-class-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = classMenu.classList.contains('hidden');
      classMenu.classList.toggle('hidden', !willOpen);
      classSelect.classList.toggle('open', willOpen);
      if (willOpen) c.querySelector('#t-class-search').focus();
    });
    c.addEventListener('click', (e) => {
      if (!classSelect.contains(e.target)) closeClassMenu();
    });
    classList.querySelectorAll('input').forEach((input) => input.addEventListener('change', apply));
    c.querySelector('#t-class-clear').addEventListener('click', (e) => {
      e.preventDefault();
      classList.querySelectorAll('input').forEach((input) => { input.checked = false; });
      c.querySelector('#t-class-search').value = '';
      classList.querySelectorAll('.route-option').forEach((option) => option.classList.remove('hidden'));
      apply();
    });
    c.querySelector('#t-class-search').addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      classList.querySelectorAll('.route-option').forEach((option) => {
        option.classList.toggle('hidden', !!term && !option.textContent.toLowerCase().includes(term));
      });
    });
    updateClassFilter();
    let t;
    c.querySelector('#t-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 300); });
    c.querySelector('#t-route').addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 300); });
    ['#t-section', '#t-category'].forEach((id) => c.querySelector(id).addEventListener('change', apply));
    c.querySelector('#t-clear').addEventListener('click', () => {
      c.querySelector('#t-search').value = '';
      c.querySelector('#t-section').value = '';
      c.querySelector('#t-category').value = '';
      c.querySelector('#t-route').value = '';
      c.querySelector('#t-class-search').value = '';
      classList.querySelectorAll('input').forEach((input) => { input.checked = false; });
      classList.querySelectorAll('.route-option').forEach((option) => option.classList.remove('hidden'));
      closeClassMenu();
      tripState.filters = {};
      updateClassFilter();
      loadTripStudents(c);
    });
    await loadTripStudents(c);
  }

  async function loadTripStudents(c) {
    const grid = c.querySelector('#trip-grid');
    grid.innerHTML = spinner();
    const f = tripState.filters;
    const params = new URLSearchParams({
      pageSize: 500, status: 'Active', search: f.search || '', class: f.class || '',
      section: f.section || '', category: f.category || '', route: f.route || '',
    });
    const res = await API.get(`/students?${params}`);
    if (!res.data.length) { grid.innerHTML = '<div class="empty">No matching students.</div>'; return; }
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th class="checkbox-cell"><input type="checkbox" id="t-all"></th>
        <th>Student ID</th><th>Name</th><th>Class</th><th>Category</th><th>Route</th></tr></thead>
      <tbody>${res.data.map((s) => `<tr>
        <td class="checkbox-cell"><input type="checkbox" class="t-check" value="${s.id}" ${tripState.selected.has(s.id) ? 'checked' : ''}></td>
        <td>${esc(s.student_code)}</td><td>${esc(s.name)}</td><td>${esc(s.class || '-')}</td>
        <td>${esc(s.category || '-')}</td><td>${s.route_number ? badge(s.route_number, 'blue') : '<span class="muted">-</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
    grid.querySelector('#t-all').addEventListener('change', (e) => {
      grid.querySelectorAll('.t-check').forEach((cb) => {
        cb.checked = e.target.checked;
        if (e.target.checked) tripState.selected.add(Number(cb.value)); else tripState.selected.delete(Number(cb.value));
      });
      updateTripBtn(c);
    });
    grid.querySelectorAll('.t-check').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) tripState.selected.add(Number(cb.value)); else tripState.selected.delete(Number(cb.value));
      updateTripBtn(c);
    }));
    updateTripBtn(c);
  }
  function updateTripBtn(c) {
    const b = c.querySelector('#btn-assign-trip');
    b.disabled = tripState.selected.size === 0;
    b.innerHTML = `${Icons.svg('clock', 16)} ${tripState.selected.size ? `Assign ${tripState.selected.size} for 5 PM Trip` : 'Assign for 5 PM Trip'}`;
  }

  // ============================ BUSES ============================
  async function buses(c) {
    const incharge = API.canAccess('buses');
    c.innerHTML = `
      <div class="section-head"><h2>Bus Management</h2>
        ${incharge ? `<button class="btn" id="btn-add-bus">${Icons.svg('plus', 16)} Add Bus</button>` : ''}</div>
      <div id="bus-grid">${spinner()}</div>`;
    if (incharge) c.querySelector('#btn-add-bus').addEventListener('click', () => busForm(c));
    await loadBuses(c);
  }
  async function loadBuses(c) {
    const grid = c.querySelector('#bus-grid');
    const list = await API.get('/buses');
    const incharge = API.canAccess('buses');
    if (!list.length) { grid.innerHTML = '<div class="empty">No buses configured yet.</div>'; return; }
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Bus No</th><th>Route No</th><th>Capacity</th><th>Occupied</th><th>Available</th><th>Occupancy</th><th>Driver</th><th>Tracking</th><th>Status</th>${incharge ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${list.map((b) => `<tr>
        <td><b>${esc(b.bus_number)}</b></td><td>${badge(b.route_number, 'blue')}</td>
        <td>${b.seating_capacity}</td><td>${b.occupied}</td><td>${b.available}</td>
        <td>${occupancyBar(b.occupied, b.seating_capacity)}</td>
        <td>${esc(b.driver_name || '-')}${b.driver_mobile ? '<br><span class="muted">' + esc(b.driver_mobile) + '</span>' : ''}</td>
        <td>${b.gps_link ? `<a href="${esc(b.gps_link)}" target="_blank" rel="noopener" class="icon-btn">${Icons.svg('pin', 15)} Track</a>` : '-'}</td>
        <td>${statusBadge(b.status)}</td>
        ${incharge ? `<td><div class="row-actions">
          <button class="icon-btn" data-edit='${esc(JSON.stringify(b))}' title="Edit">${Icons.svg('edit', 15)}</button>
          <button class="icon-btn danger" data-del="${b.id}" data-name="${esc(b.bus_number)}" title="Delete">${Icons.svg('trash', 15)}</button></div></td>` : ''}
      </tr>`).join('')}</tbody></table></div>`;
    if (incharge) {
      grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => busForm(c, JSON.parse(b.dataset.edit))));
      grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirm({ title: 'Delete Bus', message: `Delete bus "${b.dataset.name}"?`, confirmText: 'Delete', danger: true }))) return;
        try { await API.del(`/buses/${b.dataset.del}`); toast('Bus deleted.', 'success'); loadBuses(c); }
        catch (e) { toast(e.message, 'error'); }
      }));
    }
  }
  function busForm(c, bus) {
    const editing = !!bus; const b = bus || {};
    modal({
      title: editing ? 'Edit Bus' : 'Add Bus', size: 'lg',
      body: `<form id="bus-form"><div class="form-grid">
        ${field('Bus Number', `<input name="bus_number" value="${esc(b.bus_number || '')}" required>`, true)}
        ${field('Route Number', `<input name="route_number" value="${esc(b.route_number || '')}" required>`, true)}
        ${field('Seating Capacity', `<input type="number" min="0" name="seating_capacity" value="${b.seating_capacity != null ? b.seating_capacity : ''}">`)}
        ${field('GPS Tracking Link', `<input name="gps_link" value="${esc(b.gps_link || '')}" placeholder="https://...">`)}
        ${field('Driver Name', `<input name="driver_name" value="${esc(b.driver_name || '')}">`)}
        ${field('Driver Mobile Number', `<input name="driver_mobile" value="${esc(b.driver_mobile || '')}">`)}
        ${field('Status', `<select name="status">${options(['Active', 'Inactive'], b.status || 'Active')}</select>`)}
      </div></form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="save-bus">${editing ? 'Update' : 'Save'}</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-bus').addEventListener('click', async () => {
          const data = Object.fromEntries(new FormData(el.querySelector('#bus-form')).entries());
          const btn = el.querySelector('#save-bus'); btn.disabled = true;
          try {
            if (editing) await API.put(`/buses/${b.id}`, data); else await API.post('/buses', data);
            toast(`Bus ${editing ? 'updated' : 'added'}.`, 'success'); close(); loadBuses(c);
          } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
        });
      },
    });
  }

  // ============================ ROUTE ASSIGNMENT ============================
  const assignState = { selected: new Set(), filters: {} };
  async function routeAssignment(c) {
    assignState.selected.clear();
    const incharge = API.canAccess('route-assignment');
    c.innerHTML = `
      <div class="section-head"><h2>Route Assignment</h2></div>
      <div class="card"><h2>Bus Occupancy</h2><div id="occ">${spinner()}</div></div>
      <div class="card">
        <div class="section-head"><h2>${incharge ? 'Manual Assignment' : 'Route Allocation (view only)'}</h2></div>
        ${incharge ? `<div class="toolbar">
          <span class="input-icon">${Icons.svg('search', 16)}<input id="a-search" placeholder="Search students"></span>
          <span id="a-route-filter-wrap"></span>
          <span id="a-target-wrap"></span>
          <button class="btn secondary sm" id="a-clear" type="button">${Icons.svg('x', 14)} Clear Filters</button>
          <button class="btn" id="btn-assign-route" disabled>Assign to Route</button>
        </div>` : ''}
        <div id="assign-grid">${spinner()}</div>
      </div>`;
    await loadOccupancy(c);
    if (incharge) {
      const [filters, availableRoutes] = await Promise.all([API.get('/students/filters'), API.get('/routes/list')]);
      c.querySelector('#a-route-filter-wrap').innerHTML = `
        <div class="route-select filter-select" id="a-route-select">
          <button type="button" class="route-select-trigger" id="a-route-trigger">
            <span id="a-route-label">All Routes</span>
            ${Icons.svg('chevDown', 16)}
          </button>
          <div class="route-select-menu filter-select-menu hidden" id="a-route-menu">
            <input class="filter-select-search" id="a-route-search" placeholder="Search route" autocomplete="off">
            <div class="route-select-head">
              <span id="a-route-count">0 selected</span>
              <button type="button" class="route-clear" id="a-route-clear">Clear</button>
            </div>
            <div class="route-option-list" id="a-route-list">
              ${uniqueValues(filters.routes).map((route) => `
                <label class="route-option">
                  <input type="checkbox" value="${esc(route)}">
                  <span>${esc(route)}</span>
                </label>`).join('')}
            </div>
          </div>
        </div>`;
      c.querySelector('#a-target-wrap').innerHTML = routeSearchInput('route', '', availableRoutes, 'Route to assign');
      c.querySelector('#a-target-wrap input').id = 'a-target';
      const routeSelect = c.querySelector('#a-route-select');
      const routeMenu = c.querySelector('#a-route-menu');
      const routeList = c.querySelector('#a-route-list');
      const selectedAssignRoutes = () => [...routeList.querySelectorAll('input:checked')].map((input) => input.value);
      const updateAssignRouteFilter = () => {
        const selected = selectedAssignRoutes();
        c.querySelector('#a-route-count').textContent = `${selected.length} selected`;
        c.querySelector('#a-route-label').textContent = selected.length
          ? (selected.length <= 2 ? selected.join(', ') : `${selected.length} routes selected`)
          : 'All Routes';
        routeList.querySelectorAll('.route-option').forEach((option) => {
          option.classList.toggle('selected', option.querySelector('input').checked);
        });
        return selected;
      };
      const closeAssignRouteMenu = () => {
        routeMenu.classList.add('hidden');
        routeSelect.classList.remove('open');
      };
      c.querySelector('#a-route-trigger').addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = routeMenu.classList.contains('hidden');
        routeMenu.classList.toggle('hidden', !willOpen);
        routeSelect.classList.toggle('open', willOpen);
        if (willOpen) c.querySelector('#a-route-search').focus();
      });
      c.addEventListener('click', (e) => {
        if (!routeSelect.contains(e.target)) closeAssignRouteMenu();
      });
      routeList.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
        updateAssignRouteFilter();
        loadAssignStudents(c);
      }));
      c.querySelector('#a-route-clear').addEventListener('click', (e) => {
        e.preventDefault();
        routeList.querySelectorAll('input').forEach((input) => { input.checked = false; });
        c.querySelector('#a-route-search').value = '';
        routeList.querySelectorAll('.route-option').forEach((option) => option.classList.remove('hidden'));
        updateAssignRouteFilter();
        loadAssignStudents(c);
      });
      c.querySelector('#a-route-search').addEventListener('input', (e) => {
        const term = e.target.value.trim().toLowerCase();
        routeList.querySelectorAll('.route-option').forEach((option) => {
          option.classList.toggle('hidden', !!term && !option.textContent.toLowerCase().includes(term));
        });
      });
      updateAssignRouteFilter();
      let t;
      c.querySelector('#a-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadAssignStudents(c), 300); });
      c.querySelector('#a-target').addEventListener('input', () => updateAssignBtn(c));
      c.querySelector('#a-clear').addEventListener('click', () => {
        c.querySelector('#a-search').value = '';
        routeList.querySelectorAll('input').forEach((input) => { input.checked = false; });
        c.querySelector('#a-route-search').value = '';
        routeList.querySelectorAll('.route-option').forEach((option) => option.classList.remove('hidden'));
        closeAssignRouteMenu();
        updateAssignRouteFilter();
        loadAssignStudents(c);
      });
      c.querySelector('#btn-assign-route').addEventListener('click', () => doAssign(c, false));
      await loadAssignStudents(c);
    } else {
      c.querySelector('#assign-grid').innerHTML = '<div class="alert info">You have view-only access to route allocation.</div>';
    }
  }
  async function loadOccupancy(c) {
    const rows = (await API.get('/routes/occupancy')).filter((r) => r.bus_id);
    const box = c.querySelector('#occ');
    const canEdit = API.canAccess('route-assignment');
    if (!rows.length) { box.innerHTML = '<div class="empty">No buses configured yet.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Bus</th><th>Route</th><th>Capacity</th><th>Occupied</th><th>Available</th><th>Occupancy</th><th>Status</th>${canEdit ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><b>${esc(r.bus_number || '-')}</b></td><td>${badge(r.route_number, 'blue')}</td>
        <td>${r.capacity}</td><td>${r.occupied}</td><td>${r.available}</td>
        <td>${occupancyBar(r.occupied, r.capacity)}</td><td>${statusBadge(r.status || 'Active')}</td>
        ${canEdit ? `<td><button class="icon-btn" data-bus-route='${esc(JSON.stringify(r))}' title="Edit route">${Icons.svg('edit', 15)} Edit</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
    if (canEdit) {
      box.querySelectorAll('[data-bus-route]').forEach((button) => {
        button.addEventListener('click', () => editBusRoute(c, JSON.parse(button.dataset.busRoute), rows));
      });
    }
  }
  async function editBusRoute(c, bus, buses) {
    const allRoutes = await API.get('/routes/list');
    const usedByOtherBus = new Set((buses || [])
      .filter((b) => b.bus_id !== bus.bus_id && b.route_number)
      .map((b) => String(b.route_number)));
    const routeOptions = uniqueValues([...allRoutes, bus.route_number]);
    modal({
      title: `Edit Route - ${bus.bus_number}`,
      body: `<form id="bus-route-form">
        ${field('Route Number', `<select name="route_number" required>
          <option value="">-- Select Route --</option>
          ${routeOptions.map((route) => {
            const disabled = usedByOtherBus.has(String(route)) ? 'disabled' : '';
            const note = disabled ? ' (already assigned)' : '';
            return `<option value="${esc(route)}" ${String(route) === String(bus.route_number) ? 'selected' : ''} ${disabled}>${esc(route)}${note}</option>`;
          }).join('')}
        </select>`, true)}
      </form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="save-bus-route">Update Route</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-bus-route').addEventListener('click', async () => {
          const form = el.querySelector('#bus-route-form');
          if (!form.reportValidity()) return;
          const data = Object.fromEntries(new FormData(form).entries());
          const btn = el.querySelector('#save-bus-route');
          btn.disabled = true;
          try {
            await API.put(`/routes/bus/${bus.bus_id}/route`, data);
            toast('Bus route updated.', 'success');
            close();
            await loadOccupancy(c);
          } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
        });
      },
    });
  }
  async function loadAssignStudents(c) {
    const grid = c.querySelector('#assign-grid');
    grid.innerHTML = spinner();
    const routes = [...c.querySelectorAll('#a-route-list input:checked')].map((input) => input.value);
    const params = new URLSearchParams({
      pageSize: 500, search: c.querySelector('#a-search').value.trim(),
      route: routes.join(','),
    });
    const res = await API.get(`/students?${params}`);
    if (!res.data.length) { grid.innerHTML = '<div class="empty">No students found.</div>'; return; }
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th class="checkbox-cell"><input type="checkbox" id="a-all"></th><th>ID</th><th>Name</th><th>Class</th><th>Current Route</th></tr></thead>
      <tbody>${res.data.map((s) => `<tr>
        <td class="checkbox-cell"><input type="checkbox" class="a-check" value="${s.id}" ${assignState.selected.has(s.id) ? 'checked' : ''}></td>
        <td>${esc(s.student_code)}</td><td>${esc(s.name)}</td><td>${esc(s.class || '-')}</td>
        <td>${s.route_number ? badge(s.route_number, 'blue') : '<span class="muted">Unassigned</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
    grid.querySelector('#a-all').addEventListener('change', (e) => {
      grid.querySelectorAll('.a-check').forEach((cb) => { cb.checked = e.target.checked; if (e.target.checked) assignState.selected.add(Number(cb.value)); else assignState.selected.delete(Number(cb.value)); });
      updateAssignBtn(c);
    });
    grid.querySelectorAll('.a-check').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) assignState.selected.add(Number(cb.value)); else assignState.selected.delete(Number(cb.value)); updateAssignBtn(c);
    }));
    updateAssignBtn(c);
  }
  function updateAssignBtn(c) {
    const b = c.querySelector('#btn-assign-route');
    if (!b) return;
    b.disabled = assignState.selected.size === 0 || !c.querySelector('#a-target').value;
  }
  async function doAssign(c, force) {
    const route = c.querySelector('#a-target').value;
    const ids = [...assignState.selected];
    if (!route || !ids.length) return;
    try {
      const r = await API.post('/routes/assign', { studentIds: ids, route, force });
      toast(`Assigned ${r.assigned} student(s) to ${route}.`, 'success');
      assignState.selected.clear();
      await loadOccupancy(c); await loadAssignStudents(c);
    } catch (e) {
      if (e.data && e.data.capacityWarning) {
        const d = e.data;
        const ok = await confirm({
          title: 'Capacity Warning',
          message: `Route ${d.route} capacity is ${d.capacity}. This assignment would bring it to ${d.projected}` +
            (d.exceededBy ? `, exceeding by ${d.exceededBy}.` : '.') + ' Assign anyway?',
          confirmText: 'Assign Anyway', danger: true,
        });
        if (ok) return doAssign(c, true);
      } else { toast(e.message, 'error'); }
    }
  }

  // ============================ ROUTE REPLACEMENT ============================
  async function routeReplacement(c) {
    c.innerHTML = `
      <div class="section-head"><h2>Route Replacement</h2></div>
      <div class="card">
        <div class="alert info">Replacing a route updates <b>all students</b> currently on the old route. The change is recorded in the audit log.</div>
        <div class="toolbar">
          <span id="old-route-wrap"></span>
          <span style="color:var(--accent)">${Icons.svg('arrowRight', 22)}</span>
          <span id="new-route-wrap"></span>
          <button class="btn" id="btn-preview">Preview</button>
        </div>
        <div id="repl-preview"></div>
      </div>
      <div class="card"><h2>Replacement Audit Log</h2><div id="repl-log">${spinner()}</div></div>`;
    const filters = await API.get('/students/filters');
    const routes = filters.routes || [];
    c.querySelector('#old-route-wrap').innerHTML = routeSearchInput('oldRoute', '', filters.routes, 'Existing Route');
    c.querySelector('#old-route-wrap input').id = 'old-route';
    c.querySelector('#new-route-wrap').innerHTML = routeSearchInput('newRoute', '', routes, 'New Route');
    c.querySelector('#new-route-wrap input').id = 'new-route';
    c.querySelector('#btn-preview').addEventListener('click', () => previewReplace(c));
    await loadReplLog(c);
  }
  async function previewReplace(c) {
    const oldR = c.querySelector('#old-route').value;
    const newR = c.querySelector('#new-route').value;
    const box = c.querySelector('#repl-preview');
    if (!oldR || !newR) { toast('Select both routes.', 'warning'); return; }
    if (oldR === newR) { toast('Routes must be different.', 'warning'); return; }
    box.innerHTML = spinner();
    try {
      const p = await API.get(`/routes/replace/preview?old=${encodeURIComponent(oldR)}&new=${encodeURIComponent(newR)}`);
      box.innerHTML = `
        <div class="alert ${p.affectedCount ? 'warn' : 'info'}">
          <b>${p.affectedCount}</b> student(s) currently on <b>${esc(oldR)}</b> will be moved to <b>${esc(newR)}</b>.<br>
          Destination route ${esc(newR)} capacity: <b>${p.newRouteCapacity}</b>, currently occupied: <b>${p.newRouteCurrentOccupied}</b>.
        </div>
        <button class="btn ${p.affectedCount ? '' : 'secondary'}" id="btn-confirm-repl" ${p.affectedCount ? '' : 'disabled'}>Confirm Replacement</button>`;
      const btn = box.querySelector('#btn-confirm-repl');
      if (btn) btn.addEventListener('click', () => doReplace(c, oldR, newR, false));
    } catch (e) { box.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
  }
  async function doReplace(c, oldR, newR, force) {
    if (!(await confirm({ title: 'Confirm Replacement', message: `Move all students from ${oldR} to ${newR}?`, confirmText: 'Replace' }))) return;
    try {
      const r = await API.post('/routes/replace', { oldRoute: oldR, newRoute: newR, force });
      toast(`Replaced ${oldR} → ${newR} for ${r.affectedCount} student(s).`, 'success');
      c.querySelector('#repl-preview').innerHTML = '';
      await loadReplLog(c);
    } catch (e) {
      if (e.data && e.data.capacityWarning) {
        const d = e.data;
        const ok = await confirm({ title: 'Capacity Warning', message: `Destination ${d.newRoute} would reach ${d.projected} (capacity ${d.capacity}). Proceed anyway?`, confirmText: 'Proceed', danger: true });
        if (ok) return doReplace(c, oldR, newR, true);
      } else { toast(e.message, 'error'); }
    }
  }
  async function loadReplLog(c) {
    const box = c.querySelector('#repl-log');
    const rows = await API.get('/routes/replace/log');
    if (!rows.length) { box.innerHTML = '<div class="empty">No replacements yet.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Old Route</th><th>New Route</th><th>Students Updated</th><th>Updated By</th><th>Date & Time</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${badge(r.old_route, 'gray')}</td><td>${badge(r.new_route, 'blue')}</td>
        <td>${r.affected_count}</td><td>${esc(r.updated_by_name || '-')}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ============================ NOTIFICATIONS ============================
  const notifState = { selected: new Set() };
  async function notifications(c) {
    notifState.selected.clear();
    c.innerHTML = `
      <div class="tabs"><button class="tab active" data-tab="send">${Icons.svg('send', 16)} Send Notification</button>
        <button class="tab" data-tab="log">${Icons.svg('listChecks', 16)} Message Tracking</button></div>
      <div id="notif-content">${spinner()}</div>`;
    const content = c.querySelector('#notif-content');
    c.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      c.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      if (t.dataset.tab === 'send') renderSend(content); else renderLog(content);
    }));
    renderSend(content);
  }
  async function renderSend(content) {
    content.innerHTML = `
      <div class="card notif-card">
        <div class="notif-control-panel">
          <div class="notif-field">
            <label>Audience</label>
            <select id="n-scope"><option value="trip">Today's 5 PM Trip students</option><option value="route">By Route</option></select>
          </div>
          <div class="notif-field notif-route-field hidden" id="n-route-panel">
            <label>Routes</label>
            <div class="route-select" id="n-route-select">
              <button type="button" class="route-select-trigger" id="n-route-trigger">
                <span id="n-route-label">Select routes</span>
                ${Icons.svg('chevDown', 16)}
              </button>
              <div class="route-select-menu hidden" id="n-route-menu">
                <div class="route-select-head">
                  <span id="n-route-count">0 selected</span>
                  <button type="button" class="route-clear" id="n-route-clear">Clear</button>
                </div>
                <div class="route-option-list" id="n-route-list"></div>
              </div>
            </div>
          </div>
          <div class="notif-actions">
            <button class="btn secondary" id="n-refresh">${Icons.svg('refresh', 16)} Load</button>
            <button class="btn success" id="n-send" disabled>${Icons.svg('send', 16)} Send Route Notification</button>
          </div>
        </div>
        <div id="n-status"></div>
        <div id="n-grid">${spinner()}</div>
      </div>`;
    const filters = await API.get('/students/filters');
    const routes = filters.routes || [];
    const routeList = content.querySelector('#n-route-list');
    routeList.innerHTML = routes.map((route) => `
      <label class="route-option">
        <input type="checkbox" value="${esc(route)}">
        <span>${esc(route)}</span>
      </label>`).join('');
    const updateRouteCount = () => {
      const selected = [...routeList.querySelectorAll('input:checked')].map((input) => input.value);
      content.querySelector('#n-route-count').textContent = `${selected.length} selected`;
      content.querySelector('#n-route-label').textContent = selected.length
        ? (selected.length <= 2 ? selected.join(', ') : `${selected.length} routes selected`)
        : 'Select routes';
      routeList.querySelectorAll('.route-option').forEach((option) => {
        option.classList.toggle('selected', option.querySelector('input').checked);
      });
    };
    const routeSelect = content.querySelector('#n-route-select');
    const routeMenu = content.querySelector('#n-route-menu');
    const closeRouteMenu = () => {
      routeMenu.classList.add('hidden');
      routeSelect.classList.remove('open');
    };
    content.querySelector('#n-route-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = routeMenu.classList.contains('hidden');
      routeMenu.classList.toggle('hidden', !willOpen);
      routeSelect.classList.toggle('open', willOpen);
    });
    content.querySelector('#n-route-clear').addEventListener('click', (e) => {
      e.preventDefault();
      routeList.querySelectorAll('input').forEach((cb) => { cb.checked = false; });
      updateRouteCount();
    });
    content.addEventListener('click', (e) => {
      if (!routeSelect.contains(e.target)) closeRouteMenu();
    });
    routeList.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', updateRouteCount));
    content.querySelector('#n-scope').addEventListener('change', (e) => {
      const showRoutes = e.target.value === 'route';
      content.querySelector('#n-route-panel').classList.toggle('hidden', !showRoutes);
      if (!showRoutes) closeRouteMenu();
      updateRouteCount();
    });
    content.querySelector('#n-refresh').addEventListener('click', () => loadNotifPreview(content));
    content.querySelector('#n-send').addEventListener('click', () => sendNotifs(content));
    await loadNotifPreview(content);
  }
  async function loadNotifPreview(content) {
    notifState.selected.clear();
    const grid = content.querySelector('#n-grid');
    grid.innerHTML = spinner();
    const scope = content.querySelector('#n-scope').value;
    const routes = [...content.querySelectorAll('#n-route-list input:checked')].map((o) => o.value).filter(Boolean);
    const params = new URLSearchParams({ scope });
    if (scope === 'route') {
      if (!routes.length) {
        grid.innerHTML = '<div class="empty">Select one or more routes and click Load.</div>';
        content.querySelector('#n-status').innerHTML = '';
        updateNotifBtn(content);
        return;
      }
      params.set('routes', routes.join(','));
    }
    const res = await API.get(`/notifications/preview?${params}`);
    const scopeNote = scope === 'route' ? `<div class="alert info">Selected route(s): <b>${routes.map(esc).join(', ')}</b></div>` : '';
    content.querySelector('#n-status').innerHTML = res.enabled
      ? `${scopeNote}<div class="alert info">WhatsApp is LIVE (SmartPing).</div>`
      : `${scopeNote}<div class="alert warn">WhatsApp is in <b>SIMULATION</b> mode (messages are logged as Sent but not actually delivered). Configure SmartPing in <code>.env</code> to go live.</div>`;
    if (!res.data.length) { grid.innerHTML = '<div class="empty">No students to notify.</div>'; return; }
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th class="checkbox-cell"><input type="checkbox" id="n-all"></th><th>Name</th><th>Mobile</th><th>Route</th><th>Bus</th><th>Tracking</th><th>Ready</th></tr></thead>
      <tbody>${res.data.map((s) => `<tr>
        <td class="checkbox-cell"><input type="checkbox" class="n-check" value="${s.student_id}" ${s.ready ? '' : 'disabled'}></td>
        <td>${esc(s.name)}</td><td>${esc(s.mobile || '-')}</td>
        <td>${s.route_number ? badge(s.route_number, 'blue') : '-'}</td><td>${esc(s.bus_number || '-')}</td>
        <td>${s.tracking_link ? `<span style="color:var(--accent)">${Icons.svg('pin', 15)}</span>` : '-'}</td>
        <td>${s.ready ? badge('Ready', 'green') : badge('Missing data', 'amber')}</td></tr>`).join('')}
      </tbody></table></div>`;
    grid.querySelector('#n-all').addEventListener('change', (e) => {
      grid.querySelectorAll('.n-check:not(:disabled)').forEach((cb) => { cb.checked = e.target.checked; if (e.target.checked) notifState.selected.add(Number(cb.value)); else notifState.selected.delete(Number(cb.value)); });
      updateNotifBtn(content);
    });
    grid.querySelectorAll('.n-check').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) notifState.selected.add(Number(cb.value)); else notifState.selected.delete(Number(cb.value)); updateNotifBtn(content);
    }));
    updateNotifBtn(content);
  }
  function updateNotifBtn(content) {
    const b = content.querySelector('#n-send');
    b.disabled = notifState.selected.size === 0;
    b.innerHTML = `${Icons.svg('send', 16)} ${notifState.selected.size ? `Send to ${notifState.selected.size} parent(s)` : 'Send Route Notification'}`;
  }
  async function sendNotifs(content) {
    const ids = [...notifState.selected];
    if (!ids.length) return;
    if (!(await confirm({ title: 'Send Notifications', message: `Send WhatsApp route notification to ${ids.length} parent(s)?`, confirmText: 'Send' }))) return;
    const b = content.querySelector('#n-send'); b.disabled = true;
    try {
      const r = await API.post('/notifications/send', { studentIds: ids });
      toast(`Sent: ${r.sent}, Failed: ${r.failed}${r.simulated ? ' (simulated)' : ''}.`, r.failed ? 'warning' : 'success');
      await loadNotifPreview(content);
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }
  async function renderLog(content) {
    content.innerHTML = `<div class="card">
      <div class="toolbar"><select id="l-status"><option value="">All Status</option>${options(['Sent', 'Failed', 'Pending'], '')}</select>
        <button class="btn secondary sm" id="l-clear" type="button">${Icons.svg('x', 14)} Clear Filters</button>
        <button class="btn secondary" id="l-export">${Icons.svg('download', 16)} Export</button></div>
      <div id="l-grid">${spinner()}</div></div>`;
    content.querySelector('#l-status').addEventListener('change', () => loadLog(content));
    content.querySelector('#l-clear').addEventListener('click', () => {
      content.querySelector('#l-status').value = '';
      loadLog(content);
    });
    content.querySelector('#l-export').addEventListener('click', () => API.download('/reports/whatsapp/export', 'whatsapp-delivery.xlsx').catch((e) => toast(e.message, 'error')));
    await loadLog(content);
  }
  async function loadLog(content) {
    const grid = content.querySelector('#l-grid');
    grid.innerHTML = spinner();
    const status = content.querySelector('#l-status').value;
    const rows = await API.get(`/notifications/log${status ? '?status=' + status : ''}`);
    if (!rows.length) { grid.innerHTML = '<div class="empty">No messages logged yet.</div>'; return; }
    const incharge = API.canAccess('notifications');
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Student</th><th>Mobile</th><th>Sent Time</th><th>Status</th>${incharge ? '<th>Action</th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.mobile || '-')}</td>
        <td>${fmtDateTime(r.sent_at)}</td>
        <td>${badge(r.status, r.status === 'Sent' ? 'green' : r.status === 'Failed' ? 'red' : 'amber')}</td>
        ${incharge ? `<td>${r.status === 'Failed' ? `<button class="icon-btn" data-resend="${r.id}">${Icons.svg('refresh', 15)} Resend</button>` : '-'}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
    grid.querySelectorAll('[data-resend]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await API.post(`/notifications/resend/${b.dataset.resend}`); toast(`Resend: ${r.status}.`, r.status === 'Sent' ? 'success' : 'error'); loadLog(content); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ============================ REPORTS ============================
  async function reports(c) {
    c.innerHTML = `
      <div class="tabs">
        <button class="tab active" data-r="daily">${Icons.svg('route', 16)} Daily Route</button>
        <button class="tab" data-r="bus">${Icons.svg('bus', 16)} Bus Occupancy</button>
        <button class="tab" data-r="whatsapp">${Icons.svg('message', 16)} WhatsApp Delivery</button>
      </div>
      <div id="rep-content">${spinner()}</div>`;
    const content = c.querySelector('#rep-content');
    c.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      c.querySelectorAll('.tab').forEach((x) => x.classList.remove('active')); t.classList.add('active');
      ({ daily: repDaily, bus: repBus, whatsapp: repWhatsapp })[t.dataset.r](content);
    }));
    repDaily(content);
  }
  function reportTable(cols, rows) {
    if (!rows.length) return '<div class="empty">No data.</div>';
    return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c.k] != null ? r[c.k] : '-')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  async function repDaily(content) {
    content.innerHTML = `<div class="card"><div class="section-head"><h2>Daily Route Report</h2>
      <button class="btn secondary" id="exp">${Icons.svg('download', 16)} Export</button></div><div id="rt">${spinner()}</div></div>`;
    content.querySelector('#exp').addEventListener('click', () => API.download('/reports/daily-route/export', 'daily-route.xlsx').catch((e) => toast(e.message, 'error')));
    const r = await API.get('/reports/daily-route');
    content.querySelector('#rt').innerHTML = reportTable(
      [{ h: 'Student Name', k: 'student_name' }, { h: 'Student ID', k: 'student_id' }, { h: 'Route Number', k: 'route_number' }, { h: 'Bus Number', k: 'bus_number' }, { h: 'Category', k: 'category' }], r.data);
  }
  async function repBus(content) {
    content.innerHTML = `<div class="card"><div class="section-head"><h2>Bus Occupancy Report</h2>
      <button class="btn secondary" id="exp">${Icons.svg('download', 16)} Export</button></div><div id="rt">${spinner()}</div></div>`;
    content.querySelector('#exp').addEventListener('click', () => API.download('/reports/bus-occupancy/export', 'bus-occupancy.xlsx').catch((e) => toast(e.message, 'error')));
    const r = await API.get('/reports/bus-occupancy');
    content.querySelector('#rt').innerHTML = reportTable(
      [{ h: 'Bus Number', k: 'bus_number' }, { h: 'Capacity', k: 'capacity' }, { h: 'Occupied', k: 'occupied' }, { h: 'Available', k: 'available' }], r.data);
  }
  async function repWhatsapp(content) {
    content.innerHTML = `<div class="card"><div class="section-head"><h2>WhatsApp Delivery Report</h2>
      <button class="btn secondary" id="exp">${Icons.svg('download', 16)} Export</button></div><div id="rt">${spinner()}</div></div>`;
    content.querySelector('#exp').addEventListener('click', () => API.download('/reports/whatsapp/export', 'whatsapp-delivery.xlsx').catch((e) => toast(e.message, 'error')));
    const r = await API.get('/reports/whatsapp');
    content.querySelector('#rt').innerHTML = reportTable(
      [{ h: 'Student Name', k: 'student_name' }, { h: 'Mobile', k: 'mobile' }, { h: 'Message Status', k: 'message_status' }, { h: 'Sent Time', k: 'sent_time' }],
      r.data.map((x) => ({ ...x, sent_time: fmtDateTime(x.sent_time) })));
  }

  // ============================ SETTINGS ============================
  const settingMeta = {
    class: { label: 'Class', placeholder: 'e.g. 10' },
    section: { label: 'Section', placeholder: 'e.g. A' },
    category: { label: 'Category of Drop', placeholder: 'e.g. Robotics Club' },
  };

  async function settings(c) {
    c.innerHTML = `
      <div class="section-head">
        <div><h2>Settings</h2><div class="sub">Manage student dropdowns, user roles, and access.</div></div>
      </div>
      <div class="tabs">
        ${Object.entries(settingMeta).map(([type, meta], idx) =>
          `<button class="tab ${idx === 0 ? 'active' : ''}" data-setting="${type}">${Icons.svg('settings', 16)} ${esc(meta.label)}</button>`
        ).join('')}
        <button class="tab" data-access="users">${Icons.svg('shield', 16)} Roles & Access</button>
      </div>
      <div id="settings-content">${spinner()}</div>`;
    c.querySelectorAll('[data-setting]').forEach((tab) => tab.addEventListener('click', () => {
      c.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      tab.classList.add('active');
      loadSettingType(c.querySelector('#settings-content'), tab.dataset.setting);
    }));
    c.querySelector('[data-access]').addEventListener('click', (e) => {
      c.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
      accessManagement(c.querySelector('#settings-content'));
    });
    await loadSettingType(c.querySelector('#settings-content'), 'class');
  }

  async function loadSettingType(content, type) {
    const meta = settingMeta[type];
    content.innerHTML = spinner();
    const all = await API.get('/settings/student-options?all=true');
    const rows = all[type] || [];
    content.innerHTML = `
      <div class="card">
        <div class="section-head">
          <h2>${esc(meta.label)} Options</h2>
          <div class="toolbar">
            <input id="setting-value" placeholder="${esc(meta.placeholder)}" maxlength="150">
            <button class="btn" id="setting-add">${Icons.svg('plus', 16)} Add</button>
          </div>
        </div>
        <div id="setting-grid">${settingTable(rows)}</div>
      </div>`;
    content.querySelector('#setting-add').addEventListener('click', () => addSettingOption(content, type));
    content.querySelector('#setting-value').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addSettingOption(content, type);
    });
    bindSettingActions(content, type);
  }

  function settingTable(rows) {
    if (!rows.length) return '<div class="empty">No options added yet.</div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Option</th><th>Sort</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.value)}</td>
        <td>${esc(r.sort_order)}</td>
        <td>${badge(r.status, r.status === 'Active' ? 'green' : 'gray')}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-setting="${r.id}" data-value="${esc(r.value)}" data-sort="${esc(r.sort_order)}" data-status="${esc(r.status)}" title="Edit">${Icons.svg('edit', 15)}</button>
          <button class="icon-btn" data-toggle-setting="${r.id}" data-status="${esc(r.status)}" title="${r.status === 'Active' ? 'Deactivate' : 'Activate'}">${Icons.svg('refresh', 15)}</button>
          <button class="icon-btn danger" data-delete-setting="${r.id}" data-value="${esc(r.value)}" title="Delete">${Icons.svg('trash', 15)}</button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  async function addSettingOption(content, type) {
    const input = content.querySelector('#setting-value');
    const value = input.value.trim();
    if (!value) { input.focus(); toast('Enter an option value.', 'warning'); return; }
    try {
      await API.post('/settings/student-options', { type, value });
      toast('Option added.', 'success');
      await loadSettingType(content, type);
    } catch (e) { toast(e.message, 'error'); }
  }

  function bindSettingActions(content, type) {
    content.querySelectorAll('[data-edit-setting]').forEach((b) => b.addEventListener('click', () => editSettingOption(content, type, b)));
    content.querySelectorAll('[data-toggle-setting]').forEach((b) => b.addEventListener('click', async () => {
      const status = b.dataset.status === 'Active' ? 'Inactive' : 'Active';
      try {
        await API.put(`/settings/student-options/${b.dataset.toggleSetting}`, { status });
        toast(`Option ${status === 'Active' ? 'activated' : 'deactivated'}.`, 'success');
        await loadSettingType(content, type);
      } catch (e) { toast(e.message, 'error'); }
    }));
    content.querySelectorAll('[data-delete-setting]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirm({ title: 'Delete Option', message: `Delete "${b.dataset.value}"?`, confirmText: 'Delete', danger: true }))) return;
      try {
        await API.del(`/settings/student-options/${b.dataset.deleteSetting}`);
        toast('Option deleted.', 'success');
        await loadSettingType(content, type);
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  function editSettingOption(content, type, button) {
    modal({
      title: 'Edit Option',
      body: `<form id="setting-form">
        ${field('Option', `<input name="value" value="${esc(button.dataset.value)}" maxlength="150" required>`, true)}
        ${field('Sort Order', `<input name="sort_order" type="number" min="0" step="1" value="${esc(button.dataset.sort || 0)}" required>`, true)}
        ${field('Status', `<select name="status">${options(['Active', 'Inactive'], button.dataset.status)}</select>`, true)}
      </form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="save-setting">Save</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-setting').addEventListener('click', async () => {
          const form = el.querySelector('#setting-form');
          if (!form.reportValidity()) return;
          const data = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));
          try {
            await API.put(`/settings/student-options/${button.dataset.editSetting}`, data);
            toast('Option updated.', 'success');
            close();
            await loadSettingType(content, type);
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  // ============================ USERS ============================
  async function accessManagement(c) {
    c.innerHTML = `<div class="card"><div class="section-head">
        <div><h2>Roles</h2><div class="sub">Create roles and choose which pages each role can open.</div></div>
        <button class="btn" id="btn-add-role">${Icons.svg('plus', 16)} Add Role</button>
      </div>
      <div id="role-grid">${spinner()}</div></div>
      <div class="card"><div class="section-head">
        <div><h2>Roles & Access Management</h2><div class="sub">Create users and control app access by role.</div></div>
        <button class="btn" id="btn-add-user">${Icons.svg('plus', 16)} Add User</button>
      </div>
      <div id="user-grid">${spinner()}</div></div>`;
    c.querySelector('#btn-add-role').addEventListener('click', () => roleForm(c));
    c.querySelector('#btn-add-user').addEventListener('click', () => userForm(c));
    await loadRoles(c);
    await loadUsers(c);
  }
  async function loadRoles(c) {
    const grid = c.querySelector('#role-grid');
    const [roles, pages] = await Promise.all([API.get('/settings/roles'), API.get('/settings/pages')]);
    if (!roles.length) { grid.innerHTML = '<div class="empty">No roles configured.</div>'; return; }
    const pageLabel = Object.fromEntries(pages.map((p) => [p.key, p.label]));
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Role</th><th>Page Access</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${roles.map((r) => `<tr>
        <td><b>${esc(r.role_name)}</b><br><span class="muted">${esc(r.role_key)}${r.is_system ? ' - system' : ''}</span></td>
        <td>${r.permissions.length ? r.permissions.map((p) => badge(pageLabel[p] || p, 'blue')).join(' ') : '<span class="muted">No pages</span>'}</td>
        <td>${statusBadge(r.status)}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-role='${esc(JSON.stringify(r))}' title="Edit">${Icons.svg('edit', 15)}</button>
          ${r.is_system ? '' : `<button class="icon-btn danger" data-del-role="${esc(r.role_key)}" data-name="${esc(r.role_name)}" title="Delete">${Icons.svg('trash', 15)}</button>`}
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
    grid.querySelectorAll('[data-edit-role]').forEach((b) => b.addEventListener('click', () => roleForm(c, JSON.parse(b.dataset.editRole))));
    grid.querySelectorAll('[data-del-role]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirm({ title: 'Delete Role', message: `Delete role "${b.dataset.name}"?`, confirmText: 'Delete', danger: true }))) return;
      try { await API.del(`/settings/roles/${b.dataset.delRole}`); toast('Role deleted.', 'success'); await loadRoles(c); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  async function roleForm(c, role) {
    const editing = !!role;
    const [pages] = await Promise.all([API.get('/settings/pages')]);
    const current = new Set(role ? role.permissions : []);
    modal({
      title: editing ? 'Edit Role' : 'Add Role',
      size: 'lg',
      body: `<form id="role-form">
        ${field('Role Name', `<input name="role_name" value="${esc(role ? role.role_name : '')}" maxlength="150" required>`, true)}
        ${editing ? field('Status', `<select name="status">${options(['Active', 'Inactive'], role.status)}</select>`, true) : ''}
        <div class="field"><label>Page Access <span class="req">*</span></label>
          <div class="quick-actions" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
            ${pages.map((p) => `<label class="quick-action" style="align-items:flex-start;text-align:left;gap:8px">
              <span><input type="checkbox" name="permissions" value="${esc(p.key)}" ${current.has(p.key) ? 'checked' : ''}> ${esc(p.label)}</span>
            </label>`).join('')}
          </div>
        </div>
      </form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="save-role">${editing ? 'Update' : 'Save'}</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-role').addEventListener('click', async () => {
          const form = el.querySelector('#role-form');
          if (!form.reportValidity()) return;
          const fd = new FormData(form);
          const data = {
            role_name: String(fd.get('role_name') || '').trim(),
            status: String(fd.get('status') || (role ? role.status : 'Active')).trim(),
            permissions: fd.getAll('permissions'),
          };
          if (!data.permissions.length) { toast('Select at least one page.', 'warning'); return; }
          try {
            if (editing) await API.put(`/settings/roles/${role.role_key}`, data);
            else await API.post('/settings/roles', data);
            toast(`Role ${editing ? 'updated' : 'added'}.`, 'success');
            close();
            await loadRoles(c);
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }
  async function loadUsers(c) {
    const grid = c.querySelector('#user-grid');
    const list = await API.get('/users');
    const me = API.getUser();
    grid.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${list.map((u) => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.username)}</td>
        <td>${badge(u.role_name || u.role, u.role === 'transport_incharge' ? 'blue' : 'gray')}</td>
        <td>${statusBadge(u.status)}</td>
        <td><div class="row-actions"><button class="icon-btn" data-edit='${esc(JSON.stringify(u))}' title="Edit">${Icons.svg('edit', 15)}</button>
        ${u.id !== me.id ? `<button class="icon-btn danger" data-del="${u.id}" data-name="${esc(u.full_name)}" title="Delete">${Icons.svg('trash', 15)}</button>` : '<span class="muted">(you)</span>'}</div></td></tr>`).join('')}
      </tbody></table></div>`;
    grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userForm(c, JSON.parse(b.dataset.edit))));
    grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirm({ title: 'Delete User', message: `Delete user "${b.dataset.name}"?`, confirmText: 'Delete', danger: true }))) return;
      try { await API.del(`/users/${b.dataset.del}`); toast('User deleted.', 'success'); loadUsers(c); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  async function userForm(c, user) {
    const editing = !!user; const u = user || {};
    let roles;
    try { roles = await API.get('/settings/roles'); }
    catch (e) { toast(e.message, 'error'); return; }
    const activeRoles = roles.filter((r) => r.status === 'Active' || r.role_key === u.role);
    modal({
      title: editing ? 'Edit User' : 'Add User',
      body: `<form id="user-form">
        ${field('Full Name', `<input name="full_name" value="${esc(u.full_name || '')}" required>`, true)}
        ${editing ? '' : field('Username', `<input name="username" required>`, true)}
        ${field(editing ? 'New Password (leave blank to keep)' : 'Password', `<input type="password" name="password" ${editing ? '' : 'required'}>`, !editing)}
        ${field('Role', `<select name="role" required>${activeRoles.map((r) => `<option value="${esc(r.role_key)}" ${u.role === r.role_key ? 'selected' : ''}>${esc(r.role_name)}</option>`).join('')}</select>`, true)}
        ${field('Status', `<select name="status">${options(['Active', 'Inactive'], u.status || 'Active')}</select>`)}
      </form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="save-user">${editing ? 'Update' : 'Save'}</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-user').addEventListener('click', async () => {
          const data = Object.fromEntries(new FormData(el.querySelector('#user-form')).entries());
          if (!data.password) delete data.password;
          const btn = el.querySelector('#save-user'); btn.disabled = true;
          try {
            if (editing) await API.put(`/users/${u.id}`, data); else await API.post('/users', data);
            toast(`User ${editing ? 'updated' : 'added'}.`, 'success'); close(); loadUsers(c);
          } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
        });
      },
    });
  }

  // ============================ ACCOUNT ============================
  function account() {
    modal({
      title: 'Change Password',
      body: `<form id="pw-form">
        ${field('Current Password', '<input type="password" name="currentPassword" required>', true)}
        ${field('New Password', '<input type="password" name="newPassword" required>', true)}
      </form>`,
      footer: `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="save-pw">Update</button>`,
      onMount: (el, close) => {
        el.querySelector('#save-pw').addEventListener('click', async () => {
          const data = Object.fromEntries(new FormData(el.querySelector('#pw-form')).entries());
          try { await API.post('/auth/change-password', data); toast('Password changed.', 'success'); close(); }
          catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  window.Pages = {
    dashboard, students, trips, buses, routeAssignment, routeReplacement,
    notifications, reports, settings, account,
  };
})();

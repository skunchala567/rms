/* App shell, hash router, login, role-based navigation */
(function () {
  const { esc, toast } = UI;
  const appEl = document.getElementById('app');

  const NAV = [
    { path: 'dashboard', label: 'Dashboard', icon: 'dashboard', page: 'dashboard' },
    { path: 'students', label: 'Students', icon: 'students', page: 'students' },
    { path: 'trips', label: '5 PM Trips', icon: 'clock', page: 'trips' },
    { path: 'buses', label: 'Buses', icon: 'bus', page: 'buses', inchargeOnly: true },
    { path: 'route-assignment', label: 'Route Assignment', icon: 'route', page: 'routeAssignment' },
    { path: 'route-replacement', label: 'Route Replacement', icon: 'replace', page: 'routeReplacement', inchargeOnly: true },
    { path: 'notifications', label: 'Notifications', icon: 'message', page: 'notifications', inchargeOnly: true },
    { path: 'reports', label: 'Reports', icon: 'reports', page: 'reports' },
    { path: 'users', label: 'Users', icon: 'shield', page: 'users', inchargeOnly: true },
  ];

  function parseHash() {
    const raw = (location.hash || '#/dashboard').slice(2); // remove '#/'
    const [path, qs] = raw.split('?');
    const query = {};
    new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
    return { path: path || 'dashboard', query };
  }

  function navItemsFor(role) {
    return NAV.filter((n) => !n.inchargeOnly || role === 'transport_incharge');
  }

  // ---------- Login ----------
  function renderLogin() {
    appEl.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="login-logo">${Icons.logoMark(60)}</div>
        <h1>Stay Back Route Management</h1>
        <div class="sub">Transport allocation for stay-back students</div>
        <form id="login-form">
          <div class="field"><label>Username</label><input name="username" autocomplete="username" required></div>
          <div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div>
          <button class="btn" style="width:100%;justify-content:center" id="login-btn">Sign In</button>
        </form>
        <div class="login-hint">Default logins:<br>
          <b>admin / admin123</b> (Transport Incharge)<br>
          <b>dataentry / data123</b> (Data Entry)</div>
      </div></div>`;
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      btn.disabled = true; btn.textContent = 'Signing in...';
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const res = await API.post('/auth/login', data);
        API.setSession(res.token, res.user);
        toast(`Welcome, ${res.user.name}!`, 'success');
        location.hash = '#/dashboard';
        renderApp();
      } catch (err) {
        toast(err.message, 'error', 'Login failed');
        btn.disabled = false; btn.textContent = 'Sign In';
      }
    });
  }

  // ---------- App shell ----------
  function renderShell() {
    const user = API.getUser();
    const items = navItemsFor(user.role);
    appEl.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="brand">${Icons.logoMark(36)}<span class="brand-text">Stay Back<small>Route Management</small></span></div>
          <nav>
            <div class="nav-section">Main</div>
            ${items.map((n) => `<div class="nav-item" data-path="${n.path}">${Icons.svg(n.icon, 19)}${esc(n.label)}</div>`).join('')}
          </nav>
          <div class="foot">${Icons.svg('shield', 15)} v1.0 · ${esc(user.role === 'transport_incharge' ? 'Transport Incharge' : 'Data Entry')}</div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button class="hamburger" id="hamburger">${Icons.svg('menu', 22)}</button>
            <div class="page-title" id="page-title">Dashboard</div>
            <div class="user-chip" id="user-chip" title="Account">
              <div class="meta">
                <div class="nm">${esc(user.name)}</div>
                <div class="role">${esc(user.role === 'transport_incharge' ? 'Transport Incharge' : 'Data Entry User')}</div>
              </div>
              <div class="avatar">${esc((user.name || 'U').charAt(0).toUpperCase())}</div>
              <span class="chip-caret">${Icons.svg('chevDown', 16)}</span>
            </div>
          </header>
          <main class="content" id="content"></main>
        </div>
      </div>`;

    document.getElementById('hamburger').addEventListener('click', toggleSidebar);
    document.getElementById('user-chip').addEventListener('click', showAccountMenu);
    appEl.querySelectorAll('.nav-item').forEach((el) => el.addEventListener('click', () => {
      location.hash = `#/${el.dataset.path}`;
      closeSidebar();
    }));
  }

  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open');
    if (sb.classList.contains('open')) {
      const bd = document.createElement('div'); bd.className = 'backdrop'; bd.id = 'backdrop';
      bd.addEventListener('click', closeSidebar);
      document.querySelector('.app-shell').appendChild(bd);
    } else closeSidebar();
  }
  function closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('backdrop')?.remove();
  }

  function closeAccountMenu() {
    document.getElementById('account-menu')?.remove();
    document.getElementById('account-overlay')?.remove();
  }

  function showAccountMenu(e) {
    if (e) e.stopPropagation();
    // toggle
    if (document.getElementById('account-menu')) { closeAccountMenu(); return; }

    const u = API.getUser();
    const chip = document.getElementById('user-chip');
    const rect = chip.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.id = 'account-overlay';
    overlay.className = 'dd-overlay';

    const menu = document.createElement('div');
    menu.id = 'account-menu';
    menu.className = 'dropdown-menu';
    menu.style.top = `${rect.bottom + 10}px`;
    menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    menu.innerHTML = `
      <div class="dd-header">
        <div class="avatar">${esc((u.name || 'U').charAt(0).toUpperCase())}</div>
        <div class="dd-id">
          <div class="dd-name">${esc(u.name)}</div>
          <div class="dd-sub">@${esc(u.username)} · ${esc(u.role === 'transport_incharge' ? 'Transport Incharge' : 'Data Entry User')}</div>
        </div>
      </div>
      <button class="dd-item" id="acc-pw">${Icons.svg('lock', 16)} Change Password</button>
      <button class="dd-item danger" id="acc-out">${Icons.svg('logout', 16)} Logout</button>`;

    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    overlay.addEventListener('click', closeAccountMenu);
    menu.querySelector('#acc-pw').addEventListener('click', () => { closeAccountMenu(); Pages.account(); });
    menu.querySelector('#acc-out').addEventListener('click', () => {
      closeAccountMenu(); API.clearSession(); location.hash = '#/login'; renderApp();
    });
  }

  // ---------- Router ----------
  let shellRendered = false;
  async function route() {
    if (!API.getToken()) { shellRendered = false; renderLogin(); return; }
    if (!shellRendered) { renderShell(); shellRendered = true; }

    const { path, query } = parseHash();
    const user = API.getUser();
    const nav = navItemsFor(user.role).find((n) => n.path === path);

    // Default / unknown / unauthorized -> dashboard
    if (!nav) {
      if (path === 'login') { location.hash = '#/dashboard'; return; }
      location.hash = '#/dashboard';
      return;
    }

    document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.path === path));
    document.getElementById('page-title').textContent = nav.label;

    const content = document.getElementById('content');
    content.innerHTML = '';
    try {
      await Pages[nav.page](content, query);
    } catch (e) {
      content.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
      if (!e.offline) toast(e.message, 'error');
    }
  }

  function renderApp() { route(); }

  window.addEventListener('hashchange', route);

  // ---------- Session check on load ----------
  async function boot() {
    if (API.getToken()) {
      try { await API.get('/auth/me'); }
      catch (e) { if (e.status === 401) { API.clearSession(); } }
    }
    if (!location.hash) location.hash = API.getToken() ? '#/dashboard' : '#/login';
    route();
  }

  // ---------- PWA install ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });
  function showInstallBanner() {
    if (document.getElementById('install-banner')) return;
    const b = document.createElement('div');
    b.className = 'install-banner'; b.id = 'install-banner';
    b.innerHTML = `${Icons.svg('smartphone', 20)}<span>Install this app for quick access</span>
      <button class="btn sm" id="do-install">Install</button>
      <button class="btn secondary sm" id="dismiss-install">Later</button>`;
    document.body.appendChild(b);
    b.querySelector('#do-install').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      b.remove();
    });
    b.querySelector('#dismiss-install').addEventListener('click', () => b.remove());
  }

  // ---------- Offline indicator ----------
  function updateOnline() {
    document.getElementById('offline-bar').classList.toggle('hidden', navigator.onLine);
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  boot();
})();

/* API client + auth/session helpers (global `API`) */
(function () {
  const TOKEN_KEY = 'sbrms_token';
  const USER_KEY = 'sbrms_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function isIncharge() {
    const u = getUser();
    return u && u.role === 'transport_incharge';
  }
  function canAccess(page) {
    const u = getUser();
    return !!(u && Array.isArray(u.access) && u.access.includes(page));
  }

  async function request(method, path, body, opts = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let resp;
    try {
      resp = await fetch(`/api${path}`, { method, headers, body: payload });
    } catch (netErr) {
      const e = new Error('Network error — you may be offline.');
      e.offline = true;
      throw e;
    }
    if (resp.status === 401 && !path.startsWith('/auth/login')) {
      clearSession();
      location.hash = '#/login';
      const e = new Error('Session expired. Please log in again.');
      e.status = 401;
      throw e;
    }
    if (opts.blob) {
      if (!resp.ok) throw new Error('Download failed.');
      return resp.blob();
    }
    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await resp.json() : await resp.text();
    if (!resp.ok) {
      const err = new Error((data && data.error) || `Request failed (${resp.status}).`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function download(path, filename) {
    const blob = await request('GET', path, null, { blob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  window.API = {
    getToken, getUser, setSession, clearSession, isIncharge, download,
    canAccess,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    del: (p) => request('DELETE', p),
    postForm: (p, formData) => request('POST', p, formData),
  };
})();

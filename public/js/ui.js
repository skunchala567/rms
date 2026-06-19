/* UI helpers: toasts, modals, confirm dialogs, small render utilities (global `UI`) */
(function () {
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, type = 'info', title) {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${title ? `<div class="t-title">${esc(title)}</div>` : ''}<div>${esc(message)}</div>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 5000 : 3200);
  }

  // Modal: returns { close }. content is an HTML string; onMount(modalEl) wires events.
  function modal({ title, body, footer = '', size = '', onMount }) {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${size}">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="modal-close" data-close>&times;</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    root.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    if (onMount) onMount(overlay.querySelector('.modal'), close);
    return { close, el: overlay };
  }

  function confirm({ title = 'Please confirm', message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const m = modal({
        title,
        body: `<p>${esc(message)}</p>`,
        footer: `
          <button class="btn secondary" data-cancel>Cancel</button>
          <button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(confirmText)}</button>`,
        onMount: (el, close) => {
          el.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve(false); });
          el.querySelector('[data-ok]').addEventListener('click', () => { close(); resolve(true); });
        },
      });
    });
  }

  function badge(text, color) { return `<span class="badge ${color}">${esc(text)}</span>`; }
  function statusBadge(status) {
    return badge(status, status === 'Active' ? 'green' : 'gray');
  }
  function spinner() { return '<div class="spinner"></div>'; }

  function occupancyBar(occupied, capacity) {
    const pct = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
    const over = occupied > capacity;
    const cls = over ? 'over' : pct >= 85 ? 'warn' : '';
    const width = Math.min(100, pct);
    return `<div style="display:flex;align-items:center">
      <div class="occ-bar ${cls}"><span style="width:${width}%"></span></div>
      <span class="occ-label">${occupied}/${capacity} (${pct}%)</span></div>`;
  }

  function fmtDateTime(s) {
    if (!s) return '-';
    // SQLite returns 'YYYY-MM-DD HH:MM:SS' (UTC); show locale
    const d = new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'));
    if (isNaN(d)) return s;
    return d.toLocaleString();
  }

  window.UI = { esc, toast, modal, confirm, badge, statusBadge, spinner, occupancyBar, fmtDateTime };
})();

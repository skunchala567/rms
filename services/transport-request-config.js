'use strict';
const db = require('../db/database');

// How the public form treats the reporting head's approval document.
// Hidden   - the upload field is not shown at all.
// Optional - shown, but a request can be submitted without it.
// Required - a request cannot be submitted without it.
const APPROVAL_MODES = ['Hidden', 'Optional', 'Required'];
const DEFAULT_APPROVAL_MODE = 'Optional';

async function getRequestSettings() {
  const saved = await db.get('SELECT approval_mode, updated_at FROM transport_request_settings WHERE id=1');
  if (saved && APPROVAL_MODES.includes(saved.approval_mode)) return { approvalMode: saved.approval_mode, updatedAt: saved.updated_at };
  return { approvalMode: DEFAULT_APPROVAL_MODE, updatedAt: null };
}

async function saveRequestSettings(body, userId) {
  const mode = typeof body.approvalMode === 'string' ? body.approvalMode.trim() : '';
  if (!APPROVAL_MODES.includes(mode)) throw Object.assign(new Error(`Approval document setting must be one of: ${APPROVAL_MODES.join(', ')}.`), { status: 400 });
  await db.run(`INSERT INTO transport_request_settings (id, approval_mode, updated_by) VALUES (1, ?, ?)
    ON DUPLICATE KEY UPDATE approval_mode=VALUES(approval_mode), updated_by=VALUES(updated_by), updated_at=NOW()`, [mode, userId]);
  return getRequestSettings();
}

module.exports = { APPROVAL_MODES, DEFAULT_APPROVAL_MODE, getRequestSettings, saveRequestSettings };

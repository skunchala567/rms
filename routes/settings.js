'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const TYPES = ['class', 'section', 'category'];
const PAGE_OPTIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'students', label: 'Students' },
  { key: 'trips', label: '5 PM Trips' },
  { key: 'buses', label: 'Buses' },
  { key: 'route-assignment', label: 'Route Assignment' },
  { key: 'route-replacement', label: 'Route Replacement' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
];
const DEFAULTS = {
  class: ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  section: ['A', 'B', 'C', 'D'],
  category: ['Stay Back Study Hours', 'Sports', 'IIT/JEE Coaching', 'Cultural Activities', 'Other'],
};

function clean(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function validateType(type) {
  const t = clean(type).toLowerCase();
  return TYPES.includes(t) ? t : '';
}

function validateValue(value) {
  const v = clean(value);
  if (!v) return 'Value is required.';
  if (v.length > 150) return 'Value must be 150 characters or fewer.';
  if (!/^[A-Za-z0-9 .\/_'&()-]+$/.test(v)) {
    return 'Value can use only letters, numbers, spaces, dot, slash, underscore, apostrophe, ampersand, parentheses, and hyphen.';
  }
  return '';
}

function roleKeyFromName(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function validPages(pages) {
  const allowed = new Set(PAGE_OPTIONS.map((p) => p.key));
  return [...new Set((Array.isArray(pages) ? pages : []).map(clean).filter((p) => allowed.has(p)))];
}

async function insertOption(type, value, sortOrder = 0) {
  await db.prepare(`
    INSERT IGNORE INTO student_settings (type, value, sort_order, status)
    VALUES (?, ?, ?, 'Active')
  `).run(type, value, sortOrder);
}

async function ensureSeeded() {
  for (const type of TYPES) {
    const count = (await db.prepare('SELECT COUNT(*) AS c FROM student_settings WHERE type = ?').get(type)).c;
    if (count === 0) {
      for (const [index, value] of DEFAULTS[type].entries()) {
        await insertOption(type, value, index + 1);
      }
    }
  }

  const rows = await db.query(`
    SELECT 'class' AS type, class AS value FROM students WHERE class IS NOT NULL AND class <> ''
    UNION
    SELECT 'section' AS type, section AS value FROM students WHERE section IS NOT NULL AND section <> ''
    UNION
    SELECT 'category' AS type, category AS value FROM students WHERE category IS NOT NULL AND category <> ''
  `);

  for (const row of rows) {
    const type = validateType(row.type);
    const value = clean(row.value);
    if (type && value) await insertOption(type, value, 1000);
  }
}

function groupOptions(rows) {
  const grouped = { class: [], section: [], category: [] };
  rows.forEach((row) => {
    if (grouped[row.type]) grouped[row.type].push(row);
  });
  return grouped;
}

// GET /api/settings/student-options
router.get('/student-options', async (req, res, next) => {
  try {
    await ensureSeeded();
    const statusClause = req.query.all === 'true' ? '' : "WHERE status = 'Active'";
    const rows = await db.prepare(`
      SELECT id, type, value, sort_order, status
      FROM student_settings
      ${statusClause}
      ORDER BY type, sort_order, value
    `).all();
    res.json(groupOptions(rows));
  } catch (err) { next(err); }
});

// GET /api/settings/pages
router.get('/pages', requirePageAccess('settings'), (req, res) => {
  res.json(PAGE_OPTIONS);
});

// GET /api/settings/roles
router.get('/roles', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const roles = await db.prepare(`
      SELECT id, role_key, role_name, is_system, status, created_at
      FROM roles
      ORDER BY is_system DESC, role_name
    `).all();
    const perms = await db.prepare('SELECT role_key, page_key FROM role_permissions ORDER BY page_key').all();
    const byRole = {};
    perms.forEach((p) => {
      if (!byRole[p.role_key]) byRole[p.role_key] = [];
      byRole[p.role_key].push(p.page_key);
    });
    res.json(roles.map((r) => ({ ...r, permissions: byRole[r.role_key] || [] })));
  } catch (err) { next(err); }
});

// POST /api/settings/roles
router.post('/roles', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const roleName = clean(req.body.role_name);
    if (!roleName) return res.status(400).json({ error: 'Role name is required.' });
    if (roleName.length > 150) return res.status(400).json({ error: 'Role name must be 150 characters or fewer.' });
    const roleKey = roleKeyFromName(req.body.role_key || roleName);
    if (!roleKey) return res.status(400).json({ error: 'Role key is invalid.' });
    const permissions = validPages(req.body.permissions);
    await db.transaction(async (t) => {
      await t.run(`
        INSERT INTO roles (role_key, role_name, is_system, status)
        VALUES (?, ?, 0, 'Active')
      `, [roleKey, roleName]);
      for (const page of permissions) await t.run('INSERT INTO role_permissions (role_key, page_key) VALUES (?, ?)', [roleKey, page]);
    });
    const role = await db.prepare('SELECT * FROM roles WHERE role_key = ?').get(roleKey);
    res.status(201).json({ ...role, permissions });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This role already exists.' });
    next(err);
  }
});

// PUT /api/settings/roles/:roleKey
router.put('/roles/:roleKey', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const roleKey = clean(req.params.roleKey);
    const role = await db.prepare('SELECT * FROM roles WHERE role_key = ?').get(roleKey);
    if (!role) return res.status(404).json({ error: 'Role not found.' });
    const roleName = req.body.role_name !== undefined ? clean(req.body.role_name) : role.role_name;
    const status = req.body.status !== undefined ? clean(req.body.status) : role.status;
    const permissions = validPages(req.body.permissions);
    if (!roleName) return res.status(400).json({ error: 'Role name is required.' });
    if (!['Active', 'Inactive'].includes(status)) return res.status(400).json({ error: 'Status must be Active or Inactive.' });
    if (roleKey === 'transport_incharge' && !permissions.includes('settings')) permissions.push('settings');

    await db.transaction(async (t) => {
      await t.run('UPDATE roles SET role_name = ?, status = ?, updated_at = NOW() WHERE role_key = ?', [roleName, status, roleKey]);
      await t.run('DELETE FROM role_permissions WHERE role_key = ?', [roleKey]);
      for (const page of permissions) await t.run('INSERT INTO role_permissions (role_key, page_key) VALUES (?, ?)', [roleKey, page]);
    });
    res.json({ ...(await db.prepare('SELECT * FROM roles WHERE role_key = ?').get(roleKey)), permissions });
  } catch (err) { next(err); }
});

// DELETE /api/settings/roles/:roleKey
router.delete('/roles/:roleKey', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const roleKey = clean(req.params.roleKey);
    const role = await db.prepare('SELECT * FROM roles WHERE role_key = ?').get(roleKey);
    if (!role) return res.status(404).json({ error: 'Role not found.' });
    if (role.is_system) return res.status(400).json({ error: 'System roles cannot be deleted.' });
    const users = await db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get(roleKey);
    if (Number(users.c) > 0) return res.status(400).json({ error: 'Move users out of this role before deleting it.' });
    await db.prepare('DELETE FROM roles WHERE role_key = ?').run(roleKey);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/settings/student-options
router.post('/student-options', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const type = validateType(req.body.type);
    if (!type) return res.status(400).json({ error: 'Invalid setting type.' });
    const value = clean(req.body.value);
    const valueError = validateValue(value);
    if (valueError) return res.status(400).json({ error: valueError });

    const max = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM student_settings WHERE type = ?').get(type);
    const info = await db.prepare(`
      INSERT INTO student_settings (type, value, sort_order, status)
      VALUES (?, ?, ?, 'Active')
    `).run(type, value, Number(max.m) + 1);

    res.status(201).json(await db.prepare('SELECT * FROM student_settings WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This option already exists.' });
    next(err);
  }
});

// PUT /api/settings/student-options/:id
router.put('/student-options/:id', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const row = await db.prepare('SELECT * FROM student_settings WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Option not found.' });

    const value = req.body.value !== undefined ? clean(req.body.value) : row.value;
    const status = req.body.status !== undefined ? clean(req.body.status) : row.status;
    const sortOrder = req.body.sort_order !== undefined ? parseInt(req.body.sort_order, 10) : row.sort_order;
    const valueError = validateValue(value);
    if (valueError) return res.status(400).json({ error: valueError });
    if (!['Active', 'Inactive'].includes(status)) return res.status(400).json({ error: 'Status must be Active or Inactive.' });
    if (Number.isNaN(sortOrder) || sortOrder < 0) return res.status(400).json({ error: 'Sort order must be a non-negative number.' });

    await db.prepare(`
      UPDATE student_settings
      SET value = ?, status = ?, sort_order = ?, updated_at = NOW()
      WHERE id = ?
    `).run(value, status, sortOrder, row.id);

    res.json(await db.prepare('SELECT * FROM student_settings WHERE id = ?').get(row.id));
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This option already exists.' });
    next(err);
  }
});

// DELETE /api/settings/student-options/:id
router.delete('/student-options/:id', requirePageAccess('settings'), async (req, res, next) => {
  try {
    const info = await db.prepare('DELETE FROM student_settings WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Option not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

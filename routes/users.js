'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { authenticate, transportInchargeOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, transportInchargeOnly); // user management is incharge-only

const ROLES = ['transport_incharge', 'data_entry'];

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.prepare(`SELECT id, username, full_name, role, status, created_at FROM users ORDER BY full_name`).all();
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/users
router.post('/', async (req, res, next) => {
  try {
    const { username, password, full_name, role, status } = req.body || {};
    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Username, password, full name and role are required.' });
    }
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const dup = await db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());
    if (dup) return res.status(409).json({ error: `Username "${username}" already exists.` });

    const info = await db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(username).trim(), bcrypt.hashSync(password, 10), String(full_name).trim(), role,
      status === 'Inactive' ? 'Inactive' : 'Active');
    res.status(201).json(await db.prepare('SELECT id, username, full_name, role, status, created_at FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) { next(err); }
});

// PUT /api/users/:id
router.put('/:id', async (req, res, next) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { full_name, role, status, password } = req.body || {};
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (password && String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const merged = {
      full_name: full_name !== undefined ? String(full_name).trim() : user.full_name,
      role: role || user.role,
      status: status || user.status,
    };
    await db.prepare(`UPDATE users SET full_name=?, role=?, status=?, updated_at=NOW() WHERE id=?`)
      .run(merged.full_name, merged.role, merged.status, user.id);

    if (password) {
      await db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(bcrypt.hashSync(password, 10), user.id);
    }
    res.json(await db.prepare('SELECT id, username, full_name, role, status, created_at FROM users WHERE id = ?').get(user.id));
  } catch (err) { next(err); }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const info = await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { signToken, authenticate, hydrateUserAccess } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const user = await db.prepare(`
      SELECT u.*, r.role_name
      FROM users u
      LEFT JOIN roles r ON r.role_key = u.role
      WHERE u.username = ?
    `).get(String(username).trim());
    if (!user || user.status !== 'Active') {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const hydrated = await hydrateUserAccess(user);
    const token = signToken(hydrated);
    res.json({
      token,
      user: {
        id: hydrated.id,
        username: hydrated.username,
        name: hydrated.full_name,
        role: hydrated.role,
        roleName: hydrated.role_name || hydrated.role,
        access: hydrated.access,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await db.prepare(`
      SELECT u.id, u.username, u.full_name, u.full_name AS name, u.role, r.role_name
      FROM users u
      LEFT JOIN roles r ON r.role_key = u.role
      WHERE u.id = ?
    `)
      .get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const hydrated = await hydrateUserAccess(user);
    res.json({
      user: {
        id: hydrated.id,
        username: hydrated.username,
        name: hydrated.name,
        role: hydrated.role,
        roleName: hydrated.role_name || hydrated.role,
        access: hydrated.access,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    await db.prepare("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?")
      .run(bcrypt.hashSync(newPassword, 10), user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

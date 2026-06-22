'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      roleName: user.role_name || user.role,
      access: user.access || [],
      name: user.full_name,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

async function permissionsForRole(role) {
  if (!role) return [];
  const rows = await db.prepare(`
    SELECT page_key FROM role_permissions
    WHERE role_key = ?
    ORDER BY page_key
  `).all(role);
  return rows.map((r) => r.page_key);
}

async function hydrateUserAccess(user) {
  const access = await permissionsForRole(user.role);
  return { ...user, access };
}

// Verify the Bearer token and attach req.user
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function hasPageAccess(user, pageKey) {
  if (!user) return false;
  return Array.isArray(user.access) && user.access.includes(pageKey);
}

// Restrict a route to specific roles
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

function requirePageAccess(pageKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    try {
      req.user.access = await permissionsForRole(req.user.role);
    } catch (err) {
      return next(err);
    }
    if (!hasPageAccess(req.user, pageKey)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

const transportInchargeOnly = requirePageAccess('settings');

module.exports = {
  signToken,
  authenticate,
  authorize,
  permissionsForRole,
  hydrateUserAccess,
  hasPageAccess,
  requirePageAccess,
  transportInchargeOnly,
  JWT_SECRET,
};

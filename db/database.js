'use strict';

/**
 * MySQL / MariaDB data layer.
 *
 * - Auto-creates the database (DB_NAME) if it doesn't exist, then the tables.
 * - Exposes an async, better-sqlite3-style API so the route code reads naturally:
 *     await db.prepare(sql).get(params)
 *     await db.prepare(sql).all(params)
 *     await db.prepare(sql).run(params)   // -> { lastInsertRowid, changes }
 *     await db.transaction(async (t) => { await t.run(...); ... })
 *
 * Params may be:
 *   - a single object  -> named placeholders (@name or :name)
 *   - an array / multiple positional args -> positional `?`
 *
 * Dates are returned as strings (dateStrings) and the session runs in UTC so the
 * values line up with the JS UTC dates used elsewhere in the app.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'stayback_routes',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
};

let pool = null;

// ---- param expansion (named -> positional) --------------------------------
function expand(sql, params) {
  if (params == null) return [sql, []];
  if (Array.isArray(params)) return [sql, params];
  if (typeof params !== 'object') return [sql, [params]];
  const values = [];
  const newSql = sql.replace(/[@:]([a-zA-Z_][a-zA-Z0-9_]*)/g, (m, name) => {
    if (!(name in params)) return m;
    values.push(params[name]);
    return '?';
  });
  return [newSql, values];
}

// ---- normalize variadic args from the prepare() API ------------------------
function normalize(args) {
  if (args.length === 0) return [];
  if (args.length === 1) {
    const a = args[0];
    if (a && typeof a === 'object') return a; // object (named) or array (positional)
    return [a]; // single scalar -> positional
  }
  return args; // multiple positional args
}

// ---- low-level runners (use a runner: pool or a tx connection) -------------
async function _all(runner, sql, params) {
  const [s, v] = expand(sql, params);
  const [rows] = await runner.query(s, v);
  return rows;
}
async function _get(runner, sql, params) {
  const rows = await _all(runner, sql, params);
  return rows[0];
}
async function _run(runner, sql, params) {
  const [s, v] = expand(sql, params);
  const [result] = await runner.query(s, v);
  return { lastInsertRowid: result.insertId, changes: result.affectedRows };
}

function makeApi(runner) {
  return {
    prepare(sql) {
      return {
        all: (...args) => _all(runner, sql, normalize(args)),
        get: (...args) => _get(runner, sql, normalize(args)),
        run: (...args) => _run(runner, sql, normalize(args)),
      };
    },
    query: (sql, params) => _all(runner, sql, params),
    get: (sql, params) => _get(runner, sql, params),
    run: (sql, params) => _run(runner, sql, params),
  };
}

// ---- transactions ----------------------------------------------------------
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(makeApi(conn));
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

// ---- initialization --------------------------------------------------------
async function init() {
  // 1. Best-effort: try to auto-create the database. On managed/shared hosting
  //    (e.g. cPanel) the app user typically CANNOT connect without a database or
  //    run CREATE DATABASE — that's fine. We skip and assume the database was
  //    pre-created in the hosting control panel.
  let admin;
  try {
    admin = await mysql.createConnection({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
      multipleStatements: false,
    });
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`Ensured database "${cfg.database}" exists.`);
  } catch (err) {
    console.warn(`Skipping auto-create of database "${cfg.database}" (${err.code || err.message}).`);
    console.warn('  -> If this is shared hosting (cPanel/Plesk), create the database in your');
    console.warn('     control panel and grant this user ALL PRIVILEGES on it. Remember the');
    console.warn('     panel usually adds a prefix, e.g. "acct_stayback_routes" — put that exact');
    console.warn('     name in DB_NAME in .env.');
  } finally {
    if (admin) { try { await admin.end(); } catch (_) { /* ignore */ } }
  }

  // 2. Create the pool bound to the database.
  pool = mysql.createPool({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    database: cfg.database, connectionLimit: cfg.connectionLimit,
    waitForConnections: true, queueLimit: 0,
    dateStrings: true, timezone: 'Z', charset: 'utf8mb4_unicode_ci',
    multipleStatements: false,
  });
  // Run every connection in UTC so stored timestamps match JS UTC dates.
  pool.on('connection', (conn) => { conn.query("SET time_zone = '+00:00'"); });

  // 3. Verify we can actually reach the database, with a friendly diagnosis.
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    const c = err.code || '';
    let hint = '';
    if (c === 'ER_BAD_DB_ERROR') {
      hint = `\n  -> Database "${cfg.database}" does not exist. Create it in your hosting panel ` +
        `(names are often prefixed, e.g. "acct_${cfg.database}") and set DB_NAME to that exact name.`;
    } else if (c === 'ER_ACCESS_DENIED_ERROR' || c === 'ER_DBACCESS_DENIED_ERROR') {
      hint = '\n  -> Login/permission failed. Check DB_USER/DB_PASSWORD, make sure the user is ' +
        'ADDED to this database with ALL PRIVILEGES, and that your IP is allowed (cPanel "Remote MySQL").';
    } else if (c === 'ECONNREFUSED' || c === 'ETIMEDOUT' || c === 'ENOTFOUND') {
      hint = `\n  -> Cannot reach MySQL at ${cfg.host}:${cfg.port}. Check DB_HOST/DB_PORT and firewall/remote-access.`;
    }
    throw new Error(`${err.message}${hint}`);
  }

  // 4. Create tables (the user must have CREATE/INDEX rights on this database).
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = schema
    .split(/;\s*[\r\n]/)
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter((s) => s.length);
  for (const stmt of statements) {
    await pool.query(stmt);
  }
  await runMigrations();
  return module.exports;
}

async function tableExists(name) {
  const row = await _get(pool, `
    SELECT COUNT(*) AS c
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [name]);
  return Number(row.c) > 0;
}

async function columnType(table, column) {
  const row = await _get(pool, `
    SELECT COLUMN_TYPE AS column_type
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [table, column]);
  return row ? row.column_type : '';
}

async function runMigrations() {
  if (await tableExists('users')) {
    const roleType = String(await columnType('users', 'role') || '').toLowerCase();
    if (roleType.startsWith('enum(')) {
      await pool.query('ALTER TABLE users MODIFY role VARCHAR(80) NOT NULL');
    }
  }

  await seedRolesAndPermissions();
}

async function seedRolesAndPermissions() {
  const roles = [
    ['transport_incharge', 'Transport Incharge', 1],
    ['data_entry', 'Data Entry User', 1],
  ];
  for (const role of roles) {
    await pool.query(`
      INSERT INTO roles (role_key, role_name, is_system, status)
      VALUES (?, ?, ?, 'Active')
      ON DUPLICATE KEY UPDATE role_name = VALUES(role_name), is_system = VALUES(is_system)
    `, role);
  }

  const defaults = {
    transport_incharge: ['dashboard', 'students', 'trips', 'buses', 'route-assignment', 'route-replacement', 'notifications', 'reports', 'settings'],
    data_entry: ['dashboard', 'students', 'trips', 'route-assignment', 'reports'],
  };
  for (const [roleKey, pages] of Object.entries(defaults)) {
    for (const page of pages) {
      await pool.query('INSERT IGNORE INTO role_permissions (role_key, page_key) VALUES (?, ?)', [roleKey, page]);
    }
  }
}

module.exports = makeApi({ query: (...a) => pool.query(...a) });
module.exports.init = init;
module.exports.transaction = transaction;
module.exports.config = cfg;

'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const whatsapp = require('../services/whatsapp');

const router = express.Router();
router.use(authenticate);
router.use(requirePageAccess('notifications'));

async function busForRoute(route) {
  if (!route) return null;
  return db.prepare(`SELECT * FROM buses WHERE route_number = ? AND status='Active' ORDER BY id LIMIT 1`).get(route);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
async function routeForTodayTrip(studentId) {
  const row = await db.prepare(`
    SELECT route_number FROM trip_assignments
    WHERE student_id = ? AND trip_date = ?
  `).get(studentId, today());
  return row ? row.route_number : null;
}

// GET /api/notifications/preview
router.get('/preview', async (req, res, next) => {
  try {
    const scope = req.query.scope || 'trip';
    let students = [];
    if (scope === 'route') {
      const selectedRoutes = []
        .concat(req.query.routes || req.query.route || [])
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim())
        .filter(Boolean);
      const routes = [...new Set(selectedRoutes)];
      if (routes.length) {
        const placeholders = routes.map(() => '?').join(',');
        students = await db.query(
          `SELECT s.id, s.student_code, s.name, s.class, s.section, s.category, s.parent_name, s.parent_mobile,
                  s.status, t.route_number, t.route_number AS temporary_route_number,
                  s.route_number AS actual_route_number
           FROM trip_assignments t
           JOIN students s ON s.id = t.student_id
           WHERE t.trip_date = ? AND t.route_number IN (${placeholders}) AND s.status='Active'
           ORDER BY t.route_number, s.name`,
          [today(), ...routes]
        );
      }
    } else {
      const date = String(req.query.date || today());
      students = await db.prepare(`
        SELECT s.id, s.student_code, s.name, s.class, s.section, s.category, s.parent_name, s.parent_mobile,
               s.status, t.route_number, t.route_number AS temporary_route_number,
               s.route_number AS actual_route_number
        FROM trip_assignments t JOIN students s ON s.id = t.student_id
        WHERE t.trip_date = ? ORDER BY t.route_number, s.name
      `).all(date);
    }
    const data = [];
    for (const s of students) {
      const bus = await busForRoute(s.route_number);
      const destination = whatsapp.formatNumber(s.parent_mobile);
      const mobileReady = whatsapp.isValidDestination(destination);
      data.push({
        student_id: s.id, student_code: s.student_code, name: s.name,
        route_number: s.route_number, mobile: s.parent_mobile,
        bus_number: bus ? bus.bus_number : null,
        tracking_link: bus ? bus.gps_link : null,
        ready: mobileReady && !!bus,
        reason: !mobileReady ? 'Invalid or missing mobile number' : (!bus ? 'No active bus for route' : ''),
      });
    }
    res.json({ enabled: whatsapp.isEnabled(), count: data.length, data });
  } catch (err) { next(err); }
});

// POST /api/notifications/send  (transport incharge only)
router.post('/send', requirePageAccess('notifications'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
    if (!ids.length) return res.status(400).json({ error: 'No students selected.' });
    const template = req.body.template || whatsapp.DEFAULT_TEMPLATE;

    const logSql = `
      INSERT INTO notification_log (student_id, student_name, mobile, bus_number, tracking_link, message, status, provider_response, sent_by)
      VALUES (@student_id, @student_name, @mobile, @bus_number, @tracking_link, @message, @status, @provider_response, @sent_by)
    `;

    const results = [];
    for (const id of ids) {
      const s = await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
      if (!s) continue;
      const route = await routeForTodayTrip(s.id) || s.route_number;
      const bus = await busForRoute(route);
      const r = await whatsapp.sendOne({
        mobile: s.parent_mobile,
        studentName: s.name,
        busNumber: bus ? bus.bus_number : '',
        trackingLink: bus ? bus.gps_link : '',
        contactNo: bus ? bus.driver_mobile : '',
        template,
      });
      await db.prepare(logSql).run({
        student_id: s.id, student_name: s.name, mobile: s.parent_mobile || '',
        bus_number: bus ? bus.bus_number : '', tracking_link: bus ? bus.gps_link : '',
        message: r.message, status: r.status, provider_response: r.response, sent_by: req.user.id,
      });
      results.push({ student_id: s.id, name: s.name, status: r.status });
    }

    const sent = results.filter((r) => r.status === 'Sent').length;
    const failed = results.filter((r) => r.status === 'Failed').length;
    res.json({ ok: true, total: results.length, sent, failed, results, simulated: !whatsapp.isEnabled() });
  } catch (err) { next(err); }
});

// POST /api/notifications/resend/:logId  (transport incharge only)
router.post('/resend/:logId', requirePageAccess('notifications'), async (req, res, next) => {
  try {
    const log = await db.prepare('SELECT * FROM notification_log WHERE id = ?').get(req.params.logId);
    if (!log) return res.status(404).json({ error: 'Log entry not found.' });

    const student = log.student_id ? await db.prepare('SELECT * FROM students WHERE id = ?').get(log.student_id) : null;
    const bus = student ? await busForRoute(student.route_number) : null;

    const r = await whatsapp.sendOne({
      mobile: log.mobile,
      studentName: log.student_name,
      busNumber: bus ? bus.bus_number : log.bus_number,
      trackingLink: bus ? bus.gps_link : log.tracking_link,
      contactNo: bus ? bus.driver_mobile : '',
    });

    await db.prepare(`
      INSERT INTO notification_log (student_id, student_name, mobile, bus_number, tracking_link, message, status, provider_response, sent_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(log.student_id, log.student_name, log.mobile, log.bus_number, log.tracking_link,
      r.message, r.status, r.response, req.user.id);

    res.json({ ok: true, status: r.status });
  } catch (err) { next(err); }
});

// GET /api/notifications/log  -> message tracking
router.get('/log', async (req, res, next) => {
  try {
    const { status = '', date = '' } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (date) { where.push('DATE(sent_at) = ?'); params.push(date); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.query(`SELECT * FROM notification_log ${clause} ORDER BY sent_at DESC, id DESC LIMIT 500`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;

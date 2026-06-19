'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requirePageAccess('trips'));

function today() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/trips/today  -> list of students assigned to today's 5 PM trip
router.get('/today', async (req, res, next) => {
  try {
    const date = String(req.query.date || today());
    const rows = await db.prepare(`
      SELECT t.id AS trip_id, t.trip_date, t.route_number, t.created_at,
             s.id AS student_id, s.student_code, s.name, s.class, s.section, s.category, s.parent_mobile,
             b.bus_number,
             (SELECT bb.bus_number FROM buses bb WHERE bb.route_number = t.route_number AND bb.status='Active' ORDER BY bb.id LIMIT 1) AS route_bus_number
      FROM trip_assignments t
      JOIN students s ON s.id = t.student_id
      LEFT JOIN buses b ON b.id = t.bus_id
      WHERE t.trip_date = ?
      ORDER BY t.route_number, s.name
    `).all(date);
    res.json({ date, count: rows.length, data: rows });
  } catch (err) { next(err); }
});

// POST /api/trips/assign  -> add selected students to today's trip list
router.post('/assign', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
    const date = String(req.body.date || today());
    if (!ids.length) return res.status(400).json({ error: 'No students selected.' });

    let added = 0;
    await db.transaction(async (t) => {
      for (const id of ids) {
        const s = await t.get('SELECT * FROM students WHERE id = ?', [id]);
        if (!s) continue;
        const bus = s.route_number
          ? await t.get(`SELECT id FROM buses WHERE route_number = ? AND status='Active' ORDER BY id LIMIT 1`, [s.route_number])
          : null;
        await t.run(`
          INSERT INTO trip_assignments (student_id, trip_date, route_number, bus_id, assigned_by)
          VALUES (:student_id, :trip_date, :route_number, :bus_id, :assigned_by)
          ON DUPLICATE KEY UPDATE
            route_number=VALUES(route_number), bus_id=VALUES(bus_id), assigned_by=VALUES(assigned_by)
        `, {
          student_id: s.id, trip_date: date, route_number: s.route_number || null,
          bus_id: bus ? bus.id : null, assigned_by: req.user.id,
        });
        added += 1;
      }
    });

    res.json({ ok: true, assigned: added, date });
  } catch (err) { next(err); }
});

// DELETE /api/trips/:tripId  -> remove a student from today's trip
router.delete('/:tripId', async (req, res, next) => {
  try {
    const info = await db.prepare('DELETE FROM trip_assignments WHERE id = ?').run(req.params.tripId);
    if (info.changes === 0) return res.status(404).json({ error: 'Trip entry not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/trips/clear  -> clear today's trip list
router.post('/clear', async (req, res, next) => {
  try {
    const date = String(req.body.date || today());
    await db.prepare('DELETE FROM trip_assignments WHERE trip_date = ?').run(date);
    res.json({ ok: true, date });
  } catch (err) { next(err); }
});

module.exports = router;

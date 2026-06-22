'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

function today() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/routes/occupancy  -> route/bus capacity view
router.get('/occupancy', async (req, res, next) => {
  try {
    const scope = String(req.query.scope || '').toLowerCase();
    const date = String(req.query.date || today());
    const buses = await db.prepare(`SELECT * FROM buses ORDER BY route_number IS NULL, route_number, bus_number`).all();
    const studentCounts = scope === 'trip'
      ? await db.prepare(`
          SELECT t.route_number, COUNT(*) AS c
          FROM trip_assignments t
          JOIN students s ON s.id = t.student_id
          WHERE t.trip_date = ? AND s.status = 'Active' AND t.route_number IS NOT NULL AND t.route_number <> ''
          GROUP BY t.route_number
        `).all(date)
      : await db.prepare(`
          SELECT route_number, COUNT(*) AS c FROM students
          WHERE status = 'Active' AND route_number IS NOT NULL AND route_number <> ''
          GROUP BY route_number
        `).all();
    const countMap = {};
    studentCounts.forEach((r) => { countMap[r.route_number] = r.c; });

    const rows = buses.map((b) => {
      const occupied = b.route_number ? (countMap[b.route_number] || 0) : 0;
      return {
        route_number: b.route_number,
        bus_id: b.id,
        bus_number: b.bus_number,
        capacity: b.seating_capacity,
        occupied,
        available: Math.max(0, b.seating_capacity - occupied),
        occupancy_pct: b.seating_capacity > 0 ? Math.round((occupied / b.seating_capacity) * 100) : 0,
        over_capacity: occupied > b.seating_capacity,
        status: b.status,
      };
    });

    const routesWithBus = new Set(buses.map((b) => b.route_number).filter(Boolean));
    Object.keys(countMap).forEach((route) => {
      if (!routesWithBus.has(route)) {
        rows.push({
          route_number: route, bus_id: null, bus_number: null,
          capacity: 0, occupied: countMap[route], available: 0,
          occupancy_pct: 0, over_capacity: true, status: 'No Bus',
        });
      }
    });

    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/routes/list  -> distinct route numbers from buses + students
router.get('/list', async (req, res, next) => {
  try {
    const fromBuses = (await db.prepare(`SELECT DISTINCT route_number FROM buses WHERE route_number IS NOT NULL AND route_number <> ''`).all()).map(r => r.route_number);
    const fromStudents = (await db.prepare(`SELECT DISTINCT route_number FROM students WHERE route_number IS NOT NULL AND route_number <> ''`).all()).map(r => r.route_number);
    const fromSettings = (await db.prepare(`SELECT value FROM student_settings WHERE type='route' AND status='Active' AND value <> ''`).all()).map(r => r.value);
    const set = [...new Set([...fromBuses, ...fromStudents, ...fromSettings])].sort();
    res.json(set);
  } catch (err) { next(err); }
});

// PUT /api/routes/bus/:id/route  -> update one bus route from Route Assignment
router.put('/bus/:id/route', requirePageAccess('route-assignment'), async (req, res, next) => {
  try {
    const route = String(req.body.route_number || '').trim();
    if (!route) return res.status(400).json({ error: 'Route Number is required.' });

    const bus = await db.prepare('SELECT * FROM buses WHERE id = ?').get(req.params.id);
    if (!bus) return res.status(404).json({ error: 'Bus not found.' });

    let unassignedBus = null;
    await db.transaction(async (t) => {
      const conflict = await t.get('SELECT id, bus_number FROM buses WHERE route_number = ? AND id <> ?', [route, bus.id]);
      if (conflict) {
        unassignedBus = conflict;
        await t.run('UPDATE buses SET route_number = NULL, updated_at = NOW() WHERE id = ?', [conflict.id]);
        await t.run('UPDATE trip_assignments SET bus_id = NULL WHERE bus_id = ?', [conflict.id]);
      }
      await t.run('UPDATE buses SET route_number = ?, updated_at = NOW() WHERE id = ?', [route, bus.id]);
      await t.run('UPDATE trip_assignments SET bus_id = ? WHERE route_number = ?', [bus.id, route]);
      await t.run('UPDATE trip_assignments SET route_number = ? WHERE bus_id = ?', [route, bus.id]);
      await t.run(`
        UPDATE students s
        JOIN trip_assignments t ON t.student_id = s.id
        SET s.temporary_route_number = ?, s.updated_at = NOW()
        WHERE t.bus_id = ? AND t.trip_date = CURDATE()
      `, [route, bus.id]);
    });
    res.json({ ok: true, bus_id: bus.id, route_number: route, unassignedBus });
  } catch (err) { next(err); }
});

// Capacity for a given route (sum of active buses' capacity)
async function routeCapacity(route) {
  const row = await db.prepare(`SELECT COALESCE(SUM(seating_capacity),0) AS cap FROM buses WHERE route_number = ? AND status = 'Active'`).get(route);
  return Number(row.cap) || 0;
}
async function routeOccupied(route, excludeIds = []) {
  let sql = `SELECT COUNT(*) AS c FROM students WHERE route_number = ? AND status = 'Active'`;
  const params = [route];
  if (excludeIds.length) {
    sql += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    params.push(...excludeIds);
  }
  return (await db.get(sql, params)).c;
}
async function tripRouteOccupied(route, date) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS c
    FROM trip_assignments t
    JOIN students s ON s.id = t.student_id
    WHERE t.route_number = ? AND t.trip_date = ? AND s.status = 'Active'
  `).get(route, date);
  return Number(row.c) || 0;
}

// POST /api/routes/assign  -> assign selected students to a route for today's trip only
router.post('/assign', requirePageAccess('route-assignment'), async (req, res, next) => {
  try {
    const studentIds = Array.isArray(req.body.studentIds)
      ? [...new Set(req.body.studentIds.map((id) => Number(id)).filter(Number.isFinite))]
      : [];
    const date = String(req.body.date || today());
    const route = String(req.body.route || '').trim();
    const force = !!req.body.force;
    if (!studentIds.length) return res.status(400).json({ error: 'No students selected.' });
    if (!route) return res.status(400).json({ error: 'Route is required.' });

    const tripRows = await db.query(
      `SELECT student_id, route_number FROM trip_assignments
       WHERE trip_date = ? AND student_id IN (${studentIds.map(() => '?').join(',')})`,
      [date, ...studentIds]
    );
    if (!tripRows.length) return res.status(400).json({ error: 'Selected students are not in today\'s trip list.' });
    const tripStudentIds = tripRows.map((row) => Number(row.student_id));

    const capacity = await routeCapacity(route);
    const alreadyOnRoute = tripRows
      .filter((row) => String(row.route_number || '') === route)
      .map((row) => Number(row.student_id));
    const newcomers = tripStudentIds.filter((id) => !alreadyOnRoute.includes(id));

    const currentOccupied = await tripRouteOccupied(route, date);
    const projected = currentOccupied + newcomers.length;

    if (capacity > 0 && projected > capacity && !force) {
      return res.status(409).json({
        error: 'Capacity exceeded.',
        capacityWarning: true,
        route, capacity, currentOccupied, projected, exceededBy: projected - capacity,
      });
    }
    if (capacity === 0 && !force) {
      return res.status(409).json({
        error: `Route "${route}" has no active bus / capacity configured.`,
        capacityWarning: true, route, capacity: 0, currentOccupied, projected,
      });
    }

    const bus = await db.prepare(`SELECT id FROM buses WHERE route_number = ? AND status='Active' ORDER BY id LIMIT 1`).get(route);
    await db.transaction(async (t) => {
      for (const id of tripStudentIds) {
        await t.run(`
          UPDATE trip_assignments
          SET route_number = ?, bus_id = ?, assigned_by = ?
          WHERE trip_date = ? AND student_id = ?
        `, [route, bus ? bus.id : null, req.user.id, date, id]);
        await t.run(
          'UPDATE students SET temporary_route_number = ?, updated_at = NOW() WHERE id = ?',
          [route, id]
        );
      }
    });

    res.json({ ok: true, assigned: tripStudentIds.length, route, date, capacity, occupied: await tripRouteOccupied(route, date) });
  } catch (err) { next(err); }
});

// GET /api/routes/replace/preview?old=R10  -> affected student count
router.get('/replace/preview', requirePageAccess('route-replacement'), async (req, res, next) => {
  try {
    const oldRoute = String(req.query.old || '').trim();
    if (!oldRoute) return res.status(400).json({ error: 'Old route is required.' });
    const count = (await db.prepare(`SELECT COUNT(*) AS c FROM students WHERE route_number = ?`).get(oldRoute)).c;
    const newRoute = String(req.query.new || '').trim();
    const result = { oldRoute, affectedCount: count };
    if (newRoute) {
      result.newRoute = newRoute;
      result.newRouteCapacity = await routeCapacity(newRoute);
      result.newRouteCurrentOccupied = await routeOccupied(newRoute);
    }
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/routes/replace  -> replace old route with new route for all linked students
router.post('/replace', requirePageAccess('route-replacement'), async (req, res, next) => {
  try {
    const oldRoute = String(req.body.oldRoute || '').trim();
    const newRoute = String(req.body.newRoute || '').trim();
    const force = !!req.body.force;
    if (!oldRoute || !newRoute) return res.status(400).json({ error: 'Old and new route are required.' });
    if (oldRoute === newRoute) return res.status(400).json({ error: 'Old and new route must be different.' });

    const affected = (await db.prepare(`SELECT COUNT(*) AS c FROM students WHERE route_number = ?`).get(oldRoute)).c;
    if (affected === 0) return res.status(400).json({ error: `No students are currently on route "${oldRoute}".` });

    const capacity = await routeCapacity(newRoute);
    const existingOnNew = await routeOccupied(newRoute);
    const projected = existingOnNew + affected;
    if (capacity > 0 && projected > capacity && !force) {
      return res.status(409).json({
        error: 'Destination route capacity exceeded.',
        capacityWarning: true, newRoute, capacity, projected, exceededBy: projected - capacity,
      });
    }

    await db.transaction(async (t) => {
      await t.run(`UPDATE students SET route_number = ?, updated_at = NOW() WHERE route_number = ?`, [newRoute, oldRoute]);
      await t.run(`
        INSERT INTO route_replacement_log (old_route, new_route, affected_count, updated_by, updated_by_name)
        VALUES (?, ?, ?, ?, ?)
      `, [oldRoute, newRoute, affected, req.user.id, req.user.name]);
    });

    res.json({ ok: true, oldRoute, newRoute, affectedCount: affected });
  } catch (err) { next(err); }
});

// GET /api/routes/replace/log  -> audit log
router.get('/replace/log', requirePageAccess('route-replacement'), async (req, res, next) => {
  try {
    const rows = await db.prepare(`SELECT * FROM route_replacement_log ORDER BY created_at DESC, id DESC LIMIT 200`).all();
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;

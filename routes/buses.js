'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, transportInchargeOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Bus rows with occupancy (active students on the same route)
const SELECT_WITH_OCCUPANCY = `
  SELECT b.*,
    (SELECT COUNT(*) FROM students s
       WHERE s.route_number = b.route_number AND s.status = 'Active') AS occupied
  FROM buses b
`;

function decorate(bus) {
  if (!bus) return bus;
  const occupied = Number(bus.occupied) || 0;
  const capacity = bus.seating_capacity || 0;
  return {
    ...bus,
    occupied,
    available: Math.max(0, capacity - occupied),
    occupancy_pct: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0,
    over_capacity: occupied > capacity,
  };
}

// GET /api/buses
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.prepare(`${SELECT_WITH_OCCUPANCY} ORDER BY b.bus_number`).all();
    res.json(rows.map(decorate));
  } catch (err) { next(err); }
});

// GET /api/buses/:id
router.get('/:id', async (req, res, next) => {
  try {
    const bus = await db.prepare(`${SELECT_WITH_OCCUPANCY} WHERE b.id = ?`).get(req.params.id);
    if (!bus) return res.status(404).json({ error: 'Bus not found.' });
    res.json(decorate(bus));
  } catch (err) { next(err); }
});

function validateBus(body, { partial = false } = {}) {
  const errors = [];
  const data = {};
  if (!partial || body.bus_number !== undefined) {
    if (!body.bus_number || !String(body.bus_number).trim()) errors.push('Bus Number is required.');
    else data.bus_number = String(body.bus_number).trim();
  }
  if (!partial || body.route_number !== undefined) {
    if (!body.route_number || !String(body.route_number).trim()) errors.push('Route Number is required.');
    else data.route_number = String(body.route_number).trim();
  }
  if (body.seating_capacity !== undefined) {
    const cap = parseInt(body.seating_capacity, 10);
    if (Number.isNaN(cap) || cap < 0) errors.push('Seating Capacity must be a non-negative number.');
    else data.seating_capacity = cap;
  }
  if (body.gps_link !== undefined) data.gps_link = String(body.gps_link || '').trim();
  if (body.driver_name !== undefined) data.driver_name = String(body.driver_name || '').trim();
  if (body.driver_mobile !== undefined) data.driver_mobile = String(body.driver_mobile || '').trim();
  if (body.status !== undefined) {
    const s = String(body.status || '').trim();
    if (s && !['Active', 'Inactive'].includes(s)) errors.push('Status must be Active or Inactive.');
    else data.status = s || 'Active';
  }
  return { errors, data };
}

// POST /api/buses  (transport incharge only)
router.post('/', transportInchargeOnly, async (req, res, next) => {
  try {
    const { errors, data } = validateBus(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    const dup = await db.prepare('SELECT id FROM buses WHERE bus_number = ?').get(data.bus_number);
    if (dup) return res.status(409).json({ error: `Bus Number "${data.bus_number}" already exists.` });

    const info = await db.prepare(`
      INSERT INTO buses (bus_number, route_number, seating_capacity, gps_link, driver_name, driver_mobile, status)
      VALUES (@bus_number, @route_number, @seating_capacity, @gps_link, @driver_name, @driver_mobile, @status)
    `).run({
      bus_number: data.bus_number, route_number: data.route_number,
      seating_capacity: data.seating_capacity || 0, gps_link: data.gps_link || '',
      driver_name: data.driver_name || '', driver_mobile: data.driver_mobile || '',
      status: data.status || 'Active',
    });
    const bus = await db.prepare(`${SELECT_WITH_OCCUPANCY} WHERE b.id = ?`).get(info.lastInsertRowid);
    res.status(201).json(decorate(bus));
  } catch (err) { next(err); }
});

// PUT /api/buses/:id  (transport incharge only)
router.put('/:id', transportInchargeOnly, async (req, res, next) => {
  try {
    const bus = await db.prepare('SELECT * FROM buses WHERE id = ?').get(req.params.id);
    if (!bus) return res.status(404).json({ error: 'Bus not found.' });
    const { errors, data } = validateBus(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    if (data.bus_number && data.bus_number !== bus.bus_number) {
      const dup = await db.prepare('SELECT id FROM buses WHERE bus_number = ? AND id <> ?').get(data.bus_number, bus.id);
      if (dup) return res.status(409).json({ error: `Bus Number "${data.bus_number}" already exists.` });
    }
    const m = { ...bus, ...data };
    await db.prepare(`
      UPDATE buses SET bus_number=@bus_number, route_number=@route_number, seating_capacity=@seating_capacity,
        gps_link=@gps_link, driver_name=@driver_name, driver_mobile=@driver_mobile, status=@status,
        updated_at=NOW()
      WHERE id=@id
    `).run({
      id: bus.id, bus_number: m.bus_number, route_number: m.route_number,
      seating_capacity: m.seating_capacity || 0, gps_link: m.gps_link || '',
      driver_name: m.driver_name || '', driver_mobile: m.driver_mobile || '', status: m.status || 'Active',
    });
    const updated = await db.prepare(`${SELECT_WITH_OCCUPANCY} WHERE b.id = ?`).get(bus.id);
    res.json(decorate(updated));
  } catch (err) { next(err); }
});

// DELETE /api/buses/:id  (transport incharge only)
router.delete('/:id', transportInchargeOnly, async (req, res, next) => {
  try {
    const info = await db.prepare('DELETE FROM buses WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Bus not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

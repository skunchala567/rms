'use strict';

const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const { parseUpload } = require('../services/excel');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.use(authenticate);
router.use(requirePageAccess('buses'));

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
    const busNumber = String(body.bus_number || '').trim();
    if (!busNumber) errors.push('Bus Number is required.');
    else if (!/^[A-Za-z0-9]+$/.test(busNumber)) errors.push('Bus Number can use only letters and numbers. Spaces and special characters are not allowed.');
    else data.bus_number = busNumber;
  }
  if (!partial || body.route_number !== undefined) {
    if (!body.route_number || !String(body.route_number).trim()) errors.push('Route Number is required.');
    else data.route_number = String(body.route_number).trim();
  }
  if (body.seating_capacity !== undefined) {
    const rawCapacity = String(body.seating_capacity || '').trim();
    const cap = rawCapacity ? parseInt(rawCapacity, 10) : 0;
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

function pick(row, names) {
  for (const n of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === n);
    if (key !== undefined) return row[key];
  }
  return '';
}

async function buildBulkPreview(rows) {
  const errors = [];
  const validRows = [];
  const seenBusNumbers = new Set();
  const seenRoutes = new Set();
  const existingBuses = new Set((await db.prepare('SELECT bus_number FROM buses').all()).map((r) => String(r.bus_number).toUpperCase()));
  const existingRoutes = new Map((await db.prepare('SELECT route_number, bus_number FROM buses').all())
    .map((r) => [String(r.route_number).toUpperCase(), String(r.bus_number)]));

  rows.forEach((row) => {
    const rowNo = row.__row;
    const data = {
      bus_number: String(pick(row, ['busno', 'busnumber', 'bus']) || '').trim(),
      route_number: String(pick(row, ['routeno', 'routenumber', 'route']) || '').trim(),
      seating_capacity: String(pick(row, ['seatingcapacity', 'capacity', 'seats']) || '').trim(),
      gps_link: String(pick(row, ['gpstrackinglink', 'gpslink', 'trackinglink']) || '').trim(),
      driver_name: String(pick(row, ['drivername', 'driver']) || '').trim(),
      driver_mobile: String(pick(row, ['drivermobile', 'drivermobilenumber', 'mobile']) || '').trim(),
      status: String(pick(row, ['status']) || 'Active').trim(),
    };
    const rowErrors = [];
    const { errors: validationErrors, data: validated } = validateBus(data);
    rowErrors.push(...validationErrors);

    if (data.bus_number) {
      const key = data.bus_number.toUpperCase();
      if (seenBusNumbers.has(key)) rowErrors.push('Duplicate Bus Number in file.');
      seenBusNumbers.add(key);
      if (existingBuses.has(key)) rowErrors.push(`Bus Number "${data.bus_number}" already exists.`);
    }
    if (data.route_number) {
      const key = data.route_number.toUpperCase();
      if (seenRoutes.has(key)) rowErrors.push('Duplicate Route Number in file.');
      seenRoutes.add(key);
      const routeBus = existingRoutes.get(key);
      if (routeBus) rowErrors.push(`Route "${data.route_number}" is already selected for bus "${routeBus}".`);
    }

    if (rowErrors.length) {
      errors.push({ row: rowNo, bus_number: data.bus_number, route_number: data.route_number, messages: rowErrors });
    } else {
      validRows.push({ row: rowNo, data: { ...validated, seating_capacity: validated.seating_capacity || 0 } });
    }
  });

  return {
    totalRows: rows.length,
    validCount: validRows.length,
    errorCount: errors.length,
    validRows,
    errors,
  };
}

// POST /api/buses  (transport incharge only)
router.post('/', requirePageAccess('buses'), async (req, res, next) => {
  try {
    const { errors, data } = validateBus(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    const dup = await db.prepare('SELECT id FROM buses WHERE bus_number = ?').get(data.bus_number);
    if (dup) return res.status(409).json({ error: `Bus Number "${data.bus_number}" already exists.` });
    const routeDup = await db.prepare('SELECT bus_number FROM buses WHERE route_number = ?').get(data.route_number);
    if (routeDup) return res.status(409).json({ error: `Route "${data.route_number}" is already selected for bus "${routeDup.bus_number}".` });

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

// POST /api/buses/bulk-upload/validate
router.post('/bulk-upload/validate', requirePageAccess('buses'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const { rows } = await parseUpload(req.file.buffer, req.file.originalname);
    res.json(await buildBulkPreview(rows));
  } catch (err) {
    res.status(400).json({ error: `Could not read file: ${err.message}` });
  }
});

// POST /api/buses/bulk-upload/import
router.post('/bulk-upload/import', requirePageAccess('buses'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const { rows } = await parseUpload(req.file.buffer, req.file.originalname);
    const { validRows, errorCount, errors } = await buildBulkPreview(rows);
    const sql = `
      INSERT INTO buses (bus_number, route_number, seating_capacity, gps_link, driver_name, driver_mobile, status)
      VALUES (:bus_number, :route_number, :seating_capacity, :gps_link, :driver_name, :driver_mobile, :status)
    `;
    await db.transaction(async (t) => {
      for (const r of validRows) await t.run(sql, {
        bus_number: r.data.bus_number,
        route_number: r.data.route_number,
        seating_capacity: r.data.seating_capacity || 0,
        gps_link: r.data.gps_link || '',
        driver_name: r.data.driver_name || '',
        driver_mobile: r.data.driver_mobile || '',
        status: r.data.status || 'Active',
      });
    });
    res.json({ imported: validRows.length, skipped: errorCount, errors });
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

// PUT /api/buses/:id  (transport incharge only)
router.put('/:id', requirePageAccess('buses'), async (req, res, next) => {
  try {
    const bus = await db.prepare('SELECT * FROM buses WHERE id = ?').get(req.params.id);
    if (!bus) return res.status(404).json({ error: 'Bus not found.' });
    const { errors, data } = validateBus(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    if (data.bus_number && data.bus_number !== bus.bus_number) {
      const dup = await db.prepare('SELECT id FROM buses WHERE bus_number = ? AND id <> ?').get(data.bus_number, bus.id);
      if (dup) return res.status(409).json({ error: `Bus Number "${data.bus_number}" already exists.` });
    }
    if (data.route_number && data.route_number !== bus.route_number) {
      const routeDup = await db.prepare('SELECT bus_number FROM buses WHERE route_number = ? AND id <> ?').get(data.route_number, bus.id);
      if (routeDup) return res.status(409).json({ error: `Route "${data.route_number}" is already selected for bus "${routeDup.bus_number}".` });
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
router.delete('/:id', requirePageAccess('buses'), async (req, res, next) => {
  try {
    const info = await db.prepare('DELETE FROM buses WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Bus not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

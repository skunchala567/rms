'use strict';
const express = require('express');
const db = require('../db/database');
const { authenticate, authorize } = require('../middleware/auth');
const whatsapp = require('../services/whatsapp');
const router = express.Router();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { if (e.status) res.status(e.status).json({ error: e.message }); else next(e); } };
// Escape LIKE wildcards so a literal % or _ in the search text matches itself.
const likeTerm = search => `%${search.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
function str(body, key, max, required = true) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if ((required && !value) || value.length > max) throw fail(`${key.replaceAll('_', ' ')} is required and must be at most ${max} characters.`);
  return value;
}
function validate(body) {
  const data = {};
  for (const [key, max] of Object.entries({ requestor_name: 150, mobile: 30, subject: 200, reason: 5000, origin_name: 200, destination_name: 200 })) data[key] = str(body, key, max);
  data.mobile = whatsapp.formatNumber(data.mobile);
  if (!whatsapp.isValidDestination(data.mobile)) throw fail('Enter a valid WhatsApp number including country code.');
  data.persons = Number(body.persons);
  if (!Number.isInteger(data.persons) || data.persons < 1 || data.persons > 1000) throw fail('Number of persons must be between 1 and 1000.');
  for (const key of ['from_lat', 'from_lng', 'to_lat', 'to_lng']) {
    const n = Number(body[key]);
    if (body[key] === '' || body[key] == null || !Number.isFinite(n) || Math.abs(n) > (key.endsWith('lat') ? 90 : 180)) throw fail('Select valid pickup and destination coordinates.');
    data[key] = n;
  }
  for (const key of ['travel_at', 'end_at']) {
    if (typeof body[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$/.test(body[key]) || !Number.isFinite(Date.parse(body[key]))) throw fail('Provide valid travel and end times with a timezone.');
    data[key] = new Date(body[key]).toISOString().slice(0, 19).replace('T', ' ');
  }
  if (Date.parse(body.travel_at) <= Date.now()) throw fail('Travel must start in the future.');
  if (Date.parse(body.end_at) <= Date.parse(body.travel_at)) throw fail('End/return time must be after departure.');
  if (!['Drop', 'Round trip'].includes(body.trip_type)) throw fail('Choose Drop or Round trip.');
  data.trip_type = body.trip_type;
  data.submission_key = str(body, 'submission_key', 36);
  if (!/^[a-f0-9-]{36}$/i.test(data.submission_key)) throw fail('Invalid submission key. Refresh the form.');
  return data;
}
// References are a plain running sequence zero-padded to four digits (0001, 0002, ...), widening
// past 9999. Legacy TR-<hex> references are ignored by the numeric filter and left as they are.
async function nextReference() {
  const row = await db.get("SELECT MAX(CAST(reference AS UNSIGNED)) AS highest FROM transport_requests WHERE reference REGEXP '^[0-9]+$'");
  return String(Number(row && row.highest || 0) + 1).padStart(4, '0');
}
// Bounded, per-process abuse protection; upstream rate limits can be added for multiple instances.
const limits = new Map();
router.post('/', wrap(async (req, res) => {
  const now = Date.now();
  for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
  const key = req.ip;
  const entry = limits.get(key) || { count: 0, until: now + 3600000 };
  if (entry.count >= 20 || limits.size > 10000) throw fail('Too many submissions. Please try again later.', 429);
  entry.count++; limits.set(key, entry);
  const data = validate(req.body);
  // Concurrent submissions can pick the same number; the UNIQUE key rejects the loser and we retry.
  for (let attempt = 0; ; attempt++) {
    data.reference = await nextReference();
    try {
      const keys = Object.keys(data);
      await db.run(`INSERT INTO transport_requests (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(data));
      break;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      const prior = await db.get('SELECT reference FROM transport_requests WHERE submission_key = ?', [data.submission_key]);
      if (prior) { data.reference = prior.reference; break; }
      if (attempt >= 4) throw e;
    }
  }
  res.status(201).json({ reference: data.reference, status: 'Pending' });
}));
// Public board of journeys that have not finished yet, so a requestor can join an existing trip
// instead of raising a duplicate. Only non-identifying columns are selected: mobile numbers,
// travel reasons, driver contacts and rejections never leave the authenticated views.
const PUBLIC_PAGE_SIZE = 10;
const PUBLIC_COLUMNS = ['reference', 'subject', 'requestor_name', 'persons', 'trip_type', 'origin_name', 'destination_name',
  'from_lat', 'from_lng', 'to_lat', 'to_lng', 'travel_at', 'end_at', 'status', 'vehicle_number'].map(col => `r.${col}`).join(', ');
const PUBLIC_SEARCH_COLUMNS = ['r.reference', 'r.subject', 'r.origin_name', 'r.destination_name', 'r.requestor_name'];
// travel_at is stored in UTC; shift it to IST before comparing against the calendar dates a requestor picks.
const IST_TRAVEL_DATE = 'DATE(DATE_ADD(r.travel_at, INTERVAL 330 MINUTE))';
// The board and its calendar must agree on what is visible, so both start from the same filters.
function publicFilters(query) {
  const status = typeof query.status === 'string' && query.status ? query.status : 'All';
  if (!['Pending', 'Accepted', 'All'].includes(status)) throw fail('Invalid status.');
  const tripType = typeof query.trip_type === 'string' ? query.trip_type.trim() : '';
  if (tripType && !['Drop', 'Round trip'].includes(tripType)) throw fail('Invalid trip type.');
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  const clauses = ["r.status <> 'Rejected'", 'r.end_at >= UTC_TIMESTAMP()'];
  const args = [];
  if (status !== 'All') { clauses.push('r.status = ?'); args.push(status); }
  if (tripType) { clauses.push('r.trip_type = ?'); args.push(tripType); }
  if (search) {
    const term = likeTerm(search);
    clauses.push(`(${PUBLIC_SEARCH_COLUMNS.map(col => `${col} LIKE ?`).join(' OR ')})`);
    args.push(...PUBLIC_SEARCH_COLUMNS.map(() => term));
  }
  return { clauses, args };
}
// Per-day trip counts for the calendar view, so the grid can be drawn in one request.
router.get('/public/calendar', wrap(async (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('Provide the month as YYYY-MM.');
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const { clauses, args } = publicFilters(req.query);
  clauses.push(`${IST_TRAVEL_DATE} BETWEEN ? AND ?`);
  args.push(`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`);
  const rows = await db.query(`SELECT ${IST_TRAVEL_DATE} AS day, COUNT(*) AS total,
      SUM(r.status = 'Accepted') AS accepted, SUM(r.status = 'Pending') AS pending
    FROM transport_requests r WHERE ${clauses.join(' AND ')} GROUP BY day ORDER BY day`, args);
  res.json({
    month,
    days: rows.map(row => ({ date: row.day, total: Number(row.total), accepted: Number(row.accepted), pending: Number(row.pending) })),
  });
}));
router.get('/public/upcoming', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { clauses, args } = publicFilters(req.query);
  for (const [key, operator] of [['from_date', '>='], ['to_date', '<=']]) {
    const value = typeof req.query[key] === 'string' ? req.query[key].trim() : '';
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw fail('Provide travel dates as YYYY-MM-DD.');
    clauses.push(`${IST_TRAVEL_DATE} ${operator} ?`);
    args.push(value);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const count = await db.get(`SELECT COUNT(*) AS total FROM transport_requests r ${where}`, args);
  const total = Number(count.total);
  const rows = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM transport_requests r ${where}
    ORDER BY r.travel_at ASC, r.id ASC LIMIT ${PUBLIC_PAGE_SIZE} OFFSET ?`, [...args, (page - 1) * PUBLIC_PAGE_SIZE]);
  res.json({ rows, total, page, pageSize: PUBLIC_PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE)) });
}));
router.use(authenticate, authorize('transport_incharge', 'admin'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const PAGE_SIZE = 25;
const SEARCH_COLUMNS = ['r.reference', 'r.subject', 'r.requestor_name', 'r.mobile', 'r.origin_name', 'r.destination_name', 'r.vehicle_number'];
router.get('/', wrap(async (req, res) => {
  const status = req.query.status || 'Pending';
  if (!['Pending', 'Accepted', 'Rejected', 'All'].includes(status)) throw fail('Invalid status.');
  const tripType = typeof req.query.trip_type === 'string' ? req.query.trip_type.trim() : '';
  if (tripType && !['Drop', 'Round trip'].includes(tripType)) throw fail('Invalid trip type.');
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const clauses = [];
  const args = [];
  if (status !== 'All') { clauses.push('r.status = ?'); args.push(status); }
  if (tripType) { clauses.push('r.trip_type = ?'); args.push(tripType); }
  if (search) {
    const term = likeTerm(search);
    clauses.push(`(${SEARCH_COLUMNS.map((col) => `${col} LIKE ?`).join(' OR ')})`);
    args.push(...SEARCH_COLUMNS.map(() => term));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const count = await db.get(`SELECT COUNT(*) AS total FROM transport_requests r ${where}`, args);
  const total = Number(count.total);
  const rows = await db.query(`SELECT r.*, m.status AS message_status, m.message, m.provider_response, m.updated_at AS message_updated_at
    FROM transport_requests r LEFT JOIN transport_request_messages m ON m.request_id=r.id ${where}
    ORDER BY r.created_at DESC, r.id DESC LIMIT ${PAGE_SIZE} OFFSET ?`, [...args, (page - 1) * PAGE_SIZE]);
  res.json({ rows, total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
}));
// Reserve whole dates for existing school trips, whose records have no end time.
// Check both the allocation table and legacy single-bus rows during rollout.
const freeSql = `b.status='Active'
 AND NOT EXISTS (
   SELECT 1 FROM transport_request_buses rb
   JOIN transport_requests booked ON booked.id=rb.request_id
   WHERE rb.bus_id=b.id AND booked.status='Accepted' AND booked.travel_at < ? AND booked.end_at > ?
 )
 AND NOT EXISTS (
   SELECT 1 FROM transport_requests legacy
   WHERE legacy.bus_id=b.id AND legacy.status='Accepted'
     AND legacy.travel_at < ? AND legacy.end_at > ?
     AND NOT EXISTS (SELECT 1 FROM transport_request_buses rb2 WHERE rb2.request_id=legacy.id)
 )
 AND NOT EXISTS (SELECT 1 FROM trip_assignments t WHERE t.bus_id=b.id AND t.trip_date BETWEEN DATE(DATE_ADD(?, INTERVAL 330 MINUTE)) AND DATE(DATE_ADD(?, INTERVAL 330 MINUTE)))`;
const availabilityArgs = r => [r.end_at, r.travel_at, r.end_at, r.travel_at, r.travel_at, r.end_at];
router.get('/:id/vehicles', wrap(async (req, res) => {
  const r = await db.get('SELECT * FROM transport_requests WHERE id=?', [req.params.id]);
  if (!r) throw fail('Request not found.', 404);
  const vehicles = await db.query(`SELECT b.* FROM buses b WHERE ${freeSql} ORDER BY b.bus_number`, availabilityArgs(r));
  res.json(vehicles.map(b => ({ ...b, seating_capacity: Number(b.seating_capacity) })));
}));
async function notify(id) {
  const claim = await db.run(`UPDATE transport_request_messages SET status='Sending', attempts=attempts+1, updated_at=NOW()
    WHERE request_id=? AND (status IN ('Pending','Failed','Simulated') OR (status='Sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)))`, [id]);
  if (!claim.changes) return;
  const r = await db.get('SELECT * FROM transport_requests WHERE id=?', [id]);
  let result;
  try { result = await whatsapp.sendTransportRequest(r); }
  catch (_) { result = { status: 'Failed', message: '', response: 'Notification failed. Retry from the request.' }; }
  await db.run('UPDATE transport_request_messages SET status=?, message=?, provider_response=?, updated_at=NOW() WHERE request_id=?', [result.status, result.message, result.response, id]);
}
router.post('/:id/decision', wrap(async (req, res) => {
  const status = req.body.status;
  if (!['Accepted', 'Rejected'].includes(status)) throw fail('Choose accept or reject.');
  const rejection = status === 'Rejected' ? str(req.body, 'rejection_reason', 2000) : '';
  await db.transaction(async t => {
    const r = await t.get('SELECT * FROM transport_requests WHERE id=? FOR UPDATE', [req.params.id]);
    if (!r) throw fail('Request not found.', 404);
    if (r.status !== 'Pending') throw fail('This request has already been decided.', 409);
    let buses = []; let staff = {};
    if (status === 'Accepted') {
      if (new Date(r.travel_at.replace(' ', 'T') + 'Z').getTime() <= Date.now()) throw fail('Travel time has passed; reject this request and ask for a new one.');
      const rawIds = Array.isArray(req.body.bus_ids) ? req.body.bus_ids : [req.body.bus_id];
      const busIds = [...new Set(rawIds.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
      if (!busIds.length) throw fail('Choose at least one vehicle.');
      // Lock in stable ID order before rechecking availability, serializing competing allocations.
      for (const id of busIds) {
        const b = await t.get('SELECT * FROM buses WHERE id=? FOR UPDATE', [id]);
        if (!b) throw fail('One of the selected vehicles no longer exists. Refresh the available vehicles.', 409);
        const available = await t.get(`SELECT b.id FROM buses b WHERE b.id=? AND ${freeSql}`, [id, ...availabilityArgs(r)]);
        if (!available) throw fail(`Vehicle ${b.bus_number} is no longer available. Refresh the available vehicles.`, 409);
        buses.push(b);
      }
      const totalCapacity = buses.reduce((sum, b) => sum + Number(b.seating_capacity), 0);
      if (totalCapacity < Number(r.persons)) throw fail(`Selected vehicle capacity is ${totalCapacity}; at least ${r.persons} seats are required.`, 409);
      for (const b of buses) {
        if (!b.driver_name || !b.driver_mobile) throw fail(`Add driver name and mobile to bus ${b.bus_number} before allocating it.`);
        if (!whatsapp.isValidDestination(whatsapp.formatNumber(b.driver_mobile))) throw fail(`Bus ${b.bus_number} has an invalid driver mobile number.`);
      }
      for (const key of ['attender_name', 'attender_mobile']) staff[key] = str(req.body, key, key.endsWith('mobile') ? 30 : 150, false);
      if (staff.attender_mobile && !whatsapp.isValidDestination(whatsapp.formatNumber(staff.attender_mobile))) throw fail('Enter a valid attender phone number.');
      if (!!staff.attender_name !== !!staff.attender_mobile) throw fail('Provide both attender name and mobile, or leave both empty.');
    }
    const vehicleNumbers = buses.map(b => b.bus_number).join(', ');
    const driverNames = buses.map(b => `${b.bus_number}: ${b.driver_name}`).join('; ');
    const driverMobiles = buses.map(b => `${b.bus_number}: ${b.driver_mobile}`).join('; ');
    await t.run(`UPDATE transport_requests SET status=?, bus_id=?, vehicle_number=?, driver_name=?, driver_mobile=?, attender_name=?, attender_mobile=?, rejection_reason=?, decided_by=?, decided_at=NOW() WHERE id=?`,
      [status, buses[0]?.id || null, vehicleNumbers || null, driverNames || null, driverMobiles || null, staff.attender_name || null, staff.attender_mobile || null, rejection, req.user.id, r.id]);
    for (const b of buses) {
      await t.run(`INSERT INTO transport_request_buses
        (request_id, bus_id, vehicle_number, seating_capacity, driver_name, driver_mobile)
        VALUES (?, ?, ?, ?, ?, ?)`, [r.id, b.id, b.bus_number, b.seating_capacity, b.driver_name, b.driver_mobile]);
    }
    await t.run('INSERT INTO transport_request_messages (request_id) VALUES (?)', [r.id]);
  });
  // Commit the decision before contacting the provider; failed sends remain retryable.
  await notify(req.params.id);
  res.json({ ok: true, notification: await db.get('SELECT status FROM transport_request_messages WHERE request_id=?', [req.params.id]) });
}));
router.post('/:id/retry', wrap(async (req, res) => {
  const m = await db.get('SELECT * FROM transport_request_messages WHERE request_id=?', [req.params.id]);
  if (!m) throw fail('No decision notification exists.', 404);
  if (m.status === 'Sent') throw fail('The provider has already accepted this notification.', 409);
  await notify(req.params.id);
  res.json(await db.get('SELECT status FROM transport_request_messages WHERE request_id=?', [req.params.id]));
}));
module.exports = router;
module.exports.validate = validate;

'use strict';
const express = require('express');
const db = require('../db/database');
const { authenticate, authorize } = require('../middleware/auth');
const whatsapp = require('../services/whatsapp');
const multer = require('multer');
const { parseUpload, buildWorkbook } = require('../services/excel');
const { getRequestSettings } = require('../services/transport-request-config');
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
// Requests for more than this many persons must carry a list of who is travelling.
const TRAVELLER_LIST_THRESHOLD = 2;
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const TRAVELLER_LIST_TYPES = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' };
const TRAVELLER_TEMPLATE_COLUMNS = [
  { header: 'S.No', key: 'sno', width: 8 }, { header: 'Name', key: 'name', width: 30 },
  { header: 'Class / Department', key: 'group', width: 22 }, { header: 'ID / Admission number', key: 'id_number', width: 22 },
  { header: 'Mobile', key: 'mobile', width: 18 },
];
// The approval document is whatever the reporting head signed off: a scan, a photo or a PDF.
// The declared content type is ignored; the bytes themselves decide, so nothing the incharge
// later opens can be a script wearing a .pdf name.
const APPROVAL_TYPES = {
  pdf: { mime: 'application/pdf', matches: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  jpg: { mime: 'image/jpeg', matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', matches: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: 'image/webp', matches: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
APPROVAL_TYPES.jpeg = APPROVAL_TYPES.jpg;
const APPROVAL_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
const fileName = name => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 255);
// Multer only engages for multipart bodies, so the JSON API keeps working unchanged.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES, files: 2 } });
const UPLOAD_LABEL = { travellers: 'traveller list', approval: 'approval document' };
const requestUploads = (req, res, next) => upload.fields([{ name: 'travellers', maxCount: 1 }, { name: 'approval', maxCount: 1 }])(req, res, err => {
  if (!err) return next();
  const label = UPLOAD_LABEL[err.field] || 'uploaded file';
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `The ${label} must be 5 MB or smaller.` });
  res.status(400).json({ error: `Could not read the ${label}.` });
});
// The file is parsed on the way in so the incharge never receives something Excel cannot open.
async function travellerList(file, persons) {
  if (!file) {
    if (persons > TRAVELLER_LIST_THRESHOLD) throw fail(`Attach the list of travellers (.xlsx or .csv) when more than ${TRAVELLER_LIST_THRESHOLD} persons are travelling.`);
    return null;
  }
  const ext = (file.originalname.match(/\.(xlsx|csv)$/i) || [])[1];
  if (!ext) throw fail('The traveller list must be an Excel (.xlsx) or CSV file.');
  if (!file.size) throw fail('The traveller list is empty.');
  let parsed;
  try { parsed = await parseUpload(file.buffer, file.originalname); }
  catch (_) { throw fail('The traveller list could not be read. Save it as .xlsx or .csv and try again.'); }
  if (!parsed.rows.length) throw fail('The traveller list has no rows below the header.');
  return {
    kind: 'travellers', file_name: fileName(file.originalname),
    mime_type: TRAVELLER_LIST_TYPES[ext.toLowerCase()], size_bytes: file.size, row_count: parsed.rows.length, content: file.buffer,
  };
}
// The reporting head's sign-off. Whether it is asked for at all is a Settings decision, so the
// field can be turned off for a school that does not work that way.
function approvalDocument(file, mode) {
  if (!file || !file.size) {
    if (mode === 'Required') throw fail('Attach the approval document (PDF or image) from your reporting head.');
    return null;
  }
  if (mode === 'Hidden') throw fail('Approval documents are not being collected at the moment.');
  const ext = String((file.originalname.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
  const type = APPROVAL_TYPES[ext];
  if (!type) throw fail(`The approval document must be a PDF or an image (${APPROVAL_EXTENSIONS.join(', ')}).`);
  if (!type.matches(file.buffer)) throw fail(`The approval document is not a valid ${ext.toUpperCase()} file. Re-save or rescan it and try again.`);
  return { kind: 'approval', file_name: fileName(file.originalname), mime_type: type.mime, size_bytes: file.size, row_count: 0, content: file.buffer };
}
// References are a plain running sequence zero-padded to four digits (0001, 0002, ...), widening
// past 9999. Legacy TR-<hex> references are ignored by the numeric filter and left as they are.
async function nextReference() {
  const row = await db.get("SELECT MAX(CAST(reference AS UNSIGNED)) AS highest FROM transport_requests WHERE reference REGEXP '^[0-9]+$'");
  return String(Number(row && row.highest || 0) + 1).padStart(4, '0');
}
// Bounded, per-process abuse protection; upstream rate limits can be added for multiple instances.
const limits = new Map();
router.post('/', requestUploads, wrap(async (req, res) => {
  const now = Date.now();
  for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
  const key = req.ip;
  const entry = limits.get(key) || { count: 0, until: now + 3600000 };
  if (entry.count >= 20 || limits.size > 10000) throw fail('Too many submissions. Please try again later.', 429);
  entry.count++; limits.set(key, entry);
  const data = validate(req.body);
  const files = req.files || {};
  const travellers = await travellerList((files.travellers || [])[0], data.persons);
  const approval = approvalDocument((files.approval || [])[0], (await getRequestSettings()).approvalMode);
  const attachments = [travellers, approval].filter(Boolean);
  // Concurrent submissions can pick the same number; the UNIQUE key rejects the loser and we retry.
  for (let attempt = 0; ; attempt++) {
    data.reference = await nextReference();
    try {
      await db.transaction(async t => {
        const keys = Object.keys(data);
        const saved = await t.run(`INSERT INTO transport_requests (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(data));
        for (const attachment of attachments) {
          const columns = Object.keys(attachment);
          await t.run(`INSERT INTO transport_request_attachments (request_id, ${columns.join(',')}) VALUES (?, ${columns.map(() => '?').join(',')})`, [saved.lastInsertRowid, ...Object.values(attachment)]);
        }
      });
      break;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      const prior = await db.get('SELECT reference FROM transport_requests WHERE submission_key = ?', [data.submission_key]);
      if (prior) { data.reference = prior.reference; break; }
      if (attempt >= 4) throw e;
    }
  }
  res.status(201).json({ reference: data.reference, status: 'Pending', travellers: travellers ? travellers.row_count : null, approval: approval ? approval.file_name : null });
}));
// What the public form should show for the approval document, without exposing anything else.
router.get('/public/config', wrap(async (req, res) => {
  const { approvalMode } = await getRequestSettings();
  res.json({
    travellerListThreshold: TRAVELLER_LIST_THRESHOLD,
    uploadMaxMb: UPLOAD_MAX_BYTES / (1024 * 1024),
    approval: { mode: approvalMode, extensions: APPROVAL_EXTENSIONS },
  });
}));
// Blank sheet with the expected columns, so requestors know what to fill in.
router.get('/public/travellers-template', wrap(async (req, res) => {
  const workbook = await buildWorkbook('Travellers', TRAVELLER_TEMPLATE_COLUMNS, []);
  res.set('Content-Type', TRAVELLER_LIST_TYPES.xlsx);
  res.set('Content-Disposition', 'attachment; filename="travellers-template.xlsx"');
  res.send(workbook);
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
  const rows = await db.query(`SELECT r.*, m.status AS message_status, m.message, m.provider_response, m.updated_at AS message_updated_at,
      a.file_name AS traveller_file, a.row_count AS traveller_rows, p.file_name AS approval_file, p.mime_type AS approval_mime
    FROM transport_requests r LEFT JOIN transport_request_messages m ON m.request_id=r.id
    LEFT JOIN transport_request_attachments a ON a.request_id=r.id AND a.kind='travellers'
    LEFT JOIN transport_request_attachments p ON p.request_id=r.id AND p.kind='approval' ${where}
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
// The incharge reads the attached traveller list either as rows in the review dialog
// (?format=json) or as the original file.
router.get('/:id/travellers', wrap(async (req, res) => {
  const a = await db.get(`SELECT a.*, r.reference FROM transport_request_attachments a
    JOIN transport_requests r ON r.id=a.request_id WHERE a.request_id=? AND a.kind='travellers'`, [req.params.id]);
  if (!a) throw fail('No traveller list is attached to this request.', 404);
  if (req.query.format === 'json') {
    const { headers, rows } = await parseUpload(a.content, a.file_name);
    const columns = headers.filter(Boolean);
    return res.json({ file_name: a.file_name, row_count: a.row_count, columns, rows: rows.slice(0, 500).map(row => columns.map(col => row[col] || '')) });
  }
  const ext = a.mime_type === TRAVELLER_LIST_TYPES.csv ? 'csv' : 'xlsx';
  res.set('Content-Type', a.mime_type);
  res.set('Content-Disposition', `attachment; filename="travellers-${a.reference.replace(/[^\w.-]/g, '_')}.${ext}"`);
  res.send(a.content);
}));
// The reporting head's approval, for the incharge only. It is always sent as a download with
// sniffing turned off, so a stored file can never be rendered as a page on this origin.
router.get('/:id/approval', wrap(async (req, res) => {
  const a = await db.get(`SELECT a.*, r.reference FROM transport_request_attachments a
    JOIN transport_requests r ON r.id=a.request_id WHERE a.request_id=? AND a.kind='approval'`, [req.params.id]);
  if (!a) throw fail('No approval document is attached to this request.', 404);
  const ext = (Object.entries(APPROVAL_TYPES).find(([, type]) => type.mime === a.mime_type) || ['bin'])[0];
  res.set('Content-Type', a.mime_type);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `attachment; filename="approval-${a.reference.replace(/[^\w.-]/g, '_')}.${ext}"`);
  res.send(a.content);
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
module.exports.resetSubmissionLimits = () => limits.clear();

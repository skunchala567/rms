'use strict';

const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { parseUpload } = require('../services/excel');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const CATEGORIES = [
  'Stay Back Study Hours', 'Sports', 'IIT/JEE Coaching', 'Cultural Activities', 'Other',
];

router.use(authenticate);

// Helper: attach assigned bus (bus on the student's route)
const SELECT_WITH_BUS = `
  SELECT s.*,
    (SELECT b.bus_number FROM buses b
       WHERE b.route_number = s.route_number AND b.status = 'Active'
       ORDER BY b.id LIMIT 1) AS assigned_bus
  FROM students s
`;

// GET /api/students  (search, filter, sort, pagination)
router.get('/', async (req, res, next) => {
  try {
    const {
      search = '', class: cls = '', section = '', category = '',
      route = '', status = '', sort = 'name', dir = 'asc',
      page = '1', pageSize = '20',
    } = req.query;

    const where = [];
    const params = {};

    if (search) {
      where.push('(s.name LIKE @search OR s.student_code LIKE @search OR s.parent_mobile LIKE @search)');
      params.search = `%${search}%`;
    }
    if (cls) { where.push('s.class = @cls'); params.cls = cls; }
    if (section) { where.push('s.section = @section'); params.section = section; }
    if (category) { where.push('s.category = @category'); params.category = category; }
    if (route) { where.push('s.route_number = @route'); params.route = route; }
    if (status) { where.push('s.status = @status'); params.status = status; }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sortable = {
      student_code: 's.student_code', name: 's.name', class: 's.class',
      section: 's.section', category: 's.category', route_number: 's.route_number',
      status: 's.status',
    };
    const sortCol = sortable[sort] || 's.name';
    const sortDir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const total = (await db.prepare(`SELECT COUNT(*) AS c FROM students s ${whereClause}`).get(params)).c;

    const ps = Math.max(1, parseInt(pageSize, 10) || 20);
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pg - 1) * ps;

    const rows = await db.prepare(`
      ${SELECT_WITH_BUS} ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: ps, offset });

    res.json({ data: rows, total, page: pg, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 });
  } catch (err) { next(err); }
});

// GET /api/students/filters  (distinct values for filter dropdowns)
router.get('/filters', async (req, res, next) => {
  try {
    const classes = (await db.prepare(`SELECT DISTINCT class FROM students WHERE class <> '' ORDER BY class`).all()).map(r => r.class);
    const sections = (await db.prepare(`SELECT DISTINCT section FROM students WHERE section <> '' ORDER BY section`).all()).map(r => r.section);
    const routes = (await db.prepare(`SELECT DISTINCT route_number FROM students WHERE route_number IS NOT NULL AND route_number <> '' ORDER BY route_number`).all()).map(r => r.route_number);
    res.json({ classes, sections, routes, categories: CATEGORIES });
  } catch (err) { next(err); }
});

// GET /api/students/:id
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.prepare(`${SELECT_WITH_BUS} WHERE s.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Student not found.' });
    res.json(row);
  } catch (err) { next(err); }
});

function validateStudent(body, { partial = false } = {}) {
  const errors = [];
  const data = {};
  const req = (k) => !partial || body[k] !== undefined;

  if (req('student_code')) {
    if (!body.student_code || !String(body.student_code).trim()) errors.push('Student ID is required.');
    else data.student_code = String(body.student_code).trim();
  }
  if (req('name')) {
    if (!body.name || !String(body.name).trim()) errors.push('Student Name is required.');
    else data.name = String(body.name).trim();
  }
  if (body.class !== undefined) data.class = String(body.class || '').trim();
  if (body.section !== undefined) data.section = String(body.section || '').trim();
  if (body.category !== undefined) {
    const c = String(body.category || '').trim();
    if (c && !CATEGORIES.includes(c)) errors.push(`Category must be one of: ${CATEGORIES.join(', ')}.`);
    else data.category = c || null;
  }
  if (body.parent_name !== undefined) data.parent_name = String(body.parent_name || '').trim();
  if (body.parent_mobile !== undefined) {
    const m = String(body.parent_mobile || '').trim();
    if (m && !/^\+?[0-9]{7,15}$/.test(m.replace(/[\s-]/g, ''))) errors.push('Parent Mobile must be a valid number.');
    else data.parent_mobile = m;
  }
  if (body.route_number !== undefined) data.route_number = String(body.route_number || '').trim() || null;
  if (body.status !== undefined) {
    const s = String(body.status || '').trim();
    if (s && !['Active', 'Inactive'].includes(s)) errors.push('Status must be Active or Inactive.');
    else data.status = s || 'Active';
  }
  return { errors, data };
}

// POST /api/students  (both roles)
router.post('/', async (req, res, next) => {
  try {
    const { errors, data } = validateStudent(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

    const exists = await db.prepare('SELECT id FROM students WHERE student_code = ?').get(data.student_code);
    if (exists) return res.status(409).json({ error: `Student ID "${data.student_code}" already exists.` });

    const info = await db.prepare(`
      INSERT INTO students (student_code, name, class, section, category, parent_name, parent_mobile, route_number, status)
      VALUES (@student_code, @name, @class, @section, @category, @parent_name, @parent_mobile, @route_number, @status)
    `).run({
      student_code: data.student_code, name: data.name, class: data.class || '',
      section: data.section || '', category: data.category || null,
      parent_name: data.parent_name || '', parent_mobile: data.parent_mobile || '',
      route_number: data.route_number || null, status: data.status || 'Active',
    });
    res.status(201).json(await db.prepare(`${SELECT_WITH_BUS} WHERE s.id = ?`).get(info.lastInsertRowid));
  } catch (err) { next(err); }
});

// PUT /api/students/:id  (both roles)
router.put('/:id', async (req, res, next) => {
  try {
    const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const { errors, data } = validateStudent(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

    if (data.student_code && data.student_code !== student.student_code) {
      const dup = await db.prepare('SELECT id FROM students WHERE student_code = ? AND id <> ?').get(data.student_code, student.id);
      if (dup) return res.status(409).json({ error: `Student ID "${data.student_code}" already exists.` });
    }

    const merged = { ...student, ...data };
    await db.prepare(`
      UPDATE students SET student_code=@student_code, name=@name, class=@class, section=@section,
        category=@category, parent_name=@parent_name, parent_mobile=@parent_mobile,
        route_number=@route_number, status=@status, updated_at=NOW()
      WHERE id=@id
    `).run({
      id: student.id, student_code: merged.student_code, name: merged.name, class: merged.class || '',
      section: merged.section || '', category: merged.category || null,
      parent_name: merged.parent_name || '', parent_mobile: merged.parent_mobile || '',
      route_number: merged.route_number || null, status: merged.status || 'Active',
    });
    res.json(await db.prepare(`${SELECT_WITH_BUS} WHERE s.id = ?`).get(student.id));
  } catch (err) { next(err); }
});

// DELETE /api/students/:id  (transport incharge only)
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'transport_incharge') {
      return res.status(403).json({ error: 'Only Transport Incharge can delete students.' });
    }
    const info = await db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Student not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/students/bulk-delete  (transport incharge only)
router.post('/bulk-delete', async (req, res, next) => {
  try {
    if (req.user.role !== 'transport_incharge') {
      return res.status(403).json({ error: 'Only Transport Incharge can delete students.' });
    }
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'No students selected.' });
    await db.transaction(async (t) => {
      for (const id of ids) await t.run('DELETE FROM students WHERE id = ?', [id]);
    });
    res.json({ ok: true, deleted: ids.length });
  } catch (err) { next(err); }
});

// POST /api/students/bulk-upload/validate  -> validate file, return preview + errors
router.post('/bulk-upload/validate', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const { rows } = await parseUpload(req.file.buffer, req.file.originalname);
    res.json(buildBulkPreview(rows));
  } catch (err) {
    res.status(400).json({ error: `Could not read file: ${err.message}` });
  }
});

// POST /api/students/bulk-upload/import  -> import the valid rows
router.post('/bulk-upload/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const { rows } = await parseUpload(req.file.buffer, req.file.originalname);
    const { validRows, errorCount, errors } = buildBulkPreview(rows);

    const sql = `
      INSERT INTO students (student_code, name, class, section, category, parent_mobile, status)
      VALUES (:student_code, :name, :class, :section, :category, :parent_mobile, 'Active')
      ON DUPLICATE KEY UPDATE
        name=VALUES(name), class=VALUES(class), section=VALUES(section),
        category=VALUES(category), parent_mobile=VALUES(parent_mobile), updated_at=NOW()
    `;
    await db.transaction(async (t) => {
      for (const r of validRows) await t.run(sql, r.data);
    });

    res.json({ imported: validRows.length, skipped: errorCount, errors });
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

// Map flexible header names -> canonical field
function pick(row, names) {
  for (const n of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === n);
    if (key !== undefined) return row[key];
  }
  return '';
}

function buildBulkPreview(rows) {
  const errors = [];
  const validRows = [];
  const seenCodes = new Set();

  rows.forEach((row) => {
    const rowNo = row.__row;
    const data = {
      student_code: String(pick(row, ['studentid', 'studentcode', 'id']) || '').trim(),
      name: String(pick(row, ['studentname', 'name']) || '').trim(),
      class: String(pick(row, ['class']) || '').trim(),
      section: String(pick(row, ['section']) || '').trim(),
      category: String(pick(row, ['category', 'categoryofdrop']) || '').trim(),
      parent_mobile: String(pick(row, ['parentmobile', 'parentmobilenumber', 'mobile']) || '').trim(),
    };
    const rowErrors = [];
    if (!data.student_code) rowErrors.push('Missing Student ID');
    if (!data.name) rowErrors.push('Missing Student Name');
    if (data.category && !CATEGORIES.includes(data.category)) {
      rowErrors.push(`Invalid Category "${data.category}"`);
    }
    if (data.parent_mobile && !/^\+?[0-9]{7,15}$/.test(data.parent_mobile.replace(/[\s-]/g, ''))) {
      rowErrors.push('Invalid Parent Mobile');
    }
    if (data.student_code) {
      if (seenCodes.has(data.student_code)) rowErrors.push('Duplicate Student ID in file');
      seenCodes.add(data.student_code);
    }
    if (!data.category) data.category = null;

    if (rowErrors.length) {
      errors.push({ row: rowNo, student_code: data.student_code, name: data.name, messages: rowErrors });
    } else {
      validRows.push({ row: rowNo, data });
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

module.exports = router;

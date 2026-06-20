'use strict';

const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const { parseUpload } = require('../services/excel');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const CATEGORIES = [
  'Stay Back Study Hours', 'Sports', 'IIT/JEE Coaching', 'Cultural Activities', 'Other',
];
const STATUSES = ['Active', 'Inactive'];

function clean(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function normalizeMobile(value) {
  let n = clean(value).replace(/\D/g, '');
  if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
  if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
  return n;
}

function validateCode(value, label, { required = false, max = 50 } = {}) {
  const v = clean(value);
  if (!v) return required ? `${label} is required.` : '';
  if (v.length > max) return `${label} must be ${max} characters or fewer.`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(v)) {
    return `${label} can use only letters, numbers, slash, hyphen, and underscore.`;
  }
  return '';
}

function validatePersonName(value, label, { required = false } = {}) {
  const v = clean(value);
  if (!v) return required ? `${label} is required.` : '';
  if (v.length < 2) return `${label} must be at least 2 characters.`;
  if (v.length > 150) return `${label} must be 150 characters or fewer.`;
  if (!/[A-Za-z]/.test(v) || /[0-9]/.test(v) || !/^[A-Za-z .'-]+$/.test(v)) {
    return `${label} can use only letters, spaces, dot, apostrophe, and hyphen.`;
  }
  return '';
}

function validateClassSection(value, label, { required = false } = {}) {
  const v = clean(value);
  if (!v) return required ? `${label} is required.` : '';
  if (v.length > 30) return `${label} must be 30 characters or fewer.`;
  if (!/^[A-Za-z0-9 /-]+$/.test(v)) {
    return `${label} can use only letters, numbers, spaces, slash, and hyphen.`;
  }
  return '';
}

function validateSettingValue(value, label, { required = false, max = 150 } = {}) {
  const v = clean(value);
  if (!v) return required ? `${label} is required.` : '';
  if (v.length > max) return `${label} must be ${max} characters or fewer.`;
  if (!/^[A-Za-z0-9 .\/_'&()-]+$/.test(v)) {
    return `${label} can use only letters, numbers, spaces, dot, slash, underscore, apostrophe, ampersand, parentheses, and hyphen.`;
  }
  return '';
}

function validateMobile(value, { required = false } = {}) {
  const raw = clean(value);
  if (!raw) return required ? 'Parent Mobile Number is required.' : '';
  const n = normalizeMobile(raw);
  if (!/^[6-9]\d{9}$/.test(n)) {
    return 'Parent Mobile Number must be a valid 10-digit Indian mobile number.';
  }
  return '';
}

router.use(authenticate);
router.use(requirePageAccess('students'));

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
    if (cls) {
      const classes = String(cls).split(',').map(clean).filter(Boolean);
      if (classes.length === 1) {
        where.push('s.class = @cls');
        params.cls = classes[0];
      } else if (classes.length > 1) {
        const keys = classes.map((value, index) => {
          const key = `cls${index}`;
          params[key] = value;
          return `@${key}`;
        });
        where.push(`s.class IN (${keys.join(',')})`);
      }
    }
    if (section) { where.push('s.section = @section'); params.section = section; }
    if (category) { where.push('s.category = @category'); params.category = category; }
    if (route) {
      const routes = String(route).split(',').map(clean).filter(Boolean);
      if (routes.length === 1) {
        where.push('s.route_number = @route');
        params.route = routes[0];
      } else if (routes.length > 1) {
        const keys = routes.map((value, index) => {
          const key = `route${index}`;
          params[key] = value;
          return `@${key}`;
        });
        where.push(`s.route_number IN (${keys.join(',')})`);
      }
    }
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
    const configuredCategories = (await db.prepare(`
      SELECT value FROM student_settings
      WHERE type = 'category' AND status = 'Active'
      ORDER BY sort_order, value
    `).all()).map(r => r.value);
    res.json({ classes, sections, routes, categories: configuredCategories.length ? configuredCategories : CATEGORIES });
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
    const studentCode = clean(body.student_code);
    const err = validateCode(studentCode, 'Student ID', { required: true });
    if (err) errors.push(err);
    else data.student_code = studentCode;
  }
  if (req('name')) {
    const name = clean(body.name);
    const err = validatePersonName(name, 'Student Name', { required: true });
    if (err) errors.push(err);
    else data.name = name;
  }
  if (req('class')) {
    const cls = clean(body.class);
    const err = validateClassSection(cls, 'Class', { required: true });
    if (err) errors.push(err);
    else data.class = cls;
  }
  if (req('section')) {
    const section = clean(body.section);
    const err = validateClassSection(section, 'Section', { required: true });
    if (err) errors.push(err);
    else data.section = section;
  }
  if (req('category')) {
    const c = clean(body.category);
    const err = validateSettingValue(c, 'Category of Drop', { required: true });
    if (err) errors.push(err);
    else data.category = c;
  }
  if (req('parent_name')) {
    const parentName = clean(body.parent_name);
    const err = validatePersonName(parentName, 'Parent Name', { required: true });
    if (err) errors.push(err);
    else data.parent_name = parentName;
  }
  if (req('parent_mobile')) {
    const mobile = clean(body.parent_mobile);
    const err = validateMobile(mobile, { required: true });
    if (err) errors.push(err);
    else data.parent_mobile = normalizeMobile(mobile);
  }
  if (body.route_number !== undefined) {
    const route = clean(body.route_number);
    const err = validateCode(route, 'Current Route Number');
    if (err) errors.push(err);
    else data.route_number = route || null;
  }
  if (req('status')) {
    const s = clean(body.status);
    if (!s) errors.push('Status is required.');
    else if (!STATUSES.includes(s)) errors.push('Status must be Active or Inactive.');
    else data.status = s;
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
      INSERT INTO students (student_code, name, class, section, category, parent_mobile, route_number, status)
      VALUES (:student_code, :name, :class, :section, :category, :parent_mobile, :route_number, 'Active')
      ON DUPLICATE KEY UPDATE
        name=VALUES(name), class=VALUES(class), section=VALUES(section),
        category=VALUES(category), parent_mobile=VALUES(parent_mobile),
        route_number=COALESCE(VALUES(route_number), route_number), updated_at=NOW()
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
      route_number: String(pick(row, ['routeno', 'routenumber', 'currentroutenumber', 'route']) || '').trim(),
    };
    const rowErrors = [];
    const codeError = validateCode(data.student_code, 'Student ID', { required: true });
    const nameError = validatePersonName(data.name, 'Student Name', { required: true });
    const classError = validateClassSection(data.class, 'Class', { required: true });
    const sectionError = validateClassSection(data.section, 'Section', { required: true });
    const mobileError = validateMobile(data.parent_mobile, { required: true });
    if (codeError) rowErrors.push(codeError);
    if (nameError) rowErrors.push(nameError);
    if (classError) rowErrors.push(classError);
    if (sectionError) rowErrors.push(sectionError);
    const categoryError = validateSettingValue(data.category, 'Category of Drop', { required: true });
    if (categoryError) rowErrors.push(categoryError);
    if (mobileError) rowErrors.push(mobileError);
    const routeError = validateCode(data.route_number, 'Route No');
    if (routeError) rowErrors.push(routeError);
    if (data.student_code) {
      if (seenCodes.has(data.student_code)) rowErrors.push('Duplicate Student ID in file');
      seenCodes.add(data.student_code);
    }
    if (!rowErrors.length) {
      data.parent_mobile = normalizeMobile(data.parent_mobile);
      data.route_number = data.route_number || null;
    }

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

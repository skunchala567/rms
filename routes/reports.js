'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');
const { buildWorkbook } = require('../services/excel');

const router = express.Router();
router.use(authenticate);
router.use(requirePageAccess('reports'));

async function busForRoute(route) {
  if (!route) return null;
  return db.prepare(`SELECT * FROM buses WHERE route_number = ? AND status='Active' ORDER BY id LIMIT 1`).get(route);
}

// ---- Daily Route Report -------------------------------------------------
async function dailyRouteRows(date) {
  const trips = await db.prepare(`
    SELECT s.name, s.student_code, s.route_number AS actual_route_number,
           t.route_number, t.route_number AS temporary_route_number, s.category, t.bus_id
    FROM trip_assignments t JOIN students s ON s.id = t.student_id
    WHERE t.trip_date = ? ORDER BY t.route_number, s.name
  `).all(date);

  let source = trips;
  if (!trips.length) {
    source = await db.prepare(`
      SELECT name, student_code, route_number, category FROM students
      WHERE status='Active' AND route_number IS NOT NULL AND route_number <> ''
      ORDER BY route_number, name
    `).all();
  }
  const out = [];
  for (const r of source) {
    const bus = await busForRoute(r.route_number);
    out.push({
      student_name: r.name,
      student_id: r.student_code,
      route_number: r.route_number || '-',
      temporary_route_number: r.temporary_route_number || r.route_number || '-',
      actual_route_number: r.actual_route_number || r.route_number || '-',
      bus_number: bus ? bus.bus_number : '-',
      category: r.category || '-',
    });
  }
  return out;
}

router.get('/daily-route', async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    res.json({ date, data: await dailyRouteRows(date) });
  } catch (err) { next(err); }
});

// ---- Bus Occupancy Report ----------------------------------------------
async function busOccupancyRows(date = new Date().toISOString().slice(0, 10)) {
  const buses = await db.prepare(`SELECT * FROM buses ORDER BY bus_number`).all();
  const out = [];
  for (const b of buses) {
    const occupied = (await db.prepare(
      `SELECT COUNT(*) AS c
       FROM trip_assignments t
       JOIN students s ON s.id = t.student_id
       WHERE t.route_number = ? AND t.trip_date = ? AND s.status='Active'`
    ).get(b.route_number, date)).c;
    out.push({
      bus_number: b.bus_number,
      route_number: b.route_number,
      capacity: b.seating_capacity,
      occupied,
      available: Math.max(0, b.seating_capacity - occupied),
    });
  }
  return out;
}

router.get('/bus-occupancy', async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    res.json({ date, data: await busOccupancyRows(date) });
  } catch (err) { next(err); }
});

// ---- WhatsApp Delivery Report ------------------------------------------
async function whatsappRows(date) {
  const where = date ? `WHERE DATE(sent_at) = ?` : '';
  const sql = `SELECT student_name, mobile, status, sent_at FROM notification_log ${where} ORDER BY sent_at DESC, id DESC`;
  const rows = date ? await db.query(sql, [date]) : await db.query(sql);
  return rows.map((r) => ({
    student_name: r.student_name,
    mobile: r.mobile || '-',
    message_status: r.status,
    sent_time: r.sent_at,
  }));
}

router.get('/whatsapp', async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : null;
    res.json({ data: await whatsappRows(date) });
  } catch (err) { next(err); }
});

// ---- Excel exports ------------------------------------------------------
function sendXlsx(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.get('/daily-route/export', async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const buffer = await buildWorkbook('Daily Route', [
      { header: 'Student Name', key: 'student_name', width: 28 },
      { header: 'Student ID', key: 'student_id', width: 14 },
      { header: "Today's Route", key: 'temporary_route_number', width: 14 },
      { header: 'Actual Route', key: 'actual_route_number', width: 14 },
      { header: 'Bus Number', key: 'bus_number', width: 14 },
      { header: 'Category', key: 'category', width: 22 },
    ], await dailyRouteRows(date));
    sendXlsx(res, `daily-route-${date}.xlsx`, buffer);
  } catch (err) { next(err); }
});

router.get('/bus-occupancy/export', async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const buffer = await buildWorkbook('Bus Occupancy', [
      { header: 'Bus Number', key: 'bus_number', width: 16 },
      { header: 'Route Number', key: 'route_number', width: 14 },
      { header: 'Capacity', key: 'capacity', width: 12 },
      { header: 'Occupied', key: 'occupied', width: 12 },
      { header: 'Available', key: 'available', width: 12 },
    ], await busOccupancyRows(date));
    sendXlsx(res, `bus-occupancy-${date}.xlsx`, buffer);
  } catch (err) { next(err); }
});

router.get('/whatsapp/export', async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : null;
    const buffer = await buildWorkbook('WhatsApp Delivery', [
      { header: 'Student Name', key: 'student_name', width: 28 },
      { header: 'Mobile', key: 'mobile', width: 16 },
      { header: 'Message Status', key: 'message_status', width: 16 },
      { header: 'Sent Time', key: 'sent_time', width: 22 },
    ], await whatsappRows(date));
    sendXlsx(res, `whatsapp-delivery${date ? '-' + date : ''}.xlsx`, buffer);
  } catch (err) { next(err); }
});

// ---- Students export (full list) ---------------------------------------
router.get('/students/export', async (req, res, next) => {
  try {
    const rows = await db.prepare(`
      SELECT s.student_code, s.name, s.class, s.section, s.category, s.parent_name, s.parent_mobile,
             s.route_number, s.temporary_route_number, s.status,
             (SELECT b.bus_number FROM buses b WHERE b.route_number = s.route_number AND b.status='Active' ORDER BY b.id LIMIT 1) AS assigned_bus
      FROM students s ORDER BY s.name
    `).all();
    const buffer = await buildWorkbook('Students', [
      { header: 'Student ID', key: 'student_code', width: 14 },
      { header: 'Student Name', key: 'name', width: 28 },
      { header: 'Class', key: 'class', width: 10 },
      { header: 'Section', key: 'section', width: 10 },
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Parent Name', key: 'parent_name', width: 22 },
      { header: 'Parent Mobile', key: 'parent_mobile', width: 16 },
      { header: 'Route No', key: 'route_number', width: 12 },
      { header: 'Temporary Route', key: 'temporary_route_number', width: 16 },
      { header: 'Assigned Bus', key: 'assigned_bus', width: 14 },
      { header: 'Status', key: 'status', width: 10 },
    ], rows);
    sendXlsx(res, 'students.xlsx', buffer);
  } catch (err) { next(err); }
});

module.exports = router;

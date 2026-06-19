'use strict';

const express = require('express');
const db = require('../db/database');
const { authenticate, requirePageAccess } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requirePageAccess('dashboard'));

// GET /api/dashboard/summary
router.get('/summary', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const totalStudents = (await db.prepare(`SELECT COUNT(*) AS c FROM students`).get()).c;
    const awaitingRoute = (await db.prepare(
      `SELECT COUNT(*) AS c FROM students WHERE status='Active' AND (route_number IS NULL OR route_number = '')`
    ).get()).c;
    const assignedFor5pm = (await db.prepare(`SELECT COUNT(*) AS c FROM trip_assignments WHERE trip_date = ?`).get(today)).c;
    const activeBuses = (await db.prepare(`SELECT COUNT(*) AS c FROM buses WHERE status='Active'`).get()).c;
    const whatsappToday = (await db.prepare(
      `SELECT COUNT(*) AS c FROM notification_log WHERE DATE(sent_at) = ? AND status = 'Sent'`
    ).get(today)).c;

    res.json({ totalStudents, awaitingRoute, assignedFor5pm, activeBuses, whatsappToday, date: today });
  } catch (err) { next(err); }
});

module.exports = router;

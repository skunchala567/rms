'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/students', require('./routes/students'));
app.use('/api/buses', require('./routes/buses'));
app.use('/api/routes', require('./routes/routes'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Static PWA frontend
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    const rel = path.relative(PUBLIC_DIR, filePath).replace(/\\/g, '/');
    if (
      rel === 'index.html' ||
      rel === 'service-worker.js' ||
      rel.startsWith('js/') ||
      rel.startsWith('css/')
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  },
}));

// SPA fallback for client-side routes (anything that is not an API call)
app.get(/^(?!\/api).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// JSON error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 5 MB).' });
  }
  if (err && err.code === 'ER_CON_COUNT_ERROR') {
    return res.status(503).json({ error: 'Database is busy. Please try again in a moment.' });
  }
  res.status(500).json({ error: 'Internal server error.' });
});

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\nStay Back Route Management System running at http://localhost:${PORT}`);
      console.log(`Database: MySQL "${db.config.database}" @ ${db.config.host}:${db.config.port}`);
      console.log(`WhatsApp sending: ${require('./services/whatsapp').isEnabled() ? 'LIVE (SmartPing)' : 'SIMULATION (disabled)'}\n`);
    });
  })
  .catch((err) => {
    console.error('\nFailed to initialize the database. Check your DB_* settings in .env\n');
    console.error(err.message);
    process.exit(1);
  });

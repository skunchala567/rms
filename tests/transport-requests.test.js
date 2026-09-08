'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const mysql = require('mysql2/promise');
const express = require('express');
const crypto = require('crypto');
const testDatabase = `rms_adhoc_test_${process.pid}_${Date.now()}`;
process.env.DB_NAME = testDatabase;
process.env.DB_AUTO_CREATE = 'true';
process.env.WHATSAPP_ENABLED = 'false';
const db = require('../db/database');
const { signToken } = require('../middleware/auth');
const router = require('../routes/transport-requests');
const wa = require('../services/whatsapp');
let server, base, bus, admin, entry, administrator;
const payload = () => ({ submission_key: crypto.randomUUID(), requestor_name: 'Test requestor', mobile: '+919876543210', subject: 'Test journey', reason: 'Detailed test reason', persons: 4, origin_name: 'School', destination_name: 'Museum', from_lat: 17.38, from_lng: 78.48, to_lat: 17.40, to_lng: 78.49, travel_at: '2090-01-01T04:30:00Z', end_at: '2090-01-01T08:30:00Z', trip_type: 'Round trip' });
async function request(path, method = 'GET', body, token) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
async function create(overrides = {}) {
  const data = { ...payload(), ...overrides };
  const response = await request('/', 'POST', data);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return db.get('SELECT * FROM transport_requests WHERE reference=?', [response.body.reference]);
}
const decision = () => ({ status: 'Accepted', bus_id: bus, driver_name: 'Test driver', driver_mobile: '+919876543211', attender_name: 'Test attender', attender_mobile: '+919876543212' });
before(async () => {
  await db.init();
  await db.run("INSERT INTO roles (role_key,role_name) VALUES ('admin','Admin')");
  await db.run("INSERT INTO role_permissions (role_key,page_key) VALUES ('admin','settings')");
  bus = (await db.run("INSERT INTO buses (bus_number, route_number, seating_capacity) VALUES ('TEST-01','TEST',10)")).lastInsertRowid;
  admin = signToken({ id: 1, username: 'test', role: 'transport_incharge' });
  administrator = signToken({ id: 3, username: 'administrator', role: 'admin', access: ['settings'] });
  entry = signToken({ id: 2, username: 'test-entry', role: 'data_entry', access: ['transport-requests'] });
  const app = express(); app.use(express.json());
  app.get('/maps-config', require('../services/maps-config').publicMapsConfig);
  app.use('/settings', require('../routes/settings'));
  app.use('/', router);
  app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: e.message }); });
  server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
  const connection = await mysql.createConnection({ host: db.config.host, port: db.config.port, user: db.config.user, password: db.config.password });
  try { await connection.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``); } finally { await connection.end(); }
});
test('anonymous submission validates coordinates, dates, capacity and contact; retries are idempotent', async () => {
  for (const patch of [{ from_lat: null }, { to_lng: 190 }, { travel_at: '2020-01-01T00:00:00Z' }, { end_at: '2089-01-01T00:00:00Z' }, { mobile: '123' }, { persons: 1.5 }]) {
    assert.equal((await request('/', 'POST', { ...payload(), ...patch })).status, 400);
  }
  const p = payload(); const first = await request('/', 'POST', p); const second = await request('/', 'POST', p);
  assert.equal(first.body.reference, second.body.reference);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM transport_requests WHERE submission_key=?', [p.submission_key])).n, 1);
});
test('private requests and decisions are restricted to incharges and admins', async () => {
  assert.equal((await request('/')).status, 401);
  assert.equal((await request('/', 'GET', undefined, administrator)).status, 200);
  assert.equal((await request('/', 'GET', undefined, entry)).status, 403);
  assert.equal((await request('/1/vehicles')).status, 401);
  assert.equal((await request('/1/decision', 'POST', decision(), entry)).status, 403);
});
test('only one competing request can allocate a vehicle; templates contain staff details', async () => {
  const a = await create(); const b = await create();
  const results = await Promise.all([a, b].map(r => request(`/${r.id}/decision`, 'POST', decision(), admin)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const accepted = await db.get("SELECT * FROM transport_requests WHERE status='Accepted'");
  const message = await db.get('SELECT * FROM transport_request_messages WHERE request_id=?', [accepted.id]);
  assert.equal(message.status, 'Simulated');
  assert.match(message.message, /TEST-01/); assert.match(message.message, /Test driver/); assert.match(message.message, /Test attender/);
  assert.equal((await request(`/${accepted.id}/decision`, 'POST', decision(), admin)).status, 409);
  assert.equal((await request(`/${accepted.id}/retry`, 'POST', {}, admin)).body.status, 'Simulated');
});
test('rejection requires a reason and renders a separate notification', async () => {
  const r = await create();
  assert.equal((await request(`/${r.id}/vehicles`, 'GET', undefined, administrator)).status, 200);
  assert.equal((await request(`/${r.id}/decision`, 'POST', { status: 'Rejected', rejection_reason: '' }, admin)).status, 400);
  assert.equal((await request(`/${r.id}/decision`, 'POST', { status: 'Rejected', rejection_reason: 'No vehicles available' }, administrator)).status, 200);
  const message = await db.get('SELECT * FROM transport_request_messages WHERE request_id=?', [r.id]);
  assert.equal((await request(`/${r.id}/retry`, 'POST', {}, administrator)).status, 200);
  assert.match(message.message, /No vehicles available/); assert.match(message.message, /rejected/);
});
test('availability excludes insufficient capacity and school trip bookings', async () => {
  const large = await create({ persons: 11, travel_at: '2090-02-01T04:30:00Z', end_at: '2090-02-01T08:30:00Z' });
  assert.equal((await request(`/${large.id}/vehicles`, 'GET', undefined, admin)).body.length, 0);
  assert.equal((await request(`/${large.id}/decision`, 'POST', decision(), admin)).status, 409);
  const student = (await db.run("INSERT INTO students (student_code,name) VALUES ('TEST-STUDENT','Test')")).lastInsertRowid;
  await db.run("INSERT INTO trip_assignments (student_id,trip_date,bus_id) VALUES (?,'2090-03-01',?)", [student, bus]);
  const trip = await create({ travel_at: '2090-03-01T04:30:00Z', end_at: '2090-03-01T08:30:00Z' });
  assert.equal((await request(`/${trip.id}/vehicles`, 'GET', undefined, admin)).body.length, 0);
});
test('missing live campaign configuration fails instead of pretending to send', async () => {
  process.env.WHATSAPP_ENABLED = 'true';
  const prior = process.env.SMARTPING_ADHOC_REJECTION_CAMPAIGN; delete process.env.SMARTPING_ADHOC_REJECTION_CAMPAIGN;
  const result = await wa.sendTransportRequest({ ...payload(), travel_at: '2090-01-01 04:30:00', status: 'Rejected', rejection_reason: 'Test', reference: 'TEST' });
  assert.equal(result.status, 'Failed');
  if (prior) process.env.SMARTPING_ADHOC_REJECTION_CAMPAIGN = prior;
  process.env.WHATSAPP_ENABLED = 'false';
});
test('configured confirmation/rejection use separate campaigns and ordered parameters; provider failures remain retryable', async () => {
  const http = require('node:http');
  const captured = []; let reject = false;
  const provider = http.createServer((req, res) => {
    let body = ''; req.on('data', part => body += part);
    req.on('end', () => { captured.push(JSON.parse(body)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: !reject })); });
  });
  provider.listen(0); await new Promise(resolve => provider.once('listening', resolve));
  const keys = ['WHATSAPP_ENABLED', 'SMARTPING_API_KEY', 'SMARTPING_API_URL', 'SMARTPING_ADHOC_CONFIRMATION_CAMPAIGN', 'SMARTPING_ADHOC_REJECTION_CAMPAIGN'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { WHATSAPP_ENABLED: 'true', SMARTPING_API_KEY: 'test-only', SMARTPING_API_URL: `http://127.0.0.1:${provider.address().port}`, SMARTPING_ADHOC_CONFIRMATION_CAMPAIGN: 'test-confirm', SMARTPING_ADHOC_REJECTION_CAMPAIGN: 'test-reject' });
  try {
    const record = { ...payload(), travel_at: '2090-01-01 04:30:00', reference: 'TEST', status: 'Accepted', vehicle_number: 'BUS-1', driver_name: 'Driver', driver_mobile: '9876543210' };
    assert.equal((await wa.sendTransportRequest(record)).status, 'Sent');
    assert.equal(captured[0].campaignName, 'test-confirm');
    assert.equal(captured[0].templateParams.length, 13);
    assert.equal(captured[0].templateParams[8], 'BUS-1');
    record.status = 'Rejected'; record.rejection_reason = 'No vehicle';
    assert.equal((await wa.sendTransportRequest(record)).status, 'Sent');
    assert.equal(captured[1].campaignName, 'test-reject');
    assert.equal(captured[1].templateParams[4], 'No vehicle');
    reject = true;
    assert.equal((await wa.sendTransportRequest(record)).status, 'Failed');
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    await new Promise(resolve => provider.close(resolve));
  }
});

test('Google Maps settings persist, enforce Settings access, and override environment without restart', async () => {
  const previous = process.env.GOOGLE_MAPS_BROWSER_KEY;
  process.env.GOOGLE_MAPS_BROWSER_KEY = 'environment-test-key';
  try {
    assert.equal((await request('/settings/google-maps')).status, 401);
    assert.equal((await request('/settings/google-maps', 'GET', undefined, entry)).status, 403);
    assert.equal((await request('/settings/google-maps', 'PUT', { browserKey: 'bad', enabled: true }, entry)).status, 403);
    assert.equal((await request('/maps-config')).body.browserKey, 'environment-test-key');
    assert.equal((await request('/settings/google-maps', 'PUT', { browserKey: '', enabled: true }, administrator)).status, 400);
    assert.equal((await request('/settings/google-maps', 'PUT', { browserKey: 'https://invalid key', enabled: true }, administrator)).status, 400);
    assert.equal((await request('/settings/google-maps', 'PUT', { browserKey: 'browser-test-key', enabled: true }, administrator)).status, 200);
    assert.equal((await request('/maps-config')).body.browserKey, 'browser-test-key');
    const stored = await request('/settings/google-maps', 'GET', undefined, administrator);
    assert.equal(stored.body.browserKey, 'browser-test-key');
    assert.equal(stored.body.source, 'Settings');
    await request('/settings/google-maps', 'PUT', { browserKey: 'browser-test-key', enabled: false }, administrator);
    assert.equal((await request('/maps-config')).body.browserKey, '');
    assert.equal((await request('/settings/google-maps', 'GET', undefined, administrator)).body.browserKey, 'browser-test-key');
    await request('/settings/google-maps', 'PUT', { browserKey: '', enabled: false }, administrator);
    assert.equal((await request('/maps-config')).body.browserKey, '');
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_BROWSER_KEY; else process.env.GOOGLE_MAPS_BROWSER_KEY = previous;
  }
});

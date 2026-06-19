'use strict';

/**
 * Seed script.
 *   node db/seed.js            -> seed users + sample data if tables are empty
 *   node db/seed.js --reset    -> wipe all data and re-seed
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

const reset = process.argv.includes('--reset');

async function main() {
  await db.init();

  if (reset) {
    console.log('Resetting database...');
    await db.run('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['notification_log', 'route_replacement_log', 'trip_assignments', 'students', 'buses', 'users']) {
      await db.run(`TRUNCATE TABLE ${t}`);
    }
    await db.run('SET FOREIGN_KEY_CHECKS = 1');
  }

  await seedUsers();
  await seedBuses();
  await seedStudents();

  console.log('Seed complete.');
  process.exit(0);
}

async function seedUsers() {
  const row = await db.get('SELECT COUNT(*) AS c FROM users');
  if (row.c > 0) { console.log('Users already present, skipping user seed.'); return; }
  const users = [
    ['admin', 'admin123', 'Transport Incharge', 'transport_incharge'],
    ['dataentry', 'data123', 'Data Entry User', 'data_entry'],
  ];
  for (const [username, pwd, name, role] of users) {
    await db.run(
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, 'Active')`,
      [username, bcrypt.hashSync(pwd, 10), name, role]
    );
  }
  console.log('Seeded users:');
  console.log('  Transport Incharge -> username: admin      password: admin123');
  console.log('  Data Entry         -> username: dataentry  password: data123');
}

async function seedBuses() {
  const row = await db.get('SELECT COUNT(*) AS c FROM buses');
  if (row.c > 0) return;
  const buses = [
    ['BUS-01', 'R10', 40, 'https://maps.example.com/track/BUS-01', 'Ramesh Kumar', '9876500001'],
    ['BUS-02', 'R12', 35, 'https://maps.example.com/track/BUS-02', 'Suresh Babu', '9876500002'],
    ['BUS-03', 'R15', 45, 'https://maps.example.com/track/BUS-03', 'Mahesh Rao', '9876500003'],
  ];
  for (const b of buses) {
    await db.run(
      `INSERT INTO buses (bus_number, route_number, seating_capacity, gps_link, driver_name, driver_mobile, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Active')`, b
    );
  }
  console.log('Seeded 3 sample buses.');
}

async function seedStudents() {
  const row = await db.get('SELECT COUNT(*) AS c FROM students');
  if (row.c > 0) return;
  const students = [
    ['S001', 'Aarav Sharma', '10', 'A', 'Stay Back Study Hours', 'Mr. Sharma', '9811100001', 'R10'],
    ['S002', 'Diya Patel', '10', 'B', 'IIT/JEE Coaching', 'Mr. Patel', '9811100002', 'R10'],
    ['S003', 'Vihaan Reddy', '9', 'A', 'Sports', 'Mr. Reddy', '9811100003', 'R12'],
    ['S004', 'Ananya Iyer', '11', 'C', 'Cultural Activities', 'Mr. Iyer', '9811100004', null],
    ['S005', 'Kabir Singh', '12', 'A', 'IIT/JEE Coaching', 'Mr. Singh', '9811100005', null],
  ];
  for (const s of students) {
    await db.run(
      `INSERT INTO students (student_code, name, class, section, category, parent_name, parent_mobile, route_number, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')`, s
    );
  }
  console.log('Seeded 5 sample students.');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

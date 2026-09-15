'use strict';

/**
 * Builds connections/appmaster.db — a SQLite stand-in for AppMasterDB, the
 * second business database. It carries the shapes the requirement list names:
 * - task_daily.daily_data and task_daily.task_data as JSON text columns
 *   (employee_ids, equipment_ids, actual_hours, actual_quantity, completed);
 * - work_orders.payload JSON for FLAF / PO / PEG / SCR / MOC documents;
 * - logged_at / raised_at DATETIME columns spread over the last 10 days, so
 *   relative date and relative time filters ("last 24 hours") show real rows;
 * - a completed BOOLEAN column for boolean filters.
 * Data is generated from a fixed seed, so re-running gives the same rows
 * (shifted to end at the time the seed runs).
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const connections = require('./connections');
const { getDb: getMetaDb } = require('./db');

const DB_FILE = 'appmaster.db';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function seedAppMaster(now = Date.now()) {
  fs.mkdirSync(connections.CONNECTIONS_DIR, { recursive: true });
  const dbPath = path.join(connections.CONNECTIONS_DIR, DB_FILE);
  const db = new DatabaseSync(dbPath);
  // Tables flattened from the JSON columns (task_daily__daily_data …) describe the old rows; drop them with their sources.
  const flattened = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .map((r) => r.name)
    .filter((n) => n.startsWith('task_daily__') || n.startsWith('work_orders__'));
  for (const name of flattened) db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
  db.exec(`
    DROP TABLE IF EXISTS task_daily;
    DROP TABLE IF EXISTS work_orders;
    DROP TABLE IF EXISTS plants;
    CREATE TABLE plants (plant_code TEXT PRIMARY KEY, plant_name TEXT NOT NULL, cluster TEXT NOT NULL);
    CREATE TABLE task_daily (
      id INTEGER PRIMARY KEY,
      task_code TEXT NOT NULL,
      plant_code TEXT REFERENCES plants(plant_code),
      crew TEXT,
      shift TEXT,
      work_date DATE,
      logged_at DATETIME,
      completed BOOLEAN,
      daily_data TEXT,
      task_data TEXT
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY,
      order_no TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      plant_code TEXT REFERENCES plants(plant_code),
      raised_at DATETIME,
      status TEXT,
      payload TEXT
    );
  `);

  const random = rng(20260915);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const plants = [
    ['3524', 'Marmul ODC', 'South'],
    ['3522', 'Nimr ODC', 'South'],
    ['3610', 'Fahud Station', 'North'],
  ];
  const insertPlant = db.prepare('INSERT INTO plants VALUES (?, ?, ?)');
  plants.forEach((p) => insertPlant.run(...p));

  const crews = ['Crew A', 'Crew B', 'Crew C', 'Crew D'];
  const taskTypes = ['Flowline hook-up', 'Well commissioning', 'Rig move', 'Pipe laying'];
  const insertDaily = db.prepare(
    'INSERT INTO task_daily (task_code, plant_code, crew, shift, work_date, logged_at, completed, daily_data, task_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  db.exec('BEGIN');
  for (let i = 0; i < 240; i++) {
    // Spread over the last 10 days, newest last, so "last 24 hours" and "last 7 days" both have rows.
    const loggedAt = now - Math.floor(((240 - i) / 240) * 10 * 86400000) + Math.floor(random() * 3600000);
    const plannedQ = 60 + Math.floor(random() * 60);
    const actualQ = Math.round(plannedQ * (0.55 + random() * 0.5));
    const plannedH = 8 + Math.floor(random() * 4);
    const actualH = Math.round(plannedH * (0.7 + random() * 0.5) * 10) / 10;
    const completed = actualQ >= plannedQ;
    const shift = random() < 0.6 ? 'Day' : 'Night';
    const employees = Array.from({ length: 1 + Math.floor(random() * 4) }, () => `EMP-${1000 + Math.floor(random() * 300)}`);
    const equipment = Array.from({ length: 1 + Math.floor(random() * 2) }, () => `EQ-${pick(['Excavator', 'Loader', 'Crane', 'DrillRig'])}-${10 + Math.floor(random() * 40)}`);
    const taskCode = `${pick(['FLAF', 'MOC', 'PEG'])}-2026-${String(100 + i).padStart(4, '0')}`;
    const plant = pick(plants)[0];
    const crew = pick(crews);

    const dailyData = {
      date: iso(loggedAt).slice(0, 10),
      shift,
      completed,
      employee_ids: [...new Set(employees)],
      equipment_ids: [...new Set(equipment)],
      metrics: { actual_hours: actualH, actual_quantity: actualQ, planned_hours: plannedH, planned_quantity: plannedQ },
    };
    const taskData = {
      task_type: pick(taskTypes),
      location: { lat: Math.round((18 + random() * 4) * 1e4) / 1e4, lng: Math.round((54 + random() * 3) * 1e4) / 1e4 },
      approvals: [
        { role: 'Supervisor', name: pick(['J. Alvarez', 'T. Nakamura', 'A. Al Balushi']), approved: random() < 0.85 },
        ...(random() < 0.5 ? [{ role: 'QA', name: pick(['R. Kim', 'S. Al Harthy']), approved: random() < 0.7 }] : []),
      ],
    };
    insertDaily.run(taskCode, plant, crew, shift, iso(loggedAt).slice(0, 10), iso(loggedAt), completed ? 1 : 0, JSON.stringify(dailyData), JSON.stringify(taskData));
  }

  const insertOrder = db.prepare('INSERT INTO work_orders (order_no, doc_type, plant_code, raised_at, status, payload) VALUES (?, ?, ?, ?, ?, ?)');
  const payloadFor = (type, n) => {
    switch (type) {
      case 'FLAF':
        return { flaf_no: `FLAF-${n}`, received_date: iso(now - Math.floor(random() * 20) * 86400000).slice(0, 10), delay_days: Math.floor(random() * 40), wells: [`WELL-${2000 + n}`, `WELL-${2100 + n}`] };
      case 'PO':
        return { po_no: `PO-${n}`, vendor: pick(['Al Badea Trading', 'Gulf Pipes LLC', 'Oman Cables']), lines: [{ item: 'Line pipe 6"', qty: 10 + Math.floor(random() * 90), amount: Math.round(random() * 9000) }, { item: 'Flange set', qty: 2 + Math.floor(random() * 10), amount: Math.round(random() * 1200) }] };
      case 'PEG':
        return { peg_no: `PEG-${n}`, engineer: pick(['M. Al Rawahi', 'K. Singh']), completed: random() < 0.6 };
      case 'SCR':
        return { scr_no: `SCR-${n}`, scr_date: iso(now - Math.floor(random() * 15) * 86400000).slice(0, 10), delay_days: Math.floor(random() * 25) };
      default:
        return { moc_no: `MOC-${n}`, submitted: random() < 0.8, approvers: [{ name: 'Operations Manager', approved: random() < 0.7 }] };
    }
  };
  for (let i = 0; i < 60; i++) {
    const type = ['FLAF', 'PO', 'PEG', 'SCR', 'MOC'][i % 5];
    const raisedAt = now - Math.floor(random() * 10 * 86400000);
    insertOrder.run(`${type}-${3000 + i}`, type, pick(plants)[0], iso(raisedAt), pick(['Open', 'In review', 'Closed']), JSON.stringify(payloadFor(type, 3000 + i)));
  }
  db.exec('COMMIT');
  db.close();

  const meta = getMetaDb();
  if (!meta.prepare('SELECT 1 FROM connections WHERE file_name = ?').get(DB_FILE)) {
    meta.prepare('INSERT INTO connections (name, file_name, created_at) VALUES (?, ?, ?)').run('AppMasterDB (SQLite stand-in)', DB_FILE, new Date().toISOString());
  }
  return { dbPath };
}

module.exports = { seedAppMaster };

if (require.main === module) {
  const { dbPath } = seedAppMaster();
  console.log(`Seeded AppMasterDB stand-in at ${dbPath} (plants, task_daily with JSON columns, work_orders).`);
}

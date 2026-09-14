const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');
let dbInstance;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS crews (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT
  );
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    crew_id INTEGER REFERENCES crews(id),
    type TEXT
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    crew_id INTEGER REFERENCES crews(id),
    equipment_id INTEGER REFERENCES equipment(id),
    task_date TEXT,
    status TEXT,
    planned_quantity REAL,
    actual_quantity REAL,
    planned_hours REAL,
    actual_hours REAL
  );
  CREATE TABLE IF NOT EXISTS measures (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    received_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    credentials_enc TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dashboards (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dashboard_charts (
    id INTEGER PRIMARY KEY,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id),
    title TEXT NOT NULL,
    chart_type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    position INTEGER NOT NULL
  );
`;

function seed(db) {
  const crews = [
    { name: 'Crew A', region: 'North', ratio: 0.92 },
    { name: 'Crew B', region: 'South', ratio: 0.78 },
    { name: 'Crew C', region: 'East', ratio: 0.85 },
    { name: 'Crew D', region: 'West', ratio: 0.65 },
  ];
  const insertCrew = db.prepare('INSERT INTO crews (name, region) VALUES (?, ?)');
  const crewIds = crews.map((c) => insertCrew.run(c.name, c.region).lastInsertRowid);

  const equipTypes = ['Excavator', 'Loader', 'Crane', 'Drill Rig'];
  const insertEquip = db.prepare('INSERT INTO equipment (name, crew_id, type) VALUES (?, ?, ?)');
  const equipByCrew = crewIds.map((crewId, idx) => {
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const type = equipTypes[(idx + i) % equipTypes.length];
      const id = insertEquip.run(`${type} ${idx + 1}${i + 1}`, crewId, type).lastInsertRowid;
      ids.push(id);
    }
    return ids;
  });

  const insertTask = db.prepare(`INSERT INTO tasks
    (crew_id, equipment_id, task_date, status, planned_quantity, actual_quantity, planned_hours, actual_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  // Chosen independently of crew/task index (not by modulus) — a period-4 modulus here
  // would alias with crews.length (4) and permanently starve one crew of a status.
  const startDate = new Date('2026-01-05T00:00:00Z');

  for (let i = 0; i < 200; i++) {
    const crewIdx = i % crews.length;
    const crew = crews[crewIdx];
    const crewId = crewIds[crewIdx];
    const equipIds = equipByCrew[crewIdx];
    const equipmentId = equipIds[i % equipIds.length];

    const plannedQ = 80 + Math.round(Math.random() * 40);
    const noise = (Math.random() - 0.5) * 0.14;
    const ratio = Math.min(1.05, Math.max(0.35, crew.ratio + noise));
    const actualQ = Math.round(plannedQ * ratio);

    const plannedH = 8 + Math.round(Math.random() * 4);
    const hRatio = Math.min(1.1, Math.max(0.4, ratio + (Math.random() - 0.5) * 0.08));
    const actualH = Math.round(plannedH * hRatio);

    const status = Math.random() < 0.75 ? 'Active' : 'Completed';
    const date = new Date(startDate.getTime() + i * 43200000); // every 12h, spreads across ~100 days
    const dateStr = date.toISOString().slice(0, 10);

    insertTask.run(crewId, equipmentId, dateStr, status, plannedQ, actualQ, plannedH, actualH);
  }
}

// Realistic nested payloads matching the tracker's original JSON-parsing
// example (task_daily.daily_data, FLAF/PO/PEG/SCR/MOC-style JSON) — used by
// the JSON Explorer feature to demonstrate real client-side flattening
// against real (if synthetic) nested data, not a hardcoded fixture.
function seedRawEvents(db) {
  const insert = db.prepare('INSERT INTO raw_events (source, received_at, payload_json) VALUES (?, ?, ?)');

  const flaf = {
    task_code: 'FLAF-2026-0142',
    crew: 'Crew A',
    daily_data: {
      date: '2026-02-11',
      shift: 'Day',
      completed: true,
      employee_ids: ['EMP-1042', 'EMP-1077', 'EMP-1099'],
      equipment_ids: ['EQ-Excavator-11', 'EQ-Loader-12'],
      metrics: { actual_hours: 9.5, actual_quantity: 74, planned_hours: 8, planned_quantity: 80 },
    },
    approvals: [
      { role: 'Supervisor', name: 'J. Alvarez', approved: true },
      { role: 'QA', name: 'R. Kim', approved: false },
    ],
  };

  const moc = {
    task_code: 'MOC-2026-0088',
    crew: 'Crew C',
    daily_data: {
      date: '2026-02-12',
      shift: 'Night',
      completed: false,
      employee_ids: ['EMP-2003'],
      equipment_ids: ['EQ-DrillRig-31'],
      metrics: { actual_hours: 6, actual_quantity: 41, planned_hours: 10, planned_quantity: 90 },
    },
    approvals: [{ role: 'Supervisor', name: 'T. Nakamura', approved: true }],
  };

  insert.run('FLAF', new Date().toISOString(), JSON.stringify(flaf));
  insert.run('MOC', new Date().toISOString(), JSON.stringify(moc));
}

function seedConnectionsAndDashboards(db) {
  const connCount = db.prepare('SELECT COUNT(*) AS c FROM connections').get().c;
  if (connCount === 0) {
    db.prepare('INSERT INTO connections (name, file_name, created_at) VALUES (?, ?, ?)')
      .run('Operations (Al Tasnim)', 'data.db', new Date().toISOString());
  }
  const dashCount = db.prepare('SELECT COUNT(*) AS c FROM dashboards').get().c;
  if (dashCount === 0) {
    const dashId = db.prepare('INSERT INTO dashboards (name, created_at) VALUES (?, ?)')
      .run('Operations Overview', new Date().toISOString()).lastInsertRowid;

    const insertChart = db.prepare(
      'INSERT INTO dashboard_charts (dashboard_id, title, chart_type, config_json, position) VALUES (?, ?, ?, ?, ?)',
    );
    insertChart.run(
      dashId,
      'Productivity % by Crew',
      'bar',
      JSON.stringify({
        connectionId: 1,
        table: 'tasks',
        groupBy: 'crew_id',
        filters: [{ field: 'status', op: '=', value: 'Active' }],
        metric: { type: 'ratio', agg: 'SUM', numerator: 'actual_quantity', denominator: 'planned_quantity' },
      }),
      0,
    );
    insertChart.run(
      dashId,
      'Task Status',
      'bar',
      JSON.stringify({
        connectionId: 1,
        table: 'tasks',
        groupBy: 'status',
        filters: [],
        metric: { type: 'agg', agg: 'COUNT', field: 'id' },
      }),
      1,
    );
  }
}

function getDb() {
  if (dbInstance) return dbInstance;
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA_SQL);
  const crewCount = db.prepare('SELECT COUNT(*) AS c FROM crews').get().c;
  if (crewCount === 0) seed(db);
  const rawCount = db.prepare('SELECT COUNT(*) AS c FROM raw_events').get().c;
  if (rawCount === 0) seedRawEvents(db);
  seedConnectionsAndDashboards(db);
  dbInstance = db;
  return db;
}

module.exports = { getDb, DB_PATH };

const { DatabaseSync } = require('node:sqlite');

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    region TEXT,
    employees INTEGER,
    plan_tier TEXT
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    list_price REAL
  );
  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    product_id INTEGER REFERENCES products(id),
    amount REAL,
    stage TEXT,
    owner TEXT,
    created_date TEXT,
    close_date TEXT
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    amount REAL,
    status TEXT,
    issued_date TEXT,
    paid_date TEXT
  );
`;

// Same region set as the operations DB's crews table (North/South/East/West)
// — a shared dimension, not a foreign key, but a genuine, realistic basis
// for a cross-connection join demo: "productivity by region" next to
// "revenue by region" is an ordinary analytical question even though the
// two datasets otherwise have nothing to do with each other.
const REGIONS = ['North', 'South', 'East', 'West'];
const INDUSTRIES = ['Fintech', 'Healthcare', 'Retail', 'Manufacturing', 'Logistics', 'Public Sector'];
const TIERS = ['Starter', 'Growth', 'Enterprise'];
const OWNERS = ['A. Chen', 'M. Osei', 'S. Patel', 'L. Fischer'];
const STAGES = ['Prospecting', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randDate(daysBack) {
  const d = new Date(Date.now() - Math.floor(Math.random() * daysBack) * 86400000);
  return d.toISOString().slice(0, 10);
}

function seed(db) {
  const products = [
    { name: 'Core Platform', category: 'Platform', list_price: 12000 },
    { name: 'Analytics Add-on', category: 'Add-on', list_price: 4000 },
    { name: 'Premium Support', category: 'Support', list_price: 6000 },
    { name: 'API Access Pack', category: 'Add-on', list_price: 2500 },
    { name: 'Enterprise SSO', category: 'Add-on', list_price: 3000 },
  ];
  const insertProduct = db.prepare('INSERT INTO products (name, category, list_price) VALUES (?, ?, ?)');
  const productIds = products.map((p) => insertProduct.run(p.name, p.category, p.list_price).lastInsertRowid);

  const insertCustomer = db.prepare('INSERT INTO customers (name, industry, region, employees, plan_tier) VALUES (?, ?, ?, ?, ?)');
  const customerNamePrefixes = ['North Star', 'Bluewave', 'Silverline', 'Ironclad', 'Nimbus', 'Redstone', 'Clearpath', 'Vantage', 'Anchor', 'Highfield'];
  const customerIds = [];
  for (let i = 0; i < 30; i++) {
    const name = `${customerNamePrefixes[i % customerNamePrefixes.length]} ${['Inc.', 'Co.', 'Group', 'Systems', 'Partners'][i % 5]}`;
    const id = insertCustomer.run(
      name,
      randPick(INDUSTRIES),
      REGIONS[i % REGIONS.length], // even spread across regions, matches operations DB's 4 crews
      50 + Math.floor(Math.random() * 4000),
      randPick(TIERS),
    ).lastInsertRowid;
    customerIds.push(id);
  }

  const insertDeal = db.prepare(`INSERT INTO deals
    (customer_id, product_id, amount, stage, owner, created_date, close_date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 0; i < 150; i++) {
    const customerId = randPick(customerIds);
    const productId = randPick(productIds);
    const basePrice = products[productIds.indexOf(productId)].list_price;
    const amount = Math.round(basePrice * (0.8 + Math.random() * 0.6));
    const stage = randPick(STAGES);
    const created = randDate(240);
    const close = stage.startsWith('Closed') ? randDate(120) : null;
    insertDeal.run(customerId, productId, amount, stage, randPick(OWNERS), created, close);
  }

  const insertInvoice = db.prepare(`INSERT INTO invoices
    (customer_id, amount, status, issued_date, paid_date) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < 150; i++) {
    const customerId = randPick(customerIds);
    const amount = Math.round(1500 + Math.random() * 15000);
    const paid = Math.random() < 0.8;
    const issued = randDate(200);
    insertInvoice.run(customerId, amount, paid ? 'Paid' : 'Outstanding', issued, paid ? randDate(180) : null);
  }
}

function createSalesDb(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec(SCHEMA_SQL);
  const count = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  if (count === 0) seed(db);
  db.close();
}

module.exports = { createSalesDb };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node seed-sales-db.js <output-path>');
    process.exit(1);
  }
  createSalesDb(target);
  console.log(`Seeded sales DB at ${target}`);
}

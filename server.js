const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Paths ──
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'dari.db');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const SEED_FILE = path.join(__dirname, 'products.json');

// ── Ensure dirs ──
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Database (sql.js — pure WASM, zero native compilation) ──
let SQL, db;

function saveDB() {
  try {
    const data = db.export();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  } catch (err) {
    console.error('DB save error:', err.message);
  }
}

// ── Query helpers ──
function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function run(sql, params) {
  if (params && params.length) db.run(sql, params);
  else db.run(sql);
  saveDB();
}

function rowToProduct(row) {
  return {
    ...row,
    colors: JSON.parse(row.colors || '[]'),
    colorNames: JSON.parse(row.colorNames || '[]'),
    images: JSON.parse(row.images || '[]'),
    featured: !!row.featured
  };
}

// ── Admin config ──
const ADMIN_ROUTE = '/dari-panel-7x9k2';
const ADMIN_PASSWORD = 'hamza2025!';

function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-password'] || req.query.auth;
  if (auth === ADMIN_PASSWORD) return next();
  return res.status(403).json({ error: 'Non autorisé' });
}

// ── Middleware ──
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Multer ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `p-${Date.now()}-${Math.random().toString(36).slice(2,7)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, files: 10 });

// ── Serve admin page ──
app.get(ADMIN_ROUTE, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ══════════════════════════
//  PUBLIC API
// ══════════════════════════

app.get('/api/products', (req, res) => {
  const rows = queryAll('SELECT * FROM products ORDER BY rowid DESC');
  res.json(rows.map(rowToProduct));
});

app.get('/api/products/:id', (req, res) => {
  const row = queryOne('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Produit non trouvé' });
  res.json(rowToProduct(row));
});

app.post('/api/orders', (req, res) => {
  const { product, productId, customer, email, phone, wilaya, paymentMethod, color, colorName, qty, price, notes } = req.body;
  if (!product || !customer || !phone) {
    return res.status(400).json({ error: 'Informations manquantes' });
  }
  const order = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    product, productId: productId || '', customer, email: email || '',
    phone, wilaya: wilaya || '', paymentMethod: paymentMethod || 'eccp',
    color: color || '', colorName: colorName || '',
    qty: qty || 1, price: price || 0, notes: notes || '',
    date: new Date().toISOString(), status: 'nouvelle'
  };
  run(`INSERT INTO orders (id, product, productId, customer, email, phone, wilaya, paymentMethod, color, colorName, qty, price, notes, date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [order.id, order.product, order.productId, order.customer, order.email,
     order.phone, order.wilaya, order.paymentMethod, order.color, order.colorName,
     order.qty, order.price, order.notes, order.date, order.status]);
  res.json({ success: true, order });
});

// ══════════════════════════
//  ADMIN API
// ══════════════════════════

app.get('/api/admin/products', requireAdmin, (req, res) => {
  const rows = queryAll('SELECT * FROM products ORDER BY rowid DESC');
  res.json(rows.map(rowToProduct));
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const { name, category, price, description, material, dimensions, colors, colorNames, image, images, featured } = req.body;
  if (!name || !category || !price) return res.status(400).json({ error: 'Nom, catégorie et prix requis' });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  run(`INSERT INTO products (id, name, category, price, description, material, dimensions, colors, colorNames, image, images, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, category, Number(price), description || '', material || '', dimensions || '',
     JSON.stringify(colors || []), JSON.stringify(colorNames || []),
     image || '', JSON.stringify(images || []), featured ? 1 : 0]);
  res.json({ success: true, product: { id, name, category, price: Number(price), description, material, dimensions, colors, colorNames, image, images, featured } });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const row = queryOne('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Produit non trouvé' });
  const b = req.body;
  const updated = {
    id: row.id,
    name: b.name !== undefined ? b.name : row.name,
    category: b.category !== undefined ? b.category : row.category,
    price: b.price !== undefined ? Number(b.price) : row.price,
    description: b.description !== undefined ? b.description : row.description,
    material: b.material !== undefined ? b.material : row.material,
    dimensions: b.dimensions !== undefined ? b.dimensions : row.dimensions,
    colors: b.colors !== undefined ? JSON.stringify(b.colors) : row.colors,
    colorNames: b.colorNames !== undefined ? JSON.stringify(b.colorNames) : row.colorNames,
    image: b.image !== undefined ? b.image : row.image,
    images: b.images !== undefined ? JSON.stringify(b.images) : row.images,
    featured: b.featured !== undefined ? (b.featured ? 1 : 0) : row.featured
  };
  run(`UPDATE products SET name=?, category=?, price=?, description=?, material=?, dimensions=?, colors=?, colorNames=?, image=?, images=?, featured=? WHERE id=?`,
    [updated.name, updated.category, updated.price, updated.description,
     updated.material, updated.dimensions, updated.colors, updated.colorNames,
     updated.image, updated.images, updated.featured, updated.id]);
  res.json({ success: true, product: rowToProduct(updated) });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const rows = queryAll('SELECT * FROM orders ORDER BY rowid DESC');
  res.json(rows);
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  run('DELETE FROM orders WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── Image upload ──
app.post('/api/admin/upload', requireAdmin, upload.array('images', 10), (req, res) => {
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ success: true, urls });
});

// ── Health ──
app.get('/api/health', (req, res) => {
  const pRow = queryOne('SELECT COUNT(*) as c FROM products');
  const oRow = queryOne('SELECT COUNT(*) as c FROM orders');
  const pCount = pRow ? pRow.c : 0;
  const oCount = oRow ? oRow.c : 0;
  const dbSize = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;
  res.json({
    status: 'ok', products: pCount, orders: oCount,
    dbSizeKB: Math.round(dbSize / 1024),
    uptime: process.uptime(), timestamp: new Date().toISOString()
  });
});

// ── Catch-all → storefront ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════════════════════
//  STARTUP — async init
// ══════════════════════════

async function start() {
  // Load sql.js WASM
  SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
    console.log('✦ Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('✦ Created new database');
  }

  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT DEFAULT '',
    material TEXT DEFAULT '',
    dimensions TEXT DEFAULT '',
    colors TEXT DEFAULT '[]',
    colorNames TEXT DEFAULT '[]',
    image TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    featured INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    product TEXT NOT NULL,
    productId TEXT DEFAULT '',
    customer TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT NOT NULL,
    wilaya TEXT DEFAULT '',
    paymentMethod TEXT DEFAULT 'eccp',
    color TEXT DEFAULT '',
    colorName TEXT DEFAULT '',
    qty INTEGER DEFAULT 1,
    price INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    date TEXT NOT NULL,
    status TEXT DEFAULT 'nouvelle'
  )`);

  saveDB();

  // Seed if empty
  const countRow = queryOne('SELECT COUNT(*) as c FROM products');
  const count = countRow ? countRow.c : 0;
  if (count === 0 && fs.existsSync(SEED_FILE)) {
    try {
      const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      for (const p of seed) {
        const id = p.id || Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        db.run(`INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
          id, p.name, p.category, Number(p.price) || 0,
          p.description || '', p.material || '', p.dimensions || '',
          JSON.stringify(p.colors || []), JSON.stringify(p.colorNames || []),
          p.image || '', JSON.stringify(p.images || []),
          p.featured ? 1 : 0
        ]);
      }
      saveDB();
      console.log(`✦ Seeded ${seed.length} products`);
    } catch (err) {
      console.error('Seed error:', err.message);
    }
  }

  // Start server
  app.listen(PORT, () => {
    console.log(`✦ DARI running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

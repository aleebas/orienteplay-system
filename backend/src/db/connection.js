const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'animalitos.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

// Migraciones idempotentes para bases ya creadas antes de este campo.
// CREATE TABLE IF NOT EXISTS no agrega columnas a tablas existentes.
const migraciones = [
  `ALTER TABLE jugadas ADD COLUMN metodo_pago TEXT NOT NULL DEFAULT 'efectivo'`,
  `ALTER TABLE usuarios ADD COLUMN comision_porcentaje REAL NOT NULL DEFAULT 14`,
  `ALTER TABLE cajas ADD COLUMN fondo_banco REAL NOT NULL DEFAULT 0`,
];
for (const sql of migraciones) {
  try {
    db.exec(sql);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

module.exports = db;

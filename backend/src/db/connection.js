const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Usamos el modulo "node:sqlite" integrado en Node.js (sin instalar nada,
// sin compilar codigo nativo, sin necesidad de Visual Studio en Windows).
// Disponible de fabrica en Node.js 22.5+ / 24.x.

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'animalitos.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const rawDb = new DatabaseSync(DB_PATH);
rawDb.exec('PRAGMA journal_mode = WAL;');
rawDb.exec('PRAGMA foreign_keys = ON;');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
rawDb.exec(schema);

// ------------------------------------------------------------
// Capa de compatibilidad: node:sqlite tiene una API parecida a
// better-sqlite3 (prepare -> run/get/all) pero no identica.
// Esta envoltura deja el resto del codigo (rutas) sin cambios,
// usando siempre db.prepare(sql).run/get/all(...params).
// ------------------------------------------------------------
function wrapStatement(stmt) {
  return {
    run: (...params) => {
      const info = stmt.run(...params);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },
    get: (...params) => stmt.get(...params),
    all: (...params) => stmt.all(...params),
  };
}

const db = {
  prepare: (sql) => wrapStatement(rawDb.prepare(sql)),
  exec: (sql) => rawDb.exec(sql),
  transaction: (fn) => {
    return (...args) => {
      rawDb.exec('BEGIN');
      try {
        const result = fn(...args);
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    };
  },
};

module.exports = db;

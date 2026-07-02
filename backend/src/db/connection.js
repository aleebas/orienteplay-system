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

// SQLite no permite modificar un CHECK existente con ALTER TABLE.
// 'credito' como metodo_pago requiere reconstruir la tabla jugadas
// (patron oficial de 12 pasos de SQLite para ALTER complejos).
// Ver test manual contra node:sqlite antes de aplicar esto: preserva
// filas, IDs y las FK de jugada_animalitos/tickets intactas.
const jugadasDDL = db.prepare(
  `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jugadas'`
).get();

if (jugadasDDL && !jugadasDDL.sql.includes('credito')) {
  db.pragma('foreign_keys = OFF');
  const migrarJugadas = db.transaction(() => {
    db.exec(`
      CREATE TABLE jugadas_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER REFERENCES ventas(id),
        agencia_id INTEGER NOT NULL REFERENCES agencias(id),
        caja_id INTEGER NOT NULL REFERENCES cajas(id),
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        sorteo_id INTEGER NOT NULL REFERENCES sorteos(id),
        modo_juego_id INTEGER NOT NULL REFERENCES modos_juego(id),
        fecha_sorteo TEXT NOT NULL,
        cliente_nombre TEXT,
        cliente_telefono TEXT,
        monto REAL NOT NULL,
        metodo_pago TEXT NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo', 'pago_movil', 'biopago', 'credito')),
        cobrado INTEGER NOT NULL DEFAULT 1,
        creada_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO jugadas_new (id, venta_id, agencia_id, caja_id, usuario_id, sorteo_id, modo_juego_id, fecha_sorteo, cliente_nombre, cliente_telefono, monto, metodo_pago, creada_en)
      SELECT id, venta_id, agencia_id, caja_id, usuario_id, sorteo_id, modo_juego_id, fecha_sorteo, cliente_nombre, cliente_telefono, monto, metodo_pago, creada_en FROM jugadas;
    `);
    db.exec('DROP TABLE jugadas');
    db.exec('ALTER TABLE jugadas_new RENAME TO jugadas');
  });
  migrarJugadas();
  db.pragma('foreign_keys = ON');
}

// Repara candidatos huerfanos: sorteos que ya tienen un resultado oficial
// pero cuyo resultados_candidatos quedo en pendiente_confirmacion/agotado
// porque la carga manual (antes de este fix) no lo resolvia. Sin esto,
// el panel de "resultados automaticos por revisar" los mostraria para
// siempre. Idempotente -- corre en cada arranque, no hace nada si ya
// estan resueltos.
db.exec(`
  UPDATE resultados_candidatos
  SET estado = 'confirmado', actualizado_en = datetime('now')
  WHERE estado IN ('pendiente_confirmacion', 'agotado')
    AND EXISTS (
      SELECT 1 FROM resultados r
      WHERE r.sorteo_id = resultados_candidatos.sorteo_id
        AND r.fecha = resultados_candidatos.fecha
    )
`);

module.exports = db;

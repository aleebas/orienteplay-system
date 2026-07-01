const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbRaw = new DatabaseSync(path.join(__dirname, '../data/animalitos.db'));

// Envoltura compatible con better-sqlite3 API
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
  prepare: (sql) => wrapStatement(dbRaw.prepare(sql)),
  close: () => dbRaw.close(),
};

// Mapa de loterias con sus slugs y extensiones
const LOTERIAS = [
  { id: 1, nombre: 'Lotto Activo', slug: 'lotto_activo', ext: 'webp' },
  { id: 2, nombre: 'La Granjita', slug: 'la_granjita', ext: 'webp' },
  { id: 3, nombre: 'Ruleta Activa', slug: 'ruleta_activa', ext: 'webp' },
  { id: 4, nombre: 'Selva Plus', slug: 'selva_plus', ext: 'webp' },
  { id: 5, nombre: 'Guacharo Activo', slug: 'guacharo_activo', ext: 'webp' },
];

console.log('\n🔄 Actualizando URLs de animalitos en TODAS las loterias...\n');

LOTERIAS.forEach(lot => {
  const resultado = db.prepare(
    `UPDATE animalitos 
     SET imagen_url = '/public/animalitos/${lot.slug}/' || numero || '.${lot.ext}' 
     WHERE loteria_id = ?`
  ).run(lot.id);

  if (resultado.changes > 0) {
    const sample = db.prepare('SELECT numero, imagen_url FROM animalitos WHERE loteria_id = ? LIMIT 1').get(lot.id);
    console.log(`✅ ${lot.nombre.padEnd(20)} - ${resultado.changes} registros actualizados`);
    if (sample) {
      console.log(`   Ejemplo: ${sample.numero} -> ${sample.imagen_url}\n`);
    }
  } else {
    console.log(`⚠️  ${lot.nombre.padEnd(20)} - 0 registros actualizados\n`);
  }
});

console.log('🎯 Proceso completado\n');
db.close();

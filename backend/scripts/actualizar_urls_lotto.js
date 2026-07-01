const path = require('path');
const db = require('../src/db/connection');

console.log('🔄 Actualizando URLs de animalitos - Lotto Activo...\n');

try {
  // Obtener el ID de Lotto Activo
  const loteria = db.prepare(`SELECT id FROM loterias WHERE nombre = 'Lotto Activo'`).get();
  
  if (!loteria) {
    console.error('❌ No se encontró la lotería "Lotto Activo"');
    process.exit(1);
  }

  console.log(`📍 Lotería ID: ${loteria.id}`);

  // Ver URLs actuales
  const antes = db.prepare(`
    SELECT id, nombre, numero, imagen_url 
    FROM animalitos 
    WHERE loteria_id = ?
    ORDER BY numero
  `).all(loteria.id);

  console.log(`\n📋 Antes (muestra primeros 5):`);
  antes.slice(0, 5).forEach(a => {
    console.log(`  ${a.numero.padStart(2, '0')}: ${a.nombre.substring(0, 15).padEnd(15)} → ${a.imagen_url?.substring(0, 50) || 'NULL'}`);
  });

  // Actualizar URLs
  const resultado = db.prepare(`
    UPDATE animalitos
    SET imagen_url = '/public/animalitos/lotto_activo/' || numero || '.webp'
    WHERE loteria_id = ?
  `).run(loteria.id);

  console.log(`\n✅ ${resultado.changes} registros actualizados\n`);

  // Ver URLs después
  const despues = db.prepare(`
    SELECT id, nombre, numero, imagen_url 
    FROM animalitos 
    WHERE loteria_id = ?
    ORDER BY numero
  `).all(loteria.id);

  console.log(`📋 Después (muestra primeros 5):`);
  despues.slice(0, 5).forEach(a => {
    console.log(`  ${a.numero.padStart(2, '0')}: ${a.nombre.substring(0, 15).padEnd(15)} → ${a.imagen_url?.substring(0, 50) || 'NULL'}`);
  });

  console.log(`\n✨ URLs actualizadas correctamente para Lotto Activo`);
  console.log(`📂 Archivos esperados en: backend/public/animalitos/lotto_activo/{numero}.webp`);

  process.exit(0);
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}

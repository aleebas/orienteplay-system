// Descarga todas las imágenes de animalitos desde tuazar.com y las guarda
// localmente en backend/public/animalitos/{slug}/{numero}.png
// Uso: node src/utils/descargarImagenes.js
const fs = require('fs');
const path = require('path');

const LOTERIAS = [
  { nombre: 'Lotto Activo',    slug: 'lotto_activo',    numeros: numeros38() },
  { nombre: 'La Granjita',     slug: 'la_granjita',     numeros: numeros38() },
  { nombre: 'Ruleta Activa',   slug: 'ruleta_activa',   numeros: numeros38() },
  { nombre: 'Selva Plus',      slug: 'selva_plus',      numeros: numeros38() },
  { nombre: 'Guacharo Activo', slug: 'guacharo_activo', numeros: numeros77() },
];

function numeros38() {
  const arr = ['00', '0'];
  for (let i = 1; i <= 36; i++) arr.push(String(i));
  return arr; // 38 elementos
}

function numeros77() {
  const arr = ['00', '0'];
  for (let i = 1; i <= 75; i++) arr.push(String(i));
  return arr; // 77 elementos
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function descargar() {
  const PUBLIC_DIR = path.join(__dirname, '../../public/animalitos');
  let totalOk = 0, totalFail = 0;
  const fallidosPorLoteria = {};

  console.log('\n=== DESCARGA DE IMÁGENES ANIMALITOS ===');
  console.log(`Destino: ${PUBLIC_DIR}`);
  console.log(`Total a descargar: ${LOTERIAS.reduce((s, l) => s + l.numeros.length, 0)} imágenes\n`);

  for (const lot of LOTERIAS) {
    const dir = path.join(PUBLIC_DIR, lot.slug);
    fs.mkdirSync(dir, { recursive: true });

    let ok = 0, fail = 0;
    fallidosPorLoteria[lot.nombre] = [];
    process.stdout.write(`[${lot.nombre}] (${lot.numeros.length} imgs) `);

    for (const num of lot.numeros) {
      const url = `https://www.tuazar.com/in/animalitos/${lot.slug}/${num}.png`;
      const destino = path.join(dir, `${num}.png`);

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.tuazar.com/',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100) throw new Error('respuesta vacía');
        fs.writeFileSync(destino, buf);
        process.stdout.write('.');
        ok++;
        totalOk++;
      } catch (err) {
        process.stdout.write('✗');
        fail++;
        totalFail++;
        fallidosPorLoteria[lot.nombre].push(`${num} (${err.message})`);
      }

      await delay(500);
    }

    console.log(` → ${ok} OK, ${fail} fallidas`);
  }

  // Aplicar fallbacks
  console.log('\n=== APLICANDO FALLBACKS ===');
  
  // Fallback: Ruleta Activa y Selva Plus usan imágenes de Lotto Activo
  const lottoDir = path.join(PUBLIC_DIR, 'lotto_activo');
  for (const slug of ['ruleta_activa', 'selva_plus']) {
    const destDir = path.join(PUBLIC_DIR, slug);
    if (!fs.existsSync(destDir) || fs.readdirSync(destDir).length === 0) {
      console.log(`Copiando imágenes de Lotto Activo → ${slug}...`);
      for (const num of numeros38()) {
        const src = path.join(lottoDir, `${num}.png`);
        const dest = path.join(destDir, `${num}.png`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
      console.log(`✓ ${slug} completado con fallback`);
    }
  }

  // Fallback: Guácharo Activo genera placeholder info para que el frontend use emojis
  const guacharoDir = path.join(PUBLIC_DIR, 'guacharo_activo');
  if (fs.readdirSync(guacharoDir).length === 0) {
    console.log('Guácharo Activo: se usarán emojis (sin imágenes)');
    fs.writeFileSync(path.join(guacharoDir, '.emoji-only'), 'Las imágenes de Guácharo usan emojis como fallback\n');
    console.log('✓ Guácharo Activo configurado para usar emojis');
  }

  // Actualizar URLs en la base de datos
  console.log('\nActualizando URLs en la base de datos...');
  try {
    const db = require('../db/connection');
    const result = db.prepare(`
      UPDATE animalitos
      SET imagen_url = REPLACE(imagen_url,
        'https://www.tuazar.com/in/animalitos/',
        '/public/animalitos/')
      WHERE imagen_url LIKE 'https://www.tuazar.com/%'
    `).run();
    console.log(`✓ ${result.changes} URLs actualizadas en la DB (ahora usan rutas locales)`);
  } catch (err) {
    console.log(`⚠ No se pudo actualizar la DB: ${err.message}`);
    console.log('  Puedes actualizar manualmente con:');
    console.log(`  UPDATE animalitos SET imagen_url = REPLACE(imagen_url, 'https://www.tuazar.com/in/animalitos/', '/public/animalitos/')`);
  }

  // Resumen final
  console.log('\n=== RESUMEN FINAL ===');
  console.log(`Descargadas: ${totalOk} | Fallidas: ${totalFail}`);
  console.log(`Ruleta Activa y Selva Plus → Usando imágenes de Lotto Activo (fallback)`);
  console.log(`Guácharo Activo → Usando emojis del EMOJI_MAP (fallback)`);
  
  for (const [lot, fallidos] of Object.entries(fallidosPorLoteria)) {
    if (fallidos.length > 0) {
      console.log(`\n${lot} — fallidas: ${fallidos.slice(0, 5).join(', ')}${fallidos.length > 5 ? ` ... (+${fallidos.length - 5} más)` : ''}`);
    }
  }
  if (totalOk > 0) {
    console.log('\n✓ Imágenes disponibles en http://localhost:3001/public/animalitos/{loteria}/{numero}.png');
    console.log('✓ Fallbacks configurados:');
    console.log('  - Ruleta Activa + Selva Plus: imágenes copiadas de Lotto Activo');
    console.log('  - Guácharo Activo: emojis del EMOJI_MAP');
    console.log('  Reinicia el servidor para que sirva los archivos estáticos.\n');
  }
}

descargar().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});

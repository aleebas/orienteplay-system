// ============================================================
// SEED - DATOS REALES CONFIRMADOS POR EL DUEÑO DEL NEGOCIO
// Fuentes: tuazar.com, elbrujodelosanimalitos.com, confirmación directa
// Última actualización: 30/06/2026
// ============================================================
const db = require('./connection');
const bcrypt = require('bcryptjs');

// ------------------------------------------------------------
// ANIMALITOS BASE (00-36) - IGUALES EN TODAS LAS LOTERIAS DE 38
// Lotto Activo, La Granjita, Ruleta Activa, Selva Plus
// Nombre estandarizado (CEBRA, no Zebra/Zebra/Sebra)
// Imágenes: tuazar.com (carpeta por lotería, mismo número.png)
// ------------------------------------------------------------
const ANIMALITOS_38 = [
  ['00', 'BALLENA'],   ['0',  'DELFIN'],    ['1',  'CARNERO'],
  ['2',  'TORO'],      ['3',  'CIEMPIES'],  ['4',  'ALACRAN'],
  ['5',  'LEON'],      ['6',  'RANA'],      ['7',  'PERICO'],
  ['8',  'RATON'],     ['9',  'AGUILA'],    ['10', 'TIGRE'],
  ['11', 'GATO'],      ['12', 'CABALLO'],   ['13', 'MONO'],
  ['14', 'PALOMA'],    ['15', 'ZORRO'],     ['16', 'OSO'],
  ['17', 'PAVO'],      ['18', 'BURRO'],     ['19', 'CHIVO'],
  ['20', 'COCHINO'],   ['21', 'GALLO'],     ['22', 'CAMELLO'],
  ['23', 'CEBRA'],     ['24', 'IGUANA'],    ['25', 'GALLINA'],
  ['26', 'VACA'],      ['27', 'PERRO'],     ['28', 'ZAMURO'],
  ['29', 'ELEFANTE'],  ['30', 'CAIMAN'],    ['31', 'LAPA'],
  ['32', 'ARDILLA'],   ['33', 'PESCADO'],   ['34', 'VENADO'],
  ['35', 'JIRAFA'],    ['36', 'CULEBRA'],
];

// Animalitos extendidos de Guácharo (37-75, adicionales a los 38 base)
// Fuente: elbrujodelosanimalitos.com / lottoresultados.com
const ANIMALITOS_GUACHARO_EXTRA = [
  ['37', 'TORTUGA'],       ['38', 'BUFALO'],        ['39', 'LECHUZA'],
  ['40', 'AVISPA'],        ['41', 'CANGURO'],        ['42', 'TUCAN'],
  ['43', 'MARIPOSA'],      ['44', 'CHIGUIRE'],       ['45', 'GARZA'],
  ['46', 'PUMA'],          ['47', 'PAVO REAL'],       ['48', 'PUERCOESPIN'],
  ['49', 'PEREZA'],        ['50', 'CANARIO'],         ['51', 'PELICANO'],
  ['52', 'PULPO'],         ['53', 'CARACOL'],         ['54', 'GRILLO'],
  ['55', 'OSO HORMIGUERO'],['56', 'TIBURON'],         ['57', 'PATO'],
  ['58', 'HORMIGA'],       ['59', 'PANTERA'],         ['60', 'CAMALEON'],
  ['61', 'PANDA'],         ['62', 'CACHICAMO'],       ['63', 'CANGREJO'],
  ['64', 'GAVILAN'],       ['65', 'ARANA'],           ['66', 'LOBO'],
  ['67', 'AVESTRUZ'],      ['68', 'JAGUAR'],          ['69', 'CONEJO'],
  ['70', 'BISONTE'],       ['71', 'GUACAMAYA'],       ['72', 'GORILA'],
  ['73', 'HIPOPOTAMO'],    ['74', 'TURPIAL'],         ['75', 'GUACHARO'],
];

// ------------------------------------------------------------
// LOTERIAS con datos confirmados
// Imágenes: https://www.tuazar.com/in/animalitos/{slug_imagen}/{numero}.png
// ------------------------------------------------------------
const LOTERIAS = [
  {
    nombre: 'Lotto Activo',
    slug: 'lottoactivo',
    slug_imagen: 'lotto_activo',     // carpeta en tuazar.com
    animalitos: ANIMALITOS_38,
    sorteos: ['08:00','09:00','10:00','11:00','12:00','13:00',
              '14:00','15:00','16:00','17:00','18:00','19:00'], // 12 sorteos 8AM-7PM
    modos: [
      { nombre: 'Animalito directo', slug: 'directo', multiplicador: 30, cantidad: 1 },
      { nombre: 'Tripleta',          slug: 'tripleta', multiplicador: 1200, cantidad: 3 },
    ],
    comision: 15,
  },
  {
    nombre: 'La Granjita',
    slug: 'lagranjita',
    slug_imagen: 'la_granjita',
    animalitos: ANIMALITOS_38,
    sorteos: ['08:00','09:00','10:00','11:00','12:00','13:00',
              '14:00','15:00','16:00','17:00','18:00','19:00'],
    modos: [
      { nombre: 'Animalito directo', slug: 'directo', multiplicador: 30, cantidad: 1 },
      { nombre: 'Tripleta',          slug: 'tripleta', multiplicador: 1200, cantidad: 3 },
    ],
    comision: 15,
  },
  {
    nombre: 'Ruleta Activa',
    slug: 'ruletaactiva',
    slug_imagen: 'ruleta_activa',
    animalitos: ANIMALITOS_38,
    // Confirmado: empieza a las 9AM (no 8AM como las otras)
    sorteos: ['09:00','10:00','11:00','12:00','13:00',
              '14:00','15:00','16:00','17:00','18:00','19:00'], // 11 sorteos 9AM-7PM
    modos: [
      { nombre: 'Animalito directo', slug: 'directo', multiplicador: 30, cantidad: 1 },
      { nombre: 'Tripleta',          slug: 'tripleta', multiplicador: 1200, cantidad: 3 },
    ],
    comision: 15,
  },
  {
    nombre: 'Selva Plus',
    slug: 'selvaplus',
    slug_imagen: 'selva_plus',
    animalitos: ANIMALITOS_38,
    sorteos: ['08:00','09:00','10:00','11:00','12:00','13:00',
              '14:00','15:00','16:00','17:00','18:00','19:00'],
    modos: [
      { nombre: 'Animalito directo', slug: 'directo', multiplicador: 30, cantidad: 1 },
      { nombre: 'Tripleta',          slug: 'tripleta', multiplicador: 1200, cantidad: 3 },
    ],
    comision: 15,
  },
  {
    nombre: 'Guacharo Activo',
    slug: 'guacharoactivo',
    slug_imagen: 'guacharo_activo',
    animalitos: [...ANIMALITOS_38, ...ANIMALITOS_GUACHARO_EXTRA], // 77 animalitos (00 al 75)
    sorteos: ['08:00','09:00','10:00','11:00','12:00','13:00',
              '14:00','15:00','16:00','17:00','18:00','19:00'],
    modos: [
      { nombre: 'Animalito directo', slug: 'directo',  multiplicador: 60,   cantidad: 1 },
      { nombre: 'Comodin Guacharo',  slug: 'comodin',  multiplicador: 120,  cantidad: 1 },
      { nombre: 'Tripleta',          slug: 'tripleta', multiplicador: 3600, cantidad: 3 },
    ],
    comision: 15,
  },
];

// ------------------------------------------------------------
// SEED PRINCIPAL
// ------------------------------------------------------------
function seed() {
  console.log('\n=== SEED SISTEMA ANIMALITOS MY SONS ===\n');

  // Agencia principal
  const agenciaExiste = db.prepare(`SELECT id FROM agencias WHERE nombre = ?`).get('MY SONS');
  let agenciaId;
  if (!agenciaExiste) {
    const r = db.prepare(`INSERT INTO agencias (nombre, direccion) VALUES (?, ?)`).run('MY SONS', 'Por definir');
    agenciaId = r.lastInsertRowid;
    console.log(`✓ Agencia creada: MY SONS (id ${agenciaId})`);
  } else {
    agenciaId = agenciaExiste.id;
    console.log(`· Agencia MY SONS ya existía (id ${agenciaId})`);
  }

  // Usuario admin
  if (!db.prepare(`SELECT id FROM usuarios WHERE usuario = ?`).get('admin')) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      `INSERT INTO usuarios (agencia_id, nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?, ?)`
    ).run(agenciaId, 'Administrador', 'admin', hash, 'admin');
    console.log(`✓ Usuario admin creado (clave: admin123 — CAMBIAR antes de operar)\n`);
  }

  // Loterías
  for (const lot of LOTERIAS) {
    db.prepare(`INSERT OR IGNORE INTO loterias (nombre, slug) VALUES (?, ?)`).run(lot.nombre, lot.slug);
    const loteriaId = db.prepare(`SELECT id FROM loterias WHERE slug = ?`).get(lot.slug).id;

    // Animalitos con imagen desde tuazar.com
    for (const [numero, nombre] of lot.animalitos) {
      const imgUrl = `https://www.tuazar.com/in/animalitos/${lot.slug_imagen}/${numero}.png`;
      db.prepare(
        `INSERT OR IGNORE INTO animalitos (loteria_id, numero, nombre, imagen_url) VALUES (?, ?, ?, ?)`
      ).run(loteriaId, numero, nombre, imgUrl);
    }

    // Sorteos (solo insertar los que no existen)
    for (const hora of lot.sorteos) {
      const existe = db.prepare(`SELECT id FROM sorteos WHERE loteria_id = ? AND hora = ?`).get(loteriaId, hora);
      if (!existe) {
        db.prepare(`INSERT INTO sorteos (loteria_id, nombre, hora, minutos_cierre_previo) VALUES (?, ?, ?, 5)`)
          .run(loteriaId, `Sorteo ${hora}`, hora);
      }
    }

    // Modos de juego
    for (const m of lot.modos) {
      db.prepare(
        `INSERT OR IGNORE INTO modos_juego (loteria_id, nombre, slug, multiplicador, cantidad_animalitos) VALUES (?, ?, ?, ?, ?)`
      ).run(loteriaId, m.nombre, m.slug, m.multiplicador, m.cantidad);
    }

    // Comisión. OJO: "INSERT OR IGNORE" NO sirve aqui -- SQLite trata cada
    // NULL como distinto de cualquier otro NULL para efectos de UNIQUE, asi
    // que UNIQUE(loteria_id, agencia_id) nunca detecta conflicto cuando
    // agencia_id es NULL (comision "default"). Como seed() corre en CADA
    // arranque del servidor (ver server.js), eso insertaba una fila nueva
    // cada vez que Railway reiniciaba el proceso -- con muchos redeploys
    // en un dia, se acumulaban muchas filas default para la misma loteria,
    // y el LEFT JOIN de reportes.js/caja.js (que hace match por "OR
    // agencia_id IS NULL") las contaba TODAS, multiplicando la comision
    // calculada. Se verifica explicitamente con SELECT en vez de confiar
    // en el UNIQUE.
    const comisionExistente = db.prepare(
      `SELECT id FROM comisiones WHERE loteria_id = ? AND agencia_id IS NULL`
    ).get(loteriaId);
    if (!comisionExistente) {
      db.prepare(`INSERT INTO comisiones (loteria_id, agencia_id, porcentaje) VALUES (?, NULL, ?)`)
        .run(loteriaId, lot.comision);
    }

    console.log(
      `✓ ${lot.nombre}: ${lot.animalitos.length} animalitos, ${lot.sorteos.length} sorteos, ` +
      `modos: ${lot.modos.map(m => m.nombre + ' x' + m.multiplicador).join(' | ')}`
    );
  }

  console.log('\n=== SEED COMPLETADO ===');
  console.log('\nNOTA IMPORTANTE: Los multiplicadores (x30, x60, x120) son los valores');
  console.log('REALES confirmados por el operador. Ajustar en tabla modos_juego si cambian.');
  console.log('\nImágenes de animalitos apuntan a tuazar.com/in/animalitos/{loteria}/{numero}.png');
  console.log('Si ese sitio cambia URLs, descargar imágenes y alojarlas localmente en public/animalitos/');
}

if (require.main === module) {
  seed();
}

module.exports = seed;

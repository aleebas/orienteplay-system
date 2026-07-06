// ============================================================
// RESULTADOS AUTOMATICOS
// ------------------------------------------------------------
// 3 minutos despues de cada sorteo, intenta obtener el resultado.
// Fuente primaria: elsevero.com/api/resultados-publicos (JSON
// publico, mismo endpoint que consume su propia pagina de
// resultados). Si no responde o no trae el sorteo buscado, cae a
// lotoven.com (scraping de HTML) como respaldo. Si lo encuentra,
// lo deja en resultados_candidatos con estado
// 'pendiente_confirmacion' -- NUNCA marca tickets como
// ganadores/perdedores por si solo, eso solo pasa cuando un admin
// confirma (ver POST /api/resultados que ya exige una accion
// explicita para eso). Si tras 4 intentos (12 minutos) no
// encuentra nada en ninguna fuente, marca 'agotado' para que quede
// claro que hace falta cargar el resultado a mano.
//
// lotoven.com/animalitos/ renderiza TODAS las loterias del dia en
// una sola pagina de HTML estatico (sin API/XHR). Cada loteria es
// un bloque <div id="{slug}"> con tarjetas por sorteo que traen el
// nombre del animalito y la hora ("<span class="info ...">23
// Cebra</span> ... <span class="info2 horario">08:00 AM</span>").
// Los slugs de seccion (lottoactivo, lagranjita, ruletaactiva,
// selvaplus, guacharoactivo) y los nombres de animalitos coinciden
// exactamente con los de la base de datos.
// ============================================================

const https = require('https');
const db = require('./../db/connection');
const { fechaVenezuelaHoy, ahoraVenezuela } = require('./fechaVenezuela');

const RETRASO_INICIAL_MIN = 3;
const INTERVALO_REINTENTO_MIN = 3;
const MAX_INTENTOS = 4;
const REVISAR_SORTEOS_NUEVOS_MS = 60 * 60 * 1000; // cada hora

const ELSEVERO_URL = 'https://www.elsevero.com/api/resultados-publicos';
const RESULTADOS_URL = 'https://lotoven.com/animalitos/';
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Captura "<numero> <Nombre></span> ... <hora AM/PM></span>" de cada
// tarjeta de resultado dentro del bloque de una loteria.
const RESULTADO_REGEX =
  /<span class="info (?:rojo|negro)">\s*\d+\s+([^<]+?)\s*<\/span>\s*<span class="info2 horario"[^>]*>\s*(\d{1,2}:\d{2}\s*[AP]M)\s*<\/span>/g;

const timers = new Map(); // `${sorteoId}|${fecha}` -> timeout handle

function normalizarHora12(hora24) {
  const [h, m] = hora24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

// "Guácharo Activo" -> "guacharoactivo" -- minuscula, sin tildes, sin
// espacios. Coincide exactamente con los slugs de la tabla loterias
// (lottoactivo, lagranjita, ruletaactiva, selvaplus, guacharoactivo).
function normalizarSlug(texto) {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Cache en memoria por fecha (TTL corto) para no golpear el endpoint una
// vez por cada sorteo que se revisa casi al mismo tiempo (varias loterias
// comparten horario, ej. 08:00 AM).
const CACHE_ELSEVERO_TTL_MS = 30 * 1000;
let cacheElSevero = { fecha: null, obtenidoEn: 0, promesa: null };

// https://www.elsevero.com/api/resultados-publicos?fecha=YYYY-MM-DD
// Endpoint JSON publico (el mismo que consume su propia pagina de
// resultados via fetch/XHR): { fecha, resultados: [{ id, fecha, hora,
// loteria, numero, nombre, emoji, imagenUrl }], stats: {...} }.
function descargarResultadosElSevero(fecha) {
  const ahora = Date.now();
  if (cacheElSevero.fecha === fecha && ahora - cacheElSevero.obtenidoEn < CACHE_ELSEVERO_TTL_MS) {
    return cacheElSevero.promesa;
  }

  const promesa = new Promise((resolve, reject) => {
    const req = https.get(
      `${ELSEVERO_URL}?fecha=${fecha}`,
      {
        headers: {
          'User-Agent': CHROME_USER_AGENT,
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(Array.isArray(json.resultados) ? json.resultados : []);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });

  cacheElSevero = { fecha, obtenidoEn: ahora, promesa };
  return promesa;
}

async function buscarResultadoElSevero(loteriaSlug, hora, fecha) {
  let resultados;
  try {
    resultados = await descargarResultadosElSevero(fecha);
  } catch {
    return null;
  }

  const horaBuscada = normalizarHora12(hora);
  const encontrado = resultados.find(
    (r) => normalizarSlug(r.loteria || '') === loteriaSlug && r.hora === horaBuscada
  );
  if (!encontrado) return null;

  return { nombre: String(encontrado.nombre).toUpperCase(), numero: String(encontrado.numero) };
}

function descargarPaginaAnimalitos() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      RESULTADOS_URL,
      {
        headers: {
          'User-Agent': CHROME_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-VE,es;q=0.9',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      }
    );
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// El HTML trae las loterias una tras otra dentro de <section id="ani-res">,
// cada una precedida por <h3 class="text-center pb-3">Resultados ...</h3>.
// Se recorta desde el <div id="{slug}"> de la loteria buscada hasta el
// siguiente <h3> (o el cierre de la seccion si es la ultima).
function extraerSeccionLoteria(html, loteriaSlug) {
  const inicio = html.indexOf(`id="${loteriaSlug}"`);
  if (inicio === -1) return null;

  const finHeader = html.indexOf('<h3 class="text-center pb-3">', inicio);
  const finSeccion = html.indexOf('</section>', inicio);
  const fin = finHeader !== -1 ? finHeader : finSeccion !== -1 ? finSeccion : html.length;

  return html.slice(inicio, fin);
}

function parsearResultados(seccionHtml) {
  const resultados = [];
  RESULTADO_REGEX.lastIndex = 0;
  let m;
  while ((m = RESULTADO_REGEX.exec(seccionHtml)) !== null) {
    resultados.push({ nombre: m[1].trim().toUpperCase(), hora: m[2].replace(/\s+/g, ' ').trim() });
  }
  return resultados;
}

// Respaldo: solo se consulta si elsevero.com no responde o no trae
// todavia el resultado buscado.
async function buscarResultadoLotoven(loteriaSlug, hora) {
  let html;
  try {
    html = await descargarPaginaAnimalitos();
  } catch {
    return null;
  }

  const seccion = extraerSeccionLoteria(html, loteriaSlug);
  if (!seccion) return null;

  const horaBuscada = normalizarHora12(hora);
  const resultados = parsearResultados(seccion);
  const encontrado = resultados.find((r) => r.hora === horaBuscada);
  if (!encontrado) return null;

  return { nombre: encontrado.nombre };
}

function guardarCandidato(sorteoId, fecha, animalitoId, estado, intentos) {
  db.prepare(`
    INSERT INTO resultados_candidatos (sorteo_id, fecha, animalito_id, estado, intentos, actualizado_en)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(sorteo_id, fecha) DO UPDATE SET
      animalito_id = excluded.animalito_id,
      estado = excluded.estado,
      intentos = excluded.intentos,
      actualizado_en = datetime('now')
  `).run(sorteoId, fecha, animalitoId, estado, intentos);
}

async function ejecutarChequeo(sorteo, fecha, intento) {
  timers.delete(`${sorteo.id}|${fecha}`);

  // Si ya se cargo manualmente o ya hay un candidato (encontrado, agotado
  // o descartado) mientras esperabamos, no seguir.
  const oficial = db.prepare(`SELECT id FROM resultados WHERE sorteo_id = ? AND fecha = ?`).get(sorteo.id, fecha);
  if (oficial) return;
  const yaHayCandidato = db.prepare(`SELECT id FROM resultados_candidatos WHERE sorteo_id = ? AND fecha = ?`).get(sorteo.id, fecha);
  if (yaHayCandidato) return;

  let encontrado = await buscarResultadoElSevero(sorteo.loteria_slug, sorteo.hora, fecha).catch(() => null);
  let fuente = 'elsevero';
  if (!encontrado) {
    encontrado = await buscarResultadoLotoven(sorteo.loteria_slug, sorteo.hora).catch(() => null);
    fuente = 'lotoven';
  }

  // Re-chequear DESPUES del fetch (que puede tardar varios segundos):
  // si mientras tanto un admin cargo el resultado manualmente, no hay
  // que escribir (ni revivir) un candidato -- ese resultado manual ya
  // resolvio cualquier candidato pendiente para este sorteo/fecha, y
  // sin este re-chequeo guardarCandidato() lo pisaria de vuelta a
  // 'pendiente_confirmacion'/'agotado' via su ON CONFLICT, dejando una
  // alerta fantasma que ningun refresco del panel volveria a limpiar
  // (el chequeo de "yaHayCandidato" al inicio de la funcion solo corre
  // en el PROXIMO intento, que nunca llega porque este intento retorna).
  if (db.prepare(`SELECT id FROM resultados WHERE sorteo_id = ? AND fecha = ?`).get(sorteo.id, fecha)) {
    return;
  }

  if (encontrado) {
    // ElSevero trae el numero del animalito -- buscar por numero es mas
    // confiable que por nombre (evita mismatches de tildes/mayusculas).
    // Lotoven (respaldo) solo trae el nombre.
    const animalito = encontrado.numero
      ? db.prepare(
          `SELECT id FROM animalitos WHERE loteria_id = (SELECT loteria_id FROM sorteos WHERE id = ?) AND numero = ?`
        ).get(sorteo.id, encontrado.numero)
      : db.prepare(
          `SELECT id FROM animalitos WHERE loteria_id = (SELECT loteria_id FROM sorteos WHERE id = ?) AND nombre = ?`
        ).get(sorteo.id, encontrado.nombre);
    if (animalito) {
      guardarCandidato(sorteo.id, fecha, animalito.id, 'pendiente_confirmacion', intento);
      console.log(`[resultadosAuto] ${sorteo.loteria_nombre} ${sorteo.hora}: candidato encontrado via ${fuente} (${encontrado.nombre}), esperando confirmacion`);
      return;
    }
  }

  if (intento >= MAX_INTENTOS) {
    guardarCandidato(sorteo.id, fecha, null, 'agotado', intento);
    console.log(`[resultadosAuto] ${sorteo.loteria_nombre} ${sorteo.hora}: agotados los ${MAX_INTENTOS} intentos, requiere carga manual`);
    return;
  }

  const key = `${sorteo.id}|${fecha}`;
  const t = setTimeout(() => ejecutarChequeo(sorteo, fecha, intento + 1), INTERVALO_REINTENTO_MIN * 60000);
  timers.set(key, t);
}

function programarSorteosDeHoy() {
  const fecha = fechaVenezuelaHoy();
  const sorteos = db.prepare(`
    SELECT s.id, s.hora, l.slug AS loteria_slug, l.nombre AS loteria_nombre
    FROM sorteos s
    JOIN loterias l ON l.id = s.loteria_id
    WHERE s.activo = 1 AND l.activa = 1
  `).all();

  for (const sorteo of sorteos) {
    const key = `${sorteo.id}|${fecha}`;
    if (timers.has(key)) continue;

    const oficial = db.prepare(`SELECT id FROM resultados WHERE sorteo_id = ? AND fecha = ?`).get(sorteo.id, fecha);
    if (oficial) continue;
    const yaHayCandidato = db.prepare(`SELECT id FROM resultados_candidatos WHERE sorteo_id = ? AND fecha = ?`).get(sorteo.id, fecha);
    if (yaHayCandidato) continue;

    const [h, m] = sorteo.hora.split(':').map(Number);
    const ahoraVE = ahoraVenezuela();
    const horaSorteo = new Date(ahoraVE);
    horaSorteo.setUTCHours(h, m, 0, 0);
    const horaChequeo = new Date(horaSorteo.getTime() + RETRASO_INICIAL_MIN * 60000);
    // Si el servidor arranco despues de la hora de chequeo (o el sorteo
    // ya paso hoy), delay=0 -> revisa de inmediato en vez de saltarselo.
    // Resta contra ahoraVE (no Date.now()): ahoraVenezuela() usa campos UTC
    // desplazados para representar la hora local, así que solo es
    // comparable/restable contra otro valor construido igual.
    const delay = Math.max(0, horaChequeo.getTime() - ahoraVE.getTime());

    const t = setTimeout(() => ejecutarChequeo(sorteo, fecha, 1), delay);
    timers.set(key, t);
  }
}

function iniciar() {
  programarSorteosDeHoy();
  // Revisa cada hora por si aparecen sorteos de un nuevo dia sin
  // necesidad de reiniciar el proceso.
  setInterval(programarSorteosDeHoy, REVISAR_SORTEOS_NUEVOS_MS);
  console.log('[resultadosAuto] scheduler iniciado');
}

module.exports = { iniciar };

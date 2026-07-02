// ============================================================
// RESULTADOS AUTOMATICOS
// ------------------------------------------------------------
// 3 minutos despues de cada sorteo, intenta obtener el resultado
// desde lotoven.com. Si lo encuentra, lo deja en
// resultados_candidatos con estado 'pendiente_confirmacion' --
// NUNCA marca tickets como ganadores/perdedores por si solo, eso
// solo pasa cuando un admin confirma (ver POST /api/resultados
// que ya exige una accion explicita para eso). Si tras 4 intentos
// (12 minutos) no encuentra nada, marca 'agotado' para que quede
// claro que hace falta cargar el resultado a mano.
//
// AVISO: lotoven.com renderiza los resultados con JavaScript del
// lado del cliente, asi que el parseo de abajo es "mejor esfuerzo"
// sobre el HTML estatico -- no fue posible verificar el marcado
// real contra el sitio en vivo. Si nunca encuentra nada, el
// sistema de todas formas cae correctamente en 'agotado' y avisa
// para carga manual, que es un flujo que si funciona siempre.
// ============================================================

const db = require('./../db/connection');

const RETRASO_INICIAL_MIN = 3;
const INTERVALO_REINTENTO_MIN = 3;
const MAX_INTENTOS = 4;
const REVISAR_SORTEOS_NUEVOS_MS = 60 * 60 * 1000; // cada hora

const timers = new Map(); // `${sorteoId}|${fecha}` -> timeout handle

function hoyStr() {
  return new Date().toISOString().slice(0, 10);
}

function normalizarHora12(hora24) {
  const [h, m] = hora24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

async function buscarResultadoLotoven(loteriaSlug, hora) {
  const url = `https://lotoven.com/animalito/${loteriaSlug}/resultados/`;
  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const horaBuscada = normalizarHora12(hora);
  const idx = html.indexOf(horaBuscada);
  if (idx === -1) return null;

  // Ventana de texto alrededor de la hora encontrada, buscando un numero
  // de 1-2 digitos (el numero de animalito ganador).
  const ventana = html.slice(idx, idx + 300).replace(/<[^>]+>/g, ' ');
  const m = ventana.match(/\b(\d{1,2})\b/);
  if (!m) return null;

  return { numero: m[1] };
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

  const encontrado = await buscarResultadoLotoven(sorteo.loteria_slug, sorteo.hora).catch(() => null);

  if (encontrado) {
    const animalito = db.prepare(
      `SELECT id FROM animalitos WHERE loteria_id = (SELECT loteria_id FROM sorteos WHERE id = ?) AND numero = ?`
    ).get(sorteo.id, encontrado.numero);
    if (animalito) {
      guardarCandidato(sorteo.id, fecha, animalito.id, 'pendiente_confirmacion', intento);
      console.log(`[resultadosAuto] ${sorteo.loteria_nombre} ${sorteo.hora}: candidato encontrado (animalito #${encontrado.numero}), esperando confirmacion`);
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
  const fecha = hoyStr();
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
    const horaSorteo = new Date();
    horaSorteo.setHours(h, m, 0, 0);
    const horaChequeo = new Date(horaSorteo.getTime() + RETRASO_INICIAL_MIN * 60000);
    // Si el servidor arranco despues de la hora de chequeo (o el sorteo
    // ya paso hoy), delay=0 -> revisa de inmediato en vez de saltarselo.
    const delay = Math.max(0, horaChequeo.getTime() - Date.now());

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

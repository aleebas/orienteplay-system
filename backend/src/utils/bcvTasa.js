// ============================================================
// TASA BCV (USD/VES)
// ------------------------------------------------------------
// Cachea en memoria la tasa oficial consultada a ve.dolarapi.com
// (API gratuita, sin API key, agrega la tasa publicada por el
// BCV). Se refresca al arrancar el servidor y automaticamente
// todos los dias de lunes a viernes a las 5:30pm hora Venezuela.
// ============================================================

const CACHE = { tasa: null, fecha_actualizacion: null, obtenido_en: null };

async function refrescarTasa() {
  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (typeof data.promedio !== 'number') return false;

    CACHE.tasa = data.promedio;
    CACHE.fecha_actualizacion = data.fechaActualizacion || new Date().toISOString();
    CACHE.obtenido_en = new Date().toISOString();
    console.log(`[bcvTasa] Tasa actualizada: ${CACHE.tasa} Bs/USD`);
    return true;
  } catch (err) {
    console.error('[bcvTasa] Error al consultar la tasa:', err.message);
    return false;
  }
}

async function obtenerTasa() {
  if (CACHE.tasa == null) await refrescarTasa();
  return { ...CACHE };
}

let ultimoDisparoFecha = null; // 'YYYY-MM-DD', evita disparar dos veces el mismo dia

function revisarHorarioProgramado() {
  const ahora = new Date(); // el proceso corre con TZ=America/Caracas (ver server.js)
  const esLaborable = ahora.getDay() >= 1 && ahora.getDay() <= 5;
  const hoy = ahora.toISOString().slice(0, 10);

  if (esLaborable && ahora.getHours() === 17 && ahora.getMinutes() === 30 && ultimoDisparoFecha !== hoy) {
    ultimoDisparoFecha = hoy;
    refrescarTasa();
  }
}

function iniciar() {
  refrescarTasa(); // valor inicial para no arrancar con la cache vacia
  setInterval(revisarHorarioProgramado, 60000);
  console.log('[bcvTasa] scheduler iniciado (refresco 5:30pm L-V hora Venezuela)');
}

module.exports = { iniciar, obtenerTasa };

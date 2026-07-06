// ============================================================
// Helpers de fecha/hora en zona horaria de Venezuela (UTC-4).
// ------------------------------------------------------------
// El proceso Node corre en UTC en produccion (Railway no fija
// TZ), asi que new Date().toISOString()/getHours()/setHours()
// dan la fecha/hora de UTC, no la de Venezuela. Estos helpers
// calculan explicitamente en base a America/Caracas para que la
// logica de negocio (fecha_sorteo, cierre de ventas, scraper de
// resultados) no dependa del timezone del proceso.
// ============================================================

const TIMEZONE = 'America/Caracas';

function partesVenezuela(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const get = (t) => partes.find((p) => p.type === t)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // Intl puede devolver "24" para medianoche con hour12:false
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

// 'YYYY-MM-DD' de hoy en Venezuela, sin importar el timezone del proceso.
function fechaVenezuelaHoy() {
  const { year, month, day } = partesVenezuela();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Date cuyos campos UTC (getUTCHours, getUTCDate, etc.) representan la
// hora local de Venezuela -- util para comparar/computar horas de sorteo
// con setHours()/getHours() reemplazados por sus equivalentes UTC.
function ahoraVenezuela() {
  const { year, month, day, hour, minute, second } = partesVenezuela();
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

// {h, m} con la hora actual en Venezuela (24h).
function horaVenezuelaActual() {
  const { hour, minute } = partesVenezuela();
  return { h: hour, m: minute };
}

module.exports = { fechaVenezuelaHoy, ahoraVenezuela, horaVenezuelaActual };

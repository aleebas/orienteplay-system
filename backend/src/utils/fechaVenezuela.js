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

// 'YYYY-MM-DD' en Venezuela de una fecha dada (por defecto, ahora mismo).
function fechaVenezuelaDe(fecha = new Date()) {
  const { year, month, day } = partesVenezuela(fecha);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' de hoy en Venezuela, sin importar el timezone del proceso.
function fechaVenezuelaHoy() {
  return fechaVenezuelaDe(new Date());
}

// Convierte un timestamp de sqlite ('YYYY-MM-DD HH:MM:SS', siempre UTC y
// sin sufijo de zona) a su fecha calendario en Venezuela. Util para saber
// de que dia (VE) es una caja/venta/etc a partir de su columna *_en.
function fechaVenezuelaDeTimestampSqlite(timestampUTC) {
  return fechaVenezuelaDe(new Date(timestampUTC.replace(' ', 'T') + 'Z'));
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

// Date "desplazado" (mismo convenio que ahoraVenezuela: los campos UTC
// representan la hora local de Venezuela) para una fecha+hora ARBITRARIA,
// no necesariamente "hoy". Sirve para comparar directamente contra
// ahoraVenezuela() y saber si un sorteo puntual (fecha='YYYY-MM-DD',
// hora='HH:MM') ya deberia haber ocurrido segun el reloj real.
function fechaHoraVenezuela(fecha, hora) {
  const [year, month, day] = fecha.split('-').map(Number);
  const [hour, minute] = hora.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
}

// True si la caja (fila de la tabla `cajas`, con columna abierta_en) sigue
// siendo la de HOY en Venezuela. Una caja que quedo abierta de un dia
// anterior sin cerrarse (la operadora se fue sin declarar, o la sesion
// simplemente siguio abierta cruzando medianoche) no debe poder recibir
// mas ventas ni pagos nuevos -- eso mezclaria dos dias distintos en una
// misma caja y descuadraria el cierre/rendicion.
function cajaEsDeHoy(caja) {
  if (!caja?.abierta_en) return false;
  return fechaVenezuelaDeTimestampSqlite(caja.abierta_en) === fechaVenezuelaHoy();
}

module.exports = {
  fechaVenezuelaHoy, ahoraVenezuela, horaVenezuelaActual,
  fechaVenezuelaDe, fechaVenezuelaDeTimestampSqlite, fechaHoraVenezuela,
  cajaEsDeHoy,
};

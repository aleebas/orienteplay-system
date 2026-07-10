// Fecha de "hoy" en Venezuela ('YYYY-MM-DD'), sin importar el timezone
// del dispositivo/navegador. new Date().toISOString().slice(0,10) da la
// fecha en UTC, no en Venezuela -- entre las 8PM y medianoche hora
// Venezuela ya es "manana" en UTC, y eso rompia filtros/fecha_sorteo.
export function fechaHoyVenezuela() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => p.find(x => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Date cuyos campos UTC (getUTCHours, setUTCHours, etc.) representan la
// hora LOCAL de Venezuela -- mismo convenio que
// backend/src/utils/fechaVenezuela.js. Usar esto (con los métodos UTC en
// vez de los locales) para cualquier cálculo de "¿ya pasó la hora de
// cierre de este sorteo?": si se usa new Date()/setHours() a secas, el
// resultado depende del reloj/zona horaria del dispositivo del cajero, no
// de la hora real en Venezuela -- un celular mal configurado podía mostrar
// un sorteo como abierto cuando el backend ya lo iba a rechazar.
export function ahoraVenezuela() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => Number(p.find(x => x.type === t)?.value);
  return new Date(Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')));
}

// Mensaje de WhatsApp para notificar al responsable de pagos digitales
// cuando un premio se paga por Pago Móvil o Biopago. `jugada` y `ticket`
// son el shape que devuelve GET /jugadas/ticket/:codigo.
export function buildMensajePagoDigital({ ticket, jugada, montoPremio, beneficiario }) {
  const metodoLabel = { pago_movil: 'Pago Móvil', biopago: 'Biopago' }[jugada.metodo_pago] || jugada.metodo_pago;
  return [
    '🏦 *PAGO DE PREMIO DIGITAL*',
    `Ticket: ${ticket.codigo}`,
    `Lotería: ${jugada.loteria_nombre} — ${hora12(jugada.sorteo_hora)}`,
    `Monto del premio: ${fmt(montoPremio)}`,
    `Método: ${metodoLabel}`,
    '',
    '*Datos del beneficiario:*',
    `Banco: ${beneficiario.banco || '-'}`,
    `Cédula: ${beneficiario.cedula || '-'}`,
    `Teléfono: ${beneficiario.telefono || '-'}`,
    `Nombre: ${beneficiario.nombre || '-'}`,
  ].join('\n');
}

export function abrirWhatsAppPagoDigital({ ticket, jugada, montoPremio, beneficiario, whatsappDestino }) {
  const texto = buildMensajePagoDigital({ ticket, jugada, montoPremio, beneficiario });
  const url = whatsappDestino
    ? `https://wa.me/${whatsappDestino.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');
}

export function hora12(horaStr) {
  if (!horaStr) return '';
  const [hh, mm] = horaStr.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${period}`;
}

export const fmt = (n) =>
  `Bs. ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Venezuelan number format without "Bs." prefix: 900 → "900,00", 1234.5 → "1.234,50"
export function fmtTicket(n) {
  const num = Math.round(Number(n || 0) * 100) / 100;
  const [int, dec] = num.toFixed(2).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFmt},${dec}`;
}

// Normaliza un timestamp de sqlite ('YYYY-MM-DD HH:MM:SS', siempre UTC y sin
// sufijo de zona) a ISO con 'Z' antes de construir un Date. Sin esto,
// new Date(str) interpreta el string como hora LOCAL del proceso/dispositivo
// (no UTC) -- y como el valor que viene de sqlite YA es UTC, el resultado
// queda desfasado por el offset de Venezuela (hasta 4 horas). Si el string
// ya trae 'Z' o un offset explícito, se deja igual (mismo criterio que
// fechaVenezuelaDeTimestampSqlite en el backend).
export function normalizarTimestampSqlite(str) {
  if (typeof str !== 'string') return str;
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(str) ? str : `${str.replace(' ', 'T')}Z`;
}

// Compact datetime in Venezuela timezone for ticket: "30/06/26 10:46PM"
export function fechaCorta(isoStr) {
  const d = isoStr ? new Date(normalizarTimestampSqlite(isoStr)) : new Date();
  try {
    const p = new Intl.DateTimeFormat('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).formatToParts(d);
    const g = (t) => p.find(x => x.type === t)?.value ?? '';
    const period = (p.find(x => x.type === 'dayPeriod')?.value ?? '')
      .toUpperCase().replace(/[.\s]/g, '');
    return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}${period}`;
  } catch {
    return d.toLocaleString('es-VE');
  }
}

// Full datetime display in Venezuela timezone: "30/06/26 10:46 p. m."
export function horaVenezuela(fechaISO) {
  if (!fechaISO) return '';
  const iso = normalizarTimestampSqlite(fechaISO);
  try {
    return new Date(iso).toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return new Date(iso).toLocaleString('es-VE');
  }
}

// Group jugadas by loteria_nombre + sorteo_hora for MAXPLAY ticket layout
export function agruparJugadasParaTicket(jugadas) {
  const map = new Map();
  for (const j of jugadas) {
    const hora = j.sorteo_hora || j.sorteo_nombre || '';
    const key = `${j.loteria_nombre}|||${hora}`;
    if (!map.has(key)) {
      map.set(key, { loteria: j.loteria_nombre, hora, jugadas: [] });
    }
    map.get(key).jugadas.push(j);
  }
  return Array.from(map.values());
}

// Format a single jugada as "NUM-ABRxMONTO" (e.g., "9-AGUx100")
export function formatJugadaTag(jugada) {
  const anims = jugada.animalitos || [];
  const monto = Math.round(jugada.monto);
  const parts = anims.map(a => `${a.numero}-${a.nombre.substring(0, 3).toUpperCase()}`);
  return `${parts.join('+')}x${monto}`;
}

// Wrap jugada tags into lines that fit within maxLen characters (2-space separator)
export function wrapJugadasEnLineas(tags, maxLen = 32) {
  const lines = [];
  let cur = '';
  for (const tag of tags) {
    if (!cur) {
      cur = tag;
    } else {
      const candidate = `${cur}  ${tag}`;
      if (candidate.length > maxLen) {
        lines.push(cur);
        cur = tag;
      } else {
        cur = candidate;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Formato de ticket MAXPLAY — misma lógica que frontend/src/utils/formato.js,
// portada a Node para que el ticket impreso sea idéntico al comprobante en pantalla.

function hora12(horaStr) {
  if (!horaStr) return '';
  const [hh, mm] = horaStr.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${period}`;
}

function fmtTicket(n) {
  const num = Math.round(Number(n || 0) * 100) / 100;
  const [int, dec] = num.toFixed(2).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFmt},${dec}`;
}

function fechaCorta(isoStr) {
  const d = isoStr ? new Date(isoStr) : new Date();
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

function agruparJugadasParaTicket(jugadas) {
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

function formatJugadaTag(jugada) {
  const anims = jugada.animalitos || [];
  const monto = Math.round(jugada.monto);
  const parts = anims.map(a => `${a.numero}-${a.nombre.substring(0, 3).toUpperCase()}`);
  return `${parts.join('+')}x${monto}`;
}

function wrapJugadasEnLineas(tags, maxLen = 32) {
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

module.exports = {
  hora12, fmtTicket, fechaCorta,
  agruparJugadasParaTicket, formatJugadaTag, wrapJugadasEnLineas,
};

import { useState } from 'react';
import { toBlob } from 'html-to-image';
import {
  hora12, fmtTicket, fechaCorta,
  agruparJugadasParaTicket, formatJugadaTag, wrapJugadasEnLineas,
} from '../utils/formato';

function buildTextoComprobante(ventaData, agenciaNombre) {
  const { venta, jugadas } = ventaData;
  const nombre = (agenciaNombre || 'MI AGENCIA').toUpperCase();
  const totalMonto = jugadas.reduce((s, j) => s + j.monto, 0);
  const bloques = agruparJugadasParaTicket(jugadas);

  let txt = `🎰 *${nombre}*\n`;
  txt += `TCK# ${venta.codigo}  ${fechaCorta(venta.creada_en)}\n`;
  if (venta.cliente_nombre) txt += `${venta.cliente_nombre}\n`;
  txt += `─────────────────────\n`;

  for (const bloque of bloques) {
    txt += `*${bloque.loteria.toUpperCase()}  ${hora12(bloque.hora)}*\n`;
    const tags = bloque.jugadas.map(formatJugadaTag);
    const lineas = wrapJugadasEnLineas(tags, 32);
    txt += lineas.join('\n') + '\n';
    txt += `─────────────────────\n`;
  }

  txt += `MON: ${fmtTicket(totalMonto)}(Bs)  JUG: ${jugadas.length}\n`;
  txt += `CADUCA A LOS 3 DIAS\n`;
  txt += `¡Buena suerte! 🍀`;
  return txt;
}

export default function BotonWhatsApp({ comprobanteRef, ventaData, agenciaNombre, telefono }) {
  const [loading, setLoading] = useState(false);

  async function handleCompartir() {
    setLoading(true);
    const texto = buildTextoComprobante(ventaData, agenciaNombre);

    try {
      if (navigator.share && comprobanteRef?.current) {
        try {
          const blob = await toBlob(comprobanteRef.current, { cacheBust: true, backgroundColor: '#fff' });
          const file = new File([blob], 'comprobante.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: 'Comprobante Animalitos', text: texto, files: [file] });
            setLoading(false);
            return;
          }
        } catch {}
        try {
          await navigator.share({ title: 'Comprobante Animalitos', text: texto });
          setLoading(false);
          return;
        } catch {}
      }
    } catch {}

    const url = telefono
      ? `https://wa.me/${telefono.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
      : `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
    setLoading(false);
  }

  return (
    <button
      className="btn btn-success"
      onClick={handleCompartir}
      disabled={loading}
    >
      {loading ? 'Preparando...' : '📲 Compartir por WhatsApp'}
    </button>
  );
}

import { forwardRef } from 'react';
import {
  hora12, fmtTicket, fechaCorta,
  agruparJugadasParaTicket, formatJugadaTag, wrapJugadasEnLineas,
} from '../utils/formato';

const SEP = '--------------------------------';
const SEP2 = '================================';

function L({ children, bold, faint, center }) {
  return (
    <div style={{
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: '0.74rem',
      lineHeight: 1.55,
      fontWeight: bold ? 700 : 400,
      textAlign: center ? 'center' : 'left',
      color: faint ? '#bbb' : 'inherit',
      whiteSpace: 'pre',
    }}>{children}</div>
  );
}

const Comprobante = forwardRef(function Comprobante({ ventaData, agenciaNombre }, ref) {
  if (!ventaData) return null;
  const { venta, jugadas } = ventaData;
  const totalMonto = jugadas.reduce((s, j) => s + j.monto, 0);
  const bloques = agruparJugadasParaTicket(jugadas);

  return (
    <div ref={ref} className="comprobante">
      {/* Header compacto: Logo izq + Texto derecha */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
        <img
          src="/ORIENTEPLAY_LOGO.png"
          alt="OrientePlay"
          style={{ height: '28px', objectFit: 'contain', flexShrink: 0 }}
        />
        <div style={{ flex: 1, fontSize: '0.7rem', fontFamily: "'Courier New', monospace", lineHeight: 1.4 }}>
          <div style={{ fontWeight: 700 }}>ORIENTE PLAY</div>
          <div>{(agenciaNombre || 'MI AGENCIA').toUpperCase()}</div>
          <div>TCK# {venta.codigo}</div>
          <div>{fechaCorta(venta.creada_en)}</div>
          {venta.cliente_nombre ? <div style={{ marginTop: '2px' }}>{venta.cliente_nombre}</div> : null}
        </div>
      </div>
      <L faint>{SEP2}</L>

      {bloques.map((bloque, i) => {
        const tags = bloque.jugadas.map(formatJugadaTag);
        const lineas = wrapJugadasEnLineas(tags, 32);
        return (
          <div key={i}>
            <L bold>{bloque.loteria.toUpperCase()}  {hora12(bloque.hora)}</L>
            {lineas.map((linea, j) => <L key={j}>{linea}</L>)}
            <L faint>{SEP}</L>
          </div>
        );
      })}

      <L bold>MON: {fmtTicket(totalMonto)}(Bs)  JUG: {jugadas.length}</L>
      <L>CADUCA A LOS 3 DIAS</L>
      <L faint>{SEP2}</L>
    </div>
  );
});

export default Comprobante;

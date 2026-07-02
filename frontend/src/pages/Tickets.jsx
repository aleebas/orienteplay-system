import { useState, useEffect, useMemo } from 'react';
import { getTickets, getTicket, anularVenta } from '../api/cliente';
import { EMOJI_MAP } from '../components/SelectorAnimalito';
import { hora12, fmt, horaVenezuela } from '../utils/formato';

const TODAY = new Date().toISOString().slice(0, 10);
const MINUTOS_LIMITE_ANULACION = 20;

// Misma regla que el backend (POST /api/jugadas/anular/:codigoVenta):
// pendiente + menos de 20 min desde la venta + sorteo aun no empieza.
function puedeAnular(t) {
  if (t.estado !== 'pendiente') return false;
  const creadaEnUTC = new Date(t.creada_en.replace(' ', 'T') + 'Z');
  const minutos = (Date.now() - creadaEnUTC.getTime()) / 60000;
  if (minutos > MINUTOS_LIMITE_ANULACION) return false;
  const [h, m] = t.sorteo_hora.split(':').map(Number);
  const ahora = new Date();
  const horaSorteo = new Date(ahora);
  horaSorteo.setHours(h, m, 0, 0);
  return ahora < horaSorteo;
}

const ESTADOS = [
  { key: 'todos', label: 'Todos' },
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'ganador', label: 'Ganador' },
  { key: 'perdedor', label: 'Perdedor' },
  { key: 'pagado', label: 'Pagado' },
  { key: 'anulado', label: 'Anulado' },
];

function badgeClase(estado) {
  return {
    ganador: 'success',
    pagado: 'muted',
    perdedor: 'danger',
    anulado: 'warning',
  }[estado] || 'info';
}

export default function Tickets() {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');

  const [ticketDetalle, setTicketDetalle] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState('');

  const [anulandoId, setAnulandoId] = useState(null);
  const [errorAnular, setErrorAnular] = useState('');

  useEffect(() => {
    cargarTickets();
  }, []);

  async function cargarTickets() {
    setLoading(true);
    setError('');
    try {
      setLista(await getTickets({ fecha: TODAY }));
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los tickets');
    } finally {
      setLoading(false);
    }
  }

  const filtrados = useMemo(() => {
    let r = lista;
    if (estadoFiltro !== 'todos') r = r.filter(t => t.estado === estadoFiltro);
    if (busqueda.trim()) {
      const q = busqueda.trim().toUpperCase();
      r = r.filter(t => t.ticket_codigo.toUpperCase().includes(q));
    }
    return r;
  }, [lista, estadoFiltro, busqueda]);

  async function handleAnular(t) {
    if (!confirm(`¿Anular el ticket ${t.ticket_codigo}?`)) return;
    setErrorAnular('');
    setAnulandoId(t.ticket_id);
    try {
      await anularVenta(t.venta_codigo);
      cargarTickets();
    } catch (err) {
      setErrorAnular(err.message || 'No se pudo anular el ticket');
    } finally {
      setAnulandoId(null);
    }
  }

  async function verDetalle(codigo) {
    setErrorDetalle('');
    setLoadingDetalle(true);
    try {
      setTicketDetalle(await getTicket(codigo));
    } catch (err) {
      setErrorDetalle(err.message || 'No se pudo cargar el ticket');
    } finally {
      setLoadingDetalle(false);
    }
  }

  return (
    <div className="page">
      <h1>🎫 Tickets de hoy</h1>

      <div className="card">
        <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
          {ESTADOS.map(e => (
            <button
              key={e.key}
              className={`btn btn-sm btn-inline ${estadoFiltro === e.key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setEstadoFiltro(e.key)}
            >
              {e.label}
            </button>
          ))}
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Buscar por código de ticket</label>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Ej: MS-ABC1XY23"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {errorAnular && <div className="alert alert-danger">{errorAnular}</div>}

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Hora</th>
                  <th>Lotería</th>
                  <th>Animalito(s)</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-muted">Sin tickets</td></tr>
                ) : filtrados.map(t => (
                  <tr key={t.ticket_id} onClick={() => verDetalle(t.ticket_codigo)} style={{ cursor: 'pointer' }}>
                    <td className="bold">{t.ticket_codigo}</td>
                    <td>{hora12(t.sorteo_hora)}</td>
                    <td>{t.loteria_nombre}</td>
                    <td>{t.animalitos}</td>
                    <td className="bold text-primary">{fmt(t.monto)}</td>
                    <td>
                      <span className={`badge badge-${badgeClase(t.estado)}`}>{t.estado}</span>
                    </td>
                    <td>
                      {puedeAnular(t) && (
                        <button
                          className="btn btn-danger btn-sm btn-inline"
                          disabled={anulandoId === t.ticket_id}
                          onClick={e => { e.stopPropagation(); handleAnular(t); }}
                        >
                          {anulandoId === t.ticket_id ? '...' : 'Anular'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(ticketDetalle || loadingDetalle || errorDetalle) && (
        <div className="dialog-overlay" onClick={() => { setTicketDetalle(null); setErrorDetalle(''); }}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between align-center mb-12">
              <h2>Detalle del Ticket</h2>
              <button className="btn btn-sm btn-inline btn-outline" onClick={() => { setTicketDetalle(null); setErrorDetalle(''); }}>✕</button>
            </div>

            {loadingDetalle && <div className="loading"><div className="spinner"></div></div>}
            {errorDetalle && <div className="alert alert-danger">{errorDetalle}</div>}

            {ticketDetalle && !loadingDetalle && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <span className={`badge badge-${badgeClase(ticketDetalle.ticket.estado)}`} style={{ fontSize: '0.9rem', padding: '4px 12px' }}>
                    {ticketDetalle.ticket.estado.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Ticket</span>
                  <span className="bold">{ticketDetalle.ticket.codigo}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Lotería</span>
                  <span>{ticketDetalle.jugada.loteria_nombre}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Sorteo</span>
                  <span>{hora12(ticketDetalle.jugada.sorteo_hora)} · {ticketDetalle.jugada.fecha_sorteo}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Modo</span>
                  <span>{ticketDetalle.jugada.modo_nombre}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Animal(es)</span>
                  <span>
                    {ticketDetalle.animalitos.map(a => `${EMOJI_MAP[a.nombre] || '🐾'} ${a.nombre}`).join(' + ')}
                  </span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Monto apostado</span>
                  <span className="bold">{fmt(ticketDetalle.jugada.monto)}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Forma de pago</span>
                  <span>{ticketDetalle.jugada.metodo_pago || 'efectivo'}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Vendedor</span>
                  <span>{ticketDetalle.jugada.vendedor_nombre}</span>
                </div>
                {ticketDetalle.jugada.cliente_nombre && (
                  <div className="flex justify-between mb-8">
                    <span className="text-muted">Cliente</span>
                    <span>{ticketDetalle.jugada.cliente_nombre}</span>
                  </div>
                )}

                {ticketDetalle.ticket.estado === 'pagado' && ticketDetalle.pago && (
                  <div className="alert alert-info">
                    Pagado el {horaVenezuela(ticketDetalle.pago.pagado_en)}<br />
                    Monto: {fmt(ticketDetalle.pago.monto_pagado)}
                  </div>
                )}
                {ticketDetalle.ticket.estado === 'ganador' && (
                  <div className="alert alert-success">
                    🏆 Premio a pagar: {fmt(ticketDetalle.jugada.monto * ticketDetalle.jugada.multiplicador)}
                  </div>
                )}
                {ticketDetalle.ticket.estado === 'perdedor' && (
                  <div className="alert alert-danger">Este ticket no resultó ganador.</div>
                )}
                {ticketDetalle.ticket.estado === 'pendiente' && (
                  <div className="alert alert-info">Resultado pendiente. El sorteo aún no ha sido cargado.</div>
                )}
                {ticketDetalle.ticket.estado === 'anulado' && (
                  <div className="alert alert-warning">Este ticket fue anulado.</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

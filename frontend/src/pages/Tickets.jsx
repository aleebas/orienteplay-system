import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTickets, getTicket, anularVenta, getCreditosPendientes, marcarCreditoCobrado, pagarPremio } from '../api/cliente';
import { EMOJI_MAP } from '../components/SelectorAnimalito';
import { hora12, fmt, horaVenezuela } from '../utils/formato';
import { useAuth } from '../context/AuthContext';

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
    pendiente: 'badge-estado-pendiente',
    ganador: 'badge-estado-ganador',
    pagado: 'badge-estado-pagado',
    perdedor: 'badge-estado-perdedor',
    anulado: 'badge-estado-anulado',
  }[estado] || 'badge-estado-pendiente';
}

export default function Tickets() {
  const navigate = useNavigate();
  const { caja } = useAuth();
  const [vista, setVista] = useState('tickets');

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');

  const [ticketDetalle, setTicketDetalle] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState('');

  const [anulandoVenta, setAnulandoVenta] = useState(null);
  const [errorAnular, setErrorAnular] = useState('');

  const [pagandoPremio, setPagandoPremio] = useState(false);
  const [errorPagar, setErrorPagar] = useState('');

  const [creditos, setCreditos] = useState([]);
  const [loadingCreditos, setLoadingCreditos] = useState(true);
  const [errorCreditos, setErrorCreditos] = useState('');
  const [cobrandoId, setCobrandoId] = useState(null);

  useEffect(() => {
    cargarTickets();
  }, []);

  useEffect(() => {
    if (vista === 'creditos') cargarCreditos();
  }, [vista]);

  async function cargarCreditos() {
    setLoadingCreditos(true);
    setErrorCreditos('');
    try {
      setCreditos(await getCreditosPendientes());
    } catch (err) {
      setErrorCreditos(err.message || 'No se pudieron cargar los créditos pendientes');
    } finally {
      setLoadingCreditos(false);
    }
  }

  async function handleCobrar(c) {
    if (!confirm(`¿Marcar como pagado el crédito de ${c.cliente_nombre} (${fmt(c.monto)})?`)) return;
    setCobrandoId(c.jugada_id);
    try {
      await marcarCreditoCobrado(c.jugada_id);
      cargarCreditos();
    } catch (err) {
      setErrorCreditos(err.message || 'No se pudo marcar como pagado');
    } finally {
      setCobrandoId(null);
    }
  }

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
    const relacionados = lista.filter(x => x.venta_codigo === t.venta_codigo);
    const mensaje = relacionados.length > 1
      ? `Esta venta tiene ${relacionados.length} tickets. Se anularán TODOS:\n\n` +
        relacionados.map(x => `• ${x.ticket_codigo} — ${x.animalitos} (${fmt(x.monto)})`).join('\n') +
        `\n\n¿Confirmar la anulación de toda la venta?`
      : `¿Anular el ticket ${t.ticket_codigo}?`;
    if (!confirm(mensaje)) return;
    setErrorAnular('');
    setAnulandoVenta(t.venta_codigo);
    try {
      await anularVenta(t.venta_codigo);
      cargarTickets();
    } catch (err) {
      setErrorAnular(err.message || 'No se pudo anular el ticket');
    } finally {
      setAnulandoVenta(null);
    }
  }

  async function verDetalle(codigo) {
    setErrorDetalle('');
    setErrorPagar('');
    setLoadingDetalle(true);
    try {
      setTicketDetalle(await getTicket(codigo));
    } catch (err) {
      setErrorDetalle(err.message || 'No se pudo cargar el ticket');
    } finally {
      setLoadingDetalle(false);
    }
  }

  async function handlePagarPremio() {
    if (!ticketDetalle || !caja?.id) return;
    setErrorPagar('');
    setPagandoPremio(true);
    try {
      await pagarPremio(ticketDetalle.ticket.codigo, caja.id);
      const actualizado = await getTicket(ticketDetalle.ticket.codigo);
      setTicketDetalle(actualizado);
      setLista(prev => prev.map(t =>
        t.ticket_codigo === actualizado.ticket.codigo ? { ...t, estado: actualizado.ticket.estado } : t
      ));
    } catch (err) {
      setErrorPagar(err.status === 409 ? 'Este ticket ya fue pagado anteriormente' : (err.message || 'No se pudo pagar el premio'));
    } finally {
      setPagandoPremio(false);
    }
  }

  function handleRepetirJugada() {
    const { jugada, animalitos } = ticketDetalle;
    navigate('/venta', {
      state: {
        repetir: {
          loteria_id: animalitos[0].loteria_id,
          modo_slug: jugada.modo_slug,
          monto: jugada.monto,
          animalitos: animalitos.map(a => ({ numero: a.numero, nombre: a.nombre })),
        },
      },
    });
  }

  return (
    <div className="page">
      <h1>🎫 Tickets</h1>

      <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm btn-inline ${vista === 'tickets' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setVista('tickets')}
        >
          Tickets de hoy
        </button>
        <button
          className={`btn btn-sm btn-inline ${vista === 'creditos' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setVista('creditos')}
        >
          Créditos pendientes{creditos.length > 0 ? ` (${creditos.length})` : ''}
        </button>
      </div>

      {vista === 'creditos' && (
        <div className="card">
          {errorCreditos && <div className="alert alert-danger">{errorCreditos}</div>}
          {loadingCreditos ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : creditos.length === 0 ? (
            <p className="text-muted text-sm">No hay créditos pendientes de cobro.</p>
          ) : (
            <div className="tabla-wrap">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Teléfono</th>
                    <th>Lotería</th>
                    <th>Animalito(s)</th>
                    <th>Monto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {creditos.map(c => (
                    <tr key={c.jugada_id}>
                      <td>{horaVenezuela(c.creada_en)}</td>
                      <td className="bold">{c.cliente_nombre}</td>
                      <td>{c.cliente_telefono}</td>
                      <td>{c.loteria_nombre}</td>
                      <td>{c.animalitos}</td>
                      <td className="bold text-primary">{fmt(c.monto)}</td>
                      <td>
                        <button
                          className="btn btn-success btn-sm btn-inline"
                          disabled={cobrandoId === c.jugada_id}
                          onClick={() => handleCobrar(c)}
                        >
                          {cobrandoId === c.jugada_id ? '...' : 'Marcar como pagado'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {vista === 'tickets' && (
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
                      <span className={`badge ${badgeClase(t.estado)}`}>{t.estado}</span>
                    </td>
                    <td>
                      {puedeAnular(t) && (
                        <button
                          className="btn btn-danger btn-sm btn-inline"
                          disabled={anulandoVenta === t.venta_codigo}
                          onClick={e => { e.stopPropagation(); handleAnular(t); }}
                        >
                          {anulandoVenta === t.venta_codigo ? '...' : 'Anular'}
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
      )}

      {(ticketDetalle || loadingDetalle || errorDetalle) && (
        <div className="dialog-overlay" onClick={() => { setTicketDetalle(null); setErrorDetalle(''); setErrorPagar(''); }}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between align-center mb-12">
              <h2>Detalle del Ticket</h2>
              <button className="btn btn-sm btn-inline btn-outline" onClick={() => { setTicketDetalle(null); setErrorDetalle(''); setErrorPagar(''); }}>✕</button>
            </div>

            {loadingDetalle && <div className="loading"><div className="spinner"></div></div>}
            {errorDetalle && <div className="alert alert-danger">{errorDetalle}</div>}

            {ticketDetalle && !loadingDetalle && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <span className={`badge ${badgeClase(ticketDetalle.ticket.estado)}`} style={{ fontSize: '0.9rem', padding: '4px 12px' }}>
                    {ticketDetalle.ticket.estado.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Ticket</span>
                  <span className="bold">{ticketDetalle.ticket.codigo}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Venta</span>
                  <span className="bold">{ticketDetalle.jugada.venta_codigo}</span>
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
                  <div className="premio-pagado-box">
                    <div className="bold">Premio pagado ✓</div>
                    <div className="text-sm">
                      {horaVenezuela(ticketDetalle.pago.pagado_en)} · {fmt(ticketDetalle.pago.monto_pagado)}
                    </div>
                  </div>
                )}
                {ticketDetalle.ticket.estado === 'ganador' && (
                  <>
                    <div className="alert alert-success">
                      🏆 Premio a pagar: {fmt(ticketDetalle.jugada.monto * ticketDetalle.jugada.multiplicador)}
                    </div>
                    {!caja && (
                      <div className="alert alert-warning">No hay caja abierta. Abre una caja para pagar premios.</div>
                    )}
                    {errorPagar && <div className="alert alert-danger">{errorPagar}</div>}
                    <button
                      className="btn btn-success"
                      style={{ width: '100%', marginBottom: 12 }}
                      onClick={handlePagarPremio}
                      disabled={pagandoPremio || !caja}
                    >
                      {pagandoPremio
                        ? 'Procesando...'
                        : `💰 Pagar premio — ${fmt(ticketDetalle.jugada.monto * ticketDetalle.jugada.multiplicador)}`}
                    </button>
                  </>
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

                <button
                  className="btn btn-outline"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={handleRepetirJugada}
                >
                  🔁 Repetir jugada
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

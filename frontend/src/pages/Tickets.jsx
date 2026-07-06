import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTickets, getTicket, anularVenta, getCreditosPendientes, marcarCreditoCobrado, pagarPremio, getConfiguracion } from '../api/cliente';
import { EMOJI_MAP } from '../components/SelectorAnimalito';
import ModalPagoDigital from '../components/ModalPagoDigital';
import { hora12, fmt, horaVenezuela, abrirWhatsAppPagoDigital } from '../utils/formato';
import { useAuth } from '../context/AuthContext';
import { useFechaAutoHoy } from '../hooks/useFechaAutoHoy';

const MINUTOS_LIMITE_ANULACION = 20;
const METODOS_DIGITALES = ['pago_movil', 'biopago'];

// Misma regla que el backend (POST /api/jugadas/anular/:codigoVenta):
// pendiente + menos de 20 min desde la venta + sorteo aun no empieza.
// Devuelve null si es anulable, o el motivo por el que no lo es (para
// poder explicarle al operador por que el boton de la venta esta apagado).
function motivoNoAnulable(t) {
  if (t.estado !== 'pendiente') return `el ticket ${t.ticket_codigo} ya está en estado "${t.estado}"`;
  const creadaEnUTC = new Date(t.creada_en.replace(' ', 'T') + 'Z');
  const minutos = (Date.now() - creadaEnUTC.getTime()) / 60000;
  if (minutos > MINUTOS_LIMITE_ANULACION) return `ya pasaron más de ${MINUTOS_LIMITE_ANULACION} minutos desde la venta`;
  const [h, m] = t.sorteo_hora.split(':').map(Number);
  const ahora = new Date();
  const horaSorteo = new Date(ahora);
  horaSorteo.setHours(h, m, 0, 0);
  if (ahora >= horaSorteo) return `el sorteo de las ${hora12(t.sorteo_hora)} ya comenzó`;
  return null;
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
  const [fechaFiltro, setFechaFiltroManual] = useFechaAutoHoy();

  const [ticketDetalle, setTicketDetalle] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState('');

  const [anulandoVenta, setAnulandoVenta] = useState(null);
  const [errorAnular, setErrorAnular] = useState('');

  const [pagandoPremio, setPagandoPremio] = useState(false);
  const [errorPagar, setErrorPagar] = useState('');
  const [config, setConfig] = useState({});
  const [showModalDigital, setShowModalDigital] = useState(false);

  const [creditos, setCreditos] = useState([]);
  const [loadingCreditos, setLoadingCreditos] = useState(true);
  const [errorCreditos, setErrorCreditos] = useState('');
  const [cobrandoId, setCobrandoId] = useState(null);

  // Un solo efecto debounced para fecha y busqueda: si hay busqueda, se
  // ignora la fecha y se busca en TODOS los dias por codigo de ticket o
  // de venta (quien tiene el codigo no suele saber ni le importa de que
  // dia es); si no hay busqueda, se usa la fecha seleccionada.
  useEffect(() => {
    const t = setTimeout(() => { cargarTickets(); }, 300);
    return () => clearTimeout(t);
  }, [fechaFiltro, busqueda]);

  useEffect(() => {
    getConfiguracion().then(setConfig).catch(() => {});
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
      const q = busqueda.trim();
      setLista(await getTickets(q ? { q } : { fecha: fechaFiltro }));
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los tickets');
    } finally {
      setLoading(false);
    }
  }

  const filtrados = useMemo(() => {
    if (estadoFiltro === 'todos') return lista;
    return lista.filter(t => t.estado === estadoFiltro);
  }, [lista, estadoFiltro]);

  // Agrupa filas consecutivas con el mismo venta_codigo. El backend ya
  // ordena por creada_en DESC, v.codigo, y las jugadas de una misma venta
  // comparten el mismo creada_en (misma transaccion), asi que siempre
  // quedan adyacentes -- no hace falta reordenar nada aca.
  const grupos = useMemo(() => {
    const out = [];
    for (const t of filtrados) {
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.venta_codigo === t.venta_codigo) {
        ultimo.jugadas.push(t);
      } else {
        out.push({ venta_codigo: t.venta_codigo, creada_en: t.creada_en, jugadas: [t] });
      }
    }
    return out;
  }, [filtrados]);

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
    // Pago móvil/biopago pasan primero por el modal que pide los datos
    // bancarios del ganador, para poder notificar por WhatsApp.
    if (METODOS_DIGITALES.includes(ticketDetalle.jugada.metodo_pago)) {
      setShowModalDigital(true);
      return;
    }
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

  async function handleConfirmarPagoDigital(beneficiario) {
    if (!ticketDetalle || !caja?.id) return;
    setErrorPagar('');
    setPagandoPremio(true);
    try {
      const res = await pagarPremio(ticketDetalle.ticket.codigo, caja.id, {
        banco_beneficiario: beneficiario.banco,
        cedula_beneficiario: beneficiario.cedula,
        telefono_beneficiario: beneficiario.telefono,
        nombre_beneficiario: beneficiario.nombre,
      });
      abrirWhatsAppPagoDigital({
        ticket: ticketDetalle.ticket,
        jugada: ticketDetalle.jugada,
        montoPremio: res.monto_pagado,
        beneficiario,
        whatsappDestino: config.whatsapp_pagos_digitales,
      });
      const actualizado = await getTicket(ticketDetalle.ticket.codigo);
      setTicketDetalle(actualizado);
      setLista(prev => prev.map(t =>
        t.ticket_codigo === actualizado.ticket.codigo ? { ...t, estado: actualizado.ticket.estado } : t
      ));
      setShowModalDigital(false);
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

        <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
            <label>Buscar por código de ticket o de venta</label>
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Ej: MS-ABC1XY23 o V-A1B2C3D4"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Fecha</label>
            <input
              type="date"
              value={fechaFiltro}
              onChange={e => setFechaFiltroManual(e.target.value)}
              disabled={!!busqueda.trim()}
            />
          </div>
        </div>
        {busqueda.trim() && (
          <p className="text-muted text-sm" style={{ marginTop: -6, marginBottom: 12 }}>
            Buscando "{busqueda.trim()}" en todos los días. Borra la búsqueda para volver a filtrar por fecha.
          </p>
        )}

        {error && <div className="alert alert-danger">{error}</div>}
        {errorAnular && <div className="alert alert-danger">{errorAnular}</div>}

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Venta / Ticket</th>
                  <th>Hora</th>
                  <th>Lotería</th>
                  <th>Animalito(s)</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-muted">Sin tickets</td></tr>
                ) : grupos.map(grupo => {
                  // Relacionados: TODAS las jugadas de la venta (no solo las
                  // visibles tras el filtro de estado) -- la anulacion valida
                  // el estado real de cada una en el backend, asi que el
                  // boton debe reflejar esa realidad completa, no la vista
                  // filtrada.
                  const relacionados = lista.filter(x => x.venta_codigo === grupo.venta_codigo);
                  const totalGrupo = grupo.jugadas.reduce((s, x) => s + x.monto, 0);
                  const motivosBloqueo = relacionados.map(motivoNoAnulable).filter(Boolean);
                  const anulableGrupo = motivosBloqueo.length === 0;
                  return (
                    <Fragment key={grupo.venta_codigo}>
                      <tr>
                        <td colSpan={7} style={{ background: '#f5f5f5', borderRadius: 'var(--radius)' }}>
                          <div className="flex justify-between align-center" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <div>
                              <span className="bold">{grupo.venta_codigo}</span>
                              <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
                                {horaVenezuela(grupo.creada_en)} · Total {fmt(totalGrupo)}
                              </span>
                            </div>
                            {anulableGrupo ? (
                              <button
                                className="btn btn-danger btn-sm btn-inline"
                                disabled={anulandoVenta === grupo.venta_codigo}
                                onClick={() => handleAnular(relacionados[0])}
                              >
                                {anulandoVenta === grupo.venta_codigo ? '...' : 'Anular venta'}
                              </button>
                            ) : (
                              <span className="text-muted text-sm" title={motivosBloqueo[0]}>
                                No anulable: {motivosBloqueo[0]}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {grupo.jugadas.map(t => (
                        <tr key={t.ticket_id} onClick={() => verDetalle(t.ticket_codigo)} style={{ cursor: 'pointer' }}>
                          <td style={{ paddingLeft: 24 }}>
                            <span className="text-muted text-sm" style={{ fontFamily: 'monospace' }}>{t.ticket_codigo}</span>
                          </td>
                          <td>{hora12(t.sorteo_hora)}</td>
                          <td>{t.loteria_nombre}</td>
                          <td>{t.animalitos}</td>
                          <td className="bold text-primary">{fmt(t.monto)}</td>
                          <td>
                            <span className={`badge ${badgeClase(t.estado)}`}>{t.estado}</span>
                          </td>
                          <td></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {(ticketDetalle || loadingDetalle || errorDetalle) && (
        <div className="dialog-overlay" onClick={() => { setTicketDetalle(null); setErrorDetalle(''); setErrorPagar(''); setShowModalDigital(false);}}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between align-center mb-12">
              <h2>Detalle del Ticket</h2>
              <button className="btn btn-sm btn-inline btn-outline" onClick={() => { setTicketDetalle(null); setErrorDetalle(''); setErrorPagar(''); setShowModalDigital(false);}}>✕</button>
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
                  <span className="text-muted">Resultado del sorteo</span>
                  <span>
                    {ticketDetalle.resultado
                      ? `${EMOJI_MAP[ticketDetalle.resultado.animalito_nombre] || '🐾'} ${ticketDetalle.resultado.animalito_nombre} (${ticketDetalle.resultado.animalito_numero})`
                      : <span className="text-muted">Aún no cargado</span>}
                  </span>
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

      {showModalDigital && ticketDetalle && (
        <ModalPagoDigital
          montoPremio={ticketDetalle.jugada.monto * ticketDetalle.jugada.multiplicador}
          metodoPago={ticketDetalle.jugada.metodo_pago}
          loading={pagandoPremio}
          onConfirmar={handleConfirmarPagoDigital}
          onCancelar={() => setShowModalDigital(false)}
        />
      )}
    </div>
  );
}

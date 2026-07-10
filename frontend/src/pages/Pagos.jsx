import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getGanadoresPendientes, getTicket, pagarPremio, getConfiguracion } from '../api/cliente';
import { EMOJI_MAP } from '../components/SelectorAnimalito';
import ModalPagoDigital from '../components/ModalPagoDigital';
import { hora12, fmt, horaVenezuela, fechaHoyVenezuela, abrirWhatsAppPagoDigital } from '../utils/formato';

const TODAY = fechaHoyVenezuela();
const METODOS_DIGITALES = ['pago_movil', 'biopago'];

export default function Pagos() {
  const { caja } = useAuth();
  const [ganadores, setGanadores] = useState([]);
  const [codigo, setCodigo] = useState('');
  const [ticketDetalle, setTicketDetalle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingBuscar, setLoadingBuscar] = useState(false);
  const [loadingPagar, setLoadingPagar] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [config, setConfig] = useState({});
  const [showModalDigital, setShowModalDigital] = useState(false);

  useEffect(() => {
    getGanadoresPendientes(TODAY)
      .then(setGanadores)
      .catch(() => {})
      .finally(() => setLoading(false));
    getConfiguracion().then(setConfig).catch(() => {});
  }, []);

  async function buscarTicket(cod) {
    const c = (cod || codigo).trim().toUpperCase();
    if (!c) return;
    setError('');
    setExito('');
    setLoadingBuscar(true);
    try {
      const data = await getTicket(c);
      setTicketDetalle(data);
    } catch (err) {
      setTicketDetalle(null);
      setError(err.status === 404 ? 'Ticket no encontrado' : err.message);
    } finally {
      setLoadingBuscar(false);
    }
  }

  async function handlePagar() {
    if (!ticketDetalle || !caja?.id) return;
    // Pago móvil/biopago pasan primero por el modal que pide los datos
    // bancarios del ganador, para poder notificar por WhatsApp.
    if (METODOS_DIGITALES.includes(ticketDetalle.jugada.metodo_pago)) {
      setShowModalDigital(true);
      return;
    }
    setError('');
    setLoadingPagar(true);
    try {
      const res = await pagarPremio(ticketDetalle.ticket.codigo, caja.id);
      setExito(`✅ Premio pagado: ${fmt(res.monto_pagado)}`);
      setTicketDetalle(null);
      setCodigo('');
      // Refrescar ganadores pendientes
      const g = await getGanadoresPendientes(TODAY);
      setGanadores(g);
    } catch (err) {
      if (err.status === 409) {
        setError('⚠️ Este ticket ya fue pagado anteriormente');
      } else {
        setError(err.message);
      }
    } finally {
      setLoadingPagar(false);
    }
  }

  async function handleConfirmarPagoDigital(beneficiario) {
    if (!ticketDetalle || !caja?.id) return;
    setError('');
    setLoadingPagar(true);
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
      setExito(`✅ Premio pagado: ${fmt(res.monto_pagado)}`);
      setShowModalDigital(false);
      setTicketDetalle(null);
      setCodigo('');
      const g = await getGanadoresPendientes(TODAY);
      setGanadores(g);
    } catch (err) {
      if (err.status === 409) {
        setError('⚠️ Este ticket ya fue pagado anteriormente');
      } else {
        setError(err.message);
      }
    } finally {
      setLoadingPagar(false);
    }
  }

  function cerrarDetalle() {
    setTicketDetalle(null);
    setError('');
    setExito('');
    setCodigo('');
    setShowModalDigital(false);
  }

  const montoPremio = ticketDetalle
    ? ticketDetalle.jugada.monto * ticketDetalle.jugada.multiplicador
    : 0;

  return (
    <div className="page">
      <h1>Pago de Premios</h1>

      {exito && <div className="alert alert-success">{exito}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Buscador por código */}
      <div className="card">
        <h2>Buscar por código de ticket</h2>
        <div className="flex gap-8">
          <div style={{ flex: 1 }}>
            <input
              className="field"
              style={{ width: '100%', padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '1rem', minHeight: 48 }}
              type="text"
              value={codigo}
              onChange={e => setCodigo(e.target.value.toUpperCase())}
              placeholder="Ej: MS-ABC1XY23"
              onKeyDown={e => e.key === 'Enter' && buscarTicket()}
            />
          </div>
          <button
            className="btn btn-primary btn-inline"
            onClick={() => buscarTicket()}
            disabled={loadingBuscar || !codigo}
            style={{ minWidth: 90 }}
          >
            {loadingBuscar ? '...' : 'Buscar'}
          </button>
        </div>
      </div>

      {/* Detalle del ticket */}
      {ticketDetalle && (
        <div className="card">
          <div className="flex justify-between align-center mb-12">
            <h2>Detalle del Ticket</h2>
            <button className="btn btn-sm btn-inline btn-outline" onClick={cerrarDetalle}>✕</button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <span className={`badge badge-${
              ticketDetalle.ticket.estado === 'ganador' ? 'success' :
              ticketDetalle.ticket.estado === 'pagado' ? 'muted' :
              ticketDetalle.ticket.estado === 'perdedor' ? 'danger' : 'info'
            }`} style={{ fontSize: '0.9rem', padding: '4px 12px' }}>
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
              {ticketDetalle.animalitos.map(a =>
                `${EMOJI_MAP[a.nombre] || '🐾'} ${a.nombre}`
              ).join(' + ')}
            </span>
          </div>
          <div className="flex justify-between mb-8">
            <span className="text-muted">Monto apostado</span>
            <span className="bold">{fmt(ticketDetalle.jugada.monto)}</span>
          </div>
          <div className="flex justify-between mb-8">
            <span className="text-muted">Vendedor</span>
            <span>{ticketDetalle.jugada.vendedor_nombre}</span>
          </div>

          {ticketDetalle.ticket.estado === 'ganador' && (
            <>
              <div style={{ background: 'var(--success-light)', borderRadius: 'var(--radius)', padding: '12px 16px', margin: '12px 0', textAlign: 'center' }}>
                <div className="text-success bold" style={{ fontSize: '1.1rem' }}>🏆 Premio a pagar</div>
                <div className="text-success bold" style={{ fontSize: '1.6rem' }}>{fmt(montoPremio)}</div>
                <div className="text-muted text-sm">x{ticketDetalle.jugada.multiplicador}</div>
              </div>
              {!caja && (
                <div className="alert alert-warning">No hay caja abierta. Abre una caja para pagar premios.</div>
              )}
              {caja?.requiere_cierre && (
                <div className="alert alert-warning">Tienes una caja del {caja.fecha_caja_abierta} sin cerrar. Ciérrala en Caja antes de pagar premios.</div>
              )}
              <button
                className="btn btn-success"
                onClick={handlePagar}
                disabled={loadingPagar || !caja || caja.requiere_cierre}
              >
                {loadingPagar ? 'Procesando...' : `✓ Confirmar pago de ${fmt(montoPremio)}`}
              </button>
            </>
          )}

          {ticketDetalle.ticket.estado === 'pagado' && ticketDetalle.pago && (
            <div className="alert alert-info">
              Ya pagado el {horaVenezuela(ticketDetalle.pago.pagado_en)}<br />
              Monto: {fmt(ticketDetalle.pago.monto_pagado)}
            </div>
          )}

          {ticketDetalle.ticket.estado === 'perdedor' && (
            <div className="alert alert-danger">Este ticket no resultó ganador.</div>
          )}

          {ticketDetalle.ticket.estado === 'pendiente' && (
            <div className="alert alert-info">Resultado pendiente. El sorteo aún no ha sido cargado.</div>
          )}
        </div>
      )}

      {/* Lista de ganadores pendientes */}
      <div className="card">
        <h2>Ganadores pendientes hoy</h2>
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : ganadores.length === 0 ? (
          <p className="text-muted text-sm">No hay tickets ganadores pendientes de pago para hoy.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {ganadores.map(g => (
              <div key={g.ticket_id} className="carrito-item">
                <div className="carrito-info">
                  <div className="carrito-titulo">{g.codigo}</div>
                  <div className="carrito-meta">
                    {g.loteria_nombre} · {g.sorteo_nombre} · {g.modo_nombre}
                    {g.cliente_nombre ? ` · ${g.cliente_nombre}` : ''}
                  </div>
                  <div className="text-muted text-sm">
                    Apostado: {fmt(g.monto)} → Premio: <strong className="text-success">{fmt(g.monto_premio)}</strong>
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm btn-inline"
                  onClick={() => buscarTicket(g.codigo)}
                >
                  Ver
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModalDigital && ticketDetalle && (
        <ModalPagoDigital
          montoPremio={montoPremio}
          metodoPago={ticketDetalle.jugada.metodo_pago}
          loading={loadingPagar}
          onConfirmar={handleConfirmarPagoDigital}
          onCancelar={() => setShowModalDigital(false)}
        />
      )}
    </div>
  );
}

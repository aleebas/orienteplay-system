import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCajaActual, abrirCaja, cerrarCaja, getResumenCaja } from '../api/cliente';
import { horaVenezuela, fmt } from '../utils/formato';

export default function Caja() {
  const { caja, setCaja } = useAuth();
  const navigate = useNavigate();
  const [resumen, setResumen] = useState(null);
  const [montoInicial, setMontoInicial] = useState('');
  const [montoFinal, setMontoFinal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCerrar, setShowCerrar] = useState(false);

  const cargarResumen = useCallback(async () => {
    if (!caja?.id) return;
    try {
      const r = await getResumenCaja(caja.id);
      setResumen(r);
    } catch {}
  }, [caja?.id]);

  useEffect(() => {
    if (caja?.id) {
      cargarResumen();
      const t = setInterval(cargarResumen, 30000);
      return () => clearInterval(t);
    } else {
      (async () => {
        try { const c = await getCajaActual(); setCaja(c); } catch {}
      })();
    }
  }, [caja?.id, cargarResumen, setCaja]);

  async function handleAbrir(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await abrirCaja(parseFloat(montoInicial) || 0);
      const cajaActual = await getCajaActual();
      setCaja(cajaActual);
      setMontoInicial('');
      navigate('/venta');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCerrar(e) {
    e.preventDefault();
    if (!caja?.id) return;
    setError('');
    setLoading(true);
    try {
      const r = await cerrarCaja(caja.id, parseFloat(montoFinal) || 0);
      setCaja(null);
      setResumen(r.resumen);
      setShowCerrar(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /* ── Caja cerrada ── */
  if (!caja) {
    return (
      <div className="caja-cerrada">
        <div className="caja-cerrada-card">
          <div className="caja-cerrada-icon">💰</div>
          <h1 style={{ marginBottom: 6 }}>Abrir Caja</h1>
          <p className="text-muted text-sm mb-12">
            Ingresa el monto inicial en efectivo para comenzar la jornada.
          </p>

          {error && <div className="alert alert-danger">{error}</div>}

          <form onSubmit={handleAbrir}>
            <div className="field">
              <label>Monto inicial (Bs.)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={montoInicial}
                onChange={e => setMontoInicial(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-accent" disabled={loading}>
              {loading ? 'Abriendo caja...' : '✓ Abrir caja'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Caja abierta ── */
  const difFinal = montoFinal && resumen
    ? parseFloat(montoFinal) - (resumen.efectivo_esperado || 0)
    : null;

  const pctEfectivo = resumen
    ? Math.min(100, ((resumen.efectivo_esperado || 0) / Math.max(resumen.monto_inicial || 1, 1)) * 100)
    : 0;

  return (
    <div className="page">
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Header verde */}
      <div className="caja-abierta-header">
        <div>
          <div className="caja-abierta-title">✅ Caja abierta</div>
          <div className="caja-abierta-sub">
            {caja.abierta_en ? `Desde ${horaVenezuela(caja.abierta_en)}` : `ID #${caja.id}`}
          </div>
        </div>
        <button
          className="btn btn-danger btn-sm btn-inline"
          onClick={() => setShowCerrar(true)}
        >
          Cerrar caja
        </button>
      </div>

      {resumen ? (
        <>
          <div className="resumen-grid">
            <div className="resumen-item">
              <div className="resumen-valor" style={{ color: 'var(--primary)' }}>
                {resumen.ventas_cantidad}
              </div>
              <div className="resumen-label">Jugadas vendidas</div>
            </div>
            <div className="resumen-item">
              <div className="resumen-valor">{fmt(resumen.ventas_total)}</div>
              <div className="resumen-label">Total ventas</div>
            </div>
            <div className="resumen-item">
              <div className="resumen-valor" style={{ color: 'var(--danger)' }}>
                {fmt(resumen.premios_pagados_total)}
              </div>
              <div className="resumen-label">Premios pagados ({resumen.premios_pagados_cantidad})</div>
            </div>
            <div className="resumen-item">
              <div className="resumen-valor" style={{ color: 'var(--success)' }}>
                {fmt(resumen.comision_estimada)}
              </div>
              <div className="resumen-label">Comisión estimada</div>
            </div>
          </div>

          <div className="card">
            <div className="flex justify-between mb-8">
              <span className="text-muted text-sm">Monto inicial</span>
              <span className="bold">{fmt(resumen.monto_inicial)}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pctEfectivo}%` }} />
            </div>
            <div className="flex justify-between">
              <span className="bold text-lg">Efectivo esperado</span>
              <span className="bold text-lg" style={{ color: 'var(--accent-dark)' }}>
                {fmt(resumen.efectivo_esperado)}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="loading">
          <div className="spinner"></div><br />Cargando resumen...
        </div>
      )}

      {/* Dialog cerrar caja */}
      {showCerrar && (
        <div className="dialog-overlay" onClick={() => setShowCerrar(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h2>Cerrar caja</h2>
            {resumen && (
              <div className="alert alert-info">
                Efectivo esperado: <strong>{fmt(resumen.efectivo_esperado)}</strong>
              </div>
            )}
            <form onSubmit={handleCerrar}>
              <div className="field">
                <label>Monto contado en caja (Bs.)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoFinal}
                  onChange={e => setMontoFinal(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              {difFinal !== null && (
                <div className={`alert ${difFinal >= 0 ? 'alert-success' : 'alert-danger'}`}>
                  Diferencia: <strong>{fmt(difFinal)}</strong>
                  {difFinal >= 0 ? ' ✓ Sobrante' : ' ✗ Faltante'}
                </div>
              )}
              <div className="dialog-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCerrar(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-danger" disabled={loading}>
                  {loading ? 'Cerrando...' : 'Confirmar cierre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

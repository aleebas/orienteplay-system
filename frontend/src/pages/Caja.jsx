import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCajaActual, abrirCaja, cerrarCaja, getResumenCaja, getRendicion, getRendicionVendedores } from '../api/cliente';
import { horaVenezuela, fmt, fechaHoyVenezuela } from '../utils/formato';

const TODAY = fechaHoyVenezuela();
const HACE7 = (() => {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 6)).toISOString().slice(0, 10);
})();

export default function Caja() {
  const { caja, setCaja, auth } = useAuth();
  const esAdmin = auth?.user?.rol === 'admin';
  const navigate = useNavigate();
  const [resumen, setResumen] = useState(null);
  const [montoInicial, setMontoInicial] = useState('');
  const [fondoBanco, setFondoBanco] = useState('');
  const [montoFinal, setMontoFinal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCerrar, setShowCerrar] = useState(false);

  // Caja de un dia anterior sin declarar -- bloquea la apertura de una nueva
  const [cierreForzado, setCierreForzado] = useState(null); // { caja_id, fecha_caja_abierta }
  const [resumenForzado, setResumenForzado] = useState(null);
  const [montoFinalForzado, setMontoFinalForzado] = useState('');
  const [cerrandoForzado, setCerrandoForzado] = useState(false);

  // Rendición semanal (o cualquier rango)
  const [mostrarRendicion, setMostrarRendicion] = useState(false);
  const [rendDesde, setRendDesde] = useState(HACE7);
  const [rendHasta, setRendHasta] = useState(TODAY);
  const [rendDias, setRendDias] = useState(null);
  const [rendVendedores, setRendVendedores] = useState(null);
  const [loadingRend, setLoadingRend] = useState(false);
  const [errorRend, setErrorRend] = useState('');

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
      await abrirCaja(parseFloat(montoInicial) || 0, parseFloat(fondoBanco) || 0);
      const cajaActual = await getCajaActual();
      setCaja(cajaActual);
      setMontoInicial('');
      setFondoBanco('');
      navigate('/venta');
    } catch (err) {
      if (err.status === 409 && err.data?.requiere_cierre_anterior) {
        setCierreForzado({ caja_id: err.data.caja_id, fecha_caja_abierta: err.data.fecha_caja_abierta });
        try { setResumenForzado(await getResumenCaja(err.data.caja_id)); } catch {}
      } else {
        setError(err.message);
      }
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

  async function handleCerrarForzado(e) {
    e.preventDefault();
    if (!cierreForzado?.caja_id) return;
    setCerrandoForzado(true);
    try {
      await cerrarCaja(cierreForzado.caja_id, parseFloat(montoFinalForzado) || 0);
      setCierreForzado(null);
      setResumenForzado(null);
      setMontoFinalForzado('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCerrandoForzado(false);
    }
  }

  async function cargarRendicion() {
    setLoadingRend(true);
    setErrorRend('');
    try {
      const [dias, vend] = await Promise.all([
        getRendicion(rendDesde, rendHasta),
        esAdmin ? getRendicionVendedores(rendDesde, rendHasta) : Promise.resolve(null),
      ]);
      setRendDias(dias);
      setRendVendedores(vend);
    } catch (err) {
      setErrorRend(err.message || 'No se pudo cargar la rendición');
    } finally {
      setLoadingRend(false);
    }
  }

  useEffect(() => {
    if (mostrarRendicion) cargarRendicion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarRendicion, rendDesde, rendHasta]);

  /* ── Caja abierta de un día anterior sin declarar ── */
  // caja.requiere_cierre viene de GET /caja/actual: la caja sigue "abierta"
  // pero es de ayer (o antes) -- no de una operadora tratando de abrir una
  // nueva, sino de una sesión que llegó hasta hoy sin que nadie la cerrara
  // anoche. Se bloquea toda la pantalla hasta declararla: nada de vender ni
  // pagar premios contra una caja de otro día (el backend también lo
  // rechaza, esto es para que no llegue ni a intentarlo).
  if (caja?.requiere_cierre) {
    return (
      <div className="caja-cerrada">
        <div className="caja-cerrada-card">
          <div className="caja-cerrada-icon">⚠️</div>
          <h1 style={{ marginBottom: 6 }}>Tienes una caja abierta del {caja.fecha_caja_abierta}</h1>
          <p className="text-muted text-sm mb-12">
            Nadie la cerró antes de hoy. Debes declararla antes de poder vender o pagar premios.
          </p>
          {resumen && (
            <div className="alert alert-info">
              Efectivo esperado: <strong>{fmt(resumen.efectivo_esperado)}</strong>
              {' '}· Ventas: {fmt(resumen.ventas_total)} · Premios pagados: {fmt(resumen.premios_pagados_total)}
            </div>
          )}
          {error && <div className="alert alert-danger">{error}</div>}
          <form onSubmit={handleCerrar}>
            <div className="field">
              <label>Monto contado en esa caja (Bs.)</label>
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
            <button type="submit" className="btn btn-danger" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Cerrando...' : `Cerrar caja del ${caja.fecha_caja_abierta}`}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Caja cerrada ── */
  if (!caja) {
    return (
      <>
      <div className="caja-cerrada">
        <div className="caja-cerrada-card">
          <div className="caja-cerrada-icon">💰</div>
          <h1 style={{ marginBottom: 6 }}>Abrir Caja</h1>
          <p className="text-muted text-sm mb-12">
            Ingresa los montos con los que arranca la jornada.
          </p>

          {error && <div className="alert alert-danger">{error}</div>}

          <form onSubmit={handleAbrir}>
            <div className="field">
              <label>Efectivo en caja (Bs.)</label>
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
            <div className="field">
              <label>Fondo en banco/cuenta (Bs.)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fondoBanco}
                onChange={e => setFondoBanco(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <button type="submit" className="btn btn-accent" disabled={loading}>
              {loading ? 'Abriendo caja...' : '✓ Abrir caja'}
            </button>
          </form>
        </div>
      </div>

      {cierreForzado && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>⚠️ Tienes una caja abierta del {cierreForzado.fecha_caja_abierta}</h2>
            <p className="text-muted text-sm mb-12">
              Debes declararla (cerrarla) antes de poder abrir una nueva caja.
            </p>
            {resumenForzado && (
              <div className="alert alert-info">
                Efectivo esperado: <strong>{fmt(resumenForzado.efectivo_esperado)}</strong>
                {' '}· Ventas: {fmt(resumenForzado.ventas_total)} · Premios pagados: {fmt(resumenForzado.premios_pagados_total)}
              </div>
            )}
            {error && <div className="alert alert-danger">{error}</div>}
            <form onSubmit={handleCerrarForzado}>
              <div className="field">
                <label>Monto contado en esa caja (Bs.)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoFinalForzado}
                  onChange={e => setMontoFinalForzado(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-danger" style={{ width: '100%' }} disabled={cerrandoForzado}>
                {cerrandoForzado ? 'Cerrando...' : `Cerrar caja del ${cierreForzado.fecha_caja_abierta}`}
              </button>
            </form>
          </div>
        </div>
      )}
      </>
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
              <span className="text-muted text-sm">Efectivo en caja</span>
              <span className="bold">{fmt(resumen.monto_inicial)}</span>
            </div>
            <div className="flex justify-between mb-8">
              <span className="text-muted text-sm">Fondo en banco/cuenta</span>
              <span className="bold">{fmt(resumen.fondo_banco)}</span>
            </div>
            <div className="flex justify-between mb-8">
              <span className="text-muted text-sm">Total disponible</span>
              <span className="bold text-primary">{fmt(resumen.total_disponible)}</span>
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

          {resumen.comisiones_vendedores?.length > 0 && (
            <div className="card">
              <h2>Comisión por vendedor</h2>
              <div className="tabla-wrap">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th style={{ textAlign: 'right' }}>Vendido</th>
                      <th style={{ textAlign: 'right' }}>%</th>
                      <th style={{ textAlign: 'right' }}>Comisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.comisiones_vendedores.map(c => (
                      <tr key={c.usuario_id}>
                        <td>{c.nombre}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(c.monto_vendido)}</td>
                        <td style={{ textAlign: 'right' }}>{c.comision_porcentaje}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>
                          {fmt(c.comision_ganada)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="flex justify-between align-center" style={{ cursor: 'pointer' }} onClick={() => setMostrarRendicion(v => !v)}>
              <h2 style={{ marginBottom: 0 }}>📊 Rendición semanal</h2>
              <span className="btn btn-outline btn-sm btn-inline">{mostrarRendicion ? 'Ocultar' : 'Ver'}</span>
            </div>

            {mostrarRendicion && (
              <>
                <div className="flex gap-8 mt-12 mb-12" style={{ flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label>Desde</label>
                    <input type="date" value={rendDesde} onChange={e => setRendDesde(e.target.value)} />
                  </div>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label>Hasta</label>
                    <input type="date" value={rendHasta} onChange={e => setRendHasta(e.target.value)} />
                  </div>
                </div>

                {errorRend && <div className="alert alert-danger">{errorRend}</div>}
                {loadingRend ? (
                  <div className="loading"><div className="spinner"></div></div>
                ) : rendDias && (
                  <>
                    <div className="tabla-wrap">
                      <table className="tabla">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th style={{ textAlign: 'right' }}>Vendido</th>
                            <th style={{ textAlign: 'right' }}>Premios pagados</th>
                            <th style={{ textAlign: 'right' }}>Comisión</th>
                            <th style={{ textAlign: 'right' }}>Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rendDias.dias.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted">Sin datos en el rango</td></tr>
                          ) : rendDias.dias.map(d => (
                            <tr key={d.fecha}>
                              <td>{d.fecha}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(d.total_vendido)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(d.premios_pagados)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(d.comision)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.neto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {rendDias.dias.length > 0 && (
                      <div className="flex justify-between bold mt-12" style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 'var(--radius)' }}>
                        <span>Total del período</span>
                        <span className="text-primary">Neto: {fmt(rendDias.totales.neto)}</span>
                      </div>
                    )}
                  </>
                )}

                {esAdmin && rendVendedores && (
                  <>
                    <h3 style={{ marginTop: 16, marginBottom: 8 }}>Desglose por vendedor</h3>
                    <div className="tabla-wrap">
                      <table className="tabla">
                        <thead>
                          <tr>
                            <th>Vendedor</th>
                            <th style={{ textAlign: 'right' }}>Vendido</th>
                            <th style={{ textAlign: 'right' }}>Premios pagados</th>
                            <th style={{ textAlign: 'right' }}>Comisión</th>
                            <th style={{ textAlign: 'right' }}>Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rendVendedores.vendedores.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted">Sin datos en el rango</td></tr>
                          ) : rendVendedores.vendedores.map(v => (
                            <tr key={v.usuario_id}>
                              <td>{v.nombre}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(v.total_vendido)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(v.premios_pagados)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(v.comision_ganada)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(v.neto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
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

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getResumenCaja,
  getReporteVentasPorLoteria,
  getReporteVentasPorVendedor,
  getUltimasVentas,
  getLimitesUso,
} from '../api/cliente';
import { fmt, horaVenezuela, hora12 } from '../utils/formato';

const TODAY = () => new Date().toISOString().slice(0, 10);

function MetricCard({ icon, label, value, sub, color }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={color ? { color } : undefined}>{value ?? '—'}</div>
      {sub && <div className="metric-sub">{sub}</div>}
      <div className="metric-icon-bg">{icon}</div>
    </div>
  );
}

function SemaforoDot({ pct, bloqueado }) {
  if (bloqueado || pct >= 100) return <span className="limite-dot bloqueado" title="Bloqueado" />;
  if (pct >= 80) return <span className="limite-dot rojo" title="Crítico" />;
  if (pct >= 50) return <span className="limite-dot amarillo" title="Alerta" />;
  return <span className="limite-dot verde" title="Normal" />;
}

export default function Dashboard() {
  const { caja } = useAuth();
  const [resumen, setResumen] = useState(null);
  const [porLoteria, setPorLoteria] = useState([]);
  const [porVendedor, setPorVendedor] = useState([]);
  const [recientes, setRecientes] = useState([]);
  const [limitesUso, setLimitesUso] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const cargar = useCallback(async () => {
    const fecha = TODAY();
    const [r1, r2, r3, r4, r5] = await Promise.allSettled([
      caja?.id ? getResumenCaja(caja.id) : Promise.resolve(null),
      getReporteVentasPorLoteria(fecha),
      getReporteVentasPorVendedor(fecha),
      getUltimasVentas(10),
      getLimitesUso(),
    ]);
    if (r1.status === 'fulfilled') setResumen(r1.value);
    if (r2.status === 'fulfilled') setPorLoteria(r2.value || []);
    if (r3.status === 'fulfilled') setPorVendedor(r3.value || []);
    if (r4.status === 'fulfilled') setRecientes(r4.value || []);
    if (r5.status === 'fulfilled') setLimitesUso(r5.value || []);
    setLastUpdate(new Date());
  }, [caja?.id]);

  useEffect(() => {
    cargar().finally(() => setLoading(false));
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, [cargar]);

  if (loading) {
    return <div className="loading"><div className="spinner"></div><br />Cargando dashboard...</div>;
  }

  const maxLoteria = Math.max(...porLoteria.map(r => r.total_vendido || 0), 1);
  const limitesAlerta = limitesUso.filter(l => l.acumulado > 0 || l.monto_max > 0);

  const horaApertura = caja?.abierta_en
    ? horaVenezuela(caja.abierta_en)
    : 'Sin caja abierta';

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <span className="dashboard-refresh">
          {lastUpdate
            ? `Actualizado ${lastUpdate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`
            : ''}
          {' · Refresca cada 30s'}
        </span>
      </div>

      {/* ── Fila 1: Métricas principales ── */}
      <div className="metrics-grid">
        <MetricCard
          icon="💰"
          label="Ventas hoy"
          value={resumen ? fmt(resumen.ventas_total) : '—'}
          sub={resumen ? `${resumen.ventas_cantidad} jugadas` : 'Sin caja abierta'}
          color="var(--primary)"
        />
        <MetricCard
          icon="🏆"
          label="Premios pagados"
          value={resumen ? fmt(resumen.premios_pagados_total) : '—'}
          sub={resumen ? `${resumen.premios_pagados_cantidad} tickets` : ''}
          color="var(--danger)"
        />
        <MetricCard
          icon="📈"
          label="Comisión estimada"
          value={resumen ? fmt(resumen.comision_estimada) : '—'}
          sub={resumen && resumen.ventas_total > 0
            ? `${Math.round((resumen.comision_estimada / resumen.ventas_total) * 100)}% del total`
            : ''}
          color="var(--success)"
        />
        <MetricCard
          icon="💵"
          label="Efectivo esperado"
          value={resumen ? fmt(resumen.efectivo_esperado) : '—'}
          sub={horaApertura}
          color="var(--accent-dark)"
        />
      </div>

      {/* ── Fila 2: Ventas por lotería ── */}
      <div className="card">
        <h2>Ventas por lotería — {TODAY()}</h2>
        {porLoteria.length === 0 ? (
          <p className="text-muted text-sm">Sin ventas registradas hoy.</p>
        ) : (
          porLoteria.map(r => (
            <div key={r.loteria} className="bar-row">
              <div className="bar-label">
                <span>{r.loteria}</span>
                <span>{fmt(r.total_vendido)} ({r.cantidad_jugadas} jug.)</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${Math.round((r.total_vendido / maxLoteria) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Fila 3: Dos columnas ── */}
      <div className="dashboard-two-col">
        {/* Ventas por vendedor */}
        <div className="card" style={{ marginBottom: 0 }}>
          <h2>Ventas por vendedor</h2>
          {porVendedor.length === 0 ? (
            <p className="text-muted text-sm">Sin datos.</p>
          ) : (
            <div className="tabla-wrap">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th style={{ textAlign: 'right' }}>Jugadas</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {porVendedor.map(r => (
                    <tr key={r.vendedor}>
                      <td>{r.vendedor}</td>
                      <td style={{ textAlign: 'right' }}>{r.cantidad_jugadas}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.total_vendido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Alertas de límites */}
        <div className="card" style={{ marginBottom: 0 }}>
          <h2>Alertas de límites de banca</h2>
          {limitesAlerta.length === 0 ? (
            <p className="text-muted text-sm">Sin límites configurados o sin uso hoy.</p>
          ) : (
            limitesAlerta.slice(0, 12).map(l => {
              const pct = l.monto_max > 0
                ? Math.round((l.acumulado / l.monto_max) * 100)
                : 0;
              const bloqueado = l.modo_accion === 'bloquear' && pct >= 100;
              return (
                <div key={l.id} className="limite-row">
                  <SemaforoDot pct={pct} bloqueado={bloqueado} />
                  <div className="limite-info">
                    <div className="limite-nombre">
                      #{l.numero} {l.animalito_nombre}
                    </div>
                    <div className="limite-sub">
                      {l.loteria_nombre} · Máx {fmt(l.monto_max)}
                    </div>
                  </div>
                  <div
                    className="limite-pct"
                    style={{
                      color: bloqueado || pct >= 100 ? '#333'
                        : pct >= 80 ? 'var(--danger)'
                        : pct >= 50 ? 'var(--warning)'
                        : 'var(--success)',
                    }}
                  >
                    {pct}%
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Fila 4: Últimas ventas ── */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="flex justify-between align-center mb-12">
          <h2>Últimas ventas del día</h2>
          <span className="text-muted text-sm">{recientes.length} registros</span>
        </div>
        {recientes.length === 0 ? (
          <p className="text-muted text-sm">Sin ventas hoy.</p>
        ) : (
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Hora</th>
                  <th>Lotería(s)</th>
                  <th>Vendedor</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map(r => (
                  <tr key={r.codigo_venta}>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem' }}>
                        {r.codigo_venta}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {r.creada_en
                        ? new Date(r.creada_en).toLocaleTimeString('es-VE', {
                            timeZone: 'America/Caracas',
                            hour: '2-digit', minute: '2-digit', hour12: true,
                          })
                        : '—'}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>{r.loterias}</td>
                    <td style={{ fontSize: '0.8rem' }}>{r.vendedor}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {fmt(r.monto_total)}
                    </td>
                    <td>
                      <span className={`badge badge-${
                        r.estado === 'pagado'   ? 'muted'    :
                        r.estado === 'ganador'  ? 'success'  :
                        r.estado === 'perdedor' ? 'danger'   : 'info'
                      }`}>
                        {r.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

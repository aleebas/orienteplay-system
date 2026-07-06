import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getReporteVentasPorDia,
  getReporteVentasPorLoteria,
  getReporteVentasPorVendedor,
  getCatalogoLoterias,
  getLimites,
  guardarLimite,
  desactivarLimite,
  eliminarLimitesLoteria,
  eliminarTodosLimites,
  getUsuarios,
  crearUsuario,
  editarUsuario,
  eliminarUsuario,
  getConteoBorrado,
  ejecutarBorrado,
  getConfiguracion,
  guardarConfiguracion,
} from '../api/cliente';
import { fechaHoyVenezuela } from '../utils/formato';

const TODAY = fechaHoyVenezuela();
const HACE7 = (() => {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 6)).toISOString().slice(0, 10);
})();
const fmt = (n) => `Bs. ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Reportes() {
  const { auth } = useAuth();
  const agenciaId = auth?.user?.agencia_id;
  const esAdmin = auth?.user?.rol === 'admin';

  const [tab, setTab] = useState('dia');
  const [desde, setDesde] = useState(HACE7);
  const [hasta, setHasta] = useState(TODAY);
  const [fechaDetalle, setFechaDetalle] = useState(TODAY);
  const [dataDia, setDataDia] = useState([]);
  const [dataLoteria, setDataLoteria] = useState([]);
  const [dataVendedor, setDataVendedor] = useState([]);
  const [loading, setLoading] = useState(false);

  // Límites
  const [limites, setLimites] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [formLimite, setFormLimite] = useState({
    loteria_id: '', animalito_id: '', sorteo_id: '', monto_max: '', monto_max_ticket: '', modo_accion: 'alertar'
  });
  const [savingLimite, setSavingLimite] = useState(false);
  const [limiteMsg, setLimiteMsg] = useState('');
  const [borrandoLimites, setBorrandoLimites] = useState(false);

  // Administración de datos (solo admin)
  const [borradoDesde, setBorradoDesde] = useState(HACE7);
  const [borradoHasta, setBorradoHasta] = useState(TODAY);
  const [borradoConteo, setBorradoConteo] = useState(null);
  const [borradoTexto, setBorradoTexto] = useState('');
  const [borrandoDatos, setBorrandoDatos] = useState(false);
  const [borradoMsg, setBorradoMsg] = useState('');
  const [consultandoBorrado, setConsultandoBorrado] = useState(false);

  // Configuración (solo admin)
  const [config, setConfig] = useState({});
  const [whatsappPagos, setWhatsappPagos] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  // Usuarios
  const [usuarios, setUsuarios] = useState([]);
  const [formUsuario, setFormUsuario] = useState({ nombre: '', usuario: '', clave: '', rol: 'vendedor', comision_porcentaje: 14, puede_confirmar_resultados: false });
  const [savingUsuario, setSavingUsuario] = useState(false);
  const [usuarioMsg, setUsuarioMsg] = useState('');
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const [formEditar, setFormEditar] = useState({ nombre: '', rol: 'vendedor', clave: '', comision_porcentaje: 14, puede_confirmar_resultados: false });
  const [savingEditar, setSavingEditar] = useState(false);
  const [editarMsg, setEditarMsg] = useState('');

  useEffect(() => {
    cargarReportes();
  }, [desde, hasta, fechaDetalle]);

  useEffect(() => {
    if (tab === 'limites') cargarLimites();
    if (tab === 'usuarios') cargarUsuarios();
    if (tab === 'config') cargarConfig();
    if (tab === 'datos') { setBorradoConteo(null); setBorradoTexto(''); setBorradoMsg(''); }
  }, [tab]);

  async function cargarReportes() {
    setLoading(true);
    try {
      const [d, l, v] = await Promise.all([
        getReporteVentasPorDia(desde, hasta),
        getReporteVentasPorLoteria(fechaDetalle),
        getReporteVentasPorVendedor(fechaDetalle),
      ]);
      setDataDia(d);
      setDataLoteria(l);
      setDataVendedor(v);
    } catch {}
    finally { setLoading(false); }
  }

  async function cargarLimites() {
    if (!agenciaId) return;
    try {
      const [l, cat] = await Promise.all([getLimites(agenciaId), getCatalogoLoterias()]);
      setLimites(l);
      setCatalogo(cat);
    } catch {}
  }

  const loteriaSelec = catalogo.find(l => l.id === parseInt(formLimite.loteria_id));

  async function handleGuardarLimite(e) {
    e.preventDefault();
    if (!formLimite.animalito_id || !formLimite.monto_max) return;
    setSavingLimite(true);
    setLimiteMsg('');
    try {
      const payloadBase = {
        sorteo_id: formLimite.sorteo_id ? parseInt(formLimite.sorteo_id) : null,
        monto_max: parseFloat(formLimite.monto_max),
        monto_max_ticket: formLimite.monto_max_ticket ? parseFloat(formLimite.monto_max_ticket) : null,
        modo_accion: formLimite.modo_accion,
      };

      if (formLimite.animalito_id === 'todos') {
        const animalitos = loteriaSelec?.animalitos || [];
        for (let i = 0; i < animalitos.length; i++) {
          setLimiteMsg(`Guardando ${i + 1}/${animalitos.length}...`);
          await guardarLimite(agenciaId, { ...payloadBase, animalito_id: animalitos[i].id });
        }
        setLimiteMsg(`${animalitos.length} límites guardados (todos los animalitos de ${loteriaSelec?.nombre})`);
      } else {
        await guardarLimite(agenciaId, { ...payloadBase, animalito_id: parseInt(formLimite.animalito_id) });
        setLimiteMsg('Límite guardado');
      }

      setFormLimite({ loteria_id: '', animalito_id: '', sorteo_id: '', monto_max: '', monto_max_ticket: '', modo_accion: 'alertar' });
      cargarLimites();
    } catch (err) {
      setLimiteMsg('Error: ' + err.message);
    } finally {
      setSavingLimite(false);
    }
  }

  async function handleDesactivar(id) {
    if (!confirm('¿Desactivar este límite?')) return;
    try {
      await desactivarLimite(id);
      cargarLimites();
    } catch {}
  }

  async function handleEliminarLimitesLoteria(loteriaId, loteriaNombre) {
    if (!confirm(`¿Eliminar TODOS los límites configurados de "${loteriaNombre}"? Esta acción no se puede deshacer.`)) return;
    setBorrandoLimites(true);
    try {
      const r = await eliminarLimitesLoteria(agenciaId, loteriaId);
      setLimiteMsg(`${r.cantidad} límite(s) de ${loteriaNombre} eliminados`);
      cargarLimites();
    } catch (err) {
      setLimiteMsg('Error: ' + err.message);
    } finally {
      setBorrandoLimites(false);
    }
  }

  async function handleEliminarTodosLimites() {
    if (!confirm('¿Eliminar TODOS los límites de apuesta de la agencia, de todas las loterías? Esta acción no se puede deshacer.')) return;
    setBorrandoLimites(true);
    try {
      const r = await eliminarTodosLimites(agenciaId);
      setLimiteMsg(`${r.cantidad} límite(s) eliminados en total`);
      cargarLimites();
    } catch (err) {
      setLimiteMsg('Error: ' + err.message);
    } finally {
      setBorrandoLimites(false);
    }
  }

  async function cargarConfig() {
    try {
      const c = await getConfiguracion();
      setConfig(c);
      setWhatsappPagos(c.whatsapp_pagos_digitales || '');
    } catch {}
  }

  async function handleGuardarConfig(e) {
    e.preventDefault();
    setSavingConfig(true);
    setConfigMsg('');
    try {
      await guardarConfiguracion({ whatsapp_pagos_digitales: whatsappPagos });
      setConfigMsg('Configuración guardada');
      cargarConfig();
    } catch (err) {
      setConfigMsg('Error: ' + err.message);
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleConsultarBorrado() {
    setConsultandoBorrado(true);
    setBorradoMsg('');
    setBorradoConteo(null);
    try {
      setBorradoConteo(await getConteoBorrado(borradoDesde, borradoHasta));
    } catch (err) {
      setBorradoMsg('Error: ' + err.message);
    } finally {
      setConsultandoBorrado(false);
    }
  }

  async function handleEjecutarBorrado() {
    if (borradoTexto !== 'CONFIRMAR BORRADO') return;
    if (!confirm('Última confirmación: esto borrará permanentemente las ventas del rango seleccionado. ¿Continuar?')) return;
    setBorrandoDatos(true);
    setBorradoMsg('');
    try {
      const r = await ejecutarBorrado(borradoDesde, borradoHasta, borradoTexto);
      setBorradoMsg(`Eliminado: ${r.ventas} ventas, ${r.jugadas} jugadas, ${r.tickets} tickets, ${r.pagos_premio} pagos de premio`);
      setBorradoConteo(null);
      setBorradoTexto('');
    } catch (err) {
      setBorradoMsg('Error: ' + err.message);
    } finally {
      setBorrandoDatos(false);
    }
  }

  async function cargarUsuarios() {
    try {
      setUsuarios(await getUsuarios());
    } catch {}
  }

  async function handleCrearUsuario(e) {
    e.preventDefault();
    setSavingUsuario(true);
    setUsuarioMsg('');
    try {
      await crearUsuario(formUsuario);
      setUsuarioMsg('Usuario creado');
      setFormUsuario({ nombre: '', usuario: '', clave: '', rol: 'vendedor', comision_porcentaje: 14, puede_confirmar_resultados: false });
      cargarUsuarios();
    } catch (err) {
      setUsuarioMsg('Error: ' + err.message);
    } finally {
      setSavingUsuario(false);
    }
  }

  function abrirEditar(u) {
    setUsuarioEditando(u);
    setFormEditar({ nombre: u.nombre, rol: u.rol, clave: '', comision_porcentaje: u.comision_porcentaje ?? 14, puede_confirmar_resultados: !!u.puede_confirmar_resultados });
    setEditarMsg('');
  }

  async function handleGuardarEdicion(e) {
    e.preventDefault();
    setSavingEditar(true);
    setEditarMsg('');
    try {
      const payload = {
        nombre: formEditar.nombre,
        rol: formEditar.rol,
        comision_porcentaje: formEditar.comision_porcentaje,
        puede_confirmar_resultados: formEditar.puede_confirmar_resultados,
      };
      if (formEditar.clave) payload.clave = formEditar.clave;
      await editarUsuario(usuarioEditando.id, payload);
      setUsuarioEditando(null);
      cargarUsuarios();
    } catch (err) {
      setEditarMsg('Error: ' + err.message);
    } finally {
      setSavingEditar(false);
    }
  }

  async function handleEliminarUsuario(u) {
    if (!confirm(`¿Eliminar al usuario "${u.nombre}"?`)) return;
    try {
      await eliminarUsuario(u.id);
      cargarUsuarios();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  const tabs = [
    { key: 'dia', label: 'Por día' },
    { key: 'loteria', label: 'Por lotería' },
    { key: 'vendedor', label: 'Por vendedor' },
    { key: 'limites', label: 'Límites' },
    ...(esAdmin ? [
      { key: 'usuarios', label: 'Usuarios' },
      { key: 'datos', label: 'Administración de datos' },
      { key: 'config', label: 'Configuración' },
    ] : []),
  ];

  return (
    <div className="page">
      <h1>Reportes</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm btn-inline ${tab === t.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && tab !== 'limites' && (
        <div className="loading"><div className="spinner"></div></div>
      )}

      {/* Por día */}
      {tab === 'dia' && (
        <div className="card">
          <div className="flex gap-8 mb-12 align-center" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Desde</label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Hasta</label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
          </div>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Jugadas</th>
                  <th>Total vendido</th>
                </tr>
              </thead>
              <tbody>
                {dataDia.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-muted">Sin datos</td></tr>
                ) : dataDia.map(r => (
                  <tr key={r.fecha}>
                    <td>{r.fecha}</td>
                    <td>{r.cantidad_jugadas}</td>
                    <td className="bold text-primary">{fmt(r.total_vendido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dataDia.length > 0 && (
            <div className="flex justify-between bold mt-12" style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 'var(--radius)' }}>
              <span>Total período</span>
              <span className="text-primary">{fmt(dataDia.reduce((s, r) => s + r.total_vendido, 0))}</span>
            </div>
          )}
        </div>
      )}

      {/* Por lotería */}
      {tab === 'loteria' && (
        <div className="card">
          <div className="field mb-12">
            <label>Fecha</label>
            <input type="date" value={fechaDetalle} onChange={e => setFechaDetalle(e.target.value)} />
          </div>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Lotería</th>
                  <th>Jugadas</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {dataLoteria.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-muted">Sin datos</td></tr>
                ) : dataLoteria.map((r, i) => (
                  <tr key={i}>
                    <td>{r.loteria}</td>
                    <td>{r.cantidad_jugadas}</td>
                    <td className="bold text-primary">{fmt(r.total_vendido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Por vendedor */}
      {tab === 'vendedor' && (
        <div className="card">
          <div className="field mb-12">
            <label>Fecha</label>
            <input type="date" value={fechaDetalle} onChange={e => setFechaDetalle(e.target.value)} />
          </div>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Jugadas</th>
                  <th>Total</th>
                  <th>Comisión</th>
                </tr>
              </thead>
              <tbody>
                {dataVendedor.length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-muted">Sin datos</td></tr>
                ) : dataVendedor.map((r, i) => (
                  <tr key={i}>
                    <td>{r.vendedor}</td>
                    <td>{r.cantidad_jugadas}</td>
                    <td className="bold text-primary">{fmt(r.total_vendido)}</td>
                    <td className="bold text-success">{fmt(r.comision_ganada)} <span className="text-muted text-sm">({r.comision_porcentaje}%)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Límites de apuesta */}
      {tab === 'limites' && (
        <>
          <div className="card">
            <h2>Nuevo límite de apuesta</h2>
            {limiteMsg && (
              <div className={`alert ${limiteMsg.startsWith('Error') ? 'alert-danger' : 'alert-success'}`}>
                {limiteMsg}
              </div>
            )}
            <form onSubmit={handleGuardarLimite}>
              <div className="field">
                <label>Lotería</label>
                <select value={formLimite.loteria_id} onChange={e => setFormLimite(f => ({ ...f, loteria_id: e.target.value, animalito_id: '', sorteo_id: '' }))}>
                  <option value="">-- Seleccionar --</option>
                  {catalogo.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </div>
              {loteriaSelec && (
                <>
                  <div className="field">
                    <label>Animalito</label>
                    <select value={formLimite.animalito_id} onChange={e => setFormLimite(f => ({ ...f, animalito_id: e.target.value }))}>
                      <option value="">-- Seleccionar --</option>
                      <option value="todos">🌐 Todos los animalitos ({loteriaSelec.animalitos.length})</option>
                      {loteriaSelec.animalitos.map(a => <option key={a.id} value={a.id}>{a.numero} - {a.nombre}</option>)}
                    </select>
                    {formLimite.animalito_id === 'todos' && (
                      <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                        Se creará un límite individual para cada uno de los {loteriaSelec.animalitos.length} animalitos de {loteriaSelec.nombre}.
                      </div>
                    )}
                  </div>
                  <div className="field">
                    <label>Sorteo (opcional — dejar vacío para todos)</label>
                    <select value={formLimite.sorteo_id} onChange={e => setFormLimite(f => ({ ...f, sorteo_id: e.target.value }))}>
                      <option value="">Todos los sorteos</option>
                      {loteriaSelec.sorteos.map(s => <option key={s.id} value={s.id}>{s.hora}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className="field">
                <label>Monto máximo acumulado en el sorteo</label>
                <input type="number" min="1" step="0.01" value={formLimite.monto_max} onChange={e => setFormLimite(f => ({ ...f, monto_max: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="field">
                <label>Monto máximo por jugada individual (opcional)</label>
                <input type="number" min="1" step="0.01" value={formLimite.monto_max_ticket} onChange={e => setFormLimite(f => ({ ...f, monto_max_ticket: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="field">
                <label>Acción al superar el límite</label>
                <select value={formLimite.modo_accion} onChange={e => setFormLimite(f => ({ ...f, modo_accion: e.target.value }))}>
                  <option value="alertar">Alertar (permite continuar)</option>
                  <option value="bloquear">Bloquear (rechaza la jugada)</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={savingLimite || !formLimite.animalito_id || !formLimite.monto_max}>
                {savingLimite ? 'Guardando...' : 'Guardar límite'}
              </button>
            </form>
          </div>

          <div className="card">
            <div className="flex justify-between align-center mb-12" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ marginBottom: 0 }}>Límites activos</h2>
              {limites.length > 0 && (
                <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                  {Array.from(new Map(limites.map(l => [l.loteria_id, l.loteria_nombre])).entries()).map(([loteriaId, nombre]) => (
                    <button
                      key={loteriaId}
                      className="btn btn-outline btn-sm btn-inline"
                      disabled={borrandoLimites}
                      onClick={() => handleEliminarLimitesLoteria(loteriaId, nombre)}
                    >
                      Eliminar límites de {nombre}
                    </button>
                  ))}
                  <button
                    className="btn btn-danger btn-sm btn-inline"
                    disabled={borrandoLimites}
                    onClick={handleEliminarTodosLimites}
                  >
                    Eliminar TODOS los límites
                  </button>
                </div>
              )}
            </div>
            {limites.length === 0 ? (
              <p className="text-muted text-sm">No hay límites configurados.</p>
            ) : (
              <div className="tabla-wrap">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Lotería</th>
                      <th>Animalito</th>
                      <th>Sorteo</th>
                      <th>Máx</th>
                      <th>Acción</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {limites.map(l => (
                      <tr key={l.id}>
                        <td>{l.loteria_nombre}</td>
                        <td>{l.animalito_numero} - {l.animalito_nombre}</td>
                        <td>{l.sorteo_hora || 'Todos'}</td>
                        <td>{fmt(l.monto_max)}</td>
                        <td>
                          <span className={`badge badge-${l.modo_accion === 'bloquear' ? 'danger' : 'warning'}`}>
                            {l.modo_accion}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-danger btn-sm btn-inline" onClick={() => handleDesactivar(l.id)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Usuarios (solo admin) */}
      {tab === 'usuarios' && esAdmin && (
        <>
          <div className="card">
            <h2>Nuevo usuario</h2>
            {usuarioMsg && (
              <div className={`alert ${usuarioMsg.startsWith('Error') ? 'alert-danger' : 'alert-success'}`}>
                {usuarioMsg}
              </div>
            )}
            <form onSubmit={handleCrearUsuario}>
              <div className="field">
                <label>Nombre</label>
                <input
                  type="text"
                  value={formUsuario.nombre}
                  onChange={e => setFormUsuario(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre completo"
                />
              </div>
              <div className="field">
                <label>Usuario</label>
                <input
                  type="text"
                  value={formUsuario.usuario}
                  onChange={e => setFormUsuario(f => ({ ...f, usuario: e.target.value }))}
                  placeholder="usuario de acceso"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label>Clave</label>
                <input
                  type="password"
                  value={formUsuario.clave}
                  onChange={e => setFormUsuario(f => ({ ...f, clave: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
              <div className="field">
                <label>Rol</label>
                <select value={formUsuario.rol} onChange={e => setFormUsuario(f => ({ ...f, rol: e.target.value }))}>
                  <option value="vendedor">Vendedor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field">
                <label>Comisión %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formUsuario.comision_porcentaje}
                  onChange={e => setFormUsuario(f => ({ ...f, comision_porcentaje: e.target.value }))}
                  placeholder="14"
                />
              </div>
              <div className="field">
                <label className="flex align-center gap-8" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formUsuario.puede_confirmar_resultados}
                    onChange={e => setFormUsuario(f => ({ ...f, puede_confirmar_resultados: e.target.checked }))}
                  />
                  Puede confirmar resultados automáticos
                </label>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingUsuario || !formUsuario.nombre || !formUsuario.usuario || !formUsuario.clave}
              >
                {savingUsuario ? 'Creando...' : 'Crear usuario'}
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Usuarios existentes</h2>
            {usuarios.length === 0 ? (
              <p className="text-muted text-sm">No hay usuarios.</p>
            ) : (
              <div className="tabla-wrap">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Usuario</th>
                      <th>Rol</th>
                      <th>Comisión</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map(u => (
                      <tr key={u.id}>
                        <td>{u.nombre}</td>
                        <td>{u.usuario}</td>
                        <td>
                          <span className={`badge badge-${u.rol === 'admin' ? 'info' : 'warning'}`}>
                            {u.rol}
                          </span>
                        </td>
                        <td>{u.comision_porcentaje}%</td>
                        <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
                        <td className="flex gap-8">
                          <button className="btn btn-outline btn-sm btn-inline" onClick={() => abrirEditar(u)}>
                            Editar
                          </button>
                          {u.id !== auth?.user?.id && (
                            <button className="btn btn-danger btn-sm btn-inline" onClick={() => handleEliminarUsuario(u)}>
                              Eliminar
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

          {usuarioEditando && (
            <div className="dialog-overlay" onClick={() => setUsuarioEditando(null)}>
              <div className="dialog" onClick={e => e.stopPropagation()}>
                <h2>Editar usuario</h2>
                {editarMsg && <div className="alert alert-danger">{editarMsg}</div>}
                <form onSubmit={handleGuardarEdicion}>
                  <div className="field">
                    <label>Nombre</label>
                    <input
                      type="text"
                      value={formEditar.nombre}
                      onChange={e => setFormEditar(f => ({ ...f, nombre: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Rol</label>
                    <select value={formEditar.rol} onChange={e => setFormEditar(f => ({ ...f, rol: e.target.value }))}>
                      <option value="vendedor">Vendedor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Comisión %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formEditar.comision_porcentaje}
                      onChange={e => setFormEditar(f => ({ ...f, comision_porcentaje: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Nueva clave (opcional — dejar vacío para no cambiarla)</label>
                    <input
                      type="password"
                      value={formEditar.clave}
                      onChange={e => setFormEditar(f => ({ ...f, clave: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="field">
                    <label className="flex align-center gap-8" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formEditar.puede_confirmar_resultados}
                        onChange={e => setFormEditar(f => ({ ...f, puede_confirmar_resultados: e.target.checked }))}
                      />
                      Puede confirmar resultados automáticos
                    </label>
                  </div>
                  <div className="dialog-actions">
                    <button type="button" className="btn btn-outline" onClick={() => setUsuarioEditando(null)}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={savingEditar}>
                      {savingEditar ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* Administración de datos (solo admin) */}
      {tab === 'datos' && esAdmin && (
        <div className="card">
          <h2>Eliminar ventas de un rango de fechas</h2>
          <p className="text-muted text-sm mb-12">
            Pensado para limpiar datos de prueba. Elimina en cascada ventas, jugadas, tickets y pagos de premio
            del rango seleccionado. Una venta solo se elimina si TODAS sus jugadas caen dentro del rango.
          </p>
          {borradoMsg && (
            <div className={`alert ${borradoMsg.startsWith('Error') ? 'alert-danger' : 'alert-success'}`}>
              {borradoMsg}
            </div>
          )}
          <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Desde</label>
              <input type="date" value={borradoDesde} onChange={e => { setBorradoDesde(e.target.value); setBorradoConteo(null); }} />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Hasta</label>
              <input type="date" value={borradoHasta} onChange={e => { setBorradoHasta(e.target.value); setBorradoConteo(null); }} />
            </div>
          </div>
          <button className="btn btn-outline" onClick={handleConsultarBorrado} disabled={consultandoBorrado}>
            {consultandoBorrado ? 'Consultando...' : 'Ver cuántos registros se eliminarían'}
          </button>

          {borradoConteo && (
            <>
              <div className="alert alert-warning" style={{ marginTop: 12 }}>
                Se eliminarán: <strong>{borradoConteo.ventas}</strong> ventas, <strong>{borradoConteo.jugadas}</strong> jugadas,{' '}
                <strong>{borradoConteo.tickets}</strong> tickets y <strong>{borradoConteo.pagos_premio}</strong> pagos de premio.
              </div>
              {borradoConteo.jugadas > 0 && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Escribe "CONFIRMAR BORRADO" para habilitar el botón</label>
                  <input
                    type="text"
                    value={borradoTexto}
                    onChange={e => setBorradoTexto(e.target.value)}
                    placeholder="CONFIRMAR BORRADO"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              )}
              <button
                className="btn btn-danger"
                style={{ marginTop: 8 }}
                disabled={borradoTexto !== 'CONFIRMAR BORRADO' || borrandoDatos || borradoConteo.jugadas === 0}
                onClick={handleEjecutarBorrado}
              >
                {borrandoDatos ? 'Eliminando...' : '🗑️ Eliminar definitivamente'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Configuración (solo admin) */}
      {tab === 'config' && esAdmin && (
        <div className="card">
          <h2>Configuración</h2>
          {configMsg && (
            <div className={`alert ${configMsg.startsWith('Error') ? 'alert-danger' : 'alert-success'}`}>
              {configMsg}
            </div>
          )}
          <form onSubmit={handleGuardarConfig}>
            <div className="field">
              <label>WhatsApp del responsable de pagos digitales</label>
              <input
                type="text"
                value={whatsappPagos}
                onChange={e => setWhatsappPagos(e.target.value)}
                placeholder="Ej: 584121234567 (con código de país, sin + ni espacios)"
              />
              <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                A este número se dirigirá el mensaje de WhatsApp cuando se confirme un pago de premio por Pago Móvil o Biopago.
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={savingConfig}>
              {savingConfig ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

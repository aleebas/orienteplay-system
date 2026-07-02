import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCatalogoLoterias, validarJugadas, registrarVenta, getVenta, imprimirTicket, getTasaBCV } from '../api/cliente';
import SelectorAnimalito, { EMOJI_MAP, LOTERIA_SLUG_IMAGEN } from '../components/SelectorAnimalito';
import Comprobante from '../components/Comprobante';
import BotonWhatsApp from '../components/BotonWhatsApp';
import { hora12, fmt } from '../utils/formato';

const TODAY = () => new Date().toISOString().slice(0, 10);

function sorteoAbierto(sorteo) {
  const ahora = new Date();
  const [h, m] = sorteo.hora.split(':').map(Number);
  const horaSorteo = new Date(ahora);
  horaSorteo.setHours(h, m, 0, 0);
  const cierre = new Date(horaSorteo.getTime() - (sorteo.minutos_cierre_previo ?? 5) * 60000);
  return ahora < cierre;
}

const normNum = s => s.replace(/^0+/, '') || s;

export default function Venta() {
  const { auth, caja } = useAuth();
  const navigate = useNavigate();
  const comprobanteRef = useRef(null);
  const nuevaVentaRef = useRef(null);
  const inputNumeroRef = useRef(null);
  const montoRefs = useRef({});

  const [catalogo, setCatalogo] = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(true);

  // 0=loteria, 1=sorteo, 2=modo(manual), 3=jugada-builder
  const [step, setStep] = useState(0);
  const [modoSkipped, setModoSkipped] = useState(false);
  const [loteria, setLoteria] = useState(null);
  const [sorteo, setSorteo] = useState(null);
  const [modo, setModo] = useState(null);

  // Selección multi-directo: {id: {animalito, monto}}
  const [selecMulti, setSelecMulti] = useState({});
  const [inputNumero, setInputNumero] = useState('');
  const [errorNumero, setErrorNumero] = useState('');

  // Selección tripleta
  const [animTripleta, setAnimTripleta] = useState([]);
  const [montoTripleta, setMontoTripleta] = useState('');

  const [alertas, setAlertas] = useState([]);
  const [error, setError] = useState('');

  const [carrito, setCarrito] = useState([]);
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');
  const [metodoPago, setMetodoPago] = useState('efectivo');

  const [tasaBCV, setTasaBCV] = useState(null);
  const [montoUSD, setMontoUSD] = useState('');

  const [loadingAgregar, setLoadingAgregar] = useState(false);
  const [loadingConfirmar, setLoadingConfirmar] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [ventaConfirmada, setVentaConfirmada] = useState(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [errorImprimir, setErrorImprimir] = useState('');

  // ── Carga catálogo ────────────────────────────────────────
  useEffect(() => {
    if (!caja) { navigate('/caja'); return; }
    getCatalogoLoterias()
      .then(setCatalogo)
      .catch(() => setError('No se pudo cargar el catálogo'))
      .finally(() => setLoadingCatalogo(false));
  }, [caja, navigate]);

  // ── Tasa BCV para el conversor USD → Bs ───────────────────
  useEffect(() => {
    getTasaBCV().then(r => setTasaBCV(r.tasa)).catch(() => {});
  }, []);

  // ── Focus "Nueva venta" al mostrar comprobante ────────────
  useEffect(() => {
    if (ventaConfirmada) nuevaVentaRef.current?.focus();
  }, [ventaConfirmada]);

  // ── Reset helpers ─────────────────────────────────────────
  function resetJugada() {
    setSelecMulti({}); setAnimTripleta([]); setMontoTripleta('');
    setInputNumero(''); setErrorNumero(''); setAlertas([]); setError('');
  }

  function resetParaNuevaLoteria() {
    setStep(0); setModoSkipped(false);
    setLoteria(null); setSorteo(null); setModo(null);
    resetJugada();
  }

  const handleNuevaVenta = useCallback(() => {
    setVentaConfirmada(null);
    setStep(0); setModoSkipped(false);
    setLoteria(null); setSorteo(null); setModo(null);
    setSelecMulti({}); setAnimTripleta([]); setMontoTripleta('');
    setInputNumero(''); setErrorNumero(''); setAlertas([]); setError('');
  }, []);

  async function handleImprimir() {
    setImprimiendo(true);
    setErrorImprimir('');
    try {
      await imprimirTicket(ventaConfirmada, auth?.user?.agencia_nombre);
    } catch (err) {
      setErrorImprimir(err.message || 'No se pudo imprimir el ticket');
    } finally {
      setImprimiendo(false);
    }
  }

  // ── Selección de lotería ──────────────────────────────────
  function selecLoteria(lot) {
    setLoteria(lot); setSorteo(null); setModo(null); setModoSkipped(false);
    resetJugada(); setStep(1);
  }

  // ── Selección de sorteo (auto-selecciona modo directo) ────
  function selecSorteo(s) {
    setSorteo(s); resetJugada();
    const directo = loteria?.modos_juego?.find(m => m.slug === 'directo');
    if (directo) {
      setModo(directo); setModoSkipped(true); setStep(3);
    } else {
      setModoSkipped(false); setStep(2);
    }
  }

  function selecModo(m) {
    setModo(m); resetJugada(); setStep(3);
  }

  function toggleAnimMulti(a) {
    setSelecMulti(prev => {
      if (prev[a.id]) {
        const next = { ...prev };
        delete next[a.id];
        return next;
      }
      return { ...prev, [a.id]: { animalito: a, monto: '' } };
    });
  }

  // ── Input rápido: ciclo número→monto→número ───────────────
  function handleInputNumero(e) {
    if (e.key !== 'Enter') return;
    const val = inputNumero.trim();
    if (!val) return;
    const anim = loteria?.animalitos?.find(a =>
      normNum(a.numero) === normNum(val)
    );
    if (!anim) {
      setErrorNumero(`"${val}" no encontrado`);
      return;
    }
    setInputNumero('');
    if (selecMulti[anim.id]) {
      setErrorNumero('Ya agregado');
      return;
    }
    setErrorNumero('');
    setSelecMulti(prev => ({ ...prev, [anim.id]: { animalito: anim, monto: '' } }));
    setTimeout(() => montoRefs.current[anim.id]?.focus(), 50);
  }

  // ── Agregar jugadas multi-directo ─────────────────────────
  async function handleAgregarDirecto() {
    const items = Object.values(selecMulti).filter(x => parseFloat(x.monto) > 0);
    if (items.length === 0) { setError('Ingresa monto para al menos un animalito'); return; }
    setError(''); setAlertas([]); setLoadingAgregar(true);

    const hoy = TODAY();
    const jugadasVal = items.map(x => ({
      sorteo_id: sorteo.id,
      modo_juego_id: modo.id,
      animalito_ids: [x.animalito.id],
      monto: parseFloat(x.monto),
      fecha_sorteo: hoy,
    }));

    try {
      const val = await validarJugadas(jugadasVal);

      const bloqueada = val.resultados.find(r => !r.ok && r.bloqueadoPorLimite);
      if (bloqueada) { setError(bloqueada.error || 'Venta bloqueada por límite'); setLoadingAgregar(false); return; }

      const conError = val.resultados.find(r => !r.ok);
      if (conError) { setError(conError.error || 'Jugada no válida'); setLoadingAgregar(false); return; }

      const nuevasAlertas = [];
      val.resultados.forEach((r, idx) => {
        const rev = (r.revisiones || []).filter(rv => rv.motivo && !rv.bloqueado);
        if (rev.length > 0) {
          nuevasAlertas.push(`⚠️ ${items[idx].animalito.nombre} al ${rev[0].porcentaje_usado}% del cupo`);
        }
      });
      if (nuevasAlertas.length > 0) setAlertas(nuevasAlertas);

      const nuevas = items.map(x => ({
        _key: Date.now() + Math.random(),
        sorteo_id: sorteo.id, modo_juego_id: modo.id,
        animalito_ids: [x.animalito.id], monto: parseFloat(x.monto), fecha_sorteo: hoy,
        _loteria_nombre: loteria.nombre, _sorteo_hora: sorteo.hora,
        _modo_nombre: modo.nombre, _animalitos: [x.animalito], _multiplicador: modo.multiplicador,
      }));

      setCarrito(prev => [...prev, ...nuevas]);
      setSelecMulti({});
      setTimeout(() => inputNumeroRef.current?.focus(), 50);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAgregar(false);
    }
  }

  function toggleAnimTripleta(a) {
    setAnimTripleta(prev => {
      const idx = prev.findIndex(x => x.id === a.id);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      if (prev.length >= 3) return prev;
      return [...prev, a];
    });
  }

  async function handleAgregarTripleta() {
    if (animTripleta.length < 3) { setError('Selecciona 3 animalitos'); return; }
    if (!montoTripleta || parseFloat(montoTripleta) <= 0) { setError('Ingresa el monto'); return; }
    setError(''); setAlertas([]); setLoadingAgregar(true);

    const hoy = TODAY();
    const jugada = {
      sorteo_id: sorteo.id, modo_juego_id: modo.id,
      animalito_ids: animTripleta.map(a => a.id),
      monto: parseFloat(montoTripleta), fecha_sorteo: hoy,
    };

    try {
      const val = await validarJugadas([jugada]);
      const res = val.resultados[0];
      if (!res.ok) { setError(res.error || 'Jugada no válida'); setLoadingAgregar(false); return; }

      const revAlertas = (res.revisiones || []).filter(r => r.motivo && !r.bloqueado);
      if (revAlertas.length > 0) setAlertas(revAlertas.map(r => `⚠️ ${r.motivo}`));

      setCarrito(prev => [...prev, {
        _key: Date.now(),
        sorteo_id: sorteo.id, modo_juego_id: modo.id,
        animalito_ids: animTripleta.map(a => a.id),
        monto: parseFloat(montoTripleta), fecha_sorteo: hoy,
        _loteria_nombre: loteria.nombre, _sorteo_hora: sorteo.hora,
        _modo_nombre: modo.nombre, _animalitos: [...animTripleta], _multiplicador: modo.multiplicador,
      }]);
      resetJugada();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAgregar(false);
    }
  }

  async function confirmarVenta(forzar = false) {
    if (carrito.length === 0) return;
    setError(''); setLoadingConfirmar(true); setConfirmDialog(null);

    const payload = {
      caja_id: caja.id,
      cliente_nombre: clienteNombre || undefined,
      cliente_telefono: clienteTelefono || undefined,
      forzar_aunque_alerte: forzar,
      metodo_pago: metodoPago,
      jugadas: carrito.map(item => ({
        sorteo_id: item.sorteo_id, modo_juego_id: item.modo_juego_id,
        animalito_ids: item.animalito_ids, monto: item.monto, fecha_sorteo: item.fecha_sorteo,
      })),
    };

    try {
      const res = await registrarVenta(payload);
      if (res.requiere_confirmacion) {
        setConfirmDialog({ mensaje: res.mensaje }); setLoadingConfirmar(false); return;
      }
      const ventaCompleta = await getVenta(res.codigo_venta);
      setVentaConfirmada(ventaCompleta);
      setCarrito([]); setClienteNombre(''); setClienteTelefono('');
    } catch (err) {
      if (err.status === 409 && err.data?.detalle?.bloqueadoPorLimite) {
        setError(`Bloqueado por límite: ${err.data.detalle.error}`);
      } else {
        setError(err.message || 'Error al registrar la venta');
      }
    } finally {
      setLoadingConfirmar(false);
    }
  }

  // ══════════════════════════════════════════════════════════
  // RENDER: Comprobante post-venta
  // ══════════════════════════════════════════════════════════
  if (ventaConfirmada) {
    return (
      <div className="page" style={{ maxWidth: 420 }}>
        <div className="alert alert-success">✅ Venta registrada con éxito</div>
        <div className="comprobante-print-wrapper">
          <Comprobante
            ref={comprobanteRef}
            ventaData={ventaConfirmada}
            agenciaNombre={auth?.user?.agencia_nombre}
          />
        </div>
        <div className="venta-comprobante-acciones" style={{ maxWidth: 340, margin: '12px auto 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button ref={nuevaVentaRef} className="btn btn-accent" onClick={handleNuevaVenta}>
            + Nueva venta
          </button>
          {errorImprimir && <div className="alert alert-danger">{errorImprimir}</div>}
          <button className="btn btn-outline" onClick={handleImprimir} disabled={imprimiendo}>
            {imprimiendo ? '⟳ Imprimiendo...' : '🖨 Imprimir comprobante'}
          </button>
          <BotonWhatsApp
            comprobanteRef={comprobanteRef}
            ventaData={ventaConfirmada}
            agenciaNombre={auth?.user?.agencia_nombre}
            telefono={ventaConfirmada.venta.cliente_telefono}
          />
        </div>
      </div>
    );
  }

  if (loadingCatalogo) {
    return <div className="loading"><div className="spinner"></div><br />Cargando catálogo...</div>;
  }

  const esDirecto = modo?.slug === 'directo';
  const esTripleta = modo && !esDirecto;
  const totalSelecMulti = Object.values(selecMulti).reduce((s, x) => s + (parseFloat(x.monto) || 0), 0);
  const totalCarrito = carrito.reduce((s, i) => s + i.monto, 0);
  const stepperActivo = step === 0 ? 0 : step === 1 ? 1 : 2;
  const STEPPER = ['Lotería', 'Sorteo', 'Jugada'];

  return (
    <div className="venta-page">
      {confirmDialog && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>⚠️ Confirmar venta</h2>
            <p className="mb-12">{confirmDialog.mensaje}</p>
            <div className="alert alert-warning">
              Una o más jugadas superan el límite de banca. ¿Continuar de todas formas?
            </div>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => setConfirmDialog(null)}>Revisar</button>
              <button className="btn btn-warning" onClick={() => confirmarVenta(true)}>Confirmar igual</button>
            </div>
          </div>
        </div>
      )}

      <div className="venta-layout">
        <div className="venta-main">
          <div className="card">
            {/* ── Stepper ── */}
            <div className="stepper">
              {STEPPER.map((s, i) => (
                <div key={i} className="step-item">
                  <div className={`step-circle ${i < stepperActivo ? 'done' : i === stepperActivo ? 'active' : ''}`}>
                    {i < stepperActivo ? '✓' : i + 1}
                  </div>
                  <span className={`step-label ${i === stepperActivo ? 'active' : ''}`}>{s}</span>
                  {i < STEPPER.length - 1 && <span className="step-sep">›</span>}
                </div>
              ))}
            </div>

            {/* ── Paso 0: Lotería ── */}
            {step === 0 && (
              <>
                <h3>Selecciona la Lotería</h3>
                <div className="loteria-grid">
                  {catalogo.map(lot => {
                    // Mapear nombre a archivo de logo
                    const logoMap = {
                      'Lotto Activo': 'lotto_activo.webp',
                      'La Granjita': 'la_granjita.webp',
                      'Ruleta Activa': 'ruleta_activa.jpeg',
                      'Selva Plus': 'selva_plus.webp',
                      'Guacharo Activo': 'guacharo_activo.webp',
                    };
                    const logoFile = logoMap[lot.nombre] || 'lotto_activo.webp';
                    return (
                      <div
                        key={lot.id}
                        className={`loteria-card${loteria?.id === lot.id ? ' selected' : ''}`}
                        onClick={() => selecLoteria(lot)}
                      >
                        <img
                          src={`/loterias/${logoFile}`}
                          alt={lot.nombre}
                          className="loteria-icon"
                          style={{ height: '60px', objectFit: 'contain', marginBottom: '4px' }}
                        />
                        <div className="loteria-name">{lot.nombre}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Breadcrumb (pasos 1+) ── */}
            {step >= 1 && loteria && (
              <div
                className="flex align-center gap-8 mb-12"
                style={{ fontSize: '0.85rem', cursor: 'pointer', color: 'var(--primary)', flexWrap: 'wrap' }}
                onClick={() => { setStep(0); resetJugada(); setSorteo(null); setModo(null); }}
              >
                <span>🎰 <strong>{loteria.nombre}</strong></span>
                {sorteo && <><span className="text-muted">·</span><span>⏰ {hora12(sorteo.hora)}</span></>}
                {modo && (
                  <><span className="text-muted">·</span><span>🎲 {modo.nombre}</span>
                    {step >= 3 && (
                      <span
                        className="cambiar-modo-link"
                        onClick={e => { e.stopPropagation(); resetJugada(); setStep(2); setModo(null); setModoSkipped(false); }}
                      >
                        cambiar modo
                      </span>
                    )}
                  </>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>cambiar ›</span>
              </div>
            )}

            {/* ── Paso 1: Sorteo ── */}
            {step === 1 && (
              <>
                <h3>Selecciona el Sorteo</h3>
                <div className="sorteo-grid">
                  {loteria.sorteos.map(s => {
                    const abierto = sorteoAbierto(s);
                    return (
                      <button
                        key={s.id}
                        className={`sorteo-btn${sorteo?.id === s.id ? ' selected' : ''}`}
                        disabled={!abierto}
                        onClick={() => selecSorteo(s)}
                      >
                        {hora12(s.hora)}
                        {!abierto && <span className="sorteo-cerrado">Cerrado</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Paso 2: Modo (solo si no fue auto-seleccionado) ── */}
            {step === 2 && !modoSkipped && (
              <>
                <h3>Modo de Juego</h3>
                <div className="modo-grid">
                  {loteria.modos_juego.map(m => (
                    <div key={m.id} className={`modo-card${modo?.id === m.id ? ' selected' : ''}`} onClick={() => selecModo(m)}>
                      <div className="modo-nombre">{m.nombre}</div>
                      <div className="modo-mult">Paga x{m.multiplicador}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Paso 3: Jugada builder ── */}
            {step >= 3 && modo && (
              <>
                {alertas.map((a, i) => <div key={i} className="alert alert-warning">{a}</div>)}
                {error && <div className="alert alert-danger">{error}</div>}

                {/* ─ Modo DIRECTO ─ */}
                {esDirecto && (
                  <div className="jugada-builder">
                    <div className="jugada-tablero">
                      <h3 style={{ marginBottom: 8 }}>Elige animalito(s)</h3>
                      <div className="numero-rapido-wrap">
                        <input
                          ref={inputNumeroRef}
                          className="numero-rapido"
                          type="text"
                          value={inputNumero}
                          onChange={e => { setInputNumero(e.target.value); setErrorNumero(''); }}
                          onKeyDown={handleInputNumero}
                          placeholder="Buscar por N° (ej: 06, 12) y presiona Enter"
                        />
                        {errorNumero && <span className="numero-error">{errorNumero}</span>}
                      </div>
                      <SelectorAnimalito
                        animalitos={loteria.animalitos}
                        seleccionados={Object.values(selecMulti).map(x => x.animalito)}
                        cantidad={1}
                        onSelect={toggleAnimMulti}
                        limitarSeleccion={false}
                        loteriaSlug={LOTERIA_SLUG_IMAGEN[loteria.slug]}
                      />
                    </div>

                    <div className="jugada-seleccion">
                      <h3 style={{ marginBottom: 8, fontSize: '0.9rem' }}>Jugadas</h3>
                      {Object.keys(selecMulti).length === 0 ? (
                        <div className="multi-empty">Toca un animalito<br />para agregarlo aquí</div>
                      ) : (
                        Object.values(selecMulti).map(({ animalito, monto }) => (
                          <div key={animalito.id} className="multi-anim-item">
                            <div className="multi-anim-info">
                              <span className="multi-anim-emoji">{EMOJI_MAP[animalito.nombre] || '🐾'}</span>
                              <span className="multi-anim-label">{animalito.nombre}</span>
                              <span className="multi-anim-sub">#{animalito.numero}</span>
                            </div>
                            <input
                              ref={el => montoRefs.current[animalito.id] = el}
                              className="multi-anim-monto"
                              type="number"
                              min="1"
                              step="0.01"
                              placeholder="Bs."
                              value={monto}
                              onChange={e => setSelecMulti(prev => ({
                                ...prev,
                                [animalito.id]: { ...prev[animalito.id], monto: e.target.value },
                              }))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  setTimeout(() => inputNumeroRef.current?.focus(), 30);
                                }
                              }}
                            />
                            <button className="multi-anim-del" onClick={() => toggleAnimMulti(animalito)}>✕</button>
                          </div>
                        ))
                      )}

                      {Object.keys(selecMulti).length > 0 && (
                        <>
                          <div className="multi-total">Total: {fmt(totalSelecMulti)}</div>
                          <button
                            className="btn btn-primary"
                            style={{ marginTop: 8, fontSize: '0.85rem', minHeight: 40 }}
                            onClick={handleAgregarDirecto}
                            disabled={loadingAgregar || totalSelecMulti <= 0}
                          >
                            {loadingAgregar ? 'Validando...' : '+ Agregar al carrito'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* ─ Modo TRIPLETA ─ */}
                {esTripleta && (
                  <>
                    <h3 style={{ marginBottom: 8 }}>
                      Selecciona 3 animalitos ({animTripleta.length}/3)
                    </h3>
                    <SelectorAnimalito
                      animalitos={loteria.animalitos}
                      seleccionados={animTripleta}
                      cantidad={3}
                      onSelect={toggleAnimTripleta}
                      limitarSeleccion={true}
                      loteriaSlug={LOTERIA_SLUG_IMAGEN[loteria.slug]}
                    />
                    {animTripleta.length === 3 && (
                      <div className="field mt-8">
                        <label>Monto a apostar (Tripleta paga x{modo.multiplicador})</label>
                        <input
                          type="number" min="1" step="0.01"
                          value={montoTripleta}
                          onChange={e => setMontoTripleta(e.target.value)}
                          placeholder="0.00" autoFocus
                          onKeyDown={e => e.key === 'Enter' && handleAgregarTripleta()}
                        />
                        {montoTripleta && (
                          <p className="text-muted text-sm mt-8">
                            Premio potencial: <strong className="text-success">{fmt(parseFloat(montoTripleta) * modo.multiplicador)}</strong>
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      className="btn btn-primary mt-8"
                      onClick={handleAgregarTripleta}
                      disabled={loadingAgregar || animTripleta.length < 3 || !montoTripleta}
                    >
                      {loadingAgregar ? 'Validando...' : '+ Agregar tripleta al carrito'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Carrito lateral ── */}
        {carrito.length > 0 && (
          <div className="venta-sidebar">
            <div className="card">
              <h2 style={{ marginBottom: 12 }}>
                Carrito ({carrito.length} jugada{carrito.length !== 1 ? 's' : ''})
              </h2>

              {carrito.map((item, idx) => (
                <div key={item._key} className="carrito-item">
                  <div className="carrito-info">
                    <div className="carrito-titulo">
                      {item._animalitos.map(a => `${EMOJI_MAP[a.nombre] || '🐾'} ${a.nombre}`).join(' + ')}
                    </div>
                    <div className="carrito-meta">
                      {item._loteria_nombre} · {hora12(item._sorteo_hora)} · {item._modo_nombre}
                    </div>
                  </div>
                  <div className="carrito-monto">{fmt(item.monto)}</div>
                  <button className="carrito-del" onClick={() => setCarrito(c => c.filter((_, i) => i !== idx))}>✕</button>
                </div>
              ))}

              <div className="carrito-total-wrap">
                <span className="carrito-total-label">Total</span>
                <span className="carrito-total-monto">{fmt(totalCarrito)}</span>
              </div>

              {tasaBCV != null && (
                <div className="field">
                  <label>Convertir USD → Bs (tasa BCV: {tasaBCV.toFixed(2)})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={montoUSD}
                    onChange={e => setMontoUSD(e.target.value)}
                    placeholder="0.00"
                    style={{ minHeight: 40 }}
                  />
                  {montoUSD && (
                    <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                      = {fmt(parseFloat(montoUSD) * tasaBCV)}
                    </div>
                  )}
                </div>
              )}

              <div className="field">
                <label>Cliente {metodoPago === 'credito' ? '(requerido para crédito)' : '(opcional)'}</label>
                <input type="text" value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre" style={{ minHeight: 40 }} />
              </div>
              <div className="field">
                <label>Teléfono {metodoPago === 'credito' ? '(requerido para crédito)' : 'WhatsApp (opcional)'}</label>
                <input type="tel" value={clienteTelefono} onChange={e => setClienteTelefono(e.target.value)} placeholder="04121234567" style={{ minHeight: 40 }} />
              </div>

              <div className="field">
                <label>Forma de pago</label>
                <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="pago_movil">Pago Móvil</option>
                  <option value="biopago">Biopago</option>
                  <option value="credito">A crédito</option>
                </select>
              </div>

              {metodoPago === 'credito' && (
                <div className="alert alert-warning">
                  Esta venta quedará pendiente de cobro. Se necesita nombre y teléfono del cliente para poder ubicarlo después.
                </div>
              )}

              {error && !loadingAgregar && <div className="alert alert-danger">{error}</div>}

              <button
                className="btn btn-accent"
                onClick={() => confirmarVenta(false)}
                disabled={loadingConfirmar || (metodoPago === 'credito' && (!clienteNombre || !clienteTelefono))}
              >
                {loadingConfirmar ? 'Registrando...' : '✓ Confirmar venta'}
              </button>

              {(!modo || esDirecto) && (
                <button
                  className="btn btn-outline btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={resetParaNuevaLoteria}
                >
                  + Agregar otra lotería
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

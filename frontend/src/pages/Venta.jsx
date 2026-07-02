import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const comprobanteRef = useRef(null);
  const nuevaVentaRef = useRef(null);
  const inputNumeroRef = useRef(null);
  const montoRefs = useRef({});
  const repetirAplicadoRef = useRef(false);

  const [catalogo, setCatalogo] = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(true);

  // 0=loteria, 1=sorteo, 2=modo(manual), 3=jugada-builder
  const [step, setStep] = useState(0);
  const [modoSkipped, setModoSkipped] = useState(false);
  const [loteria, setLoteria] = useState(null);
  const [sorteo, setSorteo] = useState(null);
  const [modo, setModo] = useState(null);

  // Selección múltiple de horarios: marcar varios sorteos de la misma
  // lotería para replicar la misma jugada en todos. Con multiHorario en
  // false (default) el flujo de un solo horario es exactamente el de
  // siempre -- esto es puramente aditivo.
  const [multiHorario, setMultiHorario] = useState(false);
  const [horariosSelec, setHorariosSelec] = useState([]);
  // Aplicar la misma jugada armada a otra lotería, sin rehacer la
  // selección de animalito/monto. null = panel cerrado.
  const [repetirOtraLoteria, setRepetirOtraLoteria] = useState(null);

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

  // ── Prefill "Repetir jugada" desde Tickets ────────────────
  // Precarga lotería/modo/animalito(s)/monto de un ticket viejo y deja
  // al usuario directo en el selector de horarios (multiHorario) para
  // que solo elija las próximas horas y confirme.
  useEffect(() => {
    const repetir = location.state?.repetir;
    if (!repetir || repetirAplicadoRef.current || catalogo.length === 0) return;
    repetirAplicadoRef.current = true;

    const lot = catalogo.find(l => l.id === repetir.loteria_id);
    if (!lot) {
      setError('La lotería de este ticket ya no está disponible');
      return;
    }
    const modoObj = lot.modos_juego.find(m => m.slug === repetir.modo_slug);
    if (!modoObj) {
      setError(`${lot.nombre} ya no tiene el modo de juego de esta jugada`);
      return;
    }
    const resueltos = repetir.animalitos
      .map(x => lot.animalitos.find(a => a.numero === x.numero))
      .filter(Boolean);
    if (resueltos.length !== repetir.animalitos.length) {
      setError('No se pudieron reconocer todos los animalitos de ese ticket');
      return;
    }

    setLoteria(lot);
    setModo(modoObj);
    setModoSkipped(modoObj.slug === 'directo');
    if (modoObj.slug === 'directo') {
      setSelecMulti(Object.fromEntries(resueltos.map(a => [a.id, { animalito: a, monto: String(repetir.monto) }])));
    } else {
      setAnimTripleta(resueltos);
      setMontoTripleta(String(repetir.monto));
    }
    setMultiHorario(true);
    setStep(1);
    navigate(location.pathname, { replace: true, state: null });
  }, [catalogo, location.pathname, location.state, navigate]);

  // ── Focus "Nueva venta" al mostrar comprobante ────────────
  useEffect(() => {
    if (ventaConfirmada) nuevaVentaRef.current?.focus();
  }, [ventaConfirmada]);

  // ── Reset helpers ─────────────────────────────────────────
  function resetJugada() {
    setSelecMulti({}); setAnimTripleta([]); setMontoTripleta('');
    setInputNumero(''); setErrorNumero(''); setAlertas([]); setError('');
    setRepetirOtraLoteria(null);
  }

  function resetParaNuevaLoteria() {
    setStep(0); setModoSkipped(false);
    setLoteria(null); setSorteo(null); setModo(null);
    setMultiHorario(false); setHorariosSelec([]);
    resetJugada();
  }

  const handleNuevaVenta = useCallback(() => {
    setVentaConfirmada(null);
    setStep(0); setModoSkipped(false);
    setLoteria(null); setSorteo(null); setModo(null);
    setMultiHorario(false); setHorariosSelec([]); setRepetirOtraLoteria(null);
    setSelecMulti({}); setAnimTripleta([]); setMontoTripleta('');
    setInputNumero(''); setErrorNumero(''); setAlertas([]); setError('');
  }, []);

  async function handleImprimir() {
    setImprimiendo(true);
    setErrorImprimir('');
    try {
      await imprimirTicket(ventaConfirmada, auth?.user?.agencia_nombre);
    } catch (err) {
      if (err.status === 503) {
        // Sin impresora térmica USB en este servidor (entorno cloud) --
        // usar el diálogo de impresión del navegador sobre el comprobante
        // ya renderizado (ver @media print en index.css).
        window.print();
      } else {
        setErrorImprimir(err.message || 'No se pudo imprimir el ticket');
      }
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
  function avanzarDesdeSorteo(s) {
    setSorteo(s); resetJugada();
    const directo = loteria?.modos_juego?.find(m => m.slug === 'directo');
    if (directo) {
      setModo(directo); setModoSkipped(true); setStep(3);
    } else {
      setModoSkipped(false); setStep(2);
    }
  }

  function selecSorteo(s) {
    avanzarDesdeSorteo(s);
  }

  // ── Selección múltiple de horarios (feature: repetir jugada) ──
  function toggleMultiHorario() {
    setMultiHorario(prev => !prev);
    setHorariosSelec([]);
  }

  function toggleHorarioMulti(s) {
    setHorariosSelec(prev => {
      const idx = prev.findIndex(h => h.id === s.id);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return [...prev, s];
    });
  }

  function continuarConHorarios() {
    if (horariosSelec.length === 0) return;
    const representativo = horariosSelec[0];
    // Si ya hay una jugada armada de antes (viene de "Repetir jugada"
    // desde Tickets: modo + animalito(s) + monto ya precargados), no
    // pisarla con el reset/auto-deteccion de modo de avanzarDesdeSorteo
    // -- solo fijar el sorteo y saltar directo al paso de la jugada.
    const hayJugadaArmada = modo && (Object.keys(selecMulti).length > 0 || animTripleta.length > 0);
    if (hayJugadaArmada) {
      setSorteo(representativo);
      setStep(3);
      return;
    }
    avanzarDesdeSorteo(representativo);
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

  // ── Fan-out compartido: sorteos × jugadasBase → carrito ───
  // jugadasBase: [{ animalito_ids, monto, _animalitos }]. Se usa tanto
  // para el flujo normal (un solo sorteo activo) como para varios
  // horarios/otra lotería -- con un solo sorteo produce exactamente el
  // mismo resultado que antes.
  async function agregarJugadasAlCarrito({ loteriaObj, modoObj, sorteos, jugadasBase, onDone }) {
    if (!sorteos || sorteos.length === 0) { setError('Selecciona al menos un horario'); return; }
    if (!jugadasBase || jugadasBase.length === 0) return;
    setError(''); setAlertas([]); setLoadingAgregar(true);

    const hoy = TODAY();
    const combos = [];
    for (const s of sorteos) {
      for (const base of jugadasBase) {
        combos.push({
          sorteo_id: s.id, modo_juego_id: modoObj.id,
          animalito_ids: base.animalito_ids, monto: base.monto, fecha_sorteo: hoy,
          _loteria_nombre: loteriaObj.nombre, _sorteo_hora: s.hora,
          _modo_nombre: modoObj.nombre, _animalitos: base._animalitos, _multiplicador: modoObj.multiplicador,
        });
      }
    }

    const etiqueta = c => `${c._loteria_nombre} ${hora12(c._sorteo_hora)} (${c._animalitos.map(a => a.nombre).join('+')})`;

    try {
      const val = await validarJugadas(combos.map(({ sorteo_id, modo_juego_id, animalito_ids, monto, fecha_sorteo }) =>
        ({ sorteo_id, modo_juego_id, animalito_ids, monto, fecha_sorteo })
      ));

      const bloqueadaIdx = val.resultados.findIndex(r => !r.ok && r.bloqueadoPorLimite);
      if (bloqueadaIdx !== -1) {
        setError(`${etiqueta(combos[bloqueadaIdx])}: ${val.resultados[bloqueadaIdx].error || 'Venta bloqueada por límite'}`);
        setLoadingAgregar(false); return;
      }

      const conErrorIdx = val.resultados.findIndex(r => !r.ok);
      if (conErrorIdx !== -1) {
        setError(`${etiqueta(combos[conErrorIdx])}: ${val.resultados[conErrorIdx].error || 'Jugada no válida'}`);
        setLoadingAgregar(false); return;
      }

      const nuevasAlertas = [];
      val.resultados.forEach((r, idx) => {
        const rev = (r.revisiones || []).filter(rv => rv.motivo && !rv.bloqueado);
        if (rev.length > 0) {
          nuevasAlertas.push(`⚠️ ${etiqueta(combos[idx])} al ${rev[0].porcentaje_usado}% del cupo`);
        }
      });
      if (nuevasAlertas.length > 0) setAlertas(nuevasAlertas);

      const nuevas = combos.map(c => ({ ...c, _key: Date.now() + Math.random() }));
      setCarrito(prev => [...prev, ...nuevas]);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAgregar(false);
    }
  }

  // ── Agregar jugadas multi-directo ─────────────────────────
  async function handleAgregarDirecto() {
    const items = Object.values(selecMulti).filter(x => parseFloat(x.monto) > 0);
    if (items.length === 0) { setError('Ingresa monto para al menos un animalito'); return; }

    const jugadasBase = items.map(x => ({
      animalito_ids: [x.animalito.id], monto: parseFloat(x.monto), _animalitos: [x.animalito],
    }));

    await agregarJugadasAlCarrito({
      loteriaObj: loteria, modoObj: modo, sorteos: sorteosActivos, jugadasBase,
      onDone: () => {
        setSelecMulti({});
        setTimeout(() => inputNumeroRef.current?.focus(), 50);
      },
    });
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

    const jugadasBase = [{
      animalito_ids: animTripleta.map(a => a.id),
      monto: parseFloat(montoTripleta),
      _animalitos: [...animTripleta],
    }];

    await agregarJugadasAlCarrito({
      loteriaObj: loteria, modoObj: modo, sorteos: sorteosActivos, jugadasBase,
      onDone: () => resetJugada(),
    });
  }

  // ── Aplicar la misma jugada armada a otra lotería ─────────
  // Los animalito_ids y modo_juego_id son propios de cada lotería, asi
  // que se resuelven de nuevo por numero/slug contra la lotería destino
  // en vez de reusar los ids de la lotería activa.
  async function handleAgregarEnOtraLoteria() {
    const destino = repetirOtraLoteria?.loteria;
    const horarios = repetirOtraLoteria?.horariosSelec || [];
    if (!destino || horarios.length === 0) return;

    const modoObj = destino.modos_juego.find(m => m.slug === modo.slug);
    if (!modoObj) { setError(`${destino.nombre} no tiene el modo "${modo.nombre}"`); return; }

    let jugadasBase;
    let avisoNoResueltos = null;

    if (esDirecto) {
      const items = Object.values(selecMulti).filter(x => parseFloat(x.monto) > 0);
      const resueltos = items.map(x => {
        const encontrado = destino.animalitos.find(a => a.numero === x.animalito.numero);
        return encontrado ? { animalito: encontrado, monto: parseFloat(x.monto) } : null;
      });
      const faltantes = items.filter((_, i) => !resueltos[i]);
      if (faltantes.length > 0) {
        avisoNoResueltos = `${destino.nombre} no tiene ${faltantes.map(x => x.animalito.nombre).join(', ')} -- se omitió`;
      }
      const validos = resueltos.filter(Boolean);
      if (validos.length === 0) { setError(avisoNoResueltos || 'Ningún animalito existe en esa lotería'); return; }
      jugadasBase = validos.map(x => ({ animalito_ids: [x.animalito.id], monto: x.monto, _animalitos: [x.animalito] }));
    } else {
      const resueltos = animTripleta.map(a => destino.animalitos.find(x => x.numero === a.numero)).filter(Boolean);
      if (resueltos.length !== animTripleta.length) {
        setError(`${destino.nombre} no tiene todos los animalitos de esta tripleta`);
        return;
      }
      jugadasBase = [{ animalito_ids: resueltos.map(a => a.id), monto: parseFloat(montoTripleta), _animalitos: resueltos }];
    }

    await agregarJugadasAlCarrito({
      loteriaObj: destino, modoObj, sorteos: horarios, jugadasBase,
      onDone: () => {
        setRepetirOtraLoteria(null);
        if (avisoNoResueltos) setAlertas(prev => [...prev, avisoNoResueltos]);
      },
    });
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
  const sorteosActivos = multiHorario ? horariosSelec : (sorteo ? [sorteo] : []);
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
                onClick={() => { setStep(0); resetJugada(); setSorteo(null); setModo(null); setMultiHorario(false); setHorariosSelec([]); }}
              >
                <span>🎰 <strong>{loteria.nombre}</strong></span>
                {sorteo && (
                  <><span className="text-muted">·</span><span>⏰ {sorteosActivos.length > 1 ? `${sorteosActivos.length} horarios` : hora12(sorteo.hora)}</span></>
                )}
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
                <label className="flex align-center gap-8 mb-12" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={multiHorario} onChange={toggleMultiHorario} />
                  🕐 Elegir varios horarios
                </label>
                <div className="sorteo-grid">
                  {loteria.sorteos.map(s => {
                    const abierto = sorteoAbierto(s);
                    const seleccionado = multiHorario
                      ? horariosSelec.some(h => h.id === s.id)
                      : sorteo?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        className={`sorteo-btn${seleccionado ? ' selected' : ''}`}
                        disabled={!abierto}
                        onClick={() => multiHorario ? toggleHorarioMulti(s) : selecSorteo(s)}
                      >
                        {hora12(s.hora)}
                        {!abierto && <span className="sorteo-cerrado">Cerrado</span>}
                      </button>
                    );
                  })}
                </div>
                {multiHorario && (
                  <button
                    className="btn btn-primary mt-8"
                    disabled={horariosSelec.length === 0}
                    onClick={continuarConHorarios}
                  >
                    Continuar con {horariosSelec.length} horario{horariosSelec.length !== 1 ? 's' : ''} →
                  </button>
                )}
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

                {/* ─ Repetir esta misma jugada en otra lotería ─ */}
                {((esDirecto && Object.keys(selecMulti).length > 0) || (esTripleta && animTripleta.length === 3 && montoTripleta)) && (
                  <div className="mt-12">
                    {!repetirOtraLoteria ? (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setRepetirOtraLoteria({ loteria: null, horariosSelec: [] })}
                      >
                        + Aplicar esta jugada a otra lotería
                      </button>
                    ) : (
                      <div className="card" style={{ marginTop: 8 }}>
                        <div className="flex justify-between align-center mb-8">
                          <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Aplicar en otra lotería</h3>
                          <button className="btn btn-outline btn-sm btn-inline" onClick={() => setRepetirOtraLoteria(null)}>✕</button>
                        </div>
                        {!repetirOtraLoteria.loteria ? (
                          <div className="loteria-grid">
                            {catalogo.filter(l => l.id !== loteria.id).map(lot => (
                              <div
                                key={lot.id}
                                className="loteria-card"
                                onClick={() => setRepetirOtraLoteria(r => ({ ...r, loteria: lot }))}
                              >
                                <div className="loteria-name">{lot.nombre}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <p className="text-muted text-sm mb-8">🎰 {repetirOtraLoteria.loteria.nombre}</p>
                            <div className="sorteo-grid">
                              {repetirOtraLoteria.loteria.sorteos.map(s => {
                                const abierto = sorteoAbierto(s);
                                const seleccionado = repetirOtraLoteria.horariosSelec.some(h => h.id === s.id);
                                return (
                                  <button
                                    key={s.id}
                                    className={`sorteo-btn${seleccionado ? ' selected' : ''}`}
                                    disabled={!abierto}
                                    onClick={() => setRepetirOtraLoteria(r => ({
                                      ...r,
                                      horariosSelec: seleccionado
                                        ? r.horariosSelec.filter(h => h.id !== s.id)
                                        : [...r.horariosSelec, s],
                                    }))}
                                  >
                                    {hora12(s.hora)}
                                    {!abierto && <span className="sorteo-cerrado">Cerrado</span>}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              className="btn btn-primary btn-sm mt-8"
                              disabled={loadingAgregar || repetirOtraLoteria.horariosSelec.length === 0}
                              onClick={handleAgregarEnOtraLoteria}
                            >
                              {loadingAgregar ? 'Validando...' : '+ Agregar al carrito'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
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

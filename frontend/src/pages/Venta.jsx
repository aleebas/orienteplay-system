import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCatalogoLoterias, validarJugadas, registrarVenta, getVenta, imprimirTicket, getTasaBCV, getTicket, pagarPremio, consultarCupoLote } from '../api/cliente';
import SelectorAnimalito, { EMOJI_MAP, LOTERIA_SLUG_IMAGEN } from '../components/SelectorAnimalito';
import Comprobante from '../components/Comprobante';
import BotonWhatsApp from '../components/BotonWhatsApp';
import { hora12, fmt, horaVenezuela, fechaHoyVenezuela, ahoraVenezuela } from '../utils/formato';
import { hayWebUSBDisponible, obtenerImpresoraEmparejada, emparejarImpresora, imprimirViaWebUSB } from '../utils/webUsbPrinter';

const TODAY = () => fechaHoyVenezuela();

function sorteoAbierto(sorteo) {
  // ahoraVenezuela() representa la hora de Venezuela en los campos UTC, así
  // que hay que fijar la hora del sorteo con setUTCHours (no setHours) para
  // que ambos lados de la comparación estén en el mismo convenio -- ver
  // utils/formato.js.
  const ahora = ahoraVenezuela();
  const [h, m] = sorteo.hora.split(':').map(Number);
  const horaSorteo = new Date(ahora);
  horaSorteo.setUTCHours(h, m, 0, 0);
  const cierre = new Date(horaSorteo.getTime() - (sorteo.minutos_cierre_previo ?? 5) * 60000);
  return ahora < cierre;
}

const normNum = s => s.replace(/^0+/, '') || s;

// Identidad estable de una combinación sorteo+modo+animalito(s), usada
// tanto de _key de React como para poder actualizar/quitar una línea del
// carrito en vez de duplicarla cuando se recalcula en cada cambio.
function comboKey(sorteoId, modoId, animalitoIds) {
  return `${sorteoId}|${modoId}|${[...animalitoIds].sort((a, b) => a - b).join(',')}`;
}

function cupoKey(animalitoId, sorteoId) {
  return `${animalitoId}|${sorteoId}`;
}

const POLL_CUPO_MS = 7000;

// Mismos umbrales que SemaforoDot en Dashboard.jsx, para que el color de
// la barra sea consistente con el resto de la app.
function cupoBarClase(pct) {
  if (pct >= 100) return 'cupo-bar-bloqueado';
  if (pct >= 80) return 'cupo-bar-rojo';
  if (pct >= 50) return 'cupo-bar-amarillo';
  return 'cupo-bar-verde';
}

// Restaura carrito/cliente/método de pago de un refresh accidental a mitad
// de una venta -- antes se perdía por completo (ver auditoría). Solo estos
// 4 campos: son "trabajo ya confirmado por el cajero" (líneas agregadas al
// carrito, no la selección de animalito a medio armar, que es rápida de
// rehacer y más riesgosa de restaurar si el catálogo cambió).
function cargarVentaEnCurso() {
  try {
    const raw = sessionStorage.getItem('venta-en-curso');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function Venta() {
  const { auth, caja, cajaCargando } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const comprobanteRef = useRef(null);
  const nuevaVentaRef = useRef(null);
  const inputNumeroRef = useRef(null);
  const montoRefs = useRef({});
  const repetirAplicadoRef = useRef(false);
  // Se incrementa cada vez que se activa una lotería/modo (selecLoteria,
  // seleccionarModo, aplicarRepetir). La sincronización en vivo del
  // carrito solo toca líneas de la sesión actual -- así, si ya había
  // líneas de una activación anterior de esa misma lotería+modo (el
  // operador salió y volvió a entrar), no se resucitan ni se borran
  // solas por coincidir el mismo sorteo/modo_juego_id.
  const sesionRef = useRef(0);

  const [catalogo, setCatalogo] = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(true);

  const [loteria, setLoteria] = useState(null);
  const [modo, setModo] = useState(null);

  // Horarios marcados para replicar la misma jugada en varios sorteos.
  const [horariosSelec, setHorariosSelec] = useState([]);
  // Aplicar la misma jugada armada a otra lotería, sin rehacer la
  // selección de animalito/monto. null = panel cerrado.
  const [repetirOtraLoteria, setRepetirOtraLoteria] = useState(null);
  const [loadingOtraLoteria, setLoadingOtraLoteria] = useState(false);

  // Selección multi-directo: {id: {animalito, monto}}
  const [selecMulti, setSelecMulti] = useState({});
  const [inputNumero, setInputNumero] = useState('');
  const [errorNumero, setErrorNumero] = useState('');

  // Cupo restante por animalito+sorteo, consultado en vivo mientras se
  // arma la jugada (ver useEffect de polling más abajo). Clave
  // "animalitoId|sorteoId" -> { tiene_limite, monto_max, acumulado,
  // restante, agotado, modo_accion }.
  const [cupos, setCupos] = useState({});
  // Aviso breve por animalito cuando su monto se auto-ajustó al cupo
  // disponible. Se limpia en el próximo cambio de ese mismo campo.
  const [avisoCupo, setAvisoCupo] = useState({});

  // Selección de modos con más de un animalito (tripleta y similares)
  const [animTripleta, setAnimTripleta] = useState([]);
  const [montoTripleta, setMontoTripleta] = useState('');

  const [alertas, setAlertas] = useState([]);
  const [error, setError] = useState('');

  const [carrito, setCarrito] = useState(() => cargarVentaEnCurso()?.carrito || []);
  const [clienteNombre, setClienteNombre] = useState(() => cargarVentaEnCurso()?.clienteNombre || '');
  const [clienteTelefono, setClienteTelefono] = useState(() => cargarVentaEnCurso()?.clienteTelefono || '');
  const [metodoPago, setMetodoPago] = useState(() => cargarVentaEnCurso()?.metodoPago || 'efectivo');

  // Persiste el carrito en curso en cada cambio -- así un refresh accidental
  // (o el navegador cerrándose por error) no borra jugadas ya armadas.
  useEffect(() => {
    if (carrito.length === 0 && !clienteNombre && !clienteTelefono) {
      sessionStorage.removeItem('venta-en-curso');
    } else {
      sessionStorage.setItem('venta-en-curso', JSON.stringify({ carrito, clienteNombre, clienteTelefono, metodoPago }));
    }
  }, [carrito, clienteNombre, clienteTelefono, metodoPago]);

  const [tasaBCV, setTasaBCV] = useState(null);
  const [montoUSD, setMontoUSD] = useState('');

  const [loadingConfirmar, setLoadingConfirmar] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [ventaConfirmada, setVentaConfirmada] = useState(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [errorImprimir, setErrorImprimir] = useState('');
  const [avisoImprimir, setAvisoImprimir] = useState(null); // { tipo: 'ok' | 'confirmar', texto }
  const [impresoraUSBEmparejada, setImpresoraUSBEmparejada] = useState(false);
  const [emparejandoImpresora, setEmparejandoImpresora] = useState(false);

  // Modal "Buscar tickets" -- pagar o repetir un ticket sin salir de la
  // venta en curso.
  const [modalBuscarTicket, setModalBuscarTicket] = useState(false);
  const [codigoBuscar, setCodigoBuscar] = useState('');
  const [ticketBuscado, setTicketBuscado] = useState(null);
  const [loadingBuscarTicket, setLoadingBuscarTicket] = useState(false);
  const [errorBuscarTicket, setErrorBuscarTicket] = useState('');
  const [loadingPagarModal, setLoadingPagarModal] = useState(false);
  // Cuando el codigo escrito es de VENTA (V-XXXXXXXX, el que se ve grande
  // en el comprobante impreso) y esa venta tiene mas de una jugada/ticket,
  // no hay un unico ticket que mostrar -- se lista para que elija cual.
  const [ventaMultiple, setVentaMultiple] = useState(null);

  // ── Carga catálogo ────────────────────────────────────────
  useEffect(() => {
    // Mientras se confirma si hay una caja abierta (ej. justo después de un
    // refresh) no se decide nada todavía -- antes esto expulsaba a /caja de
    // inmediato viendo el caja=null momentáneo, borrando la venta en curso
    // aunque la caja siguiera abierta en el servidor.
    if (cajaCargando) return;
    // caja.requiere_cierre: la caja sigue "abierta" pero es de un día
    // anterior sin declarar -- no se puede vender ahí, hay que ir a /caja
    // a cerrarla primero (misma razón que !caja).
    if (!caja || caja.requiere_cierre) { navigate('/caja'); return; }
    getCatalogoLoterias()
      .then(setCatalogo)
      .catch(() => setError('No se pudo cargar el catálogo'))
      .finally(() => setLoadingCatalogo(false));
  }, [caja, cajaCargando, navigate]);

  // ── Tasa BCV para el conversor USD → Bs ───────────────────
  useEffect(() => {
    getTasaBCV().then(r => setTasaBCV(r.tasa)).catch(() => {});
  }, []);

  // ── Reset helpers ─────────────────────────────────────────
  function resetJugada() {
    setSelecMulti({}); setAnimTripleta([]); setMontoTripleta('');
    setInputNumero(''); setErrorNumero(''); setAlertas([]); setError('');
    setRepetirOtraLoteria(null);
  }

  const handleNuevaVenta = useCallback(() => {
    setVentaConfirmada(null);
    setLoteria(null); setModo(null); setHorariosSelec([]); setRepetirOtraLoteria(null);
    setSelecMulti({}); setAnimTripleta([]); setMontoTripleta('');
    setInputNumero(''); setErrorNumero(''); setAlertas([]); setError('');
  }, []);

  // ── Aplicar "Repetir jugada" ───────────────────────────────
  // Precarga lotería/modo/animalito(s)/monto de un ticket viejo. Deja
  // horariosSelec vacío a propósito -- obliga a elegir el horario, la
  // pantalla ya muestra todo lo demás de una. Reusada tanto por el
  // prefill que llega desde Tickets.jsx (navigate con location.state)
  // como por el botón "Repetir jugada" del modal "Buscar tickets".
  // Devuelve true/false segun si pudo aplicarse.
  function aplicarRepetir(repetir) {
    const lot = catalogo.find(l => l.id === repetir.loteria_id);
    if (!lot) {
      setError('La lotería de este ticket ya no está disponible');
      return false;
    }
    const modoObj = lot.modos_juego.find(m => m.slug === repetir.modo_slug);
    if (!modoObj) {
      setError(`${lot.nombre} ya no tiene el modo de juego de esta jugada`);
      return false;
    }
    const resueltos = repetir.animalitos
      .map(x => lot.animalitos.find(a => a.numero === x.numero))
      .filter(Boolean);
    if (resueltos.length !== repetir.animalitos.length) {
      setError('No se pudieron reconocer todos los animalitos de ese ticket');
      return false;
    }

    sesionRef.current += 1;
    setLoteria(lot);
    setHorariosSelec([]);
    setModo(modoObj);
    if (modoObj.cantidad_animalitos === 1) {
      setSelecMulti(Object.fromEntries(resueltos.map(a => [a.id, { animalito: a, monto: String(repetir.monto) }])));
      setAnimTripleta([]); setMontoTripleta('');
    } else {
      setAnimTripleta(resueltos);
      setMontoTripleta(String(repetir.monto));
      setSelecMulti({});
    }
    return true;
  }

  // ── Prefill "Repetir jugada" desde Tickets ────────────────
  useEffect(() => {
    const repetir = location.state?.repetir;
    if (!repetir || repetirAplicadoRef.current || catalogo.length === 0) return;
    repetirAplicadoRef.current = true;
    aplicarRepetir(repetir);
    navigate(location.pathname, { replace: true, state: null });
  }, [catalogo, location.pathname, location.state, navigate]);

  // ── Focus "Nueva venta" al mostrar comprobante + revisar si ya hay una
  // impresora térmica USB emparejada en esta computadora (no requiere
  // gesto del usuario, WebUSB lo permite para dispositivos ya autorizados).
  useEffect(() => {
    if (!ventaConfirmada) return;
    nuevaVentaRef.current?.focus();
    obtenerImpresoraEmparejada().then((d) => setImpresoraUSBEmparejada(!!d));
  }, [ventaConfirmada]);

  async function handleEmparejarImpresora() {
    setEmparejandoImpresora(true);
    setErrorImprimir('');
    try {
      await emparejarImpresora();
      setImpresoraUSBEmparejada(true);
      setAvisoImprimir({ tipo: 'ok', texto: '✓ Impresora emparejada. Ya puedes imprimir directo desde esta computadora.' });
    } catch (err) {
      // El cajero cerró el selector de dispositivos sin elegir uno -- no es
      // un error real, no hay nada que mostrar.
      if (err.name !== 'NotFoundError') setErrorImprimir(err.message || 'No se pudo emparejar la impresora');
    } finally {
      setEmparejandoImpresora(false);
    }
  }

  async function handleImprimir() {
    setImprimiendo(true);
    setErrorImprimir('');
    setAvisoImprimir(null);

    // 1) Impresora térmica USB emparejada en ESTA computadora -- imprime
    // directo desde el navegador, sin pasar por el backend (que en Railway
    // no tiene puerto USB y nunca puede imprimir de verdad). Es el camino
    // principal ahora; los dos siguientes son respaldo.
    if (impresoraUSBEmparejada) {
      try {
        await imprimirViaWebUSB(ventaConfirmada, auth?.user?.agencia_nombre);
        setAvisoImprimir({ tipo: 'ok', texto: '✓ Ticket enviado a la impresora térmica.' });
        setImprimiendo(false);
        return;
      } catch (err) {
        setErrorImprimir(`No se pudo imprimir por USB (${err.message}). Probando otras opciones...`);
      }
    }

    // 2) Impresora térmica USB conectada al servidor backend (solo funciona
    // si backend e impresora están en la misma PC -- no es el caso en
    // Railway, pero se deja por si algún día hay una instalación local).
    try {
      await imprimirTicket(ventaConfirmada, auth?.user?.agencia_nombre);
      setAvisoImprimir({ tipo: 'ok', texto: '✓ Ticket enviado a la impresora térmica.' });
    } catch (err) {
      if (err.status === 503) {
        // 3) Último respaldo: diálogo de impresión del navegador sobre el
        // comprobante ya renderizado (ver @media print / @page en
        // index.css). No hay forma de saber desde el navegador si el
        // ticket salió de verdad, así que se le pregunta al cajero al
        // cerrar el diálogo de impresión.
        window.addEventListener('afterprint', function alAvisar() {
          window.removeEventListener('afterprint', alAvisar);
          setAvisoImprimir({ tipo: 'confirmar', texto: '¿Salió el ticket de la impresora?' });
        });
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
    if (loteria?.id === lot.id) return;
    sesionRef.current += 1;
    setLoteria(lot);
    setHorariosSelec([]);
    setModo(lot.modos_juego.find(m => m.cantidad_animalitos === 1) || lot.modos_juego[0]);
    resetJugada();
  }

  function seleccionarModo(m) {
    if (modo?.id === m.id) return;
    sesionRef.current += 1;
    setModo(m);
    resetJugada();
    // Comodín no elige animalito: siempre apuesta al #75 (GUACHARO) fijo.
    if (m.slug === 'comodin') {
      const fijo = loteria.animalitos.find(a => a.numero === '75');
      if (fijo) setSelecMulti({ [fijo.id]: { animalito: fijo, monto: '' } });
    }
  }

  // ── Toggle de horarios: solo suma/quita, sin navegar a ningún lado ──
  function toggleHorario(s) {
    setHorariosSelec(prev => {
      const idx = prev.findIndex(h => h.id === s.id);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return [...prev, s];
    });
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

  function toggleAnimTripleta(a) {
    setAnimTripleta(prev => {
      const idx = prev.findIndex(x => x.id === a.id);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      if (prev.length >= (modo?.cantidad_animalitos ?? 3)) return prev;
      return [...prev, a];
    });
  }

  // ── Input rápido: número→toggle/monto→número ──────────────
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

    if (esTripleta) {
      if (animTripleta.some(a => a.id === anim.id)) {
        setErrorNumero('Ya agregado');
        return;
      }
      if (animTripleta.length >= modo.cantidad_animalitos) {
        setErrorNumero(`Ya tenés ${modo.cantidad_animalitos} animalitos`);
        return;
      }
      setInputNumero('');
      setErrorNumero('');
      toggleAnimTripleta(anim);
      setTimeout(() => inputNumeroRef.current?.focus(), 50);
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

  // ── Sincronización en vivo del carrito ────────────────────
  // Cada combinación horario×animalito(s) con monto > 0 es una línea del
  // carrito, recalculada en cada cambio relevante: actualiza in situ las
  // que ya estaban (misma clave), agrega las nuevas, y quita las que
  // pertenecen a la sesión de edición actual (ver sesionRef) pero ya no
  // califican. Usar la sesión (no solo lotería+modo+sorteo) es necesario
  // para que, si el operador sale de una lotería con líneas ya en el
  // carrito y vuelve a entrar más tarde, esas líneas viejas no se
  // resuciten ni se borren solas por coincidir el mismo sorteo/modo --
  // solo las líneas creadas DESPUÉS de la activación actual son "vivas".
  // Las líneas de "Aplicar esta jugada a otra lotería" nunca llevan
  // _sesion, así que esta sincronización jamás las toca.
  useEffect(() => {
    if (!loteria || !modo) return;
    const hoy = TODAY();
    const sesion = sesionRef.current;
    const deseados = new Map();

    if (modo.cantidad_animalitos === 1) {
      for (const { animalito, monto } of Object.values(selecMulti)) {
        const m = parseFloat(monto);
        if (!(m > 0)) continue;
        for (const s of horariosSelec) {
          const key = comboKey(s.id, modo.id, [animalito.id]);
          deseados.set(key, {
            _key: key, _sesion: sesion,
            sorteo_id: s.id, modo_juego_id: modo.id, animalito_ids: [animalito.id], monto: m, fecha_sorteo: hoy,
            _loteria_nombre: loteria.nombre, _sorteo_hora: s.hora,
            _modo_nombre: modo.nombre, _animalitos: [animalito], _multiplicador: modo.multiplicador,
          });
        }
      }
    } else if (animTripleta.length === modo.cantidad_animalitos) {
      const m = parseFloat(montoTripleta);
      if (m > 0) {
        const ids = animTripleta.map(a => a.id);
        for (const s of horariosSelec) {
          const key = comboKey(s.id, modo.id, ids);
          deseados.set(key, {
            _key: key, _sesion: sesion,
            sorteo_id: s.id, modo_juego_id: modo.id, animalito_ids: ids, monto: m, fecha_sorteo: hoy,
            _loteria_nombre: loteria.nombre, _sorteo_hora: s.hora,
            _modo_nombre: modo.nombre, _animalitos: [...animTripleta], _multiplicador: modo.multiplicador,
          });
        }
      }
    }

    setCarrito(prev => {
      const siguen = [];
      const yaVistos = new Set();
      for (const item of prev) {
        // Coincide exactamente con algo que se quiere ahora mismo -- se
        // actualiza in situ y "adopta" la sesión actual. Esto cubre tanto
        // una línea ya viva en esta sesión como una vieja de una
        // activación anterior de esta misma lotería que el operador
        // volvió a seleccionar idéntica (mismo sorteo+modo+animalito):
        // sin este chequeo primero, terminaría duplicada en vez de
        // actualizada.
        if (deseados.has(item._key)) {
          siguen.push(deseados.get(item._key));
          yaVistos.add(item._key);
          continue;
        }
        // No coincide con nada deseado ahora. Si es de la sesión actual,
        // es porque se destildó el horario/animalito o se vació el monto
        // -- se descarta. Si es de otra sesión/lotería, se deja intacta.
        if (item._sesion === sesion) continue;
        siguen.push(item);
      }
      for (const [key, combo] of deseados) {
        if (!yaVistos.has(key)) siguen.push(combo);
      }
      return siguen;
    });
  }, [loteria, modo, horariosSelec, selecMulti, animTripleta, montoTripleta]);

  // ── Cupo en vivo por animalito+sorteo ──────────────────────
  // Solo aplica a modos de 1 animalito (Directo, Comodín) -- Tripleta
  // comparte un monto entre 3 animalitos con límites potencialmente
  // distintos, un problema aparte que no está cubierto acá. Se consulta
  // al agregar/cambiar animalitos u horarios, y se repite cada
  // POLL_CUPO_MS mientras haya algo que mirar, para notar si otro
  // usuario vendió del mismo cupo mientras se arma esta jugada. El gate
  // real contra pasarse del cupo sigue siendo el backend en
  // POST /jugadas (sincrono, sin condicion de carrera posible ahi) --
  // esto es solo aviso anticipado, por eso alcanza con polling en vez
  // de empujar cambios desde el backend.
  const idsSelecMultiKey = Object.keys(selecMulti).sort().join(',');
  useEffect(() => {
    if (!loteria || !modo || modo.cantidad_animalitos !== 1 || horariosSelec.length === 0) return;
    const animalitos = Object.values(selecMulti).map(x => x.animalito);
    if (animalitos.length === 0) return;

    const combos = [];
    for (const a of animalitos) {
      for (const s of horariosSelec) combos.push({ animalito_id: a.id, sorteo_id: s.id });
    }

    let cancelado = false;
    async function consultar() {
      try {
        const { resultados } = await consultarCupoLote(TODAY(), combos);
        if (cancelado) return;
        setCupos(prev => {
          const next = { ...prev };
          resultados.forEach((r, idx) => {
            next[cupoKey(combos[idx].animalito_id, combos[idx].sorteo_id)] = r;
          });
          return next;
        });
      } catch {
        // Si falla la consulta de cupo no se bloquea nada -- el gate
        // real sigue siendo el backend al confirmar la venta.
      }
    }

    consultar();
    const t = setInterval(consultar, POLL_CUPO_MS);
    return () => { cancelado = true; clearInterval(t); };
  }, [loteria, modo, horariosSelec, idsSelecMultiKey]);

  // Cupo mas restrictivo (menor "restante") entre los horarios
  // actualmente seleccionados para un animalito -- el monto es
  // compartido entre todos esos horarios, asi que nunca debe superar al
  // mas ajustado. null = sin limite conocido configurado para ninguno
  // (no hace falta ajustar ni mostrar barra).
  function cupoMasRestrictivoPara(animalitoId) {
    let elegido = null;
    for (const s of horariosSelec) {
      const info = cupos[cupoKey(animalitoId, s.id)];
      if (!info || !info.tiene_limite) continue;
      if (!elegido || info.restante < elegido.restante) elegido = { ...info, sorteoId: s.id, hora: s.hora };
    }
    return elegido;
  }

  // Cuánto de esta misma venta ya está en el carrito para un
  // animalito+sorteo puntual (el cupo del backend solo cuenta lo ya
  // vendido en jugadas confirmadas, no lo que la operadora está armando
  // ahora mismo -- la barra tiene que sumar ambas cosas).
  function montoEnCarritoPara(animalitoId, sorteoId) {
    return carrito
      .filter(i => i.sorteo_id === sorteoId && i.animalito_ids.length === 1 && i.animalito_ids[0] === animalitoId)
      .reduce((s, i) => s + i.monto, 0);
  }

  function handleMontoAnimalito(animalitoId, value) {
    const cupo = cupoMasRestrictivoPara(animalitoId);
    let valorFinal = value;
    if (cupo && parseFloat(value) > cupo.restante) {
      valorFinal = String(cupo.restante);
      setAvisoCupo(prev => ({ ...prev, [animalitoId]: `Ajustado a ${fmt(cupo.restante)} — cupo casi agotado para este animalito` }));
    } else if (avisoCupo[animalitoId]) {
      setAvisoCupo(prev => {
        const next = { ...prev };
        delete next[animalitoId];
        return next;
      });
    }
    setSelecMulti(prev => ({ ...prev, [animalitoId]: { ...prev[animalitoId], monto: valorFinal } }));
  }

  // ── Aplicar la misma jugada armada a otra lotería ─────────
  // Único lugar que sigue llamando a validarJugadas explícitamente: es
  // una acción deliberada y poco frecuente (no en vivo por tecla), asi que
  // vale la pena el aviso temprano de límite de banca. Los animalito_ids y
  // modo_juego_id son propios de cada lotería, asi que se resuelven de
  // nuevo por numero/slug contra la lotería destino.
  async function agregarJugadasAlCarrito({ loteriaObj, modoObj, sorteos, jugadasBase, onDone }) {
    if (!sorteos || sorteos.length === 0) { setError('Selecciona al menos un horario'); return; }
    if (!jugadasBase || jugadasBase.length === 0) return;
    setError(''); setAlertas([]); setLoadingOtraLoteria(true);

    const hoy = TODAY();
    const combos = [];
    for (const s of sorteos) {
      for (const base of jugadasBase) {
        const key = comboKey(s.id, modoObj.id, base.animalito_ids);
        combos.push({
          _key: key,
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
        setLoadingOtraLoteria(false); return;
      }

      const conErrorIdx = val.resultados.findIndex(r => !r.ok);
      if (conErrorIdx !== -1) {
        setError(`${etiqueta(combos[conErrorIdx])}: ${val.resultados[conErrorIdx].error || 'Jugada no válida'}`);
        setLoadingOtraLoteria(false); return;
      }

      const nuevasAlertas = [];
      val.resultados.forEach((r, idx) => {
        const rev = (r.revisiones || []).filter(rv => rv.motivo && !rv.bloqueado);
        if (rev.length > 0) {
          nuevasAlertas.push(`⚠️ ${etiqueta(combos[idx])} al ${rev[0].porcentaje_usado}% del cupo`);
        }
      });
      if (nuevasAlertas.length > 0) setAlertas(nuevasAlertas);

      setCarrito(prev => {
        const porKey = new Map(prev.map(item => [item._key, item]));
        for (const c of combos) porKey.set(c._key, c);
        return [...porKey.values()];
      });
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingOtraLoteria(false);
    }
  }

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
        setError(`${destino.nombre} no tiene todos los animalitos de esta jugada`);
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

  // ── Modal "Buscar tickets" ─────────────────────────────────
  function abrirModalBuscarTicket() {
    setCodigoBuscar(''); setTicketBuscado(null); setErrorBuscarTicket(''); setVentaMultiple(null);
    setModalBuscarTicket(true);
  }

  function cerrarModalBuscarTicket() {
    setModalBuscarTicket(false);
  }

  // El comprobante impreso muestra el codigo de VENTA (V-XXXXXXXX) en
  // grande, no el de cada ticket individual (MS-XXXXXXXX) -- por eso la
  // operadora normalmente escribe/escanea el codigo de venta acá. Antes
  // esto solo probaba match exacto contra tickets.codigo (MS-), así que
  // buscar por V- siempre daba "Ticket no encontrado" aunque el mismo
  // código funcionara perfecto en Tickets (que sí busca en ambos). Ahora,
  // si no es un ticket individual, se prueba como código de venta: si esa
  // venta tiene un solo ticket se muestra directo (mismo comportamiento
  // de siempre); si tiene varios, se listan para elegir cuál.
  async function handleBuscarTicketModal() {
    const cod = codigoBuscar.trim().toUpperCase();
    if (!cod) return;
    setErrorBuscarTicket('');
    setVentaMultiple(null);
    setLoadingBuscarTicket(true);
    try {
      setTicketBuscado(await getTicket(cod));
    } catch (err) {
      if (err.status === 404) {
        try {
          const { venta, jugadas } = await getVenta(cod);
          if (jugadas.length === 1) {
            setTicketBuscado(await getTicket(jugadas[0].ticket_codigo));
          } else if (jugadas.length > 1) {
            setTicketBuscado(null);
            setVentaMultiple({ venta, jugadas });
          } else {
            setTicketBuscado(null);
            setErrorBuscarTicket('Ticket no encontrado');
          }
        } catch {
          setTicketBuscado(null);
          setErrorBuscarTicket('Ticket no encontrado');
        }
      } else {
        setTicketBuscado(null);
        setErrorBuscarTicket(err.message);
      }
    } finally {
      setLoadingBuscarTicket(false);
    }
  }

  async function seleccionarTicketDeVenta(ticketCodigo) {
    setLoadingBuscarTicket(true);
    setErrorBuscarTicket('');
    try {
      setTicketBuscado(await getTicket(ticketCodigo));
      setVentaMultiple(null);
    } catch (err) {
      setErrorBuscarTicket(err.message || 'No se pudo cargar el ticket');
    } finally {
      setLoadingBuscarTicket(false);
    }
  }

  async function handlePagarTicketModal() {
    if (!ticketBuscado || !caja?.id) return;
    setErrorBuscarTicket('');
    setLoadingPagarModal(true);
    try {
      await pagarPremio(ticketBuscado.ticket.codigo, caja.id);
      setTicketBuscado(await getTicket(ticketBuscado.ticket.codigo));
    } catch (err) {
      setErrorBuscarTicket(err.status === 409 ? 'Este ticket ya fue pagado anteriormente' : err.message);
    } finally {
      setLoadingPagarModal(false);
    }
  }

  function handleRepetirDesdeModal() {
    if (!ticketBuscado) return;
    if (hayJugadaArmada) {
      const seguro = confirm('Esto va a reemplazar la jugada que estás armando ahora (no lo que ya agregaste al carrito). ¿Continuar?');
      if (!seguro) return;
    }
    const { jugada, animalitos } = ticketBuscado;
    const ok = aplicarRepetir({
      loteria_id: animalitos[0].loteria_id,
      modo_slug: jugada.modo_slug,
      monto: jugada.monto,
      animalitos: animalitos.map(a => ({ numero: a.numero, nombre: a.nombre })),
    });
    if (ok) cerrarModalBuscarTicket();
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
          {avisoImprimir?.tipo === 'ok' && <div className="alert alert-success">{avisoImprimir.texto}</div>}
          {avisoImprimir?.tipo === 'confirmar' && (
            <div className="alert alert-warning">
              <p className="mb-12">{avisoImprimir.texto}</p>
              <div className="flex gap-8">
                <button className="btn btn-success btn-sm btn-inline" onClick={() => setAvisoImprimir(null)}>Sí, salió bien</button>
                <button className="btn btn-outline btn-sm btn-inline" onClick={handleImprimir} disabled={imprimiendo}>Reintentar</button>
              </div>
            </div>
          )}
          <button className="btn btn-outline" onClick={handleImprimir} disabled={imprimiendo}>
            {imprimiendo ? '⟳ Imprimiendo...' : '🖨 Imprimir comprobante'}
          </button>
          {hayWebUSBDisponible() && !impresoraUSBEmparejada && (
            <button className="btn btn-outline btn-sm" onClick={handleEmparejarImpresora} disabled={emparejandoImpresora}>
              {emparejandoImpresora ? '⟳ Emparejando...' : '🔌 Emparejar impresora térmica (una vez por PC)'}
            </button>
          )}
          {impresoraUSBEmparejada && (
            <div className="text-muted text-sm text-center">🔌 Impresora térmica USB lista en esta computadora</div>
          )}
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

  // esDirecto agrupa cualquier modo de un solo animalito (Directo,
  // Comodín...); esTripleta cualquier modo de más de uno. Se basan en
  // cantidad_animalitos, no en el slug -- antes "Comodín Guácharo" caía
  // mal clasificado como tripleta por no ser exactamente "directo".
  const esDirecto = modo?.cantidad_animalitos === 1;
  const esTripleta = modo && modo.cantidad_animalitos > 1;
  const esComodin = modo?.slug === 'comodin';
  const esGuacharo = loteria?.slug === 'guacharoactivo';
  const hayJugadaArmada = !!modo && (Object.keys(selecMulti).length > 0 || animTripleta.length > 0);
  const totalSelecMulti = Object.values(selecMulti).reduce((s, x) => s + (parseFloat(x.monto) || 0), 0);
  const totalCarrito = carrito.reduce((s, i) => s + i.monto, 0);

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

      {modalBuscarTicket && (
        <div className="dialog-overlay" onClick={cerrarModalBuscarTicket}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between align-center mb-12">
              <h2>🔍 Buscar tickets</h2>
              <button className="btn btn-sm btn-inline btn-outline" onClick={cerrarModalBuscarTicket}>✕</button>
            </div>

            <div className="flex gap-8 mb-12">
              <input
                type="text"
                value={codigoBuscar}
                onChange={e => setCodigoBuscar(e.target.value.toUpperCase())}
                placeholder="Ej: V-06250578 o MS-ABC1XY23"
                style={{ flex: 1, padding: '11px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '1rem', minHeight: 48 }}
                onKeyDown={e => e.key === 'Enter' && handleBuscarTicketModal()}
                autoFocus
              />
              <button
                className="btn btn-primary btn-inline"
                onClick={handleBuscarTicketModal}
                disabled={loadingBuscarTicket || !codigoBuscar}
                style={{ minWidth: 90 }}
              >
                {loadingBuscarTicket ? '...' : 'Buscar'}
              </button>
            </div>

            {errorBuscarTicket && <div className="alert alert-danger">{errorBuscarTicket}</div>}

            {ventaMultiple && (
              <div style={{ marginBottom: 12 }}>
                <div className="text-muted text-sm mb-8">
                  La venta <strong>{ventaMultiple.venta.codigo}</strong> tiene {ventaMultiple.jugadas.length} jugadas -- elige cuál:
                </div>
                {ventaMultiple.jugadas.map(j => (
                  <button
                    key={j.ticket_codigo}
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%', marginBottom: 6, textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
                    onClick={() => seleccionarTicketDeVenta(j.ticket_codigo)}
                    disabled={loadingBuscarTicket}
                  >
                    <span>{j.loteria_nombre} · {hora12(j.sorteo_hora)} · {fmt(j.monto)}</span>
                    <span className={`badge badge-${
                      j.ticket_estado === 'ganador' ? 'success' :
                      j.ticket_estado === 'pagado' ? 'muted' :
                      j.ticket_estado === 'perdedor' ? 'danger' :
                      j.ticket_estado === 'anulado' ? 'warning' : 'info'
                    }`}>
                      {j.ticket_estado.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {ticketBuscado && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <span className={`badge badge-${
                    ticketBuscado.ticket.estado === 'ganador' ? 'success' :
                    ticketBuscado.ticket.estado === 'pagado' ? 'muted' :
                    ticketBuscado.ticket.estado === 'perdedor' ? 'danger' :
                    ticketBuscado.ticket.estado === 'anulado' ? 'warning' : 'info'
                  }`} style={{ fontSize: '0.9rem', padding: '4px 12px' }}>
                    {ticketBuscado.ticket.estado.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Ticket</span>
                  <span className="bold">{ticketBuscado.ticket.codigo}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Venta</span>
                  <span className="bold">{ticketBuscado.jugada.venta_codigo}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Lotería</span>
                  <span>{ticketBuscado.jugada.loteria_nombre}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Sorteo</span>
                  <span>{hora12(ticketBuscado.jugada.sorteo_hora)} · {ticketBuscado.jugada.fecha_sorteo}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Animal(es)</span>
                  <span>{ticketBuscado.animalitos.map(a => `${EMOJI_MAP[a.nombre] || '🐾'} ${a.nombre}`).join(' + ')}</span>
                </div>
                <div className="flex justify-between mb-8">
                  <span className="text-muted">Monto apostado</span>
                  <span className="bold">{fmt(ticketBuscado.jugada.monto)}</span>
                </div>

                {ticketBuscado.ticket.estado === 'ganador' && (
                  <>
                    <div style={{ background: 'var(--success-light)', borderRadius: 'var(--radius)', padding: '12px 16px', margin: '12px 0', textAlign: 'center' }}>
                      <div className="text-success bold" style={{ fontSize: '1.1rem' }}>🏆 Premio a pagar</div>
                      <div className="text-success bold" style={{ fontSize: '1.6rem' }}>
                        {fmt(ticketBuscado.jugada.monto * ticketBuscado.jugada.multiplicador)}
                      </div>
                    </div>
                    {!caja && (
                      <div className="alert alert-warning">No hay caja abierta. Abre una caja para pagar premios.</div>
                    )}
                    {caja?.requiere_cierre && (
                      <div className="alert alert-warning">Tienes una caja del {caja.fecha_caja_abierta} sin cerrar. Ciérrala en Caja antes de pagar premios.</div>
                    )}
                    <button
                      className="btn btn-success"
                      style={{ width: '100%', marginBottom: 8 }}
                      onClick={handlePagarTicketModal}
                      disabled={loadingPagarModal || !caja || caja.requiere_cierre}
                    >
                      {loadingPagarModal ? 'Procesando...' : '💰 Pagar ticket'}
                    </button>
                  </>
                )}

                {ticketBuscado.ticket.estado === 'pagado' && ticketBuscado.pago && (
                  <div className="alert alert-info">
                    Pagado el {horaVenezuela(ticketBuscado.pago.pagado_en)}<br />
                    Monto: {fmt(ticketBuscado.pago.monto_pagado)}
                  </div>
                )}

                <button
                  className="btn btn-outline"
                  style={{ width: '100%' }}
                  onClick={handleRepetirDesdeModal}
                >
                  🔁 Repetir jugada
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="venta-layout venta-layout-3col">
        {/* ── Columna izquierda: loterías ── */}
        <div className="venta-loterias">
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Lotería</h3>
            <div className="loteria-grid loteria-grid-vertical">
              {catalogo.map(lot => {
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
                      style={{ height: '48px', objectFit: 'contain', marginBottom: '4px' }}
                    />
                    <div className="loteria-name">{lot.nombre}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Columna centro: horarios + animalito(s) ── */}
        <div className="venta-main">
          <div className="card">
            {!loteria ? (
              <>
                {error && <div className="alert alert-danger">{error}</div>}
                <p className="text-muted text-center" style={{ padding: '48px 0' }}>← Elegí una lotería para empezar</p>
              </>
            ) : (
              <>
                <h3 style={{ marginBottom: 4 }}>🎰 {loteria.nombre}</h3>
                <p className="text-muted text-sm mb-8">Tocá los horarios que querés jugar. Podés tocar más de uno.</p>
                <div className="sorteo-grid">
                  {loteria.sorteos.map(s => {
                    const abierto = sorteoAbierto(s);
                    const seleccionado = horariosSelec.some(h => h.id === s.id);
                    return (
                      <button
                        key={s.id}
                        className={`sorteo-btn${seleccionado ? ' selected' : ''}`}
                        disabled={!abierto}
                        onClick={() => toggleHorario(s)}
                      >
                        {hora12(s.hora)}
                        {!abierto && <span className="sorteo-cerrado">Cerrado</span>}
                      </button>
                    );
                  })}
                </div>

                {loteria.modos_juego.length > 1 && (
                  <div className="flex gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
                    {loteria.modos_juego.map(m => (
                      <button
                        key={m.id}
                        className={`btn btn-sm btn-inline ${modo?.id === m.id ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => seleccionarModo(m)}
                      >
                        {m.nombre}
                      </button>
                    ))}
                  </div>
                )}

                {alertas.map((a, i) => <div key={i} className="alert alert-warning">{a}</div>)}
                {error && <div className="alert alert-danger">{error}</div>}

                {/* ─ Modos de un solo animalito (Directo, Comodín...) ─ */}
                {modo && esDirecto && (
                  <div className="jugada-builder">
                    <div className="jugada-tablero">
                      {esComodin ? (
                        <>
                          <h3 style={{ marginBottom: 8 }}>Comodín Guácharo</h3>
                          <p className="text-muted text-sm">
                            Este modo siempre apuesta al animalito fijo #75 (GUACHARO), paga x{modo.multiplicador}.
                          </p>
                        </>
                      ) : (
                        <>
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
                          <div className={esGuacharo ? 'animalito-grid-wrap-scroll' : undefined}>
                            <SelectorAnimalito
                              animalitos={loteria.animalitos}
                              seleccionados={Object.values(selecMulti).map(x => x.animalito)}
                              cantidad={1}
                              onSelect={toggleAnimMulti}
                              limitarSeleccion={false}
                              loteriaSlug={LOTERIA_SLUG_IMAGEN[loteria.slug]}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    <div className="jugada-seleccion">
                      <h3 style={{ marginBottom: 8, fontSize: '0.9rem' }}>Jugadas</h3>
                      {Object.keys(selecMulti).length === 0 ? (
                        <div className="multi-empty">Toca un animalito<br />para agregarlo aquí</div>
                      ) : (
                        Object.values(selecMulti).map(({ animalito, monto }) => {
                          const cupo = cupoMasRestrictivoPara(animalito.id);
                          const pct = cupo ? Math.round(((cupo.acumulado + montoEnCarritoPara(animalito.id, cupo.sorteoId)) / cupo.monto_max) * 100) : 0;
                          return (
                            <div key={animalito.id} className="multi-anim-item-wrap">
                              <div className="multi-anim-item">
                                <div className="multi-anim-info">
                                  <span className="multi-anim-emoji">{EMOJI_MAP[animalito.nombre] || '🐾'}</span>
                                  <span className="multi-anim-label">{animalito.nombre}</span>
                                  <span className="multi-anim-sub">#{animalito.numero}</span>
                                </div>
                                {cupo && cupo.agotado ? (
                                  <input className="multi-anim-monto" type="text" value="Agotado" disabled />
                                ) : (
                                  <input
                                    ref={el => montoRefs.current[animalito.id] = el}
                                    className="multi-anim-monto"
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    placeholder="Bs."
                                    value={monto}
                                    onChange={e => handleMontoAnimalito(animalito.id, e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        setTimeout(() => inputNumeroRef.current?.focus(), 30);
                                      }
                                    }}
                                  />
                                )}
                                {!esComodin && (
                                  <button className="multi-anim-del" onClick={() => toggleAnimMulti(animalito)}>✕</button>
                                )}
                              </div>
                              {cupo && cupo.agotado && (
                                <p className="cupo-agotado-msg">Cupo agotado para este animalito en este horario</p>
                              )}
                              {avisoCupo[animalito.id] && (
                                <p className="cupo-aviso-msg">{avisoCupo[animalito.id]}</p>
                              )}
                              {cupo && !cupo.agotado && (
                                <div className="cupo-bar-wrap">
                                  <div className="cupo-bar-track">
                                    <div className={`cupo-bar-fill ${cupoBarClase(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                  </div>
                                  <span className="cupo-bar-label">
                                    {pct}% del cupo{horariosSelec.length > 1 ? ` (${hora12(cupo.hora)})` : ''}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}

                      {Object.keys(selecMulti).length > 0 && (
                        <div className="multi-total">Total: {fmt(totalSelecMulti)}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* ─ Modos de varios animalitos (Tripleta...) ─ */}
                {modo && esTripleta && (
                  <>
                    <h3 style={{ marginBottom: 8 }}>
                      Selecciona {modo.cantidad_animalitos} animalitos ({animTripleta.length}/{modo.cantidad_animalitos})
                    </h3>
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
                    <div className={esGuacharo ? 'animalito-grid-wrap-scroll' : undefined}>
                      <SelectorAnimalito
                        animalitos={loteria.animalitos}
                        seleccionados={animTripleta}
                        cantidad={modo.cantidad_animalitos}
                        onSelect={toggleAnimTripleta}
                        limitarSeleccion={true}
                        loteriaSlug={LOTERIA_SLUG_IMAGEN[loteria.slug]}
                      />
                    </div>
                    {animTripleta.length === modo.cantidad_animalitos && (
                      <div className="field mt-8">
                        <label>Monto a apostar ({modo.nombre} paga x{modo.multiplicador})</label>
                        <input
                          type="number" min="1" step="0.01"
                          value={montoTripleta}
                          onChange={e => setMontoTripleta(e.target.value)}
                          placeholder="0.00" autoFocus
                        />
                        {montoTripleta && (
                          <p className="text-muted text-sm mt-8">
                            Premio potencial: <strong className="text-success">{fmt(parseFloat(montoTripleta) * modo.multiplicador)}</strong>
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}

                {modo && (
                  <button
                    className="btn btn-outline btn-sm mt-12"
                    onClick={abrirModalBuscarTicket}
                  >
                    🔍 Buscar tickets
                  </button>
                )}

                {/* ─ Repetir esta misma jugada en otra lotería ─ */}
                {((esDirecto && Object.keys(selecMulti).length > 0) || (esTripleta && animTripleta.length === modo.cantidad_animalitos && montoTripleta)) && (
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
                              disabled={loadingOtraLoteria || repetirOtraLoteria.horariosSelec.length === 0}
                              onClick={handleAgregarEnOtraLoteria}
                            >
                              {loadingOtraLoteria ? 'Validando...' : '+ Agregar al carrito'}
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

        {/* ── Columna derecha: carrito (en vivo) ── */}
        {carrito.length > 0 && (
          <div className="venta-sidebar">
            <div className="card">
              <h2 style={{ marginBottom: 12 }}>
                Carrito ({carrito.length} jugada{carrito.length !== 1 ? 's' : ''})
              </h2>

              {carrito.map(item => {
                const esDeSeleccionActiva = item._sesion === sesionRef.current;
                return (
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
                    {!esDeSeleccionActiva && (
                      <button className="carrito-del" onClick={() => setCarrito(c => c.filter(x => x._key !== item._key))}>✕</button>
                    )}
                  </div>
                );
              })}

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
                <label>Forma de pago</label>
                <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="pago_movil">Pago Móvil</option>
                  <option value="biopago">Biopago</option>
                  <option value="credito">A crédito</option>
                </select>
              </div>

              {metodoPago === 'credito' && (
                <>
                  <div className="field">
                    <label>Cliente (requerido)</label>
                    <input type="text" value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre" style={{ minHeight: 40 }} />
                  </div>
                  <div className="field">
                    <label>Teléfono (requerido)</label>
                    <input type="tel" value={clienteTelefono} onChange={e => setClienteTelefono(e.target.value)} placeholder="04121234567" style={{ minHeight: 40 }} />
                  </div>
                </>
              )}

              {metodoPago === 'credito' && (
                <div className="alert alert-warning">
                  Esta venta quedará pendiente de cobro. Se necesita nombre y teléfono del cliente para poder ubicarlo después.
                </div>
              )}

              {error && <div className="alert alert-danger">{error}</div>}

              <button
                className="btn btn-accent"
                onClick={() => confirmarVenta(false)}
                disabled={loadingConfirmar || (metodoPago === 'credito' && (!clienteNombre || !clienteTelefono))}
              >
                {loadingConfirmar ? 'Registrando...' : '✓ Confirmar venta'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

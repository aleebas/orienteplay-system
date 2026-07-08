// Impresión térmica directa desde el navegador (WebUSB), sin pasar por el
// backend. Reemplaza al parche de window.print(): el backend en Railway no
// tiene puerto USB y nunca podrá imprimir de verdad (ver auditoría), así que
// cada caja empareja SU PROPIA impresora una vez, y desde ahí el navegador
// le manda los bytes ESC/POS directo -- funciona igual sin importar dónde
// esté el backend.
//
// Solo Chrome/Edge/Opera (Chromium) sobre HTTPS soportan WebUSB. En un
// navegador sin soporte, o si el cajero nunca emparejó una impresora, el
// llamador debe caer al respaldo existente (ver Venta.jsx: intenta backend
// USB -> WebUSB -> window.print()).
//
// No conocemos el VID/PID exacto de la DP58U-02 (no está documentado
// públicamente), así que el diálogo de emparejamiento no filtra por
// fabricante -- el cajero elige su impresora de la lista una sola vez por
// computadora; Chrome recuerda el permiso entre sesiones.

import {
  hora12, fmtTicket, fechaCorta,
  agruparJugadasParaTicket, formatJugadaTag, wrapJugadasEnLineas,
} from './formato';

const SEP = '--------------------------------';
const SEP2 = '================================';

const METODO_PAGO_LABEL = {
  efectivo: 'EFECTIVO',
  pago_movil: 'PAGO MOVIL',
  biopago: 'BIOPAGO',
};

// ---- Codificación CP437 (la misma que ya usaba el backend vía escpos) ----
// Solo se mapean los caracteres fuera de ASCII que realmente aparecen en un
// ticket (nombres de clientes/agencias en español). Cualquier otro
// caracter no soportado (emoji, símbolos raros) se reduce quitándole el
// acento o se reemplaza por "?" -- nunca lanza un error a mitad de la
// construcción del ticket.
const CP437_EXTRA = {
  'á': 0xA0, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5,
  'é': 0x82, 'É': 0x90, 'ü': 0x81, 'Ü': 0x9A, '¿': 0xA8, '¡': 0xAD,
  'ª': 0xA6, 'º': 0xA7,
};

function charACP437(ch) {
  const code = ch.codePointAt(0);
  if (code < 0x80) return code;
  if (CP437_EXTRA[ch] !== undefined) return CP437_EXTRA[ch];
  // Reduce "Á" -> "A", "Ô" -> "O", etc. quitando el diacrítico; si tras
  // eso sigue sin ser ASCII imprimible, se reemplaza por "?".
  // Quita marcas diacríticas combinantes (rango Unicode 0x0300-0x036F) tras
  // normalizar a NFD -- construido por código de caracter, no por escape
  // literal en el source, para evitar cualquier ambigüedad de encoding.
  const RANGO_DIACRITICOS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');
  const sinAcento = ch.normalize('NFD').replace(RANGO_DIACRITICOS, '');
  const codeSinAcento = sinAcento.codePointAt(0) || 0x3F;
  return codeSinAcento < 0x80 ? codeSinAcento : 0x3F;
}

function textoACP437(texto) {
  return Uint8Array.from(Array.from(String(texto)).map(charACP437));
}

// ---- Constructor de comandos ESC/POS ----
class ConstructorTicket {
  constructor() {
    this.partes = [new Uint8Array([0x1B, 0x40])]; // ESC @ (init)
  }
  alinear(centro) {
    this.partes.push(new Uint8Array([0x1B, 0x61, centro ? 0x01 : 0x00])); // ESC a n
    return this;
  }
  negrita(on) {
    this.partes.push(new Uint8Array([0x1B, 0x45, on ? 0x01 : 0x00])); // ESC E n
    return this;
  }
  linea(texto = '') {
    this.partes.push(textoACP437(texto));
    this.partes.push(new Uint8Array([0x0A])); // LF
    return this;
  }
  cortar() {
    this.partes.push(new Uint8Array([0x1D, 0x56, 0x01])); // GS V 1 (corte parcial, ampliamente soportado)
    return this;
  }
  bytes() {
    const total = this.partes.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of this.partes) { out.set(p, offset); offset += p.length; }
    return out;
  }
}

// Mismo layout exacto que backend/src/routes/imprimir.js y Comprobante.jsx --
// si se cambia el formato del ticket en un lado, cambiarlo en los tres.
export function construirTicketBytes(ventaData, agenciaNombre) {
  const { venta, jugadas } = ventaData;
  const totalMonto = jugadas.reduce((s, j) => s + j.monto, 0);
  const bloques = agruparJugadasParaTicket(jugadas);
  const metodoPago = METODO_PAGO_LABEL[jugadas[0]?.metodo_pago] || 'EFECTIVO';

  const t = new ConstructorTicket();
  t.alinear(true);
  t.negrita(true).linea('ORIENTE PLAY').negrita(false);
  t.linea((agenciaNombre || 'MI AGENCIA').toUpperCase());
  t.linea(`VENTA# ${venta.codigo}`);
  t.linea(fechaCorta(venta.creada_en));
  if (venta.cliente_nombre) t.linea(venta.cliente_nombre);
  t.alinear(false).linea(SEP2);

  for (const bloque of bloques) {
    const tags = bloque.jugadas.map(formatJugadaTag);
    const lineas = wrapJugadasEnLineas(tags, 32);
    t.negrita(true).linea(`${bloque.loteria.toUpperCase()}  ${hora12(bloque.hora)}`).negrita(false);
    lineas.forEach((linea) => t.linea(linea));
    t.linea(SEP);
  }

  t.negrita(true).linea(`MON: ${fmtTicket(totalMonto)}(Bs)  JUG: ${jugadas.length}`).negrita(false);
  t.linea(`PAGO: ${metodoPago}`);
  t.linea('CADUCA A LOS 3 DIAS');
  t.linea(SEP2);
  t.cortar();

  return t.bytes();
}

export function hayWebUSBDisponible() {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

// Dispositivo ya emparejado en sesiones anteriores (no requiere gesto del
// usuario -- se puede llamar automáticamente al cargar la pantalla).
export async function obtenerImpresoraEmparejada() {
  if (!hayWebUSBDisponible()) return null;
  const dispositivos = await navigator.usb.getDevices();
  return dispositivos[0] || null;
}

// Requiere un clic real del cajero (WebUSB no deja abrir el selector de
// dispositivos por código sin gesto del usuario). Sin filtro de
// fabricante a propósito -- ver nota arriba.
export async function emparejarImpresora() {
  if (!hayWebUSBDisponible()) {
    throw new Error('Este navegador no soporta impresión USB directa (usa Chrome o Edge).');
  }
  return navigator.usb.requestDevice({ filters: [] });
}

function encontrarEndpointSalida(config) {
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      const ep = alt.endpoints.find((e) => e.direction === 'out');
      if (ep) return { interfaceNumber: iface.interfaceNumber, endpointNumber: ep.endpointNumber };
    }
  }
  return null;
}

// Abre, manda los bytes y SIEMPRE libera la interfaz al final (éxito o
// error) -- la lección del bug del backend (imprimir.js dejaba el USB
// atrapado si algo fallaba a mitad de la impresión, rompiendo todos los
// tickets siguientes hasta reiniciar el servidor). Acá no puede pasar:
// abrir/reclamar/mandar/liberar es una sola operación con `finally`.
export async function imprimirViaWebUSB(ventaData, agenciaNombre) {
  const dispositivo = await obtenerImpresoraEmparejada();
  if (!dispositivo) {
    throw new Error('No hay ninguna impresora térmica emparejada en esta computadora.');
  }

  const bytes = construirTicketBytes(ventaData, agenciaNombre);
  let interfaceClaimed = null;

  try {
    await dispositivo.open();
    if (!dispositivo.configuration) await dispositivo.selectConfiguration(1);

    const endpoint = encontrarEndpointSalida(dispositivo.configuration);
    if (!endpoint) throw new Error('La impresora emparejada no tiene un endpoint USB de salida reconocible.');

    await dispositivo.claimInterface(endpoint.interfaceNumber);
    interfaceClaimed = endpoint.interfaceNumber;

    const resultado = await dispositivo.transferOut(endpoint.endpointNumber, bytes);
    if (resultado.status !== 'ok') {
      throw new Error(`La impresora rechazó los datos (status: ${resultado.status}).`);
    }
  } finally {
    try {
      if (interfaceClaimed !== null) await dispositivo.releaseInterface(interfaceClaimed);
    } catch { /* ya liberada o dispositivo desconectado -- no hay nada mas que hacer */ }
    try {
      await dispositivo.close();
    } catch { /* idem */ }
  }
}

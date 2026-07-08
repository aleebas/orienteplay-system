const express = require('express');
const escpos = require('escpos');
escpos.USB = require('escpos-usb');
const { requireAuth } = require('../middleware/auth');
const {
  hora12, fmtTicket, fechaCorta,
  agruparJugadasParaTicket, formatJugadaTag, wrapJugadasEnLineas,
} = require('../utils/ticketFormato');

const router = express.Router();
router.use(requireAuth);

const SEP = '--------------------------------';
const SEP2 = '================================';

const METODO_PAGO_LABEL = {
  efectivo: 'EFECTIVO',
  pago_movil: 'PAGO MOVIL',
  biopago: 'BIOPAGO',
};

const TIMEOUT_APERTURA_MS = 5000;

// Lock a nivel de proceso: solo hay UN puerto USB fisico, asi que dos
// impresiones no pueden estar en curso a la vez -- sin esto, dos ventas
// impresas casi al mismo tiempo compiten por el mismo device.open() y
// pueden dejar la impresora en un estado inconsistente.
let impresoraOcupada = false;

router.post('/', (req, res) => {
  const { venta, jugadas, agenciaNombre } = req.body;
  if (!venta || !Array.isArray(jugadas)) {
    return res.status(400).json({ error: 'venta y jugadas son requeridos' });
  }

  if (impresoraOcupada) {
    return res.status(409).json({ error: 'La impresora está ocupada con otro ticket, intenta de nuevo en un momento' });
  }
  impresoraOcupada = true;

  let respondido = false;
  function responder(status, body) {
    if (respondido) return;
    respondido = true;
    impresoraOcupada = false;
    res.status(status).json(body);
  }

  let device;
  try {
    device = new escpos.USB();
  } catch (err) {
    return responder(503, { error: 'Impresora térmica DP58U-02 no detectada en este equipo' });
  }

  const printer = new escpos.Printer(device, { encoding: 'CP437' });

  // Si device.open() nunca llama al callback (impresora apagada/trabada),
  // no se debe dejar la peticion colgada para siempre -- ni el lock
  // tomado para siempre, lo que rompiria todos los tickets siguientes.
  const timeoutApertura = setTimeout(() => {
    responder(503, { error: 'La impresora térmica no respondió a tiempo (¿está encendida y con papel?)' });
    try { device.close(); } catch { /* puede que ni siquiera haya llegado a abrir */ }
  }, TIMEOUT_APERTURA_MS);

  device.open((err) => {
    clearTimeout(timeoutApertura);
    if (respondido) return; // ya se respondio por timeout justo antes de que este callback llegara

    if (err) {
      return responder(503, { error: 'No se pudo abrir la conexión con la impresora: ' + err.message });
    }

    try {
      const totalMonto = jugadas.reduce((s, j) => s + j.monto, 0);
      const bloques = agruparJugadasParaTicket(jugadas);
      const metodoPago = METODO_PAGO_LABEL[jugadas[0]?.metodo_pago] || 'EFECTIVO';

      printer
        .align('ct')
        .style('b').text('ORIENTE PLAY').style('normal')
        .text((agenciaNombre || 'MI AGENCIA').toUpperCase())
        .text(`VENTA# ${venta.codigo}`)
        .text(fechaCorta(venta.creada_en));
      if (venta.cliente_nombre) printer.text(venta.cliente_nombre);
      printer.align('lt').text(SEP2);

      for (const bloque of bloques) {
        const tags = bloque.jugadas.map(formatJugadaTag);
        const lineas = wrapJugadasEnLineas(tags, 32);
        printer.style('b').text(`${bloque.loteria.toUpperCase()}  ${hora12(bloque.hora)}`).style('normal');
        lineas.forEach((linea) => printer.text(linea));
        printer.text(SEP);
      }

      printer
        .style('b').text(`MON: ${fmtTicket(totalMonto)}(Bs)  JUG: ${jugadas.length}`).style('normal')
        .text(`PAGO: ${metodoPago}`)
        .text('CADUCA A LOS 3 DIAS')
        .text(SEP2)
        .cut()
        .close(() => {
          responder(200, { ok: true, mensaje: 'Ticket enviado a la impresora' });
        });
    } catch (printErr) {
      // Punto critico del bug original: si algo revienta aca (ej. un campo
      // inesperado de la venta), antes se respondia el error pero el
      // dispositivo USB se quedaba abierto/reclamado -- rompiendo todos
      // los tickets siguientes hasta reiniciar el backend. Ahora siempre
      // se cierra, pase lo que pase.
      responder(500, { error: 'Error al imprimir: ' + printErr.message });
      try { device.close(); } catch { /* ya pudo haber quedado cerrado por el propio error */ }
    }
  });
});

module.exports = router;

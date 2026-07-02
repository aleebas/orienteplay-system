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

router.post('/', (req, res) => {
  const { venta, jugadas, agenciaNombre } = req.body;
  if (!venta || !Array.isArray(jugadas)) {
    return res.status(400).json({ error: 'venta y jugadas son requeridos' });
  }

  let device;
  try {
    device = new escpos.USB();
  } catch (err) {
    return res.status(503).json({ error: 'Impresora térmica DP58U-02 no detectada en este equipo' });
  }

  const printer = new escpos.Printer(device, { encoding: 'CP437' });

  device.open((err) => {
    if (err) {
      return res.status(503).json({ error: 'No se pudo abrir la conexión con la impresora: ' + err.message });
    }

    try {
      const totalMonto = jugadas.reduce((s, j) => s + j.monto, 0);
      const bloques = agruparJugadasParaTicket(jugadas);
      const metodoPago = METODO_PAGO_LABEL[jugadas[0]?.metodo_pago] || 'EFECTIVO';

      printer
        .align('ct')
        .style('b').text('ORIENTE PLAY').style('normal')
        .text((agenciaNombre || 'MI AGENCIA').toUpperCase())
        .text(`TCK# ${venta.codigo}`)
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
          res.json({ ok: true, mensaje: 'Ticket enviado a la impresora' });
        });
    } catch (printErr) {
      res.status(500).json({ error: 'Error al imprimir: ' + printErr.message });
    }
  });
});

module.exports = router;

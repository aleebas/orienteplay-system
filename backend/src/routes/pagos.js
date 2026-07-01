const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ------------------------------------------------------------
// POST /pagos/:codigoTicket
// Confirma el pago de un ticket ganador. El UNIQUE en
// pagos_premio.ticket_id garantiza, a nivel de base de datos,
// que un mismo ticket nunca se pueda pagar dos veces aunque
// dos vendedores intenten pagarlo casi al mismo tiempo.
// ------------------------------------------------------------
router.post('/:codigoTicket', (req, res) => {
  const { caja_id } = req.body;
  if (!caja_id) return res.status(400).json({ error: 'caja_id es requerido' });

  const ticket = db.prepare(`SELECT * FROM tickets WHERE codigo = ?`).get(req.params.codigoTicket);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

  if (ticket.estado === 'pagado') {
    const pagoPrevio = db.prepare(`SELECT * FROM pagos_premio WHERE ticket_id = ?`).get(ticket.id);
    return res.status(409).json({ error: 'Este ticket ya fue pagado anteriormente', pago: pagoPrevio });
  }

  if (ticket.estado !== 'ganador') {
    return res.status(400).json({ error: `Este ticket no esta en estado ganador (estado actual: ${ticket.estado})` });
  }

  const jugada = db.prepare(`SELECT * FROM jugadas WHERE id = ?`).get(ticket.jugada_id);
  const modo = db.prepare(`SELECT * FROM modos_juego WHERE id = ?`).get(jugada.modo_juego_id);
  const montoPremio = jugada.monto * modo.multiplicador;

  try {
    const pagar = db.transaction(() => {
      // El UNIQUE(ticket_id) en pagos_premio lanza error si ya existe -> doble seguridad
      db.prepare(
        `INSERT INTO pagos_premio (ticket_id, monto_pagado, pagado_por, caja_id) VALUES (?, ?, ?, ?)`
      ).run(ticket.id, montoPremio, req.user.id, caja_id);

      db.prepare(`UPDATE tickets SET estado = 'pagado' WHERE id = ?`).run(ticket.id);
    });
    pagar();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Este ticket ya fue pagado (conflicto detectado en base de datos)' });
    }
    throw err;
  }

  res.json({ mensaje: 'Premio pagado', monto_pagado: montoPremio });
});

module.exports = router;

const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { fechaVenezuelaDeTimestampSqlite, cajaEsDeHoy } = require('../utils/fechaVenezuela');

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
  const { caja_id, banco_beneficiario, cedula_beneficiario, telefono_beneficiario, nombre_beneficiario } = req.body;
  if (!caja_id) return res.status(400).json({ error: 'caja_id es requerido' });

  const caja = db.prepare(`SELECT * FROM cajas WHERE id = ? AND estado = 'abierta'`).get(caja_id);
  if (!caja) return res.status(400).json({ error: 'La caja indicada no existe o no esta abierta' });

  // Mismo resguardo que en el registro de ventas: no se puede pagar un
  // premio contra una caja que quedo abierta de un dia anterior sin
  // declarar -- el efectivo de ese pago quedaria mezclado en el dia
  // equivocado.
  if (!cajaEsDeHoy(caja)) {
    return res.status(409).json({
      error: `La caja tiene una apertura del ${fechaVenezuelaDeTimestampSqlite(caja.abierta_en)} sin cerrar. Ciérrala antes de pagar premios.`,
      requiere_cierre_anterior: true,
      caja_id: caja.id,
      fecha_caja_abierta: fechaVenezuelaDeTimestampSqlite(caja.abierta_en),
    });
  }

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

  // El ticket solo se puede pagar desde la agencia donde se vendio -- sin
  // esto, un usuario de la agencia A podria pagar (y cobrar comision de)
  // un ticket ganador vendido por la agencia B.
  if (jugada.agencia_id !== req.user.agencia_id) {
    return res.status(403).json({ error: 'Este ticket pertenece a otra agencia' });
  }

  const modo = db.prepare(`SELECT * FROM modos_juego WHERE id = ?`).get(jugada.modo_juego_id);
  const montoPremio = jugada.monto * modo.multiplicador;

  try {
    const pagar = db.transaction(() => {
      // El UNIQUE(ticket_id) en pagos_premio lanza error si ya existe -> doble seguridad
      db.prepare(
        `INSERT INTO pagos_premio (ticket_id, monto_pagado, pagado_por, caja_id, banco_beneficiario, cedula_beneficiario, telefono_beneficiario, nombre_beneficiario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ticket.id, montoPremio, req.user.id, caja_id,
        banco_beneficiario || null, cedula_beneficiario || null, telefono_beneficiario || null, nombre_beneficiario || null
      );

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

// ------------------------------------------------------------
// Helper: valida que la caja indicada este abierta, sea de hoy, y
// pertenezca a la agencia del ticket -- mismo resguardo que se usa en
// jugadas.js y en el pago directo de arriba. Devuelve la caja o null +
// escribe el error en res (para poder hacer "return validarCaja(...)").
// ------------------------------------------------------------
function validarCajaHoy(caja_id, res) {
  if (!caja_id) {
    res.status(400).json({ error: 'caja_id es requerido' });
    return null;
  }
  const caja = db.prepare(`SELECT * FROM cajas WHERE id = ? AND estado = 'abierta'`).get(caja_id);
  if (!caja) {
    res.status(400).json({ error: 'La caja indicada no existe o no esta abierta' });
    return null;
  }
  if (!cajaEsDeHoy(caja)) {
    res.status(409).json({
      error: `La caja tiene una apertura del ${fechaVenezuelaDeTimestampSqlite(caja.abierta_en)} sin cerrar. Ciérrala antes de continuar.`,
      requiere_cierre_anterior: true,
      caja_id: caja.id,
      fecha_caja_abierta: fechaVenezuelaDeTimestampSqlite(caja.abierta_en),
    });
    return null;
  }
  return caja;
}

// Trae el ticket+jugada+modo de un codigo, validando que sea ganador y de
// la agencia del usuario. Devuelve null + responde el error si algo falla.
function cargarTicketGanador(codigoTicket, req, res) {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE codigo = ?`).get(codigoTicket);
  if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return null; }

  const jugada = db.prepare(`SELECT * FROM jugadas WHERE id = ?`).get(ticket.jugada_id);
  if (jugada.agencia_id !== req.user.agencia_id) {
    res.status(403).json({ error: 'Este ticket pertenece a otra agencia' });
    return null;
  }
  if (ticket.estado === 'pagado') {
    res.status(409).json({ error: 'Este ticket ya fue pagado anteriormente' });
    return null;
  }
  if (ticket.estado !== 'ganador') {
    res.status(400).json({ error: `Este ticket no esta en estado ganador (estado actual: ${ticket.estado})` });
    return null;
  }

  const modo = db.prepare(`SELECT * FROM modos_juego WHERE id = ?`).get(jugada.modo_juego_id);
  return { ticket, jugada, montoPremio: jugada.monto * modo.multiplicador };
}

// ------------------------------------------------------------
// POST /pagos/:codigoTicket/solicitar-digital
// Primer paso del pago de premio por Pago Movil/Biopago: guarda los datos
// del beneficiario y deja la solicitud en 'pendiente'. NO marca el ticket
// como pagado ni descuenta nada de ninguna caja -- eso pasa recien en
// confirmar-digital, cuando alguien confirma que el encargado ya transfirio.
// ------------------------------------------------------------
router.post('/:codigoTicket/solicitar-digital', (req, res) => {
  const { banco_beneficiario, cedula_beneficiario, telefono_beneficiario, nombre_beneficiario } = req.body;
  if (!validarCajaHoy(req.body.caja_id, res)) return;

  const cargado = cargarTicketGanador(req.params.codigoTicket, req, res);
  if (!cargado) return;
  const { ticket, montoPremio } = cargado;

  const existente = db.prepare(
    `SELECT * FROM solicitudes_premio_digital WHERE ticket_id = ? AND estado = 'pendiente'`
  ).get(ticket.id);
  if (existente) {
    return res.status(409).json({ error: 'Ya hay una solicitud de pago digital pendiente para este ticket', solicitud: existente });
  }

  const r = db.prepare(
    `INSERT INTO solicitudes_premio_digital (ticket_id, monto_premio, banco_beneficiario, cedula_beneficiario, telefono_beneficiario, nombre_beneficiario, solicitado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(ticket.id, montoPremio, banco_beneficiario || null, cedula_beneficiario || null, telefono_beneficiario || null, nombre_beneficiario || null, req.user.id);

  res.status(201).json({ mensaje: 'Solicitud de pago digital creada', solicitud_id: r.lastInsertRowid, monto_premio: montoPremio });
});

// ------------------------------------------------------------
// POST /pagos/:codigoTicket/confirmar-digital
// Segundo paso: se llama cuando el encargado ya confirmo (por WhatsApp o
// como sea) que hizo la transferencia. Aqui SI se marca el ticket como
// pagado y se descuenta de la caja indicada (la que este abierta en este
// momento, que puede ser distinta a la que estaba abierta cuando se
// solicito el pago).
// ------------------------------------------------------------
router.post('/:codigoTicket/confirmar-digital', (req, res) => {
  const caja = validarCajaHoy(req.body.caja_id, res);
  if (!caja) return;

  const ticket = db.prepare(`SELECT * FROM tickets WHERE codigo = ?`).get(req.params.codigoTicket);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

  const jugada = db.prepare(`SELECT * FROM jugadas WHERE id = ?`).get(ticket.jugada_id);
  if (jugada.agencia_id !== req.user.agencia_id) {
    return res.status(403).json({ error: 'Este ticket pertenece a otra agencia' });
  }

  const solicitud = db.prepare(
    `SELECT * FROM solicitudes_premio_digital WHERE ticket_id = ? AND estado = 'pendiente'`
  ).get(ticket.id);
  if (!solicitud) return res.status(404).json({ error: 'No hay una solicitud de pago digital pendiente para este ticket' });

  if (ticket.estado === 'pagado') {
    return res.status(409).json({ error: 'Este ticket ya fue pagado anteriormente' });
  }

  try {
    const confirmar = db.transaction(() => {
      db.prepare(
        `INSERT INTO pagos_premio (ticket_id, monto_pagado, pagado_por, caja_id, banco_beneficiario, cedula_beneficiario, telefono_beneficiario, nombre_beneficiario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ticket.id, solicitud.monto_premio, req.user.id, caja.id,
        solicitud.banco_beneficiario, solicitud.cedula_beneficiario, solicitud.telefono_beneficiario, solicitud.nombre_beneficiario
      );
      db.prepare(`UPDATE tickets SET estado = 'pagado' WHERE id = ?`).run(ticket.id);
      db.prepare(
        `UPDATE solicitudes_premio_digital SET estado = 'confirmado', confirmado_por = ?, confirmado_en = datetime('now'), caja_id = ? WHERE id = ?`
      ).run(req.user.id, caja.id, solicitud.id);
    });
    confirmar();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Este ticket ya fue pagado (conflicto detectado en base de datos)' });
    }
    throw err;
  }

  res.json({ mensaje: 'Premio digital confirmado y pagado', monto_pagado: solicitud.monto_premio });
});

// Cancela una solicitud enviada por error (ej. la operadora se equivoco de
// ticket) para poder volver a solicitar sin quedar bloqueada por el
// UNIQUE logico de "una pendiente por ticket".
router.post('/:codigoTicket/cancelar-digital', (req, res) => {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE codigo = ?`).get(req.params.codigoTicket);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

  const jugada = db.prepare(`SELECT * FROM jugadas WHERE id = ?`).get(ticket.jugada_id);
  if (jugada.agencia_id !== req.user.agencia_id) {
    return res.status(403).json({ error: 'Este ticket pertenece a otra agencia' });
  }

  const solicitud = db.prepare(
    `SELECT * FROM solicitudes_premio_digital WHERE ticket_id = ? AND estado = 'pendiente'`
  ).get(ticket.id);
  if (!solicitud) return res.status(404).json({ error: 'No hay una solicitud de pago digital pendiente para este ticket' });

  db.prepare(`UPDATE solicitudes_premio_digital SET estado = 'cancelado' WHERE id = ?`).run(solicitud.id);
  res.json({ mensaje: 'Solicitud cancelada' });
});

// Lista todas las solicitudes pendientes de la agencia -- para no
// depender de que la operadora recuerde el codigo del ticket.
router.get('/solicitudes-digitales-pendientes', (req, res) => {
  const rows = db.prepare(`
    SELECT sd.id AS solicitud_id, sd.ticket_id, sd.monto_premio, sd.banco_beneficiario,
           sd.cedula_beneficiario, sd.telefono_beneficiario, sd.nombre_beneficiario, sd.solicitado_en,
           t.codigo AS ticket_codigo, j.metodo_pago,
           l.nombre AS loteria_nombre, s.hora AS sorteo_hora
    FROM solicitudes_premio_digital sd
    JOIN tickets t ON t.id = sd.ticket_id
    JOIN jugadas j ON j.id = t.jugada_id
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    WHERE sd.estado = 'pendiente' AND j.agencia_id = ?
    ORDER BY sd.solicitado_en ASC
  `).all(req.user.agencia_id);
  res.json(rows);
});

module.exports = router;

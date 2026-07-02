const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { generarCodigoTicket } = require('../utils/ticket');
const { sorteoEstaAbierto } = require('../utils/sorteoCierre');

const router = express.Router();
router.use(requireAuth);

function revisarLimite({ agenciaId, animalitoId, sorteoId, fechaSorteo, montoNuevo }) {
  let limite = db.prepare(
    `SELECT * FROM limites_apuesta
     WHERE agencia_id = ? AND animalito_id = ? AND sorteo_id = ? AND activo = 1`
  ).get(agenciaId, animalitoId, sorteoId);

  if (!limite) {
    limite = db.prepare(
      `SELECT * FROM limites_apuesta
       WHERE agencia_id = ? AND animalito_id = ? AND sorteo_id IS NULL AND activo = 1`
    ).get(agenciaId, animalitoId);
  }

  if (!limite) {
    return { permitido: true, tiene_limite: false };
  }

  if (limite.monto_max_ticket && montoNuevo > limite.monto_max_ticket) {
    return {
      permitido: limite.modo_accion !== 'bloquear',
      tiene_limite: true,
      bloqueado: limite.modo_accion === 'bloquear',
      motivo: `Monto excede el limite por jugada (max ${limite.monto_max_ticket})`,
      limite,
    };
  }

  const acumulado = db.prepare(
    `SELECT COALESCE(SUM(j.monto), 0) AS total
     FROM jugada_animalitos ja
     JOIN jugadas j ON j.id = ja.jugada_id
     WHERE ja.animalito_id = ? AND j.sorteo_id = ? AND j.fecha_sorteo = ? AND j.agencia_id = ?`
  ).get(animalitoId, sorteoId, fechaSorteo, agenciaId).total;

  const acumuladoNuevo = acumulado + montoNuevo;

  if (acumuladoNuevo > limite.monto_max) {
    return {
      permitido: limite.modo_accion !== 'bloquear',
      tiene_limite: true,
      bloqueado: limite.modo_accion === 'bloquear',
      motivo: `Este animalito alcanzaria ${acumuladoNuevo} de un maximo de ${limite.monto_max} en este sorteo`,
      limite,
      acumulado_actual: acumulado,
      acumulado_nuevo: acumuladoNuevo,
    };
  }

  return {
    permitido: true,
    tiene_limite: true,
    motivo: null,
    acumulado_actual: acumulado,
    acumulado_nuevo: acumuladoNuevo,
    porcentaje_usado: Math.round((acumuladoNuevo / limite.monto_max) * 100),
  };
}

function validarJugada({ agenciaId, sorteoId, modoJuegoId, animalitoIds, monto, fechaSorteo }) {
  const sorteo = db.prepare(`SELECT * FROM sorteos WHERE id = ?`).get(sorteoId);
  if (!sorteo) return { ok: false, error: 'Sorteo no encontrado' };

  const cierre = sorteoEstaAbierto(sorteo, fechaSorteo);
  if (!cierre.abierto) {
    return { ok: false, error: cierre.motivo, cerrado: true, sorteo };
  }

  const modo = db.prepare(`SELECT * FROM modos_juego WHERE id = ?`).get(modoJuegoId);
  if (!modo) return { ok: false, error: 'Modo de juego no encontrado' };

  if (animalitoIds.length !== modo.cantidad_animalitos) {
    return { ok: false, error: `El modo "${modo.nombre}" requiere ${modo.cantidad_animalitos} animalito(s), se recibieron ${animalitoIds.length}` };
  }

  const revisiones = animalitoIds.map(animalitoId =>
    revisarLimite({ agenciaId, animalitoId, sorteoId, fechaSorteo, montoNuevo: monto })
  );

  const bloqueado = revisiones.find(r => r.bloqueado);
  if (bloqueado) {
    return { ok: false, error: 'Venta bloqueada por limite de banca', detalle: revisiones, bloqueadoPorLimite: true };
  }

  const conAlerta = revisiones.some(r => r.tiene_limite && r.motivo && !r.bloqueado);

  return { ok: true, sorteo, modo, revisiones, conAlerta };
}

// Ventas a credito sin cobrar (cualquier fecha, no solo hoy -- un
// cliente puede tardar dias en pagar).
router.get('/creditos-pendientes', (req, res) => {
  const rows = db.prepare(`
    SELECT j.id AS jugada_id, j.creada_en, j.monto, j.fecha_sorteo,
           j.cliente_nombre, j.cliente_telefono,
           l.nombre AS loteria_nombre, s.hora AS sorteo_hora,
           GROUP_CONCAT(a.numero || '-' || a.nombre, ', ') AS animalitos
    FROM jugadas j
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    JOIN jugada_animalitos ja ON ja.jugada_id = j.id
    JOIN animalitos a ON a.id = ja.animalito_id
    WHERE j.agencia_id = ? AND j.metodo_pago = 'credito' AND j.cobrado = 0
    GROUP BY j.id
    ORDER BY j.creada_en ASC
  `).all(req.user.agencia_id);
  res.json(rows);
});

router.post('/:id/cobrar', (req, res) => {
  const jugada = db.prepare(`SELECT * FROM jugadas WHERE id = ? AND agencia_id = ?`).get(req.params.id, req.user.agencia_id);
  if (!jugada) return res.status(404).json({ error: 'Jugada no encontrada' });
  if (jugada.metodo_pago !== 'credito') {
    return res.status(400).json({ error: 'Esta jugada no es una venta a crédito' });
  }
  if (jugada.cobrado) {
    return res.status(409).json({ error: 'Esta venta ya fue marcada como cobrada' });
  }

  db.prepare(`UPDATE jugadas SET cobrado = 1 WHERE id = ?`).run(jugada.id);
  res.json({ mensaje: 'Venta marcada como cobrada' });
});

// Lista de tickets del dia con filtros (para la pantalla de Tickets)
router.get('/', (req, res) => {
  const { fecha, estado, q } = req.query;
  const f = fecha || new Date().toISOString().slice(0, 10);

  let where = `j.agencia_id = ? AND j.fecha_sorteo = ?`;
  const params = [req.user.agencia_id, f];

  if (estado && estado !== 'todos') {
    where += ` AND t.estado = ?`;
    params.push(estado);
  }
  if (q) {
    where += ` AND t.codigo LIKE ?`;
    params.push(`%${q}%`);
  }

  const rows = db.prepare(`
    SELECT
      t.id AS ticket_id,
      t.codigo AS ticket_codigo,
      t.estado,
      j.creada_en,
      j.monto,
      j.metodo_pago,
      v.codigo AS venta_codigo,
      l.nombre AS loteria_nombre,
      s.hora AS sorteo_hora,
      GROUP_CONCAT(a.numero || '-' || a.nombre, ', ') AS animalitos
    FROM jugadas j
    JOIN tickets t ON t.jugada_id = j.id
    JOIN ventas v ON v.id = j.venta_id
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    JOIN jugada_animalitos ja ON ja.jugada_id = j.id
    JOIN animalitos a ON a.id = ja.animalito_id
    WHERE ${where}
    GROUP BY j.id
    ORDER BY j.creada_en DESC
  `).all(...params);

  res.json(rows);
});

router.post('/validar', (req, res) => {
  const lista = req.body.jugadas || [req.body];
  const fechaDefault = new Date().toISOString().slice(0, 10);

  const resultados = lista.map(j => {
    const fecha = j.fecha_sorteo || fechaDefault;
    const r = validarJugada({
      agenciaId: req.user.agencia_id,
      sorteoId: j.sorteo_id,
      modoJuegoId: j.modo_juego_id,
      animalitoIds: j.animalito_ids,
      monto: j.monto,
      fechaSorteo: fecha,
    });
    return { ...r, sorteo_id: j.sorteo_id };
  });

  const algunError = resultados.some(r => !r.ok);
  res.json({ permitido: !algunError, resultados });
});

const METODOS_PAGO = ['efectivo', 'pago_movil', 'biopago', 'credito'];

router.post('/', (req, res) => {
  const { caja_id, cliente_nombre, cliente_telefono, forzar_aunque_alerte } = req.body;
  const metodoPago = METODOS_PAGO.includes(req.body.metodo_pago) ? req.body.metodo_pago : 'efectivo';
  const cobrado = metodoPago === 'credito' ? 0 : 1;

  if (metodoPago === 'credito' && (!cliente_nombre || !cliente_telefono)) {
    return res.status(400).json({ error: 'Las ventas a crédito requieren nombre y teléfono del cliente' });
  }
  const lista = req.body.jugadas || [{
    sorteo_id: req.body.sorteo_id,
    modo_juego_id: req.body.modo_juego_id,
    animalito_ids: req.body.animalito_ids,
    monto: req.body.monto,
    fecha_sorteo: req.body.fecha_sorteo,
  }];

  if (!caja_id || lista.length === 0) {
    return res.status(400).json({ error: 'caja_id y al menos una jugada son requeridos' });
  }

  const caja = db.prepare(`SELECT * FROM cajas WHERE id = ? AND estado = 'abierta'`).get(caja_id);
  if (!caja) return res.status(400).json({ error: 'La caja indicada no existe o no esta abierta' });

  const fechaDefault = new Date().toISOString().slice(0, 10);
  const validaciones = lista.map(j => ({
    input: j,
    fecha: j.fecha_sorteo || fechaDefault,
    resultado: validarJugada({
      agenciaId: req.user.agencia_id,
      sorteoId: j.sorteo_id,
      modoJuegoId: j.modo_juego_id,
      animalitoIds: j.animalito_ids,
      monto: j.monto,
      fechaSorteo: j.fecha_sorteo || fechaDefault,
    }),
  }));

  const conError = validaciones.find(v => !v.resultado.ok);
  if (conError) {
    return res.status(409).json({
      error: 'No se pudo registrar la venta',
      jugada_con_error: conError.input,
      detalle: conError.resultado,
    });
  }

  const conAlerta = validaciones.some(v => v.resultado.conAlerta);
  if (conAlerta && !forzar_aunque_alerte) {
    return res.status(200).json({
      requiere_confirmacion: true,
      mensaje: 'Una o mas jugadas superan el limite configurado. Confirme si desea continuar.',
      detalle: validaciones.map(v => v.resultado),
    });
  }

  const codigoVenta = generarCodigoTicket('V');

  const registrarTodo = db.transaction(() => {
    const ventaResult = db.prepare(
      `INSERT INTO ventas (agencia_id, caja_id, usuario_id, cliente_nombre, cliente_telefono, codigo)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.user.agencia_id, caja_id, req.user.id, cliente_nombre || null, cliente_telefono || null, codigoVenta);
    const ventaId = ventaResult.lastInsertRowid;

    const tickets = [];

    for (const v of validaciones) {
      const j = v.input;
      const fecha = v.fecha;

      const jugadaResult = db.prepare(
        `INSERT INTO jugadas (venta_id, agencia_id, caja_id, usuario_id, sorteo_id, modo_juego_id, fecha_sorteo, cliente_nombre, cliente_telefono, monto, metodo_pago, cobrado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(ventaId, req.user.agencia_id, caja_id, req.user.id, j.sorteo_id, j.modo_juego_id, fecha, cliente_nombre || null, cliente_telefono || null, j.monto, metodoPago, cobrado);
      const jugadaId = jugadaResult.lastInsertRowid;

      const insertAnimalito = db.prepare(
        `INSERT INTO jugada_animalitos (jugada_id, animalito_id, posicion) VALUES (?, ?, ?)`
      );
      j.animalito_ids.forEach((animalitoId, idx) => insertAnimalito.run(jugadaId, animalitoId, idx + 1));

      const codigoTicket = generarCodigoTicket();
      const ticketResult = db.prepare(
        `INSERT INTO tickets (jugada_id, codigo, estado) VALUES (?, ?, 'pendiente')`
      ).run(jugadaId, codigoTicket);

      tickets.push({ jugada_id: jugadaId, ticket_id: ticketResult.lastInsertRowid, codigo: codigoTicket });
    }

    return { ventaId, tickets };
  });

  const { ventaId, tickets } = registrarTodo();

  res.status(201).json({
    mensaje: 'Venta registrada',
    venta_id: ventaId,
    codigo_venta: codigoVenta,
    tickets,
    alertas: conAlerta ? validaciones.flatMap(v => v.resultado.revisiones || []).filter(r => r.motivo) : [],
  });
});

const MINUTOS_LIMITE_ANULACION = 20;

// Anula todos los tickets de una venta si siguen pendientes, la venta
// se hizo hace menos de MINUTOS_LIMITE_ANULACION minutos, y el sorteo
// de cada jugada todavia no comenzo.
router.post('/anular/:codigoVenta', (req, res) => {
  const venta = db.prepare(`SELECT * FROM ventas WHERE codigo = ?`).get(req.params.codigoVenta);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
  if (venta.agencia_id !== req.user.agencia_id) {
    return res.status(403).json({ error: 'No autorizado para anular esta venta' });
  }

  const jugadas = db.prepare(
    `SELECT j.id, j.creada_en, t.id AS ticket_id, t.estado AS ticket_estado, s.hora AS sorteo_hora
     FROM jugadas j
     JOIN tickets t ON t.jugada_id = j.id
     JOIN sorteos s ON s.id = j.sorteo_id
     WHERE j.venta_id = ?`
  ).all(venta.id);

  if (jugadas.length === 0) {
    return res.status(404).json({ error: 'No hay jugadas asociadas a esta venta' });
  }

  const ahora = new Date();
  for (const j of jugadas) {
    if (j.ticket_estado !== 'pendiente') {
      return res.status(409).json({ error: `Esta venta tiene un ticket en estado "${j.ticket_estado}", no se puede anular` });
    }

    // creada_en viene de sqlite datetime('now') en UTC, sin sufijo de zona.
    const creadaEnUTC = new Date(j.creada_en.replace(' ', 'T') + 'Z');
    const minutosTranscurridos = (ahora.getTime() - creadaEnUTC.getTime()) / 60000;
    if (minutosTranscurridos > MINUTOS_LIMITE_ANULACION) {
      return res.status(409).json({ error: `Ya pasaron mas de ${MINUTOS_LIMITE_ANULACION} minutos desde la venta, no se puede anular` });
    }

    const [h, m] = j.sorteo_hora.split(':').map(Number);
    const horaSorteo = new Date(ahora);
    horaSorteo.setHours(h, m, 0, 0);
    if (ahora >= horaSorteo) {
      return res.status(409).json({ error: `El sorteo de las ${j.sorteo_hora} ya comenzo, no se puede anular` });
    }
  }

  const anularTodo = db.transaction(() => {
    const upd = db.prepare(`UPDATE tickets SET estado = 'anulado' WHERE id = ?`);
    jugadas.forEach(j => upd.run(j.ticket_id));
  });
  anularTodo();

  res.json({ mensaje: 'Ticket(s) anulado(s)', cantidad: jugadas.length });
});

router.get('/venta/:codigo', (req, res) => {
  const venta = db.prepare(`SELECT * FROM ventas WHERE codigo = ?`).get(req.params.codigo);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

  const jugadas = db.prepare(
    `SELECT j.*, t.codigo AS ticket_codigo, t.estado AS ticket_estado,
            s.nombre AS sorteo_nombre, s.hora AS sorteo_hora, l.nombre AS loteria_nombre,
            m.nombre AS modo_nombre, m.multiplicador
     FROM jugadas j
     JOIN tickets t ON t.jugada_id = j.id
     JOIN sorteos s ON s.id = j.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     JOIN modos_juego m ON m.id = j.modo_juego_id
     WHERE j.venta_id = ?`
  ).all(venta.id);

  const getAnimalitos = db.prepare(
    `SELECT a.* FROM jugada_animalitos ja JOIN animalitos a ON a.id = ja.animalito_id
     WHERE ja.jugada_id = ? ORDER BY ja.posicion`
  );

  const jugadasConAnimalitos = jugadas.map(j => ({ ...j, animalitos: getAnimalitos.all(j.id) }));

  res.json({ venta, jugadas: jugadasConAnimalitos });
});

router.get('/ticket/:codigo', (req, res) => {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE codigo = ?`).get(req.params.codigo);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

  const jugada = db.prepare(
    `SELECT j.*, s.nombre AS sorteo_nombre, s.hora AS sorteo_hora, l.nombre AS loteria_nombre,
            m.nombre AS modo_nombre, m.slug AS modo_slug, m.multiplicador, u.nombre AS vendedor_nombre,
            v.codigo AS venta_codigo
     FROM jugadas j
     JOIN sorteos s ON s.id = j.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     JOIN modos_juego m ON m.id = j.modo_juego_id
     JOIN usuarios u ON u.id = j.usuario_id
     JOIN ventas v ON v.id = j.venta_id
     WHERE j.id = ?`
  ).get(ticket.jugada_id);

  const animalitos = db.prepare(
    `SELECT a.* FROM jugada_animalitos ja JOIN animalitos a ON a.id = ja.animalito_id
     WHERE ja.jugada_id = ? ORDER BY ja.posicion`
  ).all(ticket.jugada_id);

  const pago = db.prepare(`SELECT * FROM pagos_premio WHERE ticket_id = ?`).get(ticket.id);

  res.json({ ticket, jugada, animalitos, pago: pago || null });
});

module.exports = router;

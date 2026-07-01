const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ------------------------------------------------------------
// POST /resultados
// Registra el resultado de un sorteo (animalito ganador) y
// recalcula automaticamente que tickets ganaron.
// El "fuente" indica si vino de auto-busqueda o se cargo manual,
// pero SIEMPRE requiere haber pasado por este endpoint -> es
// decir, siempre hay una accion explicita de carga, nunca se
// paga nada sin que alguien haya confirmado el resultado aqui.
// ------------------------------------------------------------
router.post('/', (req, res) => {
  const { sorteo_id, animalito_id, fecha, fuente } = req.body;
  if (!sorteo_id || !animalito_id) {
    return res.status(400).json({ error: 'sorteo_id y animalito_id son requeridos' });
  }
  const fechaResultado = fecha || new Date().toISOString().slice(0, 10);

  const existente = db.prepare(`SELECT id FROM resultados WHERE sorteo_id = ? AND fecha = ?`).get(sorteo_id, fechaResultado);
  if (existente) {
    return res.status(409).json({ error: 'Ya existe un resultado cargado para este sorteo y fecha', resultado_id: existente.id });
  }

  const r = db.prepare(
    `INSERT INTO resultados (sorteo_id, animalito_id, fecha, confirmado_por, fuente) VALUES (?, ?, ?, ?, ?)`
  ).run(sorteo_id, animalito_id, fechaResultado, req.user.id, fuente || 'manual');

  // Marca como ganadores/perdedores todos los tickets de ese sorteo/fecha.
  // Regla simple: para modo "directo" (1 animalito), gana si coincide.
  // Para modos multi-animalito (tripleta, etc.) se requiere que TODOS
  // los animalitos jugados esten entre los resultados marcados ganadores
  // de esa fecha (pensado para cuando se carguen varios resultados del dia).
  actualizarEstadoTickets(sorteo_id, fechaResultado);

  res.status(201).json({ mensaje: 'Resultado registrado', resultado_id: r.lastInsertRowid });
});

function actualizarEstadoTickets(sorteoId, fecha) {
  const jugadas = db.prepare(
    `SELECT j.id AS jugada_id, m.cantidad_animalitos
     FROM jugadas j JOIN modos_juego m ON m.id = j.modo_juego_id
     WHERE j.sorteo_id = ? AND j.fecha_sorteo = ?`
  ).all(sorteoId, fecha);

  const resultadosAnimalitos = db.prepare(
    `SELECT animalito_id FROM resultados WHERE sorteo_id = ? AND fecha = ?`
  ).all(sorteoId, fecha).map(r => r.animalito_id);

  const updateTicket = db.prepare(
    `UPDATE tickets SET estado = ? WHERE jugada_id = ? AND estado = 'pendiente'`
  );

  for (const j of jugadas) {
    const animalitosJugados = db.prepare(
      `SELECT animalito_id FROM jugada_animalitos WHERE jugada_id = ?`
    ).all(j.jugada_id).map(a => a.animalito_id);

    const todosCoinciden = animalitosJugados.every(id => resultadosAnimalitos.includes(id));
    updateTicket.run(todosCoinciden ? 'ganador' : 'perdedor', j.jugada_id);
  }
}

// ------------------------------------------------------------
// GET /resultados?fecha=YYYY-MM-DD
// Todos los resultados cargados para una fecha dada.
// Usado por la pantalla de Resultados para saber cuales
// sorteos ya tienen resultado y cuales no.
// ------------------------------------------------------------
router.get('/', (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const resultados = db.prepare(
    `SELECT r.*, a.nombre AS animalito_nombre, a.numero AS animalito_numero,
            s.nombre AS sorteo_nombre, s.hora AS sorteo_hora,
            l.nombre AS loteria_nombre, l.id AS loteria_id
     FROM resultados r
     JOIN sorteos s ON s.id = r.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     JOIN animalitos a ON a.id = r.animalito_id
     WHERE r.fecha = ?
     ORDER BY l.nombre, s.hora`
  ).all(fecha);
  res.json(resultados);
});

// ------------------------------------------------------------
// GET /resultados/sorteo/:sorteoId?fecha=YYYY-MM-DD
// ------------------------------------------------------------
router.get('/sorteo/:sorteoId', (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const resultado = db.prepare(
    `SELECT r.*, a.nombre AS animalito_nombre, a.numero AS animalito_numero
     FROM resultados r JOIN animalitos a ON a.id = r.animalito_id
     WHERE r.sorteo_id = ? AND r.fecha = ?`
  ).get(req.params.sorteoId, fecha);
  res.json(resultado || null);
});

// ------------------------------------------------------------
// GET /resultados/ganadores-pendientes?fecha=YYYY-MM-DD
// Panel de tickets ganadores pendientes de pago - el corazon
// del flujo de "buscar ticket y confirmar pago".
// ------------------------------------------------------------
router.get('/ganadores-pendientes', (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

  const tickets = db.prepare(
    `SELECT t.id AS ticket_id, t.codigo, j.monto, j.cliente_nombre, j.cliente_telefono,
            m.nombre AS modo_nombre, m.multiplicador,
            s.nombre AS sorteo_nombre, l.nombre AS loteria_nombre
     FROM tickets t
     JOIN jugadas j ON j.id = t.jugada_id
     JOIN sorteos s ON s.id = j.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     JOIN modos_juego m ON m.id = j.modo_juego_id
     WHERE t.estado = 'ganador' AND j.fecha_sorteo = ? AND j.agencia_id = ?
     ORDER BY t.id DESC`
  ).all(fecha, req.user.agencia_id);

  const conMontoPremio = tickets.map(t => ({ ...t, monto_premio: t.monto * t.multiplicador }));
  res.json(conMontoPremio);
});

module.exports = router;

const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireAdminOrPermiso } = require('../middleware/auth');
const { fechaVenezuelaHoy, ahoraVenezuela, fechaHoraVenezuela } = require('../utils/fechaVenezuela');

const router = express.Router();
router.use(requireAuth);

// ------------------------------------------------------------
// POST /resultados  (solo admin)
// Registra el resultado de un sorteo (animalito ganador) y
// recalcula automaticamente que tickets ganaron.
// El "fuente" indica si vino de auto-busqueda o se cargo manual,
// pero SIEMPRE requiere haber pasado por este endpoint -> es
// decir, siempre hay una accion explicita de carga, nunca se
// paga nada sin que alguien haya confirmado el resultado aqui.
// Mismo permiso que /candidatos/:id/confirmar: cargar un resultado
// oficial equivale a confirmarlo, sin importar si es carga manual
// o confirmacion de un candidato del scraper.
// ------------------------------------------------------------
router.post('/', requireAdminOrPermiso('puede_confirmar_resultados'), (req, res) => {
  const { sorteo_id, animalito_id, fecha, fuente } = req.body;
  if (!sorteo_id || !animalito_id) {
    return res.status(400).json({ error: 'sorteo_id y animalito_id son requeridos' });
  }
  const fechaResultado = fecha || fechaVenezuelaHoy();

  const sorteo = db.prepare(`SELECT * FROM sorteos WHERE id = ?`).get(sorteo_id);
  if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });

  // Guardia de tiempo real: nunca se acepta un resultado para un sorteo
  // que, segun el reloj real en Venezuela, todavia no deberia haber
  // ocurrido -- sin importar de donde venga la carga (scraper, admin
  // confirmando un candidato, o carga manual como esta).
  if (ahoraVenezuela() < fechaHoraVenezuela(fechaResultado, sorteo.hora)) {
    return res.status(409).json({
      error: `El sorteo de las ${sorteo.hora} (${fechaResultado}) todavia no deberia haber ocurrido segun la hora actual en Venezuela -- no se puede cargar un resultado para un sorteo futuro`,
    });
  }

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

  // Si el scraper habia dejado un candidato pendiente/agotado para este
  // mismo sorteo y fecha, resolverlo tambien -- de lo contrario queda
  // huerfano y el panel de "resultados automaticos por revisar" lo sigue
  // mostrando para siempre aunque el sorteo ya tenga resultado oficial.
  db.prepare(
    `UPDATE resultados_candidatos SET estado = 'confirmado', actualizado_en = datetime('now')
     WHERE sorteo_id = ? AND fecha = ? AND estado IN ('pendiente_confirmacion', 'agotado')`
  ).run(sorteo_id, fechaResultado);

  res.status(201).json({ mensaje: 'Resultado registrado', resultado_id: r.lastInsertRowid });
});

// ------------------------------------------------------------
// GET /resultados/candidatos?fecha=YYYY-MM-DD
// Hallazgos del scraper automatico (resultadosAuto.js) pendientes
// de confirmar, o agotados (4 intentos sin exito -> requiere carga
// manual). Usado para la alerta prominente en Dashboard/Resultados.
// ------------------------------------------------------------
router.get('/candidatos', (req, res) => {
  const fecha = req.query.fecha || fechaVenezuelaHoy();
  const candidatos = db.prepare(
    `SELECT rc.*, a.nombre AS animalito_nombre, a.numero AS animalito_numero,
            s.nombre AS sorteo_nombre, s.hora AS sorteo_hora,
            l.nombre AS loteria_nombre
     FROM resultados_candidatos rc
     JOIN sorteos s ON s.id = rc.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     LEFT JOIN animalitos a ON a.id = rc.animalito_id
     WHERE rc.fecha = ? AND rc.estado IN ('pendiente_confirmacion', 'agotado')
     ORDER BY s.hora`
  ).all(fecha);
  res.json(candidatos);
});

// ------------------------------------------------------------
// POST /resultados/candidatos/:id/confirmar  (solo admin)
// El admin confirma un hallazgo del scraper: pasa por la misma
// logica que la carga manual (INSERT en resultados + calculo de
// ganadores), nunca se salta ese paso.
// ------------------------------------------------------------
router.post('/candidatos/:id/confirmar', requireAdminOrPermiso('puede_confirmar_resultados'), (req, res) => {
  const candidato = db.prepare(`SELECT * FROM resultados_candidatos WHERE id = ?`).get(req.params.id);
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });
  if (candidato.estado !== 'pendiente_confirmacion' || !candidato.animalito_id) {
    return res.status(409).json({ error: 'Este candidato no tiene un animalito para confirmar' });
  }

  const sorteo = db.prepare(`SELECT * FROM sorteos WHERE id = ?`).get(candidato.sorteo_id);
  if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });

  // Misma guardia de tiempo real que la carga manual -- por si acaso
  // llega a existir un candidato para un sorteo que todavia no deberia
  // haber ocurrido, no se puede confirmar.
  if (ahoraVenezuela() < fechaHoraVenezuela(candidato.fecha, sorteo.hora)) {
    return res.status(409).json({
      error: `El sorteo de las ${sorteo.hora} (${candidato.fecha}) todavia no deberia haber ocurrido segun la hora actual en Venezuela -- no se puede confirmar un resultado para un sorteo futuro`,
    });
  }

  const existente = db.prepare(`SELECT id FROM resultados WHERE sorteo_id = ? AND fecha = ?`).get(candidato.sorteo_id, candidato.fecha);
  if (existente) {
    return res.status(409).json({ error: 'Ya existe un resultado cargado para este sorteo y fecha' });
  }

  const r = db.prepare(
    `INSERT INTO resultados (sorteo_id, animalito_id, fecha, confirmado_por, fuente) VALUES (?, ?, ?, ?, ?)`
  ).run(candidato.sorteo_id, candidato.animalito_id, candidato.fecha, req.user.id, 'auto_confirmado');

  actualizarEstadoTickets(candidato.sorteo_id, candidato.fecha);

  db.prepare(`UPDATE resultados_candidatos SET estado = 'confirmado', actualizado_en = datetime('now') WHERE id = ?`).run(candidato.id);

  res.json({ mensaje: 'Resultado confirmado', resultado_id: r.lastInsertRowid });
});

// ------------------------------------------------------------
// POST /resultados/candidatos/:id/descartar  (solo admin)
// El admin marca el hallazgo automatico como incorrecto. El
// sorteo queda disponible para carga manual normal.
// ------------------------------------------------------------
router.post('/candidatos/:id/descartar', requireAdminOrPermiso('puede_confirmar_resultados'), (req, res) => {
  const candidato = db.prepare(`SELECT * FROM resultados_candidatos WHERE id = ?`).get(req.params.id);
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });

  db.prepare(`UPDATE resultados_candidatos SET estado = 'descartado', actualizado_en = datetime('now') WHERE id = ?`).run(candidato.id);
  res.json({ mensaje: 'Candidato descartado' });
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
  const fecha = req.query.fecha || fechaVenezuelaHoy();
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
  const fecha = req.query.fecha || fechaVenezuelaHoy();
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
  const fecha = req.query.fecha || fechaVenezuelaHoy();

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

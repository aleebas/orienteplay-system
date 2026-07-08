// ============================================================
// Punto unico donde un resultado se vuelve OFICIAL (tabla
// resultados) y se recalculan ganadores/perdedores. Usado por:
// carga manual (POST /resultados), un admin confirmando un
// candidato del scraper (POST /resultados/candidatos/:id/confirmar),
// y la confirmacion automatica del scraper (resultadosAuto.js).
// Los tres caminos terminan aqui para que nunca puedan divergir en
// como se marca un ticket ganador.
// ============================================================

const db = require('../db/connection');

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

// confirmadoPor: null para confirmaciones automaticas del scraper (no hay
// un usuario humano detras). No dispara ningun pago -- pagar un ticket
// ganador sigue siendo una accion aparte (POST /pagos/:codigoTicket) que
// un cajero hace ticket por ticket.
function registrarResultadoOficial({ sorteoId, animalitoId, fecha, fuente, confirmadoPor }) {
  const existente = db.prepare(`SELECT id FROM resultados WHERE sorteo_id = ? AND fecha = ?`).get(sorteoId, fecha);
  if (existente) return { yaExistia: true, resultadoId: existente.id };

  const r = db.prepare(
    `INSERT INTO resultados (sorteo_id, animalito_id, fecha, confirmado_por, fuente) VALUES (?, ?, ?, ?, ?)`
  ).run(sorteoId, animalitoId, fecha, confirmadoPor ?? null, fuente || 'manual');

  actualizarEstadoTickets(sorteoId, fecha);

  // Si el scraper habia dejado un candidato pendiente/agotado para este
  // mismo sorteo y fecha, resolverlo tambien -- de lo contrario queda
  // huerfano y el panel de "resultados automaticos por revisar" lo sigue
  // mostrando para siempre aunque el sorteo ya tenga resultado oficial.
  db.prepare(
    `UPDATE resultados_candidatos SET estado = 'confirmado', actualizado_en = datetime('now')
     WHERE sorteo_id = ? AND fecha = ? AND estado IN ('pendiente_confirmacion', 'agotado')`
  ).run(sorteoId, fecha);

  return { yaExistia: false, resultadoId: r.lastInsertRowid };
}

module.exports = { registrarResultadoOficial, actualizarEstadoTickets };

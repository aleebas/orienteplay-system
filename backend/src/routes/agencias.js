const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ------------------------------------------------------------
// AGENCIAS
// ------------------------------------------------------------
router.get('/', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT * FROM agencias ORDER BY nombre`).all());
});

router.post('/', requireAdmin, (req, res) => {
  const { nombre, direccion, telefono } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const r = db.prepare(`INSERT INTO agencias (nombre, direccion, telefono) VALUES (?, ?, ?)`).run(nombre, direccion || null, telefono || null);
  res.status(201).json({ id: r.lastInsertRowid, mensaje: 'Agencia creada' });
});

// ------------------------------------------------------------
// LIMITES DE APUESTA (control de banca propia)
// ------------------------------------------------------------
router.get('/:agenciaId/limites', requireAdmin, (req, res) => {
  const limites = db.prepare(
    `SELECT la.*, a.nombre AS animalito_nombre, a.numero AS animalito_numero, l.id AS loteria_id, l.nombre AS loteria_nombre, s.hora AS sorteo_hora
     FROM limites_apuesta la
     JOIN animalitos a ON a.id = la.animalito_id
     JOIN loterias l ON l.id = a.loteria_id
     LEFT JOIN sorteos s ON s.id = la.sorteo_id
     WHERE la.agencia_id = ?
     ORDER BY l.nombre, a.numero`
  ).all(req.params.agenciaId);
  res.json(limites);
});

router.post('/:agenciaId/limites', requireAdmin, (req, res) => {
  const { animalito_id, sorteo_id, monto_max, monto_max_ticket, modo_accion } = req.body;
  if (!animalito_id || !monto_max) {
    return res.status(400).json({ error: 'animalito_id y monto_max son requeridos' });
  }

  const r = db.prepare(
    `INSERT INTO limites_apuesta (agencia_id, animalito_id, sorteo_id, monto_max, monto_max_ticket, modo_accion)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(agencia_id, animalito_id, sorteo_id) DO UPDATE SET
       monto_max = excluded.monto_max,
       monto_max_ticket = excluded.monto_max_ticket,
       modo_accion = excluded.modo_accion,
       activo = 1`
  ).run(req.params.agenciaId, animalito_id, sorteo_id || null, monto_max, monto_max_ticket || null, modo_accion || 'alertar');

  res.status(201).json({ mensaje: 'Limite guardado', id: r.lastInsertRowid });
});

router.delete('/limites/:limiteId', requireAdmin, (req, res) => {
  db.prepare(`UPDATE limites_apuesta SET activo = 0 WHERE id = ?`).run(req.params.limiteId);
  res.json({ mensaje: 'Limite desactivado' });
});

// Desactiva todos los limites de UNA loteria (?loteria_id=X requerido)
// para la agencia. Soft delete (activo = 0), igual que el borrado
// individual de arriba. Para borrar TODOS los limites de la agencia sin
// distinguir loteria, ver DELETE /:agenciaId/limites/todos mas abajo.
router.delete('/:agenciaId/limites', requireAdmin, (req, res) => {
  const { loteria_id } = req.query;
  if (!loteria_id) {
    return res.status(400).json({ error: 'loteria_id es requerido (usa /limites/todos para borrar todos sin filtrar)' });
  }
  const r = db.prepare(
    `UPDATE limites_apuesta SET activo = 0
     WHERE agencia_id = ? AND activo = 1
       AND animalito_id IN (SELECT id FROM animalitos WHERE loteria_id = ?)`
  ).run(req.params.agenciaId, loteria_id);
  res.json({ mensaje: 'Limites de la loteria desactivados', cantidad: r.changes });
});

router.delete('/:agenciaId/limites/todos', requireAdmin, (req, res) => {
  const r = db.prepare(
    `UPDATE limites_apuesta SET activo = 0 WHERE agencia_id = ? AND activo = 1`
  ).run(req.params.agenciaId);
  res.json({ mensaje: 'Todos los limites de la agencia fueron desactivados', cantidad: r.changes });
});

module.exports = router;

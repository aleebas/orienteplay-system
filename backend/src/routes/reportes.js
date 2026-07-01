const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Ventas agrupadas por dia (rango de fechas)
router.get('/ventas-por-dia', (req, res) => {
  const { desde, hasta } = req.query;
  const rows = db.prepare(
    `SELECT fecha_sorteo AS fecha, COUNT(*) AS cantidad_jugadas, SUM(monto) AS total_vendido
     FROM jugadas
     WHERE agencia_id = ? AND fecha_sorteo BETWEEN ? AND ?
     GROUP BY fecha_sorteo ORDER BY fecha_sorteo DESC`
  ).all(req.user.agencia_id, desde || '2000-01-01', hasta || '2999-12-31');
  res.json(rows);
});

// Ventas agrupadas por loteria
router.get('/ventas-por-loteria', (req, res) => {
  const { fecha } = req.query;
  const f = fecha || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT l.nombre AS loteria, COUNT(*) AS cantidad_jugadas, SUM(j.monto) AS total_vendido
     FROM jugadas j
     JOIN sorteos s ON s.id = j.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     WHERE j.agencia_id = ? AND j.fecha_sorteo = ?
     GROUP BY l.id ORDER BY total_vendido DESC`
  ).all(req.user.agencia_id, f);
  res.json(rows);
});

// Ventas agrupadas por vendedor
router.get('/ventas-por-vendedor', (req, res) => {
  const { fecha } = req.query;
  const f = fecha || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT u.nombre AS vendedor, COUNT(*) AS cantidad_jugadas, SUM(j.monto) AS total_vendido
     FROM jugadas j
     JOIN usuarios u ON u.id = j.usuario_id
     WHERE j.agencia_id = ? AND j.fecha_sorteo = ?
     GROUP BY u.id ORDER BY total_vendido DESC`
  ).all(req.user.agencia_id, f);
  res.json(rows);
});

// Ventas recientes del día (últimas N)
router.get('/recientes', (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 10, 50);
  const fecha = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      v.codigo AS codigo_venta,
      v.creada_en,
      SUM(j.monto) AS monto_total,
      COUNT(j.id) AS cantidad_jugadas,
      u.nombre AS vendedor,
      GROUP_CONCAT(DISTINCT l.nombre) AS loterias,
      CASE
        WHEN SUM(CASE WHEN t.estado = 'pagado'   THEN 1 ELSE 0 END) > 0 THEN 'pagado'
        WHEN SUM(CASE WHEN t.estado = 'ganador'  THEN 1 ELSE 0 END) > 0 THEN 'ganador'
        WHEN SUM(CASE WHEN t.estado = 'perdedor' THEN 1 ELSE 0 END) = COUNT(t.id)
             AND COUNT(t.id) > 0 THEN 'perdedor'
        ELSE 'pendiente'
      END AS estado
    FROM ventas v
    JOIN jugadas j ON j.venta_id = v.id
    JOIN usuarios u ON u.id = v.usuario_id
    JOIN sorteos s  ON s.id  = j.sorteo_id
    JOIN loterias l ON l.id  = s.loteria_id
    LEFT JOIN tickets t ON t.jugada_id = j.id
    WHERE v.agencia_id = ? AND DATE(v.creada_en) = ?
    GROUP BY v.id
    ORDER BY v.creada_en DESC
    LIMIT ?
  `).all(req.user.agencia_id, fecha, limite);

  res.json(rows);
});

// Alias: Últimas ventas (mismo que recientes)
router.get('/ultimas-ventas', (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 10, 50);
  const fecha = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      v.codigo AS codigo_venta,
      v.creada_en,
      SUM(j.monto) AS monto_total,
      COUNT(j.id) AS cantidad_jugadas,
      u.nombre AS vendedor,
      a.nombre AS animalito_nombre,
      GROUP_CONCAT(DISTINCT l.nombre) AS loterias,
      CASE
        WHEN SUM(CASE WHEN t.estado = 'pagado'   THEN 1 ELSE 0 END) > 0 THEN 'pagado'
        WHEN SUM(CASE WHEN t.estado = 'ganador'  THEN 1 ELSE 0 END) > 0 THEN 'ganador'
        WHEN SUM(CASE WHEN t.estado = 'perdedor' THEN 1 ELSE 0 END) = COUNT(t.id)
             AND COUNT(t.id) > 0 THEN 'perdedor'
        ELSE 'pendiente'
      END AS estado
    FROM ventas v
    JOIN jugadas j ON j.venta_id = v.id
    JOIN usuarios u ON u.id = v.usuario_id
    JOIN sorteos s  ON s.id  = j.sorteo_id
    JOIN loterias l ON l.id  = s.loteria_id
    JOIN jugada_animalitos ja ON ja.jugada_id = j.id
    JOIN animalitos a ON a.id = ja.animalito_id
    LEFT JOIN tickets t ON t.jugada_id = j.id
    WHERE v.agencia_id = ? AND DATE(v.creada_en) = ?
    GROUP BY v.id
    ORDER BY v.creada_en DESC
    LIMIT ?
  `).all(req.user.agencia_id, fecha, limite);

  res.json(rows);
});

// Límites configurados con uso acumulado del día
router.get('/limites-uso', (req, res) => {
  const fecha = new Date().toISOString().slice(0, 10);
  const agenciaId = req.user.agencia_id;

  const rows = db.prepare(`
    SELECT
      la.id,
      a.nombre AS animalito_nombre,
      a.numero,
      COALESCE(l.nombre, 'Todas las loterías') AS loteria_nombre,
      la.monto_max,
      la.modo_accion,
      COALESCE(SUM(j.monto), 0) AS acumulado
    FROM limites_apuesta la
    JOIN animalitos a ON a.id = la.animalito_id
    LEFT JOIN sorteos s  ON s.id  = la.sorteo_id
    LEFT JOIN loterias l ON l.id  = s.loteria_id
    LEFT JOIN jugada_animalitos ja ON ja.animalito_id = la.animalito_id
    LEFT JOIN jugadas j ON j.id = ja.jugada_id
      AND j.fecha_sorteo = ?
      AND j.agencia_id = ?
      AND (la.sorteo_id IS NULL OR j.sorteo_id = la.sorteo_id)
    WHERE la.agencia_id = ? AND la.activo = 1
    GROUP BY la.id
    ORDER BY (CAST(COALESCE(SUM(j.monto), 0) AS FLOAT) / la.monto_max) DESC
  `).all(fecha, agenciaId, agenciaId);

  res.json(rows);
});

module.exports = router;

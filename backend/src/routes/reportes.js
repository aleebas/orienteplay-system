const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { fechaVenezuelaHoy } = require('../utils/fechaVenezuela');

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
  const f = fecha || fechaVenezuelaHoy();
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
  const f = fecha || fechaVenezuelaHoy();
  const rows = db.prepare(
    `SELECT u.nombre AS vendedor, u.comision_porcentaje, COUNT(*) AS cantidad_jugadas, SUM(j.monto) AS total_vendido
     FROM jugadas j
     JOIN usuarios u ON u.id = j.usuario_id
     WHERE j.agencia_id = ? AND j.fecha_sorteo = ?
     GROUP BY u.id ORDER BY total_vendido DESC`
  ).all(req.user.agencia_id, f).map(r => ({
    ...r,
    comision_ganada: Math.round(r.total_vendido * r.comision_porcentaje / 100 * 100) / 100,
  }));
  res.json(rows);
});

// Ventas recientes del día (últimas N)
router.get('/recientes', (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 10, 50);
  const fecha = fechaVenezuelaHoy();

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
    WHERE v.agencia_id = ? AND j.fecha_sorteo = ?
    GROUP BY v.id
    ORDER BY v.creada_en DESC
    LIMIT ?
  `).all(req.user.agencia_id, fecha, limite);

  res.json(rows);
});

// Alias: Últimas ventas (mismo que recientes)
router.get('/ultimas-ventas', (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 10, 50);
  const fecha = fechaVenezuelaHoy();

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
    WHERE v.agencia_id = ? AND j.fecha_sorteo = ?
    GROUP BY v.id
    ORDER BY v.creada_en DESC
    LIMIT ?
  `).all(req.user.agencia_id, fecha, limite);

  res.json(rows);
});

// Top 5 animalitos con mas dinero apostado en el dia
router.get('/top-animalitos', (req, res) => {
  const f = req.query.fecha || fechaVenezuelaHoy();
  const rows = db.prepare(`
    SELECT a.numero, a.nombre, SUM(j.monto) AS total
    FROM jugada_animalitos ja
    JOIN jugadas j ON j.id = ja.jugada_id
    JOIN animalitos a ON a.id = ja.animalito_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo = ?
    GROUP BY a.id
    ORDER BY total DESC
    LIMIT 5
  `).all(req.user.agencia_id, f);
  res.json(rows);
});

// Top 3 loterias con mas ventas en el dia
router.get('/top-loterias', (req, res) => {
  const f = req.query.fecha || fechaVenezuelaHoy();
  const rows = db.prepare(`
    SELECT l.nombre AS loteria, SUM(j.monto) AS total
    FROM jugadas j
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo = ?
    GROUP BY l.id
    ORDER BY total DESC
    LIMIT 3
  `).all(req.user.agencia_id, f);
  res.json(rows);
});

// Límites configurados con uso acumulado del día
router.get('/limites-uso', (req, res) => {
  const fecha = fechaVenezuelaHoy();
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

// ------------------------------------------------------------
// RENDICION SEMANAL (o cualquier rango de fechas)
// ------------------------------------------------------------
// Desglose por dia, para la agencia del usuario que consulta:
// total vendido, premios pagados, comision estimada y neto. Se agrupa
// siempre por fecha_sorteo (el mismo "dia de negocio" que usa el resto
// de reportes) para que ventas y premios de un mismo dia calcen, en
// vez de usar la fecha real en que se registro/pago cada fila.
// ------------------------------------------------------------
router.get('/rendicion', (req, res) => {
  const { desde, hasta } = req.query;
  const agenciaId = req.user.agencia_id;
  if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });

  const ventasPorDia = db.prepare(`
    SELECT fecha_sorteo AS fecha, COALESCE(SUM(monto), 0) AS total_vendido, COUNT(*) AS cantidad_jugadas
    FROM jugadas
    WHERE agencia_id = ? AND fecha_sorteo BETWEEN ? AND ?
    GROUP BY fecha_sorteo
  `).all(agenciaId, desde, hasta);

  const premiosPorDia = db.prepare(`
    SELECT j.fecha_sorteo AS fecha, COALESCE(SUM(pp.monto_pagado), 0) AS premios_pagados
    FROM pagos_premio pp
    JOIN tickets t ON t.id = pp.ticket_id
    JOIN jugadas j ON j.id = t.jugada_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo BETWEEN ? AND ?
    GROUP BY j.fecha_sorteo
  `).all(agenciaId, desde, hasta);

  const comisionRows = db.prepare(`
    SELECT j.fecha_sorteo AS fecha, j.monto, COALESCE(c.porcentaje, 15) AS porcentaje
    FROM jugadas j
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    LEFT JOIN comisiones c ON c.loteria_id = l.id AND (c.agencia_id = j.agencia_id OR c.agencia_id IS NULL)
    WHERE j.agencia_id = ? AND j.fecha_sorteo BETWEEN ? AND ?
  `).all(agenciaId, desde, hasta);

  const porFecha = new Map();
  const getDia = (fecha) => {
    if (!porFecha.has(fecha)) {
      porFecha.set(fecha, { fecha, total_vendido: 0, cantidad_jugadas: 0, premios_pagados: 0, comision: 0 });
    }
    return porFecha.get(fecha);
  };

  for (const r of ventasPorDia) {
    const d = getDia(r.fecha);
    d.total_vendido = r.total_vendido;
    d.cantidad_jugadas = r.cantidad_jugadas;
  }
  for (const r of premiosPorDia) {
    getDia(r.fecha).premios_pagados = r.premios_pagados;
  }
  for (const r of comisionRows) {
    getDia(r.fecha).comision += r.monto * r.porcentaje / 100;
  }

  const dias = Array.from(porFecha.values())
    .map(d => ({
      ...d,
      comision: Math.round(d.comision * 100) / 100,
      neto: Math.round((d.total_vendido - d.premios_pagados - d.comision) * 100) / 100,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const totales = dias.reduce((acc, d) => ({
    total_vendido: acc.total_vendido + d.total_vendido,
    premios_pagados: acc.premios_pagados + d.premios_pagados,
    comision: Math.round((acc.comision + d.comision) * 100) / 100,
    neto: Math.round((acc.neto + d.neto) * 100) / 100,
  }), { total_vendido: 0, premios_pagados: 0, comision: 0, neto: 0 });

  res.json({ dias, totales });
});

// Misma rendicion pero desglosada por vendedor en vez de por dia (solo
// admin). Los premios se atribuyen al vendedor que hizo la jugada
// ganadora original, no a quien proceso el pago en caja.
router.get('/rendicion-vendedores', requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  const agenciaId = req.user.agencia_id;
  if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });

  const ventasPorVendedor = db.prepare(`
    SELECT u.id AS usuario_id, u.nombre, u.comision_porcentaje,
           COALESCE(SUM(j.monto), 0) AS total_vendido, COUNT(*) AS cantidad_jugadas
    FROM jugadas j
    JOIN usuarios u ON u.id = j.usuario_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY total_vendido DESC
  `).all(agenciaId, desde, hasta);

  const premiosPorVendedor = db.prepare(`
    SELECT j.usuario_id, COALESCE(SUM(pp.monto_pagado), 0) AS premios_pagados
    FROM pagos_premio pp
    JOIN tickets t ON t.id = pp.ticket_id
    JOIN jugadas j ON j.id = t.jugada_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo BETWEEN ? AND ?
    GROUP BY j.usuario_id
  `).all(agenciaId, desde, hasta);

  const premiosMap = new Map(premiosPorVendedor.map(r => [r.usuario_id, r.premios_pagados]));

  const vendedores = ventasPorVendedor.map(v => {
    const comision = Math.round(v.total_vendido * v.comision_porcentaje / 100 * 100) / 100;
    const premios_pagados = premiosMap.get(v.usuario_id) || 0;
    return {
      ...v,
      comision_ganada: comision,
      premios_pagados,
      neto: Math.round((v.total_vendido - premios_pagados - comision) * 100) / 100,
    };
  });

  res.json({ vendedores });
});

// ------------------------------------------------------------
// ADMINISTRACION DE DATOS (solo admin) -- borrado de ventas de un
// rango de fechas, pensado para limpiar datos de prueba. Cascada
// manual (SQLite no tiene ON DELETE CASCADE configurado en estas FK):
// pagos_premio -> tickets -> jugada_animalitos -> jugadas -> ventas.
// Una venta solo se borra si TODAS sus jugadas caen dentro del rango
// -- si combinaba jugadas de dentro y fuera, se deja intacta (la FK
// jugadas.venta_id la protege de quedar huerfana).
// ------------------------------------------------------------
router.get('/admin/borrado-conteo', requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
  const agenciaId = req.user.agencia_id;

  const jugadas = db.prepare(
    `SELECT COUNT(*) AS n FROM jugadas WHERE agencia_id = ? AND fecha_sorteo BETWEEN ? AND ?`
  ).get(agenciaId, desde, hasta).n;

  const tickets = db.prepare(
    `SELECT COUNT(*) AS n FROM tickets t JOIN jugadas j ON j.id = t.jugada_id
     WHERE j.agencia_id = ? AND j.fecha_sorteo BETWEEN ? AND ?`
  ).get(agenciaId, desde, hasta).n;

  const pagos_premio = db.prepare(
    `SELECT COUNT(*) AS n FROM pagos_premio pp
     JOIN tickets t ON t.id = pp.ticket_id JOIN jugadas j ON j.id = t.jugada_id
     WHERE j.agencia_id = ? AND j.fecha_sorteo BETWEEN ? AND ?`
  ).get(agenciaId, desde, hasta).n;

  const ventas = db.prepare(
    `SELECT COUNT(*) AS n FROM ventas v
     WHERE v.agencia_id = ?
       AND EXISTS (SELECT 1 FROM jugadas j WHERE j.venta_id = v.id AND j.fecha_sorteo BETWEEN ? AND ?)
       AND NOT EXISTS (SELECT 1 FROM jugadas j WHERE j.venta_id = v.id AND (j.fecha_sorteo < ? OR j.fecha_sorteo > ?))`
  ).get(agenciaId, desde, hasta, desde, hasta).n;

  res.json({ jugadas, tickets, pagos_premio, ventas });
});

router.delete('/admin/borrado', requireAdmin, (req, res) => {
  const { desde, hasta, confirmacion } = req.body;
  if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
  if (confirmacion !== 'CONFIRMAR BORRADO') {
    return res.status(400).json({ error: 'Debes escribir exactamente "CONFIRMAR BORRADO" para continuar' });
  }
  const agenciaId = req.user.agencia_id;

  const resultado = db.transaction(() => {
    const jugadaIds = db.prepare(
      `SELECT id FROM jugadas WHERE agencia_id = ? AND fecha_sorteo BETWEEN ? AND ?`
    ).all(agenciaId, desde, hasta).map(r => r.id);

    if (jugadaIds.length === 0) {
      return { ventas: 0, jugadas: 0, tickets: 0, pagos_premio: 0 };
    }

    const ph = jugadaIds.map(() => '?').join(',');

    const pagosDel = db.prepare(
      `DELETE FROM pagos_premio WHERE ticket_id IN (SELECT id FROM tickets WHERE jugada_id IN (${ph}))`
    ).run(...jugadaIds);

    const ticketsDel = db.prepare(`DELETE FROM tickets WHERE jugada_id IN (${ph})`).run(...jugadaIds);

    db.prepare(`DELETE FROM jugada_animalitos WHERE jugada_id IN (${ph})`).run(...jugadaIds);

    const ventaIds = db.prepare(
      `SELECT DISTINCT venta_id FROM jugadas WHERE id IN (${ph}) AND venta_id IS NOT NULL`
    ).all(...jugadaIds).map(r => r.venta_id);

    const jugadasDel = db.prepare(`DELETE FROM jugadas WHERE id IN (${ph})`).run(...jugadaIds);

    let ventasDel = { changes: 0 };
    if (ventaIds.length > 0) {
      const vph = ventaIds.map(() => '?').join(',');
      const ventasSinJugadas = db.prepare(
        `SELECT v.id FROM ventas v
         WHERE v.id IN (${vph}) AND NOT EXISTS (SELECT 1 FROM jugadas j WHERE j.venta_id = v.id)`
      ).all(...ventaIds).map(r => r.id);
      if (ventasSinJugadas.length > 0) {
        const vph2 = ventasSinJugadas.map(() => '?').join(',');
        ventasDel = db.prepare(`DELETE FROM ventas WHERE id IN (${vph2})`).run(...ventasSinJugadas);
      }
    }

    return {
      ventas: ventasDel.changes,
      jugadas: jugadasDel.changes,
      tickets: ticketsDel.changes,
      pagos_premio: pagosDel.changes,
    };
  })();

  res.json({ mensaje: 'Datos eliminados', ...resultado });
});

// ------------------------------------------------------------
// CONFIGURACION (tabla generica clave/valor). Lectura: cualquier
// usuario autenticado (ej. el vendedor necesita el numero de WhatsApp
// configurado para el flujo de notificacion de pagos digitales).
// Escritura: solo admin. Whitelist explicita de claves permitidas,
// igual que PERMISO_COLUMNS en middleware/auth.js, para no convertir
// esta tabla generica en un canal de escritura arbitraria.
// ------------------------------------------------------------
const CLAVES_CONFIG_PERMITIDAS = ['whatsapp_pagos_digitales'];

router.get('/configuracion', (req, res) => {
  const rows = db.prepare(`SELECT clave, valor FROM configuracion`).all();
  const config = {};
  for (const r of rows) config[r.clave] = r.valor;
  res.json(config);
});

router.put('/configuracion', requireAdmin, (req, res) => {
  const entradas = Object.entries(req.body || {}).filter(([clave]) => CLAVES_CONFIG_PERMITIDAS.includes(clave));
  if (entradas.length === 0) {
    return res.status(400).json({ error: 'No se recibio ninguna clave de configuracion valida' });
  }

  const upsert = db.prepare(`
    INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, datetime('now'))
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now')
  `);
  db.transaction(() => {
    for (const [clave, valor] of entradas) upsert.run(clave, valor);
  })();

  res.json({ mensaje: 'Configuracion guardada' });
});

module.exports = router;

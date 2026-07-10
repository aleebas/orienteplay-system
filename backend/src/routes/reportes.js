const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { fechaVenezuelaHoy } = require('../utils/fechaVenezuela');
const {
  buscarResultadoElSevero, buscarResultadoLotoven, descargarResultadosElSevero,
  descargarPaginaAnimalitos, extraerSeccionLoteria, parsearResultados,
  normalizarSlug, normalizarHora12,
} = require('../utils/resultadosAuto');

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

// Top 5 animalitos con mas dinero apostado en el dia. Se agrupa por a.id
// (no por numero+nombre) porque cada loteria tiene su propio catalogo de
// animalitos -- el mismo numero puede ser un animal distinto segun la
// loteria, asi que agrupar por id ya evita mezclar loterias sin querer;
// solo faltaba mostrar de cual es cada fila.
router.get('/top-animalitos', (req, res) => {
  const f = req.query.fecha || fechaVenezuelaHoy();
  const rows = db.prepare(`
    SELECT a.numero, a.nombre, l.nombre AS loteria_nombre, SUM(j.monto) AS total
    FROM jugada_animalitos ja
    JOIN jugadas j ON j.id = ja.jugada_id
    JOIN animalitos a ON a.id = ja.animalito_id
    JOIN loterias l ON l.id = a.loteria_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo = ?
    GROUP BY a.id
    ORDER BY total DESC
    LIMIT 5
  `).all(req.user.agencia_id, f);
  res.json(rows);
});

// Estimacion de cuanto habria que pagar HOY si TODOS los tickets todavia
// pendientes (su sorteo aun no tiene resultado oficial cargado) resultaran
// ganadores -- la exposicion/riesgo maximo del dia. Util en un modelo
// self-banking (sin reasegurar apuestas en ningun lado) para saber cuanto
// esta en juego, no cuanto se va a pagar en realidad.
router.get('/premios-potenciales', (req, res) => {
  const f = req.query.fecha || fechaVenezuelaHoy();
  const row = db.prepare(`
    SELECT COALESCE(SUM(j.monto * m.multiplicador), 0) AS total_potencial, COUNT(*) AS cantidad_tickets
    FROM jugadas j
    JOIN tickets t ON t.jugada_id = j.id
    JOIN modos_juego m ON m.id = j.modo_juego_id
    WHERE j.agencia_id = ? AND j.fecha_sorteo = ? AND t.estado = 'pendiente'
  `).get(req.user.agencia_id, f);
  res.json(row);
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

  // Subqueries en vez de LEFT JOIN + OR: con el JOIN, si existiera tanto
  // una fila de comision especifica de la agencia como la fila "default"
  // (agencia_id NULL) para la misma loteria, el OR hacia matchear ambas y
  // la jugada se contaba DOS veces (o mas, si habia filas duplicadas --
  // ver fix en seed.js/connection.js). Con subqueries se toma como maximo
  // una fila: la especifica de la agencia si existe, si no la default.
  const comisionRows = db.prepare(`
    SELECT j.fecha_sorteo AS fecha, j.monto,
      COALESCE(
        (SELECT porcentaje FROM comisiones WHERE loteria_id = l.id AND agencia_id = j.agencia_id),
        (SELECT porcentaje FROM comisiones WHERE loteria_id = l.id AND agencia_id IS NULL LIMIT 1),
        15
      ) AS porcentaje
    FROM jugadas j
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
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

// ------------------------------------------------------------
// DIAGNOSTICO DE RESULTADOS (solo admin, solo lectura) -- compara lo
// guardado en resultados/resultados_candidatos contra lo que las fuentes
// externas (ElSevero, lotoven) muestran AHORA MISMO para el mismo
// sorteo/hora/fecha. No modifica nada. Reusa las mismas funciones que
// usa el scheduler real (resultadosAuto.js) para no reimplementar el
// parseo por separado.
//
// Ej: GET /reportes/admin/diagnostico-resultado?loteria_slug=guacharoactivo&hora=08:00&fecha=2026-07-06
// ------------------------------------------------------------
router.get('/admin/diagnostico-resultado', requireAdmin, async (req, res) => {
  const { loteria_slug, hora, fecha } = req.query;
  if (!loteria_slug || !hora || !fecha) {
    return res.status(400).json({ error: 'loteria_slug, hora y fecha son requeridos' });
  }

  const sorteo = db.prepare(
    `SELECT s.id, s.hora, l.nombre AS loteria_nombre, l.slug AS loteria_slug
     FROM sorteos s JOIN loterias l ON l.id = s.loteria_id
     WHERE l.slug = ? AND s.hora = ?`
  ).get(loteria_slug, hora);
  if (!sorteo) {
    return res.status(404).json({ error: `No existe un sorteo para loteria_slug="${loteria_slug}" hora="${hora}"` });
  }

  const guardadoResultado = db.prepare(
    `SELECT r.*, a.numero AS animalito_numero, a.nombre AS animalito_nombre
     FROM resultados r JOIN animalitos a ON a.id = r.animalito_id
     WHERE r.sorteo_id = ? AND r.fecha = ?`
  ).get(sorteo.id, fecha);

  const guardadoCandidato = db.prepare(
    `SELECT rc.*, a.numero AS animalito_numero, a.nombre AS animalito_nombre
     FROM resultados_candidatos rc LEFT JOIN animalitos a ON a.id = rc.animalito_id
     WHERE rc.sorteo_id = ? AND rc.fecha = ?`
  ).get(sorteo.id, fecha);

  const horaBuscada12h = normalizarHora12(hora);

  // ElSevero: lista completa de la loteria para esta fecha, en vivo.
  let elseveroTodos = [];
  let elseveroError = null;
  try {
    const todos = await descargarResultadosElSevero(fecha);
    elseveroTodos = todos.filter((r) => normalizarSlug(r.loteria || '') === loteria_slug);
  } catch (err) {
    elseveroError = err.message;
  }
  const elseveroMatch = elseveroTodos.find((r) => r.hora === horaBuscada12h) || null;

  // Lotoven: lista completa de la loteria, en vivo -- el sitio no permite
  // pedir una fecha especifica, siempre muestra lo que hay ahora mismo.
  let lotovenTodos = [];
  let lotovenError = null;
  try {
    const html = await descargarPaginaAnimalitos();
    const seccion = extraerSeccionLoteria(html, loteria_slug);
    lotovenTodos = seccion ? parsearResultados(seccion) : [];
  } catch (err) {
    lotovenError = err.message;
  }
  const lotovenMatch = lotovenTodos.find((r) => r.hora === horaBuscada12h) || null;

  res.json({
    consulta: {
      loteria_slug, hora, fecha,
      hora_buscada_12h: horaBuscada12h,
      sorteo_id: sorteo.id,
      loteria_nombre: sorteo.loteria_nombre,
    },
    guardado_en_bd: {
      resultado_oficial: guardadoResultado || null,
      candidato: guardadoCandidato || null,
    },
    elsevero_ahora: {
      error: elseveroError,
      todos_los_de_esta_loteria: elseveroTodos,
      match_para_esta_hora: elseveroMatch,
    },
    lotoven_ahora: {
      error: lotovenError,
      nota: 'lotoven.com no permite pedir una fecha especifica -- esto es lo que la pagina muestra en este momento (normalmente "hoy" real).',
      todos_los_de_esta_loteria: lotovenTodos,
      match_para_esta_hora: lotovenMatch,
    },
  });
});

// ------------------------------------------------------------
// DIAGNOSTICO DE FECHAS SOSPECHOSAS (solo admin, solo lectura) -- barre
// TODA la tabla resultados_candidatos y resultados buscando la firma
// exacta del bug de scheduling encontrado el 06/07/2026: una fila cuyo
// momento real de creacion (convertido a Venezuela) cae en el dia
// ANTERIOR al que la columna `fecha` dice representar. Eso solo es
// posible si en ese momento se conservaba fecha con logica UTC nativa
// en vez de America/Caracas -- exactamente lo que el scraper NO deberia
// poder hacer (solo corre 3+ min despues de la hora real del sorteo).
//
// Para resultados_candidatos se compara contra creado_en directamente.
// Para resultados oficiales:
//   - fuente='auto_confirmado' -> se recupera el creado_en del
//     candidato original (mismo sorteo_id+fecha), porque confirmado_en
//     es el momento en que un admin lo confirmo (tipicamente horas
//     despues) y NO refleja cuando el scraper detecto el dato.
//   - cualquier otra fuente (carga manual) -> se usa confirmado_en
//     directamente, para detectar el otro caso: alguien confirmando a
//     mano un resultado para una fecha que en ese momento todavia no
//     habia empezado.
// ------------------------------------------------------------
// La condicion "creado antes del dia que fecha dice representar" se repite
// para candidatos y resultados -- queda en CTEs para no duplicarla y
// arriesgar que las dos copias diverjan.
const CTE_SOSPECHOSOS = `
  WITH candidatos_malos AS (
    SELECT rc.*
    FROM resultados_candidatos rc
    WHERE date(datetime(rc.creado_en, '-4 hours')) < rc.fecha
  ),
  resultados_malos AS (
    SELECT r.*, COALESCE(rc.creado_en, r.confirmado_en) AS ts_deteccion_utc
    FROM resultados r
    LEFT JOIN resultados_candidatos rc ON rc.sorteo_id = r.sorteo_id AND rc.fecha = r.fecha
    WHERE date(datetime(COALESCE(rc.creado_en, r.confirmado_en), '-4 hours')) < r.fecha
  )
`;

// Por defecto SOLO devuelve numeros (resumen + impacto en tickets) -- el
// detalle completo fila por fila se trunca facil si el problema es masivo.
// Pasar ?detalle=true para incluir los arrays completos.
router.get('/admin/diagnostico-fechas-sospechosas', requireAdmin, (req, res) => {
  const totalCandidatosSospechosos = db.prepare(`${CTE_SOSPECHOSOS} SELECT COUNT(*) AS n FROM candidatos_malos`).get().n;
  const totalResultadosSospechosos = db.prepare(`${CTE_SOSPECHOSOS} SELECT COUNT(*) AS n FROM resultados_malos`).get().n;

  // Desglose por fecha: cuantos resultados/candidatos hay en total ese dia
  // vs. cuantos de esos son sospechosos -- para saber si es TODO el dia o
  // una porcion.
  const porFecha = db.prepare(`
    ${CTE_SOSPECHOSOS}
    SELECT
      todos.fecha,
      COALESCE(rt.total, 0) AS resultados_totales,
      COALESCE(rm.total, 0) AS resultados_sospechosos,
      COALESCE(ct.total, 0) AS candidatos_totales,
      COALESCE(cm.total, 0) AS candidatos_sospechosos
    FROM (
      SELECT fecha FROM resultados
      UNION
      SELECT fecha FROM resultados_candidatos
    ) todos
    LEFT JOIN (SELECT fecha, COUNT(*) AS total FROM resultados GROUP BY fecha) rt ON rt.fecha = todos.fecha
    LEFT JOIN (SELECT fecha, COUNT(*) AS total FROM resultados_malos GROUP BY fecha) rm ON rm.fecha = todos.fecha
    LEFT JOIN (SELECT fecha, COUNT(*) AS total FROM resultados_candidatos GROUP BY fecha) ct ON ct.fecha = todos.fecha
    LEFT JOIN (SELECT fecha, COUNT(*) AS total FROM candidatos_malos GROUP BY fecha) cm ON cm.fecha = todos.fecha
    ORDER BY todos.fecha DESC
    LIMIT 14
  `).all();

  // Impacto real en tickets: todas las jugadas/tickets del mismo
  // sorteo_id+fecha_sorteo que un resultado sospechoso, y cuantos de esos
  // tickets ya tienen un pago registrado (el numero mas urgente).
  const impactoTickets = db.prepare(`
    ${CTE_SOSPECHOSOS}
    SELECT
      COUNT(DISTINCT t.id) AS tickets_afectados,
      SUM(CASE WHEN t.estado = 'ganador'   THEN 1 ELSE 0 END) AS tickets_ganador,
      SUM(CASE WHEN t.estado = 'perdedor'  THEN 1 ELSE 0 END) AS tickets_perdedor,
      SUM(CASE WHEN t.estado = 'pagado'    THEN 1 ELSE 0 END) AS tickets_pagado,
      SUM(CASE WHEN t.estado = 'pendiente' THEN 1 ELSE 0 END) AS tickets_pendiente,
      SUM(CASE WHEN t.estado = 'anulado'   THEN 1 ELSE 0 END) AS tickets_anulado,
      COUNT(DISTINCT pp.id) AS pagos_ya_realizados,
      COALESCE(SUM(pp.monto_pagado), 0) AS monto_ya_pagado
    FROM resultados_malos rmal
    JOIN jugadas j ON j.sorteo_id = rmal.sorteo_id AND j.fecha_sorteo = rmal.fecha
    JOIN tickets t ON t.jugada_id = j.id
    LEFT JOIN pagos_premio pp ON pp.ticket_id = t.id
  `).get();

  const respuesta = {
    resumen: {
      total_candidatos_sospechosos: totalCandidatosSospechosos,
      total_resultados_sospechosos: totalResultadosSospechosos,
      por_fecha: porFecha,
    },
    impacto_tickets: impactoTickets,
  };

  if (req.query.detalle === 'true') {
    respuesta.candidatos_sospechosos = db.prepare(`
      ${CTE_SOSPECHOSOS}
      SELECT cm.id, l.nombre AS loteria_nombre, s.hora AS sorteo_hora, cm.fecha,
             cm.estado, cm.intentos,
             cm.creado_en AS timestamp_utc,
             datetime(cm.creado_en, '-4 hours') AS timestamp_ve,
             date(datetime(cm.creado_en, '-4 hours')) AS dia_real_creacion,
             a.numero AS animalito_numero, a.nombre AS animalito_nombre
      FROM candidatos_malos cm
      JOIN sorteos s ON s.id = cm.sorteo_id
      JOIN loterias l ON l.id = s.loteria_id
      LEFT JOIN animalitos a ON a.id = cm.animalito_id
      ORDER BY cm.fecha DESC
    `).all();

    respuesta.resultados_sospechosos = db.prepare(`
      ${CTE_SOSPECHOSOS}
      SELECT rmal.id, l.nombre AS loteria_nombre, s.hora AS sorteo_hora, rmal.fecha, rmal.fuente,
             rmal.ts_deteccion_utc AS timestamp_utc,
             datetime(rmal.ts_deteccion_utc, '-4 hours') AS timestamp_ve,
             date(datetime(rmal.ts_deteccion_utc, '-4 hours')) AS dia_real_creacion,
             rmal.confirmado_en,
             a.numero AS animalito_numero, a.nombre AS animalito_nombre
      FROM resultados_malos rmal
      JOIN sorteos s ON s.id = rmal.sorteo_id
      JOIN loterias l ON l.id = s.loteria_id
      JOIN animalitos a ON a.id = rmal.animalito_id
      ORDER BY rmal.fecha DESC
    `).all();
  }

  res.json(respuesta);
});

// ------------------------------------------------------------
// DETALLE DE PAGOS SOBRE RESULTADOS SOSPECHOSOS (solo admin, solo
// lectura) -- de los tickets que YA fueron pagados y cuyo resultado
// cae dentro de la firma sospechosa (ver CTE_SOSPECHOSOS arriba),
// compara: el animalito por el que apostó el cliente, el animalito
// que quedó guardado como oficial (el sospechoso) y el animalito REAL
// segun ElSevero para esa fecha historica especifica (ElSevero si
// acepta fecha como parametro, a diferencia de lotoven). No modifica
// nada -- pensado para decidir, caso por caso, si el pago ya hecho fue
// correcto por coincidencia o hay que reconciliarlo.
// ------------------------------------------------------------
router.get('/admin/diagnostico-pagos-sospechosos', requireAdmin, async (req, res) => {
  const pagos = db.prepare(`
    ${CTE_SOSPECHOSOS}
    SELECT
      t.id AS ticket_id, t.codigo AS ticket_codigo,
      v.codigo AS venta_codigo,
      j.id AS jugada_id, j.fecha_sorteo, j.monto AS monto_apostado,
      s.hora AS sorteo_hora, l.nombre AS loteria_nombre, l.slug AS loteria_slug,
      ag.numero AS animalito_guardado_numero, ag.nombre AS animalito_guardado_nombre,
      pp.monto_pagado, pp.pagado_en
    FROM pagos_premio pp
    JOIN tickets t ON t.id = pp.ticket_id
    JOIN jugadas j ON j.id = t.jugada_id
    JOIN ventas v ON v.id = j.venta_id
    JOIN sorteos s ON s.id = j.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    JOIN resultados_malos rmal ON rmal.sorteo_id = j.sorteo_id AND rmal.fecha = j.fecha_sorteo
    JOIN animalitos ag ON ag.id = rmal.animalito_id
    ORDER BY pp.pagado_en DESC
  `).all();

  const getAnimalitosApostados = db.prepare(`
    SELECT a.numero, a.nombre
    FROM jugada_animalitos ja JOIN animalitos a ON a.id = ja.animalito_id
    WHERE ja.jugada_id = ? ORDER BY ja.posicion
  `);

  const detalle = [];
  for (const p of pagos) {
    const animalitosApostados = getAnimalitosApostados.all(p.jugada_id);

    let animalitoReal = null;
    let errorElSevero = null;
    try {
      const todos = await descargarResultadosElSevero(p.fecha_sorteo);
      const horaBuscada = normalizarHora12(p.sorteo_hora);
      const match = todos.find(
        (r) => normalizarSlug(r.loteria || '') === p.loteria_slug && r.hora === horaBuscada
      );
      animalitoReal = match ? { numero: String(match.numero), nombre: String(match.nombre).toUpperCase() } : null;
    } catch (err) {
      errorElSevero = err.message;
    }

    // Misma regla que actualizarEstadoTickets: TODOS los animalitos
    // apostados deben coincidir con el (unico) animalito ganador real.
    const pagoCorrecto = animalitoReal
      ? animalitosApostados.every((a) => a.numero === animalitoReal.numero)
      : null; // null = no se pudo verificar contra ElSevero

    detalle.push({
      ticket_codigo: p.ticket_codigo,
      venta_codigo: p.venta_codigo,
      fecha_sorteo: p.fecha_sorteo,
      loteria_nombre: p.loteria_nombre,
      sorteo_hora: p.sorteo_hora,
      monto_apostado: p.monto_apostado,
      monto_pagado: p.monto_pagado,
      pagado_en: p.pagado_en,
      animalitos_apostados: animalitosApostados,
      animalito_guardado_sospechoso: {
        numero: p.animalito_guardado_numero,
        nombre: p.animalito_guardado_nombre,
      },
      animalito_real_elsevero: animalitoReal,
      error_elsevero: errorElSevero,
      pago_correcto: pagoCorrecto,
    });
  }

  res.json({ pagos_sospechosos: detalle });
});

// ------------------------------------------------------------
// CORRECCION GUIADA DE RESULTADOS SOSPECHOSOS -- Paso A: preview
// (solo admin, solo lectura). Para cada resultado oficial sospechoso,
// re-consulta ElSevero con la FECHA HISTORICA especifica de ese sorteo
// (a diferencia de lotoven, ElSevero si acepta fecha como parametro) y
// compara contra lo guardado. Si difieren, calcula ademas cuantos
// tickets cambiarian de estado si se corrigiera (informativo -- este
// endpoint NO modifica nada, ni resultados ni tickets). Los tickets
// 'anulado' nunca se recalculan (quedan anulados sin importar el
// resultado real). Los 'pagado' que cambiarian a algo != 'ganador' se
// cuentan aparte por ser el caso mas critico (dinero ya entregado).
// ------------------------------------------------------------
router.get('/admin/correccion-resultados-preview', requireAdmin, async (req, res) => {
  const resultadosMalos = db.prepare(`
    ${CTE_SOSPECHOSOS}
    SELECT rmal.id, rmal.sorteo_id, rmal.fecha, rmal.animalito_id,
           l.nombre AS loteria_nombre, l.slug AS loteria_slug, s.hora AS sorteo_hora,
           ag.numero AS numero_actual, ag.nombre AS nombre_actual
    FROM resultados_malos rmal
    JOIN sorteos s ON s.id = rmal.sorteo_id
    JOIN loterias l ON l.id = s.loteria_id
    JOIN animalitos ag ON ag.id = rmal.animalito_id
    ORDER BY rmal.fecha DESC, s.hora
  `).all();

  const getAnimalitoIdPorNumero = db.prepare(
    `SELECT id FROM animalitos WHERE loteria_id = (SELECT loteria_id FROM sorteos WHERE id = ?) AND numero = ?`
  );
  const getJugadasTickets = db.prepare(`
    SELECT j.id AS jugada_id, t.id AS ticket_id, t.estado AS estado_actual
    FROM jugadas j JOIN tickets t ON t.jugada_id = j.id
    WHERE j.sorteo_id = ? AND j.fecha_sorteo = ?
  `);
  const getAnimalitosDeJugada = db.prepare(`SELECT animalito_id FROM jugada_animalitos WHERE jugada_id = ?`);

  const preview = [];
  for (const r of resultadosMalos) {
    let animalitoReal = null;
    let errorElSevero = null;
    try {
      const todos = await descargarResultadosElSevero(r.fecha);
      const horaBuscada = normalizarHora12(r.sorteo_hora);
      const match = todos.find((x) => normalizarSlug(x.loteria || '') === r.loteria_slug && x.hora === horaBuscada);
      animalitoReal = match ? { numero: String(match.numero), nombre: String(match.nombre).toUpperCase() } : null;
    } catch (err) {
      errorElSevero = err.message;
    }

    const requiereCorreccion = !!(animalitoReal && animalitoReal.numero !== r.numero_actual);
    let animalitoIdCorrecto = null;
    if (requiereCorreccion) {
      const fila = getAnimalitoIdPorNumero.get(r.sorteo_id, animalitoReal.numero);
      animalitoIdCorrecto = fila ? fila.id : null;
    }

    let impacto = null;
    if (requiereCorreccion && animalitoIdCorrecto) {
      const jugadas = getJugadasTickets.all(r.sorteo_id, r.fecha);
      const cambiosMap = new Map();
      let pagadosQueCambiarian = 0;
      for (const j of jugadas) {
        if (j.estado_actual === 'anulado') continue; // nunca se recalcula
        const apostados = getAnimalitosDeJugada.all(j.jugada_id).map((a) => a.animalito_id);
        const ganaria = apostados.every((id) => id === animalitoIdCorrecto);
        const estadoPropuesto = ganaria ? 'ganador' : 'perdedor';
        if (estadoPropuesto !== j.estado_actual) {
          const key = `${j.estado_actual}->${estadoPropuesto}`;
          cambiosMap.set(key, (cambiosMap.get(key) || 0) + 1);
          if (j.estado_actual === 'pagado' && estadoPropuesto !== 'ganador') pagadosQueCambiarian++;
        }
      }
      impacto = {
        total_tickets: jugadas.length,
        cambiarian_de_estado: Array.from(cambiosMap.values()).reduce((s, n) => s + n, 0),
        detalle: Array.from(cambiosMap.entries()).map(([k, cantidad]) => {
          const [estado_actual, estado_propuesto] = k.split('->');
          return { estado_actual, estado_propuesto, cantidad };
        }),
        pagados_que_cambiarian: pagadosQueCambiarian,
      };
    }

    preview.push({
      resultado_id: r.id,
      sorteo_id: r.sorteo_id,
      fecha: r.fecha,
      loteria_nombre: r.loteria_nombre,
      sorteo_hora: r.sorteo_hora,
      animalito_actual: { numero: r.numero_actual, nombre: r.nombre_actual },
      animalito_real: animalitoReal,
      error_elsevero: errorElSevero,
      requiere_correccion: requiereCorreccion,
      animalito_id_correcto: animalitoIdCorrecto,
      impacto_tickets: impacto,
    });
  }

  // Categorias mutuamente excluyentes -- deben sumar exactamente `total`.
  // Ojo: un resultado con animalito_real=null (ElSevero no trae esa hora
  // para esa loteria/fecha, sin lanzar excepcion) tiene error_elsevero=null
  // Y requiere_correccion=false -- eso lo hacia caer tanto en "sin_cambios"
  // como en "sin_verificar" a la vez (bug: los numeros no sumaban el total).
  const sinVerificar = preview.filter((p) => p.error_elsevero || !p.animalito_real).length;
  const requierenCorreccion = preview.filter((p) => p.requiere_correccion).length;
  const sinCambios = preview.filter((p) => !p.requiere_correccion && p.animalito_real && !p.error_elsevero).length;

  // Verificacion cruzada del impacto en tickets. OJO: la primera version de
  // esto comparaba contra el agregado de /diagnostico-fechas-sospechosas
  // (299), que cuenta tickets de TODOS los resultados con firma de timing
  // sospechosa, sin filtrar por si el animalito guardado realmente esta mal
  // -- incluye resultados que resultaron ser correctos por coincidencia
  // (sin_cambios), cuyos tickets mi calculo por-fila NO debe sumar (no hay
  // nada que corregir ahi). Comparar 299 (universo completo) contra mi suma
  // (solo los que SI requieren correccion) daba un falso rojo -- no es que
  // el join estuviera mal, es que eran dos preguntas distintas. Ahora se
  // recalcula el agregado filtrado a los MISMOS resultado_id que arriba se
  // marcaron requiere_correccion=true, para comparar manzanas con manzanas.
  const idsRequierenCorreccion = preview.filter((p) => p.requiere_correccion).map((p) => p.resultado_id);
  let impactoAgregadoReal = { tickets_afectados: 0 };
  if (idsRequierenCorreccion.length > 0) {
    const placeholders = idsRequierenCorreccion.map(() => '?').join(',');
    impactoAgregadoReal = db.prepare(`
      ${CTE_SOSPECHOSOS}
      SELECT COUNT(DISTINCT t.id) AS tickets_afectados
      FROM resultados_malos rmal
      JOIN jugadas j ON j.sorteo_id = rmal.sorteo_id AND j.fecha_sorteo = rmal.fecha
      JOIN tickets t ON t.jugada_id = j.id
      WHERE rmal.id IN (${placeholders})
    `).get(...idsRequierenCorreccion);
  }
  const sumaImpactoPorFila = preview.reduce((s, p) => s + (p.impacto_tickets?.total_tickets || 0), 0);

  res.json({
    total: preview.length,
    requieren_correccion: requierenCorreccion,
    sin_cambios: sinCambios,
    sin_verificar: sinVerificar,
    verificacion_impacto: {
      tickets_afectados_agregado_real: impactoAgregadoReal.tickets_afectados,
      suma_total_tickets_por_fila: sumaImpactoPorFila,
      coincide: impactoAgregadoReal.tickets_afectados === sumaImpactoPorFila,
    },
    resultados: preview,
  });
});

// ------------------------------------------------------------
// DETALLE DE TICKETS DE UN RESULTADO ESPECIFICO (solo admin, solo
// lectura) -- para revisar caso por caso (cliente, monto, si ya tiene
// pago) antes de decidir aplicar la correccion sobre ese sorteo/fecha.
// Recalcula el animalito real/correcto igual que el preview general.
// ------------------------------------------------------------
router.get('/admin/correccion-resultados-preview/:resultadoId/tickets', requireAdmin, async (req, res) => {
  const resultado = db.prepare(`SELECT * FROM resultados WHERE id = ?`).get(req.params.resultadoId);
  if (!resultado) return res.status(404).json({ error: 'Resultado no encontrado' });

  const sorteo = db.prepare(
    `SELECT s.*, l.nombre AS loteria_nombre, l.slug AS loteria_slug
     FROM sorteos s JOIN loterias l ON l.id = s.loteria_id WHERE s.id = ?`
  ).get(resultado.sorteo_id);

  let animalitoReal = null;
  let errorElSevero = null;
  try {
    const todos = await descargarResultadosElSevero(resultado.fecha);
    const horaBuscada = normalizarHora12(sorteo.hora);
    const match = todos.find((x) => normalizarSlug(x.loteria || '') === sorteo.loteria_slug && x.hora === horaBuscada);
    animalitoReal = match ? { numero: String(match.numero), nombre: String(match.nombre).toUpperCase() } : null;
  } catch (err) {
    errorElSevero = err.message;
  }

  let animalitoIdCorrecto = null;
  if (animalitoReal) {
    const fila = db.prepare(`SELECT id FROM animalitos WHERE loteria_id = ? AND numero = ?`).get(sorteo.loteria_id, animalitoReal.numero);
    animalitoIdCorrecto = fila ? fila.id : null;
  }

  const jugadas = db.prepare(`
    SELECT j.id AS jugada_id, j.monto, j.cliente_nombre, j.cliente_telefono,
           t.id AS ticket_id, t.codigo AS ticket_codigo, t.estado AS estado_actual,
           v.codigo AS venta_codigo, u.nombre AS vendedor_nombre
    FROM jugadas j
    JOIN tickets t ON t.jugada_id = j.id
    JOIN ventas v ON v.id = j.venta_id
    JOIN usuarios u ON u.id = j.usuario_id
    WHERE j.sorteo_id = ? AND j.fecha_sorteo = ?
    ORDER BY t.codigo
  `).all(resultado.sorteo_id, resultado.fecha);

  const getAnimalitosDeJugada = db.prepare(`
    SELECT a.id AS animalito_id, a.numero, a.nombre
    FROM jugada_animalitos ja JOIN animalitos a ON a.id = ja.animalito_id
    WHERE ja.jugada_id = ? ORDER BY ja.posicion
  `);
  const getPago = db.prepare(`SELECT * FROM pagos_premio WHERE ticket_id = ?`);

  const tickets = jugadas.map((j) => {
    const animalitosApostados = getAnimalitosDeJugada.all(j.jugada_id);
    const estadoPropuesto = j.estado_actual === 'anulado'
      ? 'anulado'
      : (animalitoIdCorrecto && animalitosApostados.every((a) => a.animalito_id === animalitoIdCorrecto) ? 'ganador' : 'perdedor');
    const pago = getPago.get(j.ticket_id);
    return {
      ticket_codigo: j.ticket_codigo,
      venta_codigo: j.venta_codigo,
      cliente_nombre: j.cliente_nombre,
      cliente_telefono: j.cliente_telefono,
      vendedor_nombre: j.vendedor_nombre,
      monto: j.monto,
      animalitos_apostados: animalitosApostados.map((a) => ({ numero: a.numero, nombre: a.nombre })),
      estado_actual: j.estado_actual,
      estado_propuesto: estadoPropuesto,
      cambia: estadoPropuesto !== j.estado_actual,
      ya_pagado: !!pago,
      pago: pago || null,
    };
  });

  res.json({
    resultado_id: resultado.id,
    fecha: resultado.fecha,
    loteria_nombre: sorteo.loteria_nombre,
    sorteo_hora: sorteo.hora,
    animalito_real: animalitoReal,
    error_elsevero: errorElSevero,
    tickets,
  });
});

// ------------------------------------------------------------
// CORRECCION GUIADA DE RESULTADOS SOSPECHOSOS -- Paso B: aplicar
// (solo admin). Recibe la lista EXACTA de correcciones que el admin
// revisó en el preview (resultado_id + animalito_id_correcto, tal
// cual se mostraron ahí -- no se vuelve a consultar ElSevero acá, para
// que lo que se aplica sea exactamente lo que el admin confirmó, no
// "lo que ElSevero diga en este momento"). Solo actualiza
// resultados.animalito_id -- los tickets se recalculan en un paso
// aparte (Paso 3), con su propia confirmación explícita.
// ------------------------------------------------------------
router.post('/admin/correccion-resultados-aplicar', requireAdmin, (req, res) => {
  const { correcciones, confirmacion } = req.body;
  if (confirmacion !== 'CONFIRMAR CORRECCION') {
    return res.status(400).json({ error: 'Debes enviar confirmacion exacta "CONFIRMAR CORRECCION" para continuar' });
  }
  if (!Array.isArray(correcciones) || correcciones.length === 0) {
    return res.status(400).json({ error: 'correcciones debe ser un arreglo no vacio de { resultado_id, animalito_id_correcto }' });
  }

  const getResultado = db.prepare(`SELECT * FROM resultados WHERE id = ?`);
  const getAnimalito = db.prepare(`SELECT * FROM animalitos WHERE id = ?`);
  const getSorteo = db.prepare(`SELECT * FROM sorteos WHERE id = ?`);
  const updateResultado = db.prepare(`UPDATE resultados SET animalito_id = ? WHERE id = ?`);

  const aplicar = db.transaction(() => {
    const aplicados = [];
    for (const c of correcciones) {
      const resultado = getResultado.get(c.resultado_id);
      if (!resultado) throw new Error(`Resultado ${c.resultado_id} no encontrado`);

      const animalito = getAnimalito.get(c.animalito_id_correcto);
      if (!animalito) throw new Error(`Animalito ${c.animalito_id_correcto} no encontrado`);

      const sorteo = getSorteo.get(resultado.sorteo_id);
      if (animalito.loteria_id !== sorteo.loteria_id) {
        throw new Error(`El animalito ${c.animalito_id_correcto} no pertenece a la loteria del resultado ${c.resultado_id}`);
      }

      updateResultado.run(c.animalito_id_correcto, c.resultado_id);
      aplicados.push({
        resultado_id: c.resultado_id,
        animalito_anterior: resultado.animalito_id,
        animalito_nuevo: c.animalito_id_correcto,
      });
    }
    return aplicados;
  });

  try {
    const aplicados = aplicar();
    res.json({
      mensaje: `${aplicados.length} resultado(s) corregido(s). Los tickets todavía NO fueron recalculados (eso es el paso siguiente).`,
      aplicados,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CORRECCION GUIADA DE RESULTADOS SOSPECHOSOS -- Paso C: recalcular
// tickets (solo admin). Recibe la lista EXACTA de resultado_id que se
// corrigieron en el Paso B y recalcula el estado de sus tickets contra
// el animalito_id (ya corregido) de cada resultado.
//
// Reglas de seguridad, no negociables:
//  - Un ticket 'anulado' nunca se toca.
//  - Un ticket 'pagado' NUNCA se cambia automaticamente -- si el nuevo
//    calculo dice que ya no deberia ser ganador, se reporta en
//    "bloqueados_por_pago" para que un humano decida (revertir un pago
//    ya hecho es una decision de negocio/contable, no una UPDATE).
//  - Todo o nada: si un resultado_id no existe, no se aplica ningun
//    cambio de ningun otro.
// ------------------------------------------------------------
router.post('/admin/correccion-resultados-recalcular-tickets', requireAdmin, (req, res) => {
  const { resultado_ids, confirmacion } = req.body;
  if (confirmacion !== 'CONFIRMAR RECALCULO') {
    return res.status(400).json({ error: 'Debes enviar confirmacion exacta "CONFIRMAR RECALCULO" para continuar' });
  }
  if (!Array.isArray(resultado_ids) || resultado_ids.length === 0) {
    return res.status(400).json({ error: 'resultado_ids debe ser un arreglo no vacio' });
  }

  const getResultado = db.prepare(`SELECT * FROM resultados WHERE id = ?`);
  const getJugadasTickets = db.prepare(`
    SELECT j.id AS jugada_id, t.id AS ticket_id, t.codigo AS ticket_codigo, t.estado AS estado_actual
    FROM jugadas j JOIN tickets t ON t.jugada_id = j.id
    WHERE j.sorteo_id = ? AND j.fecha_sorteo = ?
  `);
  const getAnimalitosDeJugada = db.prepare(`SELECT animalito_id FROM jugada_animalitos WHERE jugada_id = ?`);
  const updateTicket = db.prepare(`UPDATE tickets SET estado = ? WHERE id = ?`);

  const recalcular = db.transaction(() => {
    const resumen = [];
    for (const resultadoId of resultado_ids) {
      const resultado = getResultado.get(resultadoId);
      if (!resultado) throw new Error(`Resultado ${resultadoId} no encontrado`);

      const jugadas = getJugadasTickets.all(resultado.sorteo_id, resultado.fecha);
      let cambiados = 0;
      const bloqueadosPorPago = [];
      for (const j of jugadas) {
        if (j.estado_actual === 'anulado') continue;

        const apostados = getAnimalitosDeJugada.all(j.jugada_id).map((a) => a.animalito_id);
        const ganaria = apostados.every((id) => id === resultado.animalito_id);
        const propuesto = ganaria ? 'ganador' : 'perdedor';

        if (j.estado_actual === 'pagado') {
          if (propuesto !== 'ganador') bloqueadosPorPago.push({ ticket_id: j.ticket_id, ticket_codigo: j.ticket_codigo, estado_propuesto: propuesto });
          continue;
        }
        if (propuesto !== j.estado_actual) {
          updateTicket.run(propuesto, j.ticket_id);
          cambiados++;
        }
      }
      resumen.push({
        resultado_id: resultadoId, sorteo_id: resultado.sorteo_id, fecha: resultado.fecha,
        tickets_evaluados: jugadas.length, tickets_cambiados: cambiados, bloqueados_por_pago: bloqueadosPorPago,
      });
    }
    return resumen;
  });

  try {
    const resumen = recalcular();
    const totalCambiados = resumen.reduce((s, r) => s + r.tickets_cambiados, 0);
    const totalBloqueados = resumen.reduce((s, r) => s + r.bloqueados_por_pago.length, 0);
    res.json({
      mensaje: `${totalCambiados} ticket(s) recalculado(s).` + (totalBloqueados ? ` ${totalBloqueados} ticket(s) ya pagado(s) NO se tocaron -- requieren revision manual.` : ''),
      total_cambiados: totalCambiados,
      total_bloqueados_por_pago: totalBloqueados,
      resumen,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { fechaVenezuelaHoy, fechaVenezuelaDeTimestampSqlite } = require('../utils/fechaVenezuela');

const router = express.Router();
router.use(requireAuth);

// Devuelve la caja abierta actualmente para la agencia del usuario
// (una agencia puede tener una caja general compartida entre vendedores,
// o cada vendedor puede manejar la suya - aqui la dejamos por agencia,
// se puede ajustar a "por usuario" facilmente si se prefiere)
router.get('/actual', (req, res) => {
  const caja = db.prepare(
    `SELECT * FROM cajas WHERE agencia_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1`
  ).get(req.user.agencia_id);
  res.json(caja || null);
});

router.post('/abrir', (req, res) => {
  const { monto_inicial, fondo_banco } = req.body;
  const yaAbierta = db.prepare(
    `SELECT id, abierta_en FROM cajas WHERE agencia_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1`
  ).get(req.user.agencia_id);

  if (yaAbierta) {
    const fechaCaja = fechaVenezuelaDeTimestampSqlite(yaAbierta.abierta_en);
    // Si la caja abierta es de un dia anterior (se quedo sin declarar),
    // no se trata como el caso normal de "ya hay una caja abierta hoy":
    // hay que obligar a cerrarla primero antes de poder abrir una nueva.
    if (fechaCaja !== fechaVenezuelaHoy()) {
      return res.status(409).json({
        error: `Tienes una caja abierta del ${fechaCaja} sin declarar. Debes cerrarla antes de abrir una nueva.`,
        requiere_cierre_anterior: true,
        caja_id: yaAbierta.id,
        fecha_caja_abierta: fechaCaja,
      });
    }
    return res.status(400).json({ error: 'Ya existe una caja abierta para esta agencia', caja_id: yaAbierta.id });
  }

  const r = db.prepare(
    `INSERT INTO cajas (agencia_id, usuario_apertura_id, monto_inicial, fondo_banco) VALUES (?, ?, ?, ?)`
  ).run(req.user.agencia_id, req.user.id, monto_inicial || 0, fondo_banco || 0);

  res.json({ id: r.lastInsertRowid, mensaje: 'Caja abierta' });
});

router.post('/:id/cerrar', (req, res) => {
  const { monto_final_declarado } = req.body;
  const caja = db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(req.params.id);
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
  if (caja.estado === 'cerrada') return res.status(400).json({ error: 'La caja ya esta cerrada' });

  db.prepare(
    `UPDATE cajas SET estado = 'cerrada', usuario_cierre_id = ?, monto_final_declarado = ?, cerrada_en = datetime('now') WHERE id = ?`
  ).run(req.user.id, monto_final_declarado, req.params.id);

  // Resumen del cierre: ventas totales, premios pagados, comision, diferencia
  const resumen = calcularResumenCaja(req.params.id);
  res.json({ mensaje: 'Caja cerrada', resumen });
});

router.get('/:id/resumen', (req, res) => {
  res.json(calcularResumenCaja(req.params.id));
});

function calcularResumenCaja(cajaId) {
  const caja = db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(cajaId);

  const ventas = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM jugadas WHERE caja_id = ?`
  ).get(cajaId);

  const premiosPagados = db.prepare(
    `SELECT COALESCE(SUM(monto_pagado), 0) AS total, COUNT(*) AS cantidad FROM pagos_premio WHERE caja_id = ?`
  ).get(cajaId);

  // Comision estimada: suma de (venta * % comision de su loteria)
  const comisionRows = db.prepare(
    `SELECT j.monto, COALESCE(c.porcentaje, 15) AS porcentaje
     FROM jugadas j
     JOIN sorteos s ON s.id = j.sorteo_id
     JOIN loterias l ON l.id = s.loteria_id
     LEFT JOIN comisiones c ON c.loteria_id = l.id AND (c.agencia_id = j.agencia_id OR c.agencia_id IS NULL)
     WHERE j.caja_id = ?`
  ).all(cajaId);

  const comisionTotal = comisionRows.reduce((acc, r) => acc + (r.monto * r.porcentaje / 100), 0);

  const efectivoEsperado = (caja.monto_inicial || 0) + ventas.total - premiosPagados.total;

  // Comision de operadora ganada por cada vendedor que vendio en esta caja,
  // segun su comision_porcentaje configurado en usuarios.
  const comisionesVendedores = db.prepare(
    `SELECT u.id AS usuario_id, u.nombre, u.comision_porcentaje,
            SUM(j.monto) AS monto_vendido
     FROM jugadas j
     JOIN usuarios u ON u.id = j.usuario_id
     WHERE j.caja_id = ?
     GROUP BY u.id
     ORDER BY monto_vendido DESC`
  ).all(cajaId).map(r => ({
    ...r,
    comision_ganada: Math.round(r.monto_vendido * r.comision_porcentaje / 100 * 100) / 100,
  }));

  return {
    caja_id: Number(cajaId),
    estado: caja.estado,
    monto_inicial: caja.monto_inicial,
    fondo_banco: caja.fondo_banco || 0,
    total_disponible: (caja.monto_inicial || 0) + (caja.fondo_banco || 0),
    ventas_total: ventas.total,
    ventas_cantidad: ventas.cantidad,
    premios_pagados_total: premiosPagados.total,
    premios_pagados_cantidad: premiosPagados.cantidad,
    comision_estimada: Math.round(comisionTotal * 100) / 100,
    comisiones_vendedores: comisionesVendedores,
    efectivo_esperado: efectivoEsperado,
    monto_final_declarado: caja.monto_final_declarado,
    diferencia: caja.monto_final_declarado != null ? caja.monto_final_declarado - efectivoEsperado : null,
  };
}

module.exports = router;

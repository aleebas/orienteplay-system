const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { fechaVenezuelaHoy, fechaVenezuelaDeTimestampSqlite, cajaEsDeHoy } = require('../utils/fechaVenezuela');

const router = express.Router();
router.use(requireAuth);

// Devuelve la caja abierta actualmente para la agencia del usuario
// (una agencia puede tener una caja general compartida entre vendedores,
// o cada vendedor puede manejar la suya - aqui la dejamos por agencia,
// se puede ajustar a "por usuario" facilmente si se prefiere)
//
// requiere_cierre: true cuando esa caja quedo abierta de un dia anterior
// (nadie la cerro antes de medianoche). Antes esto solo se detectaba si
// alguien intentaba ABRIR una caja nueva -- si la sesion simplemente
// seguia mostrando la caja de ayer como "abierta" (sin que nadie
// intentara abrir otra), nunca se avisaba y se seguia vendiendo ahi,
// mezclando dos dias en el mismo cierre. El frontend usa esta bandera
// para forzar la pantalla de cierre apenas se detecta, no solo al abrir.
router.get('/actual', (req, res) => {
  const caja = db.prepare(
    `SELECT * FROM cajas WHERE agencia_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1`
  ).get(req.user.agencia_id);
  if (!caja) return res.json(null);
  const esDeHoy = cajaEsDeHoy(caja);
  res.json({
    ...caja,
    requiere_cierre: !esDeHoy,
    fecha_caja_abierta: esDeHoy ? null : fechaVenezuelaDeTimestampSqlite(caja.abierta_en),
  });
});

// ------------------------------------------------------------
// Historial de cajas (solo admin) -- para poder revisar y corregir
// cajas pasadas. Filtra por fecha de apertura (Venezuela) en un rango;
// sin filtro, devuelve las ultimas 30.
// ------------------------------------------------------------
router.get('/', requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  const cajas = db.prepare(
    `SELECT c.*, ua.nombre AS usuario_apertura_nombre, uc.nombre AS usuario_cierre_nombre
     FROM cajas c
     JOIN usuarios ua ON ua.id = c.usuario_apertura_id
     LEFT JOIN usuarios uc ON uc.id = c.usuario_cierre_id
     WHERE c.agencia_id = ?
     ORDER BY c.id DESC
     LIMIT 100`
  ).all(req.user.agencia_id);

  const filtradas = (desde || hasta)
    ? cajas.filter((c) => {
        const f = fechaVenezuelaDeTimestampSqlite(c.abierta_en);
        return (!desde || f >= desde) && (!hasta || f <= hasta);
      })
    : cajas.slice(0, 30);

  res.json(filtradas.map((c) => ({
    ...c,
    fecha_apertura: fechaVenezuelaDeTimestampSqlite(c.abierta_en),
    ...calcularResumenCaja(c.id),
  })));
});

// Correccion manual (solo admin) -- edita directamente los montos
// declarados de una caja (abierta o ya cerrada). Pensado para cuando la
// operadora se equivoco al contar/anotar, o para saldar una discordancia
// ya investigada. No recalcula nada mas; el resto del resumen (ventas,
// premios) sigue viniendo de las jugadas/pagos reales.
router.put('/:id', requireAdmin, (req, res) => {
  const caja = db.prepare(`SELECT * FROM cajas WHERE id = ? AND agencia_id = ?`).get(req.params.id, req.user.agencia_id);
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });

  const CAMPOS_EDITABLES = ['monto_inicial', 'fondo_banco', 'monto_final_declarado'];
  const cambios = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (req.body[campo] === undefined) continue;
    if (req.body[campo] === null) { cambios[campo] = null; continue; }
    const valor = Number(req.body[campo]);
    if (Number.isNaN(valor)) return res.status(400).json({ error: `${campo} debe ser un numero` });
    cambios[campo] = valor;
  }
  if (Object.keys(cambios).length === 0) {
    return res.status(400).json({ error: 'No se recibio ningun campo para corregir (monto_inicial, fondo_banco, monto_final_declarado)' });
  }

  const sets = Object.keys(cambios).map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE cajas SET ${sets} WHERE id = ?`).run(...Object.values(cambios), req.params.id);

  res.json({
    mensaje: 'Caja corregida',
    caja: { ...db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(req.params.id), ...calcularResumenCaja(req.params.id) },
  });
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

  // Ventas TOTALES (para "jugadas vendidas" y el monto de negocio del
  // dia) -- incluye efectivo, banco y credito, sin distincion.
  const ventas = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM jugadas WHERE caja_id = ?`
  ).get(cajaId);

  // Para el CUADRE de plata fisica hay que separar por metodo_pago:
  // - efectivo: entra/sale de la caja fisica.
  // - pago_movil/biopago: entra/sale de la cuenta de banco (fondo_banco),
  //   nunca toca el efectivo fisico.
  // - credito: es una cuenta por cobrar -- no es plata recibida todavia,
  //   no debe sumar a efectivo NI a banco hasta que se cobre (eso se
  //   gestiona aparte, en Tickets > Creditos pendientes). Antes esto se
  //   sumaba igual que una venta en efectivo, inflando el efectivo
  //   esperado por cualquier venta a credito sin cobrar del turno.
  const ventasEfectivo = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM jugadas WHERE caja_id = ? AND metodo_pago = 'efectivo'`
  ).get(cajaId).total;
  const ventasBanco = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM jugadas WHERE caja_id = ? AND metodo_pago IN ('pago_movil', 'biopago')`
  ).get(cajaId).total;
  const ventasCredito = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM jugadas WHERE caja_id = ? AND metodo_pago = 'credito'`
  ).get(cajaId).total;

  const premiosPagados = db.prepare(
    `SELECT COALESCE(SUM(monto_pagado), 0) AS total, COUNT(*) AS cantidad FROM pagos_premio WHERE caja_id = ?`
  ).get(cajaId);

  // El metodo real de un pago de premio es el de la jugada GANADORA
  // original (jugadas.metodo_pago) -- un ticket comprado por Pago Movil
  // se paga por la misma via, no en efectivo fisico. Antes se restaba
  // TODO pago del efectivo esperado sin importar el metodo, descuadrando
  // la caja cada vez que un premio se pagaba por Pago Movil/Biopago.
  const premiosPagadosEfectivo = db.prepare(
    `SELECT COALESCE(SUM(pp.monto_pagado), 0) AS total
     FROM pagos_premio pp JOIN tickets t ON t.id = pp.ticket_id JOIN jugadas j ON j.id = t.jugada_id
     WHERE pp.caja_id = ? AND j.metodo_pago = 'efectivo'`
  ).get(cajaId).total;
  const premiosPagadosBanco = db.prepare(
    `SELECT COALESCE(SUM(pp.monto_pagado), 0) AS total
     FROM pagos_premio pp JOIN tickets t ON t.id = pp.ticket_id JOIN jugadas j ON j.id = t.jugada_id
     WHERE pp.caja_id = ? AND j.metodo_pago IN ('pago_movil', 'biopago')`
  ).get(cajaId).total;

  // Ventas a credito que se cobraron y esa plata entro a ESTA caja
  // (caja_cobro_id, que puede ser distinta -- hasta de otro dia -- a la
  // caja donde se registro la venta original). Se suman por separado del
  // efectivo/banco esperado y luego se incorporan abajo.
  const creditosCobradosEfectivo = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM jugadas WHERE caja_cobro_id = ? AND metodo_cobro = 'efectivo'`
  ).get(cajaId).total;
  const creditosCobradosBanco = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM jugadas WHERE caja_cobro_id = ? AND metodo_cobro IN ('pago_movil', 'biopago')`
  ).get(cajaId).total;

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

  const efectivoEsperado = (caja.monto_inicial || 0) + ventasEfectivo - premiosPagadosEfectivo + creditosCobradosEfectivo;
  const bancoEsperado = (caja.fondo_banco || 0) + ventasBanco - premiosPagadosBanco + creditosCobradosBanco;

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
    // Desglose por metodo -- para que "ventas_total" (negocio) y lo que
    // realmente afecta el cuadre de plata fisica no se confundan.
    ventas_efectivo: ventasEfectivo,
    ventas_banco: ventasBanco,
    ventas_credito: ventasCredito,
    premios_pagados_total: premiosPagados.total,
    premios_pagados_cantidad: premiosPagados.cantidad,
    premios_pagados_efectivo: premiosPagadosEfectivo,
    premios_pagados_banco: premiosPagadosBanco,
    // Creditos de dias/cajas anteriores que se cobraron y entraron a ESTA
    // caja (ver caja_cobro_id en jugadas). Ya estan incluidos en
    // efectivo_esperado / banco_esperado, se listan aparte solo para que
    // el desglose en pantalla sea transparente.
    creditos_cobrados_efectivo: creditosCobradosEfectivo,
    creditos_cobrados_banco: creditosCobradosBanco,
    comision_estimada: Math.round(comisionTotal * 100) / 100,
    comisiones_vendedores: comisionesVendedores,
    // efectivo_esperado: SOLO cuenta lo que fisicamente entra/sale de la
    // caja (ventas y premios en efectivo). Las ventas a credito (cuentas
    // por cobrar) y todo lo pagado/cobrado por Pago Movil o Biopago
    // (cuenta de banco) quedan fuera de este numero a proposito.
    efectivo_esperado: efectivoEsperado,
    // banco_esperado: mismo criterio pero para el fondo en banco/cuenta
    // (fondo_banco inicial + ventas por Pago Movil/Biopago - premios
    // pagados por esas mismas vias).
    banco_esperado: bancoEsperado,
    monto_final_declarado: caja.monto_final_declarado,
    diferencia: caja.monto_final_declarado != null ? caja.monto_final_declarado - efectivoEsperado : null,
  };
}

module.exports = router;

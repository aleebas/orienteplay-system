const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const usuarios = db.prepare(
    `SELECT id, nombre, usuario, rol, comision_porcentaje, puede_confirmar_resultados, activo, creado_en FROM usuarios ORDER BY creado_en DESC`
  ).all();
  res.json(usuarios);
});

router.post('/', (req, res) => {
  const { nombre, usuario, clave, rol } = req.body;
  const comisionPorcentaje = req.body.comision_porcentaje != null ? parseFloat(req.body.comision_porcentaje) : 14;
  const puedeConfirmarResultados = req.body.puede_confirmar_resultados ? 1 : 0;
  if (!nombre || !usuario || !clave || !rol) {
    return res.status(400).json({ error: 'nombre, usuario, clave y rol son requeridos' });
  }
  if (!['admin', 'vendedor'].includes(rol)) {
    return res.status(400).json({ error: "rol debe ser 'admin' o 'vendedor'" });
  }

  const existe = db.prepare(`SELECT id FROM usuarios WHERE usuario = ?`).get(usuario);
  if (existe) {
    return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
  }

  const hash = bcrypt.hashSync(clave, 10);
  const r = db.prepare(
    `INSERT INTO usuarios (agencia_id, nombre, usuario, password_hash, rol, comision_porcentaje, puede_confirmar_resultados) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(req.user.agencia_id, nombre, usuario, hash, rol, comisionPorcentaje, puedeConfirmarResultados);

  res.status(201).json({ id: r.lastInsertRowid, mensaje: 'Usuario creado' });
});

router.patch('/:id', (req, res) => {
  const usuario = db.prepare(`SELECT id FROM usuarios WHERE id = ?`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { nombre, rol, clave } = req.body;
  if (rol && !['admin', 'vendedor'].includes(rol)) {
    return res.status(400).json({ error: "rol debe ser 'admin' o 'vendedor'" });
  }

  const actual = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(req.params.id);
  const nuevoNombre = nombre || actual.nombre;
  const nuevoRol = rol || actual.rol;
  const nuevaComision = req.body.comision_porcentaje != null
    ? parseFloat(req.body.comision_porcentaje)
    : actual.comision_porcentaje;
  const nuevoPermiso = req.body.puede_confirmar_resultados != null
    ? (req.body.puede_confirmar_resultados ? 1 : 0)
    : actual.puede_confirmar_resultados;
  const nuevoHash = clave ? bcrypt.hashSync(clave, 10) : actual.password_hash;

  db.prepare(
    `UPDATE usuarios SET nombre = ?, rol = ?, comision_porcentaje = ?, puede_confirmar_resultados = ?, password_hash = ? WHERE id = ?`
  ).run(nuevoNombre, nuevoRol, nuevaComision, nuevoPermiso, nuevoHash, req.params.id);

  res.json({ mensaje: 'Usuario actualizado' });
});

router.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  const usuario = db.prepare(`SELECT id FROM usuarios WHERE id = ?`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Baja logica: un DELETE fisico rompe la integridad referencial en
  // cuanto el usuario tenga ventas, jugadas o cajas asociadas.
  db.prepare(`UPDATE usuarios SET activo = 0 WHERE id = ?`).run(req.params.id);
  res.json({ mensaje: 'Usuario eliminado' });
});

module.exports = router;

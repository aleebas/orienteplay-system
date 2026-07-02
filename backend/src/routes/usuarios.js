const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const usuarios = db.prepare(
    `SELECT id, nombre, usuario, rol, activo, creado_en FROM usuarios ORDER BY creado_en DESC`
  ).all();
  res.json(usuarios);
});

router.post('/', (req, res) => {
  const { nombre, usuario, clave, rol } = req.body;
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
    `INSERT INTO usuarios (agencia_id, nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?, ?)`
  ).run(req.user.agencia_id, nombre, usuario, hash, rol);

  res.status(201).json({ id: r.lastInsertRowid, mensaje: 'Usuario creado' });
});

module.exports = router;

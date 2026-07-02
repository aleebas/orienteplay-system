const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y clave son requeridos' });
  }

  const user = db.prepare(
    `SELECT u.*, a.nombre AS agencia_nombre
     FROM usuarios u JOIN agencias a ON a.id = u.agencia_id
     WHERE u.usuario = ? AND u.activo = 1`
  ).get(usuario);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  }

  const token = jwt.sign(
    { id: user.id, agencia_id: user.agencia_id, rol: user.rol, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      id: user.id, nombre: user.nombre, rol: user.rol,
      agencia_id: user.agencia_id, agencia_nombre: user.agencia_nombre,
      puede_confirmar_resultados: !!user.puede_confirmar_resultados,
    }
  });
});

module.exports = router;

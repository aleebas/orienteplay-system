const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto-en-produccion';

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, agencia_id, rol, nombre }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Requiere rol admin' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };

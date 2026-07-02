const jwt = require('jsonwebtoken');
const db = require('../db/connection');

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

// Columnas de permiso individuales validas para requireAdminOrPermiso.
// Whitelist explicita para no interpolar en SQL un nombre de columna
// que venga de fuera de este archivo.
const PERMISO_COLUMNS = { puede_confirmar_resultados: true };

// Deja pasar a un admin siempre, o a un usuario puntual que tenga el
// permiso individual en 1. Lee la DB en cada request (no confia en el
// JWT) para que activar/desactivar el permiso surta efecto de inmediato,
// sin esperar a que el usuario vuelva a iniciar sesion.
function requireAdminOrPermiso(campo) {
  if (!PERMISO_COLUMNS[campo]) {
    throw new Error(`requireAdminOrPermiso: permiso desconocido "${campo}"`);
  }
  return (req, res, next) => {
    const row = db.prepare(`SELECT rol, ${campo} AS permiso FROM usuarios WHERE id = ?`).get(req.user.id);
    if (row && (row.rol === 'admin' || row.permiso === 1)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

module.exports = { requireAuth, requireAdmin, requireAdminOrPermiso, JWT_SECRET };

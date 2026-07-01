const crypto = require('crypto');

// Genera un codigo de ticket corto, legible y unico, tipo "MS-A3F92K"
// Prefijo configurable por agencia a futuro; por ahora generico.
function generarCodigoTicket(prefijo = 'MS') {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefijo}-${random}`;
}

module.exports = { generarCodigoTicket };

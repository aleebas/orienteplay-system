const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { obtenerTasa } = require('../utils/bcvTasa');

const router = express.Router();
router.use(requireAuth);

router.get('/tasa', async (req, res) => {
  const tasa = await obtenerTasa();
  if (tasa.tasa == null) {
    return res.status(503).json({ error: 'No se pudo obtener la tasa BCV' });
  }
  res.json(tasa);
});

module.exports = router;

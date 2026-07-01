const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Listado completo de loterias activas con sus sorteos, animalitos y modos.
// Pensado para que el frontend cargue todo el catalogo de una vez al abrir
// la pantalla de venta.
router.get('/loterias', (req, res) => {
  const loterias = db.prepare(`SELECT * FROM loterias WHERE activa = 1 ORDER BY nombre`).all();

  const getSorteos = db.prepare(`SELECT * FROM sorteos WHERE loteria_id = ? AND activo = 1 ORDER BY hora`);
  const getAnimalitos = db.prepare(`SELECT * FROM animalitos WHERE loteria_id = ? ORDER BY CAST(numero AS INTEGER)`);
  const getModos = db.prepare(`SELECT * FROM modos_juego WHERE loteria_id = ? AND activo = 1 ORDER BY id`);

  const result = loterias.map(lot => ({
    ...lot,
    sorteos: getSorteos.all(lot.id),
    animalitos: getAnimalitos.all(lot.id),
    modos_juego: getModos.all(lot.id),
  }));

  res.json(result);
});

router.get('/loterias/:id/animalitos', (req, res) => {
  const animalitos = db.prepare(`SELECT * FROM animalitos WHERE loteria_id = ?`).all(req.params.id);
  res.json(animalitos);
});

router.get('/sorteos/:id', (req, res) => {
  const sorteo = db.prepare(`SELECT * FROM sorteos WHERE id = ?`).get(req.params.id);
  if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });
  res.json(sorteo);
});

module.exports = router;

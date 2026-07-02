process.env.TZ = 'America/Caracas'; // Venezuela Time (UTC-4, sin horario de verano)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Cargar .env si existe en backend/
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  });
}

// Seed idempotente: crea catálogo/admin solo si faltan (INSERT OR IGNORE).
// Se ejecuta en cada arranque porque el filesystem de Railway no persiste
// entre deploys sin un volumen montado — así el catálogo nunca queda vacío.
try {
  require('./db/seed')();
} catch (err) {
  console.error('Error al ejecutar seed automático:', err.message);
}

const app = express();
app.use(cors({
  origin: [
    'https://orienteplay.com',
    'https://www.orienteplay.com',
    'https://orienteplay-system.vercel.app',
    'http://localhost:5173',
  ],
  credentials: true,
}));
app.use(express.json());

// Imágenes de animalitos descargadas localmente
app.use('/public', express.static(path.join(__dirname, '../public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalogo', require('./routes/catalogo'));
app.use('/api/caja', require('./routes/caja'));
app.use('/api/jugadas', require('./routes/jugadas'));
app.use('/api/resultados', require('./routes/resultados'));
app.use('/api/pagos', require('./routes/pagos'));
app.use('/api/agencias', require('./routes/agencias'));
app.use('/api/reportes', require('./routes/reportes'));

app.get('/api/health', (req, res) => {
  const devMode = process.env.SKIP_HORARIO_CHECK === 'true';
  res.json({
    ok: true,
    hora: new Date().toISOString(),
    hora_venezuela: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
    zona: 'America/Caracas (UTC-4)',
    ...(devMode && { modo: 'desarrollo — horario sin restricción' }),
  });
});

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  const devMode = process.env.SKIP_HORARIO_CHECK === 'true';
  console.log(`\nServidor corriendo en http://localhost:${PORT}`);
  console.log(`Zona horaria: America/Caracas — ${new Date().toLocaleString('es-VE')}`);
  if (devMode) console.log(`⚡ MODO DESARROLLO: horario de sorteos sin restricción`);
  console.log(`Celulares en la misma red WiFi: http://[IP-DE-ESTE-PC]:${PORT}`);
});

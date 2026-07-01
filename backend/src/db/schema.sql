-- ============================================================
-- ESQUEMA DE BASE DE DATOS - SISTEMA DE VENTA DE ANIMALITOS
-- ============================================================
-- Diseñado para soportar multi-agencia desde el día uno.
-- Todas las tablas operativas (usuarios, cajas, jugadas, limites)
-- cuelgan de una agencia para que escalar a nuevas sucursales
-- solo requiera insertar una fila nueva en AGENCIAS.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------
-- AGENCIAS: cada sucursal/taquilla física
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  direccion TEXT,
  telefono TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------
-- USUARIOS: vendedores y administradores, ligados a una agencia
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id INTEGER NOT NULL REFERENCES agencias(id),
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'vendedor')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------
-- LOTERIAS: Lotto Activo, La Granjita, Ruleta Activa, etc.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS loterias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  activa INTEGER NOT NULL DEFAULT 1,
  logo_url TEXT
);

-- ----------------------------------------------------------
-- ANIMALITOS: catálogo de animalitos por lotería (cada lotería
-- puede tener su propio set de números/animalitos e imágenes)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS animalitos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loteria_id INTEGER NOT NULL REFERENCES loterias(id),
  numero TEXT NOT NULL,
  nombre TEXT NOT NULL,
  imagen_url TEXT,
  UNIQUE(loteria_id, numero)
);

-- ----------------------------------------------------------
-- MODOS_JUEGO: animalito directo, tripleta, terminal, centena...
-- Cada modo tiene su propio multiplicador de pago.
-- Extensible: agregar un modo nuevo no requiere tocar código.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS modos_juego (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loteria_id INTEGER NOT NULL REFERENCES loterias(id),
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL,
  multiplicador REAL NOT NULL,
  cantidad_animalitos INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1,
  UNIQUE(loteria_id, slug)
);

-- ----------------------------------------------------------
-- SORTEOS: horarios fijos diarios por lotería (8:00am, 9:00am...)
-- Es la "plantilla" del horario, se repite todos los días.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS sorteos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loteria_id INTEGER NOT NULL REFERENCES loterias(id),
  nombre TEXT NOT NULL,
  hora TEXT NOT NULL,
  minutos_cierre_previo INTEGER NOT NULL DEFAULT 5, -- minutos antes de la hora del sorteo en que se bloquea la venta
  activo INTEGER NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------
-- RESULTADOS: el animalito ganador de un sorteo en una fecha
-- específica. Confirmado manualmente (con apoyo de auto-busqueda).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS resultados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sorteo_id INTEGER NOT NULL REFERENCES sorteos(id),
  animalito_id INTEGER NOT NULL REFERENCES animalitos(id),
  fecha TEXT NOT NULL,
  confirmado_por INTEGER REFERENCES usuarios(id),
  confirmado_en TEXT NOT NULL DEFAULT (datetime('now')),
  fuente TEXT DEFAULT 'manual',
  UNIQUE(sorteo_id, fecha)
);

-- ----------------------------------------------------------
-- LIMITES_APUESTA: control de banca propia. Define el monto
-- máximo aceptado por animalito/sorteo, por agencia.
-- modo_accion: 'bloquear' detiene la venta automáticamente,
-- 'alertar' solo avisa y deja decidir al vendedor.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS limites_apuesta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id INTEGER NOT NULL REFERENCES agencias(id),
  animalito_id INTEGER NOT NULL REFERENCES animalitos(id),
  sorteo_id INTEGER REFERENCES sorteos(id), -- NULL = aplica a todos los sorteos de esa loteria
  monto_max REAL NOT NULL,
  modo_accion TEXT NOT NULL DEFAULT 'alertar' CHECK (modo_accion IN ('bloquear', 'alertar')),
  monto_max_ticket REAL, -- limite por jugada individual (opcional)
  activo INTEGER NOT NULL DEFAULT 1,
  UNIQUE(agencia_id, animalito_id, sorteo_id)
);

-- ----------------------------------------------------------
-- CAJAS: apertura y cierre de caja diario por agencia/usuario
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS cajas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id INTEGER NOT NULL REFERENCES agencias(id),
  usuario_apertura_id INTEGER NOT NULL REFERENCES usuarios(id),
  usuario_cierre_id INTEGER REFERENCES usuarios(id),
  monto_inicial REAL NOT NULL DEFAULT 0,
  monto_final_declarado REAL,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  abierta_en TEXT NOT NULL DEFAULT (datetime('now')),
  cerrada_en TEXT
);

-- ----------------------------------------------------------
-- VENTAS: agrupa una o varias jugadas (incluso de distintas
-- loterias) hechas en un mismo momento para el mismo cliente,
-- de forma que se pueda compartir UN solo comprobante que
-- incluya todas las jugadas de esa visita/pedido.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agencia_id INTEGER NOT NULL REFERENCES agencias(id),
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  cliente_nombre TEXT,
  cliente_telefono TEXT,
  codigo TEXT NOT NULL UNIQUE,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------
-- JUGADAS: cada apuesta individual registrada
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS jugadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER REFERENCES ventas(id),
  agencia_id INTEGER NOT NULL REFERENCES agencias(id),
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  sorteo_id INTEGER NOT NULL REFERENCES sorteos(id),
  modo_juego_id INTEGER NOT NULL REFERENCES modos_juego(id),
  fecha_sorteo TEXT NOT NULL, -- fecha del dia que se juega (YYYY-MM-DD)
  cliente_nombre TEXT,
  cliente_telefono TEXT,
  monto REAL NOT NULL,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------
-- JUGADA_ANIMALITOS: los animalitos elegidos en una jugada
-- (una tabla separada porque tripletas tienen varios animalitos
-- por jugada, no solo uno)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS jugada_animalitos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugada_id INTEGER NOT NULL REFERENCES jugadas(id),
  animalito_id INTEGER NOT NULL REFERENCES animalitos(id),
  posicion INTEGER NOT NULL DEFAULT 1 -- orden dentro de la jugada (para tripletas)
);

-- ----------------------------------------------------------
-- TICKETS: comprobante único generado por cada jugada
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugada_id INTEGER NOT NULL UNIQUE REFERENCES jugadas(id),
  codigo TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'ganador', 'perdedor', 'pagado', 'anulado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------
-- PAGOS_PREMIO: registro de pago de un ticket ganador.
-- Si existe fila aqui para un ticket, ya fue pagado -> anti
-- doble pago (se valida por UNIQUE ticket_id).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos_premio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id),
  monto_pagado REAL NOT NULL,
  pagado_por INTEGER NOT NULL REFERENCES usuarios(id),
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  pagado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------
-- COMISIONES: % fijo de comisión por lotería (lo que define el negocio)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS comisiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loteria_id INTEGER NOT NULL REFERENCES loterias(id),
  agencia_id INTEGER REFERENCES agencias(id), -- NULL = aplica por defecto a todas
  porcentaje REAL NOT NULL,
  UNIQUE(loteria_id, agencia_id)
);

-- ----------------------------------------------------------
-- Indices para acelerar las consultas mas frecuentes
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jugadas_sorteo_fecha ON jugadas(sorteo_id, fecha_sorteo);
CREATE INDEX IF NOT EXISTS idx_jugadas_caja ON jugadas(caja_id);
CREATE INDEX IF NOT EXISTS idx_jugada_animalitos_jugada ON jugada_animalitos(jugada_id);
CREATE INDEX IF NOT EXISTS idx_tickets_codigo ON tickets(codigo);
CREATE INDEX IF NOT EXISTS idx_resultados_sorteo_fecha ON resultados(sorteo_id, fecha);

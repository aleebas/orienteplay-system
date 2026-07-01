# Sistema de venta de animalitos - MY SONS

## Que hay listo hasta ahora (Fase 1-2 del plan)

- Base de datos completa (SQLite, archivo unico, sin instalar motor aparte)
- Autenticacion con usuario/clave (JWT)
- Catalogo de loterias, sorteos, animalitos y modos de juego (animalito directo, tripleta)
- Multi-agencia desde el modelo de datos (hoy: MY SONS)
- Registro de jugadas con control de limites de banca (bloquear o alertar, configurable)
- Generacion de ticket con codigo unico
- Carga de resultados con calculo automatico de tickets ganadores
- Pago de premios con bloqueo anti-doble-pago (a nivel de base de datos, no solo de la app)
- Apertura/cierre de caja con resumen (ventas, premios pagados, comision estimada, diferencia)
- Reportes por dia, por loteria, por vendedor

## Lo que falta (siguientes fases)

- Frontend (interfaz visual web para PC y celulares)
- Generacion del comprobante en imagen para compartir por WhatsApp
- Impresion termica 57mm
- Conexion opcional con fuente externa de resultados (con confirmacion manual siempre)

## Como correrlo en tu PC

### Requisitos
- Tener instalado Node.js version 22.5 o superior (tu version 24.16 funciona perfecto). Descargar de https://nodejs.org si no lo tienes.
- NO necesitas instalar Visual Studio ni ninguna herramienta de compilacion: el sistema usa el modulo de base de datos que ya viene integrado en Node.js (no requiere compilar nada).

### Pasos

1. Copia la carpeta `animalitos-system` a tu PC.
2. Abre una terminal (CMD o PowerShell en Windows) dentro de `animalitos-system/backend`.
3. Instala las dependencias (necesitas internet solo para este paso):
   ```
   npm install
   ```
4. Carga los datos iniciales (loterias, sorteos, animalitos, usuario admin):
   ```
   npm run seed
   ```
   Esto crea el usuario admin con clave `admin123` — **cambiala** despues del primer login (el cambio de clave se agrega en la siguiente fase, por ahora se puede actualizar directo en la base de datos si es urgente).
5. Levanta el servidor:
   ```
   npm start
   ```
6. Deberias ver en la terminal algo como:
   ```
   Servidor corriendo en http://localhost:3001
   ```

### Para probar que funciona (sin frontend todavia)

Con el servidor corriendo, abre OTRA terminal y prueba el login:

```
curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d "{\"usuario\":\"admin\",\"password\":\"admin123\"}"
```

Esto deberia devolver un token. Con ese token ya puedes probar, por ejemplo, ver el catalogo de loterias:

```
curl http://localhost:3001/api/catalogo/loterias -H "Authorization: Bearer TU_TOKEN_AQUI"
```

### Para acceder desde los celulares (cuando ya tengamos el frontend)

1. Asegurate que la PC y los celulares esten conectados a la MISMA red WiFi.
2. En la PC, busca tu IP local: en Windows, abre CMD y escribe `ipconfig`, busca "Direccion IPv4" (ejemplo: 192.168.1.50).
3. Desde el celular, en el navegador, entras a `http://192.168.1.50:3001` (cuando el frontend este listo, sera esa misma direccion).

## Importante: valores de ejemplo que DEBES ajustar

El seed carga datos de partida, pero estos NO son los valores reales de tu negocio, son solo para que el sistema arranque con algo:

- **Multiplicadores de pago** (animalito directo x35, tripleta x1200): estos son valores de referencia del mercado, pero cada loteria/agencia puede pagar distinto. Ajustalos en la tabla `modos_juego` o desde el panel admin (proxima fase) antes de operar con dinero real.
- **Comision del 15%**: tambien es un valor de partida. Cambialo por el % real que te paga cada loteria.
- **Nombres de animalitos y numeros**: cargue un set generico de 38 animalitos (00 al 37) que es el mas comun en el mercado, pero como viste en lotoven.com, cada loteria (Lotto Activo, La Granjita, Guacharo Activo, etc.) puede tener variaciones en algunos numeros o nombres. Hay que revisar y ajustar animalito por animalito segun la loteria real antes de operar.
- **Horarios de sorteo**: cargue horarios de ejemplo basados en lo que vimos en lotoven.com (8am a 7pm aprox), pero confirmalos contra la fuente oficial de cada loteria.

Nada de esto bloquea seguir desarrollando, pero SI hay que corregirlo antes de vender con dinero real, porque un multiplicador o limite mal puesto te puede hacer perder plata.

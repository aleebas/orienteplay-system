const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

let _token = null;

export function setToken(t) { _token = t; }
export function getToken() { return _token; }
export function clearToken() { _token = null; }

// AuthContext se registra acá (ver su useEffect) para poder cerrar la
// sesión de forma centralizada cuando el token vence a mitad de turno --
// antes cada pantalla se quedaba mostrando el error crudo del backend
// ("Token invalido o expirado") en su lugar, sin ninguna forma clara de
// volver a login.
let _onSesionExpirada = null;
export function setOnSesionExpirada(fn) { _onSesionExpirada = fn; }

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Un 401 en /auth/login es solo "usuario o clave incorrecta" -- no una
    // sesión que venció, así que no dispara el cierre de sesión global.
    if (res.status === 401 && path !== '/auth/login') _onSesionExpirada?.();
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const login = (usuario, password) =>
  req('POST', '/auth/login', { usuario, password });

export const getCatalogoLoterias = () =>
  req('GET', '/catalogo/loterias');

export const getCajaActual = () =>
  req('GET', '/caja/actual');

export const abrirCaja = (monto_inicial, fondo_banco) =>
  req('POST', '/caja/abrir', { monto_inicial, fondo_banco });

export const cerrarCaja = (id, monto_final_declarado) =>
  req('POST', `/caja/${id}/cerrar`, { monto_final_declarado });

export const getResumenCaja = (id) =>
  req('GET', `/caja/${id}/resumen`);

export const getHistorialCajas = ({ desde, hasta } = {}) => {
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const qs = params.toString();
  return req('GET', `/caja${qs ? `?${qs}` : ''}`);
};

export const corregirCaja = (id, campos) =>
  req('PUT', `/caja/${id}`, campos);

export const validarJugadas = (jugadas) =>
  req('POST', '/jugadas/validar', { jugadas });

export const consultarCupoLote = (fecha, combos) =>
  req('POST', '/jugadas/cupo-lote', { fecha, combos });

export const registrarVenta = (payload) =>
  req('POST', '/jugadas', payload);

export const getVenta = (codigo) =>
  req('GET', `/jugadas/venta/${codigo}`);

export const getTicket = (codigo) =>
  req('GET', `/jugadas/ticket/${codigo}`);

export const getTickets = ({ fecha, estado, q } = {}) => {
  const params = new URLSearchParams();
  if (fecha) params.set('fecha', fecha);
  if (estado) params.set('estado', estado);
  if (q) params.set('q', q);
  const qs = params.toString();
  return req('GET', `/jugadas${qs ? `?${qs}` : ''}`);
};

export const anularVenta = (codigoVenta) =>
  req('POST', `/jugadas/anular/${codigoVenta}`);

export const cargarResultado = (sorteo_id, animalito_id, fecha) =>
  req('POST', '/resultados', { sorteo_id, animalito_id, fecha });

export const getResultadosFecha = (fecha) =>
  req('GET', `/resultados?fecha=${fecha}`);

export const getGanadoresPendientes = (fecha) =>
  req('GET', `/resultados/ganadores-pendientes${fecha ? `?fecha=${fecha}` : ''}`);

export const getCandidatosResultados = (fecha) =>
  req('GET', `/resultados/candidatos${fecha ? `?fecha=${fecha}` : ''}`);

export const confirmarCandidato = (id) =>
  req('POST', `/resultados/candidatos/${id}/confirmar`);

export const descartarCandidato = (id) =>
  req('POST', `/resultados/candidatos/${id}/descartar`);

export const pagarPremio = (codigoTicket, caja_id, datosBeneficiario) =>
  req('POST', `/pagos/${codigoTicket}`, { caja_id, ...datosBeneficiario });

export const getLimites = (agenciaId) =>
  req('GET', `/agencias/${agenciaId}/limites`);

export const guardarLimite = (agenciaId, payload) =>
  req('POST', `/agencias/${agenciaId}/limites`, payload);

export const desactivarLimite = (limiteId) =>
  req('DELETE', `/agencias/limites/${limiteId}`);

export const eliminarLimitesLoteria = (agenciaId, loteriaId) =>
  req('DELETE', `/agencias/${agenciaId}/limites?loteria_id=${loteriaId}`);

export const eliminarTodosLimites = (agenciaId) =>
  req('DELETE', `/agencias/${agenciaId}/limites/todos`);

export const getReporteVentasPorDia = (desde, hasta) =>
  req('GET', `/reportes/ventas-por-dia?desde=${desde}&hasta=${hasta}`);

export const getReporteVentasPorLoteria = (fecha) =>
  req('GET', `/reportes/ventas-por-loteria?fecha=${fecha}`);

export const getReporteVentasPorVendedor = (fecha) =>
  req('GET', `/reportes/ventas-por-vendedor?fecha=${fecha}`);

export const getRecientes = (limite = 10) =>
  req('GET', `/reportes/recientes?limite=${limite}`);

export const getUltimasVentas = (limite = 10) =>
  req('GET', `/reportes/ultimas-ventas?limite=${limite}`);

export const getLimitesUso = () =>
  req('GET', '/reportes/limites-uso');

export const getTopAnimalitos = (fecha) =>
  req('GET', `/reportes/top-animalitos${fecha ? `?fecha=${fecha}` : ''}`);

export const getTopLoterias = (fecha) =>
  req('GET', `/reportes/top-loterias${fecha ? `?fecha=${fecha}` : ''}`);

export const getUsuarios = () =>
  req('GET', '/usuarios');

export const crearUsuario = (payload) =>
  req('POST', '/usuarios', payload);

export const editarUsuario = (id, payload) =>
  req('PATCH', `/usuarios/${id}`, payload);

export const eliminarUsuario = (id) =>
  req('DELETE', `/usuarios/${id}`);

export const imprimirTicket = (ventaData, agenciaNombre) =>
  req('POST', '/imprimir', { venta: ventaData.venta, jugadas: ventaData.jugadas, agenciaNombre });

export const getTasaBCV = () =>
  req('GET', '/bcv/tasa');

export const getCreditosPendientes = () =>
  req('GET', '/jugadas/creditos-pendientes');

export const marcarCreditoCobrado = (jugadaId) =>
  req('POST', `/jugadas/${jugadaId}/cobrar`);

export const getRendicion = (desde, hasta) =>
  req('GET', `/reportes/rendicion?desde=${desde}&hasta=${hasta}`);

export const getRendicionVendedores = (desde, hasta) =>
  req('GET', `/reportes/rendicion-vendedores?desde=${desde}&hasta=${hasta}`);

export const getConteoBorrado = (desde, hasta) =>
  req('GET', `/reportes/admin/borrado-conteo?desde=${desde}&hasta=${hasta}`);

export const ejecutarBorrado = (desde, hasta, confirmacion) =>
  req('DELETE', '/reportes/admin/borrado', { desde, hasta, confirmacion });

export const getConfiguracion = () =>
  req('GET', '/reportes/configuracion');

export const guardarConfiguracion = (payload) =>
  req('PUT', '/reportes/configuracion', payload);

export const getDiagnosticoFechasSospechosas = () =>
  req('GET', '/reportes/admin/diagnostico-fechas-sospechosas');

export const getDiagnosticoPagosSospechosos = () =>
  req('GET', '/reportes/admin/diagnostico-pagos-sospechosos');

export const getCorreccionResultadosPreview = () =>
  req('GET', '/reportes/admin/correccion-resultados-preview');

export const aplicarCorreccionResultados = (correcciones, confirmacion) =>
  req('POST', '/reportes/admin/correccion-resultados-aplicar', { correcciones, confirmacion });

export const getTicketsDeResultado = (resultadoId) =>
  req('GET', `/reportes/admin/correccion-resultados-preview/${resultadoId}/tickets`);

export const API = { get: (path) => req('GET', path) };

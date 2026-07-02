const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

let _token = null;

export function setToken(t) { _token = t; }
export function getToken() { return _token; }
export function clearToken() { _token = null; }

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

export const abrirCaja = (monto_inicial) =>
  req('POST', '/caja/abrir', { monto_inicial });

export const cerrarCaja = (id, monto_final_declarado) =>
  req('POST', `/caja/${id}/cerrar`, { monto_final_declarado });

export const getResumenCaja = (id) =>
  req('GET', `/caja/${id}/resumen`);

export const validarJugadas = (jugadas) =>
  req('POST', '/jugadas/validar', { jugadas });

export const registrarVenta = (payload) =>
  req('POST', '/jugadas', payload);

export const getVenta = (codigo) =>
  req('GET', `/jugadas/venta/${codigo}`);

export const getTicket = (codigo) =>
  req('GET', `/jugadas/ticket/${codigo}`);

export const cargarResultado = (sorteo_id, animalito_id, fecha) =>
  req('POST', '/resultados', { sorteo_id, animalito_id, fecha });

export const getResultadosFecha = (fecha) =>
  req('GET', `/resultados?fecha=${fecha}`);

export const getGanadoresPendientes = (fecha) =>
  req('GET', `/resultados/ganadores-pendientes${fecha ? `?fecha=${fecha}` : ''}`);

export const pagarPremio = (codigoTicket, caja_id) =>
  req('POST', `/pagos/${codigoTicket}`, { caja_id });

export const getLimites = (agenciaId) =>
  req('GET', `/agencias/${agenciaId}/limites`);

export const guardarLimite = (agenciaId, payload) =>
  req('POST', `/agencias/${agenciaId}/limites`, payload);

export const desactivarLimite = (limiteId) =>
  req('DELETE', `/agencias/limites/${limiteId}`);

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

export const getUsuarios = () =>
  req('GET', '/usuarios');

export const crearUsuario = (payload) =>
  req('POST', '/usuarios', payload);

export const API = { get: (path) => req('GET', path) };

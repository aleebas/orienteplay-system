import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { login as apiLogin, setToken, clearToken, getCajaActual, setOnSesionExpirada } from '../api/cliente';

const AuthContext = createContext(null);

function cargarAuthGuardada() {
  try {
    const raw = sessionStorage.getItem('auth');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.token || !data?.user) return null;
    setToken(data.token);
    return data;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(cargarAuthGuardada);
  // auth = { token, user: { id, nombre, rol, agencia_id, agencia_nombre } }

  const [caja, setCaja] = useState(null);
  // caja = { id, estado, ... } o null

  // Sigue en true hasta que se confirma si hay una caja abierta o no. Sin
  // esto, un refresh en /venta veía caja=null en el primer render (todavía
  // no se había vuelto a consultar el servidor) y expulsaba a /caja aunque
  // la caja siguiera abierta -- perdiendo la venta en curso por nada.
  const [cajaCargando, setCajaCargando] = useState(!!auth);

  useEffect(() => {
    if (!auth) { setCajaCargando(false); return; }
    let cancelado = false;
    getCajaActual()
      .then((c) => { if (!cancelado) setCaja(c); })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCajaCargando(false); });
    return () => { cancelado = true; };
    // Solo al montar (o si cambia el usuario logueado) -- una vez cargada,
    // el resto de las pantallas actualiza `caja` por su cuenta (abrir/cerrar).
  }, [auth?.user?.id]);

  const login = useCallback(async (usuario, password) => {
    const data = await apiLogin(usuario, password);
    setToken(data.token);
    const authData = { token: data.token, user: data.user };
    setAuth(authData);
    sessionStorage.setItem('auth', JSON.stringify(authData));
    return data;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAuth(null);
    setCaja(null);
    sessionStorage.removeItem('auth');
    sessionStorage.removeItem('venta-en-curso');
  }, []);

  // Aviso para mostrar en Login tras un cierre de sesión automático por
  // token vencido (a diferencia de un "cerrar sesión" manual) -- así el
  // cajero entiende que no hizo nada mal, solo venció la sesión.
  const [sesionExpirada, setSesionExpirada] = useState(false);
  const limpiarSesionExpirada = useCallback(() => setSesionExpirada(false), []);

  useEffect(() => {
    setOnSesionExpirada(() => {
      logout();
      setSesionExpirada(true);
    });
  }, [logout]);

  return (
    <AuthContext.Provider value={{ auth, caja, setCaja, cajaCargando, login, logout, sesionExpirada, limpiarSesionExpirada }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

import { createContext, useContext, useState, useCallback } from 'react';
import { login as apiLogin, setToken, clearToken } from '../api/cliente';

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
  }, []);

  return (
    <AuthContext.Provider value={{ auth, caja, setCaja, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

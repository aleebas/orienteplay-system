import { createContext, useContext, useState, useCallback } from 'react';
import { login as apiLogin, setToken, clearToken } from '../api/cliente';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);
  // auth = { token, user: { id, nombre, rol, agencia_id, agencia_nombre } }

  const [caja, setCaja] = useState(null);
  // caja = { id, estado, ... } o null

  const login = useCallback(async (usuario, password) => {
    const data = await apiLogin(usuario, password);
    setToken(data.token);
    setAuth({ token: data.token, user: data.user });
    return data;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAuth(null);
    setCaja(null);
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

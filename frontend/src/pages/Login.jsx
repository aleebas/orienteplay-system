import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCajaActual } from '../api/cliente';

export default function Login() {
  const { login, setCaja } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ usuario: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.usuario, form.password);
      const cajaActual = await getCajaActual();
      setCaja(cajaActual);
      navigate(cajaActual ? '/venta' : '/caja');
    } catch (err) {
      setError(err.message || 'Usuario o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-header">
        <img
          src="/ORIENTEPLAY_LOGO.png"
          alt="OrientePlay"
          style={{ height: '140px', objectFit: 'contain' }}
        />
        <div className="login-tagline">Sistema de gestión de animalitos</div>
      </div>

      <div className="login-card">
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="field">
            <label>Usuario</label>
            <div className="login-input-wrap">
              <span className="login-input-icon">👤</span>
              <input
                type="text"
                value={form.usuario}
                onChange={e => setForm(f => ({ ...f, usuario: e.target.value }))}
                placeholder="admin"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="field">
            <label>Contraseña</label>
            <div className="login-input-wrap">
              <span className="login-input-icon">🔒</span>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-accent"
            style={{ marginTop: 16 }}
            disabled={loading}
          >
            {loading ? '⟳ Verificando...' : '🔓 Ingresar'}
          </button>
        </form>
      </div>

      <div className="login-footer">© 2026 OrientePlay · Todos los derechos reservados</div>
    </div>
  );
}

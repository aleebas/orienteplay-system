import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getResumenCaja, getTasaBCV } from '../api/cliente';
import { fmt } from '../utils/formato';

export default function NavBar() {
  const { auth, caja, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [totalHoy, setTotalHoy] = useState(null);
  const [tasaBCV, setTasaBCV] = useState(null);

  useEffect(() => {
    if (!caja?.id) { setTotalHoy(null); return; }
    const load = () =>
      getResumenCaja(caja.id)
        .then(r => setTotalHoy(r.ventas_total))
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [caja?.id]);

  useEffect(() => {
    const load = () => getTasaBCV().then(r => setTasaBCV(r.tasa)).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60000);
    return () => clearInterval(t);
  }, []);

  function handleLogout() { logout(); navigate('/login'); }

  const isAdmin = auth?.user?.rol === 'admin';
  const links = [
    ...(isAdmin ? [{ to: '/dashboard', label: '📊 Dashboard' }] : []),
    { to: '/venta',      label: '🎯 Venta' },
    { to: '/caja',       label: '💰 Caja' },
    { to: '/resultados', label: '🏆 Resultados' },
    { to: '/pagos',      label: '💵 Pagos' },
    { to: '/tickets',    label: '🎫 Tickets' },
    ...(isAdmin ? [{ to: '/reportes', label: '📋 Reportes' }] : []),
  ];

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <img
          src="/ORIENTEPLAY_LOGO.png"
          alt="OrientePlay"
          style={{ height: '32px', objectFit: 'contain', marginRight: '8px' }}
        />
        <div>
          <span className="navbar-title">OrientePlay</span>
          {auth?.user?.agencia_nombre && (
            <span className="navbar-agencia">{auth.user.agencia_nombre}</span>
          )}
        </div>
      </div>

      <div className={`navbar-nav${open ? ' open' : ''}`}>
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
            onClick={() => setOpen(false)}
          >
            {l.label}
          </NavLink>
        ))}
        {tasaBCV != null && (
          <span className="navbar-badge navbar-badge-bcv" title="Tasa BCV">💵 {tasaBCV.toFixed(2)}</span>
        )}
        {totalHoy !== null && (
          <span className="navbar-badge">{fmt(totalHoy)}</span>
        )}
        <button className="navbar-link navbar-logout" onClick={handleLogout}>Salir</button>
      </div>

      <button
        className="navbar-menu-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Menú"
      >
        {open ? '✕' : '☰'}
      </button>
    </nav>
  );
}

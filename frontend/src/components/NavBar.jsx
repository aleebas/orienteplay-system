import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getResumenCaja, getTasaBCV } from '../api/cliente';
import { fmt, ahoraVenezuela } from '../utils/formato';

// Hora (Venezuela) a partir de la cual se avisa que hay que cerrar la caja
// antes de medianoche. No hay forma barata de mandar un WhatsApp automatico
// (eso requeriria contratar la API de WhatsApp Business), asi que esto es
// un recordatorio dentro del propio panel -- se suma al bloqueo real que ya
// existe (caja.requiere_cierre) para cuando alguien de verdad se le pasa la
// hora y sigue abierta al dia siguiente.
const HORA_AVISO_CIERRE = 23;

export default function NavBar() {
  const { auth, caja, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [totalHoy, setTotalHoy] = useState(null);
  const [tasaBCV, setTasaBCV] = useState(null);
  const [avisoCierre, setAvisoCierre] = useState(false);

  useEffect(() => {
    function chequear() {
      setAvisoCierre(ahoraVenezuela().getUTCHours() >= HORA_AVISO_CIERRE);
    }
    chequear();
    const t = setInterval(chequear, 60000);
    return () => clearInterval(t);
  }, []);

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
    <>
      {avisoCierre && caja && !caja.requiere_cierre && (
        <div
          className="alert alert-warning"
          style={{ margin: 0, borderRadius: 0, textAlign: 'center', cursor: 'pointer', fontWeight: 600 }}
          onClick={() => navigate('/caja')}
        >
          ⏰ Ya casi es medianoche -- cierra la caja de hoy antes de las 12 para no dejarla abierta de un día para otro. Toca aquí para ir a Caja.
        </div>
      )}
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
    </>
  );
}

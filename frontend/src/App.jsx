import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import NavBar from './components/NavBar';
import Login from './pages/Login';
import Caja from './pages/Caja';
import Venta from './pages/Venta';
import Resultados from './pages/Resultados';
import Pagos from './pages/Pagos';
import Reportes from './pages/Reportes';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';

function ProtectedRoute({ children, onlyAdmin }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (onlyAdmin && auth.user.rol !== 'admin') return <Navigate to="/venta" replace />;
  return children;
}

function AppRoutes() {
  const { auth } = useAuth();

  return (
    <>
      {auth && <NavBar />}
      <Routes>
        <Route path="/login" element={auth ? <Navigate to="/venta" replace /> : <Login />} />
        <Route path="/caja"       element={<ProtectedRoute><Caja /></ProtectedRoute>} />
        <Route path="/venta"      element={<ProtectedRoute><Venta /></ProtectedRoute>} />
        <Route path="/resultados" element={<ProtectedRoute><Resultados /></ProtectedRoute>} />
        <Route path="/pagos"      element={<ProtectedRoute><Pagos /></ProtectedRoute>} />
        <Route path="/tickets"    element={<ProtectedRoute><Tickets /></ProtectedRoute>} />
        <Route path="/reportes"   element={<ProtectedRoute onlyAdmin><Reportes /></ProtectedRoute>} />
        <Route path="/dashboard"  element={<ProtectedRoute onlyAdmin><Dashboard /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={auth ? '/venta' : '/login'} replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

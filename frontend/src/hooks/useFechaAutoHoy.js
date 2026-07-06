import { useState, useEffect, useRef, useCallback } from 'react';
import { fechaHoyVenezuela } from '../utils/formato';

const INTERVALO_CHEQUEO_MS = 60000;

// `useState(fechaHoyVenezuela())` congela la fecha al momento en que carga
// la pestaña -- si la sesion sigue abierta cruzando medianoche (comun en
// una taquilla con sorteos hasta tarde), el valor se queda pegado en el
// dia anterior para siempre, aunque ya sea "otro dia" en la realidad.
//
// Este hook mantiene la fecha sincronizada con "hoy" (chequeo cada 60s)
// mientras el usuario no la haya elegido manualmente. Apenas se llama a
// setFechaManual (ej. el usuario toca el <input type="date">), el hook
// deja de tocar el valor hasta que el componente se vuelva a montar
// (recarga de pagina) o el usuario elija explicitamente "hoy" de nuevo.
export function useFechaAutoHoy() {
  const [fecha, setFecha] = useState(fechaHoyVenezuela);
  const esManual = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      if (esManual.current) return;
      const hoy = fechaHoyVenezuela();
      setFecha(prev => (prev === hoy ? prev : hoy));
    }, INTERVALO_CHEQUEO_MS);
    return () => clearInterval(t);
  }, []);

  const setFechaManual = useCallback((valor) => {
    esManual.current = true;
    setFecha(valor);
  }, []);

  return [fecha, setFechaManual];
}

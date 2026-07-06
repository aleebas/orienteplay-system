const { fechaVenezuelaHoy, ahoraVenezuela } = require('./fechaVenezuela');

function sorteoEstaAbierto(sorteo, fechaSorteo) {
  // Modo desarrollo: ignorar bloqueo por horario
  if (process.env.SKIP_HORARIO_CHECK === 'true') {
    return { abierto: true, motivo: null };
  }

  const ahora = ahoraVenezuela();
  const hoyStr = fechaVenezuelaHoy();

  if (fechaSorteo !== hoyStr) {
    return { abierto: fechaSorteo > hoyStr, motivo: fechaSorteo < hoyStr ? 'La fecha del sorteo ya paso' : null };
  }

  const [h, m] = sorteo.hora.split(':').map(Number);
  const horaSorteo = new Date(ahora);
  horaSorteo.setUTCHours(h, m, 0, 0);

  const minutosCierre = sorteo.minutos_cierre_previo != null ? sorteo.minutos_cierre_previo : 5;
  const horaCierre = new Date(horaSorteo.getTime() - minutosCierre * 60000);

  if (ahora >= horaCierre) {
    return {
      abierto: false,
      motivo: `Las ventas para este sorteo (${sorteo.hora}) cerraron ${minutosCierre} minutos antes de la hora del sorteo`,
    };
  }

  return { abierto: true, motivo: null };
}

module.exports = { sorteoEstaAbierto };

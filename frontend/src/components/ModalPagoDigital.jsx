import { useState } from 'react';

// Modal que pide los datos bancarios del ganador antes de confirmar un
// pago de premio hecho por Pago Móvil o Biopago, para poder armar el
// mensaje de WhatsApp al responsable de pagos digitales.
export default function ModalPagoDigital({ montoPremio, metodoPago, onConfirmar, onCancelar, loading }) {
  const [banco, setBanco] = useState('');
  const [cedula, setCedula] = useState('');
  const [telefono, setTelefono] = useState('');
  const [nombre, setNombre] = useState('');

  const metodoLabel = { pago_movil: 'Pago Móvil', biopago: 'Biopago' }[metodoPago] || metodoPago;
  const completo = banco.trim() && cedula.trim() && telefono.trim() && nombre.trim();

  function handleSubmit(e) {
    e.preventDefault();
    if (!completo) return;
    onConfirmar({ banco: banco.trim(), cedula: cedula.trim(), telefono: telefono.trim(), nombre: nombre.trim() });
  }

  return (
    <div className="dialog-overlay" onClick={onCancelar}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>Datos para el pago por {metodoLabel}</h2>
        <p className="text-muted text-sm mb-12">
          Estos datos se incluirán en el mensaje de WhatsApp al responsable de pagos digitales.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Banco del ganador</label>
            <input type="text" value={banco} onChange={e => setBanco(e.target.value)} placeholder="Ej: Banesco" autoFocus />
          </div>
          <div className="field">
            <label>Cédula</label>
            <input type="text" value={cedula} onChange={e => setCedula(e.target.value)} placeholder="Ej: V-12345678" />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input type="text" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Ej: 04121234567" />
          </div>
          <div className="field">
            <label>Nombre del ganador</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo" />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={onCancelar} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-success" disabled={!completo || loading}>
              {loading ? 'Procesando...' : `Confirmar y notificar — ${metodoLabel}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

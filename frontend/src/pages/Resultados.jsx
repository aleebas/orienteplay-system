import { useState, useEffect } from 'react';
import { getCatalogoLoterias, getResultadosFecha, cargarResultado } from '../api/cliente';
import SelectorAnimalito, { EMOJI_MAP } from '../components/SelectorAnimalito';
import { hora12 } from '../utils/formato';

const TODAY = new Date().toISOString().slice(0, 10);

function sorteoYaPaso(hora) {
  const ahora = new Date();
  const [h, m] = hora.split(':').map(Number);
  const t = new Date(ahora);
  t.setHours(h, m, 0, 0);
  return ahora > t;
}

export default function Resultados() {
  const [catalogo, setCatalogo] = useState([]);
  const [resultados, setResultados] = useState({});
  const [loading, setLoading] = useState(true);
  const [cargandoResultado, setCargandoResultado] = useState(null);
  const [sorteoSelec, setSorteoSelec] = useState(null);
  const [animalito, setAnimalito] = useState(null);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [fecha, setFecha] = useState(TODAY);

  async function cargar() {
    setLoading(true);
    try {
      const [cat, res] = await Promise.all([
        getCatalogoLoterias(),
        getResultadosFecha(fecha),
      ]);
      setCatalogo(cat);
      const map = {};
      for (const r of res) map[r.sorteo_id] = r;
      setResultados(map);
    } catch (err) {
      setError('Error al cargar datos: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [fecha]);

  async function handleCargar() {
    if (!sorteoSelec || !animalito) return;
    setError('');
    setCargandoResultado(sorteoSelec.id);
    try {
      await cargarResultado(sorteoSelec.id, animalito.id, fecha);
      setExito(`Resultado cargado: ${sorteoSelec.hora} → ${EMOJI_MAP[animalito.nombre] || '🐾'} ${animalito.nombre}`);
      setSorteoSelec(null);
      setAnimalito(null);
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoResultado(null);
    }
  }

  if (loading) return <div className="loading"><div className="spinner"></div><br />Cargando...</div>;

  // Agrupar sorteos por lotería, filtrar solo los que ya pasaron
  const sorteosPasados = catalogo.flatMap(lot =>
    lot.sorteos
      .filter(s => sorteoYaPaso(s.hora))
      .map(s => ({ ...s, loteria: lot }))
  );

  const sorteosAgrupados = catalogo.map(lot => ({
    ...lot,
    sorteosPasados: lot.sorteos.filter(s => sorteoYaPaso(s.hora)),
  })).filter(l => l.sorteosPasados.length > 0);

  return (
    <div className="page">
      <div className="flex justify-between align-center mb-12">
        <h1>Resultados</h1>
        <input
          type="date"
          value={fecha}
          onChange={e => setFecha(e.target.value)}
          style={{ border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: '0.875rem' }}
        />
      </div>

      {exito && <div className="alert alert-success">{exito}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {sorteoSelec && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Cargar resultado</h2>
            <p className="text-muted text-sm mb-12">
              {sorteoSelec.loteria?.nombre || ''} — Sorteo {hora12(sorteoSelec.hora)}
            </p>
            <h3 style={{ marginBottom: 8 }}>¿Qué animalito salió?</h3>
            <SelectorAnimalito
              animalitos={sorteoSelec.loteria?.animalitos || []}
              seleccionados={animalito ? [animalito] : []}
              cantidad={1}
              onSelect={a => setAnimalito(prev => prev?.id === a.id ? null : a)}
            />
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => { setSorteoSelec(null); setAnimalito(null); }}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={!animalito || !!cargandoResultado}
                onClick={handleCargar}
              >
                {cargandoResultado ? 'Guardando...' : 'Confirmar resultado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sorteosAgrupados.length === 0 ? (
        <div className="card text-center text-muted">
          Aún no hay sorteos pasados para la fecha seleccionada.
        </div>
      ) : (
        sorteosAgrupados.map(lot => (
          <div key={lot.id} className="card">
            <h2>🎰 {lot.nombre}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lot.sorteosPasados.map(s => {
                const res = resultados[s.id];
                return (
                  <div key={s.id} className="flex justify-between align-center" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <span className="bold">⏰ {hora12(s.hora)}</span>
                      {res ? (
                        <span className="badge badge-success" style={{ marginLeft: 8 }}>
                          {EMOJI_MAP[res.animalito_nombre] || '🐾'} {res.animalito_nombre} ({res.animalito_numero})
                        </span>
                      ) : (
                        <span className="badge badge-muted" style={{ marginLeft: 8 }}>Sin resultado</span>
                      )}
                    </div>
                    {!res && (
                      <button
                        className="btn btn-primary btn-sm btn-inline"
                        onClick={() => { setSorteoSelec({ ...s, loteria: lot }); setAnimalito(null); }}
                      >
                        Cargar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

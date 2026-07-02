import { useState, useEffect } from 'react';
import {
  getCatalogoLoterias, getResultadosFecha, cargarResultado,
  getCandidatosResultados, confirmarCandidato, descartarCandidato,
} from '../api/cliente';
import SelectorAnimalito, { EMOJI_MAP, LOTERIA_SLUG_IMAGEN } from '../components/SelectorAnimalito';
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

  const [candidatos, setCandidatos] = useState([]);
  const [procesandoCandidato, setProcesandoCandidato] = useState(null);

  const [numeroInput, setNumeroInput] = useState('');
  const [errorNumero, setErrorNumero] = useState('');

  async function cargar() {
    setLoading(true);
    try {
      const [cat, res, cand] = await Promise.all([
        getCatalogoLoterias(),
        getResultadosFecha(fecha),
        getCandidatosResultados(fecha),
      ]);
      setCatalogo(cat);
      const map = {};
      for (const r of res) map[r.sorteo_id] = r;
      setResultados(map);
      setCandidatos(cand);
    } catch (err) {
      setError('Error al cargar datos: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [fecha]);

  async function handleConfirmarCandidato(c) {
    setProcesandoCandidato(c.id);
    setError('');
    try {
      await confirmarCandidato(c.id);
      setExito(`Resultado confirmado: ${c.sorteo_hora} → ${c.animalito_nombre}`);
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcesandoCandidato(null);
    }
  }

  async function handleDescartarCandidato(c) {
    if (!confirm('¿Descartar este hallazgo automático? Podrás cargar el resultado manualmente.')) return;
    setProcesandoCandidato(c.id);
    setError('');
    try {
      await descartarCandidato(c.id);
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcesandoCandidato(null);
    }
  }

  async function handleCargarConAnimalito(a) {
    if (!sorteoSelec || !a) return;
    setError('');
    setCargandoResultado(sorteoSelec.id);
    try {
      await cargarResultado(sorteoSelec.id, a.id, fecha);
      setExito(`Resultado cargado: ${sorteoSelec.hora} → ${EMOJI_MAP[a.nombre] || '🐾'} ${a.nombre}`);
      setSorteoSelec(null);
      setAnimalito(null);
      setNumeroInput('');
      setErrorNumero('');
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoResultado(null);
    }
  }

  function handleCargar() {
    return handleCargarConAnimalito(animalito);
  }

  function handleNumeroKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const numero = numeroInput.trim();
    if (!numero) return;
    const encontrado = (sorteoSelec?.loteria?.animalitos || []).find(a => a.numero === numero);
    if (!encontrado) {
      setErrorNumero(`No se encontró ningún animalito con el número ${numero} en esta lotería`);
      return;
    }
    setErrorNumero('');
    setAnimalito(encontrado);
    handleCargarConAnimalito(encontrado);
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

      {candidatos.length > 0 && (
        <div className="card" style={{ border: '2px solid var(--warning)' }}>
          <h2>🤖 Resultados automáticos por revisar</h2>
          {candidatos.map(c => (
            <div key={c.id} className="flex justify-between align-center" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span className="bold">{c.loteria_nombre} — {hora12(c.sorteo_hora)}</span>
                {c.estado === 'pendiente_confirmacion' ? (
                  <span className="badge badge-warning" style={{ marginLeft: 8 }}>
                    {EMOJI_MAP[c.animalito_nombre] || '🐾'} {c.animalito_nombre} ({c.animalito_numero}) — encontrado automáticamente
                  </span>
                ) : (
                  <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                    Sin resultado tras {c.intentos} intentos — cargar manualmente abajo
                  </span>
                )}
              </div>
              {c.estado === 'pendiente_confirmacion' && (
                <div className="flex gap-8">
                  <button
                    className="btn btn-success btn-sm btn-inline"
                    disabled={procesandoCandidato === c.id}
                    onClick={() => handleConfirmarCandidato(c)}
                  >
                    ✓ Confirmar
                  </button>
                  <button
                    className="btn btn-outline btn-sm btn-inline"
                    disabled={procesandoCandidato === c.id}
                    onClick={() => handleDescartarCandidato(c)}
                  >
                    Descartar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sorteoSelec && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Cargar resultado</h2>
            <p className="text-muted text-sm mb-12">
              {sorteoSelec.loteria?.nombre || ''} — Sorteo {hora12(sorteoSelec.hora)}
            </p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Buscar por número</label>
              <input
                type="text"
                inputMode="numeric"
                value={numeroInput}
                onChange={e => { setNumeroInput(e.target.value); setErrorNumero(''); }}
                onKeyDown={handleNumeroKeyDown}
                placeholder="Escribe el número (ej: 23)"
                autoFocus
              />
              {errorNumero && <p className="text-danger text-sm" style={{ marginTop: 4 }}>{errorNumero}</p>}
            </div>
            <h3 style={{ marginBottom: 8 }}>¿Qué animalito salió?</h3>
            <SelectorAnimalito
              animalitos={sorteoSelec.loteria?.animalitos || []}
              seleccionados={animalito ? [animalito] : []}
              cantidad={1}
              onSelect={a => setAnimalito(prev => prev?.id === a.id ? null : a)}
              loteriaSlug={LOTERIA_SLUG_IMAGEN[sorteoSelec.loteria?.slug]}
            />
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => { setSorteoSelec(null); setAnimalito(null); setNumeroInput(''); setErrorNumero(''); }}>
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
                        onClick={() => { setSorteoSelec({ ...s, loteria: lot }); setAnimalito(null); setNumeroInput(''); setErrorNumero(''); }}
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

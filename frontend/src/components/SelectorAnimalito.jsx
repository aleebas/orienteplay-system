const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const IMG_BASE = VITE_API_URL.replace(/\/api\/?$/, '');

// El slug de la lotería en la DB (sin guiones bajos) no coincide con el
// nombre de carpeta de imágenes en backend/public/animalitos/.
export const LOTERIA_SLUG_IMAGEN = {
  lottoactivo: 'lotto_activo',
  lagranjita: 'la_granjita',
  ruletaactiva: 'ruleta_activa',
  selvaplus: 'selva_plus',
  guacharoactivo: 'guacharo_activo',
};

export const EMOJI_MAP = {
  'BALLENA': '🐋', 'DELFIN': '🐬', 'CARNERO': '🐏', 'TORO': '🐂',
  'CIEMPIES': '🐛', 'ALACRAN': '🦂', 'LEON': '🦁', 'RANA': '🐸',
  'PERICO': '🦜', 'RATON': '🐭', 'AGUILA': '🦅', 'TIGRE': '🐯',
  'GATO': '🐱', 'CABALLO': '🐴', 'MONO': '🐒', 'PALOMA': '🕊️',
  'ZORRO': '🦊', 'OSO': '🐻', 'PAVO': '🦃', 'BURRO': '🫏',
  'CHIVO': '🐐', 'COCHINO': '🐷', 'GALLO': '🐓', 'CAMELLO': '🐪',
  'CEBRA': '🦓', 'IGUANA': '🦎', 'GALLINA': '🐔', 'VACA': '🐄',
  'PERRO': '🐕', 'ZAMURO': '🦅', 'ELEFANTE': '🐘', 'CAIMAN': '🐊',
  'LAPA': '🦡', 'ARDILLA': '🐿️', 'PESCADO': '🐟', 'VENADO': '🦌',
  'JIRAFA': '🦒', 'CULEBRA': '🐍',
  // Guácharo extra (37-75)
  'TORTUGA': '🐢', 'MARIPOSA': '🦋', 'PULPO': '🐙', 'CANGREJO': '🦀',
  'LANGOSTA': '🦞', 'CAMARОН': '🦐', 'PATO': '🦆', 'CISNE': '🦢',
  'FLAMENCO': '🦩', 'BUHO': '🦉', 'MURCIELAGO': '🦇', 'ABEJA': '🐝',
  'HORMIGA': '🐜', 'ESCARABAJO': '🪲', 'MARIPOSA2': '🦋', 'MOSCA': '🪰',
  'ARANA': '🕷️', 'ESCORPION': '🦂', 'CANGURO': '🦘', 'KOALA': '🐨',
  'PANDA': '🐼', 'RINOCERONTE': '🦏', 'HIPOPOTAMO': '🦛', 'GORILA': '🦍',
  'ORANGUTAN': '🦧', 'LOBO': '🐺', 'JABALI': '🐗', 'CONEJO': '🐇',
  'HAMSTER': '🐹', 'CASTOR': '🦫', 'NUTRIA': '🦦', 'MAPACHE': '🦝',
  'ZORRINO': '🦨', 'TOPO': '🐀', 'ERIZO': '🦔', 'CIERVO': '🦌',
  'LLAMA': '🦙', 'ALPACA': '🦙', 'GUACHARO': '🦜',
};

function AnimalImg({ a, fallbackEmoji, loteriaSlug }) {
  // Para Guácharo Activo, mostrar directamente emojis (sin intentar cargar imágenes)
  if (!loteriaSlug || loteriaSlug === 'guacharo_activo') {
    return <div className="animalito-emoji">{fallbackEmoji}</div>;
  }
  const src = `${IMG_BASE}/public/animalitos/${loteriaSlug}/${a.numero}.webp`;

  return (
    <img
      className="animalito-img"
      src={src}
      alt={a.nombre}
      onError={e => {
        // Si la imagen no carga, mostrar emoji
        e.currentTarget.style.display = 'none';
        const span = document.createElement('div');
        span.className = 'animalito-emoji';
        span.textContent = fallbackEmoji;
        e.currentTarget.parentNode.insertBefore(span, e.currentTarget);
      }}
    />
  );
}

/**
 * Props:
 *  animalitos       - array de todos los animalitos de la lotería
 *  seleccionados    - array de objetos animalito ya seleccionados
 *  cantidad         - cuántos se pueden seleccionar (para tripleta = 3; ignorado si limitarSeleccion=false)
 *  onSelect         - callback(animalito): toggle selection
 *  excluirNumeros   - array de strings de números a ocultar
 *  limitarSeleccion - true (default) limita a `cantidad`; false = sin límite (modo multi-directo)
 */
export default function SelectorAnimalito({
  animalitos,
  seleccionados = [],
  cantidad = 1,
  onSelect,
  excluirNumeros = [],
  limitarSeleccion = true,
  loteriaSlug,
}) {
  const excluirSet = new Set(excluirNumeros);
  const visibles = animalitos.filter(a => !excluirSet.has(a.numero));
  const ids = seleccionados.map(a => a.id);

  return (
    <>
      {/* Slots de tripleta: solo cuando limitarSeleccion=true y cantidad > 1 */}
      {limitarSeleccion && cantidad > 1 && (
        <div className="tripleta-slots">
          {Array.from({ length: cantidad }).map((_, i) => {
            const a = seleccionados[i];
            const emoji = a ? (EMOJI_MAP[a.nombre] || '🐾') : null;
            return (
              <div key={i} className={`tripleta-slot${a ? ' filled' : ''}`}>
                {a ? (
                  <>
                    <AnimalImg a={a} fallbackEmoji={emoji} loteriaSlug={loteriaSlug} />
                    <span style={{ fontSize: '0.65rem', fontWeight: 700 }}>{a.nombre}</span>
                  </>
                ) : (
                  <span style={{ fontSize: '0.75rem' }}>#{i + 1}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="animalito-grid">
        {visibles.map((a) => {
          const idx = ids.indexOf(a.id);
          const isSelected = idx !== -1;
          const isFull = limitarSeleccion && seleccionados.length >= cantidad && !isSelected;
          const emoji = EMOJI_MAP[a.nombre] || '🐾';

          let cls = 'animalito-card';
          if (isFull) cls += ' disabled';
          else if (isSelected) {
            if (limitarSeleccion && cantidad > 1) cls += ` selected-${idx}`;
            else cls += ' selected';
          }

          return (
            <div
              key={a.id}
              className={cls}
              onClick={() => !isFull ? onSelect(a) : undefined}
            >
              <AnimalImg a={a} fallbackEmoji={emoji} />
              <div className="animalito-num">{a.numero}</div>
              <div className="animalito-nombre">{a.nombre}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

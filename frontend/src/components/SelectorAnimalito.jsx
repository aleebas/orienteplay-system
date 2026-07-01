const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const IMG_BASE = VITE_API_URL.replace(/\/api\/?$/, '');

// Extensiones a intentar en orden de preferencia
const IMG_EXTENSIONS = ['webp', 'jpeg', 'jpg', 'png'];

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

/**
 * Intenta cargar imagen con múltiples extensiones si la primera falla.
 * Si la URL es /public/animalitos/lotto_activo/0.webp y falla,
 * intenta con .jpeg, .jpg, .png
 */
function getImageUrlWithFallback(baseUrl, extensionIndex = 0) {
  if (extensionIndex >= IMG_EXTENSIONS.length) return null;
  
  // Eliminar extensión actual y agregar la nueva
  const withoutExt = baseUrl.replace(/\.(webp|jpeg|jpg|png)$/i, '');
  const newExt = IMG_EXTENSIONS[extensionIndex];
  return `${withoutExt}.${newExt}`;
}

function AnimalImg({ a, fallbackEmoji }) {
  // Para Guácharo Activo, mostrar directamente emojis (sin intentar cargar imágenes)
  const isGuacharo = a.imagen_url?.includes('guacharo_activo');
  if (!a.imagen_url || isGuacharo) {
    return <div className="animalito-emoji">{fallbackEmoji}</div>;
  }
  const src = a.imagen_url.startsWith('http') ? a.imagen_url : `${IMG_BASE}${a.imagen_url}`;
  
  return (
    <img
      className="animalito-img"
      src={src}
      alt={a.nombre}
      onError={e => {
        // Intentar con la siguiente extensión
        const currentSrc = e.currentTarget.src;
        const nextExtIndex = IMG_EXTENSIONS.findIndex(ext => currentSrc.endsWith(`.${ext}`)) + 1;
        
        if (nextExtIndex > 0 && nextExtIndex < IMG_EXTENSIONS.length) {
          const nextUrl = getImageUrlWithFallback(currentSrc, nextExtIndex);
          if (nextUrl) {
            e.currentTarget.src = nextUrl;
            return;
          }
        }
        
        // Si todas las extensiones fallan, mostrar emoji
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
                    <AnimalImg a={a} fallbackEmoji={emoji} />
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

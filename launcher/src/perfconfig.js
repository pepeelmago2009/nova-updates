const fs = require('fs');
const path = require('path');

/**
 * Opciones de los mods de FPS ajustadas para dar mas FPS. Se aplican una sola vez por archivo
 * (config/.nova-tuned.json lo recuerda): si despues el jugador cambia algo a mano, no se vuelve a tocar.
 */
const TUNES = {
  // Sodium: hojas y lluvia rapidas (las hojas transparentes son lo que mas pesa en bosques), sin vineta
  'sodium-options.json': { json: { quality: { weather_quality: 'FAST', leaves_quality: 'FAST', enable_vignette: false } } },
  // EntityCulling: las hojas tapan mobs (no dibuja los que estan detras de arboles) y no mueve los que no se ven
  'entityculling.json': { json: { solidLeaves: true, tickCulling: true } },
  // ImmediatelyFast: agrupa el texto de los carteles en una sola pasada
  'immediatelyfast.json': { json: { experimental_sign_text_buffering: true } },
  // MoreCulling: tampoco dibuja los portales del End que no se ven
  'moreculling.toml': { toml: { endGatewayCulling: 'true' }, onlyIfExists: true },
};
const VERSION = 1;

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) base[k] = merge(base[k] && typeof base[k] === 'object' ? base[k] : {}, v);
    else base[k] = v;
  }
  return base;
}

/** Aplica los ajustes que falten. Devuelve la lista de archivos que cambio. */
function tune(instanceDir) {
  const dir = path.join(instanceDir, 'config');
  fs.mkdirSync(dir, { recursive: true });
  const markerFile = path.join(dir, '.nova-tuned.json');
  let done = {};
  try { done = JSON.parse(fs.readFileSync(markerFile, 'utf8')) || {}; } catch { /* primera vez */ }
  const changed = [];
  for (const [name, t] of Object.entries(TUNES)) {
    if ((done[name] || 0) >= VERSION) continue;
    const file = path.join(dir, name);
    const exists = fs.existsSync(file);
    if (t.onlyIfExists && !exists) continue; // el mod lo crea al abrir el juego; se ajusta la proxima vez
    try {
      if (t.json) {
        let cur = {};
        if (exists) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cur = {}; } }
        fs.writeFileSync(file, JSON.stringify(merge(cur, t.json), null, 2));
      } else {
        let txt = fs.readFileSync(file, 'utf8');
        for (const [k, v] of Object.entries(t.toml)) {
          const re = new RegExp(`^${k}\\s*=.*$`, 'm');
          txt = re.test(txt) ? txt.replace(re, `${k} = ${v}`) : txt.replace(/^(version\s*=.*)$/m, `$1\n${k} = ${v}`);
        }
        fs.writeFileSync(file, txt);
      }
      done[name] = VERSION;
      changed.push(name);
    } catch { /* si un archivo falla, el juego abre igual */ }
  }
  fs.writeFileSync(markerFile, JSON.stringify(done, null, 2));
  return changed;
}

module.exports = { tune, TUNES };

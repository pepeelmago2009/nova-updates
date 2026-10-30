// Versiones que ofrece el lanzador y en cuales existe ya el mod Nova.
const SUPPORTED = ['1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1'];
const DEFAULT_VERSION = '1.21.4';

// Mods extra (Modrinth) que se instalan solos. Sus dependencias obligatorias se instalan tambien.
const FABRIC_API = 'fabric-api';
const PERFORMANCE_MODS = [
  'sodium',           // motor de render nuevo: la mayor subida de FPS
  'lithium',          // fisica, IA y mundo mas rapidos
  'ferrite-core',     // menos memoria RAM
  'immediatelyfast',  // HUD, texto y entidades dibujados en lote
  'entityculling',    // no dibuja entidades y cofres que no ves
  'moreculling',      // no dibuja caras de bloques tapadas (hojas, etc.)
  'badoptimizations', // mil pequeños ahorros (luz, cielo, etc.)
  'dynamic-fps',      // baja los FPS cuando el juego esta minimizado: menos calor y bateria
];

module.exports = { SUPPORTED, DEFAULT_VERSION, FABRIC_API, PERFORMANCE_MODS };

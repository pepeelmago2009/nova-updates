const net = require('net');
const dns = require('dns').promises;

/**
 * Servidores: ping real con el protocolo "Server List Ping" de Minecraft (el mismo de la lista de multijugador):
 * jugadores conectados, version, mensaje (MOTD), icono y latencia. Sin librerias externas.
 */

const DEFAULTS = [
  { name: 'Hypixel', address: 'mc.hypixel.net' },
  { name: 'Universocraft', address: 'mc.universocraft.com' },
  { name: 'CubeCraft', address: 'play.cubecraft.net' },
  { name: 'MCC Island', address: 'play.mccisland.net' },
  { name: 'Minemen Club', address: 'minemen.club' },
];

function varint(n) {
  const out = [];
  n >>>= 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}

/** Lee un varint desde buf[pos]; devuelve [valor, siguiente posicion] o null si faltan bytes. */
function readVarint(buf, pos) {
  let v = 0, shift = 0;
  for (let i = 0; i < 5; i++) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    v |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [v, pos];
    shift += 7;
  }
  throw new Error('varint muy largo');
}

function packet(id, ...parts) {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); }

/** "host" o "host:puerto" -> { host, port }. */
function parseAddress(address) {
  const m = String(address || '').trim().match(/^([^:\s]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  return { host: m[1].toLowerCase(), port: m[2] ? Number(m[2]) : 25565, explicitPort: !!m[2] };
}

/** Texto plano del MOTD (puede venir como texto o como componente JSON con "extra"). */
function motdText(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d.replace(/§./g, '');
  return (motdText(d.text) + (Array.isArray(d.extra) ? d.extra.map(motdText).join('') : '')).replace(/§./g, '');
}

async function resolve(address) {
  const a = parseAddress(address);
  if (!a) throw new Error('bad-address');
  if (!a.explicitPort) {
    try { const [srv] = await dns.resolveSrv(`_minecraft._tcp.${a.host}`); if (srv) return { host: srv.name, port: srv.port, shown: a.host }; } catch { /* sin SRV */ }
  }
  return { host: a.host, port: a.port, shown: a.host };
}

/** Pregunta el estado al servidor. Resuelve { online, max, version, motd, favicon, ping } o lanza error. */
async function ping(address, timeoutMs = 5000) {
  const { host, port, shown } = await resolve(address);
  return new Promise((ok, fail) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), status = null, sentAt = 0;
    const done = (err, val) => { clearTimeout(timer); sock.destroy(); err ? fail(err) : ok(val); };
    const timer = setTimeout(() => done(new Error('timeout')), timeoutMs);
    sock.on('error', (e) => done(e));
    sock.on('connect', () => {
      const port16 = Buffer.alloc(2); port16.writeUInt16BE(port);
      sock.write(packet(0x00, varint(767), mcString(shown), port16, varint(1))); // saludo -> estado
      sock.write(packet(0x00)); // pedir estado
      sentAt = Date.now();
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len[1] + len[0]) return;
        const body = buf.subarray(len[1], len[1] + len[0]);
        buf = buf.subarray(len[1] + len[0]);
        const [id, p] = readVarint(body, 0);
        if (id === 0x00 && !status) {
          const [slen, sp] = readVarint(body, p);
          status = JSON.parse(body.subarray(sp, sp + slen).toString('utf8'));
          const latency = Date.now() - sentAt;
          const players = status.players || {};
          done(null, {
            online: players.online | 0, max: players.max | 0,
            version: (status.version && status.version.name) || '', motd: motdText(status.description).trim(),
            favicon: typeof status.favicon === 'string' && status.favicon.startsWith('data:image/') ? status.favicon : null,
            ping: latency,
          });
        }
      } catch (e) { done(e); }
    });
  });
}

/** Lista guardada del jugador (o la de fabrica) sin repetidos. */
function clean(list) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : DEFAULTS) {
    const a = parseAddress(s && s.address);
    if (!a || seen.has(a.host + ':' + a.port)) continue;
    seen.add(a.host + ':' + a.port);
    out.push({ name: String((s && s.name) || a.host).slice(0, 32), address: String(s.address).trim() });
  }
  return out.slice(0, 40);
}

module.exports = { DEFAULTS, ping, clean, parseAddress, motdText, varint, readVarint };

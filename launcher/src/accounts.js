const fs = require('fs');
const path = require('path');
const { doFetch, UA } = require('./net');

/**
 * Cuentas de Minecraft. Microsoft (premium) usa el mismo inicio de sesion que el lanzador oficial:
 * Microsoft -> Xbox Live -> XSTS -> Minecraft. Los tokens se guardan cifrados (Windows los protege con tu usuario).
 * La cuenta sin premium es el "Nombre de jugador" de Ajustes (id 'offline').
 */
const CLIENT_ID = '00000000402b5328';
const REDIRECT = 'https://login.live.com/oauth20_desktop.srf';
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';

function authUrl() {
  const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', scope: SCOPE, redirect_uri: REDIRECT, prompt: 'select_account' });
  return `https://login.live.com/oauth20_authorize.srf?${q}`;
}

/** Error con una clave que la interfaz traduce (noXbox, child, noGame, loginFailed...). */
function fail(key, detail) { const e = new Error(detail || key); e.key = key; return e; }

async function post(url, body, form) {
  let res;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  } catch { throw fail('noInternet', `Sin conexion con ${new URL(url).host}`); }
  let data = {};
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  return { ok: res.ok, status: res.status, data };
}

/** Codigo de la pagina de Microsoft (o un refresh token) -> tokens de Microsoft. */
async function microsoftToken({ code, refresh }) {
  const body = { client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: SCOPE, ...(code ? { grant_type: 'authorization_code', code } : { grant_type: 'refresh_token', refresh_token: refresh }) };
  const r = await post('https://login.live.com/oauth20_token.srf', body, true);
  if (!r.ok || !r.data.access_token) throw fail(refresh ? 'loginExpired' : 'loginFailed', `Microsoft: ${r.data.error_description || r.status}`);
  return { access: r.data.access_token, refresh: r.data.refresh_token || refresh };
}

/** Token de Microsoft -> token de Minecraft + perfil (nombre, uuid, skin). */
async function minecraftLogin(msAccess) {
  const xbl = await post('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccess}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  if (!xbl.ok) throw fail('loginFailed', `Xbox Live: ${xbl.status}`);
  const uhs = xbl.data.DisplayClaims.xui[0].uhs;

  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  if (!xsts.ok) {
    const x = String(xsts.data.XErr || '');
    if (x === '2148916233') throw fail('noXbox');
    if (x === '2148916238') throw fail('child');
    if (x === '2148916235') throw fail('region');
    throw fail('loginFailed', `XSTS: ${xsts.status} ${x}`);
  }
  const xuid = xsts.data.DisplayClaims && xsts.data.DisplayClaims.xui && xsts.data.DisplayClaims.xui[0].xid;

  const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}` });
  if (!mc.ok || !mc.data.access_token) throw fail('loginFailed', `Minecraft: ${mc.status}`);

  let prof;
  try { prof = await doFetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${mc.data.access_token}`, 'User-Agent': UA } }); }
  catch { throw fail('noInternet'); }
  if (prof.status === 404) throw fail('noGame');
  if (!prof.ok) throw fail('loginFailed', `Perfil: ${prof.status}`);
  const p = await prof.json();
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE') || (p.skins || [])[0];
  return {
    uuid: p.id, name: p.name, xuid: xuid || '',
    mcToken: mc.data.access_token, mcExpires: Date.now() + (mc.data.expires_in || 86400) * 1000,
    skin: skin ? String(skin.url).replace(/^http:/, 'https:') : '',
  };
}

/** Archivo de cuentas. crypt = { encrypt(str) -> str, decrypt(str) -> str } (safeStorage de Electron). */
class Store {
  constructor(file, crypt) {
    this.file = file;
    this.crypt = crypt || { encrypt: (s) => s, decrypt: (s) => s };
    this.data = { active: 'offline', accounts: [] };
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && Array.isArray(d.accounts)) this.data = { active: d.active || 'offline', accounts: d.accounts }; } catch { /* nuevo */ }
  }

  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** Lista para la interfaz (sin tokens). */
  list() {
    const ids = this.data.accounts.map((a) => a.uuid);
    const active = ids.includes(this.data.active) ? this.data.active : 'offline';
    return { active, accounts: this.data.accounts.map((a) => ({ id: a.uuid, name: a.name, skin: a.skin || '', type: 'microsoft' })) };
  }

  /** Guarda (o actualiza) una cuenta de Microsoft y la deja como activa. */
  put(acc, msRefresh) {
    const rec = { uuid: acc.uuid, name: acc.name, xuid: acc.xuid, skin: acc.skin,
      refresh: this.crypt.encrypt(msRefresh), mcToken: this.crypt.encrypt(acc.mcToken), mcExpires: acc.mcExpires };
    const i = this.data.accounts.findIndex((a) => a.uuid === acc.uuid);
    if (i >= 0) this.data.accounts[i] = rec; else this.data.accounts.push(rec);
    this.data.active = acc.uuid;
    this.write();
    return this.list();
  }

  select(id) {
    if (id === 'offline' || this.data.accounts.some((a) => a.uuid === id)) { this.data.active = id; this.write(); }
    return this.list();
  }

  remove(id) {
    this.data.accounts = this.data.accounts.filter((a) => a.uuid !== id);
    if (this.data.active === id) this.data.active = 'offline';
    this.write();
    return this.list();
  }
}

/** Inicia sesion con el codigo que devolvio la ventana de Microsoft y guarda la cuenta. */
async function addFromCode(store, code) {
  const ms = await microsoftToken({ code });
  const acc = await minecraftLogin(ms.access);
  return store.put(acc, ms.refresh);
}

/**
 * Datos de inicio de sesion para Minecraft (formato de minecraft-launcher-core).
 * Cuenta premium: renueva el token si vencio. Sin premium: usa el nombre de Ajustes.
 */
async function authFor(store, offlineName, offlineAuth) {
  const { active } = store.list();
  const a = store.data.accounts.find((x) => x.uuid === active);
  if (!a) return offlineAuth(offlineName);
  let token = a.mcExpires - 5 * 60 * 1000 > Date.now() ? store.crypt.decrypt(a.mcToken) : null;
  if (!token) {
    const ms = await microsoftToken({ refresh: store.crypt.decrypt(a.refresh) });
    const acc = await minecraftLogin(ms.access);
    store.put(acc, ms.refresh);
    token = acc.mcToken;
  }
  const cur = store.data.accounts.find((x) => x.uuid === active);
  return {
    access_token: token, client_token: cur.uuid, uuid: cur.uuid, name: cur.name,
    user_properties: '{}', meta: { type: 'msa', xuid: cur.xuid || '', demo: false },
  };
}

module.exports = { authUrl, REDIRECT, Store, addFromCode, authFor, microsoftToken, minecraftLogin };

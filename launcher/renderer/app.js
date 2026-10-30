/* global nova, I18N */
const THEMES = [
  ['#8b5cf6', '#c4b5fd'], ['#3b82f6', '#93c5fd'], ['#22d3ee', '#a5f3fc'],
  ['#34d399', '#86efac'], ['#f0f0fa', '#ffffff'], ['#f472b6', '#fbcfe8'],
];
const $ = (id) => document.getElementById(id);
let state;
let settings;
let lastStatus = { key: 'ready' };
let busy = false;

function t(key, args = []) {
  const s = (I18N[settings ? settings.lang : 'es'] || I18N.es)[key] || I18N.en[key] || key;
  return s.replace(/\{(\d)\}/g, (_m, i) => args[i] ?? '');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---------------------------------------------------------------- tema, idioma y logo
function applyTheme() {
  const [a, l] = THEMES[settings.theme] || THEMES[0];
  const root = document.documentElement.style;
  root.setProperty('--accent', a);
  root.setProperty('--accent-light', l);
  root.setProperty('--on-accent', settings.theme === 4 ? '#111118' : '#ffffff');
}

function applyLang() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-tp]').forEach((el) => { el.placeholder = t(el.dataset.tp); });
  $('play').querySelector('span').textContent = t(busy ? 'playing' : 'playBtn');
  showStatus(lastStatus);
  const nv = state.novaVersions;
  $('nova-avail').textContent = nv.length ? t('novaAvail', [nv.join(', ')]) : t('novaNone');
}

function drawLogo() { // estrella de 8 puntas, como en el mod
  const pts = [];
  for (let sq = 0; sq < 2; sq++) {
    let d = '';
    for (let k = 0; k < 4; k++) {
      const a = sq * Math.PI / 4 + k * Math.PI / 2;
      d += `${k ? 'L' : 'M'}${(Math.cos(a) * 22).toFixed(2)} ${(Math.sin(a) * 22).toFixed(2)}`;
    }
    pts.push(`<path d="${d}Z"/>`);
  }
  $('star').innerHTML = pts.join('');
}

// ---------------------------------------------------------------- fondo animado (hilos y cristales)
function background() {
  const c = $('bg');
  const g = c.getContext('2d');
  const start = performance.now();
  function frame(now) {
    const w = (c.width = innerWidth), h = (c.height = innerHeight), tt = (now - start) / 1000;
    const [accent, light] = THEMES[settings ? settings.theme : 0];
    g.fillStyle = '#07070c';
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.8, h * 0.45, 0, w * 0.8, h * 0.45, h * 0.9);
    glow.addColorStop(0, accent + '55');
    glow.addColorStop(1, '#07070c00');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) { // hilos de luz
      g.beginPath();
      for (let x = w * 0.35; x <= w; x += 6) {
        const u = (x - w * 0.35) / (w * 0.65);
        const y = h * (0.28 + 0.13 * k) + Math.sin(u * 5 + tt * 0.7 + k * 1.7) * h * 0.07 * (0.4 + u) + Math.sin(u * 11 - tt * 0.5 + k) * 5;
        if (x === w * 0.35) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = light + '66';
      g.lineWidth = 1.2;
      g.shadowColor = accent;
      g.shadowBlur = 12;
      g.stroke();
    }
    g.shadowBlur = 0;
    for (let i = 0; i < 60; i++) { // polvo de estrellas
      const fx = Math.sin(i * 91.7) * 0.5 + 0.5, fy = Math.sin(i * 17.3 + 4) * 0.5 + 0.5;
      const y = (fy * h + tt * (2 + (i % 5)) * 3) % h;
      g.fillStyle = `rgba(200,192,255,${0.2 + 0.2 * Math.sin(tt * 1.5 + i)})`;
      g.fillRect(fx * w, y, 1 + (i % 2), 1 + (i % 2));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- estado del juego
function showStatus(s) {
  lastStatus = s;
  $('status').textContent = s.key === 'ready' ? t('ready') : (s.text || t('st_' + s.key, s.args || []));
  $('status').title = $('status').textContent; // texto completo al pasar el raton
}

function setProgress(v) {
  const f = $('bar-fill');
  f.classList.toggle('indeterminate', v < 0);
  if (v >= 0) f.style.width = Math.round(v * 100) + '%';
}

function setBusy(b) {
  busy = b;
  $('play').disabled = b;
  $('version').disabled = b;
  $('play').querySelector('span').textContent = t(b ? 'playing' : 'playBtn');
}

function log(line) {
  const el = $('log');
  el.textContent += line.endsWith('\n') ? line : line + '\n';
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
  el.scrollTop = el.scrollHeight;
}

async function save(patch) {
  settings = await nova.saveSettings({ ...settings, ...patch });
  render();
}

function render() {
  applyTheme();
  applyLang();
  renderAccounts();
  $('username').value = document.activeElement === $('username') ? $('username').value : settings.username;
  $('ram').max = state.maxRam;
  $('ram').value = settings.ramGB;
  $('ram-val').textContent = settings.ramGB + ' GB';
  for (const k of ['perf', 'nova', 'fullscreen', 'closeOnLaunch']) $(k).classList.toggle('on', settings[k]);
  document.querySelectorAll('#lang button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.lang));
  document.querySelectorAll('#theme button').forEach((b, i) => b.classList.toggle('on', i === settings.theme));
  $('version').value = settings.version;
  const noNova = settings.nova && !state.novaVersions.includes(settings.version);
  $('warn').classList.toggle('hidden', !noNova);
  $('warn').textContent = !noNova ? '' : state.novaVersions.length ? t('st_noNova', [settings.version]) : t('novaNone');
}

// ---------------------------------------------------------------- cuentas
/** Cara del skin (8x8 en la textura de 64x64) + la capa del sombrero, dibujadas con CSS. */
function skinHead(el, url, size) {
  if (!url) { el.classList.remove('skin'); el.style.backgroundImage = ''; return; }
  el.classList.add('skin');
  const u = `url("${url.replace(/"/g, '')}")`;
  el.style.backgroundImage = `${u}, ${u}`;
  el.style.backgroundSize = `${size * 64}px auto, ${size * 64}px auto`; // la textura mide 64 pixeles de ancho
  el.style.backgroundPosition = `${-size * 40}px ${-size * 8}px, ${-size * 8}px ${-size * 8}px`; // sombrero (40,8) encima de la cara (8,8)
}

function renderAccounts() {
  const acc = state.accounts || { active: 'offline', accounts: [] };
  const cur = acc.accounts.find((a) => a.id === acc.active);
  const name = cur ? cur.name : settings.username;
  $('profile-name').textContent = name;
  $('profile-type').textContent = cur ? t('premium') : t('offline');
  $('avatar').textContent = cur && cur.skin ? '' : name[0].toUpperCase();
  skinHead($('avatar'), cur ? cur.skin : '', 36 / 8);
  const list = $('acc-list');
  list.innerHTML = '';
  const rows = [...acc.accounts.map((a) => ({ ...a, premium: true })), { id: 'offline', name: settings.username, premium: false }];
  for (const a of rows) {
    const on = a.id === acc.active || (!cur && a.id === 'offline');
    const row = document.createElement('div');
    row.className = 'acc' + (on ? ' on' : '');
    row.innerHTML = `<div class="head">${esc(a.name[0].toUpperCase())}</div>
      <div class="who"><b>${esc(a.name)}</b><span class="tag">${esc(a.premium ? t('premium') : t('offline'))}</span></div>
      ${on ? `<span class="using">${esc(t('inUse'))}</span>` : `<button class="use">${esc(t('use'))}</button>`}
      ${a.premium ? `<button class="x" title="${esc(t('removeAcc'))}">&#10005;</button>` : ''}`;
    if (a.premium) skinHead(row.querySelector('.head'), a.skin, 30 / 8);
    const use = row.querySelector('.use');
    if (use) use.onclick = async () => { state.accounts = await nova.accounts.select(a.id); render(); };
    const x = row.querySelector('.x');
    if (x) x.onclick = async () => { state.accounts = await nova.accounts.remove(a.id); toast(t('accRemoved')); render(); };
    list.appendChild(row);
  }
}

async function addMicrosoft() {
  const btn = $('acc-add');
  btn.disabled = true;
  toast(t('logging'));
  try {
    const r = await nova.accounts.addMicrosoft();
    if (r.ok) {
      state.accounts = r.list;
      const cur = r.list.accounts.find((a) => a.id === r.list.active);
      toast(t('accAdded', [cur ? cur.name : '']));
      render();
    } else {
      if (r.error !== 'loginCancel') log('[Nova] ' + (r.detail || r.error));
      toast(t('acc_' + r.error));
    }
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------- mods (Modrinth)
const mods = { tab: 'browse', offset: 0, total: 0, query: '', loaded: false, installed: { user: [], client: [], other: [] }, timer: null, busy: new Set() };

function esc(x) { return String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function shortNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n); }

function modState(id) {
  const slug = ((mods.info || {})[id] || {}).slug;
  const cs = state.clientSlugs || { always: [], perf: [] };
  if (slug && (cs.always.includes(slug) || (settings.perf && cs.perf.includes(slug)))) return 'included';
  if (mods.installed.client.some((m) => m.projectId === id)) return 'included';
  if (mods.installed.user.some((m) => m.projectId === id)) return 'isInstalled';
  if (mods.busy.has(id)) return 'installing';
  return 'install';
}

function modButton(id) {
  const st = modState(id);
  return `<button class="mod-btn" data-install="${esc(id)}" ${st === 'install' ? '' : 'disabled'}>${esc(t(st))}</button>`;
}

async function refreshInstalled() {
  const r = await nova.mods.list(settings.version);
  if (r.ok) mods.installed = { user: r.user, client: r.client, other: r.other };
  renderInstalled();
  document.querySelectorAll('[data-install]').forEach((b) => { b.outerHTML = modButton(b.dataset.install); });
}

function renderInstalled() {
  const icon = (u) => u ? `<img class="mod-icon" src="${esc(u)}" alt="">` : '<div class="mod-icon"></div>';
  const row = (m, removable, note) => `<div class="mod-row">${icon(m.icon)}<div><div class="mod-title">${esc(m.title || m.slug || m.filename)}</div>
    <div class="mod-meta">${esc(m.filename)}${note ? ' · ' + esc(note) : ''}</div></div>
    ${removable ? `<button class="mod-btn remove" data-remove="${esc(m.filename)}">${esc(t('remove'))}</button>` : ''}</div>`;
  const { user, client, other } = mods.installed;
  let html = `<div class="mods-section">${esc(t('yourMods'))}</div>`;
  html += user.length ? `<div class="mods-list">${user.map((m) => row(m, true, m.dependency ? t('depNote') : '')).join('')}</div>` : `<div class="mods-empty">${esc(t('noMods'))}</div>`;
  if (other.length) html += `<div class="mods-section">${esc(t('otherMods'))}</div><div class="mods-list">${other.map((m) => row(m, true)).join('')}</div>`;
  if (client.length) html += `<div class="mods-section">${esc(t('clientMods'))}</div><div class="mods-list">${client.map((m) => row({ ...m, title: m.slug }, false)).join('')}</div>`;
  $('mods-installed').innerHTML = html;
}

async function searchMods(reset) {
  if (reset) { mods.offset = 0; $('mods-results').innerHTML = ''; }
  const r = await nova.mods.search(settings.version, mods.query, mods.offset, $('mods-sort').value);
  if (!r.ok) { $('mods-results').innerHTML = `<div class="mods-empty">${esc(t('error', [r.error]))}</div>`; return; }
  mods.total = r.total;
  mods.info = mods.info || {};
  r.hits.forEach((h) => { mods.info[h.projectId] = { title: h.title, icon: h.icon, slug: h.slug }; });
  const cards = r.hits.map((h) => `<div class="mod-card">
      ${h.icon ? `<img class="mod-icon" src="${esc(h.icon)}" alt="">` : '<div class="mod-icon"></div>'}
      <div style="min-width:0"><div class="mod-title">${esc(h.title)}</div>
      <div class="mod-desc">${esc(h.description)}</div>
      <div class="mod-foot"><span class="mod-meta">${esc(t('downloadsN', [shortNum(h.downloads)]))} · ${esc(h.author)}</span>${modButton(h.projectId)}</div></div>
    </div>`).join('');
  $('mods-results').insertAdjacentHTML('beforeend', cards);
  if (reset && !r.hits.length) $('mods-results').innerHTML = `<div class="mods-empty">${esc(t('noResults'))}</div>`;
  r.hits.forEach((h) => { mods.info = mods.info || {}; mods.info[h.projectId] = { title: h.title, icon: h.icon, slug: h.slug }; });
  mods.offset += r.hits.length;
  $('mods-more').classList.toggle('hidden', mods.offset >= mods.total);
}

function openMods() {
  $('mods-version').textContent = settings.version;
  if (!mods.loaded || mods.version !== settings.version) {
    mods.loaded = true; mods.version = settings.version;
    refreshInstalled().then(() => searchMods(true));
  }
}

function initMods() {
  document.querySelectorAll('#mods-tabs button').forEach((b) => {
    b.onclick = () => {
      mods.tab = b.dataset.v;
      document.querySelectorAll('#mods-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      $('mods-browse').classList.toggle('hidden', mods.tab !== 'browse');
      $('mods-installed').classList.toggle('hidden', mods.tab !== 'installed');
      if (mods.tab === 'installed') refreshInstalled();
    };
  });
  $('mods-query').oninput = (e) => {
    clearTimeout(mods.timer);
    mods.timer = setTimeout(() => { mods.query = e.target.value.trim(); searchMods(true); }, 350);
  };
  $('mods-sort').onchange = () => searchMods(true);
  $('mods-more').onclick = () => searchMods(false);
  document.addEventListener('click', async (e) => {
    const ib = e.target.closest('[data-install]');
    if (ib && !ib.disabled) {
      const id = ib.dataset.install;
      mods.busy.add(id); ib.outerHTML = modButton(id);
      const r = await nova.mods.install(settings.version, id, (mods.info || {})[id] || {});
      mods.busy.delete(id);
      if (r.ok) toast(r.already ? t('isInstalled') : t('modInstalled', [r.installed.join(', ')])); else toast(t('error', [r.error]));
      refreshInstalled();
    }
    const rb = e.target.closest('[data-remove]');
    if (rb) {
      const r = await nova.mods.remove(settings.version, rb.dataset.remove);
      toast(r.ok ? t('modRemoved') : t('error', [r.error]));
      refreshInstalled();
    }
  });
}

// ---------------------------------------------------------------- inicio
async function init() {
  state = await nova.getState();
  settings = state.settings;
  drawLogo();
  background();

  $('version').innerHTML = state.versions.map((v) => {
    const star = state.novaVersions.includes(v) ? '  ★ Nova' : '';
    return `<option value="${v}">${v}${star}</option>`;
  }).join('');
  $('theme').innerHTML = THEMES.map(([a]) => `<button style="background:${a}"></button>`).join('');

  document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + b.dataset.page));
    if (b.dataset.page === 'mods') openMods();
    if (b.dataset.page === 'perf') openPerf();
    if (b.dataset.page === 'servers') openServers();
  }));
  $('btn-min').onclick = () => nova.window('min');
  $('btn-close').onclick = () => nova.window('close');

  $('version').onchange = (e) => save({ version: e.target.value });
  initMods();
  initServers();
  $('username').onchange = (e) => {
    const v = e.target.value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(v)) { toast(t('badName')); e.target.value = settings.username; return; }
    save({ username: v }).then(() => toast(t('saved')));
  };
  $('ram').oninput = (e) => { $('ram-val').textContent = e.target.value + ' GB'; };
  $('ram').onchange = (e) => save({ ramGB: Number(e.target.value), ramAuto: false });
  for (const k of ['perf', 'nova', 'fullscreen', 'closeOnLaunch']) $(k).onclick = () => save({ [k]: !settings[k] });
  document.querySelectorAll('#lang button').forEach((b) => { b.onclick = () => save({ lang: b.dataset.v }); });
  document.querySelectorAll('#theme button').forEach((b, i) => { b.onclick = () => save({ theme: i }); });
  document.querySelectorAll('[data-folder]').forEach((b) => { b.onclick = () => nova.openFolder(b.dataset.folder); });
  $('repair').onclick = async () => {
    const r = await nova.repair(settings.version);
    if (r.ok) toast(t('repaired'));
  };

  nova.on('status', (s) => showStatus(s));
  nova.on('progress', (p) => setProgress(p.value));
  nova.on('log', log);
  nova.on('error', (e) => {
    const msg = String(e.message || '').startsWith('acc_') ? t(e.message) : e.message;
    setProgress(0); showStatus({ key: 'error', text: t('error', [msg]) }); log('[Nova] ' + msg);
  });
  $('acc-add').onclick = addMicrosoft;
  nova.on('update', (u) => {
    const box = $('update');
    box.classList.remove('hidden');
    if (u.version) box.dataset.version = u.version;
    const v = box.dataset.version || '';
    const ready = u.state === 'ready' || u.state === 'installing';
    $('update-title').textContent = u.state === 'installing' ? t('updateInstalling') : ready ? t('updateReady') : t('updateDownloading');
    $('update-sub').textContent = ready ? t('updateReadySub', [v]) : t('updateVersion', [v, u.percent || 0]);
    $('update-fill').style.width = (ready ? 100 : u.percent || 0) + '%';
    $('update-btn').classList.toggle('hidden', !ready);
  });
  nova.on('update-required', () => { setProgress(0); toast(t('updateRequired')); }); // actualizacion obligatoria
  $('update-btn').onclick = async () => { if (!(await nova.installUpdate())) toast(t('updateLater')); };
  document.querySelector('.profile').onclick = () => { const b = document.querySelector('.nav[data-page="settings"]'); if (b) b.click(); };
  nova.on('game-closed', ({ code, nova: usedNova }) => {
    if ($('page-perf').classList.contains('active')) openPerf(); // llegaron FPS nuevos de la partida
    if (!code) showStatus({ key: 'closed', text: t('closed') });
    else if (usedNova) showStatus({ key: 'novaCrashed', text: t('novaCrashed', [code]) });
    else showStatus({ key: 'crashed', text: t('crashed', [code]) });
    $('play-safe').classList.toggle('hidden', !(code && usedNova)); // si Nova fallo, se puede seguir jugando sin ella
    setProgress(0);
  });

  const start = async (opts) => {
    setBusy(true);
    setProgress(-1);
    $('play-safe').classList.add('hidden');
    $('log').textContent = '';
    await nova.play(settings.version, opts);
    setBusy(false);
  };
  window.novaStart = start; // la pagina Servidores entra directo a un servidor
  $('play').onclick = () => start({});
  $('play-safe').onclick = () => start({ skipNova: true });

  render();
  setBusy(state.running);
}

// ---------------------------------------------------------------- servidores (ping real y entrar directo)
const srvState = {};

function openServers(force) {
  renderServers();
  for (const s of settings.servers) if (force || !srvState[s.address]) pingOne(s.address);
}

async function pingOne(address) {
  srvState[address] = { wait: true };
  renderServers();
  srvState[address] = await nova.pingServer(address);
  renderServers();
}

function renderServers() {
  const list = settings.servers, st = list.map((s) => srvState[s.address] || {});
  const measured = st.filter((x) => !x.wait && x.ok !== undefined).length, up = st.filter((x) => x.ok).length;
  const players = st.reduce((a, x) => a + (x.ok ? x.online : 0), 0);
  $('srv-tiles').innerHTML = [[t('srvMeasured'), measured], [t('srvOnline'), up], [t('srvPlayers'), players.toLocaleString()]]
    .map(([k, v]) => `<div class="fps-tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('srv-grid').innerHTML = list.map((s, i) => {
    const x = st[i];
    const icon = x.ok && x.favicon ? `<img class="srv-icon" src="${x.favicon}">` : `<div class="srv-icon">${esc(s.name[0] || '?')}</div>`;
    const pill = x.wait || x.ok === undefined ? `<span class="pill wait">${t('srvMeasuring')}</span>`
      : x.ok ? `<span class="pill on">${t('srvUp')}</span>` : `<span class="pill off">${t('srvDown')}</span>`;
    const ping = x.ok ? `<span class="ping ${x.ping < 90 ? 'good' : x.ping < 180 ? 'mid' : 'bad'}">${x.ping} ms</span>` : '';
    const who = x.ok ? `<span>${x.online.toLocaleString()} / ${x.max.toLocaleString()}</span>` : '';
    return `<div class="srv" style="animation-delay:${i * 0.04}s"><button class="srv-x" data-del="${i}" title="${t('srvRemove')}">&#10005;</button>
      <div class="srv-top">${icon}<div style="min-width:0"><div class="srv-name">${esc(s.name)}</div><div class="srv-addr">${esc(s.address)}</div></div></div>
      <div class="srv-motd">${x.ok ? esc(x.motd || x.version) : x.wait ? '' : esc(x.error ? t('srvNoAnswer') : '')}</div>
      <div class="srv-meta">${pill}${who}${ping}${x.ok && x.version ? `<span class="dim small">${esc(x.version.slice(0, 24))}</span>` : ''}</div>
      <div class="srv-foot"><button class="mod-btn" data-join="${i}">${t('srvJoin')}</button></div></div>`;
  }).join('');
  $('srv-grid').querySelectorAll('[data-join]').forEach((b) => b.onclick = () => {
    const s = list[Number(b.dataset.join)];
    document.querySelector('.nav[data-page="play"]').click();
    toast(t('srvJoining', [s.name, settings.version]));
    window.novaStart({ server: s.address });
  });
  $('srv-grid').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    await save({ servers: list.filter((_, j) => j !== Number(b.dataset.del)) });
    renderServers();
  });
}

function initServers() {
  $('srv-refresh').onclick = () => openServers(true);
  $('srv-add-btn').onclick = async () => {
    const address = $('srv-addr').value.trim(), name = $('srv-name').value.trim() || address.split(':')[0];
    if (!/^[^:\s]+(:\d{1,5})?$/.test(address)) { toast(t('srvBadAddr')); return; }
    await save({ servers: [...settings.servers, { name, address }] });
    $('srv-addr').value = ''; $('srv-name').value = '';
    pingOne(address);
  };
}

// ---------------------------------------------------------------- rendimiento (FPS que manda Nova, equipo y perfiles)
const PROFILES = ['auto', 'performance', 'balanced', 'quality'];
let hwInfo = null;

async function openPerf() {
  renderPerfProfiles();
  renderRamPresets();
  if (!hwInfo) {
    hwInfo = await nova.hardware();
    const kind = { dedicated: t('gpuDedicated'), integrated: t('gpuIntegrated'), unknown: '' }[hwInfo.gpuKind] || '';
    $('hw').innerHTML = [
      [t('hwGpu'), esc(hwInfo.gpu || t('hwUnknown')) + (kind ? ` <span class="dim small">(${kind})</span>` : '')],
      [t('hwRam'), hwInfo.ramGB + ' GB'], [t('hwThreads'), String(hwInfo.threads)],
      [t('hwRecommended'), `${t('prof_' + hwInfo.profile)} · ${hwInfo.ram} GB RAM`],
    ].map(([k, v]) => `<div class="hw-row"><span>${k}</span><b>${v}</b></div>`).join('');
    renderPerfProfiles();
  }
  renderFps(await nova.fpsSessions());
}

function renderPerfProfiles() {
  $('prof-for').textContent = t('profFor', [settings.version]);
  const rec = hwInfo ? hwInfo.profile : null;
  $('prof-list').innerHTML = PROFILES.map((p) => `<div class="prof${p === 'auto' ? ' rec' : ''}"><div>
      <b>${t('prof_' + p)}${p === 'auto' ? ` <span class="badge">${t('recommended')}</span>` : ''}</b>
      <div class="dim">${p === 'auto' && rec ? t('profAutoIs', [t('prof_' + rec)]) : t('profd_' + p)}</div></div>
      <button class="ghost" data-prof="${p}">${t('apply')}</button></div>`).join('');
  $('prof-list').querySelectorAll('button').forEach((b) => b.onclick = async () => {
    const r = await nova.applyProfile(settings.version, b.dataset.prof);
    toast(r.ok ? t('profApplied', [t('prof_' + r.profile), settings.version]) : t('error', ['?']));
  });
}

function renderRamPresets() {
  const opts = ['auto', 2, 3, 4, 6, 8].filter((v) => v === 'auto' || v <= state.maxRam);
  $('ram-presets').innerHTML = opts.map((v) => {
    const on = v === 'auto' ? settings.ramAuto : !settings.ramAuto && settings.ramGB === v;
    return `<button data-v="${v}" class="${on ? 'on' : ''}">${v === 'auto' ? t('ramAuto', [settings.ramAuto ? settings.ramGB : '']) : v + ' GB'}</button>`;
  }).join('');
  $('ram-presets').querySelectorAll('button').forEach((b) => b.onclick = async () => {
    await save(b.dataset.v === 'auto' ? { ramAuto: true } : { ramGB: Number(b.dataset.v), ramAuto: false });
    renderRamPresets();
  });
}

function renderFps(list) {
  if (!list.length) {
    $('fps-tiles').innerHTML = ''; $('fps-list').innerHTML = `<div class="mods-empty">${t('fpsNone')}</div>`;
    drawFpsChart([]); return;
  }
  const last = list[0], prev = list.find((s, i) => i > 0 && s.mc === last.mc);
  const diff = prev ? Math.round((last.avg - prev.avg) / Math.max(1, prev.avg) * 100) : null;
  const tile = (k, v, unit, d) => `<div class="fps-tile"><div class="k">${k}</div><div class="v">${v}<small>${unit}</small></div>${d || ''}</div>`;
  $('fps-tiles').innerHTML = tile(t('fpsAvg'), Math.round(last.avg), 'FPS',
      diff === null ? '' : `<div class="d ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} % ${t('fpsVsPrev')}</div>`)
    + tile(t('fpsLow'), Math.round(last.low), 'FPS', `<div class="dim small">${t('fpsLowHint')}</div>`)
    + tile(t('fpsMax'), last.max, 'FPS') + tile(t('fpsSessions'), list.length, '');
  const fmt = (ms) => new Date(ms).toLocaleString(settings.lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('fps-list').innerHTML = `<div class="fps-row head"><span>${t('fpsWhen')}</span><span>${t('version')}</span><span>${t('fpsMode')}</span><span>${t('fpsAvg')}</span><span>${t('fpsLow')}</span><span>${t('fpsTime')}</span></div>`
    + list.slice(0, 30).map((s) => `<div class="fps-row"><span>${fmt(s.time)}</span><span>${esc(s.mc)}</span>
      <span class="mode-tag m${s.mode | 0}">${t('mode' + (s.mode | 0))}</span><b>${Math.round(s.avg)}</b><span>${Math.round(s.low)}</span>
      <span class="dim">${Math.round(s.seconds / 60)} min</span></div>`).join('');
  drawFpsChart(list.slice(0, 20).reverse());
}

/** Barras con el promedio de cada partida y una linea con el 1 % mas bajo (crecen con una animacion). */
function drawFpsChart(data) {
  const c = $('fps-chart'), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  if (!data.length) { g.clearRect(0, 0, w, h); return; }
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const max = Math.max(30, ...data.map((s) => s.max || s.avg)) * 1.1, bw = w / data.length, start = performance.now();
  const frame = (now) => {
    const k = Math.min(1, (now - start) / 600), e = 1 - Math.pow(1 - k, 3);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
    for (let i = 1; i <= 3; i++) { const y = h - (h * i) / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    data.forEach((s, i) => {
      const bh = (s.avg / max) * (h - 16) * e, x = i * bw + bw * 0.18;
      const gr = g.createLinearGradient(0, h - bh, 0, h); gr.addColorStop(0, accent); gr.addColorStop(1, 'rgba(255,255,255,.04)');
      g.fillStyle = gr; g.beginPath(); g.roundRect(x, h - bh, bw * 0.64, bh, 5); g.fill();
    });
    g.strokeStyle = '#fbbf24'; g.lineWidth = 2; g.beginPath();
    data.forEach((s, i) => { const x = i * bw + bw / 2, y = h - (s.low / max) * (h - 16) * e; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

init();

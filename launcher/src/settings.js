const fs = require('fs');
const path = require('path');
const { SUPPORTED, DEFAULT_VERSION } = require('./versions');

const DEFAULTS = {
  username: 'Player',
  ramGB: 4,
  lang: 'es',
  theme: 0,
  fullscreen: false,
  nova: true,
  perf: true,
  closeOnLaunch: false,
  version: DEFAULT_VERSION,
};

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function clean(s, maxRamGB = 32) {
  const out = { ...DEFAULTS, ...(s || {}) };
  if (!NAME_RE.test(out.username)) out.username = DEFAULTS.username;
  out.ramGB = Math.max(1, Math.min(maxRamGB, Math.round(Number(out.ramGB) || DEFAULTS.ramGB)));
  if (!['es', 'en', 'pt'].includes(out.lang)) out.lang = DEFAULTS.lang;
  out.theme = Math.max(0, Math.min(5, Number(out.theme) | 0));
  if (!SUPPORTED.includes(out.version)) out.version = DEFAULT_VERSION;
  for (const k of ['fullscreen', 'nova', 'perf', 'closeOnLaunch']) out[k] = !!out[k];
  return out;
}

function load(file, maxRamGB) {
  try { return clean(JSON.parse(fs.readFileSync(file, 'utf8')), maxRamGB); } catch { return clean({}, maxRamGB); }
}

function save(file, s, maxRamGB) {
  const c = clean(s, maxRamGB);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c, null, 2));
  return c;
}

module.exports = { load, save, clean, DEFAULTS, NAME_RE };

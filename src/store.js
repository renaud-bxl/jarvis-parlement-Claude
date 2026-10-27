// Stockage local : fichiers JSON atomiques + secrets chiffrés (trousseau macOS via Electron safeStorage).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let electron = null;
try { const e = require('electron'); if (e && typeof e === 'object' && e.app) electron = e; } catch { /* hors Electron (tests) */ }

const DIR = process.env.JARVIS_DATA_DIR ||
  (electron ? path.join(electron.app.getPath('appData'), 'Jarvis Parlement')
            : path.join(os.homedir(), 'Library', 'Application Support', 'Jarvis Parlement'));
fs.mkdirSync(DIR, { recursive: true });

const DOCS_DEFAULT = process.env.JARVIS_DOCS_DIR || path.join(os.homedir(), 'Documents', 'Jarvis-Parlement');

const DEFAULT_SETTINGS = {
  profile: { nom: '', titre: 'Député(e)', groupe: '', parti: '', circonscription: '', parlements: ['bxl-pb'], parlementActif: 'bxl-pb', langue: 'fr', signature: '' },
  ai: { provider: 'anthropic', model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5', baseUrl: 'http://localhost:11434/v1', localModel: '', webSearch: true },
  docs: { folders: [DOCS_DEFAULT] },
  veille: { enabled: false, time: '07:30', days: [1, 2, 3, 4, 5], topics: [], lastRun: null },
  google: { clientId: '', accounts: [] },
  mail: { accounts: [], briefingIncludesMail: false },
  brain: { learning: true },
  voice: { engine: 'system', piperVoice: 'siwis', ttsVoice: '', ttsRate: 1, autoSpeak: false, stt: 'macos', sttUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1' },
  jarvis: { cloudMailOk: false, converse: false },
  firstRunDone: false,
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && over[k] && typeof over[k] === 'object')
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

function file(name) { return path.join(DIR, name + '.json'); }

function read(name, def) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return def === undefined ? null : JSON.parse(JSON.stringify(def)); }
}

function write(name, data) {
  const f = file(name), tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  return data;
}

function update(name, def, fn) {
  const cur = read(name, def);
  const res = fn(cur);
  return write(name, res === undefined ? cur : res);
}

const settings = {
  get() { return deepMerge(DEFAULT_SETTINGS, read('settings', {})); },
  set(patch) { return write('settings', deepMerge(settings.get(), patch)); },
  replace(obj) { return write('settings', obj); },
};

// ---- Secrets ----
function secretsRead() { return read('secrets', {}); }
function canEncrypt() { try { return !!(electron && electron.safeStorage.isEncryptionAvailable()); } catch { return false; } }
function setSecret(key, value) {
  const s = secretsRead();
  if (value === null || value === undefined || value === '') delete s[key];
  else if (canEncrypt()) s[key] = { e: 1, v: electron.safeStorage.encryptString(String(value)).toString('base64') };
  else s[key] = { e: 0, v: Buffer.from(String(value)).toString('base64') };
  write('secrets', s);
}
function getSecret(key) {
  const x = secretsRead()[key];
  if (!x) return null;
  try { return x.e ? electron.safeStorage.decryptString(Buffer.from(x.v, 'base64')) : Buffer.from(x.v, 'base64').toString(); }
  catch { return null; }
}
function hasSecret(key) { return !!secretsRead()[key]; }

const uid = (p = 'id') => p + '_' + crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();

module.exports = { DIR, DOCS_DEFAULT, read, write, update, settings, setSecret, getSecret, hasSecret, canEncrypt, uid, now, deepMerge };

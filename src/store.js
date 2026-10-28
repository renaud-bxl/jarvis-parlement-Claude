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
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DIR, 0o700); } catch { /* ok */ }

const DOCS_DEFAULT = process.env.JARVIS_DOCS_DIR || path.join(os.homedir(), 'Documents', 'Jarvis-Parlement');

const DEFAULT_SETTINGS = {
  profile: { nom: '', titre: 'Député(e)', groupe: '', parti: '', circonscription: '', parlements: ['bxl-pb'], parlementActif: 'bxl-pb', langue: 'fr', signature: '' },
  ai: { provider: 'anthropic', model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5', baseUrl: 'http://localhost:11434/v1', localModel: '', fastLocalModel: '', webSearch: true },
  docs: { folders: [DOCS_DEFAULT] },
  veille: { enabled: false, time: '07:30', days: [1, 2, 3, 4, 5], topics: [], lastRun: null },
  google: { clientId: '', accounts: [] },
  mail: { accounts: [], briefingIncludesMail: false },
  brain: { learning: true },
  voice: { engine: 'piper', piperVoice: 'siwis', ttsVoice: '', ttsRate: 1, autoSpeak: false, stt: 'macos', sttUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1' },
  jarvis: { cloudMailOk: false, converse: false },
  firstRunDone: false,
};

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (UNSAFE_KEYS.has(k)) continue; // jamais de pollution de prototype (réglages/import malicieux)
    out[k] = (k in base && isObj(base[k]) && isObj(over[k])) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,60}$/;
function file(name) {
  if (!NAME_RE.test(String(name))) throw new Error('Nom de fichier interne invalide.');
  return path.join(DIR, name + '.json');
}

function parseFile(f) {
  const raw = fs.readFileSync(f, 'utf8');
  if (!raw.trim()) throw new SyntaxError('fichier vide');
  const j = JSON.parse(raw);
  if (j === null || typeof j !== 'object') throw new SyntaxError('structure inattendue');
  return j;
}

// Un fichier illisible est mis de côté (jamais écrasé en silence) : on tente d'abord la sauvegarde .bak.
function quarantine(f) {
  try {
    fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
    const base = path.basename(f) + '.corrupt-';
    const old = fs.readdirSync(DIR).filter((n) => n.startsWith(base)).sort();
    for (const n of old.slice(0, -3)) fs.rmSync(path.join(DIR, n), { force: true });
  } catch { /* ok */ }
}

function read(name, def) {
  const f = file(name);
  const fallback = () => (def === undefined ? null : JSON.parse(JSON.stringify(def)));
  const shapeOk = (j) => !(Array.isArray(j) !== Array.isArray(def) && def !== undefined && def !== null);
  try { const j = parseFile(f); if (shapeOk(j)) return j; throw new SyntaxError('forme inattendue'); }
  catch (e) {
    if (e.code === 'ENOENT') return fallback();
    if (!(e instanceof SyntaxError)) return fallback(); // droits, E/S : on ne touche à rien
    quarantine(f);
    try { const j = parseFile(f + '.bak'); if (shapeOk(j)) { fs.copyFileSync(f + '.bak', f); return j; } } catch { /* pas de sauvegarde */ }
    return fallback();
  }
}

let tmpSeq = 0;
function write(name, data) {
  const f = file(name), tmp = `${f}.${process.pid}.${++tmpSeq}.tmp`;
  const json = name === 'index' ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  if (json === undefined) throw new Error('Données non sérialisables.');
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (name !== 'index') { try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch { /* ok */ } }
    fs.renameSync(tmp, f);
    try { fs.chmodSync(f, 0o600); } catch { /* ok */ }
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ok */ }
    throw new Error(`Écriture impossible (${e.code || e.message}). Vérifie l'espace disque et les droits du dossier ${DIR}.`);
  }
  return data;
}

// Nettoyage au démarrage : fichiers temporaires orphelins (plantage pendant une écriture).
try { for (const n of fs.readdirSync(DIR)) if (n.endsWith('.tmp') && Date.now() - fs.statSync(path.join(DIR, n)).mtimeMs > 3600e3) fs.rmSync(path.join(DIR, n), { force: true }); } catch { /* ok */ }
function corruptFiles() { try { return fs.readdirSync(DIR).filter((n) => /\.corrupt-\d+$/.test(n)); } catch { return []; } }

function update(name, def, fn) {
  const cur = read(name, def);
  const res = fn(cur);
  return write(name, res === undefined ? cur : res);
}

// Garantit les types attendus (fichier édité à la main ou ancien format) pour éviter des plantages en cascade.
function normalizeSettings(s) {
  const D = DEFAULT_SETTINGS;
  const arr = (o, k, d) => { if (!Array.isArray(o[k])) o[k] = JSON.parse(JSON.stringify(d)); };
  for (const sec of ['profile', 'ai', 'docs', 'veille', 'google', 'mail', 'brain', 'voice', 'jarvis']) if (!isObj(s[sec])) s[sec] = JSON.parse(JSON.stringify(D[sec]));
  arr(s.docs, 'folders', D.docs.folders); arr(s.veille, 'topics', []); arr(s.veille, 'days', D.veille.days);
  arr(s.google, 'accounts', []); arr(s.mail, 'accounts', []); arr(s.profile, 'parlements', D.profile.parlements);
  s.docs.folders = s.docs.folders.filter((x) => typeof x === 'string' && x);
  s.veille.topics = s.veille.topics.filter((t) => isObj(t));
  if (typeof s.veille.time !== 'string' || !/^\d{2}:\d{2}$/.test(s.veille.time)) s.veille.time = D.veille.time;
  if (!s.profile.parlements.length) s.profile.parlements = D.profile.parlements.slice();
  if (typeof s.profile.parlementActif !== 'string' || !s.profile.parlementActif) s.profile.parlementActif = s.profile.parlements[0];
  return s;
}

const settings = {
  get() { return normalizeSettings(JSON.parse(JSON.stringify(deepMerge(DEFAULT_SETTINGS, read('settings', {}))))); }, // copie profonde : l'appelant ne peut pas altérer les valeurs par défaut
  set(patch) { return write('settings', deepMerge(settings.get(), patch)); },
  replace(obj) { return write('settings', obj); },
};

// ---- Secrets ----
// Les secrets ne sont JAMAIS stockés en clair : sans trousseau (safeStorage), l'enregistrement est refusé.
// (Seul JARVIS_INSECURE_SECRETS=1 — réservé aux tests automatisés — autorise un encodage non chiffré.)
function secretsRead() { return read('secrets', {}); }
function canEncrypt() { try { return !!(electron && electron.safeStorage.isEncryptionAvailable()); } catch { return false; } }
function setSecret(key, value) {
  if (!/^[a-zA-Z0-9_.:@+-]{1,200}$/.test(String(key))) throw new Error('Nom de secret invalide.');
  const s = secretsRead();
  if (value === null || value === undefined || value === '') delete s[key];
  else {
    value = String(value);
    if (value.length > 8192) throw new Error('Secret trop long.');
    if (canEncrypt()) s[key] = { e: 1, v: electron.safeStorage.encryptString(value).toString('base64') };
    else if (process.env.JARVIS_INSECURE_SECRETS === '1') s[key] = { e: 0, v: Buffer.from(value).toString('base64') };
    else throw new Error("Le trousseau chiffré de macOS n'est pas disponible : par sécurité, Jarvis refuse d'enregistrer un mot de passe ou une clé en clair. Déverrouille la session macOS (trousseau « Jarvis Parlement Safe Storage ») puis relance l'application.");
  }
  write('secrets', s);
}
function getSecret(key) {
  const x = secretsRead()[key];
  if (!x || typeof x.v !== 'string') return null;
  try { return x.e ? electron.safeStorage.decryptString(Buffer.from(x.v, 'base64')) : Buffer.from(x.v, 'base64').toString(); }
  catch { return null; }
}
function hasSecret(key) { const x = secretsRead()[key]; return !!(x && typeof x.v === 'string'); }
// Secrets hérités d'une ancienne version et encodés sans chiffrement (à ressaisir).
function plainSecretNames() { return Object.entries(secretsRead()).filter(([, x]) => x && !x.e).map(([k]) => k); }

const uid = (p = 'id') => p + '_' + crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();

module.exports = { DIR, DOCS_DEFAULT, read, write, update, settings, setSecret, getSecret, hasSecret, canEncrypt, plainSecretNames, corruptFiles, uid, now, deepMerge };

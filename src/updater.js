// Mise à jour automatique « maison » depuis les GitHub Releases du dépôt de Jarvis Parlement.
//
// Pourquoi « maison » : l'application est signée « ad-hoc » et non notarisée. L'autoUpdater natif d'Electron (Squirrel.Mac) exige une
// signature valide et ne peut donc pas fonctionner. Ici : l'API GitHub annonce la dernière version (avec la taille et l'empreinte
// sha256 de chaque fichier), l'utilisateur clique, le .dmg est téléchargé et vérifié, puis un petit script détaché remplace l'application
// quand elle s'est fermée, la relance et nettoie.
//
// Règles non négociables (testées dans scripts/test-updater.js) :
//   - jamais d'installation sans clic explicite ; jamais d'installation silencieuse ;
//   - HTTPS uniquement, uniquement le dépôt REPO ci-dessous (constante gelée, aucun réglage ne peut la changer) ;
//   - empreinte sha256 de l'API vérifiée avant toute installation ; sans empreinte → pas d'installation automatique ;
//   - rien de non vérifié n'est exécuté ; le script d'installation est un texte constant (les chemins arrivent en arguments, jamais insérés) ;
//   - en développement (app non empaquetée) : on simule seulement.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');
const store = require('./store');

const REPO = 'renaud-bxl/jarvis-parlement-Claude';
const APP_NAME = 'Jarvis Parlement';
const BUNDLE_ID = 'be.jarvis.parlement';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases/`;
const DOWNLOAD_PREFIX = `/${REPO}/releases/download/`.toLowerCase();
const LIMITS = Object.freeze({ maxDmg: 600 * 1024 * 1024, minDmg: 1024, maxApiBytes: 1024 * 1024, maxNotes: 1500, maxRedirects: 5 });
const T = Object.freeze({ startDelay: 20000, api: 15000, header: 20000, stall: 30000, retryBase: 5 * 60000, minRateLimit: 60000, maxRateLimit: 24 * 3600e3, snoozeHours: 24, mountMs: 120000 });
const DEFAULT_HOURS = 6;

class UpdateError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

// ------------------------------------------------------------------ versions (semver) ------------------------------------------------------------------
const SEMVER = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z][0-9A-Za-z.-]{0,30}))?(?:\+[0-9A-Za-z.-]{1,30})?$/;
function parseVersion(s) {
  if (typeof s !== 'string' || s.length > 40) return null;
  const m = SEMVER.exec(s); if (!m) return null;
  const pre = m[4] ? m[4].split('.') : null;
  if (pre && pre.some((x) => x === '' || (/^\d+$/.test(x) && x.length > 1 && x[0] === '0'))) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre, text: `${m[1]}.${m[2]}.${m[3]}${m[4] ? '-' + m[4] : ''}` };
}
function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a, y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error('Version invalide.');
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre && !y.pre) return 0; if (!x.pre) return 1; if (!y.pre) return -1; // une pré-version précède la version finale
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]; if (p === undefined) return -1; if (q === undefined) return 1; if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return +p < +q ? -1 : 1; if (pn) return -1; if (qn) return 1; return p < q ? -1 : 1;
  }
  return 0;
}

// ------------------------------------------------------------------ analyse de la release ------------------------------------------------------------------
// Texte simple, sans balises ni Markdown, sans caractères de contrôle, tronqué.
function cleanNotes(body, max = LIMITS.maxNotes) {
  let t = typeof body === 'string' ? body.slice(0, 20000) : '';
  t = t.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>\n]{1,200}>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*+]\s+/gm, '• ').replace(/(\*\*|__|~~|`{1,3})/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}

const isGithubHost = (h) => h === 'github.com';
const isGithubusercontent = (h) => h === 'githubusercontent.com' || h.endsWith('.githubusercontent.com');
// URL de téléchargement : HTTPS, sans identifiants ni port exotique ; 1er saut = github.com du dépôt ; sauts suivants = github.com ou *.githubusercontent.com.
function checkDownloadUrl(raw, first) {
  let u; try { u = new URL(String(raw)); } catch { throw new UpdateError('host', 'Adresse de téléchargement invalide.'); }
  if (u.protocol !== 'https:') throw new UpdateError('insecure', 'Téléchargement refusé : la connexion n’est pas en HTTPS.');
  if (u.username || u.password || (u.port && u.port !== '443')) throw new UpdateError('host', 'Adresse de téléchargement refusée.');
  const h = u.hostname.toLowerCase();
  if (first) { if (!isGithubHost(h) || !u.pathname.toLowerCase().startsWith(DOWNLOAD_PREFIX)) throw new UpdateError('host', 'Téléchargement refusé : le fichier ne vient pas du dépôt officiel de Jarvis Parlement.'); }
  else if (!isGithubHost(h) && !isGithubusercontent(h)) throw new UpdateError('host', 'Téléchargement refusé : redirection vers un site qui n’est pas GitHub.');
  return u.href;
}

// Choix du .dmg pour l'architecture (arm64 → *-arm64.dmg, sinon *-x64.dmg), avec taille et empreinte annoncées par l'API.
function pickAsset(release, arch) {
  const want = arch === 'arm64' ? 'arm64' : 'x64';
  const tag = parseVersion(release && release.tag_name); if (!tag) return { asset: null, reason: 'no-asset' };
  const name = `Jarvis-Parlement-${tag.text}-${want}.dmg`;
  const a = (Array.isArray(release.assets) ? release.assets : []).find((x) => x && typeof x === 'object' && x.name === name && (x.state === undefined || x.state === 'uploaded'));
  if (!a) return { asset: null, reason: 'no-asset' };
  let url; try { url = checkDownloadUrl(a.browser_download_url, true); } catch { return { asset: null, reason: 'bad-url' }; }
  const size = a.size;
  if (!Number.isInteger(size) || size < LIMITS.minDmg || size > LIMITS.maxDmg) return { asset: null, reason: 'bad-size' };
  const m = /^sha256:([0-9a-f]{64})$/i.exec(typeof a.digest === 'string' ? a.digest : '');
  return { asset: { name, url, size, sha256: m ? m[1].toLowerCase() : null }, reason: m ? '' : 'no-digest' };
}

// Release brute (JSON de l'API) → { ok, version, notes, htmlUrl, asset, reason } ; ok=false : brouillon, pré-version, tag invalide.
function parseRelease(rel, arch) {
  if (!rel || typeof rel !== 'object' || Array.isArray(rel)) return { ok: false, reason: 'format' };
  if (rel.draft === true) return { ok: false, reason: 'draft' };
  if (rel.prerelease === true) return { ok: false, reason: 'prerelease' };
  const v = parseVersion(rel.tag_name);
  if (!v) return { ok: false, reason: 'bad-tag' };
  if (v.pre) return { ok: false, reason: 'prerelease' };
  let htmlUrl = ''; try { const u = new URL(String(rel.html_url)); if (u.protocol === 'https:' && u.hostname === 'github.com' && `https://github.com${u.pathname}`.toLowerCase().startsWith(RELEASES_URL.toLowerCase())) htmlUrl = u.href; } catch { /* repli ci-dessous */ }
  if (!htmlUrl) htmlUrl = `${RELEASES_URL}tag/v${v.text}`;
  const { asset, reason } = pickAsset(rel, arch);
  return { ok: true, version: v.text, notes: cleanNotes(rel.body), htmlUrl, publishedAt: typeof rel.published_at === 'string' ? rel.published_at.slice(0, 40) : '', asset, reason };
}

// ------------------------------------------------------------------ activité en cours (processus principal) ------------------------------------------------------------------
// main.js signale chaque appel d'API « long » ; l'installation ne se déclenche jamais en douce pendant l'un d'eux.
const BUSY_KIND = {
  'mail.send': 'mail', 'chat.send': 'ai', 'draft.run': 'ai', 'jarvis.command': 'ai', 'briefing.run': 'ai', 'research.web': 'ai', 'mail.summarize': 'ai', 'mail.reply.draft': 'ai',
  'doc.analyze': 'work', 'index.build': 'work', 'veille.run': 'work', 'voice.transcribe': 'voice', 'voice.synth': 'voice',
};
const BUSY_TEXT = { mail: 'un courriel est en cours d’envoi', ai: 'une demande à l’IA est en cours', voice: 'une conversation vocale est en cours', work: 'une analyse ou une indexation est en cours' };
const activity = new Map();
function track(method) {
  const k = BUSY_KIND[method]; if (!k) return () => {};
  activity.set(method, (activity.get(method) || 0) + 1); let done = false;
  return () => { if (done) return; done = true; const n = (activity.get(method) || 1) - 1; if (n > 0) activity.set(method, n); else activity.delete(method); };
}
function busyReasons({ voice = false, extra } = {}) {
  const kinds = new Set([...activity.keys()].map((m) => BUSY_KIND[m]));
  if (voice === true) kinds.add('voice');
  const out = ['mail', 'ai', 'voice', 'work'].filter((k) => kinds.has(k)).map((k) => BUSY_TEXT[k]);
  if (typeof extra === 'function') { try { for (const r of extra() || []) out.push(String(r)); } catch { /* sans effet */ } }
  return out;
}

// ------------------------------------------------------------------ script d'installation ------------------------------------------------------------------
// Texte CONSTANT : aucun chemin n'y est inséré. Tout arrive en arguments (espaces, apostrophes, $, backticks : sans effet).
// Arguments : PID MNT SRC DEST WORK LOG VERSION OPENER
const INSTALL_SCRIPT = String.raw`#!/bin/bash
# Jarvis Parlement : remplacement de l'application après un téléchargement vérifié (généré par src/updater.js, texte constant).
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
umask 077
if [ "$#" -ne 8 ]; then exit 2; fi
PID="$1"; MNT="$2"; SRC="$3"; DEST="$4"; WORK="$5"; LOG="$6"; VERSION="$7"; OPENER="$8"
DIR="$(dirname "$DEST")"; BASE="$(basename "$DEST")"
if [ -z "$BASE" ] || [ "$BASE" = "/" ] || [ "$DIR" = "$DEST" ]; then exit 2; fi
NEW="$DIR/.$BASE.new.$$"; OLD="$DIR/.$BASE.old.$$"
RELAUNCH_OLD=0
: >"$LOG" 2>/dev/null
log() { printf "%s %s\n" "$(date +%Y-%m-%dT%H:%M:%S)" "$*" >>"$LOG" 2>/dev/null; }
detach() {
  if [ -n "$MNT" ] && [ -d "$MNT" ]; then hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || hdiutil detach -force "$MNT" -quiet >/dev/null 2>&1; fi
  return 0
}
finish() {
  log "RESULT $1 $2 $VERSION"
  detach
  rm -rf "$NEW"
  if [ "$1" = fail ] && [ "$RELAUNCH_OLD" = 1 ] && [ -e "$DEST" ]; then "$OPENER" "$DEST" >/dev/null 2>&1; fi
  case "$(basename "$WORK")" in jarvis-update-*) rm -rf "$WORK" ;; esac
  if [ "$1" = ok ]; then exit 0; fi
  exit 1
}
# 1. Attendre la fermeture de l'application (jusqu'à 80 s) ; si elle reste ouverte, on ne touche à rien.
n=0
while kill -0 "$PID" 2>/dev/null; do
  n=$((n+1))
  if [ "$n" -gt 400 ]; then finish fail app-still-running; fi
  sleep 0.2
done
RELAUNCH_OLD=1
# 2. Copie de la nouvelle version À CÔTÉ de l'ancienne (même dossier : l'échange est un simple renommage).
rm -rf "$NEW" "$OLD"
if [ ! -d "$SRC" ]; then finish fail source-missing; fi
if ! ditto "$SRC" "$NEW" >>"$LOG" 2>&1; then finish fail copy; fi
if [ ! -f "$NEW/Contents/Info.plist" ] || [ ! -d "$NEW/Contents/MacOS" ]; then finish fail incomplete; fi
xattr -dr com.apple.quarantine "$NEW" >/dev/null 2>&1
detach
# 3. Échange : l'ancienne version est gardée comme sauvegarde tant que la nouvelle n'est pas lancée.
RESTORE=0
if [ -e "$DEST" ]; then
  if ! mv "$DEST" "$OLD" >>"$LOG" 2>&1; then finish fail backup; fi
  RESTORE=1
fi
if ! mv "$NEW" "$DEST" >>"$LOG" 2>&1; then
  if [ "$RESTORE" = 1 ]; then mv "$OLD" "$DEST" >>"$LOG" 2>&1; fi
  finish fail swap
fi
# 4. Relance ; en cas d'échec, retour arrière vers l'ancienne version.
if ! "$OPENER" "$DEST" >>"$LOG" 2>&1; then
  if [ "$RESTORE" = 1 ]; then rm -rf "$NEW"; mv "$DEST" "$NEW" && mv "$OLD" "$DEST"; fi
  finish fail launch
fi
rm -rf "$OLD"
finish ok installed
`;

// ------------------------------------------------------------------ outils ------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
const execFileP = (cmd, args, { timeout = 60000 } = {}) => new Promise((resolve, reject) => {
  cp.execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) })));
});
const rmQuiet = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ok */ } };
const clampHours = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(72, Math.max(1, n)) : DEFAULT_HOURS; };

// Lecture bornée d'une réponse HTTP (flux ou texte) : jamais plus de `max` octets en mémoire.
async function readBounded(res, max) {
  const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) throw new UpdateError('size', 'Réponse trop volumineuse.');
  if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
    const parts = []; let n = 0;
    for await (const c of res.body) { const b = Buffer.from(c); n += b.length; if (n > max) { try { if (res.body.cancel) await res.body.cancel(); } catch { /* ok */ } throw new UpdateError('size', 'Réponse trop volumineuse.'); } parts.push(b); }
    return Buffer.concat(parts).toString('utf8');
  }
  const t = await res.text(); if (Buffer.byteLength(t) > max) throw new UpdateError('size', 'Réponse trop volumineuse.'); return t;
}

// ------------------------------------------------------------------ le service ------------------------------------------------------------------
let instance = null;
function init(opts) { if (instance) instance.stop(); instance = create(opts); return instance; }
function get() { if (!instance) throw new Error('Les mises à jour ne sont pas disponibles pour le moment.'); return instance; }

function create(o = {}) {
  const version = String(o.version || '0.0.0'); const cur = parseVersion(version);
  const packaged = o.packaged === true; const arch = o.arch || process.arch; const pid = o.pid || process.pid;
  const exePath = o.exePath || ''; const tmpBase = o.tmpBase || os.tmpdir();
  const emitRaw = typeof o.emit === 'function' ? o.emit : () => {};
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const nowFn = typeof o.now === 'function' ? o.now : Date.now;
  const run = typeof o.run === 'function' ? o.run : execFileP;
  const spawnFn = typeof o.spawn === 'function' ? o.spawn : cp.spawn;
  const quitFn = typeof o.quit === 'function' ? o.quit : () => {};
  const openPath = typeof o.openPath === 'function' ? o.openPath : async () => '';
  const notify = typeof o.notify === 'function' ? o.notify : () => {};
  const UA = `Jarvis-Parlement/${version} (+https://github.com/${REPO})`;
  const timeouts = { ...T, ...(o.timeouts || {}) };
  const logFile = o.logFile || path.join(store.DIR, 'update-last.log');
  const downloadsDir = o.downloadsDir || path.join(os.homedir(), 'Downloads');
  const opener = o.opener || '/usr/bin/open';

  const emit = (c, d) => { try { emitRaw(c, d); } catch { /* fenêtre fermée */ } };
  let timer = null, started = false, stopped = false, checking = null, installing = false, ctl = null, cancelled = false, handedOff = false;
  let progress = null, staged = null, lastEmitted = '', workDir = null;

  // ---- État persistant (fichier « update » du dossier de données) ----
  const load = () => { const s = store.read('update', {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };
  const save = (patch) => { try { store.write('update', { ...load(), ...patch }); } catch { /* disque plein : sans gravité */ } };
  const cfg = () => { const u = (store.settings.get().update) || {}; return { auto: u.auto !== false, hours: clampHours(u.checkHours) }; };

  function latestOf(st) {
    const l = st.latest; if (!l || typeof l !== 'object') return null;
    const v = parseVersion(l.version); if (!v || v.pre) return null;
    // L'état disque n'est pas fiable : tout est revalidé (URL, taille, empreinte) avant usage.
    let asset = null; if (l.asset && typeof l.asset === 'object') { const r = pickAsset({ tag_name: 'v' + v.text, assets: [{ name: l.asset.name, state: 'uploaded', browser_download_url: l.asset.url, size: l.asset.size, digest: l.asset.sha256 ? 'sha256:' + l.asset.sha256 : '' }] }, arch); asset = r.asset; }
    const reason = !asset ? (l.asset ? 'bad-asset' : 'no-asset') : (asset.sha256 ? '' : 'no-digest');
    let htmlUrl = `${RELEASES_URL}tag/v${v.text}`; try { const u = new URL(String(l.htmlUrl)); if (u.protocol === 'https:' && u.hostname === 'github.com' && `https://github.com${u.pathname}`.toLowerCase().startsWith(RELEASES_URL.toLowerCase())) htmlUrl = u.href; } catch { /* ok */ }
    return { version: v.text, notes: cleanNotes(l.notes), htmlUrl, publishedAt: String(l.publishedAt || '').slice(0, 40), asset, reason };
  }
  const isNewer = (l) => !!(l && cur && compareVersions(l.version, cur) > 0);
  const snoozed = (st, l) => !!(st.snooze && l && st.snooze.version === l.version && Number(st.snooze.until) > nowFn());

  function view(l, st) {
    if (!l) return null;
    return { version: l.version, notes: l.notes, htmlUrl: l.htmlUrl, publishedAt: l.publishedAt, size: l.asset ? l.asset.size : 0, canAutoInstall: !!(l.asset && l.asset.sha256), reason: l.reason || '', current: version };
  }

  function status() {
    const st = load(); const l = latestOf(st); const c = cfg(); const now = nowFn();
    const newer = isNewer(l); const ignored = typeof st.ignored === 'string' && parseVersion(st.ignored) ? parseVersion(st.ignored).text : '';
    let state = 'unknown';
    if (installing) state = 'installing';
    else if (st.error && st.error.kind && !newer) state = 'error';
    else if (newer && ignored === l.version) state = 'ignored';
    else if (newer && snoozed(st, l)) state = 'snoozed';
    else if (newer) state = 'available';
    else if (st.lastOk) state = 'uptodate';
    const interval = c.hours * 3600e3; const rl = Number(st.rateLimitUntil) > now ? Number(st.rateLimitUntil) : 0;
    return {
      current: version, packaged, dev: !packaged, arch, auto: c.auto, checkHours: c.hours, state, installing, progress,
      lastCheck: st.lastCheck || null, lastOk: st.lastOk || null, error: st.error || null, rateLimitUntil: rl ? new Date(rl).toISOString() : null,
      nextCheck: c.auto && started && !stopped ? new Date(Math.max(now, rl, (Date.parse(st.lastCheck) || now) + interval)).toISOString() : null,
      latest: newer ? view(l, st) : null, ignored, snoozeUntil: st.snooze && snoozed(st, l) ? new Date(Number(st.snooze.until)).toISOString() : null,
      waiting: staged ? { version: staged.version } : null,
    };
  }

  // ---- Vérification auprès de GitHub ----
  async function fetchRelease(etag) {
    if (!fetchImpl) throw new UpdateError('network', 'Réseau indisponible.');
    const c = new AbortController(); const t = setTimeout(() => c.abort(), timeouts.api);
    try {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' };
      if (etag) headers['If-None-Match'] = etag;
      const res = await fetchImpl(API_URL, { method: 'GET', headers, redirect: 'error', signal: c.signal, credentials: 'omit', cache: 'no-store' });
      if (res.status === 304) return { notModified: true };
      if (res.status === 403 || res.status === 429) {
        const h = (k) => (res.headers && res.headers.get ? res.headers.get(k) : null);
        const limited = res.status === 429 || h('x-ratelimit-remaining') === '0' || h('retry-after') != null;
        if (limited) {
          const reset = Number(h('x-ratelimit-reset')), retry = Number(h('retry-after')); const now = nowFn();
          let until = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Number.isFinite(retry) && retry >= 0 ? now + retry * 1000 : now + 3600e3;
          until = Math.min(now + timeouts.maxRateLimit, Math.max(now + timeouts.minRateLimit, until));
          throw Object.assign(new UpdateError('ratelimit', 'GitHub limite temporairement les vérifications : Jarvis réessaiera plus tard.'), { until });
        }
        throw new UpdateError('http', 'GitHub a refusé la requête (403).');
      }
      if (res.status === 404) return { none: true };
      if (res.status !== 200) throw new UpdateError('http', `GitHub a répondu avec une erreur (${res.status}).`);
      const text = await readBounded(res, LIMITS.maxApiBytes);
      let json; try { json = JSON.parse(text); } catch { throw new UpdateError('parse', 'Réponse de GitHub illisible.'); }
      return { json, etag: res.headers && res.headers.get ? res.headers.get('etag') : null };
    } catch (e) {
      if (e instanceof UpdateError) throw e;
      throw new UpdateError('network', 'Impossible de joindre GitHub (réseau indisponible ?).');
    } finally { clearTimeout(t); }
  }

  async function doCheck(manual) {
    const now = nowFn(); const st = load();
    if (Number(st.rateLimitUntil) > now) { save({ lastCheck: new Date(now).toISOString(), error: { kind: 'ratelimit', message: 'GitHub limite temporairement les vérifications : Jarvis réessaiera plus tard.' } }); return status(); }
    try {
      const r = await fetchRelease(typeof st.etag === 'string' && latestOf(st) ? st.etag : '');
      const stamp = new Date(nowFn()).toISOString();
      if (r.notModified) save({ lastCheck: stamp, lastOk: stamp, error: null, failures: 0, rateLimitUntil: 0 });
      else if (r.none) save({ lastCheck: stamp, lastOk: stamp, error: null, failures: 0, rateLimitUntil: 0, latest: null, etag: '' });
      else {
        const p = parseRelease(r.json, arch);
        if (!p.ok) save({ lastCheck: stamp, lastOk: stamp, error: null, failures: 0, rateLimitUntil: 0 }); // brouillon / pré-version / tag invalide : ignoré, sans erreur
        else save({ lastCheck: stamp, lastOk: stamp, error: null, failures: 0, rateLimitUntil: 0, etag: typeof r.etag === 'string' ? r.etag.slice(0, 200) : '', latest: { version: p.version, notes: p.notes, htmlUrl: p.htmlUrl, publishedAt: p.publishedAt, asset: p.asset } });
      }
    } catch (e) {
      const kind = e.kind || 'network';
      save({ lastCheck: new Date(nowFn()).toISOString(), error: { kind, message: e.message }, failures: (Number(load().failures) || 0) + 1, ...(kind === 'ratelimit' ? { rateLimitUntil: e.until } : {}) });
      return status();
    }
    announce(manual);
    return status();
  }
  function check({ manual = false } = {}) { if (checking) return checking; checking = doCheck(manual).finally(() => { checking = null; }); return checking; }

  // Une version plus récente existe : événement vers l'interface (alerte persistante) + notification macOS une seule fois par version.
  function announce(manual) {
    const st = load(); const l = latestOf(st); if (!isNewer(l)) return;
    if (st.ignored === l.version || snoozed(st, l)) return; // version ignorée ou rappel reporté : aucune alerte (l'état reste visible dans les Réglages)
    if (lastEmitted !== l.version || manual) { lastEmitted = l.version; emit('update-available', { ...view(l, st), manual: !!manual }); }
    if (st.nativeNotified !== l.version) {
      save({ nativeNotified: l.version });
      try { notify({ title: `Jarvis Parlement ${l.version} est disponible`, body: 'Cliquez ici pour installer la nouvelle version.', version: l.version }); } catch { /* ok */ }
    }
  }

  // ---- Planification ----
  function nextDelay() {
    const c = cfg(); const st = load(); const now = nowFn(); const interval = c.hours * 3600e3;
    if (Number(st.rateLimitUntil) > now) return Math.min(interval, Number(st.rateLimitUntil) - now + 1000);
    const f = Number(st.failures) || 0;
    return f > 0 ? Math.min(interval, timeouts.retryBase * 2 ** Math.min(f - 1, 10)) : interval;
  }
  function schedule(ms) {
    if (stopped) return; clearTimeout(timer);
    timer = setTimeout(async () => { try { if (cfg().auto) await check({ manual: false }); } catch { /* jamais d'erreur visible */ } schedule(nextDelay()); }, Math.max(1000, ms));
    if (timer.unref) timer.unref();
  }
  function start() {
    if (started) return; started = true; stopped = false;
    cleanOrphans();
    const t = setTimeout(() => { try { reportLastInstall(); } catch { /* ok */ } }, timeouts.startDelay); if (t.unref) t.unref();
    schedule(timeouts.startDelay);
  }
  function stop() {
    stopped = true; clearTimeout(timer); timer = null;
    if (ctl) { try { ctl.abort(); } catch { /* ok */ } }
    if (!handedOff) { if (workDir) rmQuiet(workDir); if (staged) rmQuiet(staged.dir); }
  }

  // Résultat de la dernière installation (écrit par le script) : si elle a échoué, on le dit une fois.
  function reportLastInstall() {
    let txt; try { txt = fs.readFileSync(logFile, 'utf8'); } catch { return; }
    const m = /RESULT (ok|fail) (\S+) (\S+)/.exec(txt); try { fs.rmSync(logFile, { force: true }); } catch { /* ok */ }
    if (m && m[1] === 'fail') {
      const why = { copy: 'la copie a échoué', backup: 'la sauvegarde de l’ancienne version a échoué', swap: 'le remplacement a échoué', launch: 'la nouvelle version ne s’est pas lancée', incomplete: 'le paquet était incomplet', 'source-missing': 'le paquet était introuvable', 'app-still-running': 'l’application ne s’est pas fermée à temps' }[m[2]] || 'erreur inattendue';
      emit('update-error', { kind: 'install', version: m[3], message: `La dernière mise à jour (${m[3]}) n’a pas pu être installée : ${why}. Votre version actuelle a été conservée.` });
    }
  }
  function cleanOrphans() {
    try {
      for (const n of fs.readdirSync(tmpBase)) {
        if (!/^jarvis-update-[A-Za-z0-9]{4,}$/.test(n)) continue; const p = path.join(tmpBase, n);
        try { const s = fs.lstatSync(p); if (s.isDirectory() && (!process.getuid || s.uid === process.getuid()) && nowFn() - s.mtimeMs > 6 * 3600e3 && !(workDir === p) && !(staged && staged.dir === p)) rmQuiet(p); } catch { /* ok */ }
      }
    } catch { /* ok */ }
  }

  // ---- Choix de l'application à remplacer ----
  function resolveTarget() {
    let p = exePath, bundle = null;
    while (p && p !== path.dirname(p)) { if (/\.app$/i.test(path.basename(p))) { bundle = p; break; } p = path.dirname(p); }
    if (!bundle || !/\/Contents\/MacOS\/[^/]+$/.test(exePath)) return { ok: false, reason: 'no-bundle' };
    let real; try { real = fs.realpathSync(bundle); } catch { return { ok: false, reason: 'no-bundle' }; }
    if (/\/AppTranslocation\//.test(real) || real.startsWith('/Volumes/')) return { ok: false, reason: 'readonly', appPath: real };
    try { fs.accessSync(path.dirname(real), fs.constants.W_OK); } catch { return { ok: false, reason: 'not-writable', appPath: real }; }
    return { ok: true, appPath: real };
  }

  // ---- Téléchargement en flux ----
  function setProgress(p) { progress = { ...p, version: p.version || (progress && progress.version) || '' }; emit('update-progress', progress); }

  async function download(asset, dest, ver) {
    cancelled = false; ctl = new AbortController(); const signal = ctl.signal; let stall = null; let timedOut = false;
    const arm = (ms) => { clearTimeout(stall); stall = setTimeout(() => { timedOut = true; ctl.abort(); }, ms); };
    let fh = null; let url = asset.url;
    try {
      arm(timeouts.header);
      let res = null;
      for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
        url = checkDownloadUrl(url, hop === 0);
        res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal, credentials: 'omit', headers: { 'User-Agent': UA, Accept: 'application/octet-stream' } });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers && res.headers.get ? res.headers.get('location') : null; try { if (res.body && res.body.cancel) await res.body.cancel(); } catch { /* ok */ }
          if (!loc) throw new UpdateError('http', 'Redirection invalide.'); if (hop === LIMITS.maxRedirects) throw new UpdateError('http', 'Trop de redirections.');
          url = new URL(loc, url).href; res = null; continue;
        }
        break;
      }
      if (!res) throw new UpdateError('http', 'Trop de redirections.');
      if (res.status !== 200) throw new UpdateError('http', `Le téléchargement a échoué (HTTP ${res.status}).`);
      const clen = Number(res.headers && res.headers.get ? res.headers.get('content-length') : NaN);
      if (Number.isFinite(clen) && clen > LIMITS.maxDmg) throw new UpdateError('size', 'Fichier trop volumineux : téléchargement refusé.');
      if (Number.isFinite(clen) && clen !== asset.size) throw new UpdateError('size', 'La taille annoncée ne correspond pas : téléchargement refusé.');
      if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') throw new UpdateError('http', 'Réponse de téléchargement vide.');
      fh = await fs.promises.open(dest, 'wx', 0o600);
      const hash = crypto.createHash('sha256'); let got = 0, lastEmit = 0;
      setProgress({ phase: 'download', percent: 0, received: 0, total: asset.size, version: ver });
      for await (const chunk of res.body) {
        arm(timeouts.stall);
        const b = Buffer.from(chunk); got += b.length;
        if (got > asset.size || got > LIMITS.maxDmg) throw new UpdateError('size', 'Le fichier reçu dépasse la taille annoncée : téléchargement interrompu.');
        hash.update(b); await fh.write(b);
        const t = nowFn(); if (t - lastEmit >= 200) { lastEmit = t; setProgress({ phase: 'download', percent: Math.min(99, Math.floor((got / asset.size) * 100)), received: got, total: asset.size, version: ver }); }
      }
      if (got !== asset.size) throw new UpdateError('size', 'Le téléchargement est incomplet.');
      await fh.close(); fh = null;
      return { sha256: hash.digest('hex'), bytes: got };
    } catch (e) {
      if (cancelled) throw new UpdateError('cancelled', 'Téléchargement annulé.');
      if (timedOut || (e && e.name === 'AbortError')) throw new UpdateError('network', 'Le téléchargement s’est interrompu (connexion trop lente ou coupée).');
      if (e instanceof UpdateError) throw e;
      throw new UpdateError('network', 'Le téléchargement a échoué (connexion interrompue ?).');
    } finally { clearTimeout(stall); ctl = null; if (fh) { try { await fh.close(); } catch { /* ok */ } } }
  }

  const sha256File = async (f) => { const h = crypto.createHash('sha256'); for await (const c of fs.createReadStream(f)) h.update(c); return h.digest('hex'); };

  async function detach(mnt) {
    if (!mnt) return;
    try { await run('/usr/bin/hdiutil', ['detach', mnt, '-quiet'], { timeout: 30000 }); }
    catch { try { await run('/usr/bin/hdiutil', ['detach', '-force', mnt, '-quiet'], { timeout: 30000 }); } catch { /* ok */ } }
  }
  // Monte le .dmg en lecture seule et contrôle le contenu : bon identifiant, bonne version, exécutable présent.
  async function mountAndCheck(dmg, dir, expected) {
    const mnt = fs.mkdtempSync(path.join(dir, 'mnt-')); fs.chmodSync(mnt, 0o700); // point de montage neuf à chaque fois (reprise après attente)
    try { await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, dmg], { timeout: timeouts.mountMs }); }
    catch { throw new UpdateError('mount', 'L’image disque téléchargée n’a pas pu être ouverte.'); }
    try {
      const app = path.join(mnt, `${APP_NAME}.app`); const st = fs.lstatSync(app);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new UpdateError('content', 'Le contenu de la mise à jour est inattendu.');
      const plist = path.join(app, 'Contents', 'Info.plist'); let info;
      try { info = JSON.parse((await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { timeout: 15000 })).stdout); } catch { throw new UpdateError('content', 'Le contenu de la mise à jour est illisible.'); }
      if (!info || info.CFBundleIdentifier !== BUNDLE_ID) throw new UpdateError('content', 'La mise à jour n’est pas une version de Jarvis Parlement (identifiant différent).');
      const v = parseVersion(String(info.CFBundleShortVersionString || '')); if (!v || v.text !== expected) throw new UpdateError('content', 'La version contenue dans la mise à jour ne correspond pas à celle annoncée.');
      if (!info.CFBundleExecutable || /[\\/]/.test(String(info.CFBundleExecutable)) || !fs.existsSync(path.join(app, 'Contents', 'MacOS', String(info.CFBundleExecutable)))) throw new UpdateError('content', 'La mise à jour est incomplète.');
      return { mnt, app };
    } catch (e) { await detach(mnt); throw e; }
  }

  function fail(e, ver) {
    const kind = e.kind || 'unknown'; progress = null;
    if (kind === 'cancelled') { emit('update-progress', { phase: 'cancelled', version: ver }); return; }
    emit('update-error', { kind, version: ver, message: e instanceof UpdateError ? e.message : 'La mise à jour a échoué. Réessayez plus tard.' });
  }

  // Dossier visible par l'utilisateur pour le repli (« ouvrir le .dmg »).
  async function fallbackOpen(file, name, ver) {
    let target = path.join(downloadsDir, name), i = 1;
    try { fs.mkdirSync(downloadsDir, { recursive: true }); } catch { /* ok */ }
    while (fs.existsSync(target)) target = path.join(downloadsDir, name.replace(/\.dmg$/, `-${i++}.dmg`));
    try { fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); } catch { target = file; }
    try { await openPath(target); } catch { /* ok */ }
    setProgress({ phase: 'fallback', version: ver, path: target, message: 'Jarvis n’a pas le droit de remplacer l’application à cet emplacement. Le fichier de la mise à jour est vérifié et ouvert : glissez « Jarvis Parlement » dans le dossier Applications, puis relancez.' });
  }

  async function runInstall(l, force, voice) {
    const ver = l.version; installing = true; progress = { phase: 'download', percent: 0, version: ver };
    let dir = null, keep = false;
    try {
      const target = resolveTarget();
      let file;
      if (staged && staged.version === ver && fs.existsSync(staged.file)) { dir = staged.dir; file = staged.file; staged = null; }
      else {
        if (staged) { rmQuiet(staged.dir); staged = null; }
        dir = fs.mkdtempSync(path.join(tmpBase, 'jarvis-update-')); fs.chmodSync(dir, 0o700); workDir = dir;
        file = path.join(dir, l.asset.name);
        const r = await download(l.asset, file, ver);
        setProgress({ phase: 'verify', percent: 100, version: ver });
        if (r.sha256 !== l.asset.sha256) throw new UpdateError('digest', 'La vérification d’intégrité a échoué : le fichier ne correspond pas à l’empreinte publiée. Rien n’a été installé.');
      }
      if ((await sha256File(file)) !== l.asset.sha256) throw new UpdateError('digest', 'La vérification d’intégrité a échoué : le fichier ne correspond pas à l’empreinte publiée. Rien n’a été installé.');
      try { fs.chmodSync(file, 0o400); } catch { /* ok */ }
      if (!target.ok) { await fallbackOpen(file, l.asset.name, ver); return; }
      setProgress({ phase: 'mount', percent: 100, version: ver });
      const mounted = await mountAndCheck(file, dir, ver);
      // Quelque chose a démarré pendant le téléchargement : on s'arrête là (fichier vérifié conservé) et on demande à l'utilisateur.
      const reasons = force ? [] : busyReasons({ voice, extra: o.busy });
      if (reasons.length) { await detach(mounted.mnt); staged = { version: ver, file, dir }; keep = true; setProgress({ phase: 'waiting', percent: 100, version: ver, reasons }); return; }
      const script = path.join(dir, 'install.sh'); fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o700 }); fs.chmodSync(script, 0o700);
      const args = [script, String(pid), mounted.mnt, mounted.app, target.appPath, dir, logFile, ver, opener];
      if (args.some((a) => typeof a !== 'string' || a.includes('\0'))) throw new UpdateError('script', 'Chemin invalide.');
      setProgress({ phase: 'restart', percent: 100, version: ver, message: 'Installation en cours : Jarvis va se fermer puis se rouvrir.' });
      const child = spawnFn('/bin/bash', args, { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), LANG: 'fr_BE.UTF-8' } });
      if (child && child.on) child.on('error', () => {});
      if (!child || !child.pid) throw new UpdateError('script', 'Le programme d’installation n’a pas pu démarrer.');
      if (child.unref) child.unref();
      handedOff = true; keep = true; quitFn();
    } catch (e) { fail(e, ver); }
    finally { installing = false; if (!keep && dir) { rmQuiet(dir); if (workDir === dir) workDir = null; } }
  }

  async function install({ force = false, voice = false } = {}) {
    if (installing) return { started: false, already: true };
    const st = load(); const l = latestOf(st);
    if (!isNewer(l)) throw new Error('Aucune nouvelle version à installer.');
    if (!l.asset || !l.asset.sha256) return { manual: true, url: l.htmlUrl, reason: l.reason || 'no-digest', version: l.version };
    if (!packaged) { // développement : on ne télécharge ni n'installe jamais, on montre seulement le parcours
      for (const [phase, percent] of [['download', 0], ['download', 50], ['verify', 100], ['mount', 100]]) emit('update-progress', { phase, percent, version: l.version, simulated: true });
      emit('update-progress', { phase: 'done', version: l.version, simulated: true, message: 'Mode développement : installation simulée, rien n’a été téléchargé ni modifié.' });
      return { started: false, simulated: true, version: l.version };
    }
    if (!fetchImpl) throw new Error('Réseau indisponible.');
    if (!force) { const reasons = busyReasons({ voice, extra: o.busy }); if (reasons.length) return { busy: true, reasons }; }
    installing = true; // réserve immédiatement (évite un double clic)
    runInstall(l, force === true, voice === true).catch((e) => fail(e, l.version));
    return { started: true, version: l.version };
  }

  function cancel() {
    if (staged) { rmQuiet(staged.dir); staged = null; progress = null; emit('update-progress', { phase: 'cancelled' }); return { cancelled: true }; }
    if (installing && ctl) { cancelled = true; ctl.abort(); return { cancelled: true }; }
    return { cancelled: false };
  }

  function skip(v, undo) {
    const p = parseVersion(v); if (!p) throw new Error('Version invalide.');
    lastEmitted = ''; // l'alerte pourra revenir (annulation de l'ignorance)
    if (undo) { if (load().ignored === p.text) save({ ignored: '' }); return status(); }
    save({ ignored: p.text }); return status();
  }
  function snooze(v, hours = T.snoozeHours) {
    const p = parseVersion(v); if (!p) throw new Error('Version invalide.');
    lastEmitted = ''; // à l'échéance du rappel, l'alerte revient
    save({ snooze: { version: p.text, until: nowFn() + Math.min(168, Math.max(1, hours)) * 3600e3 } }); return status();
  }
  function configure(c = {}) {
    const patch = {}; if (typeof c.auto === 'boolean') patch.auto = c.auto; if (c.checkHours !== undefined) patch.checkHours = clampHours(c.checkHours);
    if (!Object.keys(patch).length) throw new Error('Aucun réglage valide.');
    store.settings.set({ update: patch });
    if (started && !stopped) { const st = load(); const interval = cfg().hours * 3600e3; const due = (Date.parse(st.lastCheck) || 0) + interval - nowFn(); schedule(patch.auto === true && due <= 0 ? 5000 : Math.max(5000, due)); }
    return status();
  }

  // Vérifie seulement si la dernière vérification date de plus de maxAgeMs (retour sur l'app, ouverture de l'accueil) : une version publiée est annoncée sans attendre le prochain passage programmé.
  async function checkIfStale(maxAgeMs = 30 * 60000) {
    if (!started || stopped || !cfg().auto) return null;
    const age = nowFn() - (Date.parse(load().lastCheck) || 0); if (age < Math.max(60000, maxAgeMs)) return null;
    try { return await check({ manual: false }); } catch { return null; }
  }
  return { start, stop, check, checkIfStale, status, install, cancel, skip, snooze, configure, _internals: { resolveTarget, latestOf, nextDelay, doCheck, announce } };
}

module.exports = {
  init, get, create, track, busyReasons, parseVersion, compareVersions, cleanNotes, pickAsset, parseRelease, checkDownloadUrl, readBounded,
  INSTALL_SCRIPT, REPO, API_URL, LIMITS, T, UpdateError, BUNDLE_ID, APP_NAME,
};

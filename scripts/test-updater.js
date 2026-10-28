// Tests de la mise à jour automatique (src/updater.js). Autonome : node scripts/test-updater.js
// Aucun réseau (fetch simulé), aucun vrai .dmg (hdiutil / plutil simulés), rien n'est touché hors du dossier temporaire.
// Le script d'installation généré est, lui, exécuté pour de vrai (bash, ditto, xattr, mv) dans un faux dossier d'applications.
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const crypto = require('crypto'); const cp = require('child_process');
const { Readable } = require('stream');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upd-'));
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'docs'); process.env.JARVIS_INSECURE_SECRETS = '1';
const ok = (m) => console.log('  ✓', m);
const store = require('../src/store'); const U = require('../src/updater');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000, what = 'condition') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(10); } throw new Error('Délai dépassé : ' + what); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const T0 = Date.parse('2026-10-28T10:00:00Z');
const REPO = 'renaud-bxl/jarvis-parlement-Claude';
const dlUrl = (ver, arch = 'arm64') => `https://github.com/${REPO}/releases/download/v${ver}/Jarvis-Parlement-${ver}-${arch}.dmg`;

// ---- Données de test : un faux « .dmg » (octets au hasard, empreinte connue) et la réponse de l'API GitHub ----
const PAYLOAD = crypto.randomBytes(300 * 1024 + 7); const PAYLOAD_SHA = sha(PAYLOAD);
function release(ver, o = {}) {
  const asset = (arch) => ({ name: `Jarvis-Parlement-${ver}-${arch}.dmg`, state: 'uploaded', size: o.size ?? PAYLOAD.length, browser_download_url: o.url || dlUrl(ver, arch), digest: o.digest === undefined ? 'sha256:' + PAYLOAD_SHA : o.digest });
  return { tag_name: o.tag || 'v' + ver, draft: !!o.draft, prerelease: !!o.prerelease, html_url: o.html || `https://github.com/${REPO}/releases/tag/v${ver}`, published_at: '2026-10-29T08:00:00Z',
    body: o.body === undefined ? '## Nouveautés\n* **Mises à jour** automatiques\n* Correctifs [détails](https://exemple.be)' : o.body,
    assets: [asset('arm64'), asset('x64'), { name: `Jarvis-Parlement-${ver}-arm64.zip`, state: 'uploaded', size: 5000, browser_download_url: dlUrl(ver, 'arm64').replace('.dmg', '.zip'), digest: 'sha256:' + '0'.repeat(64) }] };
}
const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const hdrs = (o = {}) => ({ get: (k) => (o[String(k).toLowerCase()] === undefined ? null : String(o[String(k).toLowerCase()])) });
const jsonRes = (status, body, h = {}) => ({ status, headers: hdrs(h), body: Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]) });

// ---- Faux réseau pilotable ----
const calls = []; const FX = {};
const resetFx = () => { calls.length = 0; FX.rel = release('1.6.0'); FX.api = null; FX.dl = null; };
const fakeFetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  if (String(url) === U.API_URL) { if (FX.api) return FX.api(url, opts); const inm = opts.headers && opts.headers['If-None-Match']; if (inm === 'W/"e1"') return { status: 304, headers: hdrs(), body: null }; return jsonRes(200, FX.rel, { etag: 'W/"e1"' }); }
  if (FX.dl) return FX.dl(String(url), opts);
  throw new Error('requête inattendue : ' + url);
};
function body(buf, { signal, hang, chunk = 64 * 1024, tail } = {}) {
  return (async function* () {
    let off = 0; let first = true;
    while (off < buf.length) {
      if (signal && signal.aborted) throw abortErr();
      const end = Math.min(buf.length, off + chunk); yield buf.subarray(off, end); off = end;
      if (first && hang) { first = false; await new Promise((_, rej) => { if (signal) signal.addEventListener('abort', () => rej(abortErr())); }); }
      first = false; await sleep(1);
    }
    if (tail) yield tail;
  })();
}
// Chemin nominal : github.com → 302 → objects.githubusercontent.com → 200
const goodDl = (extra = {}) => (url, opts) => {
  if (url.startsWith('https://github.com/')) return { status: 302, headers: hdrs({ location: 'https://release-assets.githubusercontent.com/github-production-release-asset/abc?sig=1' }), body: null };
  return { status: 200, headers: hdrs({ 'content-length': String(PAYLOAD.length) }), body: body(PAYLOAD, { signal: opts.signal, ...extra }) };
};

// ---- Faux système (hdiutil / plutil / lancement) ----
const SYS = { mount: { id: 'be.jarvis.parlement', version: '1.6.0', exe: true }, ran: [], spawned: [], opened: [], quits: 0 };
const resetSys = () => { SYS.mount = { id: 'be.jarvis.parlement', version: '1.6.0', exe: true }; SYS.ran = []; SYS.spawned = []; SYS.opened = []; SYS.quits = 0; };
const fakeRun = async (cmd, args) => {
  SYS.ran.push([cmd, ...args]);
  if (cmd.endsWith('hdiutil') && args[0] === 'attach') {
    const mnt = args[args.indexOf('-mountpoint') + 1]; const app = path.join(mnt, 'Jarvis Parlement.app', 'Contents');
    fs.mkdirSync(path.join(app, 'MacOS'), { recursive: true }); fs.writeFileSync(path.join(app, 'Info.plist'), 'x'); if (SYS.mount.exe) fs.writeFileSync(path.join(app, 'MacOS', 'Jarvis Parlement'), '#!/bin/sh\n');
    return { stdout: '', stderr: '' };
  }
  if (cmd.endsWith('hdiutil')) return { stdout: '', stderr: '' };
  if (cmd.endsWith('plutil')) return { stdout: JSON.stringify({ CFBundleIdentifier: SYS.mount.id, CFBundleShortVersionString: SYS.mount.version, CFBundleExecutable: 'Jarvis Parlement' }), stderr: '' };
  throw new Error('commande inattendue ' + cmd);
};
const fakeSpawn = (cmd, args, opts) => { SYS.spawned.push({ cmd, args, opts }); return { pid: 31337, unref() {}, on() {} }; };

// ---- Fausse application installée (pour resolveTarget) ----
const appsDir = path.join(tmp, 'apps'); const exe = path.join(appsDir, 'Jarvis Parlement.app', 'Contents', 'MacOS', 'Jarvis Parlement');
fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '#!/bin/sh\n');
const tmpBase = path.join(tmp, 'tmpbase'); fs.mkdirSync(tmpBase); const downloads = path.join(tmp, 'Downloads');
const orphans = () => fs.readdirSync(tmpBase).filter((n) => n.startsWith('jarvis-update-'));

let clock = T0; const now = () => clock;
let autoClock = T0; const ticking = () => (autoClock += 250);
function mk(o = {}) {
  const events = []; const notified = [];
  const inst = U.create({ version: '1.5.2', packaged: true, arch: 'arm64', pid: 4242, exePath: exe, tmpBase, downloadsDir: downloads, emit: (c, d) => events.push([c, d]), fetch: fakeFetch, run: fakeRun, spawn: fakeSpawn,
    quit: () => { SYS.quits++; }, openPath: async (p) => { SYS.opened.push(p); return ''; }, notify: (n) => notified.push(n), logFile: path.join(tmp, 'update-last.log'), now, timeouts: { stall: 400, header: 400, api: 400 }, ...o });
  return { inst, events, notified, ev: (c) => events.filter((e) => e[0] === c).map((e) => e[1]) };
}
const reset = () => { store.write('update', {}); store.settings.set({ update: { auto: true, checkHours: 6 } }); resetFx(); resetSys(); clock = T0; try { fs.rmSync(path.join(tmp, 'update-last.log'), { force: true }); } catch { /* ok */ } };

(async () => {
  // ================================================================ 1. Versions ================================================================
  const lt = (a, b) => assert.strictEqual(U.compareVersions(a, b), -1, `${a} < ${b}`);
  lt('1.5.2', '1.6.0'); lt('v1.5.2', 'v1.5.10'); lt('1.9.9', '2.0.0'); lt('1.2.3-beta.1', '1.2.3'); lt('1.2.3-alpha', '1.2.3-beta'); lt('1.2.3-beta.2', '1.2.3-beta.11'); lt('1.0.0-1', '1.0.0-alpha');
  assert.strictEqual(U.compareVersions('1.5.2', 'v1.5.2'), 0); assert.strictEqual(U.compareVersions('2.0.0', '1.99.99'), 1); assert.strictEqual(U.compareVersions('1.5.2+build7', '1.5.2'), 0);
  for (const bad of ['', 'latest', '1.5', 'v1', '1.5.2.1', '01.5.2', '1.5.-2', 'v1.5.2 ; rm -rf /', '1.5.2-', '1.5.2-01', 'x'.repeat(50), null, undefined, 42, {}, ['1.5.2'], '1.5.2\n', '１.5.2']) assert.strictEqual(U.parseVersion(bad), null, JSON.stringify(bad));
  assert.throws(() => U.compareVersions('x', '1.0.0'), /invalide/);
  ok('semver : 1.5.2 < 1.6.0 (et 1.5.10, pré-versions, build) ; tags invalides refusés');

  // ================================================================ 2. Notes de version ================================================================
  const n1 = U.cleanNotes('## Titre\n* **gras** et `code`\n- [lien](https://x.be/a)\n<script>alert(1)</script>\u0007\u200B\u2028fin\r\n\r\n\r\n\r\nsuite');
  assert(!/[#*`<>\[\]]|\u0007|\u200B|\u2028/.test(n1.replace('alert(1)', '')) && /• gras et code/.test(n1) && /• lien/.test(n1) && !/\n{3}/.test(n1)); assert(!/https:\/\/x\.be/.test(n1));
  const n2 = U.cleanNotes('mot '.repeat(2000)); assert(n2.length <= U.LIMITS.maxNotes + 1 && n2.endsWith('…')); assert.strictEqual(U.cleanNotes(null), ''); assert.strictEqual(U.cleanNotes(42), '');
  ok('notes : texte simple, balises et caractères de contrôle retirés, tronquées');

  // ================================================================ 3. Choix de la release et de l'asset ================================================================
  let r = U.parseRelease(release('1.6.0'), 'arm64'); assert(r.ok && r.version === '1.6.0' && r.asset.name === 'Jarvis-Parlement-1.6.0-arm64.dmg' && r.asset.sha256 === PAYLOAD_SHA && r.asset.size === PAYLOAD.length && r.asset.url === dlUrl('1.6.0') && r.reason === '');
  r = U.parseRelease(release('1.6.0'), 'x64'); assert.strictEqual(r.asset.name, 'Jarvis-Parlement-1.6.0-x64.dmg');
  r = U.parseRelease(release('1.6.0'), 'ia32'); assert.strictEqual(r.asset.name, 'Jarvis-Parlement-1.6.0-x64.dmg'); // « sinon x64 »
  r = U.parseRelease(release('1.6.0', { digest: null }), 'arm64'); assert(r.ok && r.asset && r.asset.sha256 === null && r.reason === 'no-digest');
  for (const bd of ['sha1:abc', 'sha256:xyz', 'sha256:' + 'a'.repeat(63), '', 42]) { r = U.parseRelease(release('1.6.0', { digest: bd }), 'arm64'); assert(r.asset === null || r.asset.sha256 === null, 'digest ' + bd); }
  assert.strictEqual(U.parseRelease(release('1.6.0', { size: 600 * 1024 * 1024 + 1 }), 'arm64').asset, null); assert.strictEqual(U.parseRelease(release('1.6.0', { size: 10 }), 'arm64').asset, null); assert.strictEqual(U.parseRelease(release('1.6.0', { size: '999' }), 'arm64').asset, null);
  assert.strictEqual(U.parseRelease(release('1.6.0', { size: 600 * 1024 * 1024 }), 'arm64').asset.size, 600 * 1024 * 1024);
  for (const url of ['http://github.com/' + REPO + '/releases/download/v1.6.0/Jarvis-Parlement-1.6.0-arm64.dmg', 'https://evil.example/' + REPO + '/releases/download/v1.6.0/Jarvis-Parlement-1.6.0-arm64.dmg', 'https://github.com/autre/depot/releases/download/v1.6.0/Jarvis-Parlement-1.6.0-arm64.dmg', 'https://github.com.evil.example/' + REPO + '/releases/download/v1.6.0/x.dmg', 'https://u:p@github.com/' + REPO + '/releases/download/v1.6.0/x.dmg', 'https://github.com:8443/' + REPO + '/releases/download/v1.6.0/x.dmg', 'file:///tmp/x.dmg', 'javascript:alert(1)'])
    assert.strictEqual(U.parseRelease(release('1.6.0', { url }), 'arm64').asset, null, url);
  assert.strictEqual(U.parseRelease(release('1.6.0'), 'arm64').asset.url.startsWith('https://github.com/'), true);
  const wrongVer = release('1.6.0'); wrongVer.assets[0].name = 'Jarvis-Parlement-9.9.9-arm64.dmg'; assert.strictEqual(U.parseRelease(wrongVer, 'arm64').asset, null); // asset d'une autre version : refusé
  for (const bad of [{ draft: true }, { prerelease: true }, { tag: 'latest' }, { tag: 'v1.7.0-beta.1' }, { tag: 'v1.6' }]) assert.strictEqual(U.parseRelease(release('1.6.0', bad), 'arm64').ok, false, JSON.stringify(bad));
  for (const junk of [null, 'x', 42, [], {}]) assert.strictEqual(U.parseRelease(junk, 'arm64').ok, false);
  r = U.parseRelease(release('1.6.0', { html: 'https://evil.example/phish' }), 'arm64'); assert.strictEqual(r.htmlUrl, `https://github.com/${REPO}/releases/tag/v1.6.0`);
  assert.throws(() => U.checkDownloadUrl('https://github.com/x/y/releases/download/v1/a.dmg', true), /dépôt officiel/); assert.strictEqual(U.checkDownloadUrl('https://objects.githubusercontent.com/a', false), 'https://objects.githubusercontent.com/a');
  for (const h of ['https://evilgithubusercontent.com/a', 'https://githubusercontent.com.evil.example/a', 'https://example.com/a', 'http://objects.githubusercontent.com/a']) assert.throws(() => U.checkDownloadUrl(h, false), /GitHub|HTTPS/, h);
  ok('asset : arm64/x64 choisi, taille ≤ 600 Mo, empreinte sha256 exigée pour l’auto-installation, hôte/HTTPS/dépôt vérifiés, pré-versions et brouillons ignorés');

  // ================================================================ 4. Vérification (API GitHub simulée) ================================================================
  reset(); let m = mk({ now });
  let s = await m.inst.check({ manual: false });
  assert.strictEqual(s.state, 'available'); assert.strictEqual(s.latest.version, '1.6.0'); assert(s.latest.canAutoInstall && s.latest.size === PAYLOAD.length && /Mises à jour automatiques/.test(s.latest.notes));
  const ev1 = m.ev('update-available'); assert.strictEqual(ev1.length, 1); assert.strictEqual(ev1[0].version, '1.6.0'); assert.strictEqual(m.notified.length, 1); assert(/1\.6\.0/.test(m.notified[0].title));
  const c0 = calls[0]; assert.strictEqual(c0.url, `https://api.github.com/repos/${REPO}/releases/latest`); assert.strictEqual(c0.opts.headers.Accept, 'application/vnd.github+json'); assert(/^Jarvis-Parlement\/1\.5\.2/.test(c0.opts.headers['User-Agent']));
  assert(!Object.keys(c0.opts.headers).some((k) => /authorization|cookie|token/i.test(k)) && c0.opts.credentials === 'omit' && c0.opts.redirect === 'error' && c0.opts.signal);
  s = await m.inst.check({ manual: false }); assert.strictEqual(calls[1].opts.headers['If-None-Match'], 'W/"e1"'); assert.strictEqual(s.state, 'available'); assert.strictEqual(m.ev('update-available').length, 1, 'pas de nouvelle alerte pour la même version'); assert.strictEqual(m.notified.length, 1, 'notification macOS une seule fois par version');
  s = await m.inst.check({ manual: true }); assert.strictEqual(m.ev('update-available').length, 2); assert.strictEqual(m.notified.length, 1);
  const m2 = mk({ now }); await m2.inst.check({ manual: false }); assert.strictEqual(m2.notified.length, 0, 'même après redémarrage de l’app : une seule notification macOS par version'); assert.strictEqual(m2.ev('update-available').length, 1);
  ok('vérification : version plus récente annoncée (alerte + notification macOS une seule fois), requête sans identifiants, ETag/304');

  reset(); m = mk({ now }); FX.rel = release('1.5.2'); s = await m.inst.check(); assert.strictEqual(s.state, 'uptodate'); FX.rel = release('1.4.0'); s = await m.inst.check(); assert.strictEqual(s.state, 'uptodate'); assert.strictEqual(m.ev('update-available').length, 0);
  for (const bad of [{ draft: true }, { prerelease: true }, { tag: 'v1.9.0-rc.1' }, { tag: 'nightly' }]) { reset(); m = mk({ now }); FX.rel = release('1.9.0', bad); s = await m.inst.check(); assert.strictEqual(s.latest, null, JSON.stringify(bad)); assert.strictEqual(m.ev('update-available').length, 0); assert.strictEqual(m.notified.length, 0); }
  reset(); m = mk({ now }); FX.api = () => jsonRes(404, { message: 'Not Found' }); s = await m.inst.check(); assert(!s.latest && s.state !== 'installing' && m.ev('update-available').length === 0);
  ok('à jour / version plus ancienne / brouillon / pré-version / tag invalide / aucune release : aucune alerte');

  // ---- Ignorer / rappeler plus tard ----
  reset(); m = mk({ now }); await m.inst.check(); s = m.inst.skip('1.6.0'); assert.strictEqual(s.state, 'ignored'); assert.strictEqual(s.ignored, '1.6.0');
  const before = m.ev('update-available').length; await m.inst.check({ manual: true }); await m.inst.check(); assert.strictEqual(m.ev('update-available').length, before, 'version ignorée : plus d’alerte');
  FX.rel = release('1.7.0'); store.write('update', { ...store.read('update', {}), etag: '' }); await m.inst.check(); assert.strictEqual(m.ev('update-available').pop().version, '1.7.0', 'une version PLUS récente que l’ignorée est signalée');
  s = m.inst.skip('1.6.0', true); assert.strictEqual(s.ignored, ''); assert.throws(() => m.inst.skip('pas-une-version'), /invalide/);
  reset(); m = mk({ now }); await m.inst.check(); s = m.inst.snooze('1.6.0'); assert.strictEqual(s.state, 'snoozed'); const n3 = m.ev('update-available').length;
  clock += 23 * 3600e3; await m.inst.check({ manual: true }); assert.strictEqual(m.ev('update-available').length, n3, 'avant 24 h : silence');
  clock += 2 * 3600e3; s = await m.inst.check(); assert.strictEqual(s.state, 'available'); assert.strictEqual(m.ev('update-available').length, n3 + 1, 'après 24 h : l’alerte revient');
  ok('ignorer une version / rappeler plus tard (24 h) : pas de harcèlement, une version plus récente est quand même signalée');

  // ---- Limite de débit GitHub ----
  reset(); m = mk({ now }); FX.api = () => ({ status: 403, headers: hdrs({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(clock / 1000) + 1800) }), body: null });
  s = await m.inst.check(); assert.strictEqual(s.state, 'error'); assert.strictEqual(s.error.kind, 'ratelimit'); assert.strictEqual(Date.parse(s.rateLimitUntil), clock + 1800e3); assert.strictEqual(m.ev('update-available').length, 0);
  const n4 = calls.length; await m.inst.check(); await m.inst.check({ manual: true }); assert.strictEqual(calls.length, n4, 'limite atteinte : aucune requête tant que GitHub n’a pas rouvert');
  assert(m.inst._internals.nextDelay() >= 1800e3 && m.inst._internals.nextDelay() <= 6 * 3600e3);
  clock += 1801e3; FX.api = null; s = await m.inst.check(); assert(calls.length > n4); assert.strictEqual(s.state, 'available'); assert.strictEqual(s.error, null); assert.strictEqual(s.rateLimitUntil, null);
  reset(); m = mk({ now }); FX.api = () => ({ status: 429, headers: hdrs({ 'retry-after': '120' }), body: null }); s = await m.inst.check(); assert.strictEqual(s.error.kind, 'ratelimit'); assert.strictEqual(Date.parse(s.rateLimitUntil), clock + 120e3);
  reset(); m = mk({ now }); FX.api = () => ({ status: 403, headers: hdrs({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }), body: null }); s = await m.inst.check(); assert.strictEqual(Date.parse(s.rateLimitUntil), clock + 60e3, 'reset dans le passé : au moins 1 minute');
  FX.api = () => ({ status: 403, headers: hdrs({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(clock / 1000) + 99 * 86400) }), body: null }); clock += 61e3; s = await m.inst.check(); assert.strictEqual(Date.parse(s.rateLimitUntil), clock + 24 * 3600e3, 'plafonné à 24 h');
  reset(); m = mk({ now }); FX.api = () => ({ status: 403, headers: hdrs({ 'x-ratelimit-remaining': '37' }), body: null }); s = await m.inst.check(); assert.strictEqual(s.error.kind, 'http'); assert.strictEqual(s.rateLimitUntil, null);
  ok('limite de débit : 403/429 + x-ratelimit-reset / retry-after respectés (bornés 1 min – 24 h), aucune requête superflue, reprise ensuite');

  // ---- Hors-ligne, erreurs, réponses hostiles : silence + réessai espacé ----
  reset(); m = mk({ now }); FX.api = () => { throw new TypeError('fetch failed'); };
  s = await m.inst.check(); assert.strictEqual(s.state, 'error'); assert.strictEqual(s.error.kind, 'network'); assert.strictEqual(m.events.length, 0, 'hors-ligne : aucun événement, aucune erreur visible'); assert.strictEqual(m.inst._internals.nextDelay(), 5 * 60e3);
  await m.inst.check(); assert.strictEqual(m.inst._internals.nextDelay(), 10 * 60e3); for (let i = 0; i < 12; i++) await m.inst.check(); assert.strictEqual(m.inst._internals.nextDelay(), 6 * 3600e3, 'espacement exponentiel plafonné à la fréquence choisie');
  FX.api = null; s = await m.inst.check(); assert.strictEqual(s.state, 'available'); assert.strictEqual(m.inst._internals.nextDelay(), 6 * 3600e3);
  store.settings.set({ update: { checkHours: 1 } }); assert.strictEqual(m.inst._internals.nextDelay(), 3600e3);
  reset(); m = mk({ now }); FX.api = () => jsonRes(200, 'x'.repeat(U.LIMITS.maxApiBytes + 10)); s = await m.inst.check(); assert.strictEqual(s.error.kind, 'size');
  FX.api = () => ({ status: 200, headers: hdrs({ 'content-length': String(U.LIMITS.maxApiBytes * 5) }), body: Readable.from([Buffer.from('{}')]) }); s = await m.inst.check(); assert.strictEqual(s.error.kind, 'size');
  FX.api = () => jsonRes(200, '<html>pas du json</html>'); s = await m.inst.check(); assert.strictEqual(s.error.kind, 'parse');
  FX.api = () => jsonRes(500, ''); s = await m.inst.check(); assert.strictEqual(s.error.kind, 'http');
  FX.api = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(abortErr()))); const t0 = Date.now(); s = await m.inst.check(); assert(Date.now() - t0 < 2000); assert.strictEqual(s.error.kind, 'network'); // délai d'attente
  assert.strictEqual(m.ev('update-available').length + m.ev('update-error').length, 0);
  ok('hors-ligne / réponse géante / JSON illisible / HTTP 500 / délai dépassé : silencieux, réessais espacés (5, 10, 20 min… ≤ fréquence)');

  // ---- Planification ----
  reset(); m = mk({ now: Date.now, timeouts: { startDelay: 40, stall: 400, header: 400, api: 400 } }); m.inst.start(); assert.strictEqual(calls.length, 0, 'rien avant le délai de démarrage'); await waitFor(() => calls.length === 1, 3000, 'première vérification'); await waitFor(() => m.ev('update-available').length === 1, 3000, 'alerte'); m.inst.stop();
  reset(); store.settings.set({ update: { auto: false } }); m = mk({ now: Date.now, timeouts: { startDelay: 30 } }); m.inst.start(); await sleep(250); assert.strictEqual(calls.length, 0, 'vérification automatique désactivée : aucune requête'); const sx = await m.inst.check({ manual: true }); assert.strictEqual(sx.state, 'available', 'la vérification manuelle reste possible'); m.inst.stop();
  reset(); m = mk({ now }); s = m.inst.configure({ checkHours: 12, auto: false }); assert(!s.auto && s.checkHours === 12); assert.deepStrictEqual(store.settings.get().update, { auto: false, checkHours: 12 }); s = m.inst.configure({ checkHours: 999 }); assert.strictEqual(s.checkHours, 72); s = m.inst.configure({ checkHours: 0 }); assert.strictEqual(s.checkHours, 1); assert.throws(() => m.inst.configure({}), /Aucun/);
  ok('planification : première vérification après le délai, interrupteur et fréquence (1–72 h) respectés');

  // ================================================================ 5. Téléchargement + installation (simulés) ================================================================
  const runInstall = async (mm, args = {}) => { const r0 = await mm.inst.install(args); if (r0.started) await waitFor(() => SYS.quits > 0 || mm.ev('update-error').length > 0 || mm.ev('update-progress').some((p) => ['waiting', 'fallback', 'cancelled'].includes(p.phase)), 5000, 'fin de l’installation'); return r0; };
  const phases = (mm) => mm.ev('update-progress').map((p) => p.phase);

  // 5a. Chemin nominal
  reset(); FX.dl = goodDl(); m = mk({ now: ticking }); await m.inst.check();
  let r1 = await runInstall(m); assert.strictEqual(r1.started, true);
  assert.strictEqual(SYS.quits, 1, 'l’app se ferme (app.quit)'); assert.strictEqual(m.ev('update-error').length, 0);
  const dlCalls = calls.filter((c) => !c.url.startsWith('https://api.github.com')); assert.strictEqual(dlCalls.length, 2); assert(dlCalls.every((c) => c.opts.redirect === 'manual' && !JSON.stringify(c.opts.headers).match(/authoriz|cookie/i) && c.opts.credentials === 'omit')); assert.strictEqual(dlCalls[0].url, dlUrl('1.6.0'));
  const pr = m.ev('update-progress').filter((p) => p.phase === 'download'); assert(pr.length >= 3 && pr[0].percent === 0 && pr.every((p, i) => i === 0 || p.percent >= pr[i - 1].percent) && pr.at(-1).received <= PAYLOAD.length && pr.at(-1).total === PAYLOAD.length);
  const ph = phases(m); assert(ph.indexOf('download') < ph.indexOf('verify') && ph.indexOf('verify') < ph.indexOf('mount') && ph.indexOf('mount') < ph.indexOf('restart'));
  assert.strictEqual(SYS.spawned.length, 1); const sp = SYS.spawned[0]; assert.strictEqual(sp.cmd, '/bin/bash'); assert.strictEqual(sp.opts.detached, true); assert.strictEqual(sp.opts.stdio, 'ignore'); assert(!('shell' in sp.opts) || sp.opts.shell === false);
  const [scr, ...rest] = sp.args; assert.strictEqual(path.basename(scr), 'install.sh'); assert.strictEqual(fs.statSync(scr).mode & 0o777, 0o700); assert.strictEqual(fs.statSync(path.dirname(scr)).mode & 0o777, 0o700); assert.strictEqual(fs.readFileSync(scr, 'utf8'), U.INSTALL_SCRIPT);
  assert.strictEqual(rest[0], '4242'); assert(/\/mnt-[A-Za-z0-9]+$/.test(rest[1])); assert(rest[2].endsWith('Jarvis Parlement.app') && rest[3] === fs.realpathSync(path.join(appsDir, 'Jarvis Parlement.app'))); assert.strictEqual(rest[4], path.dirname(scr)); assert.strictEqual(rest[6], '1.6.0'); assert.strictEqual(rest[7], '/usr/bin/open'); assert.strictEqual(rest.length, 8);
  const dmgPath = path.join(path.dirname(scr), 'Jarvis-Parlement-1.6.0-arm64.dmg'); assert.strictEqual(sha(fs.readFileSync(dmgPath)), PAYLOAD_SHA); assert.strictEqual(fs.statSync(dmgPath).mode & 0o777, 0o400);
  assert(SYS.ran.some((c) => c.includes('attach') && c.includes('-readonly') && c.includes('-nobrowse') && c.includes('-mountpoint')));
  m.inst.stop(); assert(fs.existsSync(scr), 'après la remise au script, le dossier n’est pas supprimé par l’app (le script nettoie lui-même)');
  fs.rmSync(path.dirname(scr), { recursive: true, force: true });
  ok('installation : redirection github.com → githubusercontent, flux + progression, sha256 OK, volume contrôlé, script 0700 lancé détaché, app.quit()');

  // 5b. Empreinte incorrecte
  reset(); FX.rel = release('1.6.0', { digest: 'sha256:' + 'ab'.repeat(32) }); FX.dl = goodDl(); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m);
  assert.strictEqual(SYS.spawned.length, 0); assert.strictEqual(SYS.quits, 0); assert.strictEqual(SYS.ran.length, 0, 'jamais monté si l’empreinte ne correspond pas'); assert.strictEqual(m.ev('update-error')[0].kind, 'digest'); assert(/intégrité/.test(m.ev('update-error')[0].message)); assert.strictEqual(orphans().length, 0, 'fichier supprimé');
  // un seul octet différent
  reset(); const flipped = Buffer.from(PAYLOAD); flipped[1000] ^= 1; FX.dl = (u, o) => (u.startsWith('https://github.com/') ? goodDl()(u, o) : { status: 200, headers: hdrs({ 'content-length': String(flipped.length) }), body: body(flipped, { signal: o.signal }) }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m); assert.strictEqual(m.ev('update-error')[0].kind, 'digest'); assert.strictEqual(SYS.spawned.length, 0);
  ok('sha256 incorrect (même d’un seul bit) : rien n’est monté ni exécuté, fichier supprimé');

  // 5c. Hôtes, HTTP non sûr, redirections
  const redirTo = (loc) => (u, o) => (u.startsWith('https://github.com/') ? { status: 302, headers: hdrs({ location: loc }), body: null } : goodDl()(u, o));
  for (const [loc, kind] of [['https://evil.example/payload.dmg', 'host'], ['http://objects.githubusercontent.com/a.dmg', 'insecure'], ['https://github.com.evil.example/a.dmg', 'host'], ['https://evilgithubusercontent.com/a.dmg', 'host'], ['https://user:pw@objects.githubusercontent.com/a', 'host'], ['file:///etc/passwd', 'insecure']]) {
    reset(); FX.dl = redirTo(loc); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m);
    assert.strictEqual(m.ev('update-error')[0].kind, kind, loc); assert.strictEqual(calls.filter((c) => !c.url.startsWith('https://api.github.com')).length, 1, 'aucune requête vers l’hôte refusé'); assert.strictEqual(SYS.spawned.length, 0); assert.strictEqual(orphans().length, 0);
  }
  reset(); FX.dl = (u) => ({ status: 302, headers: hdrs({ location: 'https://github.com/' + REPO + '/releases/download/v1.6.0/boucle' }), body: null }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m); assert.strictEqual(m.ev('update-error')[0].kind, 'http'); assert(calls.length <= 9, 'redirections bornées');
  reset(); FX.dl = () => ({ status: 404, headers: hdrs(), body: null }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m); assert.strictEqual(m.ev('update-error')[0].kind, 'http');
  // l'asset persisté sur disque est lui aussi revalidé (état altéré à la main)
  reset(); m = mk({ now: ticking }); await m.inst.check(); const stf = store.read('update', {}); stf.latest.asset.url = 'https://evil.example/x.dmg'; store.write('update', stf); const ri = await m.inst.install(); assert(ri.manual && !ri.started, 'URL altérée dans le fichier d’état : installation automatique refusée'); assert.strictEqual(calls.filter((c) => c.url.includes('evil')).length, 0);
  ok('refus : hôte non GitHub, redirection hors GitHub, HTTP non chiffré, identifiants dans l’URL, boucle de redirections, état disque altéré');

  // 5d. Taille
  reset(); FX.dl = (u, o) => (u.startsWith('https://github.com/') ? goodDl()(u, o) : { status: 200, headers: hdrs({}), body: body(PAYLOAD, { signal: o.signal, tail: Buffer.alloc(5000) }) }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m);
  assert.strictEqual(m.ev('update-error')[0].kind, 'size'); assert.strictEqual(SYS.spawned.length, 0); assert.strictEqual(orphans().length, 0);
  reset(); FX.dl = (u, o) => (u.startsWith('https://github.com/') ? goodDl()(u, o) : { status: 200, headers: hdrs({ 'content-length': String(PAYLOAD.length + 1) }), body: body(PAYLOAD, { signal: o.signal }) }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m); assert.strictEqual(m.ev('update-error')[0].kind, 'size');
  reset(); FX.dl = (u, o) => (u.startsWith('https://github.com/') ? goodDl()(u, o) : { status: 200, headers: hdrs({ 'content-length': String(700 * 1024 * 1024) }), body: body(PAYLOAD, { signal: o.signal }) }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m); assert.strictEqual(m.ev('update-error')[0].kind, 'size');
  reset(); FX.dl = (u, o) => (u.startsWith('https://github.com/') ? goodDl()(u, o) : { status: 200, headers: hdrs({}), body: body(PAYLOAD.subarray(0, 100000), { signal: o.signal }) }); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m); assert.strictEqual(m.ev('update-error')[0].kind, 'size', 'fichier incomplet');
  reset(); FX.rel = release('1.6.0', { size: 601 * 1024 * 1024 }); m = mk({ now: ticking }); await m.inst.check(); assert.strictEqual((await m.inst.install()).manual, true, 'annonce > 600 Mo : jamais téléchargée');
  ok('taille : dépassement de la taille annoncée, Content-Length incohérent ou > 600 Mo, fichier incomplet, annonce > 600 Mo refusés');

  // 5e. Annulation, coupure, arrêt
  reset(); FX.dl = goodDl({ hang: true }); m = mk({ now: ticking }); await m.inst.check(); await m.inst.install(); await waitFor(() => m.ev('update-progress').some((p) => p.phase === 'download' && p.received > 0), 3000, 'début du flux');
  assert.strictEqual(m.inst.cancel().cancelled, true); await waitFor(() => m.ev('update-progress').some((p) => p.phase === 'cancelled'), 3000, 'annulation'); assert.strictEqual(m.ev('update-error').length, 0); assert.strictEqual(SYS.spawned.length, 0); await waitFor(() => orphans().length === 0, 2000, 'nettoyage'); assert.strictEqual(m.inst.status().installing, false);
  assert.strictEqual(m.inst.cancel().cancelled, false);
  reset(); FX.dl = goodDl({ hang: true }); m = mk({ now: ticking, timeouts: { stall: 150, header: 400, api: 400 } }); await m.inst.check(); await m.inst.install(); await waitFor(() => m.ev('update-error').length > 0, 3000, 'coupure'); assert.strictEqual(m.ev('update-error')[0].kind, 'network'); await waitFor(() => orphans().length === 0, 2000, 'nettoyage');
  reset(); FX.dl = goodDl({ hang: true }); m = mk({ now: ticking }); await m.inst.check(); await m.inst.install(); await waitFor(() => m.ev('update-progress').some((p) => p.received > 0), 3000, 'flux'); m.inst.stop(); await waitFor(() => orphans().length === 0, 2000, 'nettoyage à l’arrêt'); assert.strictEqual(SYS.spawned.length, 0);
  reset(); FX.dl = goodDl(); m = mk({ now: ticking }); await m.inst.check(); const dbl = await Promise.all([m.inst.install(), m.inst.install()]); assert.strictEqual(dbl.filter((x) => x.started).length, 1, 'double clic : un seul téléchargement'); await waitFor(() => SYS.quits > 0, 5000, 'fin'); assert.strictEqual(SYS.spawned.length, 1); fs.rmSync(path.dirname(SYS.spawned[0].args[0]), { recursive: true, force: true });
  ok('annulation, coupure de connexion, arrêt de l’app, double clic : proprement gérés, dossier temporaire nettoyé');

  // 5f. Contrôle du volume monté
  for (const [bad, what] of [[{ id: 'com.autre.app' }, 'identifiant'], [{ version: '9.9.9' }, 'version'], [{ exe: false }, 'exécutable absent']]) {
    reset(); Object.assign(SYS.mount, bad); FX.dl = goodDl(); m = mk({ now: ticking }); await m.inst.check(); await runInstall(m);
    assert.strictEqual(m.ev('update-error')[0].kind, 'content', what); assert.strictEqual(SYS.spawned.length, 0); assert.strictEqual(SYS.quits, 0); assert(SYS.ran.some((c) => c.includes('detach')), 'volume démonté'); assert.strictEqual(orphans().length, 0);
  }
  ok('volume : mauvais CFBundleIdentifier / mauvaise version / exécutable absent → refusé, démonté, rien d’exécuté');

  // 5g. Occupé : jamais d'installation en douce
  reset(); FX.dl = goodDl(); m = mk({ now: ticking }); await m.inst.check();
  for (const [method, txt] of [['mail.send', /courriel/], ['chat.send', /demande à l’IA/], ['jarvis.command', /IA/], ['voice.transcribe', /conversation vocale/]]) {
    const done = U.track(method); const b = await m.inst.install(); assert.strictEqual(b.busy, true, method); assert(b.reasons.some((x) => txt.test(x)), method); assert.strictEqual(calls.filter((c) => c.url.includes('/download/')).length, 0, 'aucun téléchargement tant qu’on est occupé'); done(); done();
  }
  let bv = await m.inst.install({ voice: true }); assert(bv.busy && /conversation vocale/.test(bv.reasons[0]));
  assert.deepStrictEqual(U.busyReasons(), []); const d1 = U.track('mail.send'), d2 = U.track('mail.send'); d1(); assert.strictEqual(U.busyReasons().length, 1); d2(); assert.strictEqual(U.busyReasons().length, 0); U.track('methode.inconnue')();
  const done2 = U.track('mail.send'); const forced = await m.inst.install({ force: true }); assert.strictEqual(forced.started, true, 'confirmation explicite (force) : on continue'); await waitFor(() => SYS.quits > 0, 5000, 'fin'); done2(); fs.rmSync(path.dirname(SYS.spawned[0].args[0]), { recursive: true, force: true });
  // occupé APRÈS le début : on s'arrête avant de quitter, le fichier vérifié est conservé et réutilisé sans re-téléchargement
  reset(); let rel2; FX.dl = (u, o) => { const r2 = goodDl()(u, o); if (!u.startsWith('https://github.com/')) rel2 = U.track('chat.send'); return r2; }; m = mk({ now: ticking }); await m.inst.check(); await runInstall(m);
  assert(phases(m).includes('waiting') && SYS.quits === 0 && SYS.spawned.length === 0); assert.deepStrictEqual(m.ev('update-progress').find((p) => p.phase === 'waiting').reasons, ['une demande à l’IA est en cours']); assert.strictEqual(m.inst.status().waiting.version, '1.6.0'); const nDl = calls.filter((c) => c.url.includes('/download/')).length;
  const again = await m.inst.install({ force: true }); assert.strictEqual(again.started, true); await waitFor(() => SYS.quits > 0, 5000, 'reprise'); assert.strictEqual(calls.filter((c) => c.url.includes('/download/')).length, nDl, 'fichier déjà vérifié : pas de nouveau téléchargement'); rel2(); fs.rmSync(path.dirname(SYS.spawned[0].args[0]), { recursive: true, force: true });
  ok('occupé (envoi de courriel, demande IA, conversation vocale) : on propose, on ne force pas ; confirmation explicite = reprise');

  // 5h. Développement : jamais d'installation
  reset(); FX.dl = goodDl(); m = mk({ packaged: false, now: ticking }); await m.inst.check(); const dv = await m.inst.install(); assert(dv.simulated && !dv.started); assert.strictEqual(calls.filter((c) => !c.url.startsWith('https://api.github.com')).length, 0, 'aucun téléchargement'); assert(SYS.spawned.length === 0 && SYS.quits === 0 && SYS.ran.length === 0 && orphans().length === 0);
  assert(m.ev('update-progress').every((p) => p.simulated) && m.ev('update-progress').at(-1).phase === 'done'); assert.strictEqual(m.inst.status().dev, true);
  reset(); m = mk({ now: ticking }); await assert.rejects(() => m.inst.install(), /Aucune nouvelle version/);
  ok('mode développement : installation simulée seulement (aucun téléchargement, montage ni script) ; sans nouvelle version : refus');

  // 5i. Sans empreinte : pas d'installation automatique
  reset(); FX.rel = release('1.6.0', { digest: null }); FX.dl = goodDl(); m = mk({ now: ticking }); s = await m.inst.check(); assert.strictEqual(s.latest.canAutoInstall, false); const mn = await m.inst.install(); assert(mn.manual && mn.url === `https://github.com/${REPO}/releases/tag/v1.6.0`); assert.strictEqual(calls.filter((c) => c.url.includes('/download/')).length, 0);
  ok('release sans empreinte sha256 : pas d’installation automatique, on propose d’ouvrir la page de la version');

  // 5j. Dossier non modifiable → repli : ouvrir le .dmg vérifié
  const noWrite = path.join(tmp, 'ro'); fs.mkdirSync(path.join(noWrite, 'Jarvis Parlement.app', 'Contents', 'MacOS'), { recursive: true }); const roExe = path.join(noWrite, 'Jarvis Parlement.app', 'Contents', 'MacOS', 'Jarvis Parlement'); fs.writeFileSync(roExe, 'x');
  const transl = path.join(tmp, 'private', 'AppTranslocation', 'ABC', 'd'); fs.mkdirSync(path.join(transl, 'Jarvis Parlement.app', 'Contents', 'MacOS'), { recursive: true }); const trExe = path.join(transl, 'Jarvis Parlement.app', 'Contents', 'MacOS', 'Jarvis Parlement'); fs.writeFileSync(trExe, 'x');
  assert.strictEqual(mk({ exePath: trExe }).inst._internals.resolveTarget().reason, 'readonly'); assert.strictEqual(mk({ exePath: path.join(tmp, 'pas-une-app', 'bin', 'jarvis') }).inst._internals.resolveTarget().reason, 'no-bundle'); assert.strictEqual(mk({ exePath: '' }).inst._internals.resolveTarget().ok, false);
  assert.strictEqual(mk({ exePath: exe }).inst._internals.resolveTarget().ok, true);
  const canTestRo = !(process.getuid && process.getuid() === 0);
  if (canTestRo) {
    fs.chmodSync(noWrite, 0o500);
    try {
      reset(); FX.dl = goodDl(); m = mk({ now: ticking, exePath: roExe }); assert.strictEqual(m.inst._internals.resolveTarget().reason, 'not-writable'); await m.inst.check(); await runInstall(m);
      const fb = m.ev('update-progress').find((p) => p.phase === 'fallback'); assert(fb && /droit de remplacer/.test(fb.message)); assert.strictEqual(SYS.spawned.length, 0); assert.strictEqual(SYS.quits, 0); assert.strictEqual(SYS.opened.length, 1); assert.strictEqual(SYS.opened[0], path.join(downloads, 'Jarvis-Parlement-1.6.0-arm64.dmg')); assert.strictEqual(sha(fs.readFileSync(SYS.opened[0])), PAYLOAD_SHA);
    } finally { fs.chmodSync(noWrite, 0o700); }
  }
  ok('application dans un dossier non modifiable (ou lancée depuis un volume) : message clair et repli — le .dmg vérifié est ouvert');

  // 5k. Résultat de la dernière installation (écrit par le script) rapporté au démarrage suivant
  reset(); fs.writeFileSync(path.join(tmp, 'update-last.log'), '2026-10-28T10:00:00 RESULT fail launch 1.6.0\n'); m = mk({ now, timeouts: { startDelay: 20 } }); m.inst.start(); await waitFor(() => m.ev('update-error').length === 1, 2000, 'rapport'); assert(/1\.6\.0/.test(m.ev('update-error')[0].message) && /conservée/.test(m.ev('update-error')[0].message) && m.ev('update-error')[0].kind === 'install'); assert(!fs.existsSync(path.join(tmp, 'update-last.log'))); m.inst.stop();
  reset(); fs.writeFileSync(path.join(tmp, 'update-last.log'), '2026-10-28T10:00:00 RESULT ok installed 1.6.0\n'); m = mk({ now, timeouts: { startDelay: 20 } }); m.inst.start(); await sleep(150); assert.strictEqual(m.ev('update-error').length, 0); m.inst.stop();
  // dossiers orphelins anciens nettoyés, ceux des autres jamais
  const old = path.join(tmpBase, 'jarvis-update-ABCDEF'); fs.mkdirSync(old); fs.utimesSync(old, new Date(T0 - 86400e3 * 2), new Date(T0 - 86400e3 * 2)); const other = path.join(tmpBase, 'autre-dossier'); fs.mkdirSync(other); fs.utimesSync(other, new Date(T0 - 86400e3 * 2), new Date(T0 - 86400e3 * 2));
  m = mk({ now: () => Date.now() + 7 * 3600e3, timeouts: { startDelay: 20 } }); m.inst.start(); m.inst.stop(); assert(!fs.existsSync(old) && fs.existsSync(other)); fs.rmSync(other, { recursive: true });
  ok('échec d’une installation précédente signalé une fois ; dossiers temporaires orphelins nettoyés (et seulement les nôtres)');

  // ================================================================ 6. Le script d'installation, exécuté pour de vrai ================================================================
  assert(!/\beval\b|^\s*source\s|\bcurl\b|\bsudo\b/m.test(U.INSTALL_SCRIPT), 'pas d’eval / source / curl / sudo'); assert(!/\$\{|`/.test(U.INSTALL_SCRIPT), 'aucune substitution dynamique'); assert(/^#!\/bin\/bash/.test(U.INSTALL_SCRIPT)); assert(!/\$\(.*\$[1-8]/.test(U.INSTALL_SCRIPT.replace(/dirname "\$DEST"|basename "\$DEST"|basename "\$WORK"/g, '')), 'les arguments ne passent jamais dans un sous-shell');
  if (process.platform !== 'darwin') { ok('script d’installation : exécution réelle ignorée (macOS uniquement)'); } else {
    const lint = cp.spawnSync('/bin/bash', ['-n', '-c', U.INSTALL_SCRIPT]); assert.strictEqual(lint.status, 0, 'bash -n : ' + lint.stderr);
    const WEIRD = 'Dossier d\'essai ; $(touch PWNED1) `touch PWNED2` "q" $HOME & *';
    let seq = 0;
    function lab(opts = {}) {
      const root = fs.mkdtempSync(path.join(tmp, 'lab-')); const dir = path.join(root, opts.weird === false ? 'Applications' : WEIRD); fs.mkdirSync(dir);
      const mkApp = (p, mark) => { fs.mkdirSync(path.join(p, 'Contents', 'MacOS'), { recursive: true }); fs.writeFileSync(path.join(p, 'Contents', 'Info.plist'), '<plist/>'); fs.writeFileSync(path.join(p, 'Contents', 'MacOS', 'x'), '#!/bin/sh\n'); fs.writeFileSync(path.join(p, 'Contents', 'marker'), mark); fs.symlinkSync('Contents/marker', path.join(p, 'lien-relatif')); };
      const dest = path.join(dir, 'Jarvis Parlement.app'); if (!opts.noOld) mkApp(dest, 'ancienne');
      const src = path.join(root, 'volume monté', 'Jarvis Parlement.app'); fs.mkdirSync(path.dirname(src)); if (!opts.noSrc) mkApp(src, 'nouvelle');
      if (!opts.noSrc) cp.spawnSync('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Test;', src]);
      const work = path.join(root, 'jarvis-update-Z' + (++seq) + 'abc'); fs.mkdirSync(work, { mode: 0o700 }); const script = path.join(work, 'install.sh'); fs.writeFileSync(script, opts.script || U.INSTALL_SCRIPT, { mode: 0o700 });
      fs.writeFileSync(path.join(work, 'fichier.dmg'), 'x'); const log = path.join(root, 'update-last.log'); const olog = path.join(root, 'opener.log'); const opener = path.join(root, 'opener.sh');
      fs.writeFileSync(opener, `#!/bin/bash\nprintf '%s\\n' "$1" >> '${olog}'\nn=$(wc -l < '${olog}')\n[ "$n" -le ${opts.failOpener || 0} ] && exit 1\nexit 0\n`, { mode: 0o755 });
      return { root, dir, dest, src, work, script, log, olog, opener, mark: (p) => fs.readFileSync(path.join(p, 'Contents', 'marker'), 'utf8') };
    }
    const exec = (L, o = {}) => cp.spawnSync('/bin/bash', [L.script, String(o.pid ?? 999999), o.mnt ?? '', o.src ?? L.src, L.dest, o.work ?? L.work, L.log, '1.6.0', L.opener], { encoding: 'utf8', timeout: 60000 });
    const execAsync = (L, o = {}) => new Promise((resolve) => { const c = cp.spawn('/bin/bash', [L.script, String(o.pid), '', L.src, L.dest, L.work, L.log, '1.6.0', L.opener], { stdio: 'pipe' }); let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (status) => resolve({ status, stderr: err })); }); // asynchrone : le processus attendu doit pouvoir être récolté
    const leftovers = (L) => fs.readdirSync(L.dir).filter((n) => n !== 'Jarvis Parlement.app');
    const opens = (L) => (fs.existsSync(L.olog) ? fs.readFileSync(L.olog, 'utf8').trim().split('\n').filter(Boolean) : []);
    const noPwn = (L) => { const all = cp.spawnSync('find', [L.root, '-name', 'PWNED*'], { encoding: 'utf8' }).stdout.trim(); assert.strictEqual(all, '', 'aucune injection de shell'); assert(!fs.existsSync(path.join(process.env.HOME || '/', 'PWNED1'))); };

    // 6a. Succès : chemin avec espaces, apostrophe, $(), backticks, guillemets ; attend la fermeture de l'app
    let L = lab(); const slow = cp.spawn('/bin/sleep', ['1.3']); const t1 = Date.now(); const res = await execAsync(L, { pid: slow.pid }); const el = Date.now() - t1;
    assert.strictEqual(res.status, 0, res.stderr); assert(el >= 1000, `le script a attendu la fin du processus (${el} ms)`); assert.strictEqual(L.mark(L.dest), 'nouvelle'); assert.deepStrictEqual(leftovers(L), [], 'pas de .new/.old restants'); assert(!fs.existsSync(L.work), 'dossier temporaire supprimé');
    assert.deepStrictEqual(opens(L), [L.dest], 'relance exactement l’app remplacée'); assert(/RESULT ok installed 1\.6\.0/.test(fs.readFileSync(L.log, 'utf8'))); assert.notStrictEqual(cp.spawnSync('xattr', ['-p', 'com.apple.quarantine', L.dest]).status, 0, 'quarantaine retirée'); assert.strictEqual(fs.readlinkSync(path.join(L.dest, 'lien-relatif')), 'Contents/marker', 'liens symboliques du paquet préservés'); noPwn(L);
    // 6b. Montage détaché (un dossier ordinaire ne l'est pas : l'échec du démontage ne bloque rien)
    L = lab({ weird: false }); const mnt = path.join(L.root, 'mnt'); fs.mkdirSync(mnt); assert.strictEqual(exec(L, { mnt }).status, 0); assert.strictEqual(L.mark(L.dest), 'nouvelle');
    // 6c. Première installation (pas d'ancienne app)
    L = lab({ noOld: true }); assert.strictEqual(exec(L).status, 0); assert.strictEqual(L.mark(L.dest), 'nouvelle'); assert.deepStrictEqual(leftovers(L), []);
    // 6d. Copie impossible (source absente) : l'ancienne version reste intacte et est relancée
    L = lab({ noSrc: true }); let rs = exec(L); assert.strictEqual(rs.status, 1); assert.strictEqual(L.mark(L.dest), 'ancienne'); assert.deepStrictEqual(leftovers(L), []); assert(/RESULT fail source-missing/.test(fs.readFileSync(L.log, 'utf8'))); assert.deepStrictEqual(opens(L), [L.dest], 'ancienne version relancée'); assert(!fs.existsSync(L.work));
    // 6e. Paquet incomplet : rien n'est remplacé
    L = lab(); fs.rmSync(path.join(L.src, 'Contents', 'Info.plist')); rs = exec(L); assert.strictEqual(rs.status, 1); assert.strictEqual(L.mark(L.dest), 'ancienne'); assert.deepStrictEqual(leftovers(L), []); assert(/fail incomplete/.test(fs.readFileSync(L.log, 'utf8')));
    // 6f. Relance impossible : retour arrière vers l'ancienne version, puis tentative de relance de celle-ci
    L = lab({ failOpener: 1 }); rs = exec(L); assert.strictEqual(rs.status, 1); assert.strictEqual(L.mark(L.dest), 'ancienne', 'retour arrière'); assert.deepStrictEqual(leftovers(L), []); assert(/RESULT fail launch/.test(fs.readFileSync(L.log, 'utf8'))); assert.strictEqual(opens(L).length, 2, 'deuxième relance : l’ancienne version'); noPwn(L);
    // 6g. Dossier d'installation en lecture seule : copie impossible, ancienne version intacte
    if (canTestRo) { L = lab({ weird: false }); fs.chmodSync(L.dir, 0o500); try { rs = exec(L); assert.strictEqual(rs.status, 1); assert.strictEqual(L.mark(L.dest), 'ancienne'); assert(/fail copy/.test(fs.readFileSync(L.log, 'utf8'))); } finally { fs.chmodSync(L.dir, 0o700); } }
    // 6h. L'application ne se ferme pas : on ne touche à rien (limite ramenée à 3 tours pour le test)
    L = lab({ script: U.INSTALL_SCRIPT.replace('-gt 400', '-gt 3') }); const stay = cp.spawn('/bin/sleep', ['20']); rs = await execAsync(L, { pid: stay.pid }); stay.kill(); assert.strictEqual(rs.status, 1); assert.strictEqual(L.mark(L.dest), 'ancienne'); assert.deepStrictEqual(opens(L), [], 'app encore ouverte : pas de relance'); assert(/fail app-still-running/.test(fs.readFileSync(L.log, 'utf8')));
    // 6i. Garde-fous : mauvais nombre d'arguments ; dossier de travail qui n'est pas « jarvis-update-* » jamais supprimé
    L = lab(); assert.strictEqual(cp.spawnSync('/bin/bash', [L.script, '1', 'a'], { encoding: 'utf8' }).status, 2); assert.strictEqual(L.mark(L.dest), 'ancienne');
    L = lab(); const keep = path.join(L.root, 'travail-important'); fs.mkdirSync(keep); fs.writeFileSync(path.join(keep, 'precieux.txt'), 'oui'); rs = exec(L, { work: keep }); assert.strictEqual(rs.status, 0); assert(fs.existsSync(path.join(keep, 'precieux.txt')), 'seuls les dossiers jarvis-update-* sont supprimés');
    // 6j. Chemin de destination piégé : jamais interprété
    L = lab({ weird: false }); const trap = path.join(L.root, 'x; touch PWNED3; #'); fs.mkdirSync(trap); fs.renameSync(L.dest, path.join(trap, 'Jarvis Parlement.app')); L.dest = path.join(trap, 'Jarvis Parlement.app'); assert.strictEqual(exec(L).status, 0); assert.strictEqual(L.mark(L.dest), 'nouvelle'); noPwn(L);
    ok('script d’installation exécuté pour de vrai : attend la fermeture, échange atomique, quarantaine retirée, chemins piégés (espaces, apostrophe, $(), backticks) sans injection, retour arrière si copie/relance échoue, app ouverte → rien touché');
  }

  // ================================================================ 7. IPC (api.js) et réglages ================================================================
  const apiMod = require('../src/api');
  reset(); const inst = U.init({ version: '1.5.2', packaged: false, arch: 'arm64', pid: 1, exePath: exe, tmpBase, downloadsDir: downloads, emit() {}, fetch: fakeFetch, run: fakeRun, spawn: fakeSpawn, quit() { SYS.quits++; }, now });
  const api = apiMod.create({ dialog: {}, shell: { openExternal: async () => {}, openPath: async () => '' }, app: { getVersion: () => '1.5.2', isPackaged: false }, systemPreferences: {}, getWindow: () => null, emit() {} });
  for (const k of ['update.status', 'update.check', 'update.install', 'update.cancel', 'update.skip', 'update.snooze', 'update.configure']) assert.strictEqual(typeof api[k], 'function', k);
  let st = await api['update.status'](); assert.strictEqual(st.current, '1.5.2'); assert.strictEqual(st.dev, true);
  st = await api['update.check'](); assert.strictEqual(st.state, 'available');
  for (const bad of [undefined, null, '', '1.5', 'latest', '../../etc', '1.6.0; rm -rf /', {}, [], 42, '1.7.0-beta.1', 'x'.repeat(5000)]) { assert.throws(() => api['update.skip']({ version: bad }), /invalide/, 'skip ' + JSON.stringify(bad)); assert.throws(() => api['update.snooze']({ version: bad }), /invalide/, 'snooze ' + JSON.stringify(bad)); }
  assert.throws(() => api['update.skip'](), /invalide/); assert.throws(() => api['update.snooze'](null), /invalide/);
  for (const bad of [0, 169, -1, 1.5, 'abc', {}, [], null, true]) assert.throws(() => api['update.snooze']({ version: '1.6.0', hours: bad }), /invalide/, 'hours ' + JSON.stringify(bad));
  assert.strictEqual((await api['update.snooze']({ version: '1.6.0', hours: 48 })).snoozeUntil, new Date(T0 + 48 * 3600e3).toISOString()); assert.strictEqual((await api['update.snooze']({ version: 'v1.6.0' })).snoozeUntil, new Date(T0 + 24 * 3600e3).toISOString());
  assert.strictEqual((await api['update.skip']({ version: 'v1.6.0' })).ignored, '1.6.0'); assert.strictEqual((await api['update.skip']({ version: '1.6.0', undo: true })).ignored, '');
  for (const bad of [{}, { auto: 'oui' }, { auto: 1 }, { checkHours: 0 }, { checkHours: 73 }, { checkHours: 2.5 }, { checkHours: 'abc' }, { checkHours: null }, { repo: 'evil/evil' }, { url: 'https://evil.example' }]) assert.throws(() => api['update.configure'](bad), /invalide|Aucun/, 'configure ' + JSON.stringify(bad));
  assert.throws(() => api['update.configure'](), /Aucun/); let cf = await api['update.configure']({ auto: false, checkHours: '12' }); assert(!cf.auto && cf.checkHours === 12); cf = await api['update.configure']({ auto: true }); assert(cf.auto && cf.checkHours === 12);
  const sim = await api['update.install']({ force: 'oui', voice: 1, repo: 'evil/evil', url: 'https://evil.example/x.dmg' }); assert(sim.simulated, 'développement : simulation seulement'); assert.strictEqual(SYS.quits, 0); assert.strictEqual(SYS.spawned.length, 0);
  assert.deepStrictEqual(await api['update.cancel'](), { cancelled: false });
  // réglages : filtre strict, valeurs par défaut, jamais de dépôt configurable
  let pp = apiMod.sanitizeSettingsPatch({ update: { auto: 'x', checkHours: 999, repo: 'evil/evil', url: 'http://evil', ignored: '1.0.0' } }); assert.deepStrictEqual(pp.update, { auto: true, checkHours: 72 });
  pp = apiMod.sanitizeSettingsPatch({ update: { checkHours: -5 } }); assert.deepStrictEqual(pp.update, { checkHours: 1 }); pp = apiMod.sanitizeSettingsPatch({ update: { auto: false } }); assert.deepStrictEqual(pp.update, { auto: false }); assert(!('update' in apiMod.sanitizeSettingsPatch({ update: 'x' })) && !('update' in apiMod.sanitizeSettingsPatch({ update: { checkHours: 'abc' } })) && !('update' in apiMod.sanitizeSettingsPatch({})));
  api['settings.set']({ update: { auto: false, checkHours: 24, repo: 'evil/evil' } }); assert.deepStrictEqual(api['settings.get']().update, { auto: false, checkHours: 24 });
  fs.writeFileSync(path.join(store.DIR, 'settings.json'), JSON.stringify({ update: { auto: 'n', checkHours: 9999 } })); assert.deepStrictEqual(store.settings.get().update, { auto: true, checkHours: 72 }); fs.writeFileSync(path.join(store.DIR, 'settings.json'), JSON.stringify({ update: 5 })); assert.deepStrictEqual(store.settings.get().update, { auto: true, checkHours: 6 });
  fs.rmSync(path.join(store.DIR, 'settings.json'), { force: true }); assert.deepStrictEqual(store.settings.get().update, { auto: true, checkHours: 6 }, 'défauts : automatique, toutes les 6 h');
  assert.strictEqual(U.API_URL, `https://api.github.com/repos/${REPO}/releases/latest`); assert.strictEqual(U.REPO, REPO); assert(Object.isFrozen(U.LIMITS) && Object.isFrozen(U.T)); assert.strictEqual(U.LIMITS.maxDmg, 600 * 1024 * 1024);
  const hostile = U.init({ version: '1.5.2' }); inst.stop(); hostile.stop();
  ok('IPC update.* : entrées validées (version, durée, fréquence, booléens stricts), développement = simulation, réglages filtrés, dépôt non configurable');

  // ================================================================ 8. Branchements et hygiène des fichiers ================================================================
  const ROOT = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert(/'update-available', 'update-progress', 'update-error'/.test(rd('preload.js')), 'canaux dans la liste blanche de preload.js');
  assert(/startUpdater\(\)/.test(rd('main.js')) && /updater\.stop\(\)/.test(rd('main.js')) && /updater'\)\.track\(method\)/.test(rd('main.js')), 'démarrage, arrêt et suivi d’activité dans main.js');
  assert(/node scripts\/test-updater\.js/.test(rd('package.json')) && /updater-ui\.js/.test(rd('renderer/index.html')));
  const files = ['src/updater.js', 'renderer/updater-ui.js', 'scripts/test-updater.js', 'main.js', 'preload.js', 'src/api.js', 'src/store.js', 'renderer/notify-ui.js'];
  for (const f of files) { const bad = [...rd(f)].filter((c) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/.test(c)); assert.strictEqual(bad.length, 0, f + ' contient des caractères de contrôle ou invisibles littéraux'); }
  assert(!/require\(['"](electron-updater|electron-builder)/.test(rd('src/updater.js')) && !/autoUpdater/.test(rd('src/updater.js').replace(/\/\/.*$/gm, '')), 'pas d’autoUpdater natif');
  ok('preload (canaux), main.js (démarrage/arrêt/activité), package.json, index.html branchés ; aucun caractère invisible littéral dans les fichiers');

  // ================================================================ Annonce visible + vérification au retour sur l'app ================================================================
  {
    reset(); const { inst } = mk();
    assert.strictEqual(await inst.checkIfStale(30 * 60000), null, 'pas de vérification avant le démarrage'); inst.start();
    await inst.check({ manual: false });
    assert.strictEqual(await inst.checkIfStale(30 * 60000), null, 'vérification récente : rien à refaire');
    clock += 31 * 60000; const r = await inst.checkIfStale(30 * 60000); assert(r !== null, 'vérification périmée : on regarde tout de suite'); inst.stop();
    ok('retour sur l\'application : nouvelle vérification seulement si la dernière date de plus de 30 minutes');
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'updater-ui.js'), 'utf8'); const appSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8'); const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8');
    assert(/jv-update/.test(uiSrc) && /side-update/.test(uiSrc) && /update\.checkStale/.test(uiSrc) && /'updOpen'|data-act = 'updOpen'|data-act="updOpen"/.test(uiSrc) && /'update\.checkStale'/.test(apiSrc)); ok('une version disponible est annoncée sur l\'accueil et dans le menu, avec le bouton « Mettre à jour »');
    assert(/querySelectorAll\('\.setup-hint-row, \.setup-hint'\)/.test(appSrc)); ok('le rappel « Mise en route » ne s\'empile plus (une seule croix, jamais de croix seules)');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Mise à jour automatique : tous les tests passent.');
  process.exit(0);
})().catch((e) => { console.error('ÉCHEC :', e && e.stack || e); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ } process.exit(1); });

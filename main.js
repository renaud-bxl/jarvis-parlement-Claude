const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, session, systemPreferences, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let win = null;
const emit = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const RENDERER_DIR = path.join(__dirname, 'renderer');
const RENDERER_URL = pathToFileURL(path.join(RENDERER_DIR, 'index.html')).href;
const DEV = !app.isPackaged;

// Retire clés API / jetons avant tout affichage ou journal.
const redact = (s) => String(s == null ? '' : s).replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]{6,}/g, '$1…').replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1…');

// Lien externe : http(s) uniquement, sans identifiants intégrés.
function externalOk(url) {
  try { const u = new URL(String(url)); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && String(url).length <= 2048; }
  catch { return false; }
}
// Une page n'est la nôtre que si elle vient de notre dossier renderer (pas de file:// arbitraire).
const isOurPage = (url) => typeof url === 'string' && url.startsWith(RENDERER_URL.replace(/index\.html$/, ''));

app.setName('Jarvis Parlement');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// Une erreur imprévue ne doit ni fermer l'app ni écrire de secret dans les journaux.
process.on('uncaughtException', (e) => { console.error('Erreur non gérée :', redact(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); });
process.on('unhandledRejection', (e) => { console.error('Promesse rejetée :', redact(e && e.message ? e.message : e)); });

let modules = null;
function setup() {
  const store = require('./src/store');
  const brain = require('./src/brain');
  const google = require('./src/google');
  const scheduler = require('./src/scheduler');
  const research = require('./src/research');
  const apiMod = require('./src/api');
  modules = { scheduler, voice: require('./src/voice'), llm: require('./src/llm'), indexer: require('./src/indexer') };

  try { require('./src/workspace').ensureAll(); } catch (e) { console.error('workspace', redact(e.message)); }
  brain.setEmitter(emit);
  google.setOpener((url) => { if (!externalOk(url)) throw new Error('URL refusée.'); return shell.openExternal(url); });
  const api = apiMod.create({ dialog, shell, app, systemPreferences, getWindow: () => win, emit });

  ipcMain.handle('api', async (e, method, args) => {
    // Seule notre propre page a le droit d'appeler l'API (jamais une page externe ou un sous-cadre inattendu).
    const from = e.senderFrame && e.senderFrame.url;
    if (!win || e.sender !== win.webContents || !isOurPage(from)) return { __error: 'Appel refusé.' };
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(api, method)) return { __error: 'Méthode inconnue.' };
    const done = require('./src/updater').track(method); // « occupé » : l'installation d'une mise à jour n'est jamais proposée en douce pendant un envoi / une demande IA
    try { return await api[method](args && typeof args === 'object' && !Array.isArray(args) ? args : {}); }
    catch (err) { return { __error: redact((err && err.message) || String(err)) }; }
    finally { done(); }
  });

  scheduler.init({
    run: () => research.runVeille(),
    onNotify: (title, body) => { try { new Notification({ title, body }).show(); } catch { /* ignore */ } emit('veille-done', { title, body }); },
  });
  // Réveil du Mac : rattrapage immédiat de la veille manquée.
  try { powerMonitor.on('resume', () => setTimeout(() => scheduler.tick(), 3000)); } catch { /* ok */ }
  // Surveillance des courriels : en pause pendant la mise en veille, rattrapage au réveil.
  modules.mailwatch = require('./src/mailwatch');
  try { powerMonitor.on('suspend', () => modules.mailwatch.pause()); powerMonitor.on('resume', () => modules.mailwatch.resume()); } catch { /* ok */ }
  return store;
}

// Notification macOS pour un nouveau courriel : un clic ramène la fenêtre au premier plan et ouvre le courriel dans « Courriels ».
// Si la fenêtre est déjà au premier plan, l'alerte de l'application suffit (pas de doublon).
const liveNotifs = new Set();
function notifyNative({ title, body, key, urgent } = {}) {
  try {
    if (!Notification.isSupported() || (win && !win.isDestroyed() && win.isVisible() && win.isFocused())) return;
    const n = new Notification({ title: String(title || 'Jarvis').slice(0, 120), body: String(body || '').slice(0, 300), silent: !urgent });
    liveNotifs.add(n); n.on('close', () => liveNotifs.delete(n));
    n.on('click', () => {
      liveNotifs.delete(n);
      if (!win || win.isDestroyed()) { createWindow(); return; }
      if (win.isMinimized()) win.restore(); win.show(); win.focus();
      emit('mail-open', { key: typeof key === 'string' ? key : null });
    });
    n.show();
  } catch { /* notification impossible : l'alerte de l'application reste */ }
}
function startMailWatch() {
  try {
    modules.mailwatch.start({ emit, notify: notifyNative, onCounts: (c) => { try { if (app.dock) app.dock.setBadge(c && c.count ? String(c.count) : ''); } catch { /* ok */ } } });
  } catch (e) { console.error('Surveillance des courriels :', redact(e.message)); }
}

// Mises à jour depuis GitHub : vérification régulière, alerte dans l'app + notification macOS (une fois par version) ; l'installation, elle, n'a lieu qu'au clic.
function notifyUpdate({ title, body } = {}) {
  try {
    if (!Notification.isSupported() || (win && !win.isDestroyed() && win.isVisible() && win.isFocused())) return; // fenêtre au premier plan : l'alerte de l'app suffit
    const n = new Notification({ title: String(title || 'Jarvis Parlement').slice(0, 120), body: String(body || '').slice(0, 300) });
    liveNotifs.add(n); n.on('close', () => liveNotifs.delete(n));
    n.on('click', () => {
      liveNotifs.delete(n);
      if (!win || win.isDestroyed()) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      setTimeout(() => emit('update-available', { open: true }), 600); // l'interface ouvre la fenêtre « Nouvelle version »
    });
    n.show();
  } catch { /* notification impossible : l'alerte de l'application reste */ }
}
function startUpdater() {
  try {
    modules.updater = require('./src/updater').init({
      version: app.getVersion(), packaged: app.isPackaged, exePath: app.getPath('exe'), arch: process.arch, pid: process.pid,
      downloadsDir: app.getPath('downloads'), emit, notify: notifyUpdate, quit: () => app.quit(), openPath: (p) => shell.openPath(p),
    });
    modules.updater.start();
  } catch (e) { console.error('Mises à jour :', redact(e.message)); }
}

function createWindow() {
  // Micro autorisé uniquement pour l'interface de l'app (dictée vocale), audio seul, jamais pour une page externe.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const types = (details && details.mediaTypes) || [];
    cb(perm === 'media' && !types.includes('video') && isOurPage(wc && wc.getURL()) && (!details || details.isMainFrame !== false));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && typeof origin === 'string' && origin.startsWith('file://') && isOurPage(wc && wc.getURL()));
  // L'interface ne charge jamais rien depuis Internet (la CSP le dit déjà ; ceci le garantit côté processus principal).
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools|chrome-extension|chrome|about):/i.test(d.url) }));

  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1020, minHeight: 640,
    title: 'Jarvis Parlement',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: require('electron').nativeTheme.shouldUseDarkColors ? '#071530' : '#f3f5fa', // évite un flash clair au démarrage en thème sombre
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, nodeIntegrationInSubFrames: false,
      devTools: DEV, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Développement uniquement : copie la console de l'interface dans un fichier (JARVIS_CONSOLE_LOG=/chemin), jamais dans l'app installée.
  if (process.env.JARVIS_CONSOLE_LOG && !app.isPackaged) win.webContents.on('console-message', (e, level, msg) => { try { fs.appendFileSync(process.env.JARVIS_CONSOLE_LOG, `[${level ?? e.level}] ${msg ?? e.message}\n`); } catch { /* ignoré */ } });
  win.loadFile(path.join(RENDERER_DIR, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (externalOk(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (isOurPage(url)) return; e.preventDefault(); if (externalOk(url)) shell.openExternal(url); });
  win.webContents.on('render-process-gone', (_e, d) => { console.error('Interface arrêtée :', d && d.reason); if (win && !win.isDestroyed() && d && d.reason !== 'clean-exit') win.reload(); });
  win.on('closed', () => { win = null; });

  // Mode capture (tests visuels, développement uniquement) : JARVIS_SHOT=/chemin.png JARVIS_NAV=dossiers
  if (process.env.JARVIS_SHOT && DEV) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      if (process.env.JARVIS_NAV) await win.webContents.executeJavaScript(`location.hash=${JSON.stringify('#' + process.env.JARVIS_NAV)}`);
      if (process.env.JARVIS_EVAL) await win.webContents.executeJavaScript(process.env.JARVIS_EVAL);
      await new Promise((r) => setTimeout(r, 1500));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.JARVIS_SHOT, img.toPNG());
      app.quit();
    });
  }
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about', label: 'À propos de Jarvis Parlement' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: 'Quitter' }] },
    { label: 'Édition', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Aller', submenu: ['accueil', 'tableau', 'dossiers', 'recherche', 'documents', 'redaction', 'courriels', 'agenda', 'veille', 'cerveau', 'assistant', 'reglages', 'diagnostic'].map((p, i) => ({ label: p[0].toUpperCase() + p.slice(1), accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined, click: () => emit('navigate', p) })) },
    { label: 'Fenêtre', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, ...(DEV ? [{ role: 'toggleDevTools' }] : [])] },
  ]));
}

// Rien d'autre ne peut s'attacher à l'application : pas de <webview>, pas de nouvelle fenêtre.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
  wc.on('will-navigate', (ev, url) => { if (!isOurPage(url)) ev.preventDefault(); });
});

// Arrêt propre : moteur vocal tué, requêtes IA annulées, planificateur arrêté.
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  try { modules && modules.voice.stopEngines(); } catch { /* ok */ }
  try { modules && modules.llm.abortAll(); } catch { /* ok */ }
  try { modules && modules.indexer.cancel(); } catch { /* ok */ }
  try { modules && modules.scheduler.stop(); } catch { /* ok */ }
  try { modules && modules.mailwatch && modules.mailwatch.stop(); } catch { /* ok */ }
  try { modules && modules.updater && modules.updater.stop(); } catch { /* ok */ }
}
app.on('before-quit', cleanup);
app.on('will-quit', cleanup);
process.on('exit', cleanup);

if (gotLock) {
  app.whenReady().then(() => {
    setup(); menu(); createWindow(); startMailWatch(); startUpdater();
    // Voix de Jarvis : toujours une voix humaine (féminine par défaut, fournie avec l'application), chargée dès le démarrage.
    try { modules.voice.ensureDefault((c, d) => emit(c, d)).then(() => modules.voice.warm()).catch(() => {}); } catch { /* sans voix : texte seulement */ }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => { if (!win) createWindow(); });
}

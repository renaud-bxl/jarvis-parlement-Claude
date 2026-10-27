const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
const emit = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

app.setName('Jarvis Parlement');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function setup() {
  const store = require('./src/store');
  const brain = require('./src/brain');
  const google = require('./src/google');
  const scheduler = require('./src/scheduler');
  const research = require('./src/research');
  const apiMod = require('./src/api');

  try { require('./src/workspace').ensureAll(); } catch (e) { console.error('workspace', e.message); }
  brain.setEmitter(emit);
  google.setOpener((url) => shell.openExternal(url));
  const api = apiMod.create({ dialog, shell, app, systemPreferences, getWindow: () => win, emit });

  ipcMain.handle('api', async (_e, method, args) => {
    const fn = api[method];
    if (!fn) return { __error: 'Méthode inconnue : ' + method };
    try { return await fn(args || {}); }
    catch (e) { return { __error: e.message || String(e) }; }
  });

  scheduler.init({
    run: () => research.runVeille(),
    onNotify: (title, body) => { try { new Notification({ title, body }).show(); } catch { /* ignore */ } emit('veille-done', { title, body }); },
  });
  return store;
}

function createWindow() {
  // Micro autorisé uniquement pour l'interface de l'app (dictée vocale).
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && wc.getURL().startsWith('file://')));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media');
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1020, minHeight: 640,
    title: 'Jarvis Parlement',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f6f4ef',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });

  // Mode capture (tests visuels) : JARVIS_SHOT=/chemin.png JARVIS_NAV=dossiers
  if (process.env.JARVIS_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      if (process.env.JARVIS_NAV) await win.webContents.executeJavaScript(`location.hash='#${process.env.JARVIS_NAV}'`);
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
    { label: 'Fenêtre', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { role: 'toggleDevTools' }] },
  ]));
}

app.whenReady().then(() => { setup(); menu(); createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });

// Rend build/icon.svg en PNG transparent 1024 px (via Electron). Lancé par scripts/make-icon.sh
const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG()); app.quit();
});

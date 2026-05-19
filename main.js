const { app, BrowserWindow, ipcMain, dialog, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const DATA_FILE_NAME = 'scheduler-data.json';
let mainWindow;

function getDataPath() { return path.join(app.getPath('userData'), DATA_FILE_NAME); }

function readData() {
  const p = getDataPath();
  if (!fs.existsSync(p)) return { tasks: [], meetings: [], teamMembers: [], followUps: [], notes: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { console.error('Failed to read data file:', err); return { tasks: [], meetings: [], teamMembers: [], followUps: [], notes: [] }; }
}
function writeData(data) { fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf8'); }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 960, minHeight: 640,
    backgroundColor: '#0c0b13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => { writeData(data); return true; });
ipcMain.handle('data:export', async (_e, data) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export data',
    defaultPath: `scheduler-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, path: result.filePath };
});
ipcMain.handle('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  return true;
});

ipcMain.handle('share:save', async (_e, html) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save daily standup',
    defaultPath: `standup-${stamp}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, html, 'utf8');
  // Open in default browser
  require('electron').shell.openPath(result.filePath);
  return { ok: true, path: result.filePath };
});

// ========== Auto-updater ==========
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function setupAutoUpdater() {
  // Skip in dev (no packaged metadata).
  if (!app.isPackaged) {
    console.log('[updater] dev mode — auto-updates disabled');
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking'));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] available', info.version);
    send('update:event', { type: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('error', (err) => {
    console.error('[updater] error', err);
    send('update:event', { type: 'error', message: String(err.message || err) });
  });
  autoUpdater.on('download-progress', (p) => {
    send('update:event', { type: 'progress', percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded', info.version);
    send('update:event', { type: 'downloaded', version: info.version });
  });

  // Check once on launch, then every 4 hours.
  setTimeout(() => autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed', e)), 5000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

ipcMain.handle('update:install', () => {
  // Quits all windows and runs the installer.
  autoUpdater.quitAndInstall(false, true);
});

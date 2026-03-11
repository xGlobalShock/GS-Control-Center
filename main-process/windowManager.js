const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let splashWindow = null;

// Root directory for resolving paths (set by main.js)
let _rootDir = __dirname;

function setRootDir(dir) {
  _rootDir = dir;
}

function getRootDir() {
  return _rootDir;
}

function getMainWindow() {
  return mainWindow;
}

function getSplashWindow() {
  return splashWindow;
}

function createSplashWindow() {
  const isDev = !app.isPackaged;
  splashWindow = new BrowserWindow({
    width: 380,
    height: 440,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
    },
  });
  const splashPath = isDev
    ? path.join(_rootDir, 'public/splash.html')
    : path.join(_rootDir, 'build', 'splash.html');
  splashWindow.loadFile(splashPath);
  splashWindow.on('closed', () => { splashWindow = null; });
}

function sendSplashStatus(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', msg);
  }
}

function sendSplashProgress(pct) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:progress', pct);
  }
}

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 860,
    resizable: false,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: isDev
        ? path.join(_rootDir, 'public/preload.js')
        : path.join(_rootDir, 'build', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      devTools: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Custom window control IPC handlers
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized());

  // Notify renderer when maximize state changes
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-changed', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-changed', false));

  // Block all keyboard shortcuts that could open developer tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.control &&
      input.shift &&
      (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'c' || input.key.toLowerCase() === 'j')
    ) {
      event.preventDefault();
    }
    if (input.key === 'F12') {
      event.preventDefault();
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(_rootDir, 'build', 'index.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

module.exports = {
  setRootDir,
  getRootDir,
  getMainWindow,
  getSplashWindow,
  createSplashWindow,
  sendSplashStatus,
  sendSplashProgress,
  createWindow,
};

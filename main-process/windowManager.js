const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let splashWindow = null;
let _minimizeToTray = false;
let _mainWindowLoadPromise = null;
let _windowIpcRegistered = false;

function setMinimizeToTray(val) {
  _minimizeToTray = !!val;
}

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
  if (splashWindow !== null) {
    splashWindow.close();
    splashWindow = null;
  }
  try {
    const iconPath = isDev
      ? path.join(_rootDir, 'public', 'app-icons', 'gs-center.png')
      : path.join(_rootDir, 'build', 'app-icons', 'GSC.ico');

    splashWindow = new BrowserWindow({
      width: 380,
      height: 440,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      center: true,
      icon: iconPath,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: isDev
          ? path.join(_rootDir, 'public', 'splash-preload.js')
          : path.join(_rootDir, 'build', 'splash-preload.js'),
        devTools: false,
      },
    });
    const splashPath = isDev
      ? path.join(_rootDir, 'public/splash.html')
      : path.join(_rootDir, 'build', 'splash.html');
    splashWindow.loadFile(splashPath).catch((err) => {
      console.error('Failed to load splash window:', err);
    });
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (err) {
    console.error('Error creating splash window:', err);
    splashWindow = null;
  }
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

function sendSplashDetails(details) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:details', details);
  }
}

function createWindow() {
  const isDev = !app.isPackaged;

  if (mainWindow !== null) {
    mainWindow.close();
    mainWindow = null;
  }

  // Register window-control IPC handlers exactly once, regardless of how
  // many times createWindow() is called. ipcMain.handle() throws on a second
  // registration for the same channel, and ipcMain.on() stacks handlers —
  // either error breaks window controls on any re-create (e.g. app.activate).
  if (!_windowIpcRegistered) {
    _windowIpcRegistered = true;

    ipcMain.on('window-minimize', () => {
      if (_minimizeToTray && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      } else {
        mainWindow?.minimize();
      }
    });
    ipcMain.on('window-maximize', () => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow?.maximize();
      }
    });
    ipcMain.on('window-close', () => {
      if (_minimizeToTray && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      } else {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }
        // Force application shutdown so background processes are not left running.
        app.quit();
      }
    });
    ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized());
  }

  try {
    const mainIconPath = isDev
      ? path.join(_rootDir, 'public', 'app-icons', 'gs-center.png')
      : path.join(_rootDir, 'build', 'app-icons', 'GSC.ico');

    mainWindow = new BrowserWindow({
      width: 1480,
      height: 860,
      resizable: false,
      maximizable: false,
      frame: false,
      show: false,
      backgroundColor: '#020606',
      autoHideMenuBar: true,
      icon: mainIconPath,
      webPreferences: {
        preload: isDev
          ? path.join(_rootDir, 'public/preload.js')
          : path.join(_rootDir, 'build', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        webviewTag: true,
        devTools: false, // DISABLED DEVTOOLS IN PRODUCTION
        backgroundThrottling: false,
      },
    });

    mainWindow.setMenuBarVisibility(false);

    // Notify renderer when maximize state changes
    mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-changed', true));
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-changed', false));

    // DISABLED/ENABLED DEVTOOLS IN PRODUCTION 
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


    // Track page-load completion BEFORE loadURL — avoids race where
    // did-finish-load fires before the listener is attached.
    _mainWindowLoadPromise = new Promise((resolve) => {
      mainWindow.webContents.once('did-finish-load', resolve);
    });

    // Load the main page (index.html in production, localhost:3000 in development)
    const startUrl = isDev
      ? 'http://localhost:3000'
      : `file://${path.join(_rootDir, 'build', 'index.html')}`;

    mainWindow.loadURL(startUrl).catch((err) => {
      console.error('Failed to load main window:', err);
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    console.error('Error creating main window:', err);
    mainWindow = null;
  }
}

function getMainWindowLoadPromise() {
  return _mainWindowLoadPromise;
}

module.exports = {
  setRootDir,
  getRootDir,
  getMainWindow,
  getSplashWindow,
  createSplashWindow,
  sendSplashStatus,
  sendSplashProgress,
  sendSplashDetails,
  createWindow,
  setMinimizeToTray,
  getMainWindowLoadPromise,
};

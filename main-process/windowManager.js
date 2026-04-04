const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let splashWindow = null;
let _minimizeToTray = false;

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

  try {
    const mainIconPath = isDev
      ? path.join(_rootDir, 'public', 'app-icons', 'gs-center.png')
      : path.join(_rootDir, 'build', 'app-icons', 'GSC.ico');

    mainWindow = new BrowserWindow({
      width: 1480,
      height: 860,
      resizable: false,
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
        devTools: false,
      },
    });

    mainWindow.setMenuBarVisibility(false);

    // Custom window control IPC handlers
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
};

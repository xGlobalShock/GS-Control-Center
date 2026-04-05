const { ipcMain, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const windowManager = require('./windowManager');

let overlayWindow = null;
let _overlayVisible = false;
let _overlayConfig = {
  showHeader: true,
  showBackground: true,
  showFps: true,
  showCpuUsage: true,
  showGpuTemp: true,
  showRamUsage: true,
  showLatency: true,
  showPacketLoss: true,
  showNetworkSpeed: true,
  showGpuUsage: true,
  showCpuTemp: true,
  position: 'top-right', // top-left, top-right, bottom-left, bottom-right
  opacity: 0.85,
  color: '#00F2FF',
  font: 'Share Tech Mono',
  fontSize: 'medium',
  hotkey: 'CommandOrControl+Shift+F',
};

function getOverlayBounds() {
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const sizeMap = {
    small:  { ow: 192, oh: 255 },
    medium: { ow: 234, oh: 310 },
    large:  { ow: 286, oh: 400 },
  };
  const { ow, oh } = sizeMap[_overlayConfig.fontSize] ?? sizeMap.medium;
  const margin = 10;

  switch (_overlayConfig.position) {
    case 'top-right': return { x: sw - ow - margin, y: margin, width: ow, height: oh };
    case 'bottom-left': return { x: margin, y: sh - oh - margin, width: ow, height: oh };
    case 'bottom-right': return { x: sw - ow - margin, y: sh - oh - margin, width: ow, height: oh };
    default: return { x: margin, y: margin, width: ow, height: oh };
  }
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  const isDev = !require('electron').app.isPackaged;
  const rootDir = windowManager.getRootDir();
  const bounds = getOverlayBounds();

  overlayWindow = new BrowserWindow({
    ...bounds,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev
        ? path.join(rootDir, 'public', 'overlay-preload.js')
        : path.join(rootDir, 'build', 'overlay-preload.js'),
      devTools: false,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  const overlayPath = isDev
    ? path.join(rootDir, 'public', 'overlay.html')
    : path.join(rootDir, 'build', 'overlay.html');

  overlayWindow.loadFile(overlayPath).catch(err => {
    console.error('Failed to load overlay:', err);
  });

  // Push current config (color, opacity, sensors) once the page is ready
  overlayWindow.webContents.once('did-finish-load', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay:config', _overlayConfig);
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    _overlayVisible = false;
  });

  _overlayVisible = true;

  // Ensure the hardware stats timer is running even if the renderer paused it
  try {
    const hm = require('./hardwareMonitor');
    hm._startRealtimePush();
  } catch (_) {}
}

function destroyOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
  _overlayVisible = false;
}

function toggleOverlay() {
  if (_overlayVisible) {
    destroyOverlay();
  } else {
    createOverlayWindow();
  }
  return _overlayVisible;
}

function pushStatsToOverlay(stats) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !_overlayVisible) return;
  overlayWindow.webContents.send('overlay:stats', {
    fps: stats.fps || null,
    cpuUsage: stats.cpu,
    cpuTemp: stats.temperature,
    gpuTemp: stats.gpuTemp,
    gpuUsage: stats.gpuUsage,
    ramPercent: stats.ram,
    latency: stats.latencyMs,
    packetLoss: stats.packetLoss,
    networkUp: stats.networkUp,
    networkDown: stats.networkDown,
  });
}

function registerHotkey() {
  try {
    globalShortcut.unregisterAll();
    globalShortcut.register(_overlayConfig.hotkey, () => {
      toggleOverlay();
      // Notify renderer about state change
      const mainWin = windowManager.getMainWindow();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('overlay:state-changed', _overlayVisible);
      }
    });
  } catch (err) {
    console.error('Failed to register overlay hotkey:', err);
  }
}

function registerIPC() {
  ipcMain.handle('overlay:toggle', () => {
    const visible = toggleOverlay();
    return { visible };
  });

  ipcMain.handle('overlay:get-state', () => ({
    visible: _overlayVisible,
    config: _overlayConfig,
  }));

  ipcMain.handle('overlay:set-config', (_event, newConfig) => {
    Object.assign(_overlayConfig, newConfig);
    if (_overlayVisible && overlayWindow && !overlayWindow.isDestroyed()) {
      // Reposition if position changed
      const bounds = getOverlayBounds();
      overlayWindow.setBounds(bounds);
      overlayWindow.webContents.send('overlay:config', _overlayConfig);
    }
    // Re-register hotkey if changed
    registerHotkey();
    return { config: _overlayConfig };
  });

  ipcMain.handle('overlay:is-visible', () => _overlayVisible);
}

function init() {
  registerHotkey();
}

module.exports = { registerIPC, init, pushStatsToOverlay, isVisible: () => _overlayVisible };

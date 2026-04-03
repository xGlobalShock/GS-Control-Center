const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Persistent app settings — must run before ANY Electron internals ─────────
const APP_SETTINGS_FILE = path.join(app.getPath('userData'), 'gs-app-settings.json');
let _appSettings = {};
try { _appSettings = JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8')); } catch {}
const _hwAccelEnabled = _appSettings.hardwareAcceleration !== false;
let _minimizeToTray = _appSettings.minimizeToTray === true;
let _tray = null;

function _saveAppSettings(patch) {
  try {
    let current = {};
    try { current = JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8')); } catch {}
    Object.assign(current, patch);
    fs.mkdirSync(path.dirname(APP_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify(current, null, 2));
  } catch {}
}

function _createTray() {
  if (_tray && !_tray.isDestroyed()) return;
  // Prefer ICO on Windows — native format with embedded 16×16/32×32 sizes.
  // Fall back to PNG if ICO is missing.
  const iconBase = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icons')
    : path.join(__dirname, '..', 'public', 'app-icons');
  const icoPath = path.join(iconBase, 'GSC.ico');
  const pngPath = path.join(iconBase, 'gs-center.png');
  const iconPath = require('fs').existsSync(icoPath) ? icoPath : pngPath;
  try {
    const icon = nativeImage.createFromPath(iconPath);
    _tray = new Tray(icon);
    _tray.setToolTip('GS Center');
    const buildMenu = () => Menu.buildFromTemplate([
      {
        label: 'Show GS Center',
        click: () => {
          const w = windowManager.getMainWindow();
          if (w && !w.isDestroyed()) { w.show(); w.focus(); }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit GS Center',
        click: () => { _cleanupAndExit(); app.quit(); },
      },
    ]);
    _tray.setContextMenu(buildMenu());
    _tray.on('double-click', () => {
      const w = windowManager.getMainWindow();
      if (w && !w.isDestroyed()) { w.show(); w.focus(); }
    });
  } catch (e) {
    console.error('[Tray] Creation failed:', e);
  }
}

function _destroyTray() {
  if (_tray && !_tray.isDestroyed()) _tray.destroy();
  _tray = null;
}

// ── Rendering Pipeline — must be called before app.ready AND before requires ─
if (!_hwAccelEnabled) {
  app.disableHardwareAcceleration();
} else {
  // Use ANGLE (hardware-backed) via EGL — stable on Windows without GPU process crashes
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'gl');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
app.commandLine.appendSwitch('disk-cache-dir',     path.join(app.getPath('userData'), 'Cache'));
app.commandLine.appendSwitch('gpu-disk-cache-dir', path.join(app.getPath('userData'), 'GPUCache'));

// Ensure Windows taskbar uses our AppUserModelID (must match build.appId)
if (process.platform === 'win32' && app && typeof app.setAppUserModelId === 'function') {
  try {
    app.setAppUserModelId('com.gscontrolcenter.app');
  } catch (e) {
    // Ignore if already set or not allowed
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED_REJECTION]', reason, promise);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err);
});

// ── Modules ─────────────────────────────────────────────────────────────────
const windowManager = require('../main-process/windowManager');
const autoUpdater = require('../main-process/autoUpdater');
const hardwareMonitor = require('../main-process/hardwareMonitor');
const hardwareInfo = require('../main-process/hardwareInfo');
const cleaners = require('../main-process/cleaners');
const tweaks = require('../main-process/tweaks');
const obsPresets = require('../main-process/obsPresets');
const softwareUpdates = require('../main-process/softwareUpdates');
const appInstaller = require('../main-process/appInstaller');
const appUninstaller = require('../main-process/appUninstaller');
const gameProfiles = require('../main-process/gameProfiles');
const network = require('../main-process/network');
const windowsDebloat = require('../main-process/windowsDebloat');
const spaceAnalyzer = require('../main-process/spaceAnalyzer');
const healthScore = require('../main-process/healthScore');
const overlay = require('../main-process/overlay');
const advisor = require('../main-process/advisor');
const resolutionManager = require('../main-process/resolutionManager');
const { execAsync } = require('../main-process/utils');

// ── GPU status tracking ─────────────────────────────────────────────────────
let _gpuStatus = _hwAccelEnabled
  ? { status: 'active',   renderer: 'SwiftShader', detail: 'Initializing…' }
  : { status: 'disabled', renderer: 'None',        detail: 'Hardware acceleration is disabled' };

ipcMain.handle('gpu:get-status', () => _gpuStatus);
ipcMain.handle('app:get-path',   () => app.getAppPath());

// Read saved preference from file (accurate after set-hw-accel is called)
ipcMain.handle('gpu:get-hw-accel', () => {
  try {
    const data = JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8'));
    return data.hardwareAcceleration !== false;
  } catch { return true; }
});

ipcMain.handle('gpu:set-hw-accel', (_event, enabled) => {
  try {
    _saveAppSettings({ hardwareAcceleration: enabled });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('app:get-minimize-to-tray', () => _minimizeToTray);

ipcMain.handle('app:set-minimize-to-tray', (_event, enabled) => {
  _minimizeToTray = !!enabled;
  _saveAppSettings({ minimizeToTray: _minimizeToTray });
  windowManager.setMinimizeToTray(_minimizeToTray);
  if (_minimizeToTray) {
    _createTray();
  } else {
    _destroyTray();
  }
  return { ok: true };
});

app.on('gpu-info-update', (info) => {
  _gpuStatus.detail = info?.gpuDevice?.[0]?.driverVersion || 'SwiftShader';
});

app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU' && details.reason !== 'clean-exit') {
    _gpuStatus = {
      status: 'crashed',
      renderer: 'SwiftShader',
      detail: `GPU process exited (reason: ${details.reason}, code: ${details.exitCode})`
    };
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('gpu:status-changed', _gpuStatus);
    }
  }
});

app.on('ready', async () => {
  try {
    const gpuInfo = await app.getGPUInfo('basic');
    const device = gpuInfo?.gpuDevice?.[0];
    _gpuStatus = {
      status: 'active',
      renderer: 'SwiftShader',
      detail: device?.driverVersion
        ? `SwiftShader (GL: ${device.driverVersion})`
        : 'SwiftShader (Software GPU)'
    };
  } catch {
    _gpuStatus = { status: 'active', renderer: 'SwiftShader', detail: 'SwiftShader (Software GPU)' };
  }
});

// ── Admin elevation ─────────────────────────────────────────────────────────
let isElevated = false;
if (process.platform === 'win32') {
  try {
    execSync('net session', { stdio: 'pipe' });
    isElevated = true;
  } catch {
    isElevated = false;
  }
  if (!isElevated && app.isPackaged) {
    const quotedExe = process.execPath.replace(/'/g, "''");
    const quotedArgs = process.argv.slice(1).map(a => a.replace(/'/g, "''")).join("' '");
    const psArgs = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process -FilePath '${quotedExe}' ${quotedArgs ? "-ArgumentList '" + quotedArgs + "'" : ''} -Verb RunAs`
    ];
    require('child_process').spawn('powershell', psArgs, {
      detached: true, stdio: 'ignore', windowsHide: true
    }).unref();
    app.quit();
    return;
  }
}

// ── Set root directory for modules ──────────────────────────────────────────
windowManager.setRootDir(path.join(__dirname, '..'));

// ── Initialize modules that need isElevated ─────────────────────────────────
tweaks.init({ isElevated });
appInstaller.init({ isElevated });
appUninstaller.init({ isElevated });
softwareUpdates.init({ isElevated, invalidateInstallerCaches: appInstaller.invalidateCaches });
windowsDebloat.init({ isElevated });

// ── Register all IPC handlers ───────────────────────────────────────────────
hardwareMonitor.registerIPC();
hardwareInfo.registerIPC();
cleaners.registerIPC();
tweaks.registerIPC();
obsPresets.registerIPC();
softwareUpdates.registerIPC();
appInstaller.registerIPC();
appUninstaller.registerIPC();
gameProfiles.registerIPC();
network.registerIPC();
autoUpdater.registerIPC();
windowsDebloat.registerIPC();
spaceAnalyzer.registerIPC();
healthScore.registerIPC();
overlay.registerIPC();
advisor.registerIPC();
resolutionManager.registerIPC();

// ── Pre-warm scan caches (orchestrator) ─────────────────────────────────────
async function _prewarmScanCaches({ updateSplash = false } = {}) {
  const canUpdateSplash = () => {
    if (!updateSplash) return false;
    const splash = windowManager.getSplashWindow();
    return splash && !splash.isDestroyed();
  };

  // 1. Pre-warm registry display names
  // Fire and forget since it's very fast
  appInstaller.getRegistryDisplayNames().catch(() => new Set());

  // 3. Pre-warm winget list cache
  if (canUpdateSplash()) {
    windowManager.sendSplashStatus('Loading applications library...');
    windowManager.sendSplashProgress(60);
  }
  try {
    const { stdout } = await execAsync(
      'chcp 65001 >nul && winget list --accept-source-agreements 2>nul',
      { timeout: 30000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe', maxBuffer: 1024 * 1024 * 5, env: process.env, cwd: process.env.SYSTEMROOT || 'C:\\Windows' }
    );
    const rawLines = stdout.split('\n').map(l => {
      const parts = l.split('\r').map(p => p.trimEnd()).filter(p => p.length > 0);
      return parts.length > 0 ? parts[parts.length - 1] : '';
    }).filter(l => l.length > 0);
    const lines = [];
    for (const l of rawLines) {
      if (/^\s+\S/.test(l) && lines.length > 0 && lines[lines.length - 1] !== '') {
        lines[lines.length - 1] += l;
      } else { lines.push(l); }
    }
    const headerIdx = lines.findIndex(l => /Name\s+Id\s+Version/i.test(l));
    const installedEntries = [];
    if (headerIdx !== -1) {
      const headerLine = lines[headerIdx];
      const idStart = headerLine.search(/\bId\b/i);
      const versionStart = headerLine.search(/\bVersion\b/i);
      const dataStart = headerIdx + 2;
      for (let i = dataStart; i < lines.length; i++) {
        const line = lines[i];
        if (line.length < idStart + 2) continue;
        const rawName = line.substring(0, idStart).trim();
        const rawId = line.substring(idStart, versionStart > idStart ? versionStart : line.length).trim();
        if (rawId && rawId !== '---' && rawName) {
          installedEntries.push({ name: rawName.toLowerCase(), id: rawId.toLowerCase() });
        }
      }
    }
    appInstaller.setWingetListCache({
      installedEntries,
      installedIdSet: new Set(installedEntries.map(e => e.id)),
      installedNameSet: new Set(installedEntries.map(e => e.name)),
    });
  } catch { }

  // 4. Match local applications
  if (canUpdateSplash()) {
    windowManager.sendSplashStatus('Verifying application states...');
    windowManager.sendSplashProgress(75);
  }
  try {
    const result = await appInstaller.checkInstalledImpl(appInstaller.APP_CATALOG_APPS);
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('appinstall:preloaded', result);
    }
  } catch { }

  // 5. Pre-load Windows Debloat components
  if (canUpdateSplash()) {
    windowManager.sendSplashStatus('Loading Windows features...');
    windowManager.sendSplashProgress(80);
  }
  try {
    const result = await windowsDebloat.handlePreloadAll();
    if (result && result.success && result.data) {
      const win = windowManager.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('wdebloat:preloaded', result.data);
      }
    }
  } catch { }
}

// ── Main app.on('ready') ────────────────────────────────────────────────────
app.on('ready', async () => {
  windowManager.createSplashWindow();

  const splash = windowManager.getSplashWindow();
  if (splash && !splash.isDestroyed()) {
    await new Promise((resolve) => {
      const onReady = () => {
        if (splash && !splash.isDestroyed()) {
          splash.webContents.send('splash:version', app.getVersion());
        }
        resolve();
      };
      splash.webContents.once('did-finish-load', onReady);
      setTimeout(resolve, 3000);
    });
  }

  windowManager.sendSplashStatus('Checking for updates...');
  windowManager.sendSplashProgress(5);
  windowManager.sendSplashDetails('Waiting for hardware discovery...');
  const softwareUpdatesPromise = softwareUpdates.checkSoftwareUpdatesImpl()
    .then(result => softwareUpdates.setSoftwareUpdatesCache(result))
    .catch(() => { });

  await new Promise(r => setTimeout(r, 400));

  windowManager.sendSplashStatus('Initializing core components...');
  windowManager.sendSplashProgress(10);

  // Enable winget InstallerHashOverride (requires admin)
  if (isElevated) {
    try { execSync('winget settings --enable InstallerHashOverride', { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch { }
  }

  await new Promise(r => setTimeout(r, 400));

  windowManager.sendSplashStatus('Loading sensor data...');
  windowManager.sendSplashProgress(15);

  hardwareMonitor.startLHMService();
  hardwareMonitor._startPerfCounterService();
  hardwareMonitor._startDiskRefresh();
  hardwareMonitor._startRamCacheRefresh();

  // Start full hardware info fetch early so it runs in parallel during splash
  hardwareInfo.initHardwareInfo();

  await new Promise(r => setTimeout(r, 400));

  windowManager.sendSplashStatus('Detecting system hardware...');
  windowManager.sendSplashProgress(20);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const componentDelay = 350;

  // Smooth progress ticker: slowly advances 20→55 while LHM discovers hardware
  windowManager.sendSplashStatus('Reading system configuration...');
  let tickerPct = 20;
  const tickerTarget = 55;
  const progressTicker = setInterval(() => {
    if (tickerPct < tickerTarget) {
      tickerPct = Math.min(tickerTarget, tickerPct + 0.5);
      windowManager.sendSplashProgress(Math.round(tickerPct));
    }
  }, 100);

  // Wait for LHM hardware names (fast — comes from the already-running LHM service)
  // Falls back to empty names after 8s timeout
  try {
    const lhmNamesPromise = hardwareMonitor.getLhmHardwareNamesPromise();
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
    const hwNames = await Promise.race([lhmNamesPromise, timeoutPromise]);
    clearInterval(progressTicker);

    if (hwNames && (hwNames.cpuName || hwNames.gpuName)) {
      const cpuText = (hwNames.cpuName || 'Unknown').slice(0, 28) + (hwNames.cpuName && hwNames.cpuName.length > 28 ? '...' : '');
      const gpuText = (hwNames.gpuName || 'Unknown').slice(0, 28) + (hwNames.gpuName && hwNames.gpuName.length > 28 ? '...' : '');
      const ramText = hwNames.ramTotalGB > 0 ? `${hwNames.ramTotalGB} GB` : 'Unknown';

      windowManager.sendSplashStatus(`Processor: ${cpuText}`);
      windowManager.sendSplashProgress(60);
      await sleep(componentDelay);

      windowManager.sendSplashStatus(`Graphics: ${gpuText}`);
      windowManager.sendSplashProgress(70);
      await sleep(componentDelay);

      windowManager.sendSplashStatus(`Installed Memory: ${ramText}`);
      windowManager.sendSplashProgress(78);
      await sleep(componentDelay);
    } else {
      windowManager.sendSplashStatus('Hardware detected');
      windowManager.sendSplashProgress(78);
    }
  } catch (err) {
    clearInterval(progressTicker);
    console.error('[MAIN] LHM hardware names failed', err);
    windowManager.sendSplashStatus('Hardware detected');
    windowManager.sendSplashProgress(78);
    await sleep(300);
  }

  windowManager.sendSplashStatus('Verifying system state...');
  windowManager.sendSplashProgress(82);

  windowManager.createWindow();
  // Sync minimize-to-tray preference with windowManager and create tray if enabled
  windowManager.setMinimizeToTray(_minimizeToTray);
  if (_minimizeToTray) _createTray();

  const appWindow = windowManager.getMainWindow();
  if (appWindow) {
    const setActive = () => hardwareMonitor._setRealtimeWindowActive(true);
    const setInactive = () => hardwareMonitor._setRealtimeWindowActive(false);
    appWindow.on('focus', setActive);
    appWindow.on('restore', setActive);
    appWindow.on('blur', setInactive);
    appWindow.on('minimize', setInactive);
    appWindow.on('hide', setInactive);
  }

  hardwareMonitor._startLatencyPoll();

  overlay.init();

  autoUpdater.initAutoUpdater();

  // ── Splash → Main Window Handshake ────────────────────────────────────────
  const mainWindow = windowManager.getMainWindow();

  const readyToShowPromise = new Promise((resolve) => {
    if (!mainWindow) return resolve();
    mainWindow.once('ready-to-show', resolve);
  });

  const appReadyPromise = new Promise((resolve) => {
    const handler = (event) => {
      if (mainWindow && event.sender && event.sender.id === mainWindow.webContents.id) {
        ipcMain.removeListener('app:ready', handler);
        resolve();
      }
    };
    ipcMain.on('app:ready', handler);
  });

  // Kick off heavy background work while we wait.
  _prewarmScanCaches({ updateSplash: false }).catch(() => { });
  softwareUpdatesPromise.catch(() => { });

  windowManager.sendSplashStatus('Loading interface...');
  windowManager.sendSplashProgress(90);

  hardwareMonitor._startRealtimePush();

  // Smooth ticker 90→99 while waiting for main window readiness
  windowManager.sendSplashStatus('Completing initialization...');
  let uiTickerPct = 90;
  const uiTicker = setInterval(() => {
    if (uiTickerPct < 99) {
      uiTickerPct = Math.min(99, uiTickerPct + 0.8);
      windowManager.sendSplashProgress(Math.round(uiTickerPct));
    }
  }, 80);

  // Block until the main window is fully painted AND React reports ready.
  await Promise.all([readyToShowPromise, appReadyPromise]);

  // Also wait for full hardware info to finish (max 3s so we don't block forever)
  const hwInfoPromise = hardwareInfo.getHwInfoPromise();
  if (hwInfoPromise) {
    await Promise.race([hwInfoPromise, new Promise(r => setTimeout(r, 3000))]);
  }

  clearInterval(uiTicker);

  // Snap to 100% and fade out immediately
  windowManager.sendSplashStatus('Initialization complete');
  windowManager.sendSplashProgress(100);

  // Brief pause at 100% so user sees it
  await new Promise(r => setTimeout(r, 250));

  // Trigger smooth fade-out via splash:done IPC
  const splashWin = windowManager.getSplashWindow();
  if (splashWin && !splashWin.isDestroyed()) {
    const fadePromise = new Promise((resolve) => {
      const handler = () => {
        ipcMain.removeListener('splash:fade-complete', handler);
        resolve();
      };
      ipcMain.on('splash:fade-complete', handler);
      // Safety timeout in case animation/IPC fails
      setTimeout(resolve, 1200);
    });

    splashWin.webContents.send('splash:done');
    await fadePromise;

    if (!splashWin.isDestroyed()) {
      splashWin.close();
    }
  }

  // Show main window immediately after splash fades out
  const win = windowManager.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }

  // ── Privacy & Silent Ad-Blocking (Suppress Terminal Noise) ──────────────────
  const { session } = require('electron');
  const BLOCK_LIST = [
    'nexx360.io', 'pubmatic.com', 'smilewanted.com', 'missena.io',
    'scorecardresearch.com', 'doubleclick.net', 'google-analytics.com',
    'amazon-adsystem.com', 'adnxs.com', 'casalemedia.com', 'openx.net',
    'rubiconproject.com', 'criteo.com', 'outbrain.com', 'taboola.com',
    'pubmatic.com', 'media.net', 'advertising.com', 'yieldmo.com'
  ];

  function handleWebRequest(details, callback) {
    const url = details.url.toLowerCase();
    const isTracker = BLOCK_LIST.some(domain => url.includes(domain));

    if (isTracker && details.resourceType !== 'mainFrame') {
      // Use cancel: true specifically for these trackers to avoid UNSAFE_REDIRECT logs
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  }

  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, handleWebRequest);
  
  const speedtestSession = session.fromPartition('persist:speedtest');
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  
  speedtestSession.setUserAgent(CHROME_UA);
  
  // Apply the ad-blocker to the speedtest session
  speedtestSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, handleWebRequest);
  
  // Strip X-Requested-With to prevent Cloudflare/bot detection
  speedtestSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    delete details.requestHeaders['X-Requested-With'];
    callback({ requestHeaders: details.requestHeaders });
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────────
function _cleanupAndExit() {
  _destroyTray();
  hardwareMonitor._stopRealtimePush();
  hardwareMonitor.stopLHMService();
  hardwareMonitor._stopPerfCounterService();
  hardwareMonitor.clearDiskRefreshTimer();
}

app.on('before-quit', () => {
  _cleanupAndExit();
});

app.on('window-all-closed', () => {
  _cleanupAndExit();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windowManager.getMainWindow() === null) {
    windowManager.createWindow();
  }
});

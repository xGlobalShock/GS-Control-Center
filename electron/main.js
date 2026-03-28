const { app, BrowserWindow, ipcMain } = require('electron');
const { execSync } = require('child_process');
const path = require('path');

// ── Modules ─────────────────────────────────────────────────────────────────
const windowManager       = require('../main-process/windowManager');
const autoUpdater         = require('../main-process/autoUpdater');
const hardwareMonitor     = require('../main-process/hardwareMonitor');
const hardwareInfo        = require('../main-process/hardwareInfo');
const cleaners            = require('../main-process/cleaners');
const tweaks              = require('../main-process/tweaks');
const obsPresets          = require('../main-process/obsPresets');
const softwareUpdates     = require('../main-process/softwareUpdates');
const appInstaller        = require('../main-process/appInstaller');
const appUninstaller      = require('../main-process/appUninstaller');
const gameProfiles        = require('../main-process/gameProfiles');
const network             = require('../main-process/network');
const windowsDebloat      = require('../main-process/windowsDebloat');
const spaceAnalyzer       = require('../main-process/spaceAnalyzer');
const { execAsync }       = require('../main-process/utils');

// ── Rendering Pipeline ──────────────────────────────────────────────────────
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('userData'), 'Cache'));
app.commandLine.appendSwitch('gpu-disk-cache-dir', path.join(app.getPath('userData'), 'GPUCache'));

// ── GPU status tracking ─────────────────────────────────────────────────────
let _gpuStatus = { status: 'active', renderer: 'SwiftShader', detail: 'Initializing…' };

ipcMain.handle('gpu:get-status', () => _gpuStatus);

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

// ── Pre-warm scan caches (orchestrator) ─────────────────────────────────────
async function _prewarmScanCaches() {
  // 1. Pre-warm registry display names
  // Fire and forget since it's very fast
  appInstaller.getRegistryDisplayNames().catch(() => new Set());

  // 3. Pre-warm winget list cache
  windowManager.sendSplashStatus('Loading applications library...');
  windowManager.sendSplashProgress(60);
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
  } catch {}

  // 4. Match local applications
  windowManager.sendSplashStatus('Verifying application states...');
  windowManager.sendSplashProgress(75);
  try {
    const result = await appInstaller.checkInstalledImpl(appInstaller.APP_CATALOG_APPS);
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('appinstall:preloaded', result);
    }
  } catch {}

  // 5. Pre-load Windows Debloat components
  windowManager.sendSplashStatus('Loading Windows features...');
  windowManager.sendSplashProgress(80);
  try {
    const result = await windowsDebloat.handlePreloadAll();
    if (result && result.success && result.data) {
      const win = windowManager.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('wdebloat:preloaded', result.data);
      }
    }
  } catch {}
}

// ── Main app.on('ready') ────────────────────────────────────────────────────
app.on('ready', async () => {
  windowManager.createSplashWindow();

  const splash = windowManager.getSplashWindow();
  if (splash && !splash.isDestroyed()) {
    splash.webContents.on('did-finish-load', () => {
      splash.webContents.send('splash:version', app.getVersion());
    });
  }

  windowManager.sendSplashStatus('Checking for updates...');
  windowManager.sendSplashProgress(5);
  try {
    const result = await softwareUpdates.checkSoftwareUpdatesImpl();
    softwareUpdates.setSoftwareUpdatesCache(result);
  } catch {}

  windowManager.sendSplashStatus('Initializing core services...');
  windowManager.sendSplashProgress(10);

  // Enable winget InstallerHashOverride (requires admin)
  if (isElevated) {
    try { execSync('winget settings --enable InstallerHashOverride', { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch {}
  }

  windowManager.sendSplashStatus('Loading hardware sensors...');
  windowManager.sendSplashProgress(15);

  hardwareMonitor.startLHMService();

  windowManager.sendSplashStatus('Loading performance metrics...');
  windowManager.sendSplashProgress(25);

  hardwareMonitor._startPerfCounterService();
  hardwareMonitor._startDiskRefresh();
  hardwareMonitor._startRamCacheRefresh();

  windowManager.sendSplashStatus('Discovering system hardware...');
  windowManager.sendSplashProgress(40);

  hardwareInfo.initHardwareInfo();
  try {
    const hwPromise = hardwareInfo.getHwInfoPromise();
    if (hwPromise) await hwPromise;
  } catch {}

  windowManager.sendSplashStatus('Preparing user interface...');
  windowManager.sendSplashProgress(55);

  windowManager.createWindow();
  hardwareMonitor._startLatencyPoll();
  const prewarmPromise = _prewarmScanCaches();

  autoUpdater.initAutoUpdater();

  const mainWindow = windowManager.getMainWindow();
  await new Promise((resolve) => {
    mainWindow.webContents.on('did-finish-load', resolve);
    setTimeout(resolve, 8000);
  });

  await prewarmPromise;

  windowManager.sendSplashStatus('Finalizing setup...');
  windowManager.sendSplashProgress(85);

  hardwareMonitor._startRealtimePush();

  await new Promise(r => setTimeout(r, 600));

  windowManager.sendSplashProgress(100);
  windowManager.sendSplashStatus('Ready');

  const splashWin = windowManager.getSplashWindow();
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send('splash:done');
  }

  await new Promise(r => setTimeout(r, 700));

  const win = windowManager.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }

  const splashFinal = windowManager.getSplashWindow();
  if (splashFinal && !splashFinal.isDestroyed()) {
    splashFinal.close();
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  hardwareMonitor._stopRealtimePush();
  hardwareMonitor.stopLHMService();
  hardwareMonitor._stopPerfCounterService();
  hardwareMonitor.clearDiskRefreshTimer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windowManager.getMainWindow() === null) {
    windowManager.createWindow();
  }
});

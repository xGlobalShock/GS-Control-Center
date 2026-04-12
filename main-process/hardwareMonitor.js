const { ipcMain } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const si = require('systeminformation');
const { runPSScript } = require('./utils');
const windowManager = require('./windowManager');

// ── Sidecar state ──
let _sidecarProcess = null;
let _sidecarData = null;       // Latest parsed JSON from sidecar
let _sidecarReady = false;
let _sidecarRestartCount = 0;
const MAX_SIDECAR_RESTARTS = 5;

// ── Hardware identity (for splash screen) ──
let _hwNames = null;
let _hwNamesResolve = null;
const _hwNamesPromise = new Promise((resolve) => { _hwNamesResolve = resolve; });

function getLhmHardwareNamesPromise() { return _hwNamesPromise; }

// ── Hardware info from sidecar (replaces PowerShell in hardwareInfo.js) ──
let _hwInfoFromSidecar = null;
let _hwInfoSidecarResolve = null;
const _hwInfoSidecarPromise = new Promise((resolve) => { _hwInfoSidecarResolve = resolve; });

function getHwInfoFromSidecarPromise() { return _hwInfoSidecarPromise; }
function getHwInfoFromSidecar() { return _hwInfoFromSidecar; }



// ── GPU Fan persistence ──
function _getFanSettingPath() {
  try { return path.join(app.getPath('userData'), 'gs_fan_setting.json'); }
  catch { return path.join(os.tmpdir(), 'gs_fan_setting.json'); }
}

function _saveFanSetting(speed) {
  try {
    const mode = speed === 0 ? 'auto' : 'manual';
    fs.writeFileSync(_getFanSettingPath(), JSON.stringify({ mode, speed }), 'utf8');
  } catch { }
}

function _loadFanSetting() {
  try {
    const raw = fs.readFileSync(_getFanSettingPath(), 'utf8');
    return JSON.parse(raw); // { mode: 'auto'|'manual', speed: 0-100 }
  } catch { }
  return { mode: 'auto', speed: 0 };
}

function _restoreFanSetting() {
  const setting = _loadFanSetting();
  if (setting.mode === 'manual' && setting.speed > 0) {
    if (_sidecarProcess && _sidecarProcess.stdin && !_sidecarProcess.stdin.destroyed) {
      try {
        _sidecarProcess.stdin.write(JSON.stringify({ type: 'set-fan', speed: setting.speed }) + '\n');
      } catch { }
    }
  }
}

// ── WiFi / adapter state (JS-side periodic poll) ──
let _rtLastSsid = '';
let _rtLastWifiSignal = -1;
let _rtLastAdapterName = '';
let _rtLastAdapterLinkSpeed = '';
let _rtLastLocalIP = '';
let _rtLastMac = '';
let _rtLastGateway = '';

// ── RAM cached — now provided natively by sidecar via GetPerformanceInfo ──
// (no more PowerShell WMI polling needed)

// ── Realtime push state ──
let _realtimeTimer = null;
let _realtimeWifiTimer = null;
let _realtimePushTick = null;

// ── Adaptive intervals ──
const INTERVALS_ACTIVE = {
  realtimePush: 500,
  wifiPoll: 5000,
};
const INTERVALS_IDLE = {
  realtimePush: 5000,
  wifiPoll: 30000,
};

let _rtWindowActive = true;
let _wifiFetchFn = null;

// ── Sidecar log ──
let _sidecarLogPath = null;


// ═══════════════════════════════════════════════════════════════════════════════
// Sidecar Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

function _getSidecarExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'GCMonitor.exe');
  }
  // Development: try published output first, then debug build, then public fallback
  const rootDir = windowManager.getRootDir();
  const publishPath = path.join(rootDir, 'native-monitor', 'bin', 'Release', 'net8.0-windows', 'win-x64', 'publish', 'GCMonitor.exe');
  if (fs.existsSync(publishPath)) return publishPath;
  const publicPath = path.join(rootDir, 'public', 'native-monitor', 'GCMonitor.exe');
  if (fs.existsSync(publicPath)) return publicPath;
  const debugPath = path.join(rootDir, 'native-monitor', 'bin', 'Debug', 'net8.0-windows', 'win-x64', 'GCMonitor.exe');
  if (fs.existsSync(debugPath)) return debugPath;
  return publishPath; // Will fail with clear error
}

function _getDriversDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'drivers', 'pawnio');
  }
  return path.join(windowManager.getRootDir(), 'public', 'drivers', 'pawnio');
}

function startLHMService() {
  const exePath = _getSidecarExePath();
  if (!fs.existsSync(exePath)) {
    console.error(`[HardwareMonitor] Sidecar not found at: ${exePath}`);
    console.error('[HardwareMonitor] Build it with: cd native-monitor && dotnet publish -c Release');
    // Resolve hardware names promise so splash doesn't hang
    if (_hwNamesResolve) {
      _hwNamesResolve({ cpuName: '', gpuName: '', ramTotalGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)) });
      _hwNamesResolve = null;
    }
    return;
  }

  _spawnSidecar(exePath);
}

function _spawnSidecar(exePath) {
  if (_sidecarProcess) return;

  _sidecarLogPath = path.join(os.tmpdir(), 'gs_monitor_diag.log');
  fs.writeFile(_sidecarLogPath, `Sidecar started at ${new Date().toISOString()}\nPath: ${exePath}\n`, 'utf8', () => {});

  _sidecarProcess = spawn(exePath, ['--drivers', _getDriversDir()], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  _sidecarProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const obj = JSON.parse(trimmed);

        if (obj.type === 'init') {
          _hwNames = {
            cpuName: obj.cpuName || '',
            gpuName: obj.gpuName || '',
            ramTotalGB: obj.ramTotalGB || 0,
          };
          if (_hwNamesResolve) {
            _hwNamesResolve(_hwNames);
            _hwNamesResolve = null;
          }
        } else if (obj.type === 'data') {
          _sidecarData = obj;
          // Sidecar is healthy — reset restart counter
          if (_sidecarRestartCount > 0) _sidecarRestartCount = 0;
          if (!_sidecarReady) {
            _sidecarReady = true;
            // First data tick — sidecar has discovered fan control handle, restore user's setting
            _restoreFanSetting();
          }
        } else if (obj.type === 'hwinfo') {
          _hwInfoFromSidecar = obj;
          if (_hwInfoSidecarResolve) {
            _hwInfoSidecarResolve(obj);
            _hwInfoSidecarResolve = null;
          }
          // Also resolve the splash hardware-names promise early using WMI data
          // from the hwinfo message (arrives in ~1-2s, well before LHM init finishes)
          if (_hwNamesResolve && (obj.cpuName || obj.gpuName)) {
            _hwNames = {
              cpuName: obj.cpuName || '',
              gpuName: obj.gpuName || '',
              ramTotalGB: obj.ramTotalGB || Math.round(os.totalmem() / (1024 * 1024 * 1024)),
            };
            _hwNamesResolve(_hwNames);
            _hwNamesResolve = null;
          }
        } else if (obj.type === 'hwinfo-update') {
          // Merge partial updates into the existing hwinfo
          if (_hwInfoFromSidecar) {
            Object.assign(_hwInfoFromSidecar, obj);
          }
          // Push incremental update to renderer
          const mainWindow = windowManager.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            const partial = { ...obj };
            delete partial.type;
            mainWindow.webContents.send('hw-info-update', partial);
          }
        }
      } catch {
        // Non-JSON line — ignore
      }
    }
  });

  // Buffer stderr lines and flush async to avoid blocking the event loop
  // every time the sidecar emits a diagnostic message.
  let _stderrBuf = '';
  let _stderrTimer = null;
  _sidecarProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg) return;
    _stderrBuf += msg + '\n';
    if (!_stderrTimer) {
      _stderrTimer = setTimeout(() => {
        _stderrTimer = null;
        const toWrite = _stderrBuf;
        _stderrBuf = '';
        fs.appendFile(_sidecarLogPath, toWrite, 'utf8', () => {});
      }, 250);
    }
  });

  _sidecarProcess.on('exit', (code) => {
    // Clear stderr flush timer to prevent leaked timers
    if (_stderrTimer) { clearTimeout(_stderrTimer); _stderrTimer = null; }
    // Remove all listeners from the dying process before nulling ref
    try { _sidecarProcess.removeAllListeners(); } catch {}
    try { _sidecarProcess.stdout.removeAllListeners(); } catch {}
    try { _sidecarProcess.stderr.removeAllListeners(); } catch {}
    _sidecarProcess = null;

    if (code === 0) {
      // Graceful exit — reset restart counter
      _sidecarRestartCount = 0;
    } else if (_sidecarRestartCount < MAX_SIDECAR_RESTARTS) {
      _sidecarRestartCount++;
      console.warn(`[HardwareMonitor] Sidecar exited with code ${code}, restarting (${_sidecarRestartCount}/${MAX_SIDECAR_RESTARTS})...`);
      setTimeout(() => _spawnSidecar(exePath), 2000);
    } else {
      console.error(`[HardwareMonitor] Sidecar failed after ${MAX_SIDECAR_RESTARTS} restarts`);
    }
  });

  _sidecarProcess.on('error', (err) => {
    console.error('[HardwareMonitor] Sidecar spawn error:', err.message);
    _sidecarProcess = null;
  });
}

function stopLHMService() {
  if (_sidecarProcess) {
    try {
      // Close stdin to signal graceful shutdown
      _sidecarProcess.stdin.end();
      // Give it 2 seconds to shut down gracefully, then kill
      const killTimeout = setTimeout(() => {
        try { _sidecarProcess?.kill(); } catch { }
      }, 2000);
      _sidecarProcess.on('exit', () => clearTimeout(killTimeout));
    } catch {
      try { _sidecarProcess.kill(); } catch { }
    }
    _sidecarProcess = null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// WiFi / Adapter Poll (low-frequency, not realtime-critical)
// ═══════════════════════════════════════════════════════════════════════════════

function _startWifiPoll() {
  if (_realtimeWifiTimer) return;
  const fetchAdapter = async () => {
    try {
      const defaultIface = await si.networkInterfaceDefault();
      const ifaces = await si.networkInterfaces();
      const ifaceArr = Array.isArray(ifaces) ? ifaces : [ifaces];
      const defaultNet = ifaceArr.find(i => i.iface === defaultIface);

      if (defaultNet) {
        _rtLastAdapterName = defaultNet.iface || '';
        _rtLastAdapterLinkSpeed = defaultNet.speed ? `${defaultNet.speed} Mbps` : '';
        _rtLastLocalIP = defaultNet.ip4 || '';
        _rtLastMac = defaultNet.mac || '';
        try {
          const gw = await si.networkGatewayDefault();
          _rtLastGateway = gw || '';
        } catch { _rtLastGateway = ''; }

        const isWifiDefault = defaultNet.type === 'wireless' || /wi-?fi|wireless|wlan/i.test(defaultNet.iface);
        if (isWifiDefault) {
          const conns = await si.wifiConnections();
          if (conns && conns.length > 0) {
            _rtLastSsid = conns[0].ssid || '';
            _rtLastWifiSignal = conns[0].quality ?? -1;
          } else {
            _rtLastSsid = '';
            _rtLastWifiSignal = -1;
          }
        } else {
          _rtLastSsid = '';
          _rtLastWifiSignal = -1;
        }
      } else {
        _rtLastAdapterName = '';
        _rtLastAdapterLinkSpeed = '';
        _rtLastLocalIP = '';
        _rtLastMac = '';
        _rtLastGateway = '';
        _rtLastSsid = '';
        _rtLastWifiSignal = -1;
      }
    } catch {
      _rtLastSsid = '';
      _rtLastWifiSignal = -1;
    }
  };
  _wifiFetchFn = fetchAdapter;
  fetchAdapter();
  _realtimeWifiTimer = setInterval(fetchAdapter, _rtWindowActive ? INTERVALS_ACTIVE.wifiPoll : INTERVALS_IDLE.wifiPoll);
}


// RAM cache is now provided natively by sidecar (GetPerformanceInfo)
function _startRamCacheRefresh() { /* No-op — sidecar provides ramCachedGB via GetPerformanceInfo */ }


// ═══════════════════════════════════════════════════════════════════════════════
// Stats Snapshot (for system:get-stats IPC)
// ═══════════════════════════════════════════════════════════════════════════════

function _getStatsImpl() {
  const d = _sidecarData;
  if (!d) {
    // No sidecar data yet — use OS basics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      cpu: 0,
      ram: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 : 0,
      disk: 0,
      temperature: 0,
      lhmReady: false,
      gpuTemp: -1,
      gpuUsage: -1,
      gpuVramUsed: -1,
      gpuVramTotal: -1,
    };
  }

  // Real sensor data only — no estimation or caching
  const temperature = d.temperature >= 0 ? d.temperature : 0;

  return {
    cpu: d.cpu >= 0 ? d.cpu : 0,
    ram: d.ram || 0,
    disk: d.disk || 0,
    temperature,
    lhmReady: d.lhmReady || false,
    gpuTemp: d.gpuTemp ?? -1,
    gpuUsage: d.gpuUsage ?? -1,
    gpuVramUsed: d.gpuVramUsed ?? -1,
    gpuVramTotal: d.gpuVramTotal ?? -1,
  };
}

function _formatUptimeSeconds(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Realtime Push (relay sidecar data to renderer)
// ═══════════════════════════════════════════════════════════════════════════════

async function _startRealtimePush() {
  if (_realtimeTimer) return;

  _startWifiPoll();

  _realtimePushTick = () => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const d = _sidecarData;
    if (!d) return; // No data yet — skip this tick

    // ── Temperature resolution — real sensor data only ──
    const resolvedTemp = d.temperature >= 0 ? d.temperature : 0;
    const tempSource = d.tempSource || 'none';

    const payload = {
      // CPU
      cpu: d.cpu >= 0 ? d.cpu : 0,
      perCoreCpu: d.perCoreCpu || [],
      cpuClock: d.cpuClock >= 0 ? d.cpuClock : 0,
      temperature: resolvedTemp,
      tempSource,
      lhmReady: d.lhmReady || false,
      // GPU
      gpuTemp: d.gpuTemp ?? -1,
      gpuUsage: d.gpuUsage ?? -1,
      gpuVramUsed: d.gpuVramUsed ?? -1,
      gpuVramTotal: d.gpuVramTotal ?? -1,
      gpuClock: d.gpuClock ?? -1,
      gpuFan: d.gpuFan ?? -1,
      gpuFanRpm: d.gpuFanRpm ?? -1,
      gpuPower: d.gpuPower ?? -1,
      gpuMemClock: d.gpuMemClock ?? -1,
      gpuHotSpot: d.gpuHotSpot ?? -1,
      gpuMemTemp: d.gpuMemTemp ?? -1,
      gpuVoltage: d.gpuVoltage ?? -1,
      gpuFanControllable: d.gpuFanControllable || false,
      // CPU extended
      cpuPower: d.cpuPower ?? -1,
      cpuVoltage: d.cpuVoltage ?? -1,
      // RAM
      ram: d.ram || 0,
      ramUsedGB: d.ramUsedGB || 0,
      ramTotalGB: d.ramTotalGB || 0,
      ramAvailableGB: d.ramAvailableGB || 0,
      ramCachedGB: d.ramCachedGB || 0,
      // Disk
      disk: d.disk || 0,
      diskReadSpeed: d.diskReadSpeed || 0,
      diskWriteSpeed: d.diskWriteSpeed || 0,
      diskTemp: d.diskTemp ?? -1,
      diskLife: d.diskLife ?? -1,
      // Network
      networkUp: d.networkUp || 0,
      networkDown: d.networkDown || 0,
      latencyMs: d.latencyMs || 0,
      packetLoss: d.packetLoss ?? -1,
      internetLoss: d.internetLoss ?? -1,
      gatewayLoss: d.gatewayLoss ?? -1,
      gatewayLatency: d.gatewayLatency || 0,
      pingGateway: d.pingGateway || '',
      pingMin: d.pingMin || 0,
      pingMax: d.pingMax || 0,
      pingAvg: d.pingAvg || 0,
      pingJitter: d.pingJitter || 0,
      pingSent: d.pingSent || 0,
      pingRecv: d.pingRecv || 0,
      nicErrors: d.nicErrors || 0,
      nicDiscards: d.nicDiscards || 0,
      // WiFi / Adapter (from JS-side poll)
      ssid: _rtLastSsid,
      wifiSignal: _rtLastWifiSignal,
      activeAdapterName: _rtLastAdapterName,
      activeLinkSpeed: _rtLastAdapterLinkSpeed,
      activeLocalIP: _rtLastLocalIP,
      activeMac: _rtLastMac,
      activeGateway: _rtLastGateway,
      // System
      processCount: d.processCount || 0,
      systemUptime: d.systemUptime || _formatUptimeSeconds(os.uptime()),
      _ts: Date.now(),
    };

    try {
      mainWindow.webContents.send('realtime-hw-update', payload);
    } catch (_) { }

    // Push to overlay
    try {
      const overlay = require('./overlay');
      if (overlay.isVisible()) overlay.pushStatsToOverlay(payload);
    } catch (_) { }
  };

  _realtimeTimer = setInterval(
    _realtimePushTick,
    _rtWindowActive ? INTERVALS_ACTIVE.realtimePush : INTERVALS_IDLE.realtimePush
  );
}

function _stopRealtimePush() {
  if (_realtimeTimer) { clearInterval(_realtimeTimer); _realtimeTimer = null; }
  if (_realtimeWifiTimer) { clearInterval(_realtimeWifiTimer); _realtimeWifiTimer = null; }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Adaptive Intervals (window focus/unfocus)
// ═══════════════════════════════════════════════════════════════════════════════

function _applyAdaptiveIntervals() {
  const intervals = _rtWindowActive ? INTERVALS_ACTIVE : INTERVALS_IDLE;

  if (_realtimeWifiTimer && _wifiFetchFn) {
    clearInterval(_realtimeWifiTimer);
    _realtimeWifiTimer = setInterval(_wifiFetchFn, intervals.wifiPoll);
  }

  if (_realtimeTimer && _realtimePushTick) {
    clearInterval(_realtimeTimer);
    _realtimeTimer = setInterval(_realtimePushTick, intervals.realtimePush);
  }
}

function _setRealtimeWindowActive(active) {
  const wasActive = _rtWindowActive;
  _rtWindowActive = !!active;
  if (wasActive !== _rtWindowActive) {
    _applyAdaptiveIntervals();
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Latency Poll (no-op — sidecar handles ping internally)
// ═══════════════════════════════════════════════════════════════════════════════

function _startLatencyPoll() {
  // No-op: sidecar handles ICMP ping internally
}


// ═══════════════════════════════════════════════════════════════════════════════
// Legacy API Stubs (called from main.js — now handled by sidecar)
// ═══════════════════════════════════════════════════════════════════════════════

function _startPerfCounterService() { /* No-op: sidecar provides CPU metrics */ }
function _stopPerfCounterService() { /* No-op */ }
function _startDiskRefresh() { /* No-op: sidecar provides disk % */ }
function getDiskRefreshTimer() { return null; }
function clearDiskRefreshTimer() { /* No-op */ }


// ═══════════════════════════════════════════════════════════════════════════════
// IPC Registration
// ═══════════════════════════════════════════════════════════════════════════════

function registerIPC() {
  ipcMain.handle('system:get-stats', () => {
    return _getStatsImpl();
  });

  ipcMain.handle('system:start-realtime', () => {
    _startRealtimePush();
    return { success: true };
  });

  ipcMain.handle('system:stop-realtime', () => {
    try {
      const overlay = require('./overlay');
      if (overlay.isVisible()) return { success: true, skipped: 'overlay-active' };
    } catch (_) { }
    _stopRealtimePush();
    return { success: true };
  });

  ipcMain.handle('system:set-realtime-active', (_event, active) => {
    _setRealtimeWindowActive(!!active);
    return { success: true, active: !!active };
  });

  // GPU fan control: speed = 0 for auto, 1-100 for manual %
  ipcMain.handle('system:set-gpu-fan', (_event, speed) => {
    const s = Math.max(0, Math.min(100, Math.round(Number(speed) || 0)));
    // Persist fan setting so it survives app restart
    _saveFanSetting(s);
    if (_sidecarProcess && _sidecarProcess.stdin && !_sidecarProcess.stdin.destroyed) {
      try {
        _sidecarProcess.stdin.write(JSON.stringify({ type: 'set-fan', speed: s }) + '\n');
        return { success: true, speed: s };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'sidecar not running' };
  });

  // Let the renderer read the saved fan setting on mount
  ipcMain.handle('system:get-gpu-fan-setting', () => {
    return _loadFanSetting();
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Module Exports (maintain backward compatibility with main.js)
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  startLHMService,
  stopLHMService,
  getLhmHardwareNamesPromise,
  getHwInfoFromSidecarPromise,
  getHwInfoFromSidecar,
  _startPerfCounterService,
  _stopPerfCounterService,
  _startDiskRefresh,
  _startRamCacheRefresh,
  _startRealtimePush,
  _stopRealtimePush,
  _startLatencyPoll,
  _setRealtimeWindowActive,
  getDiskRefreshTimer,
  clearDiskRefreshTimer,
  registerIPC,
};

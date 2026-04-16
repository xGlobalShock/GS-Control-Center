/**
 * Software Updates Module
 * winget integration for checking/applying software updates.
 *
 * Uses winget CLI for scanning available updates, then downloads
 * installers directly via Node.js HTTP for full real-time progress
 * (MB/total, speed, %) and runs them silently.
 */

const { ipcMain, BrowserWindow, app } = require('electron');
const { spawn, execSync, exec } = require('child_process');
const { execAsync } = require('./utils');
const windowManager = require('./windowManager');
const path = require('path');
const fs = require('fs');
const os = require('os');

class CancelError extends Error {
  constructor() { super('Cancelled'); this.name = 'CancelError'; }
}

// Software updates cache (pre-warmed during splash)
let _softwareUpdatesCache = null;
let _softwareUpdatesCacheTime = 0;
const SOFTWARE_UPDATES_CACHE_TTL = 120000; // 2 min

// Active update state
let activeUpdateProc = null;   // { kill() }

// Display name lookup (keyed by lowercased id)
const _packageNames = new Map();

// Elevation state — needed to de-elevate per-user installers in packaged build
let _isElevated = false;

// Reference to appInstaller's cache invalidation
let _invalidateInstallerCaches = null;

function init({ isElevated, invalidateInstallerCaches }) {
  _isElevated = isElevated;
  _invalidateInstallerCaches = invalidateInstallerCaches;
}

/* ═══════════════════ Scan (winget CLI) ═══════════════════ */

async function _checkSoftwareUpdatesImpl() {
  let stdout = '';
  try {
    const result = await execAsync(
      'chcp 65001 >nul && winget upgrade --include-unknown --accept-source-agreements 2>nul',
      {
        timeout: 45000,
        windowsHide: true,
        encoding: 'utf8',
        shell: 'cmd.exe',
        maxBuffer: 1024 * 1024 * 5,
        env: process.env,
        cwd: process.env.SYSTEMROOT || 'C:\\Windows',
      }
    );
    stdout = result.stdout || '';
  } catch (execErr) {
    if (execErr.stdout) stdout = execErr.stdout;
    else throw execErr;
  }

  const lines = stdout.split('\n').map(l => {
    const parts = l.split('\r').map(p => p.trimEnd()).filter(p => p.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : '';
  }).filter(l => l.length > 0);

  const headerIdx = lines.findIndex(l => /Name\s+Id\s+Version/i.test(l));
  if (headerIdx === -1) return { success: true, packages: [], count: 0 };

  const sepIdx = lines.findIndex((l, i) => i > headerIdx && /^-{10,}/.test(l.trim()));
  if (sepIdx === -1) return { success: true, packages: [], count: 0 };

  const header = lines[headerIdx];
  const nameStart = 0;
  const idStart = header.search(/\bId\b/);
  const versionStart = header.search(/\bVersion\b/);
  const availableStart = header.search(/\bAvailable\b/);
  const sourceStart = header.search(/\bSource\b/);

  const packages = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\d+ upgrades? available/i.test(line.trim())) break;
    if (/^The following/i.test(line.trim())) break;
    if (line.length < idStart + 3) continue;

    const name = line.substring(nameStart, idStart).trim();
    const id = line.substring(idStart, versionStart).trim();
    const rawVersion = versionStart >= 0 && availableStart >= 0
      ? line.substring(versionStart, availableStart).trim() : '';
    const version = rawVersion.replace(/^<\s*/, '');
    const available = availableStart >= 0 && sourceStart >= 0
      ? line.substring(availableStart, sourceStart).trim()
      : availableStart >= 0 ? line.substring(availableStart).trim() : '';
    const source = sourceStart >= 0 ? line.substring(sourceStart).trim() : 'winget';
    const isUnknownVersion = rawVersion.startsWith('<');

    if (name && id && id.includes('.') && !isUnknownVersion) {
      packages.push({ name, id, version, available, source });
      _packageNames.set(id.toLowerCase(), name);
    }
  }

  return { success: true, packages, count: packages.length };
}

async function _checkAllUpdatesImpl() {
  const r = await _checkSoftwareUpdatesImpl();
  return { success: true, packages: r.packages, count: r.packages.length };
}

function getSoftwareUpdatesCache() {
  return { cache: _softwareUpdatesCache, cacheTime: _softwareUpdatesCacheTime };
}

function setSoftwareUpdatesCache(result) {
  _softwareUpdatesCache = result;
  _softwareUpdatesCacheTime = Date.now();
}

/* ═══════════════════ Helpers ═══════════════════ */

function headContentLength(url, redirects = 0) {
  if (redirects > 5) return Promise.resolve(0);
  const mod = url.startsWith('https') ? require('https') : require('http');
  return new Promise(resolve => {
    const req = mod.request(url, { method: 'HEAD', timeout: 8000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(headContentLength(res.headers.location, redirects + 1));
      } else {
        resolve(parseInt(res.headers['content-length'] || '0', 10));
        res.resume();
      }
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end();
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024)       return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function _invalidateCaches() {
  if (_invalidateInstallerCaches) _invalidateInstallerCaches();
}

/* ═══════════════════ Staged installer apps ═══════════════════ */

const _stagedInstallerApps = new Set([
  'anthropic.claude', 'discord.discord', 'slacktechnologies.slack',
  'notion.notion', 'figma.figma', 'spotify.spotify',
]);

const _processNameMap = {
  'anthropic.claude':            ['Claude.exe', 'claude.exe'],
  'spotify.spotify':             ['Spotify.exe'],
  'discord.discord':             ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe'],
  'mikrotik.winbox':             ['winbox.exe', 'winbox64.exe'],
  'mikrotik.winbox.4':           ['winbox.exe', 'winbox64.exe'],
  'telegram.telegramdesktop':    ['Telegram.exe'],
  'microsoft.visualstudiocode':  ['Code.exe'],
  'obsproject.obsstudio':        ['obs64.exe', 'obs32.exe'],
  'zoom.zoom':                   ['Zoom.exe'],
  'notion.notion':               ['Notion.exe'],
  'figma.figma':                 ['Figma.exe'],
  'slacktechnologies.slack':     ['slack.exe'],
  'google.chrome':               ['chrome.exe'],
  'mozilla.firefox':             ['firefox.exe'],
  'brave.brave':                 ['brave.exe'],
  'microsoft.edge':              ['msedge.exe'],
};

/* ═══════════════════ Direct download + silent install ═══════════════════ */

/**
 * Queries winget for installer metadata (URL, type, silent switches).
 */
async function getInstallerInfo(cleanId, signal) {
  const { stdout } = await new Promise((resolve, reject) => {
    const child = exec(
      `chcp 65001 >nul && winget show --id ${cleanId} --architecture x64 --accept-source-agreements 2>nul`,
      { timeout: 15000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe' },
      (err, stdout) => {
        if (signal && signal.cancelled) return reject(new CancelError());
        if (err) return reject(err);
        resolve({ stdout });
      }
    );
    if (signal) {
      signal.abort = () => {
        try { child.kill(); } catch {}
      };
    }
  });

  const urlMatch = stdout.match(/Installer\s+Url:\s*(https?:\/\/\S+)/i);
  if (!urlMatch) throw new Error('Installer URL not found in winget manifest');

  const typeMatch = stdout.match(/Installer\s+Type:\s*(\S+)/i);
  const type = (typeMatch ? typeMatch[1] : 'exe').toLowerCase();

  const silentMatch = stdout.match(/\bSilent(?:WithProgress)?:\s*(.+)/i);
  const silentSwitch = silentMatch ? silentMatch[1].trim() : '';

  const scopeMatch = stdout.match(/Installer\s+Scope:\s*(\S+)/i);
  const scope = (scopeMatch ? scopeMatch[1] : '').toLowerCase();

  return { url: urlMatch[1].trim(), type, silentSwitch, scope };
}

/**
 * Downloads a file via HTTP(S) with redirect following and progress reporting.
 */
function downloadFile(url, destPath, onProgress, signal, redirects = 0) {
  if (redirects > 10) return Promise.reject(new Error('Too many redirects'));
  if (signal.cancelled) return Promise.reject(new CancelError());

  const mod = url.startsWith('https') ? require('https') : require('http');

  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, destPath, onProgress, signal, redirects + 1)
          .then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const bytesTotal = parseInt(res.headers['content-length'] || '0', 10);
      let bytesDownloaded = 0;
      let lastBytes = 0;
      let lastTime = Date.now();
      let emaSpeed = 0;

      const file = fs.createWriteStream(destPath);

      // Update abort to also destroy the file stream
      signal.abort = () => {
        req.destroy();
        file.destroy();
        try { fs.unlinkSync(destPath); } catch {}
      };

      res.on('data', (chunk) => {
        if (signal.cancelled) { req.destroy(); file.destroy(); return; }

        bytesDownloaded += chunk.length;

        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        if (dt >= 0.5) {
          const instantSpeed = (bytesDownloaded - lastBytes) / dt;
          emaSpeed = emaSpeed === 0 ? instantSpeed : emaSpeed * 0.7 + instantSpeed * 0.3;
          lastBytes = bytesDownloaded;
          lastTime = now;
        }

        const percent = bytesTotal > 0 ? Math.round((bytesDownloaded / bytesTotal) * 100) : -1;
        onProgress({ bytesDownloaded, bytesTotal, bytesPerSec: Math.round(emaSpeed), percent });
      });

      res.pipe(file);

      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => { try { fs.unlinkSync(destPath); } catch {} reject(signal.cancelled ? new CancelError() : err); });
      res.on('error', (err) => { file.destroy(); try { fs.unlinkSync(destPath); } catch {} reject(signal.cancelled ? new CancelError() : err); });
    });

    // Set abort immediately so cancel works during connection/redirect phase
    signal.abort = () => {
      req.destroy();
      try { fs.unlinkSync(destPath); } catch {}
    };

    req.on('error', (err) => reject(signal.cancelled ? new CancelError() : err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
  });
}

/**
 * Determines if the installer needs to run as the standard (non-elevated) user.
 * Per-user installers (Squirrel, Spotify, Discord, etc.) fail when run as admin
 * because they write to the logged-in user's AppData, not the admin's.
 */
function needsDeElevation(cleanId, scope) {
  if (scope === 'user') return true;
  if (_stagedInstallerApps.has(cleanId.toLowerCase())) return true;
  return false;
}

/**
 * Builds the command + args for a silent installer.
 */
function buildInstallerCommand(filePath, installerType, silentSwitch) {
  const type = installerType.toLowerCase();

  if (type === 'msi' || type === 'wix') {
    return { cmd: 'msiexec', args: ['/i', filePath, '/quiet', '/norestart'] };
  }
  if (type === 'msix' || type === 'appx') {
    return { cmd: 'powershell', args: ['-NoProfile', '-Command', `Add-AppxPackage -Path "${filePath}"`] };
  }

  let args;
  if (silentSwitch) {
    args = silentSwitch.split(/\s+/);
  } else {
    args = {
      'inno':     ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'],
      'nullsoft': ['/S'],
      'burn':     ['/quiet', '/norestart'],
    }[type] || ['/silent', '/norestart'];
  }
  return { cmd: filePath, args };
}

/**
 * Runs an installer silently. When we're elevated and the installer is per-user,
 * de-elevates via Shell.Application so it runs under the logged-in user's context.
 */
function runSilentInstaller(filePath, installerType, silentSwitch, signal, cleanId, scope) {
  const deElevate = _isElevated && needsDeElevation(cleanId, scope);
  const { cmd, args } = buildInstallerCommand(filePath, installerType, silentSwitch);

  console.log(`[Software Update] runSilentInstaller: elevated=${_isElevated}, deElevate=${deElevate}, cleanId=${cleanId}, scope=${scope}, type=${installerType}, cmd=${cmd}, args=${args.join(' ')}`);

  if (deElevate) {
    return runInstallerDeElevated(cmd, args, signal);
  }
  return runInstallerDirect(cmd, args, signal);
}

/**
 * Spawns installer directly (normal context).
 */
function runInstallerDirect(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });

    signal.abort = () => {
      try { proc.kill('SIGTERM'); } catch {}
      try { spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true }); } catch {}
    };

    const timeout = setTimeout(() => {
      signal.abort();
      reject(new Error('Installer timed out (10 min)'));
    }, 600000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Launches a batch file de-elevated using the Explorer process token.
 * Three fallback methods (same proven approach as appInstaller):
 *   1. CreateProcessWithTokenW using Explorer.exe's medium-integrity token
 *   2. schtasks with /rl LIMITED
 *   3. runas /trustlevel:0x20000
 */
function launchBatDeElevated(batPath) {
  const tmpVbs = batPath + '.vbs';
  fs.writeFileSync(tmpVbs,
    `CreateObject("WScript.Shell").Run "cmd.exe /c """"` + batPath + `""""", 0, True\r\n`, 'utf8');

  // Method 1: Explorer-token via CreateProcessWithTokenW
  try {
    const cs = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public class DeElev {
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool OpenProcessToken(IntPtr h, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool DuplicateTokenEx(IntPtr t, uint a, IntPtr l, int il, int tt, out IntPtr n);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CreateProcessWithTokenW(IntPtr t, int f, string a, string c, uint cf, IntPtr e, string d, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  public static bool Run(string cmd) {
    var exp = Process.GetProcessesByName("explorer");
    if(exp.Length==0) return false;
    IntPtr tok, dup;
    if(!OpenProcessToken(exp[0].Handle, 0x0002, out tok)) return false;
    if(!DuplicateTokenEx(tok, 0x02000000, IntPtr.Zero, 2, 1, out dup)) return false;
    var si = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = 1, wShowWindow = 0 };
    PROCESS_INFORMATION pi;
    return CreateProcessWithTokenW(dup, 0, null, "wscript.exe \\"" + cmd + "\\"", 0x08000000, IntPtr.Zero, null, ref si, out pi);
  }
}
'@ -ErrorAction Stop
[DeElev]::Run('${tmpVbs.replace(/\\/g, '\\\\').replace(/'/g, "''")}')`;
    const res = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cs.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
    if (res === 'True') { console.log('[Software Update] De-elevated via Explorer token'); return true; }
  } catch (e) { console.error('[Software Update] Explorer-token failed:', (e.message || '').substring(0, 200)); }

  // Method 2: schtasks (RunLevel Limited)
  const taskName = `GSSoftwareUpdate_${process.pid}`;
  try {
    execSync(`schtasks /create /tn "${taskName}" /tr "wscript.exe \\"${tmpVbs}\\"" /sc once /st 00:00 /rl LIMITED /f`,
      { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    execSync(`schtasks /run /tn "${taskName}"`,
      { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    console.log('[Software Update] De-elevated via schtasks');
    setTimeout(() => { try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch {} }, 5000);
    return true;
  } catch (e) {
    console.error('[Software Update] schtasks failed:', (e.message || '').substring(0, 200));
    try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch {}
  }

  // Method 3: runas /trustlevel:0x20000
  try {
    const r = require('child_process').spawnSync('runas.exe', ['/trustlevel:0x20000', 'wscript.exe', tmpVbs],
      { windowsHide: true, timeout: 10000 });
    if (!r.error) { console.log('[Software Update] De-elevated via runas /trustlevel'); return true; }
    throw r.error;
  } catch (e) { console.error('[Software Update] runas /trustlevel failed:', (e.message || '').substring(0, 200)); }

  try { fs.unlinkSync(tmpVbs); } catch {}
  return false;
}

/**
 * Launches installer de-elevated using Explorer's medium-integrity token.
 * Uses a wrapper batch script + sentinel file to reliably detect completion.
 */
function runInstallerDeElevated(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const sentinelPath = cmd + '.done';
    const wrapperPath = cmd + '.cmd';
    const argsStr = args.join(' ');
    const batchContent = `@echo off\r\n"${cmd}" ${argsStr}\r\necho %ERRORLEVEL% > "${sentinelPath}"\r\n`;

    try { fs.writeFileSync(wrapperPath, batchContent, 'utf8'); } catch (e) {
      reject(new Error(`Failed to create wrapper script: ${e.message}`));
      return;
    }

    if (!launchBatDeElevated(wrapperPath)) {
      try { fs.unlinkSync(wrapperPath); } catch {}
      reject(new Error('Could not de-elevate the installer process.'));
      return;
    }

    signal.abort = () => {
      try { spawn('taskkill', ['/F', '/IM', path.basename(cmd)], { windowsHide: true }); } catch {}
      try { fs.unlinkSync(wrapperPath); } catch {}
      try { fs.unlinkSync(sentinelPath); } catch {}
    };

    // Poll for the sentinel file — created only after installer fully exits
    pollSentinelFile(sentinelPath, wrapperPath, signal, resolve, reject);
  });
}

/**
 * Polls for a sentinel file created by the wrapper batch script.
 * The sentinel contains the installer's exit code.
 */
function pollSentinelFile(sentinelPath, wrapperPath, signal, resolve, reject) {
  const startTime = Date.now();
  const maxWait = 600000; // 10 min

  const check = () => {
    if (signal.cancelled) {
      cleanup();
      resolve({ exitCode: -1 });
      return;
    }
    if (Date.now() - startTime > maxWait) {
      cleanup();
      reject(new Error('Installer timed out (10 min)'));
      return;
    }

    if (fs.existsSync(sentinelPath)) {
      let exitCode = 0;
      try {
        const content = fs.readFileSync(sentinelPath, 'utf8').trim();
        exitCode = parseInt(content, 10) || 0;
      } catch {}
      cleanup();
      resolve({ exitCode });
    } else {
      setTimeout(check, 2000);
    }
  };

  const cleanup = () => {
    try { fs.unlinkSync(wrapperPath); } catch {}
    try { fs.unlinkSync(sentinelPath); } catch {}
  };

  // Give the wrapper script a moment to start before polling
  setTimeout(check, 3000);
}

/* ═══════════════════ IPC Registration ═══════════════════ */

function registerIPC() {

  ipcMain.handle('software:check-updates', async (_event, forceRefresh) => {
    if (!forceRefresh && _softwareUpdatesCache && (Date.now() - _softwareUpdatesCacheTime) < SOFTWARE_UPDATES_CACHE_TTL) {
      return _softwareUpdatesCache;
    }
    try {
      const result = await _checkAllUpdatesImpl();
      _softwareUpdatesCache = result;
      _softwareUpdatesCacheTime = Date.now();
      return result;
    } catch (error) {
      return { success: false, message: `Failed to check updates: ${error.message}`, packages: [], count: 0 };
    }
  });

  ipcMain.handle('software:get-package-size', async (_event, packageId) => {
    const cleanId = String(packageId).replace(/[^\x20-\x7E]/g, '').trim();
    try {
      const { stdout } = await execAsync(
        `chcp 65001 >nul && winget show --id ${cleanId} --accept-source-agreements 2>nul`,
        { timeout: 15000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe' }
      );
      const urlMatch = stdout.match(/Installer\s+Url:\s*(https?:\/\/\S+)/i);
      if (!urlMatch) return { id: cleanId, size: '', bytes: 0 };
      const bytes = await headContentLength(urlMatch[1].trim());
      return { id: cleanId, size: formatBytes(bytes), bytes };
    } catch (e) {
      return { id: cleanId, size: '', bytes: 0 };
    }
  });

  ipcMain.handle('software:cancel-update', async () => {
    if (activeUpdateProc) {
      activeUpdateProc.kill();
      activeUpdateProc = null;
      return { success: true };
    }
    return { success: false, message: 'No active update' };
  });

  ipcMain.handle('software:update-app', async (_event, packageId) => {
    const cleanId = String(packageId).replace(/[^\x20-\x7E]/g, '').trim();
    const win = windowManager.getMainWindow() || BrowserWindow.getAllWindows()[0];
    const packageName = _packageNames.get(cleanId.toLowerCase()) || cleanId;

    const sendProgress = (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('software:update-progress', { packageId: cleanId, packageName, ...data });
      }
    };

    const signal = { cancelled: false, abort: null };
    activeUpdateProc = {
      kill: () => {
        signal.cancelled = true;
        if (signal.abort) signal.abort();
      },
    };

    const ext = cleanId.replace(/[^a-zA-Z0-9]/g, '_');
    let tempPath = null;

    try {
      // 1. Kill running processes
      const names = _processNameMap[cleanId.toLowerCase()];
      if (names && names.length) {
        sendProgress({ phase: 'preparing', status: 'Closing app before update...', percent: -1 });
        for (const name of names) {
          try { execSync(`taskkill /F /IM "${name}" /T`, { stdio: 'ignore', windowsHide: true }); } catch {}
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      if (signal.cancelled) throw new CancelError();

      // 2. Get installer info from winget
      sendProgress({ phase: 'preparing', status: 'Getting installer info...', percent: 0 });
      const info = await getInstallerInfo(cleanId, signal);
      console.log(`[Software Update] ${cleanId}: type=${info.type}, url=${info.url.substring(0, 100)}`);
      if (signal.cancelled) throw new CancelError();

      // 3. Download installer with full progress
      const fileExt = (info.type === 'msi' || info.type === 'wix') ? '.msi'
        : (info.type === 'msix' || info.type === 'appx') ? '.msix'
        : '.exe';
      tempPath = path.join(os.tmpdir(), `gs_update_${ext}_${Date.now()}${fileExt}`);

      sendProgress({ phase: 'downloading', status: 'Downloading', percent: 0 });
      await downloadFile(info.url, tempPath, (p) => {
        sendProgress({
          phase: 'downloading',
          status: 'Downloading',
          percent: p.percent,
          bytesDownloaded: p.bytesDownloaded,
          bytesTotal: p.bytesTotal,
          bytesPerSec: p.bytesPerSec,
        });
      }, signal);
      if (signal.cancelled) throw new CancelError();

      // 4. Run silent installer (de-elevates per-user installers when elevated)
      sendProgress({ phase: 'installing', status: 'Installing...', percent: -1 });
      const result = await runSilentInstaller(tempPath, info.type, info.silentSwitch, signal, cleanId, info.scope);
      if (signal.cancelled) throw new CancelError();

      // 5. Handle result
      if (result.exitCode !== 0 && result.exitCode !== 3010) {
        throw new Error(`Installer exited with code ${result.exitCode}`);
      }

      _invalidateCaches();
      const isStagedInstaller = _stagedInstallerApps.has(cleanId.toLowerCase());

      if (isStagedInstaller || result.exitCode === 3010) {
        sendProgress({ phase: 'done', status: 'Updated — relaunch to finish', percent: 100 });
        return {
          success: true,
          message: `${packageName} updated — relaunch ${packageName} to finish installing`,
          needsRestart: true,
        };
      }

      sendProgress({ phase: 'done', status: 'Update complete!', percent: 100 });
      return { success: true, message: `${cleanId} updated successfully` };

    } catch (err) {
      if (signal.cancelled || err instanceof CancelError) {
        sendProgress({ phase: 'error', status: 'Update Canceled', percent: 0 });
        return { success: false, cancelled: true, message: 'Update Canceled' };
      }

      const msg = (err.message || 'Update failed').substring(0, 200);
      console.error(`[Software Update] ${cleanId} failed: ${msg}`);
      sendProgress({ phase: 'error', status: msg, percent: 0 });
      return { success: false, message: msg };

    } finally {
      activeUpdateProc = null;
      if (tempPath) { try { fs.unlinkSync(tempPath); } catch {} }
    }
  });

} // end registerIPC

module.exports = {
  init,
  checkSoftwareUpdatesImpl: _checkAllUpdatesImpl,
  getSoftwareUpdatesCache,
  setSoftwareUpdatesCache,
  registerIPC,
};

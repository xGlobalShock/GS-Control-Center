/**
 * Software Updates Module
 * winget integration for checking/applying software updates.
 *
 * Uses winget CLI for scanning available updates, then downloads
 * installers directly via Node.js HTTP for full real-time progress
 * (MB/total, speed, %) and runs them silently.
 */

const { ipcMain, BrowserWindow, app } = require('electron');
const { spawn, execSync } = require('child_process');
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
async function getInstallerInfo(cleanId) {
  const { stdout } = await execAsync(
    `chcp 65001 >nul && winget show --id ${cleanId} --architecture x64 --accept-source-agreements 2>nul`,
    { timeout: 15000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe' }
  );

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
      file.on('error', (err) => { try { fs.unlinkSync(destPath); } catch {} reject(err); });
      res.on('error', (err) => { file.destroy(); try { fs.unlinkSync(destPath); } catch {} reject(err); });
    });

    req.on('error', reject);
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
 * Launches installer de-elevated via Shell.Application COM.
 * This runs the installer under the logged-in user (not admin), which is
 * required for per-user installers (Squirrel/NSIS apps that write to AppData).
 */
function runInstallerDeElevated(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const argsStr = args.map(a => a.replace(/'/g, "''")).join(' ');
    const cmdEscaped = cmd.replace(/'/g, "''");

    console.log(`[Software Update] De-elevating installer: cmd=${cmd}, args=${argsStr}`);

    // Shell.Application.ShellExecute launches through Explorer as the standard user
    const psCmd = `$s = New-Object -ComObject Shell.Application; $s.ShellExecute('${cmdEscaped}', '${argsStr}', '', 'open', 0)`;

    const ps = spawn('powershell', ['-NoProfile', '-Command', psCmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let psStderr = '';
    ps.stderr.on('data', (c) => { psStderr += c.toString(); });
    ps.stdout.on('data', () => {});

    // Shell.Application returns immediately (fire-and-forget), so we poll
    // for the installer process to finish by checking if cmd is still running.
    // For EXE installers, poll for the process. For msiexec, poll for msiexec.
    const exeName = path.basename(cmd);

    ps.on('close', (code) => {
      if (code !== 0 && psStderr.trim()) {
        reject(new Error(`De-elevated launch failed: ${psStderr.trim().substring(0, 200)}`));
        return;
      }

      // Wait for the installer to start, then poll until it finishes
      setTimeout(() => pollInstallerExit(exeName, signal, resolve, reject), 2000);
    });

    signal.abort = () => {
      try { ps.kill(); } catch {}
      try { spawn('taskkill', ['/F', '/IM', path.basename(cmd)], { windowsHide: true }); } catch {}
    };
  });
}

/**
 * Polls for an installer process to exit (used after de-elevated launch).
 */
function pollInstallerExit(exeName, signal, resolve, reject) {
  const startTime = Date.now();
  const maxWait = 600000; // 10 min

  const check = () => {
    if (signal.cancelled) { resolve({ exitCode: -1 }); return; }
    if (Date.now() - startTime > maxWait) { reject(new Error('Installer timed out (10 min)')); return; }

    try {
      // tasklist returns exit code 0 if process found, 1 if not
      execSync(`tasklist /FI "IMAGENAME eq ${exeName}" /NH 2>nul | findstr /I "${exeName}" >nul 2>nul`, {
        windowsHide: true, stdio: 'ignore', shell: 'cmd.exe',
      });
      // Process still running — check again in 2s
      setTimeout(check, 2000);
    } catch {
      // Process not found — installer finished
      resolve({ exitCode: 0 });
    }
  };

  check();
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
    const win = windowManager.getMainWindow() || BrowserWindow.getAllWindows()[0];
    if (activeUpdateProc) {
      activeUpdateProc.kill();
      activeUpdateProc = null;
      if (win && !win.isDestroyed()) {
        win.webContents.send('software:update-progress', {
          packageId: '__cancelled__', packageName: '', phase: 'error',
          status: 'Update cancelled', percent: 0,
        });
      }
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
      const info = await getInstallerInfo(cleanId);
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
        sendProgress({ phase: 'error', status: 'Update cancelled', percent: 0 });
        return { success: false, cancelled: true, message: 'Update cancelled' };
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

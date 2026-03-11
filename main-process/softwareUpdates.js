/**
 * Software Updates Module
 * winget integration for checking/applying software updates.
 */

const { ipcMain, BrowserWindow } = require('electron');
const { spawn, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execAsync } = require('./utils');
const windowManager = require('./windowManager');

let _isElevated = false;

// Software updates cache (pre-warmed during splash)
let _softwareUpdatesCache = null;
let _softwareUpdatesCacheTime = 0;
const SOFTWARE_UPDATES_CACHE_TTL = 120000; // 2 min

// Active update state
let activeUpdateProc = null;
let cancelledUpdatePids = new Set();
let updateAllCancelled = false;
let activeDeElevated = null; // { taskName, pollInterval, tmpBat, tmpVbs, tmpLog, resolve }

// Reference to appInstaller's cache invalidation (set via init)
let _invalidateInstallerCaches = null;

function init({ isElevated, invalidateInstallerCaches }) {
  _isElevated = isElevated;
  _invalidateInstallerCaches = invalidateInstallerCaches;
}

// Check for outdated apps via winget
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
    if (execErr.stdout) {
      stdout = execErr.stdout;
    } else {
      throw execErr;
    }
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
      ? line.substring(versionStart, availableStart).trim()
      : '';
    const version = rawVersion.replace(/^<\s*/, '');
    const available = availableStart >= 0 && sourceStart >= 0
      ? line.substring(availableStart, sourceStart).trim()
      : availableStart >= 0
        ? line.substring(availableStart).trim()
        : '';
    const source = sourceStart >= 0 ? line.substring(sourceStart).trim() : 'winget';

    const isUnknownVersion = rawVersion.startsWith('<');

    if (name && id && id.includes('.') && !isUnknownVersion) {
      packages.push({ name, id, version, available, source });
    }
  }

  return { success: true, packages, count: packages.length };
}

function getSoftwareUpdatesCache() {
  return { cache: _softwareUpdatesCache, cacheTime: _softwareUpdatesCacheTime };
}

function setSoftwareUpdatesCache(result) {
  _softwareUpdatesCache = result;
  _softwareUpdatesCacheTime = Date.now();
}

// Helper: follow redirects and get Content-Length via HEAD request
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
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function _invalidateCaches() {
  if (_invalidateInstallerCaches) _invalidateInstallerCaches();
}

function registerIPC() {

  ipcMain.handle('software:check-updates', async (_event, forceRefresh) => {
    if (!forceRefresh && _softwareUpdatesCache && (Date.now() - _softwareUpdatesCacheTime) < SOFTWARE_UPDATES_CACHE_TTL) {
      return _softwareUpdatesCache;
    }
    try {
      const result = await _checkSoftwareUpdatesImpl();
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
    updateAllCancelled = true;

    let cancelled = false;
    const win = windowManager.getMainWindow() || BrowserWindow.getAllWindows()[0];

    if (activeUpdateProc && !activeUpdateProc.killed) {
      const pid = activeUpdateProc.pid;
      cancelledUpdatePids.add(pid);
      activeUpdateProc = null;
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
      } catch (e) { }
      cancelled = true;
    }

    if (activeDeElevated) {
      const de = activeDeElevated;
      activeDeElevated = null;
      try { clearInterval(de.pollInterval); } catch { }
      try { execSync(`schtasks /end /tn "${de.taskName}"`, { stdio: 'ignore', windowsHide: true }); } catch { }
      try { execSync(`schtasks /delete /tn "${de.taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
      try { execSync('taskkill /F /IM winget.exe /T', { stdio: 'ignore', windowsHide: true }); } catch { }
      try { fs.unlinkSync(de.tmpBat); } catch { }
      try { fs.unlinkSync(de.tmpVbs); } catch { }
      try { fs.unlinkSync(de.tmpLog); } catch { }
      if (de.resolve) de.resolve({ success: false, cancelled: true, message: 'Update cancelled' });
      cancelled = true;
    }

    if (cancelled) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('software:update-progress', { packageId: '__cancelled__', phase: 'error', status: 'Update cancelled', percent: 0 });
      }
      return { success: true };
    }
    return { success: false, message: 'No active update' };
  });

  ipcMain.handle('software:update-app', async (_event, packageId) => {
    const cleanId = String(packageId).replace(/[^\x20-\x7E]/g, '').trim();
    const win = windowManager.getMainWindow() || BrowserWindow.getAllWindows()[0];

    const sendProgress = (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('software:update-progress', { packageId: cleanId, ...data });
      }
    };

    /* Shared chunk parser for winget output */
    const createChunkParser = () => {
      const emit = sendProgress;
      let phase = 'preparing';
      return (chunk) => {
        const text = chunk.toString();
        const segments = text.split('\r').map(s => s.trim()).filter(Boolean);
        for (const seg of segments) {
          if (/^[-\\|/]$/.test(seg)) {
            if (phase === 'downloading') emit({ phase, status: 'Downloading...', percent: -1 });
            else if (phase === 'installing') emit({ phase, status: 'Installing...', percent: -1 });
            continue;
          }
          if (/^(Downloading|T.l.chargement)\s/i.test(seg)) {
            phase = 'downloading';
            emit({ phase: 'downloading', status: 'Downloading...', percent: -1 });
          } else if (/^(Found|Trouv)/i.test(seg)) {
            emit({ phase: 'preparing', status: seg.substring(0, 80), percent: 5 });
          } else if (/verified installer hash|hachage.+v.rifi/i.test(seg)) {
            phase = 'verifying';
            emit({ phase: 'verifying', status: 'Installer verified', percent: 100 });
          } else if (/Starting package install|but de l.installation/i.test(seg)) {
            phase = 'installing';
            emit({ phase: 'installing', status: 'Installing...', percent: -1 });
          } else if (/Successfully installed|install.+correctement|installation.+r.ussie/i.test(seg)) {
            phase = 'done';
            emit({ phase: 'done', status: 'Successfully installed!', percent: 100 });
          } else if (/no applicable|no available upgrade|aucune.+mise/i.test(seg)) {
            emit({ phase: 'done', status: 'Already up to date', percent: 100 });
          }
        }
        return text;
      };
    };

    /* Run a winget command with real-time streaming progress */
    const runWinget = (cmd, statusLabel = 'Preparing update') => new Promise((resolve) => {
      let fullOutput = '';
      sendProgress({ phase: 'preparing', status: `${statusLabel}...`, percent: 0 });
      const parseChunk = createChunkParser();

      const proc = spawn('cmd.exe', ['/c', `chcp 65001 >nul && ${cmd}`], { windowsHide: true });
      activeUpdateProc = proc;

      const timeout = setTimeout(() => {
        proc.kill();
        sendProgress({ phase: 'error', status: 'Update timed out', percent: 0 });
        resolve({ success: false, message: 'Update timed out' });
      }, 180000);

      proc.stdout.on('data', (chunk) => { fullOutput += parseChunk(chunk); });
      proc.stderr.on('data', (chunk) => { fullOutput += parseChunk(chunk); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (activeUpdateProc === proc) activeUpdateProc = null;
        if (proc.killed || cancelledUpdatePids.delete(proc.pid)) {
          sendProgress({ phase: 'error', status: 'Update cancelled', percent: 0 });
          resolve({ success: false, cancelled: true, message: 'Update cancelled' });
          return;
        }
        const lower = fullOutput.toLowerCase();
        const success = lower.includes('successfully installed') ||
          /install.+correctement/i.test(lower) ||
          /installation.+r.ussie/i.test(lower) ||
          lower.includes('no available upgrade') ||
          /aucune.+mise/i.test(lower) ||
          lower.includes('no applicable');
        if (success) {
          _invalidateCaches();
          sendProgress({ phase: 'done', status: 'Update complete!', percent: 100 });
          resolve({ success: true, message: `${packageId} updated successfully` });
        } else {
          console.log(`[Software Update] winget output for ${cleanId}:\n${fullOutput}`);
          const lastLine = getMeaningfulLine(fullOutput, `Update failed (exit code: ${code})`);
          resolve({ success: false, message: lastLine, output: lower });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, message: err.message });
      });
    });

    /* Friendly error messages */
    const getFriendlyError = (output) => {
      if (!output) return null;
      if (output.includes('no installed package found')) return 'Package not found \u2014 update manually or via its own updater';
      if (output.includes('cannot be upgraded using winget') || output.includes('use the method provided by the publisher'))
        return 'This app must be updated through its own updater';
      if (output.includes('currently running') && output.includes('exit the application'))
        return 'Close the app first, then try updating again';
      if (output.includes('access is denied'))
        return _isElevated ? null : 'Run the app as administrator to update this package';
      if (output.includes('installer failed'))
        return 'Installer failed \u2014 the app may need to be closed first';
      if (output.includes('installer log is available'))
        return 'Installer failed \u2014 try closing the app and updating again';
      if (output.includes('hash does not match') && output.includes('cannot be overridden'))
        return 'Hash mismatch \u2014 retrying as standard user';
      return null;
    };

    /* Extract meaningful error line from winget output */
    const getMeaningfulLine = (text, fallback = 'Update failed') => {
      const lines = text.split(/[\r\n]/).map(s => s.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (/^installer log is available at/i.test(l)) continue;
        if (/^[-\\|/]$/.test(l)) continue;
        if (/^\\\\|^[A-Z]:\\/.test(l) && l.includes('.log')) continue;
        if (/^__GS_DONE__$/i.test(l)) continue;
        if (l.length < 4) continue;
        return l.substring(0, 120);
      }
      return fallback;
    };

    /* De-elevate for installers that refuse admin context */
    const runDeElevated = (cmd) => new Promise((resolve) => {
      sendProgress({ phase: 'preparing', status: 'Updating...', percent: 0 });

      const tmpLog = path.join(os.tmpdir(), `gs_winget_${cleanId.replace(/[^a-zA-Z0-9]/g, '_')}.log`);
      const tmpBat = path.join(os.tmpdir(), `gs_winget_de_${process.pid}.bat`);
      const taskName = `GSOptUpdate_${process.pid}`;

      try { fs.unlinkSync(tmpLog); } catch { }

      fs.writeFileSync(tmpBat,
        `@echo off\r\nchcp 65001 >nul\r\n${cmd} --disable-interactivity > "${tmpLog}" 2>&1\r\necho __GS_DONE__ >> "${tmpLog}"\r\n`, 'utf8');

      const tmpVbs = path.join(os.tmpdir(), `gs_winget_de_${process.pid}.vbs`);
      fs.writeFileSync(tmpVbs,
        `CreateObject("WScript.Shell").Run "cmd.exe /c """"${tmpBat.replace(/\\/g, '\\\\')}""""", 0, True\r\n`, 'utf8');

      let launchOk = false;

      // Method 1: PowerShell Register-ScheduledTask
      if (!launchOk) {
        try {
          const userName = (process.env.USERDOMAIN && process.env.USERNAME)
            ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
            : process.env.USERNAME || 'CURRENT_USER';
          const ps1 = path.join(os.tmpdir(), `gs_de_task_${process.pid}.ps1`);
          const ps1Body = [
            `$taskName = '${taskName}'`,
            `$vbsPath  = '${tmpVbs.replace(/'/g, "''")}'`,
            `try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -EA SilentlyContinue } catch {}`,
            `$action    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"""' + $vbsPath + '"""')`,
            `$principal = New-ScheduledTaskPrincipal -UserId '${userName.replace(/'/g, "''")}' -RunLevel Limited -LogonType Interactive`,
            `$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
            `Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
            `Start-ScheduledTask -TaskName $taskName`,
            `Write-Host 'LAUNCHED'`
          ].join('\n');
          fs.writeFileSync(ps1, ps1Body, 'utf8');
          const psOut = execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`,
            { encoding: 'utf8', windowsHide: true, timeout: 20000 }
          );
          try { fs.unlinkSync(ps1); } catch { }
          if (psOut.includes('LAUNCHED')) launchOk = true;
          else console.error('[Software Update] PS ScheduledTask: no LAUNCHED marker, output:', psOut.substring(0, 200));
        } catch (err) {
          console.error('[Software Update] PS ScheduledTask failed:', (err.stderr || err.message || '').substring(0, 300));
        }
      }

      // Method 2: runas /trustlevel:0x20000
      if (!launchOk) {
        try {
          const r = spawnSync('runas.exe', ['/trustlevel:0x20000', 'wscript.exe', tmpVbs],
            { windowsHide: true, timeout: 10000 });
          if (r.error) throw r.error;
          launchOk = true;
        } catch (err) {
          console.error('[Software Update] runas /trustlevel failed:', err.message || err);
        }
      }

      // Method 3: schtasks CLI /rl limited
      if (!launchOk) {
        try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
        try {
          execSync(
            `schtasks /create /tn "${taskName}" /tr "wscript.exe \\"${tmpVbs}\\"" /sc once /st 00:00 /f /rl limited`,
            { encoding: 'utf8', windowsHide: true }
          );
          execSync(`schtasks /run /tn "${taskName}"`, { encoding: 'utf8', windowsHide: true });
          launchOk = true;
        } catch (err) {
          console.error('[Software Update] schtasks de-elevation failed:', (err.stderr || err.message || '').substring(0, 300));
        }
      }

      if (!launchOk) {
        try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
        try { fs.unlinkSync(tmpBat); } catch { }
        try { fs.unlinkSync(tmpVbs); } catch { }
        sendProgress({ phase: 'error', status: 'Update failed', percent: 0 });
        resolve({ success: false, message: 'Update failed' });
        return;
      }

      sendProgress({ phase: 'installing', status: 'Updating...', percent: -1 });

      // Poll the log file for winget output
      let elapsed = 0;
      const pollMs = 2000;
      const maxWait = 180000;
      let lastLogSize = 0;
      let staleSince = 0;
      const staleLimit = 30000;
      let installStarted = false;
      let pollPhase = 'preparing';

      activeDeElevated = { taskName, pollInterval: null, tmpBat, tmpVbs, tmpLog, resolve };

      const poll = setInterval(() => {
        if (!activeDeElevated || activeDeElevated.taskName !== taskName) {
          clearInterval(poll);
          return;
        }
        elapsed += pollMs;
        let log = '';
        try { log = fs.readFileSync(tmpLog, 'utf8'); } catch { }
        const lower = log.toLowerCase();

        if (log.length === lastLogSize) {
          staleSince += pollMs;
        } else {
          lastLogSize = log.length;
          staleSince = 0;
        }

        if (pollPhase === 'preparing' && (lower.includes('downloading') || /t.l.chargement/i.test(lower))) {
          pollPhase = 'downloading';
          sendProgress({ phase: 'downloading', status: 'Downloading...', percent: -1 });
        }
        if ((pollPhase === 'preparing' || pollPhase === 'downloading') && (lower.includes('verified installer hash') || /hachage.+v.rifi/i.test(lower))) {
          pollPhase = 'verifying';
          sendProgress({ phase: 'verifying', status: 'Verified', percent: 100 });
        }
        if (pollPhase !== 'installing' && (lower.includes('starting package install') || /but de l.installation/i.test(lower))) {
          pollPhase = 'installing';
          sendProgress({ phase: 'installing', status: 'Installing...', percent: -1 });
          installStarted = true;
        }

        const finished = lower.includes('successfully installed') ||
          /install.+correctement/i.test(lower) ||
          /installation.+r.ussie/i.test(lower) ||
          lower.includes('no available upgrade') ||
          lower.includes('no applicable') ||
          /aucune.+mise/i.test(lower) ||
          lower.includes('installer failed') ||
          lower.includes('failed to install') ||
          lower.includes('cannot be upgraded') ||
          lower.includes('cannot be run from an administrator') ||
          lower.includes('cannot be overridden when running as admin') ||
          lower.includes('installer log is available') ||
          lower.includes('installation complete') ||
          lower.includes('upgrade successful') ||
          lower.includes('__gs_done__') ||
          (lower.includes('exit code') && lower.includes('failed'));

        const staleFinish = installStarted && staleSince >= staleLimit;

        if (finished || staleFinish || elapsed >= maxWait) {
          clearInterval(poll);
          activeDeElevated = null;
          try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
          try { fs.unlinkSync(tmpBat); } catch { }
          try { fs.unlinkSync(tmpVbs); } catch { }

          const success = lower.includes('successfully installed') || /install.+correctement/i.test(lower) || /installation.+r.ussie/i.test(lower);
          if (success) {
            _invalidateCaches();
            sendProgress({ phase: 'done', status: 'Update complete!', percent: 100 });
            resolve({ success: true, message: `${packageId} updated successfully` });
          } else if (lower.includes('cannot be run from an administrator')) {
            sendProgress({ phase: 'error', status: 'This app must be updated outside GS Control Center', percent: 0 });
            resolve({ success: false, message: 'This app\'s installer refuses elevated context. Update it directly from its own updater.' });
          } else if (elapsed >= maxWait) {
            sendProgress({ phase: 'error', status: 'Update timed out', percent: 0 });
            resolve({ success: false, message: 'Update timed out' });
          } else {
            const lastLine = getMeaningfulLine(log, 'Update failed');
            sendProgress({ phase: 'error', status: lastLine, percent: 0 });
            resolve({ success: false, message: lastLine });
          }
          try { fs.unlinkSync(tmpLog); } catch { }
        }
      }, pollMs);

      activeDeElevated.pollInterval = poll;
    });

    // Retry chain
    // Step 1: Normal upgrade
    let result = await runWinget(
      `winget upgrade --id ${cleanId} --accept-source-agreements --accept-package-agreements`,
      'Preparing update'
    );
    if (result.success || result.cancelled) return result;

    // Step 2: Install technology mismatch -> force install
    if (result.output && result.output.includes('install technology is different')) {
      result = await runWinget(
        `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --force`,
        'Reinstalling'
      );
      if (result.success || result.cancelled) return result;
    }

    // Step 3a: Hash override blocked when running as admin -> de-elevate with hash skip + silent
    if (_isElevated && result.output &&
      result.output.includes('cannot be overridden when running as admin')) {
      sendProgress({ phase: 'preparing', status: 'Preparing update...', percent: 0 });
      return await runDeElevated(
        `winget upgrade --id ${cleanId} --accept-source-agreements --accept-package-agreements --force --ignore-security-hash --silent`
      );
    }

    // Step 3b: Installer refuses admin context (e.g. Spotify) -> de-elevate without silent
    if (_isElevated && result.output &&
      result.output.includes('cannot be run from an administrator')) {
      sendProgress({ phase: 'preparing', status: 'Preparing update...', percent: 0 });
      return await runDeElevated(
        `winget upgrade --id ${cleanId} --accept-source-agreements --accept-package-agreements --force`
      );
    }

    // Final: show user-friendly error
    const friendly = getFriendlyError(result.output || (result.message ? result.message.toLowerCase() : ''));
    const finalMsg = (friendly || result.message || 'Update failed').substring(0, 120);
    sendProgress({ phase: 'error', status: finalMsg, percent: 0 });
    return { success: false, message: finalMsg };
  });

} // end registerIPC

module.exports = {
  init,
  checkSoftwareUpdatesImpl: _checkSoftwareUpdatesImpl,
  getSoftwareUpdatesCache,
  setSoftwareUpdatesCache,
  registerIPC,
};

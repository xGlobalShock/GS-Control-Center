/**
 * App Uninstaller Module
 * Revo-style uninstall + leftover scanner.
 */

const { ipcMain, BrowserWindow, app } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execAsync, runPSScript, isPermissionError } = require('./utils');
const windowManager = require('./windowManager');
const appInstaller = require('./appInstaller');

let _isElevated = false;
let activeUninstallProc = null;
let uninstallCancelled = false;
let _preUninstallSnapshot = [];

function init({ isElevated }) {
  _isElevated = isElevated;
}

function registerIPC() {

  /* Extract real exe icon from installed app */
  ipcMain.handle('appuninstall:get-icon', async (_event, installLocation, uninstallString, displayIcon) => {
    let exePath = null;

    // 0. Try DisplayIcon registry value first
    if (displayIcon) {
      try {
        const iconPath = displayIcon.replace(/,\s*-?\d+\s*$/, '').replace(/^"|"$/g, '').trim();
        if (/\.(exe|ico|dll)$/i.test(iconPath) && fs.existsSync(iconPath)) {
          if (/\.ico$/i.test(iconPath)) {
            const buf = fs.readFileSync(iconPath);
            if (buf.length > 100) {
              return { success: true, dataUrl: `data:image/x-icon;base64,${buf.toString('base64')}` };
            }
          } else {
            exePath = iconPath;
          }
        }
      } catch { }
    }

    // 1. Try the installLocation directory
    if (!exePath && installLocation) {
      try {
        if (/\.exe$/i.test(installLocation) && fs.existsSync(installLocation)) {
          exePath = installLocation;
        } else if (fs.existsSync(installLocation)) {
          const stat = fs.statSync(installLocation);
          if (stat.isDirectory()) {
            const files = fs.readdirSync(installLocation);
            const preferred = files.find(f => {
              const l = f.toLowerCase();
              return l.endsWith('.exe') &&
                !l.includes('uninstall') && !l.includes('setup') &&
                !l.includes('update') && !l.includes('installer');
            });
            const fallback = files.find(f => f.toLowerCase().endsWith('.exe'));
            const chosen = preferred || fallback;
            if (chosen) exePath = path.join(installLocation, chosen);
          }
        }
      } catch { }
    }

    // 2. Extract exe path from the uninstall string
    if (!exePath && uninstallString) {
      const m = uninstallString.match(/"([^"]+\.exe)"/i) ||
                uninstallString.match(/^(\S+\.exe)/i);
      if (m) {
        const candidate = m[1] || m[0];
        try { if (fs.existsSync(candidate)) exePath = candidate; } catch { }
      }
    }

    if (!exePath) return { success: false };

    try {
      const img = await app.getFileIcon(exePath, { size: 'normal' });
      return { success: true, dataUrl: img.toDataURL() };
    } catch {
      return { success: false };
    }
  });

  /* List all installed programs (registry) */
  ipcMain.handle('appuninstall:list-apps', async () => {
    const TAG = '[AppUninstall]';
    try {
      const regScript = [
        '$paths = @(',
        "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
        ')',
        '$apps = @()',
        'foreach ($p in $paths) {',
        '  Get-ItemProperty $p | Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne "" } | ForEach-Object {',
        '    $un = if ($_.QuietUninstallString) { $_.QuietUninstallString } elseif ($_.UninstallString) { $_.UninstallString } else { "" }',
        '    $apps += [PSCustomObject]@{',
        '      name = $_.DisplayName',
        '      publisher = if ($_.Publisher) { $_.Publisher } else { "" }',
        '      version = if ($_.DisplayVersion) { $_.DisplayVersion } else { "" }',
        '      size = if ($_.EstimatedSize) { [math]::Round($_.EstimatedSize / 1024, 1) } else { 0 }',
        '      installDate = if ($_.InstallDate) { $_.InstallDate } else { "" }',
        '      installLocation = if ($_.InstallLocation) { $_.InstallLocation } else { "" }',
        '      uninstallString = $un',
        '      displayIcon = if ($_.DisplayIcon) { $_.DisplayIcon } else { "" }',
        '      registryKey = ($_.PSPath -replace "Microsoft.PowerShell.Core\\\\Registry::", "")',
        '      source = "registry"',
        '    }',
        '  }',
        '}',
        '$apps | ConvertTo-Json -Depth 3 -Compress',
      ].join('\n');
      const regOut = await runPSScript(regScript, 20000);

      let regApps = [];
      try {
        const parsed = JSON.parse(regOut.trim());
        regApps = Array.isArray(parsed) ? parsed : [parsed];
      } catch { regApps = []; }

      const seen = new Set();
      const dedupedApps = [];
      for (const a of regApps) {
        const key = (a.name || '').toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        dedupedApps.push(a);
      }

      dedupedApps.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      console.log(TAG, `Found ${dedupedApps.length} installed programs`);
      return { success: true, apps: dedupedApps };
    } catch (err) {
      console.error(TAG, 'Failed to list apps:', err.message);
      return { success: false, apps: [], error: err.message };
    }
  });

  /* Uninstall an app */
  ipcMain.handle('appuninstall:uninstall-app', async (_event, appInfo) => {
    const TAG = '[AppUninstall]';
    const win = windowManager.getMainWindow() || BrowserWindow.getAllWindows()[0];
    uninstallCancelled = false;

    const sendProgress = (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('appuninstall:progress', data);
      }
    };

    const { name, uninstallString, registryKey, source } = appInfo;
    console.log(TAG, `Uninstalling: ${name}`);

    const isStillInstalled = () => {
      if (!registryKey) return false;
      try {
        const regKeyClean = registryKey.replace(/^HKEY_LOCAL_MACHINE/, 'HKLM').replace(/^HKEY_CURRENT_USER/, 'HKCU');
        execSync(`reg query "${regKeyClean}" /v DisplayName`, { timeout: 3000, windowsHide: true, stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    };

    const waitForRemoval = (maxWaitMs = 120000) => new Promise((resolve) => {
      if (!registryKey || !isStillInstalled()) { resolve(true); return; }
      sendProgress({ phase: 'uninstalling', status: `Waiting for ${name} to finish uninstalling...`, percent: -1 });
      let elapsed = 0;
      const pollMs = 2000;
      const interval = setInterval(() => {
        elapsed += pollMs;
        if (uninstallCancelled) { clearInterval(interval); resolve(false); return; }
        if (!isStillInstalled()) { clearInterval(interval); resolve(true); return; }
        if (elapsed >= maxWaitMs) { clearInterval(interval); resolve(false); }
      }, pollMs);
    });

    // Pre-snapshot: record registry BEFORE uninstall (Revo-style diff approach)
    _preUninstallSnapshot = [];
    try {
      const nameEscSnap = name.replace(/'/g, "''").replace(/[/"\\]/g, '').trim();
      const pubEscSnap  = (appInfo.publisher || '').replace(/'/g, "''").replace(/[/"\\]/g, '').trim();
      const installLocEsc = (appInfo.installLocation || '').replace(/'/g, "''").trim();

      const psSnap = `
$appName = '${nameEscSnap}'
$pubName  = '${pubEscSnap}'
$installLoc = '${installLocEsc}'
$tokens   = @($appName)
if ($pubName -and $pubName -ne $appName) { $tokens += $pubName }
$roots = @('HKCU:\\SOFTWARE','HKLM:\\SOFTWARE')
$found = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($root in $roots) {
  try {
    Get-ChildItem -Path $root -Recurse -Depth 6 -ErrorAction SilentlyContinue | ForEach-Object {
      $leaf = $_.PSChildName
      foreach ($tok in $tokens) {
        if ($leaf -like "*$tok*") { [void]$found.Add($_.Name); break }
      }
    }
  } catch {}
}

$runKeys = @(
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
)
$runMatches = @()
foreach ($rk in $runKeys) {
  try {
    $vals = Get-ItemProperty -Path $rk -ErrorAction SilentlyContinue
    if ($vals) {
      $vals.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | ForEach-Object {
        foreach ($tok in $tokens) {
          if ($_.Name -like "*$tok*" -or ($_.Value -and $_.Value.ToString() -like "*$tok*")) {
            $regPath = $rk.Replace('HKCU:\\','HKEY_CURRENT_USER\\').Replace('HKLM:\\','HKEY_LOCAL_MACHINE\\')
            $runMatches += "$regPath|$($_.Name)"
            break
          }
        }
      }
    }
  } catch {}
}

$pathMatches = @()
if ($installLoc -and $installLoc.Length -gt 5) {
  $searchStr = $installLoc.TrimEnd('\\')
  $pathHives = @(
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppSwitched',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppLaunch',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
    'HKCU:\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search\\JumplistData',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\OpenSavePidlMRU',
    'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store'
  )
  foreach ($hive in $pathHives) {
    try {
      if (-not (Test-Path $hive)) { continue }
      $props = Get-ItemProperty -Path $hive -ErrorAction SilentlyContinue
      if ($props) {
        $props.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | ForEach-Object {
          $vn = $_.Name
          $vd = if ($_.Value) { $_.Value.ToString() } else { '' }
          if ($vn -like "*$searchStr*" -or $vd -like "*$searchStr*") {
            $rp = $hive.Replace('HKCU:\\','HKEY_CURRENT_USER\\').Replace('HKLM:\\','HKEY_LOCAL_MACHINE\\')
            $detail = $hive.Split('\\')[-1]
            $pathMatches += "$rp|$vn|$detail"
          }
        }
      }
      Get-ChildItem -Path $hive -ErrorAction SilentlyContinue | ForEach-Object {
        try {
          $childKey = $_
          $subProps = Get-ItemProperty -Path $childKey.PSPath -ErrorAction SilentlyContinue
          if ($subProps) {
            $subProps.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | ForEach-Object {
              $vn = $_.Name
              $vd = if ($_.Value) { $_.Value.ToString() } else { '' }
              if ($vn -like "*$searchStr*" -or $vd -like "*$searchStr*") {
                $rp = $childKey.Name.Replace('HKEY_CURRENT_USER','HKCU').Replace('HKEY_LOCAL_MACHINE','HKLM')
                $detail = $childKey.PSChildName
                $pathMatches += "$rp|$vn|$detail"
              }
            }
          }
        } catch {}
      }
    } catch {}
  }
}

$out = @{ keys = @($found); runValues = $runMatches; pathValues = $pathMatches }
$out | ConvertTo-Json -Compress -Depth 2
`;
      const snapRaw = await runPSScript(psSnap, 25000);
      try {
        const snapData = JSON.parse(snapRaw || '{}');
        const keys = Array.isArray(snapData.keys) ? snapData.keys : [];
        for (const kp of keys) {
          const norm = kp.replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM').replace(/^HKEY_CURRENT_USER/i, 'HKCU');
          _preUninstallSnapshot.push({ path: norm, type: 'key' });
        }
        const runVals = Array.isArray(snapData.runValues) ? snapData.runValues : [];
        for (const rv of runVals) {
          const [parentKey, valueName] = rv.split('|');
          const norm = parentKey.replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM').replace(/^HKEY_CURRENT_USER/i, 'HKCU');
          _preUninstallSnapshot.push({ path: `${norm}\\${valueName}`, type: 'value', parentKey: norm, valueName });
        }
        const pathVals = Array.isArray(snapData.pathValues) ? snapData.pathValues : [];
        for (const pv of pathVals) {
          const parts = pv.split('|');
          if (parts.length >= 2) {
            const parentKey = parts[0].replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM').replace(/^HKEY_CURRENT_USER/i, 'HKCU');
            const valueName = parts[1];
            const detail = parts[2] || 'Path reference';
            _preUninstallSnapshot.push({
              path: `${parentKey} \u2192 ${valueName}`,
              type: 'value',
              parentKey,
              valueName,
              detail,
            });
          }
        }
      } catch { }

      if (registryKey) {
        const cleanKey = registryKey.replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM').replace(/^HKEY_CURRENT_USER/i, 'HKCU');
        if (!_preUninstallSnapshot.some(e => e.path.toLowerCase() === cleanKey.toLowerCase())) {
          try {
            execSync(`reg query "${cleanKey}"`, { timeout: 3000, windowsHide: true, stdio: 'pipe' });
            _preUninstallSnapshot.push({ path: cleanKey, type: 'key' });
          } catch {}
        }
      }
      console.log(TAG, `Pre-snapshot: ${_preUninstallSnapshot.length} registry entries captured`);
    } catch (snapErr) {
      console.log(TAG, 'Pre-snapshot failed (non-fatal):', snapErr.message);
    }

    sendProgress({ phase: 'uninstalling', status: `Uninstalling ${name}...`, percent: -1 });

    try {
      // Strategy 1: winget uninstall
      let wingetSuccess = false;
      const escapedName = name.replace(/"/g, '');
      const wingetCmd = `chcp 65001 >nul && winget uninstall --name "${escapedName}" --accept-source-agreements --disable-interactivity`;
      console.log(TAG, 'Trying winget uninstall...');

      try {
        const { stdout } = await execAsync(wingetCmd, {
          timeout: 180000, windowsHide: true, encoding: 'utf8',
          shell: 'cmd.exe', maxBuffer: 1024 * 1024 * 5,
          env: process.env, cwd: process.env.SYSTEMROOT || 'C:\\Windows',
        });
        const lower = stdout.toLowerCase();
        wingetSuccess = lower.includes('successfully uninstalled') ||
          /d.sinstall.+correctement/i.test(lower) || /d.sinstallation.+r.ussie/i.test(lower) ||
          lower.includes('no installed package found');
        console.log(TAG, `winget result: ${wingetSuccess ? 'success' : 'check output'}`, stdout.substring(0, 200));
      } catch (e) {
        console.log(TAG, 'winget uninstall failed:', (e.message || '').substring(0, 150));
      }

      if (uninstallCancelled) return { success: false, cancelled: true, message: 'Uninstall cancelled' };

      if (wingetSuccess) {
        await waitForRemoval(30000);
        appInstaller.invalidateCaches();
        sendProgress({ phase: 'done', status: `${name} uninstalled`, percent: 100 });
        return { success: true, message: `${name} uninstalled` };
      }

      // Strategy 2: native uninstall string
      if (!uninstallString) {
        sendProgress({ phase: 'error', status: 'No uninstall method available', percent: 0 });
        return { success: false, message: 'winget failed and no native uninstall command found.' };
      }

      console.log(TAG, 'Falling back to native uninstaller...');
      sendProgress({ phase: 'uninstalling', status: `Uninstalling ${name} \u2014 complete the uninstaller if it appears...`, percent: -1 });

      let cmd = uninstallString.trim();
      if (/msiexec/i.test(cmd)) {
        cmd = cmd.replace(/\/I/i, '/X');
      }

      // De-elevate per-user uninstallers (HKCU apps)
      const isHKCU = registryKey && /HKEY_CURRENT_USER|HKCU/i.test(registryKey);
      if (_isElevated && isHKCU) {
        console.log(TAG, 'De-elevating per-user uninstaller...');
        const tmpBat = path.join(os.tmpdir(), `gs_uninstall_de_${Date.now()}.bat`);
        const tmpLog = path.join(os.tmpdir(), `gs_uninstall_${Date.now()}.log`);
        fs.writeFileSync(tmpBat,
          `@echo off\r\nchcp 65001 >nul\r\n${cmd} > "${tmpLog}" 2>&1\r\necho __GS_DONE__ >> "${tmpLog}"\r\n`, 'utf8');

        const tmpVbs = path.join(os.tmpdir(), `gs_uninst_vbs_${Date.now()}.vbs`);
        fs.writeFileSync(tmpVbs,
          `CreateObject("WScript.Shell").Run "cmd.exe /c """"` + tmpBat + `""""", 0, True\r\n`, 'utf8');

        let launched = false;
        // Explorer-token method
        try {
          const cs = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public class DeElev2 {
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
[DeElev2]::Run('${tmpVbs.replace(/\\/g, '\\\\').replace(/'/g, "''")}')`;
          const res = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cs.replace(/"/g, '\\"')}"`,
            { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
          if (res === 'True') { launched = true; console.log(TAG, 'De-elevated via Explorer token'); }
        } catch {}

        if (!launched) {
          const taskName = `GSAppUninst_${process.pid}`;
          try {
            execSync(`schtasks /create /tn "${taskName}" /tr "wscript.exe \\"${tmpVbs}\\"" /sc once /st 00:00 /rl LIMITED /f`,
              { stdio: 'ignore', windowsHide: true, timeout: 10000 });
            execSync(`schtasks /run /tn "${taskName}"`, { stdio: 'ignore', windowsHide: true, timeout: 10000 });
            launched = true;
            setTimeout(() => { try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch {} }, 5000);
          } catch {}
        }

        if (launched) {
          const removed = await waitForRemoval(300000);
          try { fs.unlinkSync(tmpBat); } catch {}
          try { fs.unlinkSync(tmpLog); } catch {}
          try { fs.unlinkSync(tmpVbs); } catch {}

          appInstaller.invalidateCaches();

          if (removed) {
            sendProgress({ phase: 'done', status: `${name} uninstalled`, percent: 100 });
            return { success: true, message: `${name} uninstalled` };
          }
          sendProgress({ phase: 'error', status: `${name} may not have been fully uninstalled`, percent: 0 });
          return { success: false, message: `${name} may not have been fully uninstalled` };
        }
        // If de-elevation failed, fall through to direct launch
      }

      // Direct launch
      await new Promise((resolve) => {
        const proc = spawn('cmd.exe', ['/c', cmd], {
          windowsHide: false,
          env: process.env,
          cwd: process.env.SYSTEMROOT || 'C:\\Windows',
          stdio: 'pipe',
        });
        activeUninstallProc = proc;
        const timeout = setTimeout(() => { proc.kill(); resolve(); }, 600000);
        proc.on('close', () => { clearTimeout(timeout); activeUninstallProc = null; resolve(); });
        proc.on('error', () => { clearTimeout(timeout); resolve(); });
      });

      if (uninstallCancelled) return { success: false, cancelled: true, message: 'Uninstall cancelled' };

      const removed = await waitForRemoval(300000);
      appInstaller.invalidateCaches();

      if (removed || !isStillInstalled()) {
        sendProgress({ phase: 'done', status: `${name} uninstalled`, percent: 100 });
        return { success: true, message: `${name} uninstalled` };
      }

      sendProgress({ phase: 'error', status: `${name} may not have been fully uninstalled`, percent: 0 });
      return { success: false, message: `${name} may not have been fully uninstalled` };
    } catch (err) {
      console.error(TAG, 'Uninstall error:', err.message);
      sendProgress({ phase: 'error', status: err.message, percent: 0 });
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('appuninstall:cancel', async () => {
    uninstallCancelled = true;
    if (activeUninstallProc && !activeUninstallProc.killed) {
      try { spawn('taskkill', ['/F', '/T', '/PID', String(activeUninstallProc.pid)], { windowsHide: true }); } catch {}
      activeUninstallProc = null;
    }
    return { success: true };
  });

  /* Scan for leftovers after uninstall */
  ipcMain.handle('appuninstall:scan-leftovers', async (_event, appInfo, scanMode, usePreSnapshot) => {
    const TAG = '[AppUninstall:Scan]';
    const { name, publisher, installLocation, registryKey } = appInfo;
    const mode = scanMode || 'moderate';
    console.log(TAG, `Scanning leftovers for "${name}" (mode: ${mode})`);

    await new Promise(r => setTimeout(r, 3000));

    const leftovers = [];
    const appNameLower = (name || '').toLowerCase().trim();
    const publisherLower = (publisher || '').toLowerCase().trim();

    const tokens = appNameLower.split(/[\s\-_().]+/).filter(t => t.length >= 3);
    tokens.push(appNameLower);
    if (publisherLower && publisherLower.length >= 3) {
      tokens.push(publisherLower);
    }
    const searchTokens = [...new Set(tokens)];

    const matchesApp = (str) => {
      const lower = str.toLowerCase();
      if (lower.includes(appNameLower)) return true;
      if (tokens.length > 1) {
        let matchCount = 0;
        for (const t of searchTokens) {
          if (lower.includes(t)) matchCount++;
        }
        return matchCount >= 2;
      }
      return false;
    };

    // 1. FILESYSTEM LEFTOVERS
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const programData = process.env.PROGRAMDATA || '';

    if (mode !== 'safe' && installLocation && installLocation.trim()) {
      try {
        const loc = installLocation.trim();
        if (fs.existsSync(loc)) {
          let sizeBytes = 0;
          try {
            const children = fs.readdirSync(loc);
            for (const child of children) {
              try { sizeBytes += fs.statSync(path.join(loc, child)).size; } catch {}
            }
          } catch {}
          leftovers.push({ type: 'folder', path: loc, size: sizeBytes, selected: true });
        }
      } catch {}
    }

    const searchBases = [localAppData, appData, programData];

    if (mode !== 'safe') {
      const startMenu = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      const desktop = path.join(os.homedir(), 'Desktop');
      searchBases.push(startMenu, desktop);
      searchBases.push('C:\\Program Files', 'C:\\Program Files (x86)');
      if (installLocation && installLocation.trim()) {
        const parent = path.dirname(installLocation.trim());
        if (parent && !searchBases.includes(parent)) searchBases.push(parent);
      }
    }

    if (mode === 'advanced') {
      const tempDir = process.env.TEMP || os.tmpdir();
      searchBases.push(tempDir);
      try {
        for (let code = 65; code <= 90; code++) {
          const letter = String.fromCharCode(code);
          if (fs.existsSync(`${letter}:\\`)) {
            searchBases.push(`${letter}:\\Program Files`);
            searchBases.push(`${letter}:\\Program Files (x86)`);
          }
        }
      } catch {}
    }

    for (const base of searchBases) {
      if (!base) continue;
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const entry of entries) {
          if (matchesApp(entry.name)) {
            const fullPath = path.join(base, entry.name);
            if (fullPath.toLowerCase().includes('gs control center')) continue;
            if (fullPath.toLowerCase().includes('windows\\system32')) continue;

            let sizeBytes = 0;
            try {
              if (entry.isDirectory()) {
                const children = fs.readdirSync(fullPath);
                for (const child of children) {
                  try { sizeBytes += fs.statSync(path.join(fullPath, child)).size; } catch {}
                }
              } else {
                sizeBytes = fs.statSync(fullPath).size;
              }
            } catch {}

            leftovers.push({
              type: entry.isDirectory() ? 'folder' : 'file',
              path: fullPath,
              size: sizeBytes,
              selected: true,
            });
          }
        }
      } catch {}
    }

    // 2. REGISTRY LEFTOVERS
    if (mode !== 'safe') {
      if (usePreSnapshot && _preUninstallSnapshot.length > 0) {
        console.log(TAG, `Using pre-snapshot (${_preUninstallSnapshot.length} entries) for registry diff`);
        for (const entry of _preUninstallSnapshot) {
          try {
            if (entry.type === 'value') {
              execSync(`reg query "${entry.parentKey}" /v "${entry.valueName}"`, { timeout: 3000, windowsHide: true, stdio: 'pipe' });
              leftovers.push({
                type: 'registry',
                path: entry.path,
                size: 0,
                selected: true,
                detail: entry.detail || 'Startup entry',
              });
            } else {
              execSync(`reg query "${entry.path}"`, { timeout: 3000, windowsHide: true, stdio: 'pipe' });
              leftovers.push({
                type: 'registry',
                path: entry.path,
                size: 0,
                selected: true,
              });
            }
          } catch {}
        }
        _preUninstallSnapshot = [];
      } else {
        const regPaths = [
          `HKCU\\SOFTWARE\\${name}`,
          `HKLM\\SOFTWARE\\${name}`,
          `HKLM\\SOFTWARE\\WOW6432Node\\${name}`,
        ];
        if (publisher) {
          regPaths.push(`HKCU\\SOFTWARE\\${publisher}`);
          regPaths.push(`HKLM\\SOFTWARE\\${publisher}`);
          regPaths.push(`HKLM\\SOFTWARE\\WOW6432Node\\${publisher}`);
        }
        for (const regPath of regPaths) {
          try {
            execSync(`reg query "${regPath}"`, { timeout: 3000, windowsHide: true, stdio: 'pipe' });
            leftovers.push({
              type: 'registry',
              path: regPath,
              size: 0,
              selected: true,
            });
          } catch {}
        }

        const runKeys = [
          'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
          'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
        ];
        for (const runKey of runKeys) {
          try {
            const out = execSync(`reg query "${runKey}"`, { timeout: 3000, windowsHide: true, encoding: 'utf8' });
            for (const line of out.split('\n')) {
              if (matchesApp(line)) {
                const match = line.match(/^\s+(\S+)\s+REG_\w+\s+/i);
                if (match) {
                  leftovers.push({
                    type: 'registry',
                    path: `${runKey}\\${match[1]}`,
                    size: 0,
                    selected: true,
                    detail: 'Startup entry',
                  });
                }
              }
            }
          } catch {}
        }

        if (registryKey) {
          try {
            const regKeyClean = registryKey.replace(/^HKEY_LOCAL_MACHINE/, 'HKLM').replace(/^HKEY_CURRENT_USER/, 'HKCU');
            execSync(`reg query "${regKeyClean}"`, { timeout: 3000, windowsHide: true, stdio: 'pipe' });
            leftovers.push({
              type: 'registry',
              path: regKeyClean,
              size: 0,
              selected: true,
              detail: 'Uninstall entry',
            });
          } catch {}
        }
      }

      // 2b. PATH-BASED REGISTRY VALUE SCAN (Revo-style)
      if (installLocation && installLocation.trim()) {
        try {
          const installLocEsc = installLocation.trim().replace(/'/g, "''");
          const existingPaths = new Set(leftovers.filter(l => l.type === 'registry').map(l => l.path.toLowerCase()));

          const psPathScan = `
$searchStr = '${installLocEsc}'.TrimEnd('\\')
$pathHives = @(
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppSwitched',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppLaunch',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppBadgeUpdated',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
  'HKCU:\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search\\JumplistData',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store'
)
$results = @()
foreach ($hive in $pathHives) {
  try {
    if (-not (Test-Path $hive)) { continue }
    $props = Get-ItemProperty -Path $hive -ErrorAction SilentlyContinue
    if ($props) {
      $props.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | ForEach-Object {
        $vn = $_.Name
        $vd = if ($_.Value) { $_.Value.ToString() } else { '' }
        if ($vn -like "*$searchStr*" -or $vd -like "*$searchStr*") {
          $rp = $hive.Replace('HKCU:\\','HKCU\\').Replace('HKLM:\\','HKLM\\')
          $detail = $hive.Split('\\')[-1]
          $results += "$rp|$vn|$detail"
        }
      }
    }
    Get-ChildItem -Path $hive -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $childKey = $_
        $subProps = Get-ItemProperty -Path $childKey.PSPath -ErrorAction SilentlyContinue
        if ($subProps) {
          $subProps.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | ForEach-Object {
            $vn = $_.Name
            $vd = if ($_.Value) { $_.Value.ToString() } else { '' }
            if ($vn -like "*$searchStr*" -or $vd -like "*$searchStr*") {
              $rp = $childKey.Name.Replace('HKEY_CURRENT_USER','HKCU').Replace('HKEY_LOCAL_MACHINE','HKLM')
              $detail = $childKey.PSChildName
              $results += "$rp|$vn|$detail"
            }
          }
        }
      } catch {}
    }
  } catch {}
}
$results -join '<<<SEP>>>'
`;
          const pathRaw = await runPSScript(psPathScan, 20000);
          if (pathRaw) {
            const entries = pathRaw.split('<<<SEP>>>').filter(Boolean);
            for (const entry of entries) {
              const parts = entry.split('|');
              if (parts.length >= 2) {
                const parentKey = parts[0];
                const valueName = parts[1];
                const detail = parts[2] || 'Path reference';
                const entryPath = `${parentKey} \u2192 ${valueName}`;
                if (!existingPaths.has(entryPath.toLowerCase())) {
                  leftovers.push({
                    type: 'registry',
                    path: entryPath,
                    size: 0,
                    selected: true,
                    detail,
                  });
                }
              }
            }
          }
        } catch (e) {
          console.log(TAG, 'Path-based registry scan error:', e.message);
        }
      }
    }

    // 3. SERVICES (advanced only)
    if (mode === 'advanced') {
      try {
        const { stdout: svcOut } = await execAsync(
          `powershell -NoProfile -Command "Get-Service | Select-Object Name,DisplayName | ConvertTo-Json -Compress"`,
          { timeout: 10000, windowsHide: true, encoding: 'utf8' }
        );
        const services = JSON.parse(svcOut);
        for (const svc of (Array.isArray(services) ? services : [services])) {
          if (matchesApp(svc.Name) || matchesApp(svc.DisplayName || '')) {
            leftovers.push({
              type: 'service',
              path: svc.Name,
              size: 0,
              selected: false,
              detail: svc.DisplayName,
            });
          }
        }
      } catch {}

      try {
        const { stdout: taskOut } = await execAsync(
          'schtasks /query /fo CSV /nh',
          { timeout: 10000, windowsHide: true, encoding: 'utf8' }
        );
        for (const line of taskOut.split('\n')) {
          const parts = line.split(',').map(p => p.replace(/"/g, '').trim());
          if (parts[0] && matchesApp(parts[0])) {
            leftovers.push({
              type: 'task',
              path: parts[0],
              size: 0,
              selected: false,
              detail: 'Scheduled task',
            });
          }
        }
      } catch {}
    }

    // Deduplicate leftovers by path
    const seenPaths = new Set();
    const uniqueLeftovers = [];
    for (const item of leftovers) {
      const key = item.path.toLowerCase();
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        uniqueLeftovers.push(item);
      }
    }

    // Re-verify filesystem entries still exist
    const verifiedLeftovers = uniqueLeftovers.filter(item => {
      if (item.type === 'file' || item.type === 'folder') {
        if (!fs.existsSync(item.path)) {
          console.log(TAG, `Dropping stale entry (no longer exists): ${item.path}`);
          return false;
        }
      }
      return true;
    });

    const totalSize = verifiedLeftovers.reduce((sum, l) => sum + (l.size || 0), 0);
    console.log(TAG, `Found ${verifiedLeftovers.length} leftovers (${Math.round(totalSize / 1024)} KB)`);
    return { success: true, leftovers: verifiedLeftovers, totalSize };
  });

  /* Delete selected leftovers */
  ipcMain.handle('appuninstall:delete-leftovers', async (_event, items) => {
    const TAG = '[AppUninstall:Delete]';
    const results = [];
    let deletedCount = 0;
    let freedBytes = 0;

    for (const item of items) {
      try {
        switch (item.type) {
          case 'file':
            fs.unlinkSync(item.path);
            deletedCount++;
            freedBytes += item.size || 0;
            results.push({ path: item.path, success: true });
            break;
          case 'folder':
            fs.rmSync(item.path, { recursive: true, force: true });
            deletedCount++;
            freedBytes += item.size || 0;
            results.push({ path: item.path, success: true });
            break;
          case 'registry': {
            const regPath = item.path;
            if (regPath.includes(' \u2192 ')) {
              const [parentKey, valueName] = regPath.split(' \u2192 ');
              execSync(`reg delete "${parentKey.trim()}" /v "${valueName.trim()}" /f`, { timeout: 5000, windowsHide: true, stdio: 'pipe' });
            } else if (/\\Run\\/i.test(regPath)) {
              const lastSlash = regPath.lastIndexOf('\\');
              const parentKey = regPath.substring(0, lastSlash);
              const valueName = regPath.substring(lastSlash + 1);
              execSync(`reg delete "${parentKey}" /v "${valueName}" /f`, { timeout: 5000, windowsHide: true, stdio: 'pipe' });
            } else {
              execSync(`reg delete "${regPath}" /f`, { timeout: 5000, windowsHide: true, stdio: 'pipe' });
            }
            deletedCount++;
            results.push({ path: item.path, success: true });
            break;
          }
          case 'service':
            execSync(`sc delete "${item.path}"`, { timeout: 5000, windowsHide: true, stdio: 'pipe' });
            deletedCount++;
            results.push({ path: item.path, success: true });
            break;
          case 'task':
            execSync(`schtasks /delete /tn "${item.path}" /f`, { timeout: 5000, windowsHide: true, stdio: 'pipe' });
            deletedCount++;
            results.push({ path: item.path, success: true });
            break;
          default:
            results.push({ path: item.path, success: false, error: 'Unknown type' });
        }
      } catch (err) {
        results.push({ path: item.path, success: false, error: err.message });
        console.error(TAG, `Failed to delete ${item.type} "${item.path}":`, err.message);
      }
    }

    console.log(TAG, `Deleted ${deletedCount}/${items.length} items, freed ~${Math.round(freedBytes / 1024)} KB`);
    return { success: true, deletedCount, freedBytes, results };
  });

} // end registerIPC

module.exports = { init, registerIPC };

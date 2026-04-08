/**
 * Tweaks Module
 * Performance tweaks apply/check/reset + restore point creation.
 */

const { ipcMain } = require('electron');
const { execAsync, runPSScript } = require('./utils');
const repairOverlay = require('./repairOverlay');
const authSession = require('./authSession');

let _isElevated = false;
let _tweakCheckCache = null;
let _tweakCheckAge = 0;
let _tweakCheckInFlight = null; // deduplicate concurrent calls
let _activeRepairProc = null;
let _activeRepairTool = null;

function init({ isElevated }) {
  _isElevated = isElevated;
}

async function _runAllTweakChecks() {
  if (_tweakCheckCache && (Date.now() - _tweakCheckAge < 2000)) return _tweakCheckCache;
  // All concurrent callers (e.g. 16 simultaneous CHECK_MAP invokes on page load)
  // share one in-flight promise so only a single powershell process is ever spawned.
  if (_tweakCheckInFlight) return _tweakCheckInFlight;

  _tweakCheckInFlight = (async () => {
  try {
    const raw = await runPSScript(`
$r = @{}
function ChkReg($id, $path, $name) {
  try {
    $p = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
    if ($p -and ($p.PSObject.Properties.Name -contains $name)) {
      $r[$id] = @{ exists = $true; value = $p.$name }
    } else {
      $r[$id] = @{ exists = $false; value = $null }
    }
  } catch {
    $r[$id] = @{ exists = $false; value = $null }
  }
}
ChkReg 'irq' 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' 'IRQ8Priority'
ChkReg 'net' 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters' 'ProcessorThrottleMode'
ChkReg 'gpu' 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' 'HwSchMode'
ChkReg 'tdr' 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' 'TdrLevel'
ChkReg 'gdrvpolicy' 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR' 'AllowGameDVR'
ChkReg 'appcap' 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR' 'AppCaptureEnabled'
ChkReg 'dwm-overlay-test' 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' 'OverlayTestMode'
ChkReg 'fse' 'HKCU:\\System\\GameConfigStore' 'GameDVR_FSEBehaviorMonitorEnabled'
ChkReg 'fse-mode' 'HKCU:\\System\\GameConfigStore' 'GameDVR_FSEBehaviorMode'
ChkReg 'usb' 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' 'DisableSelectiveSuspend'
ChkReg 'dvr' 'HKCU:\\System\\GameConfigStore' 'GameDVR_Enabled'
ChkReg 'w32' 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' 'Win32PrioritySeparation'
ChkReg 'gprio' 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' 'Priority'
ChkReg 'lsc' 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' 'LargeSystemCache'
try {
  $nti = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name 'NetworkThrottlingIndex' -ErrorAction SilentlyContinue
  if ($nti -and ($nti.PSObject.Properties.Name -contains 'NetworkThrottlingIndex')) {
    $r['nti'] = @{ exists = $true; value = [uint32]$nti.NetworkThrottlingIndex }
  } else { $r['nti'] = @{ exists = $false; value = $null } }
} catch { $r['nti'] = @{ exists = $false; value = $null } }
try {
  $mc = (Get-MMAgent -ErrorAction SilentlyContinue).MemoryCompression
  if ($null -ne $mc) { $r['mc'] = @{ exists = $true; value = [int]$mc } } else { $r['mc'] = @{ exists = $false; value = $null } }
} catch {
  $r['mc'] = @{ exists = $false; value = $null }
}
$r | ConvertTo-Json -Compress
    `, 6000);

    if (raw) {
      _tweakCheckCache = JSON.parse(raw);
      _tweakCheckAge = Date.now();
      return _tweakCheckCache;
    }
  } catch (e) {
    console.warn('[TweakCheck] Consolidated check error:', e.message);
  } finally {
    _tweakCheckInFlight = null;
  }
  return null;
  })();

  return _tweakCheckInFlight;
}

function _tweakResult(data, key, appliedValue) {
  if (!data || !data[key]) return { applied: false, exists: false, value: null };
  const entry = data[key];
  const applied = entry.exists && Number(entry.value) === appliedValue;
  return { applied, exists: entry.exists, value: entry.value };
}

function registerIPC() {

  // Restore Point
  ipcMain.handle('system:create-restore-point', async (event, description) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const descBase = description || 'GS Control Center - Before Tweak Application';
      if (!_isElevated) {
        console.log('[Restore Point] Attempted without elevation');
        return { success: false, message: 'Admin privileges required to create a system restore point. Please run the app as administrator.' };
      }
      const timestamp = new Date().toISOString();
      const descWithTs = `${descBase} - ${timestamp}`;
      const safeDesc = descWithTs.replace(/'/g, "''");

      const preCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ComputerRestorePoint | Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1 | ConvertTo-Json -Compress"`;
      let preSeq = 0;
      let preObj = null;
      try {
        const preRes = await execAsync(preCmd, { shell: true, timeout: 10000 });
        const pstdout = preRes.stdout.trim();
        if (pstdout) {
          try { preObj = JSON.parse(pstdout); } catch (e) { preObj = pstdout; }
          preSeq = preObj && preObj.SequenceNumber ? Number(preObj.SequenceNumber) : 0;
        }
      } catch (preErr) {
        console.log('[Restore Point] Pre-check error:', preErr.message || preErr);
        preSeq = 0;
      }

      const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Checkpoint-Computer -Description '${safeDesc}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop"`;
      await execAsync(cmd, { shell: true });

      const postCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ComputerRestorePoint | Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1 | ConvertTo-Json -Compress"`;
      try {
        const postRes = await execAsync(postCmd, { shell: true, timeout: 10000 });
        const pstdout = postRes.stdout.trim();
        let postObj = null;
        let postSeq = 0;
        if (pstdout) {
          try { postObj = JSON.parse(pstdout); } catch (e) { postObj = pstdout; }
          postSeq = postObj && postObj.SequenceNumber ? Number(postObj.SequenceNumber) : 0;
        }

        if (postSeq > preSeq) {
          return { success: true, message: 'System restore point created successfully', verify: { preSeq, postSeq, description: descWithTs, postObj } };
        } else {
          console.log('[Restore Point] No new restore point detected. preSeq:', preSeq, 'postSeq:', postSeq);
          return { success: false, message: 'A system restore point already exists. You can safely apply tweaks', debug: { preObj, postObj } };
        }
      } catch (postErr) {
        console.log('[Restore Point] Post-check error:', postErr.message || postErr);
        return { success: false, message: 'Restore point created but verification failed. Check System Restore settings.', debug: { preObj, postError: postErr.message || postErr } };
      }
    } catch (error) {
      console.log('[Restore Point] Error creating restore point:', error);
      return { success: false, message: 'Could not create restore point. You may need admin privileges. ' + (error.message || '') };
    }
  });

  // Apply tweaks
  ipcMain.handle('tweak:apply-irq-priority', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'IRQ8Priority' -Value 1 -Type DWord -Force; $val = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'IRQ8Priority').IRQ8Priority; Write-Host "Created: IRQ8Priority = $val"`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'IRQ Priority tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-network-interrupts', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters' -Name 'ProcessorThrottleMode' -Value 1 -Type DWord -Force; Write-Host 'Network Interrupts applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Network Interrupts tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-gpu-scheduling', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value 2 -Type DWord -Force; Write-Host 'GPU Scheduling applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'GPU Scheduling tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-tdr-level', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'TdrLevel' -Value 0 -Type DWord -Force; Write-Host 'TdrLevel applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'TdrLevel tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });
  ipcMain.handle('tweak:apply-gdrv-policy', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR')) { New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR' -Name 'AllowGameDVR' -Value 0 -Type DWord -Force; $val = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR' -Name 'AllowGameDVR' -ErrorAction Stop).AllowGameDVR; if ($val -ne 0) { throw 'AllowGameDVR value verification failed'; }`;      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'AllowGameDVR policy tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error applying AllowGameDVR policy: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-appcapture-disabled', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR')) { New-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Name 'AppCaptureEnabled' -Value 0 -Type DWord -Force; $val = (Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Name 'AppCaptureEnabled' -ErrorAction Stop).AppCaptureEnabled; if ($val -ne 0) { throw 'AppCaptureEnabled value verification failed'; }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'AppCaptureEnabled tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error applying AppCaptureEnabled tweak: ${error.message}` };
    }
  });
  ipcMain.handle('tweak:apply-fse-behavior-mode', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKCU:\\System\\GameConfigStore')) { New-Item -Path 'HKCU:\\System\\GameConfigStore' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMode' -Value 2 -Type DWord -Force; $val = (Get-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMode' -ErrorAction Stop).GameDVR_FSEBehaviorMode; if ($val -ne 2) { throw 'GameDVR_FSEBehaviorMode value verification failed'; }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Fullscreen Optimization system tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error applying fullscreen optimization system tweak: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-overlay-test-mode', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -Value 5 -Type DWord -Force; $val = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -ErrorAction Stop).OverlayTestMode; if ($val -ne 5) { throw 'OverlayTestMode value verification failed'; }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'OverlayTestMode tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error applying OverlayTestMode tweak: ${error.message}` };
    }
  });
  ipcMain.handle('tweak:apply-fullscreen-optimization', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKCU:\\System\\GameConfigStore')) { New-Item -Path 'HKCU:\\System\\GameConfigStore' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMonitorEnabled' -Value 0 -Type DWord -Force; Write-Host 'Fullscreen Optimization applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Fullscreen Optimization tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-usb-suspend', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' -Name 'DisableSelectiveSuspend' -Value 1 -Type DWord -Force; Write-Host 'USB Suspend applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'USB Suspend tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-game-dvr', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKCU:\\System\\GameConfigStore')) { New-Item -Path 'HKCU:\\System\\GameConfigStore' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Value 0 -Type DWord -Force; Write-Host 'Game DVR applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Game DVR tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-win32-priority', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 38 -Type DWord -Force; Write-Host 'Win32 Priority applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Win32 Priority tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-games-priority', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'Priority' -Value 6 -Type DWord -Force; Write-Host 'Games Priority applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Games Priority tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-large-system-cache', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name 'LargeSystemCache' -Value 1 -Type DWord -Force; Write-Host 'LargeSystemCache applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Large System Cache tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-network-throttling-index', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name 'NetworkThrottlingIndex' -Value ([uint32]4294967295) -Type DWord -Force; Write-Host 'NetworkThrottlingIndex applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Network Throttling disabled successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  // WPFTweaks: Revert new Windows Start Menu via ViVeTool script
  ipcMain.handle('tweak:apply-revert-startmenu', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const path = require('path');
      const fs = require('fs');
      const os = require('os');
      const fileName = 'WPFTweaksRevertStartMenu.ps1';
      const candidates = [
        path.resolve(__dirname, '..', 'scripts', fileName),
        path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', fileName),
        path.resolve(process.resourcesPath || '', 'scripts', fileName),
        path.resolve(process.resourcesPath || '', 'app.asar', 'scripts', fileName),
        path.resolve(process.cwd(), 'scripts', fileName),
      ];
      let scriptPath = null;
      for (const p of candidates) {
        try { if (fs.existsSync(p)) { scriptPath = p; break; } } catch (e) { }
      }
      if (!scriptPath) {
        return { success: false, message: `Script not found in expected locations. Place ${fileName} in the repo 'scripts' folder or add it to the installer (app.asar.unpacked). Searched: ${candidates.join(', ')}` };
      }

      // If the script is inside an asar archive, extract to a temp file so PowerShell can run it.
      let tmpFileToCleanup = null;
      try {
        if (scriptPath.includes('.asar') && !scriptPath.includes('.asar.unpacked')) {
          const tmpFile = path.join(os.tmpdir(), `gs_wpftweaks_${process.pid}_${Date.now()}.ps1`);
          const content = fs.readFileSync(scriptPath, 'utf8');
          fs.writeFileSync(tmpFile, content, 'utf8');
          tmpFileToCleanup = tmpFile;
          scriptPath = tmpFile;
        }
        await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { shell: true, timeout: 0 });
      } finally {
        if (tmpFileToCleanup) {
          try { fs.unlinkSync(tmpFileToCleanup); } catch (_) { }
        }
      }
      _tweakCheckCache = null;
      return { success: true, message: 'WPFTweaksRevertStartMenu script executed (apply).' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:reset-revert-startmenu', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const path = require('path');
      const fs = require('fs');
      const os = require('os');
      const fileName = 'WPFTweaksRevertStartMenu.ps1';
      const undoFileName = 'WPFTweaksRevertStartMenuUndo.ps1';
      const candidates = [
        path.resolve(__dirname, '..', 'scripts', undoFileName),
        path.resolve(__dirname, '..', 'scripts', fileName),
        path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', undoFileName),
        path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', fileName),
        path.resolve(process.resourcesPath || '', 'scripts', undoFileName),
        path.resolve(process.resourcesPath || '', 'scripts', fileName),
        path.resolve(process.cwd(), 'scripts', undoFileName),
        path.resolve(process.cwd(), 'scripts', fileName),
      ];

      let execPath = null;
      let execArgs = null;
      // prefer explicit undo script if present
      for (const p of candidates) {
        try { if (fs.existsSync(p)) {
          if (p.toLowerCase().endsWith(undoFileName.toLowerCase())) {
            execPath = p; execArgs = [];
            break;
          }
          if (!execPath && p.toLowerCase().endsWith(fileName.toLowerCase())) {
            execPath = p; execArgs = ['-Undo'];
          }
        } } catch (e) { }
      }
      if (!execPath) {
        return { success: false, message: 'No undo script found. Add WPFTweaksRevertStartMenuUndo.ps1 or ensure WPFTweaksRevertStartMenu.ps1 supports -Undo and is available in scripts.' };
      }

      let tmpFileToCleanup = null;
      try {
        if (execPath.includes('.asar') && !execPath.includes('.asar.unpacked')) {
          const tmpFile = path.join(os.tmpdir(), `gs_wpftweaks_${process.pid}_${Date.now()}.ps1`);
          const content = fs.readFileSync(execPath, 'utf8');
          fs.writeFileSync(tmpFile, content, 'utf8');
          tmpFileToCleanup = tmpFile;
          execPath = tmpFile;
        }
        const argStr = execArgs && execArgs.length ? ` ${execArgs.join(' ')}` : '';
        await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${execPath}"${argStr}`, { shell: true, timeout: 0 });
      } finally {
        if (tmpFileToCleanup) {
          try { fs.unlinkSync(tmpFileToCleanup); } catch (_) { }
        }
      }
      _tweakCheckCache = null;
      return { success: true, message: 'WPFTweaksRevertStartMenu undo executed (reset).' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  // Check tweaks
  ipcMain.handle('tweak:check-irq-priority', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'irq', 1); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-network-interrupts', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'net', 1); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-gpu-scheduling', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'gpu', 2); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-tdr-level', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'tdr', 0); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-gdrv-policy', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'gdrvpolicy', 0); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-appcapture-disabled', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'appcap', 0); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });
  ipcMain.handle('tweak:check-fse-behavior-mode', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'fse-mode', 2); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-overlay-test-mode', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'dwm-overlay-test', 5); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-fullscreen-optimization', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'fse', 0); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-usb-suspend', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'usb', 1); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-game-dvr', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'dvr', 0); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-win32-priority', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'w32', 38); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-games-priority', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'gprio', 6); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-network-throttling-index', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'nti', 4294967295); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:check-large-system-cache', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'lsc', 1); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  // Reset tweaks
  ipcMain.handle('tweak:reset-games-priority', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'Priority' -Value 2 -Type DWord -Force`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Games Priority reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Games Priority - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-network-throttling-index', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name 'NetworkThrottlingIndex' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Network Throttling Index reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Network Throttling Index - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-large-system-cache', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name 'LargeSystemCache' -Value 0 -Type DWord -Force`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Large System Cache reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Large System Cache - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-irq-priority', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'IRQ8Priority' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'IRQ Priority reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset IRQ Priority - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-network-interrupts', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters' -Name 'ProcessorThrottleMode' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Network Interrupts reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Network Interrupts - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-gpu-scheduling', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'GPU Scheduling reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset GPU Scheduling - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-tdr-level', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'TdrLevel' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'TdrLevel reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset TdrLevel - Admin privileges required' }; }
  });
  ipcMain.handle('tweak:reset-gdrv-policy', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' -Name 'AllowGameDVR' -Force -ErrorAction Stop; if (Test-Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR') { if (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' -Name 'AllowGameDVR' -ErrorAction SilentlyContinue) { throw 'AllowGameDVR clearing failed'; } }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'AllowGameDVR policy reset to default' };
    } catch (error) { return { success: false, message: `Failed to reset AllowGameDVR policy: ${error.message}` }; }
  });

  ipcMain.handle('tweak:reset-appcapture-disabled', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Name 'AppCaptureEnabled' -Force -ErrorAction SilentlyContinue; if (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR') { $prop = (Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Name 'AppCaptureEnabled' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty AppCaptureEnabled -ErrorAction SilentlyContinue); if ($null -ne $prop) { throw 'AppCaptureEnabled clearing failed'; } }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'AppCaptureEnabled reset to default' };
    } catch (error) { return { success: false, message: `Failed to reset AppCaptureEnabled: ${error.message}` }; }
  });
  ipcMain.handle('tweak:reset-fse-behavior-mode', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMode' -Force -ErrorAction SilentlyContinue; $prop = (Get-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMode' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty GameDVR_FSEBehaviorMode -ErrorAction SilentlyContinue); if ($null -ne $prop) { throw 'GameDVR_FSEBehaviorMode clearing failed'; }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Fullscreen Optimization system tweak reset to default' };
    } catch (error) { return { success: false, message: `Failed to reset fullscreen optimization system tweak: ${error.message}` }; }
  });

  ipcMain.handle('tweak:reset-overlay-test-mode', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -Force -ErrorAction SilentlyContinue; $prop = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OverlayTestMode -ErrorAction SilentlyContinue); if ($null -ne $prop) { throw 'OverlayTestMode clearing failed'; }`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'OverlayTestMode reset to default' };
    } catch (error) { return { success: false, message: `Failed to reset OverlayTestMode: ${error.message}` }; }
  });

  ipcMain.handle('tweak:reset-fullscreen-optimization', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMonitorEnabled' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Fullscreen Optimization reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Fullscreen Optimization - Admin privileges required' }; }
  });

  // Preferences: Mouse acceleration, Start Menu recommendations, Settings Home visibility,
  // Bing search toggle and Dark Theme toggles.
  ipcMain.handle('pref:check-mouse-acceleration', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try {
  $p = Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed','MouseThreshold1','MouseThreshold2' -ErrorAction SilentlyContinue
  if ($p -ne $null) {
    $r.MouseSpeed = [int]($p.MouseSpeed)
    $r.MouseThreshold1 = [int]($p.MouseThreshold1)
    $r.MouseThreshold2 = [int]($p.MouseThreshold2)
  }
} catch { }
$r | ConvertTo-Json -Compress
      `, 4000);
      if (!raw) return { applied: false, exists: false, value: null };
      const parsed = JSON.parse(raw);
      const applied = parsed && parsed.MouseSpeed === 1 && parsed.MouseThreshold1 === 0 && parsed.MouseThreshold2 === 0;
      return { applied, exists: !!parsed, value: parsed };
    } catch (e) {
      return { applied: false, exists: false, value: null, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-mouse-acceleration', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const script = enable ? `
if (-not (Test-Path 'HKCU:\\Control Panel\\Mouse')) { New-Item -Path 'HKCU:\\Control Panel\\Mouse' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value 1 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value 0 -Force
Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed','MouseThreshold1','MouseThreshold2' | ConvertTo-Json -Compress
` : `
if (-not (Test-Path 'HKCU:\\Control Panel\\Mouse')) { New-Item -Path 'HKCU:\\Control Panel\\Mouse' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value 6 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value 10 -Force
Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed','MouseThreshold1','MouseThreshold2' | ConvertTo-Json -Compress
`;
      const res = await runPSScript(script, 6000);
      _tweakCheckCache = null;
      return { success: true, message: 'Mouse acceleration updated', value: res ? JSON.parse(res) : null };
    } catch (e) {
      return { success: false, message: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:check-startmenu-recommendations', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $r.HideRecommendedSection_PM = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection } catch {}
try { $r.IsEducationEnvironment = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education' -Name 'IsEducationEnvironment' -ErrorAction SilentlyContinue).IsEducationEnvironment } catch {}
try { $r.HideRecommendedSection_Explorer = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection } catch {}
$r | ConvertTo-Json -Compress
      `, 4000);
      if (!raw) return { applied: false, value: null };
      const parsed = JSON.parse(raw);
      const applied = (parsed.HideRecommendedSection_PM === 1) || (parsed.IsEducationEnvironment === 1) || (parsed.HideRecommendedSection_Explorer === 1);
      return { applied, value: parsed };
    } catch (e) {
      return { applied: false, value: null, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-startmenu-recommendations', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      if (!_isElevated) return { success: false, message: 'Administrator privileges required to modify Start Menu recommendation policies.' };
      const val = enable ? 1 : 0;
      const script = `
If (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start' -Force | Out-Null }
If (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education' -Force | Out-Null }
If (-not (Test-Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer')) { New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Force | Out-Null }
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start' -Name 'HideRecommendedSection' -Value ${val} -Type DWord -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education' -Name 'IsEducationEnvironment' -Value ${val} -Type DWord -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Name 'HideRecommendedSection' -Value ${val} -Type DWord -Force
$r = @{}
$r.HideRecommendedSection_PM = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection
$r.IsEducationEnvironment = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education' -Name 'IsEducationEnvironment' -ErrorAction SilentlyContinue).IsEducationEnvironment
$r.HideRecommendedSection_Explorer = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection
$r | ConvertTo-Json -Compress
`;
      const raw = await runPSScript(script, 8000);
      _tweakCheckCache = null;
      return { success: true, message: 'Start Menu recommendations updated', value: raw ? JSON.parse(raw) : null };
    } catch (e) {
      return { success: false, message: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:check-settings-home', async () => {
    try {
      const raw = await runPSScript(`
$r = @{ exists = $false; value = $null }
try {
  $p = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name 'SettingsPageVisibility' -ErrorAction SilentlyContinue
  if ($p -and ($p.PSObject.Properties.Name -contains 'SettingsPageVisibility')) { $r.exists = $true; $r.value = $p.SettingsPageVisibility }
} catch {}
$r | ConvertTo-Json -Compress
      `, 4000);
      if (!raw) return { exists: false, value: null };
      const parsed = JSON.parse(raw);
      return { exists: parsed.exists, value: parsed.value };
    } catch (e) {
      return { exists: false, value: null, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-settings-home', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const val = enable ? 'show:home' : 'hide:home';
      const script = `
If (-not (Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name 'SettingsPageVisibility' -Value '${val}' -Force
Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name 'SettingsPageVisibility' -ErrorAction SilentlyContinue | ConvertTo-Json -Compress
`;
      const raw = await runPSScript(script, 4000);
      _tweakCheckCache = null;
      return { success: true, message: 'Settings home visibility updated', value: raw ? JSON.parse(raw) : null };
    } catch (e) {
      return { success: false, message: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:check-bing-search', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $r.BingSearchEnabled = (Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search' -Name 'BingSearchEnabled' -ErrorAction SilentlyContinue).BingSearchEnabled } catch {}
$r | ConvertTo-Json -Compress
      `, 3000);
      if (!raw) return { exists: false, value: null };
      const parsed = JSON.parse(raw);
      return { exists: parsed.BingSearchEnabled !== undefined, value: parsed.BingSearchEnabled };
    } catch (e) {
      return { exists: false, value: null, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-bing-search', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      // Per mapping: Enabled = ON -> set BingSearchEnabled = 0, Disabled = OFF -> set to 1
      const val = enable ? 0 : 1;
      const script = `
If (-not (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search')) { New-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search' -Name 'BingSearchEnabled' -Value ${val} -Type DWord -Force
Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search' -Name 'BingSearchEnabled' -ErrorAction SilentlyContinue | ConvertTo-Json -Compress
`;
      const raw = await runPSScript(script, 4000);
      _tweakCheckCache = null;
      return { success: true, message: 'Bing Search preference updated', value: raw ? JSON.parse(raw) : null };
    } catch (e) {
      return { success: false, message: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:check-dark-theme', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $p = Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'AppsUseLightTheme','SystemUsesLightTheme' -ErrorAction SilentlyContinue; $r.AppsUseLightTheme = $p.AppsUseLightTheme; $r.SystemUsesLightTheme = $p.SystemUsesLightTheme } catch {}
$r | ConvertTo-Json -Compress
      `, 3000);
      if (!raw) return { exists: false, value: null };
      const parsed = JSON.parse(raw);
      const applied = (parsed.AppsUseLightTheme === 0 && parsed.SystemUsesLightTheme === 0);
      return { applied, exists: parsed.AppsUseLightTheme !== undefined || parsed.SystemUsesLightTheme !== undefined, value: parsed };
    } catch (e) {
      return { applied: false, exists: false, value: null, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-dark-theme', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const val = enable ? 0 : 1; // 0 = dark, 1 = light
      const script = `
If (-not (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize')) { New-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'AppsUseLightTheme' -Value ${val} -Type DWord -Force
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'SystemUsesLightTheme' -Value ${val} -Type DWord -Force
Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'AppsUseLightTheme','SystemUsesLightTheme' -ErrorAction SilentlyContinue | ConvertTo-Json -Compress
`;
      const raw = await runPSScript(script, 4000);
      _tweakCheckCache = null;
      return { success: true, message: 'Theme preference updated', value: raw ? JSON.parse(raw) : null };
    } catch (e) {
      return { success: false, message: e.message || String(e) };
    }
  });

  ipcMain.handle('tweak:reset-usb-suspend', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' -Name 'DisableSelectiveSuspend' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'USB Suspend reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset USB Suspend - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-game-dvr', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Game DVR reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Game DVR - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-win32-priority', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 2 -Type DWord -Force`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Win32 Priority reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Win32 Priority - Admin privileges required' }; }
  });
  ipcMain.handle('tweak:apply-memory-compression', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Disable-MMAgent -mc`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Memory compression disabled successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:check-memory-compression', async () => {
    try { return _tweakResult(await _runAllTweakChecks(), 'mc', 0); }
    catch (error) { return { applied: false, exists: false, value: null, error: error.message || String(error) }; }
  });

  ipcMain.handle('tweak:reset-memory-compression', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const cmd = `Enable-MMAgent -mc`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Memory compression enabled successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  // ──────────────────────────────────────────────────────────────
  // SYSTEM REPAIR — ChkDsk / SFC / DISM
  // ──────────────────────────────────────────────────────────────

  ipcMain.handle('repair:run-sfc', async (event) => {
    if (!_isElevated) {
      return { success: false, message: 'Administrator privileges required to run SFC. Please restart the app as administrator.' };
    }

    const sendLine = (line) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('repair:progress', { tool: 'sfc', line });
        }
      } catch (_) {}
    };

    repairOverlay.setActiveRepair('sfc', 'System File Checker', '#00F2FF');
    sendLine('SFC scan starting...');
    sendLine('Initializing System File Checker. This may take a moment.');

    return new Promise((resolve) => {
      let ptyProcess;
      try {
        const pty = require('node-pty');
        ptyProcess = pty.spawn('sfc.exe', ['/scannow'], {
          name: 'xterm',
          cols: 140,
          rows: 40,
          cwd: process.env.SystemRoot || 'C:\\Windows',
          env: process.env,
          useConpty: true,
        });
      } catch (e) {
        repairOverlay.clearActiveRepair();
        resolve({ success: false, message: 'PTY unavailable: ' + e.message });
        return;
      }

      _activeRepairProc = ptyProcess;
      _activeRepairTool = 'sfc';
      let fullOutput = '';
      let lineBuffer = '';

      ptyProcess.onData((data) => {
        // Strip ANSI/VT escape sequences produced by the PTY
        const clean = data
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC (title, hyperlink, etc.)
          .replace(/\x1b\[[\?]?[\d;]*[A-Za-z]/g, '')          // CSI sequences incl. private (?25h, ?1004h, etc.)
          .replace(/\x1b[()][AB012]/g, '')                     // Charset designations
          .replace(/\x1b[ABCDEFGHJKSTM]/g, '')                 // Single-char escape sequences
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/\0/g, '');

        // Buffer across chunks so fragmented lines (e.g. "B" + "eginning...") are joined
        lineBuffer += clean;
        const parts = lineBuffer.split('\n');
        // Keep the last (potentially incomplete) fragment in the buffer
        lineBuffer = parts.pop();
        parts.forEach(raw => {
          const line = raw.trim();
          if (!line) return;
          fullOutput += line + '\n';
          sendLine(line);
          // Parse SFC progress and forward to overlay
          const sfcMatch = line.match(/verification\s+(\d+)%\s+complete/i);
          if (sfcMatch) {
            repairOverlay.pushProgress({ progress: parseInt(sfcMatch[1], 10), line });
          } else {
            repairOverlay.pushProgress({ line });
          }
        });
      });

      ptyProcess.onExit(({ exitCode }) => {
        // Flush any remaining buffered text
        if (lineBuffer.trim()) {
          fullOutput += lineBuffer.trim() + '\n';
          sendLine(lineBuffer.trim());
        }
        _activeRepairProc = null;
        _activeRepairTool = null;
        const success = exitCode === 0;
        repairOverlay.pushProgress({
          progress: 100,
          status: success ? 'done' : 'error',
          line: success ? 'SFC scan completed.' : 'SFC scan finished with errors.',
        });
        resolve({
          success,
          message: fullOutput.trim() || (success ? 'SFC scan completed successfully.' : 'SFC scan finished with errors.'),
        });
      });
    });
  });

  ipcMain.handle('repair:run-dism', async (event) => {
    if (!_isElevated) {
      return { success: false, message: 'Administrator privileges required to run DISM. Please restart the app as administrator.' };
    }
    const { spawn } = require('child_process');

    const sendLine = (line) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('repair:progress', { tool: 'dism', line });
        }
      } catch (_) {}
    };

    repairOverlay.setActiveRepair('dism', 'Windows Image Repair', '#a78bfa');
    sendLine('DISM scan starting...');
    sendLine('Initializing Windows image repair. This may take 20-40 minutes.');

    return new Promise((resolve) => {
      const proc = spawn('DISM', [
        '/Online', '/Cleanup-Image', '/RestoreHealth',
      ], { windowsHide: true, shell: true });

      _activeRepairProc = proc;
      _activeRepairTool = 'dism';
      let fullOutput = '';
      const dismProgressRe = /^\[.*?([\d.]+)%.*\]|^\[.*?\]\s*([\d.]+)%|^\s*([\d.]+)%\s*$/i;
      const handleData = (buffer) => {
        const raw = buffer.toString('utf8').replace(/\r/g, '').replace(/\0/g, '');
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach(line => {
          fullOutput += line + '\n';
          sendLine(line);
          // Parse DISM progress and forward to overlay
          const m = line.match(dismProgressRe);
          if (m) {
            const pct = parseFloat(m[1] ?? m[2] ?? m[3]);
            if (!isNaN(pct)) {
              repairOverlay.pushProgress({ progress: Math.round(pct), line });
              return;
            }
          }
          repairOverlay.pushProgress({ line });
        });
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);
      proc.on('close', (code) => {
        _activeRepairProc = null;
        _activeRepairTool = null;
        const success = code === 0;
        repairOverlay.pushProgress({
          progress: 100,
          status: success ? 'done' : 'error',
          line: success ? 'DISM RestoreHealth completed.' : 'DISM finished with errors.',
        });
        resolve({
          success,
          message: fullOutput.trim() || (success ? 'DISM RestoreHealth completed successfully.' : 'DISM finished with errors.'),
        });
      });
      proc.on('error', (err) => {
        _activeRepairProc = null;
        _activeRepairTool = null;
        repairOverlay.pushProgress({ status: 'error', line: err.message });
        resolve({ success: false, message: err.message });
      });
    });
  });

  ipcMain.handle('repair:run-chkdsk', async (event) => {
    if (!_isElevated) {
      return { success: false, message: 'Administrator privileges required to schedule ChkDsk. Please restart the app as administrator.' };
    }
    const { spawn } = require('child_process');

    const sendLine = (line) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('repair:progress', { tool: 'chkdsk', line });
        }
      } catch (_) {}
    };

    repairOverlay.setActiveRepair('chkdsk', 'Disk Corruption Scan', '#f59e0b');
    sendLine('ChkDsk starting...');
    sendLine('Scheduling disk corruption scan on C:');

    return new Promise((resolve) => {
      const proc = spawn('cmd', ['/c', 'echo Y | chkdsk C: /F /R'], {
        windowsHide: true,
        shell: true,
      });

      _activeRepairProc = proc;
      _activeRepairTool = 'chkdsk';
      let fullOutput = '';
      const handleData = (buffer) => {
        const raw = buffer.toString('utf8').replace(/\r/g, '').replace(/\0/g, '');
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach(line => {
          fullOutput += line + '\n';
          sendLine(line);
          // Parse chkdsk progress (e.g. "12 percent complete")
          const pctMatch = line.match(/(\d+)\s+percent\s+complete/i);
          if (pctMatch) {
            repairOverlay.pushProgress({ progress: parseInt(pctMatch[1], 10), line });
          } else {
            repairOverlay.pushProgress({ line });
          }
        });
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);
      proc.on('close', (code) => {
        _activeRepairProc = null;
        _activeRepairTool = null;
        const summary = fullOutput.trim() || 'ChkDsk has been scheduled for the next system restart.';
        repairOverlay.pushProgress({
          progress: 100,
          status: 'done',
          line: 'ChkDsk completed.',
        });
        resolve({ success: true, message: summary });
      });
      proc.on('error', (err) => {
        _activeRepairProc = null;
        _activeRepairTool = null;
        repairOverlay.pushProgress({ status: 'error', line: err.message });
        resolve({ success: false, message: err.message });
      });
    });
  });


} // end registerIPC

module.exports = { init, registerIPC };

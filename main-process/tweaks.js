/**
 * Tweaks Module
 * Performance tweaks apply/check/reset + restore point creation.
 */

const { ipcMain } = require('electron');
const { execAsync, execFileAsync, runPSScript } = require('./utils');
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
  ipcMain.handle('pref:check-revert-startmenu', async () => {
    try {
      const path = require('path');
      const fs = require('fs');
      const candidates = [
        path.resolve(__dirname, '..', 'scripts', 'vivetool', 'ViVeTool.exe'),
        path.resolve(process.resourcesPath || '', 'scripts', 'vivetool', 'ViVeTool.exe'),
        path.resolve(process.cwd(), 'scripts', 'vivetool', 'ViVeTool.exe'),
      ];
      let viveToolPath = null;
      for (const p of candidates) {
        if (fs.existsSync(p)) { viveToolPath = p; break; }
      }
      if (!viveToolPath) return { applied: false };
      
      const res = await execAsync(`"${viveToolPath}" /query /id:47205210`, { timeout: 4000 });
      const stdout = res.stdout || '';
      // If Disabled, the tweak is ON
      const applied = stdout.includes('State           : Disabled (1)');
      return { applied, value: stdout };
    } catch (e) {
      return { applied: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-revert-startmenu', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const path = require('path');
      const fs = require('fs');

      const vivetoolCandidates = [
        path.resolve(__dirname, '..', 'scripts', 'vivetool', 'ViVeTool.exe'),
        path.resolve(process.resourcesPath || '', 'scripts', 'vivetool', 'ViVeTool.exe'),
        path.resolve(process.cwd(), 'scripts', 'vivetool', 'ViVeTool.exe'),
      ];

      let viveToolPath = null;
      for (const p of vivetoolCandidates) {
        if (fs.existsSync(p)) { viveToolPath = p; break; }
      }

      if (!viveToolPath) {
        return { success: false, message: 'ViVeTool not found in expected locations.' };
      }

      // If enable is undefined (called from cleaner menu), default to true (apply tweak).
      const shouldApply = enable !== false;

      // The Electron app already runs elevated, so call ViVeTool directly — no window spawn needed.
      const action = shouldApply ? '/disable' : '/enable';
      await execFileAsync(viveToolPath, [action, '/id:47205210']);

      return { success: true, message: `Classic Start Menu ${shouldApply ? 'Enabled' : 'Disabled'}`, applied: shouldApply };
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
      // acceleration ON = Speed:1, Threshold1:6, Threshold2:10 (ChrisTitus DefaultState=true)
      const applied = parsed && parsed.MouseSpeed === 1 && parsed.MouseThreshold1 === 6 && parsed.MouseThreshold2 === 10;
      return { applied, exists: !!parsed, value: parsed };
    } catch (e) {
      return { applied: false, exists: false, value: null, error: e.message || String(e) };
    }
  });

  ipcMain.handle('pref:apply-mouse-acceleration', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      // enable=true = acceleration ON (Speed:1,T1:6,T2:10)  enable=false = acceleration OFF (Speed:0,T1:0,T2:0)
      const script = enable ? `
if (-not (Test-Path 'HKCU:\\Control Panel\\Mouse')) { New-Item -Path 'HKCU:\\Control Panel\\Mouse' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value 1 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value 6 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value 10 -Force
Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed','MouseThreshold1','MouseThreshold2' | ConvertTo-Json -Compress
` : `
if (-not (Test-Path 'HKCU:\\Control Panel\\Mouse')) { New-Item -Path 'HKCU:\\Control Panel\\Mouse' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value 0 -Force
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value 0 -Force
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
try { $r.HideRecommendedSection_Explorer = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection } catch {}
# Self-heal: remove IsEducationEnvironment if it exists (legacy key that wipes pinned apps)
try { Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education' -Name 'IsEducationEnvironment' -ErrorAction SilentlyContinue } catch {}
try { Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Edu' -Name 'IsEducationEnvironment' -ErrorAction SilentlyContinue } catch {}
try {
  $edPath = 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education'
  if ((Test-Path $edPath) -and ((Get-Item $edPath).ValueCount -eq 0)) { Remove-Item $edPath -Force -ErrorAction SilentlyContinue }
} catch {}
$r | ConvertTo-Json -Compress
      `, 4000);
      if (!raw) return { applied: false, value: null };
      const parsed = JSON.parse(raw);
      const applied = (parsed.HideRecommendedSection_PM === 1) || (parsed.HideRecommendedSection_Explorer === 1);
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
If (-not (Test-Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer')) { New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Force | Out-Null }
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start' -Name 'HideRecommendedSection' -Value ${val} -Type DWord -Force
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Name 'HideRecommendedSection' -Value ${val} -Type DWord -Force
# Clean up IsEducationEnvironment from all known locations — this key causes pinned apps to be wiped
try { Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education' -Name 'IsEducationEnvironment' -ErrorAction SilentlyContinue } catch {}
try { Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Edu' -Name 'IsEducationEnvironment' -ErrorAction SilentlyContinue } catch {}
try {
  $edPath = 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Education'
  if ((Test-Path $edPath) -and ((Get-Item $edPath).ValueCount -eq 0)) { Remove-Item $edPath -Force -ErrorAction SilentlyContinue }
} catch {}
$r = @{}
$r.HideRecommendedSection_PM = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection
$r.HideRecommendedSection_Explorer = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer' -Name 'HideRecommendedSection' -ErrorAction SilentlyContinue).HideRecommendedSection
$r | ConvertTo-Json -Compress
`;
      const raw = await runPSScript(script, 8000);
      // Restart Explorer so the Start menu picks up the registry change immediately
      try {
        const { execSync } = require('child_process');
        execSync('taskkill /F /IM explorer.exe', { windowsHide: true });
        execSync('start explorer.exe', { shell: true, windowsHide: true });
      } catch (_) { /* best-effort */ }
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
      if (!raw) return { applied: false, exists: false, value: null };
      const parsed = JSON.parse(raw);
      // applied=true means bing is DISABLED (the tweak is applied); BingSearchEnabled=0
      const applied = parsed.BingSearchEnabled === 0;
      return { applied, exists: parsed.BingSearchEnabled !== undefined, value: parsed.BingSearchEnabled };
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

  // ──────────────────────────────────────────────────────────────
  // SYSTEM REPAIR — Network Adapter Reset
  // ──────────────────────────────────────────────────────────────

  ipcMain.handle('repair:run-netreset', async (event) => {
    if (!_isElevated) {
      return { success: false, message: 'Administrator privileges required to reset network stack. Please restart the app as administrator.' };
    }

    const sendLine = (line) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('repair:progress', { tool: 'netreset', line });
        }
      } catch (_) {}
    };

    const steps = [
      { label: 'Flushing DNS Cache',           cmd: 'ipconfig /flushdns' },
      { label: 'Resetting Winsock Catalog',     cmd: 'netsh winsock reset' },
      { label: 'Resetting TCP/IP Stack',        cmd: 'netsh int ip reset' },
      { label: 'Releasing IP Address',           cmd: 'ipconfig /release' },
      { label: 'Renewing IP Address',            cmd: 'ipconfig /renew' },
    ];

    sendLine('Network stack reset starting...');
    sendLine(`Running ${steps.length} steps sequentially.`);
    sendLine('');

    const results = [];
    let allSuccess = true;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      sendLine(`[${i + 1}/${steps.length}] ${step.label}...`);
      sendLine(`> ${step.cmd}`);
      try {
        const { stdout, stderr } = await execAsync(step.cmd, { timeout: 30000, shell: true });
        const output = (stdout || '').trim();
        if (output) {
          output.split('\n').forEach(l => { if (l.trim()) sendLine('  ' + l.trim()); });
        }
        if (stderr && stderr.trim()) {
          stderr.trim().split('\n').forEach(l => { if (l.trim()) sendLine('  [warn] ' + l.trim()); });
        }
        sendLine(`  ✓ ${step.label} — OK`);
        results.push({ step: step.label, success: true });
      } catch (err) {
        const msg = (err.stdout || err.message || '').trim();
        if (msg) sendLine('  ' + msg);
        sendLine(`  ✗ ${step.label} — FAILED`);
        results.push({ step: step.label, success: false, error: msg });
        allSuccess = false;
      }
      sendLine('');
    }

    const passed = results.filter(r => r.success).length;
    sendLine('─'.repeat(40));
    sendLine(`Network reset complete: ${passed}/${steps.length} steps succeeded.`);
    if (!allSuccess) {
      sendLine('Some steps failed. A system reboot may be needed for full effect.');
    } else {
      sendLine('All steps completed successfully. Network stack has been reset.');
    }

    return {
      success: allSuccess,
      message: `Network reset complete: ${passed}/${steps.length} steps succeeded.`,
    };
  });


  ipcMain.handle('pref:check-center-taskbar', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarAl' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskbarAl\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "1", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-center-taskbar', async (event, enable) => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const val = enable ? 1 : 0;
      await execAsync(`powershell -Command "if (!(Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarAl' -Value ${val} -Type DWord"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: "Center Taskbar preference updated." };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-cross-device', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $r.IsResumeAllowed = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CrossDeviceResume\\Configuration' -Name 'IsResumeAllowed' -ErrorAction SilentlyContinue).IsResumeAllowed } catch {}
$r | ConvertTo-Json -Compress
      `, 3000);
      if (!raw) return { applied: false, value: null };
      const parsed = JSON.parse(raw);
      // applied=true = cross-device enabled (IsResumeAllowed=1, DefaultState=true in ChrisTitus)
      return { applied: parsed.IsResumeAllowed === 1, value: parsed.IsResumeAllowed };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-cross-device', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const val = enable ? 1 : 0;
      const script = `
If (-not (Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CrossDeviceResume\\Configuration')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CrossDeviceResume\\Configuration' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CrossDeviceResume\\Configuration' -Name 'IsResumeAllowed' -Value ${val} -Type DWord -Force
`;
      await runPSScript(script, 5000);
      return { success: true, applied: !!enable, message: 'Cross-Device Resume preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-detailed-bsod', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $r.DisplayParameters = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Name 'DisplayParameters' -ErrorAction SilentlyContinue).DisplayParameters } catch {}
try { $r.DisableEmoticon = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Name 'DisableEmoticon' -ErrorAction SilentlyContinue).DisableEmoticon } catch {}
$r | ConvertTo-Json -Compress
      `, 3000);
      if (!raw) return { applied: false, value: null };
      const parsed = JSON.parse(raw);
      const applied = parsed.DisplayParameters === 1 && parsed.DisableEmoticon === 1;
      return { applied, value: parsed };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-detailed-bsod', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const val = enable ? 1 : 0;
      const script = `
If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Force | Out-Null }
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Name 'DisplayParameters' -Value ${val} -Type DWord -Force
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CrashControl' -Name 'DisableEmoticon' -Value ${val} -Type DWord -Force
`;
      await runPSScript(script, 5000);
      return { success: true, applied: !!enable, message: 'Detailed BSoD preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-mpo', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OverlayTestMode\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "5", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-mpo', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      // enable=true = MPO disabled (OverlayTestMode=5); OriginalValue=<RemoveEntry> so undo removes the key
      const script = enable
        ? `If (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -Value 5 -Type DWord -Force`
        : `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -Force -ErrorAction SilentlyContinue`;
      await runPSScript(script, 5000);
      return { success: true, applied: !!enable, message: 'MPO preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-modern-standby', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Power' -Name 'PlatformAoAcOverride' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PlatformAoAcOverride\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "0", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-modern-standby', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      // enable=true = S3 sleep forced (PlatformAoAcOverride=0); OriginalValue=<RemoveEntry> so undo removes the key
      const script = enable
        ? `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Name 'PlatformAoAcOverride' -Value 0 -Type DWord -Force`
        : `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Name 'PlatformAoAcOverride' -Force -ErrorAction SilentlyContinue`;
      await runPSScript(script, 5000);
      return { success: true, applied: !!enable, message: 'Modern Standby preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-new-outlook', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $r.UseNewOutlook = (Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Name 'UseNewOutlook' -ErrorAction SilentlyContinue).UseNewOutlook } catch {}
try { $r.HideNewOutlookToggle = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Name 'HideNewOutlookToggle' -ErrorAction SilentlyContinue).HideNewOutlookToggle } catch {}
$r | ConvertTo-Json -Compress
      `, 3000);
      if (!raw) return { applied: false, value: null };
      const parsed = JSON.parse(raw);
      // applied=true = new outlook is visible (UseNewOutlook=1 OR HideToggle=0)
      const applied = parsed.UseNewOutlook === 1 || parsed.HideNewOutlookToggle === 0;
      return { applied, value: parsed };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-new-outlook', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      // enable=true = show new outlook (UseNewOutlook=1, HideToggle=0)
      // enable=false = hide new outlook (UseNewOutlook=0, HideToggle=1, disable auto-migration)
      const script = enable ? `
If (-not (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences')) { New-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Name 'UseNewOutlook' -Value 1 -Type DWord -Force
If (-not (Test-Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Name 'HideNewOutlookToggle' -Value 0 -Type DWord -Force
` : `
If (-not (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences')) { New-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Name 'UseNewOutlook' -Value 0 -Type DWord -Force
If (-not (Test-Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Name 'HideNewOutlookToggle' -Value 1 -Type DWord -Force
If (-not (Test-Path 'HKCU:\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Options\\General')) { New-Item -Path 'HKCU:\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Options\\General' -Name 'DoNewOutlookAutoMigration' -Value 0 -Type DWord -Force
If (-not (Test-Path 'HKCU:\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Preferences')) { New-Item -Path 'HKCU:\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Force | Out-Null }
Remove-ItemProperty -Path 'HKCU:\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Preferences' -Name 'NewOutlookMigrationUserSetting' -Force -ErrorAction SilentlyContinue
`;
      await runPSScript(script, 6000);
      return { success: true, applied: !!enable, message: 'New Outlook preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-numlock', async () => {
    try {
      const raw = await runPSScript(`
$r = @{}
try { $r.HKCU = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Keyboard' -Name 'InitialKeyboardIndicators' -ErrorAction SilentlyContinue).InitialKeyboardIndicators } catch {}
try { $r.HKU = (Get-ItemProperty -Path 'HKU:\\.Default\\Control Panel\\Keyboard' -Name 'InitialKeyboardIndicators' -ErrorAction SilentlyContinue).InitialKeyboardIndicators } catch {}
$r | ConvertTo-Json -Compress
      `, 3000);
      if (!raw) return { applied: false, value: null };
      const parsed = JSON.parse(raw);
      const applied = parsed.HKCU === '2' || parsed.HKU === '2';
      return { applied, value: parsed };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-numlock', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const val = enable ? '2' : '0';
      const script = `
If (-not (Test-Path 'HKCU:\\Control Panel\\Keyboard')) { New-Item -Path 'HKCU:\\Control Panel\\Keyboard' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Keyboard' -Name 'InitialKeyboardIndicators' -Value '${val}' -Type String -Force
If (Test-Path 'HKU:\\.Default\\Control Panel\\Keyboard') {
  Set-ItemProperty -Path 'HKU:\\.Default\\Control Panel\\Keyboard' -Name 'InitialKeyboardIndicators' -Value '${val}' -Type String -Force
}
`;
      await runPSScript(script, 5000);
      return { success: true, applied: !!enable, message: 'Num Lock startup preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-search-taskbar', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Search' -Name 'SearchboxTaskbarMode' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SearchboxTaskbarMode\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "3", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-search-taskbar', async (event, enable) => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const val = enable ? 3 : 0;
      await execAsync(`powershell -Command "if (!(Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Search')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Search' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Search' -Name 'SearchboxTaskbarMode' -Value ${val} -Type DWord"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: "Search Taskbar preference updated." };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-show-extensions', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'HideFileExt' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty HideFileExt\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "0", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-show-extensions', async (event, enable) => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const val = enable ? 0 : 1;
      await execAsync(`powershell -Command "if (!(Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'HideFileExt' -Value ${val} -Type DWord"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: "Show File Extensions updated." };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-show-hidden', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'Hidden' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Hidden\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "1", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-show-hidden', async (event, enable) => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      // enable=true = show hidden files (Hidden=1); disable = hide them (Hidden=0 per ChrisTitus OriginalValue)
      const val = enable ? 1 : 0;
      await execAsync(`powershell -Command "if (!(Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'Hidden' -Value ${val} -Type DWord"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: 'Show Hidden Files updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-sticky-keys', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -Name 'Flags' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Flags\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      // applied=true = sticky keys popup hotkey disabled (Flags=506, ChrisTitus default/applied state)
      return { applied: val === "506", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-sticky-keys', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      // enable=true = disable sticky keys hotkey popup (Flags=506 per ChrisTitus Value)
      // enable=false = restore original (Flags=58 per ChrisTitus OriginalValue)
      const val = enable ? "506" : "58";
      await execAsync(`powershell -Command "if (!(Test-Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys')) { New-Item -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -Name 'Flags' -Value '${val}' -Type String"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: 'Sticky Keys preference updated.' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-task-view', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'ShowTaskViewButton' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ShowTaskViewButton\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "1", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-task-view', async (event, enable) => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const val = enable ? 1 : 0;
      await execAsync(`powershell -Command "if (!(Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced')) { New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Force | Out-Null }; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'ShowTaskViewButton' -Value ${val} -Type DWord"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: "Task View button updated." };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:check-verbose-logon', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const res = await execAsync("powershell -Command \"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'VerboseStatus' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty VerboseStatus\"", { timeout: 3000 });
      const val = res.stdout ? res.stdout.trim() : "";
      return { applied: val === "1", value: val };
    } catch (e) { return { applied: false, error: String(e) }; }
  });
  ipcMain.handle('pref:apply-verbose-logon', async (event, enable) => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const val = enable ? 1 : 0;
      await execAsync(`powershell -Command "if (!(Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System')) { New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'VerboseStatus' -Value ${val} -Type DWord"`, { timeout: 8000 });
      return { success: true, applied: !!enable, message: "Verbose Status updated." };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  // ── GS Ultimate Performance Power Plan ──────────────────────────────────
  const GS_PLAN_NAME = 'GS Ultimate Performance';
  const ULTIMATE_PERF_BASE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
  const BALANCED_GUID = '381b4222-f694-41f0-9685-ff5bb260df2e';

  /** Returns the GUID of the GS plan if it exists, else null */
  async function _findGSPlanGuid() {
    const { exec } = require('child_process');
    const execAsync = require('util').promisify(exec);
    const res = await execAsync('powercfg /l', { timeout: 8000 });
    const regex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+\(([^)]+)\)/gi;
    let m;
    while ((m = regex.exec(res.stdout)) !== null) {
      if (m[2].trim() === GS_PLAN_NAME) return m[1];
    }
    return null;
  }

  ipcMain.handle('pref:check-gs-powerplan', async () => {
    try {
      const { exec } = require('child_process');
      const execAsync = require('util').promisify(exec);
      const guid = await _findGSPlanGuid();
      if (!guid) return { applied: false };
      // Check if it's the active plan
      const res = await execAsync('powercfg /getactivescheme', { timeout: 5000 });
      const applied = res.stdout.toLowerCase().includes(guid.toLowerCase());
      return { applied, guid };
    } catch (e) { return { applied: false, error: String(e) }; }
  });

  ipcMain.handle('pref:apply-gs-powerplan', async (event, enable) => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
    try {
      const { exec } = require('child_process');
      const execAsync = require('util').promisify(exec);

      if (!enable) {
        // Revert: switch to Balanced, delete all GS plan copies
        await execAsync(`powercfg -setactive ${BALANCED_GUID}`, { timeout: 8000 });
        let guid = await _findGSPlanGuid();
        while (guid) {
          try { await execAsync(`powercfg -delete ${guid}`, { timeout: 5000 }); } catch (_) {}
          guid = await _findGSPlanGuid();
        }
        return { success: true, applied: false, message: 'Reverted to Balanced power plan' };
      }

      // Check if already exists
      let guid = await _findGSPlanGuid();
      if (!guid) {
        // Duplicate the built-in Ultimate Performance scheme
        const dupeOut = await execAsync(`powercfg -duplicatescheme ${ULTIMATE_PERF_BASE_GUID}`, { timeout: 10000 });
        // Extract new GUID from output
        const newGuidMatch = dupeOut.stdout.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (!newGuidMatch) return { success: false, message: 'Failed to duplicate power scheme' };
        guid = newGuidMatch[1];
        // Rename to GS Ultimate Performance
        await execAsync(`powercfg -changename ${guid} "${GS_PLAN_NAME}" "Unlock Maximum performance for gaming"`, { timeout: 8000 });
      }

      // Set as active
      await execAsync(`powercfg -setactive ${guid}`, { timeout: 8000 });
      return { success: true, applied: true, message: `${GS_PLAN_NAME} power plan activated` };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:add-ultimate-performance', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      await execAsync('powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61', { timeout: 10000 });
      const res = await execAsync('powercfg /l', { timeout: 10000 });
      const match = res.stdout.match(/([0-9a-f\-]{36})\s+\(Ultimate Performance\)/i);
      if (match) {
        await execAsync(`powercfg -setactive ${match[1]}`, { timeout: 10000 });
        return { success: true, message: 'Ultimate Performance Profile Added & Activated' };
      }
      return { success: false, message: 'Could not find profile' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

  ipcMain.handle('pref:remove-ultimate-performance', async () => {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      await execAsync('powercfg -setactive 381b4222-f694-41f0-9685-ff5bb260df2e', { timeout: 5000 });
      const res = await execAsync('powercfg /l', { timeout: 10000 });
      const matches = [...res.stdout.matchAll(/([0-9a-f\-]{36})\s+\(Ultimate Performance\)/gi)];
      for (const m of matches) {
        await execAsync(`powercfg -delete ${m[1]}`, { timeout: 5000 });
      }
      return { success: true, message: 'Ultimate Performance Profiles Removed' };
    } catch (e) { return { success: false, message: String(e) }; }
  });

} // end registerIPC

module.exports = { init, registerIPC };

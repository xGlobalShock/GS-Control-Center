/**
 * Tweaks Module
 * Performance tweaks apply/check/reset + restore point creation.
 */

const { ipcMain } = require('electron');
const { execAsync, runPSScript } = require('./utils');

let _isElevated = false;
let _tweakCheckCache = null;
let _tweakCheckAge = 0;

function init({ isElevated }) {
  _isElevated = isElevated;
}

async function _runAllTweakChecks() {
  if (_tweakCheckCache && (Date.now() - _tweakCheckAge < 2000)) return _tweakCheckCache;

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
ChkReg 'fse' 'HKCU:\\System\\GameConfigStore' 'GameDVR_FSEBehaviorMonitorEnabled'
ChkReg 'usb' 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' 'DisableSelectiveSuspend'
ChkReg 'dvr' 'HKCU:\\System\\GameConfigStore' 'GameDVR_Enabled'
ChkReg 'w32' 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' 'Win32PrioritySeparation'
$r | ConvertTo-Json -Compress
    `, 6000);

    if (raw) {
      _tweakCheckCache = JSON.parse(raw);
      _tweakCheckAge = Date.now();
      return _tweakCheckCache;
    }
  } catch (e) {
    console.warn('[TweakCheck] Consolidated check error:', e.message);
  }
  return null;
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
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value 2 -Type DWord -Force; Write-Host 'GPU Scheduling applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'GPU Scheduling tweak applied successfully' };
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  ipcMain.handle('tweak:apply-fullscreen-optimization', async () => {
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
    try {
      const cmd = `If (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 38 -Type DWord -Force; Write-Host 'Win32 Priority applied'`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Win32 Priority tweak applied successfully' };
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

  // Reset tweaks
  ipcMain.handle('tweak:reset-irq-priority', async () => {
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'IRQ8Priority' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'IRQ Priority reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset IRQ Priority - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-network-interrupts', async () => {
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters' -Name 'ProcessorThrottleMode' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Network Interrupts reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Network Interrupts - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-gpu-scheduling', async () => {
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'GPU Scheduling reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset GPU Scheduling - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-fullscreen-optimization', async () => {
    try {
      const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMonitorEnabled' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Fullscreen Optimization reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Fullscreen Optimization - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-usb-suspend', async () => {
    try {
      const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' -Name 'DisableSelectiveSuspend' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'USB Suspend reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset USB Suspend - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-game-dvr', async () => {
    try {
      const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Force -ErrorAction Stop`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Game DVR reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Game DVR - Admin privileges required' }; }
  });

  ipcMain.handle('tweak:reset-win32-priority', async () => {
    try {
      const cmd = `Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 2 -Type DWord -Force`;
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      _tweakCheckCache = null;
      return { success: true, message: 'Win32 Priority reset to default' };
    } catch (error) { return { success: false, message: 'Failed to reset Win32 Priority - Admin privileges required' }; }
  });

} // end registerIPC

module.exports = { init, registerIPC };

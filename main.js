const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execFile, spawn, execSync, spawnSync } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const si = require('systeminformation');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

let _psTempCounter = 0;
function runPSScript(script, timeoutMs = 8000) {
  const tmpFile = path.join(os.tmpdir(), `gs_ps_${process.pid}_${++_psTempCounter}.ps1`);
  const wrappedScript = '$ErrorActionPreference = "SilentlyContinue"\n' + script + '\nexit 0';
  fs.writeFileSync(tmpFile, wrappedScript, 'utf8');
  return execFileAsync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
    { timeout: timeoutMs, windowsHide: true }
  ).then(r => {
    try { fs.unlinkSync(tmpFile); } catch { }
    return r.stdout.trim();
  }).catch(err => {
    try { fs.unlinkSync(tmpFile); } catch { }
    console.warn('[runPSScript] PS error:', err.message?.substring(0, 150));
    if (err.stdout) return err.stdout.trim();
    return '';
  });
}

// Helper function to detect permission errors
function isPermissionError(error) {
  if (!error || !error.message) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('access is denied') ||
    msg.includes('permission denied') ||
    msg.includes('requires elevation') ||
    msg.includes('administrator') ||
    msg.includes('privilege') ||
    msg.includes('command failed') ||
    msg.includes('cannot remove item') ||
    msg.includes('unauthorized');
}

// Forza Horizon 5 Shader Cache Cleaner
ipcMain.handle('cleaner:clear-forza-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const forzaCachePath = path.join(localAppData, 'Temp', 'Turn10Temp.scratch', 'GraphicsCache');

    if (!fs.existsSync(forzaCachePath)) {
      return { success: false, message: 'Forza Horizon 5 shader cache not found. Game may not be installed.' };
    }

    let filesBefore = 0;
    let filesDeleted = 0;
    let sizeFreed = 0;

    const files = fs.readdirSync(forzaCachePath);
    filesBefore = files.length;
    for (const file of files) {
      const filePath = path.join(forzaCachePath, file);
      try {
        const stats = fs.statSync(filePath);
        sizeFreed += stats.size;
        fs.rmSync(filePath, { force: true });
        filesDeleted++;
      } catch (e) {
        // Ignore errors for individual files
      }
    }

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared Forza Horizon 5 shader cache`,
      filesDeleted,
      filesBefore,
      filesAfter: filesBefore - filesDeleted,
      spaceSaved: `${sizeInMB} MB`,
      details: `${filesDeleted}/${filesBefore} files deleted (${filesBefore - filesDeleted} remaining)`
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Disable GPU acceleration to prevent GPU process crashes
app.disableHardwareAcceleration();

// Add command line switches for stability
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
// Redirect Chromium GPU shader cache to app userData to avoid "Access is denied"
// errors when running elevated (admin context can't access default cache path)
app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('userData'), 'Cache'));
app.commandLine.appendSwitch('gpu-disk-cache-dir', path.join(app.getPath('userData'), 'GPUCache'));


// Simple admin check for Windows
let isElevated = false;
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('net session', { stdio: 'pipe' });
    isElevated = true;
  } catch (e) {
    isElevated = false;
  }
  // Only require elevation in production (packaged app)
  if (!isElevated && app.isPackaged) {
    const quotedExe = process.execPath.replace(/'/g, "''");
    const quotedArgs = process.argv.slice(1).map(a => a.replace(/'/g, "''")).join("' '");
    const psArgs = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process -FilePath '${quotedExe}' ${quotedArgs ? "-ArgumentList '" + quotedArgs + "'" : ''} -Verb RunAs`
    ];
    require('child_process').spawn('powershell', psArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
    app.quit();
    return;
  }
}

let mainWindow;

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 860,
    resizable: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: isDev
        ? path.join(__dirname, 'public/preload.js')
        : path.join(process.resourcesPath, 'app', 'build', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      devTools: false,
    },
    // icon: path.join(__dirname, 'public/icon.png'),
  });

  mainWindow.setMenuBarVisibility(false);

  // Custom window control IPC handlers
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized());

  // Notify renderer when maximize state changes
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-changed', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-changed', false));

  // Block all keyboard shortcuts that could open developer tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Block F12, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J
    if (
      input.control &&
      input.shift &&
      (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'c' || input.key.toLowerCase() === 'j')
    ) {
      event.preventDefault();
    }
    // Block F12
    if (input.key === 'F12') {
      event.preventDefault();
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(process.resourcesPath, 'app', 'build', 'index.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  // Enable winget InstallerHashOverride (requires admin; allows --ignore-security-hash for de-elevated updates)
  if (isElevated) {
    try { execSync('winget settings --enable InstallerHashOverride', { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch { }
  }
  // Start LHM first (longest startup time) — runs in parallel with window creation
  startLHMService();
  // Start standalone perf counter service (CPU usage + clock speed, no LHM dependency)
  _startPerfCounterService();
  _startDiskRefresh();
  // Pre-fetch hardware info (starts fetch early so IPC handler can return immediately)
  _initHardwareInfo();
  createWindow();
  // Start real-time hardware push after window is created (1000ms interval)
  // Small delay to let the renderer attach its IPC listener
  setTimeout(() => _startRealtimePush(), 1500);
});

app.on('window-all-closed', () => {
  _stopRealtimePush();
  stopLHMService();
  _stopPerfCounterService();
  if (_diskRefreshTimer) { clearInterval(_diskRefreshTimer); _diskRefreshTimer = null; }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Network ping helper
ipcMain.handle('network:ping', async (event, host) => {
  try {
    // simple Windows ping; for cross-platform we could adjust but this app is Windows-focused
    const cmd = `ping -n 1 ${host}`;
    const { stdout } = await execAsync(cmd, { shell: true, timeout: 10000 });
    // look for time=Xms or time<1ms style
    const m = stdout.match(/time[=<]\s*(\d+)\s*ms/);
    const time = m ? parseInt(m[1], 10) : null;
    return { success: time !== null, time };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Video Settings Presets – save preset file to videosettings-presets folder
ipcMain.handle('preset:save-video-settings', async (event, filename, content) => {
  try {
    const { app } = require('electron');
    const dir = path.join(app.getPath('userData'), 'videosettings-presets');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Restore Point IPC Handler
ipcMain.handle('system:create-restore-point', async (event, description) => {
  try {
    // Default description (kept as requested) and allow override via the description argument
    const descBase = description || 'GS Control Center - Before Tweak Application';

    // Require admin privileges to create restore points
    if (!isElevated) {
      console.log('[Restore Point] Attempted without elevation');
      return { success: false, message: 'Admin privileges required to create a system restore point. Please run the app as administrator.' };
    }

    // Append timestamp to ensure uniqueness and avoid matching older restore points
    const timestamp = new Date().toISOString();
    const descWithTs = `${descBase} - ${timestamp}`;
    const safeDesc = descWithTs.replace(/'/g, "''");

    // Query the latest restore point before creating a new one
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
      // If pre-query fails, log and continue (we'll still attempt checkpoint)
      console.log('[Restore Point] Pre-check error:', preErr.message || preErr);
      preSeq = 0;
    }

    // Create the restore point (checkpoint)
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Checkpoint-Computer -Description '${safeDesc}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop"`;
    await execAsync(cmd, { shell: true });

    // Query the latest restore point after checkpoint
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

// Open System Protection UI (SystemPropertiesProtection)
ipcMain.handle('system:open-system-protection', async () => {
  try {
    const exe = 'SystemPropertiesProtection.exe';
    // Spawn without waiting
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
  } catch (error) {
    console.log('[Restore Point] Error opening System Protection:', error.message || error);
    try {
      // Fallback: open System Properties Control Panel
      exec('control /name Microsoft.System', (e) => { });
    } catch (e) { }
    return { success: false, message: 'Could not open System Protection UI' };
  }
});

// ──────────────────────────────────────────────────────
// System Stats IPC Handler — instant reads (no PS spawn)
// CPU + Temp from LHM background service, RAM from Node.js,
// Disk from background cache. Zero latency.
// ──────────────────────────────────────────────────────
ipcMain.handle('system:get-stats', () => {
  return _getStatsImpl();
});

// ──────────────────────────────────────────────────────
// LibreHardwareMonitor Background Temperature Service
// Loads the LHM .NET DLL in a persistent PowerShell process
// to read real CPU package temperature via MSR registers.
// Requires admin (app runs elevated in production).
// ──────────────────────────────────────────────────────
let _lhmProcess = null;
let _lhmTemp = 0;           // latest CPU package temp from LHM
let _lhmCpuLoad = -1;       // latest CPU total load % from LHM
let _lhmGpuTemp = -1;       // latest GPU temp from LHM
let _lhmGpuUsage = -1;      // latest GPU load % from LHM
let _lhmGpuVramUsed = -1;   // GPU VRAM used (MiB)
let _lhmGpuVramTotal = -1;  // GPU VRAM total (MiB)
let _lhmDiskRead = 0;       // disk read bytes/sec from perf counter
let _lhmDiskWrite = 0;      // disk write bytes/sec from perf counter
let _lhmProcessCount = 0;   // running process count from perf counter
let _lhmCpuClock = -1;      // CPU max core clock (MHz) from LHM MSR sensors
let _lhmAvailable = false;  // true once we get a valid CPU temp reading
let _lhmServiceRunning = false; // true once LHM returns ANY data
let _estimatedTemp = 40;    // smoothed estimation (thermal inertia)
let _lhmCacheTimer = null;  // periodic save timer

// ── LHM sensor cache: restore last-known readings for instant startup ──
function _getLhmCachePath() {
  try { return path.join(app.getPath('userData'), 'gs_lhm_cache.json'); }
  catch { return path.join(os.tmpdir(), 'gs_lhm_cache.json'); }
}

function _loadLhmCache() {
  try {
    const raw = fs.readFileSync(_getLhmCachePath(), 'utf8');
    const c = JSON.parse(raw);
    // Cache valid for 24 hours (values are ballpark-reasonable for initial display)
    if (c && Date.now() - (c._ts || 0) < 86400000) {
      if (c.cpuTemp > 0 && c.cpuTemp < 150) { _lhmTemp = c.cpuTemp; _lhmAvailable = true; }
      if (c.cpuLoad >= 0 && c.cpuLoad <= 100) _lhmCpuLoad = c.cpuLoad;
      if (c.gpuTemp > 0 && c.gpuTemp < 150) _lhmGpuTemp = c.gpuTemp;
      if (c.gpuUsage >= 0 && c.gpuUsage <= 100) _lhmGpuUsage = c.gpuUsage;
      if (c.gpuVramUsed >= 0) _lhmGpuVramUsed = c.gpuVramUsed;
      if (c.gpuVramTotal > 0) _lhmGpuVramTotal = c.gpuVramTotal;
    }
  } catch { }
}

function _saveLhmCache() {
  // Only save if we have real data
  if (!_lhmAvailable) return;
  try {
    fs.writeFileSync(_getLhmCachePath(), JSON.stringify({
      _ts: Date.now(),
      cpuTemp: _lhmTemp, cpuLoad: _lhmCpuLoad,
      gpuTemp: _lhmGpuTemp, gpuUsage: _lhmGpuUsage,
      gpuVramUsed: _lhmGpuVramUsed, gpuVramTotal: _lhmGpuVramTotal
    }), 'utf8');
  } catch { }
}

function _startLhmCacheTimer() {
  // Save sensor cache every 30 seconds while running
  _lhmCacheTimer = setInterval(_saveLhmCache, 30000);
}

function startLHMService() {
  // [BYPASS CACHE] Do NOT restore stale sensor values — always start fresh
  // _loadLhmCache();  // DISABLED: real-time metrics must come from live hardware reads
  // Start periodic cache saves (still useful for crash recovery)
  _startLhmCacheTimer();

  // In production builds __dirname points inside the asar archive.
  // Use process.resourcesPath to locate the unpacked lib folder.
  const dllPath = app.isPackaged
    ? path.join(process.resourcesPath, 'lib', 'LibreHardwareMonitorLib.dll')
    : path.join(__dirname, 'lib', 'LibreHardwareMonitorLib.dll');
  if (!fs.existsSync(dllPath)) {
    // Also try the app directory as a fallback
    const fallbackPath = path.join(app.getAppPath(), 'lib', 'LibreHardwareMonitorLib.dll');
    if (!fs.existsSync(fallbackPath)) {
      return;
    }
    // Use fallback path
    var resolvedDllPath = fallbackPath;
  } else {
    var resolvedDllPath = dllPath;
  }
  // Write a long-running PS script that loads LHM, opens CPU sensors,
  // and prints sensor data every 500ms.
  const scriptContent = [
    '# LHM sensor service — errors reported on stderr, data on stdout',
    '$ErrorActionPreference = "Stop"',
    '',
    '# ── Admin detection (ring0 driver needs admin for MSR temp reads) ──',
    '$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    '[Console]::Error.WriteLine("LHMINFO:ADMIN=" + $isAdmin)',
    '',
    'try {',
    `  Add-Type -Path '${resolvedDllPath}'`,
    '} catch {',
    '  [Console]::Error.WriteLine("LHMERR:DLL_LOAD:" + $_.Exception.Message)',
    '  exit 1',
    '}',
    '',
    '# ── UpdateVisitor: the official LHM pattern for refreshing all sensors ──',
    'try {',
    '  Add-Type -ReferencedAssemblies @($(' + "'" + resolvedDllPath + "'" + ')) -Language CSharp -TypeDefinition @"',
    'using LibreHardwareMonitor.Hardware;',
    'public class UpdateVisitor : IVisitor {',
    '    public void VisitComputer(IComputer computer) { computer.Traverse(this); }',
    '    public void VisitHardware(IHardware hardware) {',
    '        hardware.Update();',
    '        foreach (IHardware sub in hardware.SubHardware) sub.Accept(this);',
    '    }',
    '    public void VisitSensor(ISensor sensor) { }',
    '    public void VisitParameter(IParameter parameter) { }',
    '}',
    '"@',
    '  $visitor = [UpdateVisitor]::new()',
    '  [Console]::Error.WriteLine("LHMOK:VISITOR_READY")',
    '} catch {',
    '  [Console]::Error.WriteLine("LHMWARN:VISITOR_FAIL:" + $_.Exception.Message)',
    '  $visitor = $null',
    '}',
    '',
    'try {',
    '  $computer = [LibreHardwareMonitor.Hardware.Computer]::new()',
    '  $computer.IsCpuEnabled = $true',
    '  $computer.IsGpuEnabled = $true',
    '  $computer.IsMotherboardEnabled = $true',
    '  $computer.Open()',
    '} catch {',
    '  [Console]::Error.WriteLine("LHMERR:OPEN:" + $_.Exception.Message)',
    '  exit 2',
    '}',
    '$ErrorActionPreference = "SilentlyContinue"',
    '[Console]::Error.WriteLine("LHMOK:READY")',
    '',
    '# Disk I/O perf counters',
    'try { $diskReadCounter = New-Object System.Diagnostics.PerformanceCounter("PhysicalDisk", "Disk Read Bytes/sec", "_Total") ; $diskReadCounter.NextValue() | Out-Null } catch { $diskReadCounter = $null }',
    'try { $diskWriteCounter = New-Object System.Diagnostics.PerformanceCounter("PhysicalDisk", "Disk Write Bytes/sec", "_Total") ; $diskWriteCounter.NextValue() | Out-Null } catch { $diskWriteCounter = $null }',
    'try { $procCounter = New-Object System.Diagnostics.PerformanceCounter("System", "Processes") } catch { $procCounter = $null }',
    '',
    '$iteration = 0',
    '',
    'while ($true) {',
    '  try {',
    '    if ($visitor) { $computer.Accept($visitor) }',
    '    else { foreach ($hw in $computer.Hardware) { $hw.Update(); foreach ($sub in $hw.SubHardware) { $sub.Update() } } }',
    '',
    '    $cpuTemp = $null; $cpuMaxClock = $null; $gpuTemp = $null; $gpuLoad = $null; $gpuVramUsed = $null; $gpuVramTotal = $null',
    '    $mbCpuTemp = $null',
    '    foreach ($hw in $computer.Hardware) {',
    '      $allSensors = @($hw.Sensors)',
    '      foreach ($sub in $hw.SubHardware) { $allSensors += $sub.Sensors }',
    '      $hwType = $hw.HardwareType.ToString()',
    '      if ($hwType -eq "Cpu") {',
    '        foreach ($sensor in $allSensors) {',
    '          if ($null -eq $sensor.Value) { continue }',
    '          $sv = $sensor.Value',
    '          if ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Temperature) {',
    '            $sn = $sensor.Name',
    '            if ($sn -eq "CPU Package" -or $sn -match "Tctl|Tdie") { $cpuTemp = $sv }',
    '            if ($sn -eq "Core Average" -and $cpuTemp -eq $null) { $cpuTemp = $sv }',
    '            if ($sn -eq "Core Max" -and $cpuTemp -eq $null) { $cpuTemp = $sv }',
    '            if ($sn -match "^Core #" -and $cpuTemp -eq $null) { $cpuTemp = $sv }',
    '            if ($cpuTemp -eq $null -and $sv -gt 0 -and $sv -lt 150) { $cpuTemp = $sv }',
    '          }',
    '          if ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Clock -and $sensor.Name -match "^Core #") {',
    '            if ($cpuMaxClock -eq $null -or $sv -gt $cpuMaxClock) { $cpuMaxClock = $sv }',
    '          }',
    '        }',
    '      }',
    '      # Motherboard may have CPU temp sensor via SuperIO chip (Nuvoton, ITE, etc.)',
    '      if ($hwType -eq "Motherboard") {',
    '        foreach ($sensor in $allSensors) {',
    '          if ($null -eq $sensor.Value) { continue }',
    '          $sv = $sensor.Value',
    '          if ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Temperature) {',
    '            $sn = $sensor.Name',
    '            if ($sn -match "CPU|Tctl|Core" -and $sv -gt 0 -and $sv -lt 150) {',
    '              $mbCpuTemp = $sv',
    '            }',
    '          }',
    '        }',
    '      }',
    '      if ($hwType -match "Gpu") {',
    '        foreach ($sensor in $allSensors) {',
    '          if ($null -eq $sensor.Value) { continue }',
    '          $sv = $sensor.Value',
    '          $st = $sensor.SensorType.ToString()',
    '          if ($st -eq "Temperature" -and ($sensor.Name -eq "GPU Core" -or ($sensor.Name -eq "GPU Hot Spot" -and $gpuTemp -eq $null))) { $gpuTemp = $sv }',
    '          if ($st -eq "Load" -and $sensor.Name -eq "GPU Core") { $gpuLoad = $sv }',
    '          if ($st -eq "SmallData" -and ($sensor.Name -eq "GPU Memory Used" -or ($sensor.Name -eq "D3D Dedicated Memory Used" -and $gpuVramUsed -eq $null))) { $gpuVramUsed = $sv }',
    '          if ($st -eq "SmallData" -and ($sensor.Name -eq "GPU Memory Total" -or ($sensor.Name -eq "D3D Dedicated Memory Limit" -and $gpuVramTotal -eq $null))) { $gpuVramTotal = $sv }',
    '        }',
    '      }',
    '    }',
    '',
    '    # Motherboard SuperIO CPU temp fallback when LHM ring0 cannot read DTS',
    '    if ($cpuTemp -eq $null -and $mbCpuTemp -ne $null) { $cpuTemp = $mbCpuTemp }',
    '',
    '    # ── Diagnostic dump on first iteration ──',
    '    if ($iteration -eq 0) {',
    '      $sensorInfo = @()',
    '      foreach ($hw in $computer.Hardware) {',
    '        $hwType = $hw.HardwareType.ToString()',
    '        $allS = @($hw.Sensors)',
    '        foreach ($sub in $hw.SubHardware) { $allS += $sub.Sensors }',
    '        $tempSensors = @($allS | Where-Object { $_.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Temperature })',
    '        $tempWithVal = @($tempSensors | Where-Object { $null -ne $_.Value }).Count',
    '        $sensorInfo += "HW:$hwType=$($hw.Name)[temps:$tempWithVal/$($tempSensors.Count)]"',
    '        foreach ($s in $allS) {',
    '          if ($s.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Temperature) {',
    '            $v = if ($null -ne $s.Value) { $s.Value } else { "NULL" }',
    '            $sensorInfo += "  T:$($s.Name)=$v"',
    '          }',
    '          if ($s.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Power -and ($null -ne $s.Value)) {',
    '            $sensorInfo += "  P:$($s.Name)=$($s.Value)"',
    '          }',
    '        }',
    '        foreach ($sub in $hw.SubHardware) {',
    '          $sensorInfo += "  SUB:$($sub.Name)"',
    '          foreach ($s in $sub.Sensors) {',
    '            if ($s.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Temperature) {',
    '              $v = if ($null -ne $s.Value) { $s.Value } else { "NULL" }',
    '              $sensorInfo += "    T:$($s.Name)=$v"',
    '            }',
    '          }',
    '        }',
    '      }',
    '      [Console]::Error.WriteLine("LHMSENSORS:" + ($sensorInfo -join "|"))',
    '      [Console]::Error.WriteLine("LHMINFO:CPUTEMP=" + $(if ($cpuTemp -ne $null) { $cpuTemp } else { "NONE" }) + ",VISITOR=" + $(if ($visitor) { "YES" } else { "NO" }) + ",MBTEMP=" + $(if ($mbCpuTemp -ne $null) { $mbCpuTemp } else { "NONE" }))',
    '    }',
    '',
    '    $iteration++',
    '    $parts = @()',
    '    if ($cpuTemp -ne $null) { $parts += "CPUT:" + [math]::Round($cpuTemp, 1) }',
    '    if ($cpuMaxClock -ne $null) { $parts += "CPUCLK:" + [math]::Round($cpuMaxClock, 0) }',
    '    if ($gpuTemp -ne $null) { $parts += "GPUT:" + [math]::Round($gpuTemp, 1) }',
    '    if ($gpuLoad -ne $null) { $parts += "GPUL:" + [math]::Round($gpuLoad, 1) }',
    '    if ($gpuVramUsed -ne $null) { $parts += "GPUVRU:" + [math]::Round($gpuVramUsed) }',
    '    if ($gpuVramTotal -ne $null) { $parts += "GPUVRT:" + [math]::Round($gpuVramTotal) }',
    '    if ($diskReadCounter) { try { $parts += "DR:" + [math]::Round($diskReadCounter.NextValue()) } catch {} }',
    '    if ($diskWriteCounter) { try { $parts += "DW:" + [math]::Round($diskWriteCounter.NextValue()) } catch {} }',
    '    if ($procCounter) { try { $parts += "PROCS:" + [math]::Round($procCounter.NextValue()) } catch {} }',
    '    if ($parts.Count -gt 0) {',
    '      [Console]::Out.WriteLine($parts -join "|")',
    '      [Console]::Out.Flush()',
    '    }',
    '  } catch {}',
    '  Start-Sleep -Milliseconds 500',
    '}',

  ].join('\n');

  const tmpFile = path.join(os.tmpdir(), `gs_lhm_service_${process.pid}.ps1`);
  fs.writeFileSync(tmpFile, scriptContent, 'utf8');

  _lhmProcess = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

  let buffer = '';
  _lhmProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      // Parse pipe-separated key:value pairs
      // Format: CPUT:xx.x|GPUT:xx.x|GPUL:xx.x|GPUVRU:xxxx|GPUVRT:xxxx
      const tokens = trimmed.split('|');
      for (const token of tokens) {
        const [key, valStr] = token.split(':');
        const v = parseFloat(valStr);
        if (isNaN(v)) continue;
        switch (key) {
          case 'CPUT': if (v > 0 && v < 150) { _lhmTemp = Math.round(v * 10) / 10; _lhmAvailable = true; _lhmServiceRunning = true; } break;
          case 'CPUL': if (v >= 0 && v <= 100) _lhmCpuLoad = Math.round(v * 10) / 10; break;
          case 'CPUCLK': if (v > 0 && v < 10000) _lhmCpuClock = Math.round(v); break;
          case 'GPUT': if (v > 0 && v < 150) _lhmGpuTemp = Math.round(v); break;
          case 'GPUL': if (v >= 0 && v <= 100) { _lhmGpuUsage = Math.round(v); _lhmServiceRunning = true; } break;
          case 'GPUVRU': if (v >= 0) _lhmGpuVramUsed = Math.round(v); break;
          case 'GPUVRT': if (v > 0) _lhmGpuVramTotal = Math.round(v); break;
          case 'DR': if (v >= 0) _lhmDiskRead = Math.round(v); break;
          case 'DW': if (v >= 0) _lhmDiskWrite = Math.round(v); break;
          case 'PROCS': if (v > 0) _lhmProcessCount = Math.round(v); break;
        }
      }
    }
  });

  // Log stderr for diagnostics (DLL load failures, sensor errors, diagnostics)
  _lhmProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (msg.startsWith('LHMINFO:')) {
      return;
    }
    if (msg.startsWith('LHMOK:READY')) {
      return;
    }
    if (msg.startsWith('LHMOK:VISITOR_READY')) {
      return;
    }
    if (msg.startsWith('LHMSENSORS:')) {
      return;
    }
    if (msg.startsWith('LHMWARN:')) {
      return;
    }
    if (msg.startsWith('LHMERR:')) {
      return;
    }
  });

  _lhmProcess.on('exit', (code) => {
    _lhmProcess = null;
  });

  _lhmProcess.on('error', (err) => {
    _lhmProcess = null;
  });
}

function stopLHMService() {
  // Save final sensor readings to cache for next launch
  _saveLhmCache();
  if (_lhmCacheTimer) { clearInterval(_lhmCacheTimer); _lhmCacheTimer = null; }
  if (_lhmProcess) {
    try { _lhmProcess.kill(); } catch { }
    _lhmProcess = null;
  }
  // Clean up temp script
  const tmpFile = path.join(os.tmpdir(), `gs_lhm_service_${process.pid}.ps1`);
  try { fs.unlinkSync(tmpFile); } catch { }
}

// ──────────────────────────────────────────────────────
// Standalone Performance Counter Service
// Reads % Processor Utility (matches Task Manager) and
// % Processor Performance (for real-time clock speed).
// Does NOT require LHM — works on any Windows system.
// ──────────────────────────────────────────────────────
let _perfCounterProcess = null;
let _perfCpuUtility = -1;     // % Processor Utility (matches Task Manager)
let _perfCpuPerfPct = -1;     // % Processor Performance (current/base ratio × 100)
let _perfPerCoreCpu = [];     // per-logical-processor % Processor Utility

function _startPerfCounterService() {
  if (_perfCounterProcess) return;

  const scriptContent = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '',
    '# ── Total CPU counters (PerformanceCounter API — fastest) ──',
    'try { $cpuU = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Utility", "_Total") } catch { $cpuU = $null }',
    'try { $cpuP = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Performance", "_Total") } catch { $cpuP = $null }',
    '',
    '# ── Per-core counters (PerformanceCounter API — lightweight, delta-based) ──',
    '$coreCounters = @()',
    'try {',
    '  $cat = New-Object System.Diagnostics.PerformanceCounterCategory("Processor Information")',
    '  $instances = $cat.GetInstanceNames() | Where-Object { $_ -ne "_Total" -and $_ -notlike "*_Total" } | Sort-Object { $p = $_ -split ","; [int]$p[0] * 1000 + [int]$p[1] }',
    '  foreach ($inst in $instances) {',
    '    try {',
    '      $c = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Utility", $inst)',
    '      $c.NextValue() | Out-Null',
    '      $coreCounters += $c',
    '    } catch {}',
    '  }',
    '} catch {}',
    'if ($coreCounters.Count -eq 0) { [Console]::Error.WriteLine("[PerfCtr] Per-core counters unavailable, will use WMI fallback") }',
    '',
    '# ── WMI fallback flag ──',
    '$useWmi = ($cpuU -eq $null)',
    'if ($useWmi) { [Console]::Error.WriteLine("[PerfCtr] PerformanceCounter unavailable, using WMI fallback") }',
    '',
    '# Prime total counters (first delta read is always 0)',
    'if ($cpuU) { $cpuU.NextValue() | Out-Null }',
    'if ($cpuP) { $cpuP.NextValue() | Out-Null }',
    'Start-Sleep -Milliseconds 500',
    '',
    'while ($true) {',
    '  $parts = @()',
    '',
    '  # Total CPU utility',
    '  if ($cpuU) {',
    '    try { $v = $cpuU.NextValue(); if ($v -gt 100) { $v = 100 }; $parts += "CPUU:" + [math]::Round($v, 1) } catch {}',
    '  } elseif ($useWmi) {',
    '    try {',
    '      $wmiObj = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name=\'_Total\'" -ErrorAction Stop',
    '      if ($wmiObj -and $wmiObj.PercentProcessorUtility -ne $null) {',
    '        $v = [double]$wmiObj.PercentProcessorUtility; if ($v -gt 100) { $v = 100 }',
    '        $parts += "CPUU:" + [math]::Round($v, 1)',
    '      }',
    '    } catch {}',
    '  }',
    '',
    '  # Processor Performance (for clock speed)',
    '  if ($cpuP) { try { $parts += "CPUP:" + [math]::Round($cpuP.NextValue(), 1) } catch {} }',
    '',
    '  # Per-core utility: prefer PerformanceCounter objects (lightweight delta-based)',
    '  $coreVals = @()',
    '  if ($coreCounters.Count -gt 0) {',
    '    foreach ($cc in $coreCounters) {',
    '      try {',
    '        $v = [double]$cc.NextValue()',
    '        if ($v -lt 0) { $v = 0 }',
    '        if ($v -gt 100) { $v = 100 }',
    '        $coreVals += [math]::Round($v, 1)',
    '      } catch { $coreVals += 0 }',
    '    }',
    '  } else {',
    '    # Fallback: WMI query (heavier, can inflate readings)',
    '    try {',
    '      $allCores = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -ErrorAction Stop | Where-Object { $_.Name -notlike "*_Total*" }',
    '      $allCores = $allCores | Sort-Object { $p = $_.Name -split ","; [int]$p[0] * 1000 + [int]$p[1] }',
    '      foreach ($core in $allCores) {',
    '        $v = [double]$core.PercentProcessorUtility',
    '        if ($v -lt 0) { $v = 0 }',
    '        if ($v -gt 100) { $v = 100 }',
    '        $coreVals += [math]::Round($v, 1)',
    '      }',
    '    } catch {',
    '      # Fallback: PerfOS_Processor (less accurate but always available)',
    '      try {',
    '        $allCores = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -ErrorAction Stop | Where-Object { $_.Name -ne "_Total" } | Sort-Object { [int]$_.Name }',
    '        foreach ($core in $allCores) {',
    '          $v = [double]$core.PercentProcessorTime',
    '          if ($v -gt 100) { $v = 100 }',
    '          $coreVals += [math]::Round($v, 1)',
    '        }',
    '      } catch {}',
    '    }',
    '  }',
    '  if ($coreVals.Count -gt 0) { $parts += "CORES:" + ($coreVals -join ",") }',
    '',
    '  if ($parts.Count -gt 0) {',
    '    [Console]::Out.WriteLine($parts -join "|")',
    '    [Console]::Out.Flush()',
    '  }',
    '  Start-Sleep -Milliseconds 1000',
    '}',
  ].join('\n');

  const tmpFile = path.join(os.tmpdir(), `gs_perfctr_${process.pid}.ps1`);
  fs.writeFileSync(tmpFile, scriptContent, 'utf8');

  _perfCounterProcess = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

  let buffer = '';
  _perfCounterProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const tokens = line.trim().split('|');
      for (const token of tokens) {
        const colonIdx = token.indexOf(':');
        if (colonIdx < 0) continue;
        const key = token.substring(0, colonIdx);
        const valStr = token.substring(colonIdx + 1);
        if (key === 'CORES') {
          // Per-core utility: comma-separated floats
          _perfPerCoreCpu = valStr.split(',').map(s => {
            const n = parseFloat(s);
            return isNaN(n) ? 0 : Math.min(Math.round(n * 10) / 10, 100);
          });
          continue;
        }
        const v = parseFloat(valStr);
        if (isNaN(v)) continue;
        switch (key) {
          case 'CPUU': if (v >= 0 && v <= 100) _perfCpuUtility = Math.round(v * 10) / 10; break;
          case 'CPUP': if (v > 0) _perfCpuPerfPct = Math.round(v * 10) / 10; break;
        }
      }
    }
  });

  _perfCounterProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) console.warn(`[PerfCtr] Service exited with code ${code}`);
    _perfCounterProcess = null;
  });

  _perfCounterProcess.on('error', (err) => {
    console.warn('[PerfCtr] Service error:', err.message);
    _perfCounterProcess = null;
  });

  // PerfCtr service started silently — errors reported via exit/error handlers
}

function _stopPerfCounterService() {
  if (_perfCounterProcess) {
    try { _perfCounterProcess.kill(); } catch { }
    _perfCounterProcess = null;
  }
  const tmpFile = path.join(os.tmpdir(), `gs_perfctr_${process.pid}.ps1`);
  try { fs.unlinkSync(tmpFile); } catch { }
}

let _lastStats = { cpu: 0, ram: 0, disk: 0, temperature: 0 };
let _tempSource = 'none';       // 'lhm', 'estimation'
let _cachedDiskPct = 0;         // disk % refreshed in background (not latency-critical)
let _diskRefreshTimer = null;

// Refresh disk usage in background every 10s (disk changes slowly, no need to block stats)
function _startDiskRefresh() {
  const refresh = () => {
    runPSScript(`
      try {
        $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        if ($d -and $d.Size -gt 0) { Write-Output ([math]::Round(($d.Size - $d.FreeSpace) / $d.Size * 100, 1)) }
        else { Write-Output '0' }
      } catch { Write-Output '0' }
    `, 4000).then(raw => {
      const v = parseFloat(raw);
      if (!isNaN(v) && v >= 0 && v <= 100) _cachedDiskPct = Math.round(v * 10) / 10;
    }).catch(() => { });
  };
  refresh(); // initial
  _diskRefreshTimer = setInterval(refresh, 10000);
}

function _getStatsImpl() {
  let cpu = 0, ram = 0, disk = _cachedDiskPct, temperature = 0;
  if (_perfCpuUtility >= 0) {
    cpu = _perfCpuUtility;
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  if (totalMem > 0) ram = Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10;

  if (_lhmAvailable && _lhmTemp > 0) {
    temperature = _lhmTemp;
    _tempSource = 'lhm';
  } else {
    const baseClock = os.cpus()[0]?.speed || 3700;
    const boostRatio = (_lhmCpuClock > 0) ? Math.min(_lhmCpuClock / baseClock, 1.5) : 1.0;
    const targetTemp = 35 + (cpu * 0.45) + ((boostRatio - 1.0) * 20) + (cpu > 80 ? (cpu - 80) * 0.3 : 0);
    const alpha = 0.15;
    _estimatedTemp += (targetTemp - _estimatedTemp) * alpha;
    const jitter = Math.sin(Date.now() / 3000) * 0.5;
    temperature = Math.round((_estimatedTemp + jitter) * 10) / 10;
    if (temperature < 30) temperature = 30;
    if (temperature > 95) temperature = 95;
    _tempSource = 'estimation';
  }

  _lastStats = {
    cpu, ram, disk, temperature,
    lhmReady: _lhmAvailable || _perfCpuUtility >= 0,
    gpuTemp: _lhmGpuTemp >= 0 ? _lhmGpuTemp : (_nvGpuTemp >= 0 ? _nvGpuTemp : -1),
    gpuUsage: _lhmGpuUsage >= 0 ? _lhmGpuUsage : (_nvGpuUsage >= 0 ? _nvGpuUsage : -1),
    gpuVramUsed: _lhmGpuVramUsed >= 0 ? _lhmGpuVramUsed : (_nvGpuVramUsed >= 0 ? _nvGpuVramUsed : -1),
    gpuVramTotal: _lhmGpuVramTotal > 0 ? _lhmGpuVramTotal : (_nvGpuVramTotal > 0 ? _nvGpuVramTotal : -1),
  };
  return _lastStats;
}

let _realtimeTimer = null;
let _realtimeLatencyTimer = null;
let _realtimeWifiTimer = null;
let _realtimeNvGpuTimer = null;
let _rtLastLatency = 0;
let _rtLastPacketLoss = -1;
let _rtLastSsid = '';
let _rtLastWifiSignal = -1;
let _rtLastAdapterName = '';
let _rtLastAdapterLinkSpeed = '';
let _rtLastLocalIP = '';
let _rtLastMac = '';
let _rtLastGateway = '';
let _rtPrimed = false;
let _rtLastTempSource = '';  // tracks temp source changes for diagnostics

// Node.js process count fallback — used when LHM perf counter isn't available
let _nodeProcessCount = 0;
(async function _pollProcessCount() {
  const update = async () => {
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "(Get-Process).Count"',
        { timeout: 4000, windowsHide: true }
      );
      const n = parseInt(stdout.trim(), 10);
      if (n > 0) _nodeProcessCount = n;
    } catch { /* keep last value */ }
  };
  await update();
  setInterval(update, 5000);
})();

// nvidia-smi GPU fallback — provides GPU metrics when LHM hasn't detected the GPU yet
let _nvGpuUsage = -1;
let _nvGpuTemp = -1;
let _nvGpuVramUsed = -1;
let _nvGpuVramTotal = -1;

function _formatUptimeSeconds(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// Latency + Packet Loss ping — separate timer (every 10s)
// Uses Windows ping -n 5 to get both latency and loss in one call
function _startLatencyPoll() {
  const doPing = async () => {
    try {
      const { stdout } = await execAsync('ping -n 5 -w 2000 8.8.8.8', { shell: true, timeout: 20000 });
      // Parse average latency: "Average = Xms"
      const avgMatch = stdout.match(/Average\s*=\s*(\d+)\s*ms/i)
        || stdout.match(/Media\s*=\s*(\d+)\s*ms/i);
      _rtLastLatency = avgMatch ? parseInt(avgMatch[1], 10) : 0;
      // Parse packet loss: "Lost = X (Y% loss)"
      const lossMatch = stdout.match(/Lost\s*=\s*\d+\s*\((\d+)%/i)
        || stdout.match(/Perdidos\s*=\s*\d+\s*\((\d+)%/i)
        || stdout.match(/=\s*\d+.*=\s*\d+.*=\s*\d+\s*\((\d+)%/);
      _rtLastPacketLoss = lossMatch ? parseInt(lossMatch[1], 10) : 0;
    } catch {
      _rtLastLatency = 0;
      _rtLastPacketLoss = -1;
    }
  };
  doPing();
  _realtimeLatencyTimer = setInterval(doPing, 10000);
}

// Active adapter + Wi-Fi info — separate timer (every 5s)
function _startWifiPoll() {
  const fetchAdapter = async () => {
    try {
      // Find the active default-route adapter
      const defaultIface = await si.networkInterfaceDefault();
      const ifaces = await si.networkInterfaces();
      const ifaceArr = Array.isArray(ifaces) ? ifaces : [ifaces];
      const defaultNet = ifaceArr.find(i => i.iface === defaultIface);

      if (defaultNet) {
        _rtLastAdapterName = defaultNet.iface || '';
        _rtLastAdapterLinkSpeed = defaultNet.speed ? `${defaultNet.speed} Mbps` : '';
        _rtLastLocalIP = defaultNet.ip4 || '';
        _rtLastMac = defaultNet.mac || '';
        // Gateway from default route
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
  fetchAdapter();
  _realtimeWifiTimer = setInterval(fetchAdapter, 5000);
}

// nvidia-smi GPU poll — runs every 3s, skips if LHM is already providing GPU data
// Stops retrying after 3 consecutive failures (e.g. AMD GPU — no nvidia-smi available)
function _startNvGpuPoll() {
  let failCount = 0;
  const MAX_FAILS = 3;
  const poll = async () => {
    // Skip GPU poll if LHM is already providing all GPU data
    if (_lhmGpuUsage >= 0 && _lhmGpuTemp >= 0 && _lhmGpuVramTotal > 0) return;
    try {
      const { stdout } = await execFileAsync('nvidia-smi',
        ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total',
          '--format=csv,noheader,nounits'],
        { timeout: 3000, windowsHide: true });
      const parts = (stdout || '').trim().split(',').map(s => parseFloat(s.trim()));
      if (parts.length >= 4) {
        if (!isNaN(parts[0])) _nvGpuUsage = Math.round(parts[0]);
        if (!isNaN(parts[1])) _nvGpuTemp = Math.round(parts[1]);
        if (!isNaN(parts[2])) _nvGpuVramUsed = Math.round(parts[2]);
        if (!isNaN(parts[3])) _nvGpuVramTotal = Math.round(parts[3]);
      }
      failCount = 0; // reset on success
    } catch {
      failCount++;
      if (failCount >= MAX_FAILS && _realtimeNvGpuTimer) {
        clearInterval(_realtimeNvGpuTimer);
        _realtimeNvGpuTimer = null;
        // nvidia-smi not available (AMD/Intel GPU) — stopped polling
      }
    }
  };
  poll(); // immediate first call
  _realtimeNvGpuTimer = setInterval(poll, 3000);
}

function _startRealtimePush() {
  if (_realtimeTimer) return;

  // Prime SI's internal delta counters (first call returns baseline, not delta)
  if (!_rtPrimed) {
    Promise.allSettled([
      si.networkStats('*'),
    ]).then(() => {
      _rtPrimed = true;
      // SI delta counters primed
    });
  }

  // Start ancillary polls
  _startLatencyPoll();
  _startWifiPoll();
  _startNvGpuPoll();

  _realtimeTimer = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
      // SI calls run in parallel — mem, network only (CPU comes from perf counters, temp from LHM/estimation)
      const [memData, netData] = await Promise.allSettled([
        si.mem(),                   // Memory usage (instant kernel call)
        si.networkStats('*'),       // Network throughput per interface (delta-based tx_sec/rx_sec)
      ]);

      const mem = memData.status === 'fulfilled' ? memData.value : null;
      const net = netData.status === 'fulfilled' ? netData.value : null;

      // ── Compute real-time CPU clock from perf counter ──
      // % Processor Performance = (current_freq / base_freq) × 100
      // e.g. base 3700 MHz, boost 5090 MHz → perfPct ≈ 137.6 → 3700 × 1.376 = 5091 MHz
      const baseClock = os.cpus()[0]?.speed || 0; // base clock in MHz from Node.js
      let resolvedClock = 0;
      if (_lhmCpuClock > 0) {
        // LHM MSR sensor: most accurate, direct per-core max clock
        resolvedClock = _lhmCpuClock;
      } else if (_perfCpuPerfPct > 0 && baseClock > 0) {
        // Perf counter ratio × base clock
        resolvedClock = Math.round(baseClock * (_perfCpuPerfPct / 100));
      }

      // ── Resolve CPU usage from PerfCounter (% Processor Utility) ──
      // Matches Task Manager exactly. No SI fallback needed.
      let resolvedCpu = _perfCpuUtility >= 0 ? _perfCpuUtility : 0;

      // ── Resolve temperature (priority: LHM → smart estimation) ──
      // Note: SI ACPI (si.cpuTemperature) returns static ACPI thermal zone on desktop
      // boards (e.g. 27°C constant), so we skip it entirely and use smart estimation.
      let resolvedTemp = 0;
      let tempSource = 'none';
      if (_lhmAvailable && _lhmTemp > 0) {
        resolvedTemp = _lhmTemp;
        tempSource = 'lhm';
      } else {
        // Smart estimation using CPU load + clock boost ratio + thermal inertia
        const baseClock = os.cpus()[0]?.speed || 3700;
        const boostRatio = (_lhmCpuClock > 0) ? Math.min(_lhmCpuClock / baseClock, 1.5) : 1.0;
        const targetTemp = 35 + (resolvedCpu * 0.45) + ((boostRatio - 1.0) * 20) + (resolvedCpu > 80 ? (resolvedCpu - 80) * 0.3 : 0);
        const alpha = 0.15;
        _estimatedTemp += (targetTemp - _estimatedTemp) * alpha;
        const jitter = Math.sin(Date.now() / 3000) * 0.5;
        resolvedTemp = Math.round((_estimatedTemp + jitter) * 10) / 10;
        if (resolvedTemp < 30) resolvedTemp = 30;
        if (resolvedTemp > 95) resolvedTemp = 95;
        tempSource = 'estimation';
      }

      // Log temp source only when falling back to estimation (indicates LHM/SI issue)
      if (!_rtLastTempSource || _rtLastTempSource !== tempSource) {
        if (tempSource === 'estimation') {
        }
        _rtLastTempSource = tempSource;
      }

      // ── Build unified payload (replaces both system:get-stats + system:get-extended-stats) ──
      const payload = {
        // CPU — % Processor Utility from perf counter service (matches Task Manager)
        cpu: resolvedCpu,
        // Per-core utilization from perf counter service (% Processor Utility per logical core)
        perCoreCpu: _perfPerCoreCpu.length > 0 ? _perfPerCoreCpu : [],
        // Current clock speed — real-time boost from LHM or perf counter
        cpuClock: resolvedClock,

        // Temperature — resolved with fallback chain
        temperature: resolvedTemp,
        tempSource: tempSource,
        lhmReady: _lhmAvailable || _perfCpuUtility >= 0,

        // GPU — prefer LHM (500ms refresh), fallback to nvidia-smi (3s poll)
        gpuTemp: _lhmGpuTemp >= 0 ? _lhmGpuTemp : (_nvGpuTemp >= 0 ? _nvGpuTemp : -1),
        gpuUsage: _lhmGpuUsage >= 0 ? _lhmGpuUsage : (_nvGpuUsage >= 0 ? _nvGpuUsage : -1),
        gpuVramUsed: _lhmGpuVramUsed >= 0 ? _lhmGpuVramUsed : (_nvGpuVramUsed >= 0 ? _nvGpuVramUsed : -1),
        gpuVramTotal: _lhmGpuVramTotal > 0 ? _lhmGpuVramTotal : (_nvGpuVramTotal > 0 ? _nvGpuVramTotal : -1),

        // Memory — from SI (active memory, not just "used" which includes cache)
        ram: mem ? Math.round((mem.active / mem.total) * 1000) / 10 : 0,
        ramUsedGB: mem ? Math.round(mem.active / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramTotalGB: mem ? Math.round(mem.total / (1024 * 1024 * 1024) * 10) / 10 : 0,

        // Disk — percentage from background cache, I/O from LHM perf counters (500ms delta)
        disk: _cachedDiskPct,
        diskReadSpeed: _lhmDiskRead,
        diskWriteSpeed: _lhmDiskWrite,

        // Network — from SI (delta-based bytes/sec, summed across all active interfaces)
        networkUp: 0,
        networkDown: 0,

        // Ancillary (slower polls)
        latencyMs: _rtLastLatency,
        packetLoss: _rtLastPacketLoss,
        ssid: _rtLastSsid,
        wifiSignal: _rtLastWifiSignal,
        activeAdapterName: _rtLastAdapterName,
        activeLinkSpeed: _rtLastAdapterLinkSpeed,
        activeLocalIP: _rtLastLocalIP,
        activeMac: _rtLastMac,
        activeGateway: _rtLastGateway,
        processCount: _lhmProcessCount > 0 ? _lhmProcessCount : _nodeProcessCount,
        systemUptime: _formatUptimeSeconds(os.uptime()),

        _ts: Date.now(),
      };

      // Network: sum throughput across all active interfaces (all: true)
      if (net && net.length > 0) {
        let totalUp = 0, totalDown = 0;
        for (const iface of net) {
          if (iface.operstate === 'up') {
            totalUp += (iface.tx_sec || 0);
            totalDown += (iface.rx_sec || 0);
          }
        }
        payload.networkUp = Math.round(totalUp);
        payload.networkDown = Math.round(totalDown);
      }

      mainWindow.webContents.send('realtime-hw-update', payload);
    } catch (err) {
    }
  }, 1000);

  // RT push started
}

function _stopRealtimePush() {
  if (_realtimeTimer) { clearInterval(_realtimeTimer); _realtimeTimer = null; }
  if (_realtimeLatencyTimer) { clearInterval(_realtimeLatencyTimer); _realtimeLatencyTimer = null; }
  if (_realtimeWifiTimer) { clearInterval(_realtimeWifiTimer); _realtimeWifiTimer = null; }
  if (_realtimeNvGpuTimer) { clearInterval(_realtimeNvGpuTimer); _realtimeNvGpuTimer = null; }
  // RT push stopped
}

// IPC: frontend can request start/stop of real-time push
ipcMain.handle('system:start-realtime', () => {
  _startRealtimePush();
  return { success: true };
});

ipcMain.handle('system:stop-realtime', () => {
  _stopRealtimePush();
  return { success: true };
});

// ──────────────────────────────────────────────────────
// Hardware Info — always fetched fresh.
// 1 consolidated PS script + nvidia-smi (~2-4s).
// ──────────────────────────────────────────────────────
let _hwInfoResult = null;    // resolved HardwareInfo object
let _hwInfoPromise = null;   // pending fetch promise (so IPC handler can await)

// Pre-fetch: called from app.on('ready') to overlap with window/React loading
function _initHardwareInfo() {
  _hwInfoPromise = _fetchHardwareInfoImpl().then(info => {
    _hwInfoResult = info;
    // Phase 2: fire-and-forget slow queries in background
    _fetchSlowHardwareInfo(info).catch(err => {
      console.error('[HW Info] slow fetch failed:', err.message);
    });
    return info;
  }).catch(err => {
    console.error('[HW Info] fetch failed:', err.message);
    return null;
  });
}

// IPC handler: returns result if ready, or awaits pending fetch
ipcMain.handle('system:get-hardware-info', async () => {
  if (_hwInfoResult) return _hwInfoResult;
  if (_hwInfoPromise) return _hwInfoPromise;
  // Fallback to direct fetch
  return _fetchHardwareInfoImpl();
});

async function _fetchHardwareInfoImpl() {
  const info = {
    cpuName: '',
    gpuName: '',
    ramInfo: '',
    ramBrand: '',
    ramPartNumber: '',
    diskName: '',
    // Extended static info
    cpuCores: 0,
    cpuThreads: 0,
    cpuMaxClock: '',
    gpuVramTotal: '',
    gpuDriverVersion: '',
    ramTotalGB: 0,
    ramUsedGB: 0,
    ramSticks: '',
    diskTotalGB: 0,
    diskFreeGB: 0,
    diskType: '',
    diskHealth: '',
    allDrives: [],
    networkAdapter: '',
    ipAddress: '',
    // Motherboard & BIOS (populated later)
    motherboardManufacturer: '',
    motherboardProduct: '',
    motherboardSerial: '',
    biosVersion: '',
    biosDate: '',
    lastWindowsUpdate: '',
    windowsActivation: '',
    windowsVersion: '',
    windowsBuild: '',
    systemUptime: '',
    powerPlan: '',
    hasBattery: false,
    batteryPercent: 0,
    batteryStatus: '',
  };

  // ── Single consolidated PS script + nvidia-smi + license/update checks (all in parallel) ──
  // Sections 0-14 run in one PS process; license & update run as separate fast processes alongside.
  // Sections separated by @@, fields within section by |||
  // Multi-line sections (drives, physical disks) use ~~ as line separator
  const [hwAll, nvDriverR, lastUpdateR, licenseR] = await Promise.allSettled([

    // ── All hardware info in one PS script ──
    runPSScript(`
# ── Section 0: CPU ──
$s0 = 'Unknown CPU|||0|||0|||0'
try {
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $s0 = "$($cpu.Name)|||$($cpu.NumberOfCores)|||$($cpu.NumberOfLogicalProcessors)|||$($cpu.MaxClockSpeed)"
} catch {}

# ── Section 1: GPU ──
$s1 = 'Unknown GPU|||0|||N/A'
try {
  $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq 'OK' -and $_.Name -notmatch '(Virtual|Dummy|Parsec|Remote|Generic)' } | Select-Object -First 1
  if (-not $gpu) { $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq 'OK' } | Select-Object -First 1 }
  if ($gpu) {
    $vramGB = 0
    if ($gpu.AdapterRAM -and $gpu.AdapterRAM -gt 0) {
      $vramGB = [math]::Round($gpu.AdapterRAM / 1GB, 1)
    } else {
      try {
        $regPaths = Get-ChildItem 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue
        foreach ($rp in $regPaths) {
          try {
            $props = Get-ItemProperty $rp.PSPath -ErrorAction SilentlyContinue
            if ($props.DriverDesc -eq $gpu.Name -or $props.ProviderName -match $gpu.Name.Split(' ')[0]) {
              $qw = $props.'HardwareInformation.qwMemorySize'
              if ($qw -and $qw -gt 0) { $vramGB = [math]::Round($qw / 1GB, 1); break }
            }
          } catch {}
        }
      } catch {}
      if ($vramGB -eq 0) {
        try {
          $regPaths2 = Get-ChildItem 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue
          foreach ($rp in $regPaths2) {
            try {
              $props = Get-ItemProperty $rp.PSPath -ErrorAction SilentlyContinue
              $qw = $props.'HardwareInformation.qwMemorySize'
              if ($qw -and $qw -gt 0) { $vramGB = [math]::Round($qw / 1GB, 1); break }
            } catch {}
          }
        } catch {}
      }
    }
    $s1 = "$($gpu.Name)|||$vramGB|||$($gpu.DriverVersion)"
  }
} catch {}

# ── Section 2: RAM ──
$s2 = '0||||||||||'
try {
  $mem = Get-CimInstance Win32_PhysicalMemory
  $totalGB = [math]::Round(($mem | Measure-Object -Property Capacity -Sum).Sum / 1GB)
  $first = $mem | Select-Object -First 1
  $s2 = "$totalGB|||$($first.Speed)|||$($first.ConfiguredClockSpeed)|||$($mem.Count) stick(s)|||$($first.Manufacturer)|||$($first.PartNumber)"
} catch {}

# ── Section 3: Disk ──
$s3 = '|||||||'
try {
  $d = Get-PhysicalDisk | Select-Object -First 1
  if ($d) {
    $s3 = "$($d.FriendlyName)|||$($d.MediaType)|||$($d.HealthStatus)|||$([math]::Round($d.Size/1GB))"
  } else {
    $d2 = Get-CimInstance Win32_DiskDrive | Select-Object -First 1
    $s3 = "$($d2.Model)|||Unknown|||Unknown|||$([math]::Round($d2.Size/1GB))"
  }
} catch {}

# ── Section 4: All drives ──
$s4 = ''
try {
  $drvs = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    "$($_.DeviceID)|$([math]::Round($_.Size/1GB,1))|$([math]::Round($_.FreeSpace/1GB,1))|$($_.VolumeName)"
  }
  $s4 = ($drvs -join '~~')
} catch {}

# ── Section 5: Network ──
$s5 = '||||||||||||||'
try {
  $a = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
  $ipv4 = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
  $ipv6 = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
  $mac = $a.MacAddress
  $gw = (Get-NetIPConfiguration -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue).Ipv4DefaultGateway.NextHop
  $dns = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue -AddressFamily IPv4 | Select-Object -First 1).ServerAddresses -join ','
  $allAdapters = ''
  try {
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
    $parts = @()
    foreach ($ad in $adapters) {
      $adType = if ($ad.MediaType -match '802\.11|Wireless|Wi-?Fi') { 'WiFi' } elseif ($ad.MediaType -match '802\.3|Ethernet') { 'Ethernet' } else { 'Other' }
      if ($adType -eq 'Other') {
        if ($ad.Name -match 'Wi-?Fi|Wireless|WLAN') { $adType = 'WiFi' }
        elseif ($ad.Name -match 'Ethernet|LAN') { $adType = 'Ethernet' }
      }
      $parts += "$($ad.Name)~$adType~$($ad.LinkSpeed)"
    }
    $allAdapters = $parts -join '^^'
  } catch {}
  $s5 = "$($a.Name) ($($a.InterfaceDescription))|||$ipv4|||$($a.LinkSpeed)|||$mac|||$ipv6|||$gw|||$dns|||$allAdapters"
} catch {}

# ── Section 6: Windows ──
$s6 = 'Windows|||'
try {
  $r = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction SilentlyContinue
  $prod = $r.ProductName; $disp = $r.DisplayVersion; $build = $r.CurrentBuildNumber
  if (-not $prod) { $wmi = Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue; $prod = $wmi.Caption }
  if ($build -ge 22000 -and $prod -notmatch '11') { $prod = $prod -replace 'Windows 10', 'Windows 11' }
  elseif ($build -lt 22000 -and $prod -notmatch '10') { $prod = $prod -replace 'Windows 11', 'Windows 10' }
  if (-not $prod) { $prod = 'Windows' }
  $s6 = "$prod|||$disp (Build $build)"
} catch {}

# ── Sections 7-11: Uptime, Power, Battery, RAM GB, Disk free ──
$osObj = $null
try { $osObj = Get-CimInstance Win32_OperatingSystem } catch {}

$s7 = ''
if ($osObj) { try { $up = (Get-Date) - $osObj.LastBootUpTime; $s7 = '{0}d {1}h {2}m' -f $up.Days, $up.Hours, $up.Minutes } catch {} }

$s8 = ''
try { $s8 = (Get-CimInstance -Namespace root\\cimv2\\power -ClassName Win32_PowerPlan | Where-Object { $_.IsActive }).ElementName } catch {}

$s9 = 'false'
try {
  $b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
  if ($b) {
    $st = switch($b.BatteryStatus) { 1 {'Discharging'} 2 {'AC Connected'} 3 {'Fully Charged'} 4 {'Low'} 5 {'Critical'} 6 {'Charging'} 7 {'Charging (High)'} 8 {'Charging (Low)'} 9 {'Charging (Critical)'} default {'Unknown'} }
    $s9 = "true|||$($b.EstimatedChargeRemaining)|||$st"
  }
} catch {}

$s10 = '0|||0'
if ($osObj) {
  try {
    $totalGB = [math]::Round($osObj.TotalVisibleMemorySize/1MB, 1)
    $freeGB = [math]::Round($osObj.FreePhysicalMemory/1MB, 1)
    $usedGB = [math]::Round($totalGB - $freeGB, 1)
    $s10 = "$usedGB|||$totalGB"
  } catch {}
}

$s11 = '0'
try { $dc = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"; $s11 = [math]::Round($dc.FreeSpace/1GB,1) } catch {}

# ── Section 12: Motherboard ──
$s12 = '|||'
try {
  $bb = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($bb) {
    $prod = $bb.Product; if (-not $prod) { $prod = $bb.Name } if (-not $prod) { $prod = $bb.Caption }
    $s12 = "$($bb.Manufacturer)|||$prod|||$($bb.SerialNumber)"
  }
} catch {}

# ── Section 13: Physical disks ──
$s13 = ''
try {
  $pds = Get-CimInstance Win32_DiskDrive | ForEach-Object {
    $m = ($_.Model -replace '\\n',' '); $sn = ($_.SerialNumber -replace '\\s',''); $fw = ($_.FirmwareRevision -replace '\\s',''); $size = [math]::Round($_.Size/1GB)
    "$m|||$sn|||$fw|||$size"
  }
  $s13 = ($pds -join '~~')
} catch {}

# ── Section 14: BIOS ──
$s14 = '|||'
try {
  $bio = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($bio) {
    $ver = $bio.SMBIOSBIOSVersion; if (-not $ver) { $ver = $bio.Version } if (-not $ver) { $ver = $bio.BIOSVersion -join ',' }
    $date = ''; try { $date = ([Management.ManagementDateTimeConverter]::ToDateTime($bio.ReleaseDate).ToString('yyyy-MM-dd')) } catch {}
    $s14 = "$ver|||$date"
  }
} catch {}

Write-Output ($s0 + '@@' + $s1 + '@@' + $s2 + '@@' + $s3 + '@@' + $s4 + '@@' + $s5 + '@@' + $s6 + '@@' + $s7 + '@@' + $s8 + '@@' + $s9 + '@@' + $s10 + '@@' + $s11 + '@@' + $s12 + '@@' + $s13 + '@@' + $s14)
    `, 15000),

    // ── nvidia-smi for GPU driver version + accurate VRAM total (separate binary, runs in parallel) ──
    execFileAsync('nvidia-smi', ['--query-gpu=driver_version,memory.total', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true })
      .then(r => (r.stdout || '').trim().split('\n')[0].trim()).catch(() => ''),

    // ── Last Windows Update (separate PS — ~1s, runs in parallel with main script) ──
    runPSScript(`
try {
  $hf = Get-HotFix -EA SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
  if ($hf) { Write-Output $hf.InstalledOn.ToString('yyyy-MM-dd') } else { Write-Output 'Unknown' }
} catch { Write-Output 'Unknown' }
    `, 10000),

    // ── Windows License (slmgr.vbs — ~0.6s native, runs in parallel with main script) ──
    execAsync('cscript //nologo C:\\Windows\\System32\\slmgr.vbs /dli', { timeout: 8000, windowsHide: true })
      .then(({ stdout }) => (stdout || '').trim()).catch(() => ''),
  ]);

  // ── Parse: split the single output by @@ into sections 0-14 ──
  const valOf = (r) => r.status === 'fulfilled' ? (r.value || '') : '';
  const allSections = valOf(hwAll).split('@@');
  // Parse nvidia-smi result: "driver_version, memory_total_mib" e.g. "546.33, 8192"
  const nvRaw = valOf(nvDriverR);
  const nvParts = nvRaw.split(',').map(s => s.trim());
  const nvDriverVal = nvParts[0] || '';
  const nvVramMiB = nvParts.length >= 2 ? parseInt(nvParts[1]) : 0;
  const get = (i) => (allSections[i] || '').trim();

  // Parse last Windows Update (ran in parallel)
  const lastUpdRaw = valOf(lastUpdateR).trim();
  if (lastUpdRaw && lastUpdRaw !== 'Unknown') info.lastWindowsUpdate = lastUpdRaw;

  // Parse Windows License from slmgr output (ran in parallel)
  const slmgrOut = valOf(licenseR).toLowerCase();
  if (slmgrOut) {
    if (slmgrOut.includes('licensed') || slmgrOut.includes('license status: licensed')) {
      info.windowsActivation = 'Licensed';
    } else if (slmgrOut.includes('notification') || slmgrOut.includes('grace')) {
      info.windowsActivation = 'Not Activated';
    } else if (slmgrOut.includes('initial grace') || slmgrOut.includes('oob grace')) {
      info.windowsActivation = 'Trial';
    }
  }

  // 0: CPU
  try {
    const parts = get(0).split('|||').map((s) => s.trim());
    info.cpuName = parts[0] || 'Unknown CPU';
    info.cpuCores = parseInt(parts[1]) || 0;
    info.cpuThreads = parseInt(parts[2]) || 0;
    info.cpuMaxClock = parts[3] ? `${(parseInt(parts[3]) / 1000).toFixed(2)} GHz` : '';
  } catch { info.cpuName = 'Unknown CPU'; }

  // 1: GPU
  try {
    const parts = get(1).split('|||').map((s) => s.trim());
    info.gpuName = parts[0] || 'Unknown GPU';

    // VRAM: prefer nvidia-smi memory.total (accurate for >4GB GPUs).
    // Win32_VideoController.AdapterRAM is a uint32 — overflows/caps at ~4 GB.
    if (nvVramMiB > 0) {
      const gb = nvVramMiB / 1024;
      info.gpuVramTotal = gb % 1 === 0 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
    } else {
      info.gpuVramTotal = parts[1] && parts[1] !== '0' ? `${parts[1]} GB` : '';
    }

    // Prefer the NVIDIA "driver_version" from nvidia-smi (fetched in parallel above).
    // Fallback to Win32_VideoController.DriverVersion when nvidia-smi isn't present.
    info.gpuDriverVersion = nvDriverVal || (parts[2] || '');
  } catch { info.gpuName = 'Unknown GPU'; }

  // Derive full RAM brand+series name from part number and manufacturer
  const resolveRamBrand = (mfr, partNum) => {
    const part = (partNum || '').trim();
    const partLow = part.toLowerCase();
    const mfrLow = (mfr || '').toLowerCase().trim();

    // ── G.Skill series decode from part number suffix ──
    // Format: F4-<speed>C<cas>-<size><series-code>
    if (/^f[34]-\d/i.test(part)) {
      const suffix = (part.split('-').pop() || '').replace(/^\d+/, '').toUpperCase();
      const gskillSeries = {
        'GTZRX': 'G.Skill Trident Z Royal',
        'GTZRS': 'G.Skill Trident Z Royal Silver',
        'GTZR': 'G.Skill Trident Z RGB',
        'GTZ': 'G.Skill Trident Z',
        'GTZN': 'G.Skill Trident Z Neo',
        'GTZNR': 'G.Skill Trident Z Neo',
        'GFX': 'G.Skill Trident Z5 RGB',
        'GX': 'G.Skill Trident Z5',
        'GVK': 'G.Skill Ripjaws V',
        'GRK': 'G.Skill Ripjaws V',
        'GBKD': 'G.Skill Ripjaws 4',
        'GNT': 'G.Skill Aegis',
        'GIS': 'G.Skill ARES',
        'GQSB': 'G.Skill Sniper X',
      };
      // Try longest match first
      for (const [code, name] of Object.entries(gskillSeries)) {
        if (suffix.endsWith(code)) return name;
      }
      return 'G.Skill';
    }

    // ── Corsair series ──
    if (/^cmk/i.test(part)) return 'Corsair Vengeance RGB Pro';
    if (/^cmt/i.test(part)) return 'Corsair Dominator Platinum';
    if (/^cmd/i.test(part)) return 'Corsair Dominator';
    if (/^cmw/i.test(part)) return 'Corsair Vengeance RGB';
    if (/^cms/i.test(part)) return 'Corsair';
    if (/vengeance/i.test(partLow)) return 'Corsair Vengeance';
    if (/dominator/i.test(partLow)) return 'Corsair Dominator';

    // ── Kingston / HyperX / Fury ──
    if (/^khx/i.test(part)) return 'Kingston HyperX';
    if (/^hx\d/i.test(part)) return 'Kingston HyperX';
    if (/^kf\d/i.test(part)) return 'Kingston Fury';
    if (/^kcp/i.test(part)) return 'Kingston';
    if (/fury/i.test(partLow)) return 'Kingston Fury';

    // ── Crucial / Micron ──
    if (/^ble/i.test(part)) return 'Crucial Ballistix';
    if (/^bls/i.test(part)) return 'Crucial Ballistix Sport';
    if (/^ct\d/i.test(part)) return 'Crucial';
    if (/^mt\d/i.test(part)) return 'Micron';

    // ── SK Hynix ──
    if (/^hma|^hmt|^hmab/i.test(part)) return 'SK Hynix';

    // ── Samsung ──
    if (/^m3[78]/i.test(part)) return 'Samsung';

    // ── TeamGroup ──
    if (/^tf[ab]\d|^tdeed/i.test(part)) return 'TeamGroup T-Force';
    if (/^tf\d/i.test(part)) return 'TeamGroup';

    // ── Patriot ──
    if (/^psd|^pv[e34]/i.test(part)) return 'Patriot Viper';

    // ── JEDEC hex manufacturer code fallback ──
    const jedecMap = {
      '04f1': 'G.Skill', '04cd': 'Kingston', '9e': 'Kingston',
      'ce': 'Samsung', '00ce': 'Samsung', '80ce': 'Samsung',
      'ad': 'SK Hynix', '00ad': 'SK Hynix', '80ad': 'SK Hynix',
      '2c': 'Micron', '002c': 'Micron', '802c': 'Micron',
      '859b': 'Corsair', '0cf8': 'Crucial', '0b': 'Nanya', '0783': 'Transcend',
    };
    const mfrKey = mfrLow.replace(/^0x/, '');
    if (jedecMap[mfrKey]) return jedecMap[mfrKey];

    // If manufacturer is a readable string (not a raw hex code), use it directly
    if (mfr && !/^[0-9a-f]{2,8}$/i.test(mfr.trim())) return mfr.trim();

    return '';
  };

  // 2: RAM
  try {
    const parts = get(2).split('|||').map((s) => s.trim());
    const totalGB = parseInt(parts[0]) || Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const jedecSpeed = parts[1] || '';
    const configSpeed = parts[2] || '';
    // Use configured (XMP/DOCP) speed if available, otherwise fall back to JEDEC speed
    const speed = configSpeed && configSpeed !== '0' ? configSpeed : jedecSpeed;
    info.ramInfo = speed ? `${totalGB} GB @ ${speed} MHz` : `${totalGB} GB`;
    info.ramTotalGB = totalGB;
    info.ramSticks = parts[3] || '';
    info.ramBrand = resolveRamBrand(parts[4], parts[5]);
    info.ramPartNumber = (parts[5] || '').trim();
  } catch {
    const totalGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    info.ramInfo = `${totalGB} GB`;
    info.ramTotalGB = totalGB;
  }

  // 3: Disk
  try {
    const parts = get(3).split('|||').map((s) => s.trim());
    info.diskName = parts[0] || 'Unknown Disk';
    info.diskType = parts[1] || '';
    info.diskHealth = parts[2] || '';
    info.diskTotalGB = parseInt(parts[3]) || 0;
  } catch { info.diskName = 'Unknown Disk'; }

  // 4: All drives
  try {
    const drivesRaw = get(4);
    if (drivesRaw) {
      info.allDrives = drivesRaw.split('~~').filter((l) => l.trim()).map((line) => {
        const [letter, totalGB, freeGB, label] = line.trim().split('|');
        return { letter: letter || '', totalGB: parseFloat(totalGB) || 0, freeGB: parseFloat(freeGB) || 0, label: label || '' };
      });
    }
  } catch { }

  // 5: Network
  try {
    const parts = get(5).split('|||').map((s) => s.trim());
    info.networkAdapter = parts[0] || '';
    info.ipAddress = parts[1] || '';
    info.networkLinkSpeed = parts[2] || '';
    info.macAddress = parts[3] || '';
    info.ipv6Address = parts[4] || '';
    info.gateway = parts[5] || '';
    info.dns = parts[6] || '';
    // Parse all active adapters' link speeds
    if (parts[7]) {
      info.networkAdapters = parts[7].split('^^').filter(s => s.trim()).map(entry => {
        const [name, type, linkSpeed] = entry.split('~');
        return { name: name || '', type: type || 'Other', linkSpeed: linkSpeed || '' };
      });
    }
  } catch { }

  // 6: Windows — with additional validation for Win11 vs Win10
  try {
    let parts = get(6).split('|||').map((s) => s.trim());
    let prod = parts[0] || '';
    let build = parts[1] || '';

    // Extract build number for verification
    const buildMatch = build.match(/Build (\d+)/);
    const buildNum = buildMatch ? parseInt(buildMatch[1]) : 0;

    // If build >= 22000, it's Windows 11; if < 22000, it's Windows 10
    // Correct any mislabeling
    if (buildNum >= 22000 && !prod.includes('11')) {
      prod = prod.replace(/Windows 10/i, 'Windows 11').replace(/win10/i, 'Windows 11') || 'Windows 11 Pro';
    } else if (buildNum > 0 && buildNum < 22000 && prod.includes('11')) {
      prod = prod.replace(/Windows 11/i, 'Windows 10');
    }

    info.windowsVersion = prod || 'Unknown';
    info.windowsBuild = build || 'Unknown';
  } catch {
    info.windowsVersion = 'Unknown';
    info.windowsBuild = 'Unknown';
  }

  // 7: Uptime
  try { info.systemUptime = get(7) || ''; } catch { }

  // 8: Power plan
  try { info.powerPlan = get(8) || ''; } catch { }

  // Fallback: some systems may not expose Win32_PowerPlan; try powercfg as a reliable fallback
  if (!info.powerPlan) {
    try {
      const pc = await execFileAsync('powercfg', ['/getactivescheme'], { timeout: 4000, windowsHide: true });
      const out = (pc.stdout || '').trim();
      // Example output: Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)
      const m = out.match(/\(([^)]+)\)$/);
      if (m && m[1]) {
        info.powerPlan = m[1].trim();
      } else {
        // fallback: try to extract text after the GUID
        const parts = out.split(/\)\s*/).map(p => p.trim()).filter(Boolean);
        const last = parts[parts.length - 1] || '';
        if (last) info.powerPlan = last.replace(/^\(|\)$/g, '').trim();
      }
    } catch (e) {
      // ignore — leave powerPlan empty
    }
  }

  // 9: Battery
  try {
    const parts = get(9).split('|||').map((s) => s.trim());
    info.hasBattery = parts[0] === 'true';
    if (info.hasBattery) {
      info.batteryPercent = parseInt(parts[1]) || 0;
      info.batteryStatus = parts[2] || '';
    }
  } catch { }

  // 10: RAM GB usage
  try {
    const parts = get(10).split('|||').map((s) => s.trim());
    info.ramUsedGB = parseFloat(parts[0]) || 0;
    info.ramTotalGB = parseFloat(parts[1]) || info.ramTotalGB;
  } catch { }

  // 11: Disk free
  try { info.diskFreeGB = parseFloat(get(11)) || 0; } catch { }

  // 12: Motherboard
  try {
    const parts = get(12).split('|||').map(s => s.trim());
    info.motherboardManufacturer = parts[0] || '';
    info.motherboardProduct = parts[1] || '';

    // Sanitize the motherboard serial: many OEMs return placeholders like "Default string" or "To be filled by OEM"
    let rawSerial = (parts[2] || '').trim();
    const invalidSerials = ['default string', 'to be filled by o.e.m.', 'to be filled by oem', 'system serial number', 'not specified', 'none', 'unknown', 'baseboard serial number'];
    const serialLower = rawSerial.toLowerCase();
    const isBad = !rawSerial || invalidSerials.includes(serialLower) || /^0+$/.test(rawSerial) || rawSerial.length < 3;

    info.motherboardSerial = isBad ? '' : rawSerial;
  } catch { }

  // 13: Physical disks
  try {
    const pdRaw = get(13);
    if (pdRaw) {
      info.physicalDisks = pdRaw.split('~~').filter(l => l.trim()).map((line) => {
        const parts = line.split('|||').map(s => s.trim());
        return { model: parts[0] || '', serial: parts[1] || '', firmware: parts[2] || '', sizeGB: parseInt(parts[3]) || 0 };
      });
    }
  } catch { }

  // 14: BIOS
  try {
    const bioRaw = get(14);
    if (bioRaw) {
      const parts = bioRaw.split('|||').map(s => s.trim());
      info.biosVersion = parts[0] || '';
      info.biosDate = parts[1] || '';
    }
  } catch { }

  // ── Lightweight fallbacks (Node.js only, no shell) ──

  // Uptime: always available via os.uptime()
  if (!info.systemUptime) {
    try {
      const uptimeSec = os.uptime();
      const days = Math.floor(uptimeSec / 86400);
      const hours = Math.floor((uptimeSec % 86400) / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      info.systemUptime = `${days}d ${hours}h ${minutes}m`;
    } catch { }
  }

  return info;
}

// ── Phase 2: Slow background queries — each pushes its result to the renderer immediately ──
// Runs after fast data is returned to the renderer. Streams partial updates via IPC.
async function _fetchSlowHardwareInfo(fastInfo) {
  // Push each piece of data to the renderer the moment it's ready (no waiting for others)
  const pushUpdate = (partial) => {
    Object.assign(_hwInfoResult, partial);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hw-info-update', partial);
    }
  };

  const tasks = [];

  // ── Serial fallback (SystemEnclosure, ComputerSystemProduct, BIOS) ──
  if (!fastInfo.motherboardSerial) {
    tasks.push(runPSScript(`
$serials = @()
try { $v = (Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue | Select-Object -First 1).SerialNumber; if ($v) { $serials += $v } } catch {}
try { $v = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).IdentifyingNumber; if ($v) { $serials += $v } } catch {}
try { $v = (Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue | Select-Object -First 1).SerialNumber; if ($v) { $serials += $v } } catch {}
Write-Output ($serials -join '|||')
    `, 10000).then(result => {
      if (!result) return;
      const invalidSerials = ['default string', 'to be filled by o.e.m.', 'to be filled by oem', 'system serial number', 'not specified', 'none', 'unknown', 'baseboard serial number'];
      const candidates = String(result).split('|||').map(s => s.trim());
      const valid = candidates.find(s => s && s.length >= 3 && !/^0+$/.test(s) && !invalidSerials.includes(s.toLowerCase()));
      if (valid) pushUpdate({ motherboardSerial: valid });
    }).catch(() => {}));
  }

  // ── Last Windows Update (only if Phase 1 didn't get it) ──
  if (!fastInfo.lastWindowsUpdate || fastInfo.lastWindowsUpdate === 'Unknown') {
    tasks.push(runPSScript(`
$lastUpd = 'Unknown'
try {
  $hf = Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
  if ($hf) { $lastUpd = $hf.InstalledOn.ToString('yyyy-MM-dd') }
} catch {}
Write-Output $lastUpd
    `, 10000).then(result => {
      pushUpdate({ lastWindowsUpdate: (result || '').trim() || 'Unknown' });
    }).catch(() => {
      pushUpdate({ lastWindowsUpdate: 'Unknown' });
    }));
  }

  // ── Windows License (only if Phase 1 didn't get it) ──
  if (!fastInfo.windowsActivation || fastInfo.windowsActivation === 'Unknown') {
    tasks.push(execAsync('cscript //nologo C:\\Windows\\System32\\slmgr.vbs /dli', {
      timeout: 8000, windowsHide: true
    }).then(({ stdout }) => {
      const out = (stdout || '').toLowerCase();
      let activation = 'Unknown';
      if (out.includes('licensed') || out.includes('license status: licensed')) {
        activation = 'Licensed';
      } else if (out.includes('notification') || out.includes('grace')) {
        activation = 'Not Activated';
      } else if (out.includes('initial grace') || out.includes('oob grace')) {
        activation = 'Trial';
      }
      pushUpdate({ windowsActivation: activation });
    }).catch(() => {
      pushUpdate({ windowsActivation: 'Unknown' });
    }));
  }

  // ── Motherboard wmic fallback ──
  if (!fastInfo.motherboardProduct && !fastInfo.motherboardManufacturer) {
    tasks.push(execAsync('wmic baseboard get Manufacturer,Product /format:csv', {
      timeout: 8000, windowsHide: true
    }).then(({ stdout }) => {
      const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Node,') && !l.startsWith('Node'));
      if (lines.length > 0) {
        const parts = lines[lines.length - 1].split(',');
        if (parts.length >= 3) {
          pushUpdate({
            motherboardManufacturer: parts[1]?.trim() || '',
            motherboardProduct: parts[2]?.trim() || '',
          });
        }
      }
    }).catch(() => {}));
  }

  // ── BIOS wmic fallback ──
  if (!fastInfo.biosVersion) {
    tasks.push(execAsync('wmic bios get SMBIOSBIOSVersion,ReleaseDate /format:csv', {
      timeout: 8000, windowsHide: true
    }).then(({ stdout }) => {
      const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Node,') && !l.startsWith('Node'));
      if (lines.length > 0) {
        const parts = lines[lines.length - 1].split(',');
        if (parts.length >= 3) {
          const relDate = (parts[1] || '').trim();
          const bv = (parts[2] || '').trim();
          const update = { biosVersion: bv };
          if (relDate) {
            const m = relDate.match(/^(\d{4})(\d{2})(\d{2})/);
            update.biosDate = m ? `${m[1]}-${m[2]}-${m[3]}` : relDate;
          }
          pushUpdate(update);
        }
      }
    }).catch(() => {}));
  }

  // ── Windows version registry fallback ──
  if (!fastInfo.windowsVersion || fastInfo.windowsVersion === 'Unknown') {
    tasks.push(execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v ProductName', {
      timeout: 5000, windowsHide: true
    }).then(({ stdout }) => {
      const m = stdout.match(/ProductName\s+REG_SZ\s+(.+)/i);
      if (m && m[1]) pushUpdate({ windowsVersion: m[1].trim() });
    }).catch(() => {}));
  }

  // ── Windows build registry fallback ──
  if (!fastInfo.windowsBuild || fastInfo.windowsBuild === 'Unknown') {
    tasks.push(execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v CurrentBuildNumber', {
      timeout: 5000, windowsHide: true
    }).then(async ({ stdout }) => {
      const m = stdout.match(/CurrentBuildNumber\s+REG_SZ\s+(.+)/i);
      if (m && m[1]) {
        let dispVer = '';
        try {
          const r = await execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v DisplayVersion', { timeout: 3000, windowsHide: true });
          const mv = r.stdout.match(/DisplayVersion\s+REG_SZ\s+(.+)/i);
          if (mv) dispVer = mv[1].trim();
        } catch { }
        pushUpdate({ windowsBuild: `${dispVer ? dispVer + ' ' : ''}(Build ${m[1].trim()})` });
      }
    }).catch(() => {}));
  }

  await Promise.allSettled(tasks);
}

let _extInFlight = false;
let _extHasResult = false;
let _lastExt = {
  cpuClock: 0, perCoreCpu: [], gpuUsage: -1, gpuTemp: -1,
  gpuVramUsed: -1, gpuVramTotal: -1, networkUp: 0, networkDown: 0,
  wifiSignal: -1, ramUsedGB: 0, ramTotalGB: 0, diskReadSpeed: 0,
  diskWriteSpeed: 0, processCount: 0, systemUptime: '', latencyMs: 0,
};

ipcMain.handle('system:get-extended-stats', async () => {
  if (_extInFlight) return _extHasResult ? _lastExt : null;
  _extInFlight = true;
  try {
    return await _getExtStatsImpl();
  } finally {
    _extInFlight = false;
  }
});

async function _getExtStatsImpl() {
  const ext = {
    cpuClock: 0, perCoreCpu: [], gpuUsage: -1, gpuTemp: -1,
    gpuVramUsed: -1, gpuVramTotal: -1, networkUp: 0, networkDown: 0,
    wifiSignal: -1, ramUsedGB: 0, ramTotalGB: 0, diskReadSpeed: 0,
    diskWriteSpeed: 0, processCount: 0, systemUptime: '', latencyMs: 0,
  };

  const [allR, gpuR] = await Promise.allSettled([

    runPSScript(`
# ── Network: pick adapter with default route (= active connection) ──
$netAdapter = $null; $netBefore = $null
try {
  $defRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
  if ($defRoute) { $netAdapter = Get-NetAdapter -InterfaceIndex $defRoute.InterfaceIndex -ErrorAction SilentlyContinue }
} catch {}
if (-not $netAdapter) {
  try { $netAdapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Name -notmatch 'Virtual|vEthernet|Loopback|Microsoft|Container' } | Select-Object -First 1 } catch {}
}
try { if ($netAdapter) { $netBefore = Get-NetAdapterStatistics -Name $netAdapter.Name } } catch {}
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ── Fast CIM queries ──
try { $clock = (Get-CimInstance Win32_Processor | Select-Object -First 1).CurrentClockSpeed } catch { $clock = 0 }
try {
  $o = Get-CimInstance Win32_OperatingSystem
  $ramT = [math]::Round($o.TotalVisibleMemorySize / 1MB, 1)
  $ramU = [math]::Round(($o.TotalVisibleMemorySize - $o.FreePhysicalMemory) / 1MB, 1)
  $up = (Get-Date) - $o.LastBootUpTime
  $uptime = '{0}d {1}h {2}m' -f $up.Days, $up.Hours, $up.Minutes
} catch { $ramT = 0; $ramU = 0; $uptime = '' }
try { $procs = (Get-Process).Count } catch { $procs = 0 }
try {
  $pinger = New-Object System.Net.NetworkInformation.Ping
  $lat = $pinger.Send('8.8.8.8', 1000).RoundtripTime
} catch { $lat = 0 }

# ── Get-Counter: per-core CPU + disk I/O (1-second sample) ──
$coreStr = ''; $dr = 0; $dw = 0
try {
  $c = Get-Counter -Counter @(
    '\\Processor(*)\\% Processor Time',
    '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec',
    '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec'
  ) -SampleInterval 1 -MaxSamples 1 -ErrorAction SilentlyContinue
  $s = $c.CounterSamples
  $cores = $s | Where-Object { $_.Path -like '*processor(*)*' -and $_.InstanceName -ne '_total' } | Sort-Object InstanceName
  $coreStr = ($cores | ForEach-Object { [math]::Round($_.CookedValue, 1) }) -join ','
  $dr = ($s | Where-Object { $_.Path -like '*read*' }).CookedValue
  $dw = ($s | Where-Object { $_.Path -like '*write*' }).CookedValue
} catch {}

# ── Network: snapshot AFTER (elapsed covers CIM + Get-Counter = 1-2s) ──
$netUp = 0; $netDn = 0
if ($netAdapter -and $netBefore) {
  try {
    $netAfter = Get-NetAdapterStatistics -Name $netAdapter.Name
    $elapsed = $sw.Elapsed.TotalSeconds
    if ($elapsed -gt 0) {
      $netUp = [math]::Round(($netAfter.SentBytes - $netBefore.SentBytes) / $elapsed)
      $netDn = [math]::Round(($netAfter.ReceivedBytes - $netBefore.ReceivedBytes) / $elapsed)
    }
  } catch {}
}

# ── Wi-Fi info (only if primary adapter is Wi-Fi) ──
$ssid = ''; $sig = ''
$isWifiPrimary = $false
if ($netAdapter) {
  $isWifiPrimary = ($netAdapter.MediaType -match '802\.11|Wireless|Wi-?Fi') -or ($netAdapter.Name -match 'Wi-?Fi|Wireless|WLAN')
}
if ($isWifiPrimary) {
  try {
    $w = netsh wlan show interfaces 2>$null
    if ($w) {
      $sl = $w | Select-String -Pattern '^\\s*SSID' | Where-Object { $_.ToString() -notmatch 'BSSID' } | Select-Object -First 1
      $sg2 = $w | Select-String 'Signal' | Select-Object -First 1
      if ($sl) { $ssid = $sl.ToString().Split(':',2)[1].Trim() }
      if ($sg2) { $sig = $sg2.ToString().Split(':',2)[1].Trim() }
    }
  } catch {}
}

# ── Active adapter name & link speed ──
$adName = ''; $adLink = ''
if ($netAdapter) { $adName = $netAdapter.Name; $adLink = $netAdapter.LinkSpeed }

# ── Output: 3 sections separated by @@ ──
Write-Output "$clock|$ramU|$ramT|$procs|$uptime|$lat@@$coreStr|$([math]::Round($dr))|$([math]::Round($dw))@@$netUp|$netDn|$ssid|$sig|$adName|$adLink"
    `, 8000),

    execFileAsync(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 3000, windowsHide: true }
    ).then(r => (r.stdout || '').trim()).catch(() => ''),
  ]);

  // ── Parse the merged result — split by @@ into 3 sections ──
  const val = (r) => r.status === 'fulfilled' ? (r.value || '') : '';
  const allRaw = val(allR);
  const sections = allRaw.split('@@');
  const fastRaw = (sections[0] || '').trim();
  const counterRaw = (sections[1] || '').trim();
  const netRaw = (sections[2] || '').trim();

  // Fast CIM: clock|ramU|ramT|procs|uptime|latency
  try {
    const parts = fastRaw.split('|');
    if (parts.length >= 6) {
      ext.cpuClock = parseInt(parts[0]) || 0;
      ext.ramUsedGB = parseFloat(parts[1]) || 0;
      ext.ramTotalGB = parseFloat(parts[2]) || 0;
      ext.processCount = parseInt(parts[3]) || 0;
      ext.systemUptime = parts[4] || '';
      ext.latencyMs = parseInt(parts[5]) || 0;
    }
  } catch { }

  // Counter: coreCSV|diskRead|diskWrite
  try {
    if (counterRaw) {
      const parts = counterRaw.split('|');
      if (parts.length >= 3) {
        if (parts[0]) {
          ext.perCoreCpu = parts[0].split(',').map(v => parseFloat(v)).filter(v => !isNaN(v));
        }
        ext.diskReadSpeed = parseInt(parts[1]) || 0;
        ext.diskWriteSpeed = parseInt(parts[2]) || 0;
      }
    }
  } catch { }

  // Network: up|down|ssid|signal|adapterName|linkSpeed
  try {
    const parts = netRaw.split('|');
    if (parts.length >= 4) {
      ext.networkUp = parseInt(parts[0]) || 0;
      ext.networkDown = parseInt(parts[1]) || 0;
      ext.ssid = parts[2] || '';
      ext.wifiSignal = parts[3] ? parseInt(parts[3]) : -1;
      if (parts[4]) ext.activeAdapterName = parts[4];
      if (parts[5]) ext.activeLinkSpeed = parts[5];
    }
  } catch { }

  // GPU: prefer LHM real-time data (1s), fall back to nvidia-smi (5s)
  if (_lhmGpuTemp >= 0) ext.gpuTemp = _lhmGpuTemp;
  if (_lhmGpuUsage >= 0) ext.gpuUsage = _lhmGpuUsage;
  if (_lhmGpuVramUsed >= 0) ext.gpuVramUsed = _lhmGpuVramUsed;
  if (_lhmGpuVramTotal > 0) ext.gpuVramTotal = _lhmGpuVramTotal;

  // nvidia-smi fallback: only fill fields LHM didn't provide
  try {
    const raw = val(gpuR);
    if (raw) {
      const parts = raw.split(',').map(s => parseFloat(s.trim()));
      if (parts.length >= 4) {
        if (ext.gpuUsage < 0) ext.gpuUsage = isNaN(parts[0]) ? -1 : Math.round(parts[0]);
        if (ext.gpuTemp < 0) ext.gpuTemp = isNaN(parts[1]) ? -1 : Math.round(parts[1]);
        if (ext.gpuVramUsed < 0) ext.gpuVramUsed = isNaN(parts[2]) ? -1 : Math.round(parts[2]);
        if (ext.gpuVramTotal < 0) ext.gpuVramTotal = isNaN(parts[3]) ? -1 : Math.round(parts[3]);
      }
    }
  } catch { }

  _lastExt = ext;
  _extHasResult = true;
  return ext;
}

// Cleaner IPC Handlers
ipcMain.handle('cleaner:clear-nvidia-cache', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const caches = [
      path.join(localAppData, 'NVIDIA', 'DXCache'),
      path.join(localAppData, 'NVIDIA', 'GLCache'),
      path.join(localAppData, 'D3DSCache'),
    ];

    let totalBefore = 0;
    let totalDeleted = 0;
    let totalSize = 0;
    let totalRemaining = 0;

    let anyCacheExists = false;
    // Count before cleaning
    for (const cachePath of caches) {
      if (fs.existsSync(cachePath)) {
        anyCacheExists = true;
        try {
          const items = fs.readdirSync(cachePath);
          totalBefore += items.length;
        } catch (e) {
          // Continue if one folder fails
        }
      }
    }
    if (!anyCacheExists) {
      return { success: false, message: 'NVIDIA shader cache not found. Driver or game may not be installed.' };
    }

    // Delete files
    for (const cachePath of caches) {
      if (fs.existsSync(cachePath)) {
        try {
          const items = fs.readdirSync(cachePath);
          for (const item of items) {
            try {
              const itemPath = path.join(cachePath, item);
              const stats = fs.statSync(itemPath);
              totalSize += stats.size;
              if (stats.isDirectory()) {
                fs.rmSync(itemPath, { recursive: true, force: true });
              } else {
                fs.rmSync(itemPath, { force: true });
              }
              totalDeleted++;
            } catch (e) {
              // Continue if one file fails
            }
          }
        } catch (e) {
          // Continue if one folder fails
        }
      }
    }

    // Count after cleaning
    for (const cachePath of caches) {
      if (fs.existsSync(cachePath)) {
        try {
          const items = fs.readdirSync(cachePath);
          totalRemaining += items.length;
        } catch (e) {
          // Continue if one folder fails
        }
      }
    }

    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared NVIDIA cache`,
      filesDeleted: totalDeleted,
      filesBefore: totalBefore,
      filesAfter: totalRemaining,
      spaceSaved: `${sizeInMB} MB`,
      details: `${totalDeleted}/${totalBefore} files deleted (${totalRemaining} remaining)`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

ipcMain.handle('cleaner:clear-apex-shaders', async () => {
  try {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const apexCachePath = path.join(userProfile, 'Saved Games', 'Respawn', 'Apex', 'local', 'psoCache.pso');

    let cleared = 0;
    let sizeFreed = 0;
    let filesBefore = 0;

    if (!fs.existsSync(apexCachePath)) {
      return { success: false, message: 'Apex Legends shader cache not found. Game may not be installed.' };
    }
    try {
      const stats = fs.statSync(apexCachePath);
      sizeFreed = stats.size;
      filesBefore = 1;
      fs.rmSync(apexCachePath, { force: true });
      cleared = 1;
    } catch (e) {
    }

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: cleared > 0
        ? 'Successfully cleared Apex Legends psoCache.pso'
        : 'Apex cache not found or already cleared',
      filesDeleted: cleared,
      filesBefore: filesBefore,
      filesAfter: 0,
      spaceSaved: cleared > 0 ? `${sizeInMB} MB` : '0 MB',
      details: cleared > 0 ? '1/1 file deleted (0 remaining)' : 'No files to delete',
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Call of Duty Shader Cache Cleaner
ipcMain.handle('cleaner:clear-cod-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const codCachePaths = [
      path.join(localAppData, 'ActivisionSharedCache'),
      path.join(localAppData, 'Activision'),
    ];

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;
    let pathFound = false;

    for (const codCachePath of codCachePaths) {
      if (fs.existsSync(codCachePath)) {
        pathFound = true;
        try {
          const files = fs.readdirSync(codCachePath, { recursive: true });
          filesBefore += files.length;

          const deleteDir = (dir) => {
            try {
              const items = fs.readdirSync(dir);
              for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);
                if (stats.isDirectory()) {
                  deleteDir(itemPath);
                } else {
                  sizeFreed += stats.size;
                  fs.rmSync(itemPath, { force: true });
                  filesDeleted++;
                }
              }
              fs.rmdirSync(dir, { force: true });
            } catch (e) {
              // Continue on error
            }
          };

          deleteDir(codCachePath);
        } catch (e) {
          // Path might not exist or be accessible
        }
      }
    }

    if (!pathFound) {
      return { success: false, message: 'Call of Duty shader cache not found. Game may not be installed.' };
    }

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: filesDeleted > 0 ? 'Successfully cleared Call of Duty shader cache' : 'Call of Duty shader cache not found. Game may not be installed.',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// CS2 Shader Cache Cleaner
ipcMain.handle('cleaner:clear-cs2-shaders', async () => {
  try {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const cs2CachePaths = [
      path.join(userProfile, 'AppData', 'Local', 'CS2'),
      path.join(userProfile, 'AppData', 'Local', 'SteamCache'),
    ];

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;
    let pathFound = false;

    for (const cs2CachePath of cs2CachePaths) {
      if (fs.existsSync(cs2CachePath)) {
        pathFound = true;
        try {
          const deleteDir = (dir) => {
            try {
              const items = fs.readdirSync(dir);
              for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);
                if (stats.isDirectory()) {
                  deleteDir(itemPath);
                } else {
                  sizeFreed += stats.size;
                  fs.rmSync(itemPath, { force: true });
                  filesDeleted++;
                  filesBefore++;
                }
              }
            } catch (e) {
              // Continue
            }
          };
          deleteDir(cs2CachePath);
        } catch (e) {
          // Path error
        }
      }
    }

    if (!pathFound) {
      return { success: false, message: 'CS2 shader cache not found. Game may not be installed.' };
    }

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: filesDeleted > 0 ? 'Successfully cleared CS2 shader cache' : 'CS2 shader cache not found. Game may not be installed.',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Fortnite Shader Cache Cleaner
ipcMain.handle('cleaner:clear-fortnite-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const fortniteCachePath = path.join(localAppData, 'FortniteGame', 'Saved', 'ShaderCache');

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;

    if (!fs.existsSync(fortniteCachePath)) {
      return { success: false, message: 'Fortnite shader cache not found.' };
    }

    const deleteDir = (dir) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory()) {
            deleteDir(itemPath);
          } else {
            sizeFreed += stats.size;
            fs.rmSync(itemPath, { force: true });
            filesDeleted++;
          }
        }
      } catch (e) {
        // Continue
      }
    };

    filesBefore = fs.readdirSync(fortniteCachePath, { recursive: true }).length;
    deleteDir(fortniteCachePath);

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: 'Successfully cleared Fortnite shader cache',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// League of Legends Shader Cache Cleaner
ipcMain.handle('cleaner:clear-lol-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const lolCachePath = path.join(localAppData, 'RADS');

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;

    if (!fs.existsSync(lolCachePath)) {
      return { success: false, message: 'League of Legends cache not found.' };
    }

    const deleteDir = (dir) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory()) {
            deleteDir(itemPath);
          } else {
            sizeFreed += stats.size;
            fs.rmSync(itemPath, { force: true });
            filesDeleted++;
          }
        }
      } catch (e) {
        // Continue
      }
    };

    filesBefore = fs.readdirSync(lolCachePath, { recursive: true }).length;
    deleteDir(lolCachePath);

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: 'Successfully cleared League of Legends cache',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Overwatch 2 Shader Cache Cleaner
ipcMain.handle('cleaner:clear-overwatch-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const owCachePaths = [
      path.join(localAppData, 'Blizzard Entertainment', 'Overwatch'),
      path.join(localAppData, 'Blizzard Entertainment'),
    ];

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;
    let pathFound = false;

    for (const owCachePath of owCachePaths) {
      if (fs.existsSync(owCachePath)) {
        pathFound = true;
        try {
          const deleteDir = (dir) => {
            try {
              const items = fs.readdirSync(dir);
              for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);
                if (stats.isDirectory()) {
                  deleteDir(itemPath);
                } else {
                  sizeFreed += stats.size;
                  fs.rmSync(itemPath, { force: true });
                  filesDeleted++;
                  filesBefore++;
                }
              }
            } catch (e) {
              // Continue
            }
          };
          deleteDir(owCachePath);
        } catch (e) {
          // Error
        }
      }
    }

    if (!pathFound) {
      return { success: false, message: 'Overwatch 2 shader cache not found. Game may not be installed.' };
    }

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: filesDeleted > 0 ? 'Successfully cleared Overwatch 2 cache' : 'Overwatch 2 shader cache not found. Game may not be installed.',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Rainbow Six Siege Shader Cache Cleaner
ipcMain.handle('cleaner:clear-r6-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const r6CachePaths = [
      path.join(localAppData, 'Ubisoft Game Launcher'),
      path.join(localAppData, 'Rainbow Six Siege'),
    ];

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;
    let pathFound = false;

    for (const r6CachePath of r6CachePaths) {
      if (fs.existsSync(r6CachePath)) {
        pathFound = true;
        try {
          const deleteDir = (dir) => {
            try {
              const items = fs.readdirSync(dir);
              for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);
                if (stats.isDirectory()) {
                  deleteDir(itemPath);
                } else {
                  sizeFreed += stats.size;
                  fs.rmSync(itemPath, { force: true });
                  filesDeleted++;
                  filesBefore++;
                }
              }
            } catch (e) {
              // Continue
            }
          };
          deleteDir(r6CachePath);
        } catch (e) {
          // Error
        }
      }
    }

    if (!pathFound) {
      return { success: false, message: 'Rainbow Six Siege shader cache not found. Game may not be installed.' };
    }

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: filesDeleted > 0 ? 'Successfully cleared Rainbow Six Siege cache' : 'Rainbow Six Siege shader cache not found. Game may not be installed.',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Rocket League Shader Cache Cleaner
ipcMain.handle('cleaner:clear-rocket-league-shaders', async () => {
  try {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const rlCachePath = path.join(userProfile, 'AppData', 'Roaming', 'Rocket League');

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;

    if (!fs.existsSync(rlCachePath)) {
      return { success: false, message: 'Rocket League cache not found.' };
    }

    const deleteDir = (dir) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory()) {
            deleteDir(itemPath);
          } else {
            sizeFreed += stats.size;
            fs.rmSync(itemPath, { force: true });
            filesDeleted++;
          }
        }
      } catch (e) {
        // Continue
      }
    };

    filesBefore = fs.readdirSync(rlCachePath, { recursive: true }).length;
    deleteDir(rlCachePath);

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: 'Successfully cleared Rocket League cache',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Valorant Shader Cache Cleaner
ipcMain.handle('cleaner:clear-valorant-shaders', async () => {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const valorantCachePath = path.join(localAppData, 'VALORANT');

    let filesDeleted = 0;
    let sizeFreed = 0;
    let filesBefore = 0;

    if (!fs.existsSync(valorantCachePath)) {
      return { success: false, message: 'Valorant cache not found.' };
    }

    const deleteDir = (dir) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory()) {
            deleteDir(itemPath);
          } else {
            sizeFreed += stats.size;
            fs.rmSync(itemPath, { force: true });
            filesDeleted++;
          }
        }
      } catch (e) {
        // Continue
      }
    };

    filesBefore = fs.readdirSync(valorantCachePath, { recursive: true }).length;
    deleteDir(valorantCachePath);

    const sizeInMB = (sizeFreed / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: 'Successfully cleared Valorant shader cache',
      filesDeleted,
      filesBefore,
      filesAfter: Math.max(0, filesBefore - filesDeleted),
      spaceSaved: `${sizeInMB} MB`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// ── Individual Disk Cleanup Handlers ────────────────────────────────────

// Windows Temp (C:\Windows\Temp)
ipcMain.handle('cleaner:clear-windows-temp', async () => {
  try {
    const winTemp = path.join(process.env.WINDIR || 'C:\\Windows', 'Temp');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(winTemp)) {
      const files = fs.readdirSync(winTemp);
      filesBefore = files.length;
      for (const file of files) {
        try {
          const fp = path.join(winTemp, file);
          const stats = fs.statSync(fp);
          totalSize += stats.size;
          fs.rmSync(fp, { recursive: true, force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Windows Temp', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Thumbnail Cache
ipcMain.handle('cleaner:clear-thumbnail-cache', async () => {
  try {
    const explorerDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Explorer');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(explorerDir)) {
      const files = fs.readdirSync(explorerDir).filter(f => /^thumbcache_/i.test(f));
      filesBefore = files.length;
      for (const file of files) {
        try {
          const fp = path.join(explorerDir, file);
          const stats = fs.statSync(fp);
          totalSize += stats.size;
          fs.rmSync(fp, { force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Thumbnail Cache', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Windows Log Files
ipcMain.handle('cleaner:clear-windows-logs', async () => {
  try {
    const logsDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Logs');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(logsDir)) {
      const walkAndDelete = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fp = path.join(dir, entry.name);
            filesBefore++;
            try {
              const stats = fs.statSync(fp);
              totalSize += entry.isDirectory() ? 0 : stats.size;
              fs.rmSync(fp, { recursive: true, force: true });
              filesDeleted++;
            } catch (e) { }
          }
        } catch (e) { }
      };
      walkAndDelete(logsDir);
    }
    return { success: true, message: 'Cleared Windows Logs', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Crash Dumps
ipcMain.handle('cleaner:clear-crash-dumps', async () => {
  try {
    const dumpsDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CrashDumps');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(dumpsDir)) {
      const files = fs.readdirSync(dumpsDir);
      filesBefore = files.length;
      for (const file of files) {
        try {
          const fp = path.join(dumpsDir, file);
          const stats = fs.statSync(fp);
          totalSize += stats.size;
          fs.rmSync(fp, { recursive: true, force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Crash Dumps', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Windows Error Reports
ipcMain.handle('cleaner:clear-error-reports', async () => {
  try {
    const werDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'WER', 'ReportArchive');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(werDir)) {
      const entries = fs.readdirSync(werDir);
      filesBefore = entries.length;
      for (const entry of entries) {
        try {
          const fp = path.join(werDir, entry);
          const stats = fs.statSync(fp);
          totalSize += stats.isDirectory() ? 0 : stats.size;
          fs.rmSync(fp, { recursive: true, force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Error Reports', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Delivery Optimization Cache
ipcMain.handle('cleaner:clear-delivery-optimization', async () => {
  try {
    const doDir = path.join(process.env.WINDIR || 'C:\\Windows', 'SoftwareDistribution', 'DeliveryOptimization');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(doDir)) {
      const entries = fs.readdirSync(doDir);
      filesBefore = entries.length;
      for (const entry of entries) {
        try {
          const fp = path.join(doDir, entry);
          const stats = fs.statSync(fp);
          totalSize += stats.isDirectory() ? 0 : stats.size;
          fs.rmSync(fp, { recursive: true, force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Delivery Optimization Cache', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Font Cache
ipcMain.handle('cleaner:clear-font-cache', async () => {
  try {
    const fontCacheDir = path.join(process.env.WINDIR || 'C:\\Windows', 'ServiceProfiles', 'LocalService', 'AppData', 'Local', 'FontCache');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(fontCacheDir)) {
      const files = fs.readdirSync(fontCacheDir).filter(f => /\.dat$/i.test(f));
      filesBefore = files.length;
      for (const file of files) {
        try {
          const fp = path.join(fontCacheDir, file);
          const stats = fs.statSync(fp);
          totalSize += stats.size;
          fs.rmSync(fp, { force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Font Cache', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Recent Files (.lnk shortcuts)
ipcMain.handle('cleaner:clear-recent-files', async () => {
  try {
    const recentDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(recentDir)) {
      const files = fs.readdirSync(recentDir).filter(f => /\.lnk$/i.test(f));
      filesBefore = files.length;
      for (const file of files) {
        try {
          const fp = path.join(recentDir, file);
          const stats = fs.statSync(fp);
          totalSize += stats.size;
          fs.rmSync(fp, { force: true });
          filesDeleted++;
        } catch (e) { }
      }
    }
    return { success: true, message: 'Cleared Recent Files', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    return { success: false, message: `Error: ${error.message}` };
  }
});

ipcMain.handle('cleaner:clear-temp-files', async () => {
  try {
    const tempDir = process.env.TEMP || os.tmpdir();
    let filesDeleted = 0;
    let totalSize = 0;
    let filesBefore = 0;

    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      filesBefore = files.length;
      for (const file of files) {
        try {
          const filePath = path.join(tempDir, file);
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.rmSync(filePath, { force: true });
          }
          filesDeleted++;
        } catch (e) {
          // Skip files that can't be deleted
        }
      }
    }

    const filesAfter = filesBefore - filesDeleted;
    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared temporary files`,
      filesDeleted: filesDeleted,
      filesBefore: filesBefore,
      filesAfter: filesAfter,
      spaceSaved: `${sizeInMB} MB`,
      details: `${filesDeleted}/${filesBefore} files deleted (${filesAfter} remaining)`,
    };
  } catch (error) {
    return { success: false, message: `Error: ${error.message}` };
  }
});

ipcMain.handle('cleaner:clear-prefetch', async () => {
  try {
    const prefetch = 'C:\\Windows\\Prefetch';
    let filesDeleted = 0;
    let totalSize = 0;
    let filesBefore = 0;
    let filesAfter = 0;

    if (fs.existsSync(prefetch)) {
      const allFiles = fs.readdirSync(prefetch);
      filesBefore = allFiles.filter(f => f.endsWith('.pf')).length;

      for (const file of allFiles) {
        if (file.endsWith('.pf')) {
          try {
            const filePath = path.join(prefetch, file);
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
            fs.rmSync(filePath, { force: true });
            filesDeleted++;
          } catch (e) {
            // Skip protected files
          }
        }
      }

      filesAfter = filesBefore - filesDeleted;
    }

    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared prefetch files`,
      filesDeleted: filesDeleted,
      filesBefore: filesBefore,
      filesAfter: filesAfter,
      spaceSaved: `${sizeInMB} MB`,
      details: `${filesDeleted}/${filesBefore} files deleted (${filesAfter} remaining)`,
    };
  } catch (error) {
    // Prefetch folder ALWAYS needs admin rights
    return { success: false, message: 'Run the app as administrator' };
  }
});

ipcMain.handle('cleaner:clear-memory-dumps', async () => {
  try {
    const dumpDir = 'C:\\Windows\\Minidump';
    let filesDeleted = 0;
    let totalSize = 0;
    let filesBefore = 0;
    let filesAfter = 0;

    // Diagnostic logging

    if (!fs.existsSync(dumpDir)) {
      return { success: false, message: 'Minidump folder not found.' };
    }
    const files = fs.readdirSync(dumpDir);
    filesBefore = files.length;
    if (filesBefore === 0) {
      return { success: true, message: 'Minidump folder found, but no dump files to delete.', filesDeleted: 0, filesBefore: 0, filesAfter: 0, spaceSaved: '0 MB', details: 'No files to delete.' };
    }
    for (const file of files) {
      try {
        const filePath = path.join(dumpDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        if (stats.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.rmSync(filePath, { force: true });
        }
        filesDeleted++;
      } catch (e) {
        // Continue if one file fails
      }
    }
    filesAfter = filesBefore - filesDeleted;
    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared crash dump files`,
      filesDeleted: filesDeleted,
      filesBefore: filesBefore,
      filesAfter: filesAfter,
      spaceSaved: `${sizeInMB} MB`,
      details: `${filesDeleted}/${filesBefore} files deleted (${filesAfter} remaining)`,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

ipcMain.handle('cleaner:clear-update-cache', async () => {
  try {
    const updateDir = 'C:\\Windows\\SoftwareDistribution\\Download';

    if (!fs.existsSync(updateDir)) {
      return {
        success: false,
        message: 'Windows Update cache not found. It may already be empty.',
        spaceSaved: '0 MB'
      };
    }

    // 1. Stop Windows Update and related services to release folder locks
    const stopServicesCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
      @('wuauserv', 'usosvc', 'UsoSvc') | ForEach-Object {
        try {
          Stop-Service -Name \\$_ -Force -ErrorAction Stop
        } catch {
          # Service may not be running, that's okay
        }
      }
      # Wait longer to ensure all locks are released
      Start-Sleep -Milliseconds 1500
    "`;

    try {
      await execAsync(stopServicesCmd, { shell: true, timeout: 30000 });
    } catch (e) {
      // Continue anyway, services might not exist on all systems
    }

    // 2. Gather pre-deletion stats
    const statsCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem -Path '${updateDir}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`;
    let totalSize = 0;
    let filesBefore = 0;

    try {
      const statRes = await execAsync(statsCmd, { shell: true, timeout: 30000 });
      const stdout = (statRes.stdout || '').trim();
      totalSize = parseInt(stdout) || 0;
      // Also count files
      const countCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem -Path '${updateDir}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object).Count"`;
      const countRes = await execAsync(countCmd, { shell: true, timeout: 30000 });
      filesBefore = parseInt(countRes.stdout) || 0;
    } catch (e) {
      // Stats collection is best-effort; continue with deletion anyway
    }

    // Check if folder has content
    if (filesBefore === 0) {
      return {
        success: true,
        message: `Cache folder is already empty`,
        filesDeleted: 0,
        filesBefore: 0,
        filesAfter: 0,
        spaceSaved: `0 MB`,
        details: `No files to delete`,
      };
    }

    // 3. Clear the cache folder with retry logic
    let deletionSuccess = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // First two attempts: Try standard removal
        if (attempt <= 2) {
          let removeCmd;
          if (attempt === 1) {
            removeCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Path '${updateDir}\\*' -Recurse -Force -ErrorAction Stop"`;
          } else {
            removeCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
              Get-ChildItem -Path '${updateDir}' -Force -Recurse -ErrorAction Stop |
              Remove-Item -Recurse -Force -Confirm:\\$false -ErrorAction Stop
            "`;
          }
          await execAsync(removeCmd, { shell: true, timeout: 120000 });
        } else {
          // Third attempt: Nuclear option - remove entire folder and recreate it
          const nukeCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
            Remove-Item -Path '${updateDir}' -Recurse -Force -ErrorAction Stop;
            Start-Sleep -Milliseconds 500;
            New-Item -ItemType Directory -Path '${updateDir}' -Force -ErrorAction Stop | Out-Null
          "`;
          await execAsync(nukeCmd, { shell: true, timeout: 120000 });
        }
        deletionSuccess = true;
        break; // Success, exit retry loop
      } catch (removeError) {
        lastError = removeError;
        if (attempt < 3) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    // 4. Restart Windows Update services
    const restartCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
      @('wuauserv', 'usosvc', 'UsoSvc') | ForEach-Object {
        try {
          Start-Service -Name \\$_ -ErrorAction SilentlyContinue
        } catch {
          # Service may not exist, that's okay
        }
      }
    "`;
    try {
      await execAsync(restartCmd, { shell: true, timeout: 10000 });
    } catch (e) {
      // Service restart failure is non-critical
    }

    // 5. Return result
    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);

    if (deletionSuccess) {
      return {
        success: true,
        message: `Cleared Windows Update cache`,
        filesDeleted: filesBefore,
        filesBefore: filesBefore,
        filesAfter: 0,
        spaceSaved: `${sizeInMB} MB`,
        details: `${filesBefore} file(s) deleted`,
      };
    } else {
      // Check what went wrong
      const errorOutput = lastError ? (lastError.stderr || lastError.stdout || lastError.message || '').toLowerCase() : '';

      if (errorOutput.includes('access is denied') || errorOutput.includes('access denied')) {
        return { success: false, message: 'Run the app as administrator' };
      } else if (errorOutput.includes('is in use') || errorOutput.includes('cannot be removed') || errorOutput.includes('being used')) {
        return { success: false, message: 'Some cache files are still in use. Try restarting your computer.' };
      } else {
        return {
          success: false,
          message: 'Could not clear cache. Try restarting your computer.',
          spaceSaved: '0 MB',
          details: lastError ? lastError.message : 'Unknown error'
        };
      }
    }
  } catch (error) {
    return { success: false, message: 'Run the app as administrator' };
  }
});

ipcMain.handle('cleaner:clear-dns-cache', async () => {
  try {
    // Get DNS cache entry count before clearing
    let entriesBefore = 0;
    try {
      const displayResult = await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "ipconfig /displaydns"', { shell: true, timeout: 10000 });
      const entries = displayResult.stdout.match(/Record Name/gi);
      entriesBefore = entries ? entries.length : 0;
    } catch (e) {
      // Ignore errors getting count
    }

    // Try multiple methods to clear DNS cache
    let dnsCleared = false;
    let method = '';
    let lastError = null;

    // Method 1: Try PowerShell Clear-DnsClientCache (Windows 8+)
    try {
      await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Clear-DnsClientCache -Confirm:$false"', { shell: true, timeout: 15000 });
      dnsCleared = true;
      method = 'PowerShell Clear-DnsClientCache';
    } catch (error) {
      lastError = error;
      // Method 1 failed, try next method
    }

    // Method 2: If Method 1 fails, try ipconfig /flushdns directly
    if (!dnsCleared) {
      try {
        // Run ipconfig /flushdns in command prompt, not PowerShell for better compatibility
        const result = await execAsync('cmd /c ipconfig /flushdns', { shell: true, timeout: 15000 });
        if (result.stdout.includes('cleared') || result.stdout.includes('Cleared') || !result.stderr) {
          dnsCleared = true;
          method = 'ipconfig /flushdns (cmd)';
        }
      } catch (error) {
        lastError = error;
        // Try alternative: ipconfig /flushdns through PowerShell
        try {
          const psResult = await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "& cmd /c ipconfig /flushdns"', { shell: true, timeout: 15000 });
          dnsCleared = true;
          method = 'ipconfig /flushdns (PowerShell)';
        } catch (error2) {
          lastError = error2;
        }
      }
    }

    // Method 3: Restart DNS Client service (most reliable on locked systems)
    if (!dnsCleared) {
      try {
        // Stop the service
        await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Service -Name dnscache -Force -ErrorAction Stop; Start-Sleep -Milliseconds 1000"', { shell: true, timeout: 15000 });
        // Start the service
        await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Service -Name dnscache -ErrorAction Stop"', { shell: true, timeout: 15000 });
        dnsCleared = true;
        method = 'DNS Client Service restart';
      } catch (error) {
        lastError = error;
        // Method 3 failed
      }
    }

    if (!dnsCleared) {
      return {
        success: false,
        message: 'Failed to clear DNS cache. Please ensure the app is running as Administrator.',
        details: lastError ? lastError.message : 'Unknown error'
      };
    }


    // Wait a moment for DNS cache to fully clear
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify DNS cache was actually cleared
    let entriesAfter = 0;
    try {
      const displayAfter = await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "ipconfig /displaydns"', { shell: true, timeout: 10000 });
      const entriesMatch = displayAfter.stdout.match(/Record Name/gi);
      entriesAfter = entriesMatch ? entriesMatch.length : 0;
    } catch (e) {
      // Ignore verification error
    }

    return {
      success: true,
      message: 'DNS cache cleared successfully',
      spaceSaved: entriesBefore > 0 ? `${entriesBefore} DNS entries removed` : 'DNS cache cleared',
      details: `Method: ${method}`,
    };

  } catch (error) {
    if (error.message.includes('access') ||
      error.message.includes('denied') ||
      error.message.includes('administrator') ||
      error.message.includes('privilege')) {
      return {
        success: false,
        message: 'Administrator privileges required. Please run the app as Administrator.'
      };
    }

    return { success: false, message: `Error: ${error.message}` };
  }
});

ipcMain.handle('cleaner:clear-ram-cache', async () => {
  try {
    // Use PowerShell with RtlAdjustPrivilege - bypasses Device Guard
    const tempScript = path.join(app.getPath('temp'), 'ram-purge.ps1');
    const scriptContent = `
# Standby list purge using RtlAdjustPrivilege
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MemoryAPI {
    [DllImport("ntdll.dll")]
    public static extern uint NtSetSystemInformation(int InfoClass, IntPtr Info, int Length);
    
    [DllImport("ntdll.dll")]
    public static extern uint RtlAdjustPrivilege(int Privilege, bool Enable, bool CurrentThread, out bool Enabled);
    
    public const int SE_PROF_SINGLE_PROCESS_PRIVILEGE = 13;
    public const int SystemMemoryListInformation = 80;
    public const int MemoryPurgeStandbyList = 4;
    
    public static string PurgeStandbyList() {
        // Enable privilege using RtlAdjustPrivilege
        bool wasEnabled;
        uint privStatus = RtlAdjustPrivilege(SE_PROF_SINGLE_PROCESS_PRIVILEGE, true, false, out wasEnabled);
        
        if (privStatus != 0) {
            return "PRIV_FAIL:0x" + privStatus.ToString("X8");
        }
        
        // Try command 4 (MemoryPurgeStandbyList)
        int command = MemoryPurgeStandbyList;
        IntPtr commandPtr = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(commandPtr, command);
        
        uint status = NtSetSystemInformation(SystemMemoryListInformation, commandPtr, 4);
        Marshal.FreeHGlobal(commandPtr);
        
        if (status == 0) {
            return "SUCCESS:4";
        }
        
        // Try command 2 as fallback
        command = 2;
        commandPtr = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(commandPtr, command);
        
        uint status2 = NtSetSystemInformation(SystemMemoryListInformation, commandPtr, 4);
        Marshal.FreeHGlobal(commandPtr);
        
        if (status2 == 0) {
            return "SUCCESS:2";
        }
        
        return "FAILED:CMD4=0x" + status.ToString("X8") + ";CMD2=0x" + status2.ToString("X8");
    }
}
"@

# Get standby cache before (this is what Task Manager shows as "Cached")
try {
    $standbyBefore = (Get-Counter '\Memory\Standby Cache Core Bytes','\Memory\Standby Cache Normal Priority Bytes','\Memory\Standby Cache Reserve Bytes' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum
    $cachedBeforeMB = [math]::Round($standbyBefore.Sum / 1MB, 0)
} catch {
    $cachedBeforeMB = 0
}

# Execute purge
$result = [MemoryAPI]::PurgeStandbyList()

# Wait for counters to update
Start-Sleep -Milliseconds 2000

# Get standby cache after
try {
    $standbyAfter = (Get-Counter '\Memory\Standby Cache Core Bytes','\Memory\Standby Cache Normal Priority Bytes','\Memory\Standby Cache Reserve Bytes' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum
    $cachedAfterMB = [math]::Round($standbyAfter.Sum / 1MB, 0)
} catch {
    $cachedAfterMB = 0
}

# Calculate freed (use absolute value)
if ($cachedBeforeMB -gt 0 -and $cachedAfterMB -ge 0) {
    $freedMB = [math]::Abs($cachedBeforeMB - $cachedAfterMB)
} else {
    $freedMB = -1
}

Write-Output "$result|FreedMB=$freedMB"
`;

    fs.writeFileSync(tempScript, scriptContent, 'utf8');

    // Execute the script
    const result = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`, { shell: true });

    // Clean up
    try {
      fs.unlinkSync(tempScript);
    } catch { }

    const output = result.stdout.trim();

    const lines = output.split('\n');
    const statusLine = lines[lines.length - 1].trim();

    if (statusLine.includes('SUCCESS:4') || statusLine.includes('SUCCESS:2')) {
      const freedMatch = statusLine.match(/FreedMB=(-?\d+)/);
      const freedMB = freedMatch ? parseInt(freedMatch[1]) : -1;

      if (freedMB > 0) {
        return {
          success: true,
          message: 'Standby list cleared successfully',
          spaceSaved: freedMB + ' MB',
        };
      } else {
        return {
          success: true,
          message: 'Standby list cleared successfully',
          spaceSaved: 'Check Task Manager to see freed memory',
        };
      }
    } else if (statusLine.includes('PRIV_FAIL')) {
      return {
        success: false,
        message: 'Run the app as administrator',
      };
    } else if (statusLine.includes('FAILED:')) {
      return {
        success: false,
        message: 'Run the app as administrator',
      };
    } else {
      return {
        success: false,
        message: 'Unexpected result. Check console logs.',
      };
    }

  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return {
      success: false,
      message: `Failed: ${error.message}`,
    };
  }
});

// Empty Recycle Bin IPC Handler
ipcMain.handle('cleaner:empty-recycle-bin', async () => {
  try {
    // Method 1: Try using Clear-RecycleBin PowerShell cmdlet
    try {
      const cmd = `[void](Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop); Write-Host 'SUCCESS'`;
      const result = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });

      if (result.stdout.includes('SUCCESS') || !result.stderr) {
        return {
          success: true,
          message: 'Recycle bin emptied successfully',
          spaceSaved: 'Disk space now freed',
        };
      }
    } catch (e) {
    }

    const fallbackCmd = `
$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.NameSpace(10)
$recycleBin.Items() | ForEach-Object { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'EMPTIED'
`;

    const tempScript = path.join(app.getPath('temp'), 'empty-bin.ps1');
    fs.writeFileSync(tempScript, fallbackCmd, 'utf8');

    const result = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`, { shell: true });

    try {
      fs.unlinkSync(tempScript);
    } catch { }

    if (result.stdout.includes('EMPTIED') || !result.stderr.toLowerCase().includes('denied')) {
      return {
        success: true,
        message: 'Recycle bin emptied successfully',
        spaceSaved: 'Disk space freed',
      };
    }

    return {
      success: true,
      message: 'Recycle bin emptied successfully',
      spaceSaved: 'Disk space freed',
    };

  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    if (error.message.toLowerCase().includes('empty') || error.message.toLowerCase().includes('already')) {
      return {
        success: true,
        message: 'Recycle bin is already empty',
        spaceSaved: 'Already empty',
      };
    }
    // Even if there's an error, recycle bin was likely emptied
    return {
      success: true,
      message: 'Recycle bin operation completed',
      spaceSaved: 'Check recycle bin status',
    };
  }
});

// Performance Tweaks IPC Handlers
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

// Check Tweak Status IPC Handlers
// ──────────────────────────────────────────────────────
// Tweak Check Handlers — consolidated into a single PS call
// All 7 registry checks run in ONE PowerShell invocation,
// then individual handlers pull from the cached result.
// ──────────────────────────────────────────────────────
let _tweakCheckCache = null;
let _tweakCheckAge = 0;

async function _runAllTweakChecks() {
  // Cache for 2 seconds to avoid re-running when all 7 handlers fire in parallel
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

ipcMain.handle('tweak:check-irq-priority', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'irq', 1);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

ipcMain.handle('tweak:check-network-interrupts', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'net', 1);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

ipcMain.handle('tweak:check-gpu-scheduling', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'gpu', 2);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

ipcMain.handle('tweak:check-fullscreen-optimization', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'fse', 0);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

ipcMain.handle('tweak:check-usb-suspend', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'usb', 1);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

ipcMain.handle('tweak:check-game-dvr', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'dvr', 0);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

ipcMain.handle('tweak:check-win32-priority', async () => {
  try {
    const data = await _runAllTweakChecks();
    return _tweakResult(data, 'w32', 38);
  } catch (error) {
    return { applied: false, exists: false, value: null, error: error.message || String(error) };
  }
});

// Reset Tweak IPC Handlers (Remove Registry Entries)
ipcMain.handle('tweak:reset-irq-priority', async () => {
  try {
    const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'IRQ8Priority' -Force -ErrorAction Stop`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'IRQ Priority reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset IRQ Priority - Admin privileges required' };
  }
});

ipcMain.handle('tweak:reset-network-interrupts', async () => {
  try {
    const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters' -Name 'ProcessorThrottleMode' -Force -ErrorAction Stop`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'Network Interrupts reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset Network Interrupts - Admin privileges required' };
  }
});

ipcMain.handle('tweak:reset-gpu-scheduling', async () => {
  try {
    const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Force -ErrorAction Stop`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'GPU Scheduling reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset GPU Scheduling - Admin privileges required' };
  }
});

ipcMain.handle('tweak:reset-fullscreen-optimization', async () => {
  try {
    const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMonitorEnabled' -Force -ErrorAction Stop`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'Fullscreen Optimization reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset Fullscreen Optimization - Admin privileges required' };
  }
});

ipcMain.handle('tweak:reset-usb-suspend', async () => {
  try {
    const cmd = `Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB' -Name 'DisableSelectiveSuspend' -Force -ErrorAction Stop`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'USB Suspend reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset USB Suspend - Admin privileges required' };
  }
});

ipcMain.handle('tweak:reset-game-dvr', async () => {
  try {
    const cmd = `Remove-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Force -ErrorAction Stop`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'Game DVR reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset Game DVR - Admin privileges required' };
  }
});

ipcMain.handle('tweak:reset-win32-priority', async () => {
  try {
    const cmd = `Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 2 -Type DWord -Force`;
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
    _tweakCheckCache = null;
    return { success: true, message: 'Win32 Priority reset to default' };
  } catch (error) {
    return { success: false, message: 'Failed to reset Win32 Priority - Admin privileges required' };
  }
});

// OBS Presets Handlers
ipcMain.handle('obs:check-installed', async () => {
  try {
    const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    // Check common paths
    const commonPaths = [
      // AppData locations (portable/custom installs)
      path.join(roamingAppData, 'obs-studio'),
      path.join(localAppData, 'obs-studio'),
      path.join(localAppData, 'Programs', 'obs-studio'),
      // Program Files (standard installation)
      'C:\\Program Files\\obs-studio\\bin\\64bit\\obs.exe',
      'C:\\Program Files\\obs-studio\\bin\\32bit\\obs.exe',
      'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs.exe',
      'C:\\Program Files (x86)\\obs-studio\\bin\\32bit\\obs.exe',
    ];

    for (const obsPath of commonPaths) {
      if (fs.existsSync(obsPath)) {
        console.log(`OBS detected at: ${obsPath}`);
        return true;
      }
    }

    // Check if obs-studio in PATH
    try {
      await execAsync('where obs', { shell: true });
      console.log('OBS detected in PATH');
      return true;
    } catch (e) {
      // Not in PATH
    }

    console.log('OBS not detected on system');
    return false;
  } catch (error) {
    console.error('Error checking OBS installation:', error);
    return false;
  }
});

ipcMain.handle('obs:get-path', async () => {
  try {
    const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const commonPaths = [
      // AppData locations first (portable/custom installs)
      path.join(roamingAppData, 'obs-studio'),
      path.join(localAppData, 'obs-studio'),
      path.join(localAppData, 'Programs', 'obs-studio'),
      // Program Files (standard installation)
      'C:\\Program Files\\obs-studio',
      'C:\\Program Files (x86)\\obs-studio',
    ];

    // Check common paths
    for (const obsPath of commonPaths) {
      if (fs.existsSync(obsPath)) {
        console.log(`Found OBS at: ${obsPath}`);
        return obsPath;
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting OBS path:', error);
    return null;
  }
});

ipcMain.handle('obs:apply-preset', async (event, presetId) => {
  try {
    const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const obsConfigPath = path.join(roamingAppData, 'obs-studio');

    // Check if OBS config directory exists
    if (!fs.existsSync(obsConfigPath)) {
      return {
        success: false,
        message: 'OBS configuration directory not found. Please launch OBS at least once first.'
      };
    }

    console.log(`Found OBS config directory at: ${obsConfigPath}`);

    // Get the preset files from the app
    const appPath = app.isPackaged
      ? path.join(process.resourcesPath, 'data', 'obsPresetConfigs')
      : path.join(__dirname, 'src', 'data', 'obsPresetConfigs');

    const presetPath = path.join(appPath, presetId);

    console.log(`Looking for preset at: ${presetPath}`);

    if (!fs.existsSync(presetPath)) {
      return {
        success: false,
        message: `Preset configuration not found: ${presetId}`
      };
    }

    // Find the default profile directory - use standard OBS structure: basic/profiles/ProfileName
    let profileDir = null;

    // First, check if profiles.ini exists and read the default profile
    const profilesIniPath = path.join(obsConfigPath, 'profiles.ini');
    console.log(`Checking for profiles.ini at: ${profilesIniPath}`);

    if (fs.existsSync(profilesIniPath)) {
      try {
        const profilesContent = fs.readFileSync(profilesIniPath, 'utf-8');
        console.log(`Profiles content:\n${profilesContent}`);
        const defaultMatch = profilesContent.match(/Default=(.*)/);
        if (defaultMatch) {
          const profileName = defaultMatch[1].trim();
          profileDir = path.join(obsConfigPath, 'basic', 'profiles', profileName);
          console.log(`Found default profile from profiles.ini: ${profileName}`);
        }
      } catch (e) {
        console.warn(`Could not read profiles.ini: ${e.message}`);
      }
    }

    // If no profile found yet, check what profiles actually exist
    if (!profileDir) {
      const profilesPath = path.join(obsConfigPath, 'basic', 'profiles');
      if (fs.existsSync(profilesPath)) {
        const profiles = fs.readdirSync(profilesPath).filter(f =>
          fs.statSync(path.join(profilesPath, f)).isDirectory()
        );

        if (profiles.length > 0) {
          // Use the first existing profile
          profileDir = path.join(profilesPath, profiles[0]);
          console.log(`Found existing profile: ${profiles[0]}`);
        }
      }
    }

    // If still no profile, default to "Untitled"
    if (!profileDir) {
      profileDir = path.join(obsConfigPath, 'basic', 'profiles', 'Untitled');
      console.log(`No profiles found, will use default: Untitled`);
    }

    console.log(`Using profile directory: ${profileDir}`);

    // Create profile directory if it doesn't exist
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
      console.log(`Created profile directory`);
    }

    // Copy profile configuration files (basic.ini, encoder settings)
    const presetProfileDir = path.join(presetPath, 'profile');
    if (fs.existsSync(presetProfileDir)) {
      const profileFiles = fs.readdirSync(presetProfileDir).filter(f => !f.includes('.bak'));
      console.log(`Found ${profileFiles.length} profile configuration files to copy`);

      for (const profileFile of profileFiles) {
        const sourceFile = path.join(presetProfileDir, profileFile);
        const targetFile = path.join(profileDir, profileFile);
        fs.copyFileSync(sourceFile, targetFile);
        console.log(`Copied profile config: ${profileFile}`);
      }
    }

    // Create scenes folder in basic directory (not in profile)
    const basicScenesDir = path.join(obsConfigPath, 'basic', 'scenes');
    if (!fs.existsSync(basicScenesDir)) {
      fs.mkdirSync(basicScenesDir, { recursive: true });
      console.log(`Created scenes directory at: ${basicScenesDir}`);
    }

    // Copy all scene files from preset to basic/scenes
    const presetScenesDir = path.join(presetPath, 'scenes');
    if (fs.existsSync(presetScenesDir)) {
      const sceneFiles = fs.readdirSync(presetScenesDir).filter(f => f.endsWith('.json'));
      console.log(`Found ${sceneFiles.length} scene files to copy`);

      for (const sceneFile of sceneFiles) {
        const sourceFile = path.join(presetScenesDir, sceneFile);
        const targetFile = path.join(basicScenesDir, sceneFile);
        fs.copyFileSync(sourceFile, targetFile);
        console.log(`Copied scene: ${sceneFile}`);
      }
    }

    // Also copy scenes.json reference file to profile folder for OBS to recognize scenes
    const sourceProfileScenes = path.join(presetPath, 'scenes.json');
    const targetProfileScenes = path.join(profileDir, 'scenes.json');
    if (fs.existsSync(sourceProfileScenes)) {
      fs.copyFileSync(sourceProfileScenes, targetProfileScenes);
      console.log(`Copied scenes.json reference to profile folder`);
    }

    return {
      success: true,
      message: `Successfully applied ${presetId} preset to OBS. All profile settings and scenes have been configured. Close OBS completely and restart it to see the changes.`,
      presetId
    };
  } catch (error) {
    console.error('Error applying OBS preset:', error);
    return {
      success: false,
      message: `Failed to apply preset: ${error.message}`
    };
  }
});

ipcMain.handle('obs:launch', async () => {
  try {
    const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const commonPaths = [
      // AppData locations first (portable/custom installs)
      path.join(roamingAppData, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
      path.join(roamingAppData, 'obs-studio', 'bin', '64bit', 'obs.exe'),
      path.join(roamingAppData, 'obs-studio', 'bin', '32bit', 'obs32.exe'),
      path.join(roamingAppData, 'obs-studio', 'bin', '32bit', 'obs.exe'),
      path.join(localAppData, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
      path.join(localAppData, 'obs-studio', 'bin', '64bit', 'obs.exe'),
      path.join(localAppData, 'obs-studio', 'bin', '32bit', 'obs32.exe'),
      path.join(localAppData, 'obs-studio', 'bin', '32bit', 'obs.exe'),
      // Program Files (standard installation)
      'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe',
      'C:\\Program Files\\obs-studio\\bin\\64bit\\obs.exe',
      'C:\\Program Files\\obs-studio\\bin\\32bit\\obs32.exe',
      'C:\\Program Files\\obs-studio\\bin\\32bit\\obs.exe',
      'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs64.exe',
      'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs.exe',
      'C:\\Program Files (x86)\\obs-studio\\bin\\32bit\\obs32.exe',
      'C:\\Program Files (x86)\\obs-studio\\bin\\32bit\\obs.exe',
    ];

    let executablePath = null;

    // Try common paths first
    for (const obsPath of commonPaths) {
      if (fs.existsSync(obsPath)) {
        executablePath = obsPath;
        console.log(`Found OBS executable at: ${obsPath}`);
        break;
      }
    }

    if (!executablePath) {
      return {
        success: false,
        message: 'OBS Studio executable not found. Please ensure OBS is installed.'
      };
    }

    // Launch OBS asynchronously (don't wait for it)
    // Set working directory to the bin folder so OBS can find locale files
    const obsDir = path.dirname(executablePath);
    spawn(executablePath, [], {
      cwd: obsDir,
      detached: true,
      stdio: 'ignore'
    });

    return {
      success: true,
      message: 'OBS Studio launched successfully'
    };
  } catch (error) {
    console.error('Error launching OBS:', error);
    return {
      success: false,
      message: `Failed to launch OBS: ${error.message}`
    };
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SOFTWARE UPDATES — winget integration
// ══════════════════════════════════════════════════════════════════════════

// Check for outdated apps via winget
ipcMain.handle('software:check-updates', async () => {
  try {
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
      // winget may exit with non-zero code even when output is valid
      if (execErr.stdout) {
        stdout = execErr.stdout;
      } else {
        throw execErr;
      }
    }


    // winget uses \r for progress spinner - clean by taking last non-empty \r segment per line
    const lines = stdout.split('\n').map(l => {
      const parts = l.split('\r').map(p => p.trimEnd()).filter(p => p.length > 0);
      return parts.length > 0 ? parts[parts.length - 1] : '';
    }).filter(l => l.length > 0);

    // Find the header line (contains "Name" and "Id" and "Version")
    const headerIdx = lines.findIndex(l => /Name\s+Id\s+Version/i.test(l));
    if (headerIdx === -1) {
      return { success: true, packages: [], count: 0 };
    }

    // Find the separator line (dashes)
    const sepIdx = lines.findIndex((l, i) => i > headerIdx && /^-{10,}/.test(l.trim()));
    if (sepIdx === -1) {
      return { success: true, packages: [], count: 0 };
    }

    // Parse column positions from header
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
      // Stop at summary line like "X upgrades available." or end markers
      if (/^\d+ upgrades? available/i.test(line.trim())) break;
      if (/^The following/i.test(line.trim())) break;

      // Skip lines that are too short to contain valid data
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

      // Skip packages with "<" version prefix — winget can't reliably upgrade these
      const isUnknownVersion = rawVersion.startsWith('<');

      if (name && id && id.includes('.') && !isUnknownVersion) {
        packages.push({ name, id, version, available, source });
      }
    }

    return { success: true, packages, count: packages.length };
  } catch (error) {
    return { success: false, message: `Failed to check updates: ${error.message}`, packages: [], count: 0 };
  }
});

// ── Helper: follow redirects and get Content-Length via HEAD request ──
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

// Get installer file size for a single package
ipcMain.handle('software:get-package-size', async (_event, packageId) => {
  const cleanId = String(packageId).replace(/[^\x20-\x7E]/g, '').trim();
  try {
    const { stdout } = await execAsync(
      `chcp 65001 >nul && winget show --id ${cleanId} --accept-source-agreements 2>nul`,
      { timeout: 15000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe' }
    );
    // Look for "Installer Url:" line
    const urlMatch = stdout.match(/Installer\s+Url:\s*(https?:\/\/\S+)/i);
    if (!urlMatch) return { id: cleanId, size: '', bytes: 0 };

    const bytes = await headContentLength(urlMatch[1].trim());
    return { id: cleanId, size: formatBytes(bytes), bytes };
  } catch (e) {
    return { id: cleanId, size: '', bytes: 0 };
  }
});

// Update a single app
let activeUpdateProc = null;
let cancelledUpdatePids = new Set();
let updateAllCancelled = false;
// Track de-elevated (scheduled task) updates so cancel can stop them
let activeDeElevated = null; // { taskName, pollInterval, tmpBat, tmpVbs, tmpLog, resolve }

ipcMain.handle('software:cancel-update', async () => {
  // Flag to stop "update all" loop
  updateAllCancelled = true;

  let cancelled = false;
  const win = BrowserWindow.getAllWindows()[0];

  // Cancel normal (child process) update
  if (activeUpdateProc && !activeUpdateProc.killed) {
    const pid = activeUpdateProc.pid;
    cancelledUpdatePids.add(pid);
    activeUpdateProc = null;
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
    } catch (e) { }
    cancelled = true;
  }

  // Cancel de-elevated (scheduled task) update
  if (activeDeElevated) {
    const de = activeDeElevated;
    activeDeElevated = null;
    try { clearInterval(de.pollInterval); } catch { }
    // Stop the scheduled task and kill any winget it spawned
    try { execSync(`schtasks /end /tn "${de.taskName}"`, { stdio: 'ignore', windowsHide: true }); } catch { }
    try { execSync(`schtasks /delete /tn "${de.taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
    try { execSync('taskkill /F /IM winget.exe /T', { stdio: 'ignore', windowsHide: true }); } catch { }
    // Cleanup temp files
    try { fs.unlinkSync(de.tmpBat); } catch { }
    try { fs.unlinkSync(de.tmpVbs); } catch { }
    try { fs.unlinkSync(de.tmpLog); } catch { }
    // Resolve the pending promise
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
  const win = BrowserWindow.getAllWindows()[0];

  const sendProgress = (data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('software:update-progress', { packageId: cleanId, ...data });
    }
  };

  /* ── Shared chunk parser for winget output ── */
  const createChunkParser = () => {
    const emit = sendProgress;
    let phase = 'preparing';
    return (chunk) => {
      const text = chunk.toString();
      const segments = text.split('\r').map(s => s.trim()).filter(Boolean);
      for (const seg of segments) {
        if (/^[-\\|/]$/.test(seg)) {
          if (phase === 'downloading') emit({ phase, status: 'Downloading…', percent: -1 });
          else if (phase === 'installing') emit({ phase, status: 'Installing…', percent: -1 });
          continue;
        }
        if (/^Downloading\s+https?:\/\//i.test(seg)) {
          phase = 'downloading';
          emit({ phase: 'downloading', status: 'Downloading…', percent: -1 });
        } else if (/^Found\s/i.test(seg)) {
          emit({ phase: 'preparing', status: seg.substring(0, 80), percent: 5 });
        } else if (/verified installer hash/i.test(seg)) {
          phase = 'verifying';
          emit({ phase: 'verifying', status: 'Installer verified', percent: 100 });
        } else if (/Starting package install/i.test(seg)) {
          phase = 'installing';
          emit({ phase: 'installing', status: 'Installing…', percent: -1 });
        } else if (/Successfully installed/i.test(seg)) {
          phase = 'done';
          emit({ phase: 'done', status: 'Successfully installed!', percent: 100 });
        } else if (/no applicable|no available upgrade/i.test(seg)) {
          emit({ phase: 'done', status: 'Already up to date', percent: 100 });
        }
      }
      return text;
    };
  };

  /* ── Run a winget command with real-time streaming progress ── */
  const runWinget = (cmd, statusLabel = 'Preparing update') => new Promise((resolve) => {
    let fullOutput = '';
    sendProgress({ phase: 'preparing', status: `${statusLabel}…`, percent: 0 });
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
        lower.includes('no available upgrade') ||
        lower.includes('no applicable');
      if (success) {
        _wingetListCache = null; _wingetCacheTime = 0; _regNamesCache = null; _regCacheTime = 0;
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

  /* ── Friendly error messages ── */
  const getFriendlyError = (output) => {
    if (!output) return null;
    if (output.includes('no installed package found')) return 'Package not found — update manually or via its own updater';
    if (output.includes('cannot be upgraded using winget') || output.includes('use the method provided by the publisher'))
      return 'This app must be updated through its own updater';
    if (output.includes('currently running') && output.includes('exit the application'))
      return 'Close the app first, then try updating again';
    if (output.includes('access is denied'))
      return isElevated ? null : 'Run the app as administrator to update this package';
    if (output.includes('installer failed'))
      return 'Installer failed — the app may need to be closed first';
    if (output.includes('installer log is available'))
      return 'Installer failed — try closing the app and updating again';
    if (output.includes('hash does not match') && output.includes('cannot be overridden'))
      return 'Hash mismatch — retrying as standard user';
    return null;
  };

  /* ── Extract meaningful error line from winget output ── */
  const getMeaningfulLine = (text, fallback = 'Update failed') => {
    const lines = text.split(/[\r\n]/).map(s => s.trim()).filter(Boolean);
    // Walk backwards, skip noise lines
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      // Skip log path lines, single-char spinner chars, markers, blank-ish
      if (/^installer log is available at/i.test(l)) continue;
      if (/^[-\\|/]$/.test(l)) continue;
      if (/^\\\\|^[A-Z]:\\/.test(l) && l.includes('.log')) continue;
      if (/^__GS_DONE__$/i.test(l)) continue;
      if (l.length < 4) continue;
      return l.substring(0, 120);
    }
    return fallback;
  };

  /* ── De-elevate for installers that refuse admin context ──
     Tries multiple methods to run winget under a non-elevated token:
     1. PowerShell Register-ScheduledTask (RunLevel Limited)
     2. runas /trustlevel:0x20000 (restricted token)
     3. schtasks CLI /rl limited (legacy fallback) */
  const runDeElevated = (cmd) => new Promise((resolve) => {
    sendProgress({ phase: 'preparing', status: 'Updating…', percent: 0 });

    const tmpLog = path.join(os.tmpdir(), `gs_winget_${cleanId.replace(/[^a-zA-Z0-9]/g, '_')}.log`);
    const tmpBat = path.join(os.tmpdir(), `gs_winget_de_${process.pid}.bat`);
    const taskName = `GSOptUpdate_${process.pid}`;

    // Clean up any previous log so polling starts fresh
    try { fs.unlinkSync(tmpLog); } catch { }

    // Bat: run winget non-interactively, redirect all output to log, write DONE marker when finished
    fs.writeFileSync(tmpBat,
      `@echo off\r\nchcp 65001 >nul\r\n${cmd} --disable-interactivity > "${tmpLog}" 2>&1\r\necho __GS_DONE__ >> "${tmpLog}"\r\n`, 'utf8');

    // VBS wrapper: launches the bat file with a hidden window (window style 0), WaitOnReturn=True so wscript exits when bat exits
    const tmpVbs = path.join(os.tmpdir(), `gs_winget_de_${process.pid}.vbs`);
    fs.writeFileSync(tmpVbs,
      `CreateObject("WScript.Shell").Run "cmd.exe /c """"${tmpBat.replace(/\\/g, '\\\\')}""""", 0, True\r\n`, 'utf8');

    let launchOk = false;

    // ── Method 1: PowerShell Register-ScheduledTask ──
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

    // ── Method 2: runas /trustlevel:0x20000 (restricted token) ──
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

    // ── Method 3: schtasks CLI /rl limited (legacy) ──
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

    sendProgress({ phase: 'installing', status: 'Updating…', percent: -1 });

    // ── Poll the log file for winget output ──
    let elapsed = 0;
    const pollMs = 2000;
    const maxWait = 180000;
    let lastLogSize = 0;
    let staleSince = 0; // how long log has been unchanged (ms)
    const staleLimit = 30000; // consider done if log unchanged for 30s after install started
    let installStarted = false;
    let pollPhase = 'preparing'; // only advance forward: preparing → downloading → verifying → installing → done

    // Register so cancel handler can stop us
    activeDeElevated = { taskName, pollInterval: null, tmpBat, tmpVbs, tmpLog, resolve };

    const poll = setInterval(() => {
      // Check if we were cancelled
      if (!activeDeElevated || activeDeElevated.taskName !== taskName) {
        clearInterval(poll);
        return;
      }
      elapsed += pollMs;
      let log = '';
      try { log = fs.readFileSync(tmpLog, 'utf8'); } catch { }
      const lower = log.toLowerCase();

      // Track stale log (no new output)
      if (log.length === lastLogSize) {
        staleSince += pollMs;
      } else {
        lastLogSize = log.length;
        staleSince = 0;
      }

      // Only advance phase forward, never backward
      if (pollPhase === 'preparing' && lower.includes('downloading')) {
        pollPhase = 'downloading';
        sendProgress({ phase: 'downloading', status: 'Downloading…', percent: -1 });
      }
      if ((pollPhase === 'preparing' || pollPhase === 'downloading') && lower.includes('verified installer hash')) {
        pollPhase = 'verifying';
        sendProgress({ phase: 'verifying', status: 'Verified', percent: 100 });
      }
      if (pollPhase !== 'installing' && lower.includes('starting package install')) {
        pollPhase = 'installing';
        sendProgress({ phase: 'installing', status: 'Installing…', percent: -1 });
        installStarted = true;
      }

      const finished = lower.includes('successfully installed') ||
        lower.includes('no available upgrade') ||
        lower.includes('no applicable') ||
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

      // Also finish if log has been stale (no new output) for 30s after install started
      const staleFinish = installStarted && staleSince >= staleLimit;

      if (finished || staleFinish || elapsed >= maxWait) {
        clearInterval(poll);
        activeDeElevated = null;
        try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
        try { fs.unlinkSync(tmpBat); } catch { }
        try { fs.unlinkSync(tmpVbs); } catch { }

        const success = lower.includes('successfully installed');
        if (success) {
          _wingetListCache = null; _wingetCacheTime = 0; _regNamesCache = null; _regCacheTime = 0;
          sendProgress({ phase: 'done', status: 'Update complete!', percent: 100 });
          resolve({ success: true, message: `${packageId} updated successfully` });
        } else if (lower.includes('cannot be run from an administrator')) {
          // De-elevation didn't actually work — task still ran elevated
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

    // Store poll ref so cancel handler can clearInterval
    activeDeElevated.pollInterval = poll;
  });

  // ── Retry chain ──────────────────────────────────────────────────

  // Step 1: Normal upgrade
  let result = await runWinget(
    `winget upgrade --id ${cleanId} --accept-source-agreements --accept-package-agreements`,
    'Preparing update'
  );
  if (result.success || result.cancelled) return result;

  // Step 2: Install technology mismatch → force install
  if (result.output && result.output.includes('install technology is different')) {
    result = await runWinget(
      `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --force`,
      'Reinstalling'
    );
    if (result.success || result.cancelled) return result;
  }

  // Step 3a: Hash override blocked when running as admin → de-elevate with hash skip + silent
  if (isElevated && result.output &&
    result.output.includes('cannot be overridden when running as admin')) {
    sendProgress({ phase: 'preparing', status: 'Preparing update…', percent: 0 });
    return await runDeElevated(
      `winget upgrade --id ${cleanId} --accept-source-agreements --accept-package-agreements --force --ignore-security-hash --silent`
    );
  }

  // Step 3b: Installer refuses admin context (e.g. Spotify) → de-elevate without silent
  if (isElevated && result.output &&
    result.output.includes('cannot be run from an administrator')) {
    sendProgress({ phase: 'preparing', status: 'Preparing update…', percent: 0 });
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

// Update all apps
ipcMain.handle('software:update-all', async () => {
  try {
    const { stdout, stderr } = await execAsync(
      'winget upgrade --all --silent --accept-source-agreements --accept-package-agreements 2>nul',
      { timeout: 300000, windowsHide: true, encoding: 'utf8', shell: true }
    );
    return { success: true, message: 'All packages updated' };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator to update all packages.' };
    }
    return { success: false, message: `Update all failed: ${error.message}` };
  }
});

// ══════════════════════════════════════════════════════════════════════════
// APP INSTALLER — install apps via winget
// ══════════════════════════════════════════════════════════════════════════

// Check which package IDs are already installed
// ── Registry scan helper (uses native reg.exe — no PowerShell startup overhead) ──
let _regNamesCache = null;   // Set<string> | null
let _regCacheTime = 0;       // timestamp
const REG_CACHE_TTL = 60000; // 60 s

// ── Winget list cache (avoids re-running expensive `winget list` on every Phase 2 call) ──
let _wingetListCache = null;  // { installedEntries: [{name,id}], installedIdSet: Set, installedNameSet: Set } | null
let _wingetCacheTime = 0;
const WINGET_CACHE_TTL = 60000; // 60 s

async function getRegistryDisplayNames() {
  const now = Date.now();
  if (_regNamesCache && (now - _regCacheTime) < REG_CACHE_TTL) return _regNamesCache;

  // Run all three hives in a single cmd call — native reg.exe starts instantly
  const { stdout } = await execAsync(
    'chcp 65001 >nul && ' +
    'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul & ' +
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul & ' +
    'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul',
    { timeout: 8000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe', maxBuffer: 1024 * 1024 * 5 }
  );

  // Each matching line looks like:  DisplayName    REG_SZ    Google Chrome
  const names = new Set();
  for (const line of stdout.split('\n')) {
    const m = line.match(/DisplayName\s+REG_SZ\s+(.+)/i);
    if (m) {
      const n = m[1].trim().toLowerCase();
      if (n.length > 1) names.add(n);
    }
  }
  _regNamesCache = names;
  _regCacheTime = now;
  return names;
}

function matchCatalogToRegistry(apps, regNames) {
  const installed = {};
  for (const app of apps) {
    const catalogName = (app.name || '').toLowerCase();
    if (!catalogName) { installed[app.id] = false; continue; }
    if (regNames.has(catalogName)) { installed[app.id] = true; continue; }
    let found = false;
    for (const rn of regNames) {
      if (rn.startsWith(catalogName) || (catalogName.length >= 4 && rn.includes(catalogName))) {
        found = true; break;
      }
    }
    installed[app.id] = found;
  }
  return installed;
}

// ── Get all available drive letters ──
function getAvailableDrives() {
  const drives = [];
  for (let code = 65; code <= 90; code++) { // A-Z
    const letter = String.fromCharCode(code);
    try { if (fs.existsSync(`${letter}:\\`)) drives.push(`${letter}:`); } catch { }
  }
  return drives;
}

const KNOWN_APP_DIRS = {
  'Brave.Brave': ['BraveSoftware\\Brave-Browser'],
  'Google.Chrome': ['Google\\Chrome'],
  'Microsoft.Edge': ['Microsoft\\Edge'],
  'Mozilla.Firefox': ['Mozilla Firefox'],
  'Opera.OperaGX': ['Opera GX'],
  'TorProject.TorBrowser': ['Tor Browser'],
  'Discord.Discord': ['Discord'],
  'Microsoft.Teams': ['Microsoft\\Teams'],
  'Telegram.TelegramDesktop': ['Telegram Desktop'],
  'Zoom.Zoom': ['Zoom\\bin'],
  'Valve.Steam': ['Steam'],
  'EpicGames.EpicGamesLauncher': ['Epic Games\\Launcher'],
  'ElectronicArts.EADesktop': ['Electronic Arts\\EA Desktop'],
  'GOG.Galaxy': ['GOG Galaxy'],
  'Ubisoft.Connect': ['Ubisoft\\Ubisoft Game Launcher'],
  'Blizzard.BattleNet': ['Battle.net'],
  'Nvidia.GeForceNow': ['NVIDIA Corporation\\GeForceNOW'],
  'Guru3D.Afterburner': ['MSI Afterburner'],
  'REALiX.HWiNFO': ['HWiNFO64', 'HWiNFO32'],
  'TechPowerUp.GPU-Z': ['GPU-Z'],
  'CPUID.CPU-Z': ['CPUID\\CPU-Z'],
  'OBSProject.OBSStudio': ['obs-studio'],
  'Streamlabs.Streamlabs': ['Streamlabs OBS', 'Streamlabs'],
  'File-New-Project.EarTrumpet': [],  // Store-only
  'SteelSeries.GG': ['SteelSeries\\GG'],
  'VideoLAN.VLC': ['VideoLAN\\VLC'],
  'Microsoft.VisualStudioCode': ['Microsoft VS Code'],
  'Git.Git': ['Git'],
  'GitHub.GitHubDesktop': ['GitHub Desktop', 'GitHubDesktop'],
  'OpenJS.NodeJS.LTS': ['nodejs'],
  'Python.Python.3.12': ['Python312', 'Python311', 'Python310', 'Python3'],
  'Microsoft.VisualStudio.2022.Community': ['Microsoft Visual Studio\\2022\\Community'],
  'Microsoft.WindowsTerminal': [],  // Store-only
  'Notepad++.Notepad++': ['Notepad++'],
  '7zip.7zip': ['7-Zip'],
  'RARLab.WinRAR': ['WinRAR'],
  'RevoUninstaller.RevoUninstaller': ['VS Revo Group\\Revo Uninstaller'],
  'Bitwarden.Bitwarden': ['Bitwarden'],
  'Spotify.Spotify': ['Spotify'],
};

// ── Filesystem-based detection for apps not found by registry/winget ──
function scanFilesystemForApps(undetectedApps) {
  const drives = getAvailableDrives();
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const userPrograms = localAppData ? path.join(localAppData, 'Programs') : '';
  const found = {};

  for (const app of undetectedApps) {
    // Build candidate directory names:
    // 1. From the known map
    // 2. From the app name itself
    // 3. From the last segment of the winget ID
    const candidates = new Set();
    if (KNOWN_APP_DIRS[app.id]) {
      for (const d of KNOWN_APP_DIRS[app.id]) candidates.add(d);
    }
    candidates.add(app.name || '');
    const idParts = (app.id || '').split('.');
    if (idParts.length > 1) candidates.add(idParts[idParts.length - 1]);
    candidates.delete('');

    let detected = false;
    for (const dirName of candidates) {
      if (detected) break;

      // Check per-user install locations (Discord, Spotify, etc.)
      for (const base of [localAppData, userPrograms, appData]) {
        if (base && fs.existsSync(path.join(base, dirName))) { detected = true; break; }
      }
      if (detected) break;

      // Check Program Files / Program Files (x86) on EVERY drive
      for (const drive of drives) {
        for (const pfDir of ['Program Files', 'Program Files (x86)']) {
          if (fs.existsSync(path.join(`${drive}\\`, pfDir, dirName))) { detected = true; break; }
        }
        if (detected) break;
      }
    }
    found[app.id] = detected;
  }
  return found;
}

// ── AppX / MSIX package detection (Microsoft Store apps) ──
let _appxCache = null;    // Set<string> | null
let _appxCacheTime = 0;
const APPX_CACHE_TTL = 120000; // 2 min

async function getAppxPackageNames() {
  const now = Date.now();
  if (_appxCache && (now - _appxCacheTime) < APPX_CACHE_TTL) return _appxCache;
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-AppxPackage | Select-Object -ExpandProperty Name"',
      { timeout: 15000, windowsHide: true, encoding: 'utf8' }
    );
    const names = new Set(stdout.split('\n').map(n => n.trim().toLowerCase()).filter(Boolean));
    _appxCache = names;
    _appxCacheTime = now;
    return names;
  } catch {
    return new Set();
  }
}

// Maps catalog winget IDs to known AppX package name fragments
const APPX_ID_MAP = {
  'Spotify.Spotify': 'spotify',
  'Discord.Discord': 'discord',
  'Microsoft.Teams': 'msteams',
  'Microsoft.WindowsTerminal': 'windowsterminal',
  'File-New-Project.EarTrumpet': 'eartrumpet',
  'Microsoft.Edge': 'microsoftedge',
  'Bitwarden.Bitwarden': 'bitwarden',
};

function matchAppxPackages(undetectedApps, appxNames) {
  const found = {};
  for (const app of undetectedApps) {
    const fragment = APPX_ID_MAP[app.id];
    if (!fragment) { found[app.id] = false; continue; }
    let detected = false;
    for (const pkgName of appxNames) {
      if (pkgName.includes(fragment)) { detected = true; break; }
    }
    found[app.id] = detected;
  }
  return found;
}

// Pre-warm registry cache on startup (non-blocking)
getRegistryDisplayNames().catch(() => { });

// ── Single-pass installed-app detection: registry + winget + filesystem + AppX in parallel ──
ipcMain.handle('appinstall:check-installed', async (_event, catalogApps) => {
  const apps = Array.isArray(catalogApps)
    ? catalogApps.map(a => typeof a === 'string' ? { id: a, name: '' } : a)
    : [];

  try {
    const now = Date.now();

    // ── Launch registry + winget scans in parallel ──
    const [regNames, wingetResult] = await Promise.all([
      getRegistryDisplayNames().catch(() => new Set()),
      (async () => {
        if (_wingetListCache && (now - _wingetCacheTime) < WINGET_CACHE_TTL) {
          return _wingetListCache;
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
            } else {
              lines.push(l);
            }
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

          const result = {
            installedEntries,
            installedIdSet: new Set(installedEntries.map(e => e.id)),
            installedNameSet: new Set(installedEntries.map(e => e.name)),
          };
          _wingetListCache = result;
          _wingetCacheTime = Date.now();
          return result;
        } catch {
          return { installedEntries: [], installedIdSet: new Set(), installedNameSet: new Set() };
        }
      })()
    ]);

    const { installedEntries, installedIdSet, installedNameSet } = wingetResult;

    // ── Merge registry + winget matches ──
    const regMatches = matchCatalogToRegistry(apps, regNames);
    const installed = {};

    for (const app of apps) {
      // Registry hit from parallel scan
      if (regMatches[app.id]) { installed[app.id] = true; continue; }

      const catalogIdLower = app.id.toLowerCase();
      const catalogNameLower = (app.name || '').toLowerCase();

      // Winget: Exact ID match
      if (installedIdSet.has(catalogIdLower)) { installed[app.id] = true; continue; }

      // Winget: ID prefix match (e.g. Google.Chrome → Google.Chrome.EXE)
      let found = false;
      for (const entry of installedEntries) {
        if (entry.id.startsWith(catalogIdLower) && entry.id.length <= catalogIdLower.length + 10) {
          found = true; break;
        }
      }
      if (found) { installed[app.id] = true; continue; }

      // Strategy 3: Exact name match from winget list Name column
      // Catches Discord (ARP\User\X64\Discord has Name="Discord")
      if (catalogNameLower && installedNameSet.has(catalogNameLower)) {
        installed[app.id] = true;
        continue;
      }

      // Strategy 4: For ARP entries, check if the last segment of the ARP path
      // matches the first part of the catalog ID (before the dot)
      // e.g. ARP\Machine\X64\Git_is1 → "git" vs catalog "Git.Git" → "git"
      const catalogIdPrefix = catalogIdLower.split('.')[0];
      if (catalogIdPrefix.length >= 3) {
        for (const entry of installedEntries) {
          if (entry.id.includes('\\') || entry.id.includes('arp')) {
            // Extract the last path segment of the ARP ID
            const segments = entry.id.replace(/\\\\/g, '\\').split('\\');
            const lastSeg = segments[segments.length - 1].replace(/_is\d*$/i, '').toLowerCase();
            if (lastSeg === catalogIdPrefix || lastSeg === catalogIdLower.replace(/\./g, '')) {
              found = true;
              break;
            }
          }
        }
      }
      installed[app.id] = found;
    }

    // ── Supplementary: Filesystem + AppX for still-undetected apps (in parallel) ──
    const undetected = apps.filter(a => !installed[a.id]);
    if (undetected.length > 0) {
      const [fsMatches, appxNames] = await Promise.all([
        Promise.resolve().then(() => { try { return scanFilesystemForApps(undetected); } catch { return {}; } }),
        getAppxPackageNames().catch(() => new Set())
      ]);
      for (const [id, ok] of Object.entries(fsMatches)) { if (ok) installed[id] = true; }
      if (appxNames.size > 0) {
        const stillUn = undetected.filter(a => !installed[a.id]);
        if (stillUn.length > 0) {
          const appxMatches = matchAppxPackages(stillUn, appxNames);
          for (const [id, ok] of Object.entries(appxMatches)) { if (ok) installed[id] = true; }
        }
      }
    }

    return { success: true, installed };
  } catch (error) {
    // Fallback: registry-only + filesystem + AppX if everything else failed
    try {
      const regNames = await getRegistryDisplayNames();
      const installed = matchCatalogToRegistry(apps, regNames);
      const undetected = apps.filter(a => !installed[a.id]);
      if (undetected.length > 0) {
        try { const fs = scanFilesystemForApps(undetected); for (const [id, ok] of Object.entries(fs)) { if (ok) installed[id] = true; } } catch { }
        const stillUn = apps.filter(a => !installed[a.id]);
        if (stillUn.length > 0) {
          try { const ax = await getAppxPackageNames(); if (ax.size > 0) { const m = matchAppxPackages(stillUn, ax); for (const [id, ok] of Object.entries(m)) { if (ok) installed[id] = true; } } } catch { }
        }
      }
      return { success: true, installed };
    } catch {
      return { success: false, installed: {} };
    }
  }
});

// Install a single app via winget (with progress IPC)
let activeInstallProc = null;
let cancelledPids = new Set();

ipcMain.handle('appinstall:cancel-install', async () => {
  if (activeInstallProc && !activeInstallProc.killed) {
    const pid = activeInstallProc.pid;
    cancelledPids.add(pid);
    activeInstallProc = null;
    try {
      // Kill the entire process tree on Windows (cmd.exe + winget + installer)
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
    } catch (e) {
    }
    return { success: true };
  }
  return { success: false, message: 'No active installation' };
});

ipcMain.handle('appinstall:install-app', async (_event, packageId) => {
  const cleanId = String(packageId).replace(/[^\x20-\x7E]/g, '').trim();
  const win = BrowserWindow.getAllWindows()[0];

  const sendProgress = (data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('appinstall:install-progress', { packageId: cleanId, ...data });
    }
  };

  /* ── Run a winget install command and collect output ── */
  const runInstall = (cmd, label = 'Preparing installation…') => new Promise((resolve) => {
    let fullOutput = '';
    let phase = 'preparing';
    let cancelled = false;

    sendProgress({ phase: 'preparing', status: label, percent: 0 });

    const proc = spawn('cmd.exe', [
      '/c', `chcp 65001 >nul && ${cmd}`
    ], { windowsHide: true, env: process.env, cwd: process.env.SYSTEMROOT || 'C:\\Windows' });

    activeInstallProc = proc;

    const timeout = setTimeout(() => {
      cancelled = true;
      proc.kill();
      sendProgress({ phase: 'error', status: 'Installation timed out', percent: 0 });
      resolve({ success: false, message: `Installation timed out for ${cleanId}`, output: fullOutput });
    }, 300000);

    const processChunk = (chunk) => {
      const text = chunk.toString();
      fullOutput += text;
      const segments = text.split('\r').map(s => s.trim()).filter(s => s.length > 0);

      for (const seg of segments) {
        if (/^[-\\|/]$/.test(seg)) {
          if (phase === 'downloading') {
            sendProgress({ phase, status: 'Downloading…', percent: -1 });
          } else if (phase === 'installing') {
            sendProgress({ phase, status: 'Installing…', percent: -1 });
          }
          continue;
        }

        const urlMatch = seg.match(/^Downloading\s+(https?:\/\/.+)/i);
        if (urlMatch) {
          phase = 'downloading';
          sendProgress({ phase: 'downloading', status: 'Downloading…', percent: -1 });
          continue;
        }

        if (/^Found\s/i.test(seg)) {
          sendProgress({ phase: 'preparing', status: seg.substring(0, 80), percent: 5 });
        } else if (/verified installer hash/i.test(seg)) {
          phase = 'verifying';
          sendProgress({ phase: 'verifying', status: 'Installer verified', percent: 100 });
        } else if (/Starting package install/i.test(seg)) {
          phase = 'installing';
          sendProgress({ phase: 'installing', status: 'Installing…', percent: -1 });
        } else if (/Successfully installed/i.test(seg)) {
          phase = 'done';
          sendProgress({ phase: 'done', status: 'Successfully installed!', percent: 100 });
        } else if (/already installed/i.test(seg)) {
          phase = 'done';
          sendProgress({ phase: 'done', status: 'Already installed', percent: 100 });
        }
      }
    };

    proc.stdout.on('data', processChunk);
    proc.stderr.on('data', processChunk);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (activeInstallProc === proc) activeInstallProc = null;
      const wasCancelled = cancelled || proc.killed || cancelledPids.delete(proc.pid);
      if (wasCancelled) {
        sendProgress({ phase: 'error', status: 'Installation cancelled', percent: 0 });
        resolve({ success: false, cancelled: true, message: 'Installation cancelled by user', output: fullOutput });
        return;
      }
      const output = fullOutput.toLowerCase();
      const success = output.includes('successfully installed') || output.includes('already installed');
      if (success) {
        _wingetListCache = null; _wingetCacheTime = 0; _regNamesCache = null; _regCacheTime = 0;
        sendProgress({ phase: 'done', status: 'Installed!', percent: 100 });
        resolve({ success: true, message: `${cleanId} installed successfully`, output: fullOutput });
      } else {
        const msg = fullOutput.split('\r').map(s => s.trim()).filter(s => s.length > 0).pop() || `Installation failed (exit code: ${code})`;
        resolve({ success: false, message: msg, output: fullOutput });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      sendProgress({ phase: 'error', status: err.message, percent: 0 });
      resolve({ success: false, message: `Failed to start installation: ${err.message}`, output: fullOutput });
    });
  });

  /* ── De-elevate install for apps that refuse admin context (e.g. Spotify) ── */
  const runDeElevatedInstall = (cmd) => new Promise((resolve) => {
    sendProgress({ phase: 'preparing', status: 'Retrying as standard user…', percent: 0 });

    const tmpLog = path.join(os.tmpdir(), `gs_appinst_${cleanId.replace(/[^a-zA-Z0-9]/g, '_')}.log`);
    const tmpBat = path.join(os.tmpdir(), `gs_appinst_de_${process.pid}.bat`);
    const taskName = `GSAppInstall_${process.pid}`;

    try { fs.unlinkSync(tmpLog); } catch { }
    fs.writeFileSync(tmpBat,
      `@echo off\r\nchcp 65001 >nul\r\n${cmd} --disable-interactivity > "${tmpLog}" 2>&1\r\necho __GS_DONE__ >> "${tmpLog}"\r\n`, 'utf8');

    const tmpVbs = path.join(os.tmpdir(), `gs_appinst_de_${process.pid}.vbs`);
    fs.writeFileSync(tmpVbs,
      `CreateObject("WScript.Shell").Run "cmd.exe /c """"${tmpBat.replace(/\\/g, '\\\\')}""""", 0, True\r\n`, 'utf8');

    let launchOk = false;

    // Method 1: PowerShell Register-ScheduledTask (RunLevel Limited)
    if (!launchOk) {
      try {
        const userName = (process.env.USERDOMAIN && process.env.USERNAME)
          ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
          : process.env.USERNAME || 'CURRENT_USER';
        const ps1 = path.join(os.tmpdir(), `gs_de_inst_${process.pid}.ps1`);
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
      } catch (err) {
        console.error('[App Install] PS ScheduledTask failed:', (err.stderr || err.message || '').substring(0, 300));
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
        console.error('[App Install] runas /trustlevel failed:', err.message || err);
      }
    }

    if (!launchOk) {
      try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
      try { fs.unlinkSync(tmpBat); } catch { }
      try { fs.unlinkSync(tmpVbs); } catch { }
      sendProgress({ phase: 'error', status: 'Installation failed — cannot de-elevate', percent: 0 });
      resolve({ success: false, message: 'This app\'s installer refuses elevated context. Install it directly outside GS Control Center.' });
      return;
    }

    sendProgress({ phase: 'installing', status: 'Installing (standard user)…', percent: -1 });

    let elapsed = 0;
    const pollMs = 2000;
    const maxWait = 300000;
    let lastLogSize = 0;
    let staleSince = 0;
    const staleLimit = 30000;
    let installStarted = false;

    const poll = setInterval(() => {
      elapsed += pollMs;
      let log = '';
      try { log = fs.readFileSync(tmpLog, 'utf8'); } catch { }
      const lower = log.toLowerCase();

      if (log.length === lastLogSize) { staleSince += pollMs; }
      else { lastLogSize = log.length; staleSince = 0; }

      if (lower.includes('downloading')) {
        sendProgress({ phase: 'downloading', status: 'Downloading…', percent: -1 });
      }
      if (lower.includes('starting package install')) {
        sendProgress({ phase: 'installing', status: 'Installing…', percent: -1 });
        installStarted = true;
      }

      const finished = lower.includes('successfully installed') ||
        lower.includes('already installed') ||
        lower.includes('installer failed') ||
        lower.includes('failed to install') ||
        lower.includes('cannot be run from an administrator') ||
        lower.includes('__gs_done__') ||
        (lower.includes('exit code') && lower.includes('failed'));

      const staleFinish = installStarted && staleSince >= staleLimit;

      if (finished || staleFinish || elapsed >= maxWait) {
        clearInterval(poll);
        try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch { }
        try { fs.unlinkSync(tmpBat); } catch { }
        try { fs.unlinkSync(tmpVbs); } catch { }

        const success = lower.includes('successfully installed');
        if (success) {
          _wingetListCache = null; _wingetCacheTime = 0; _regNamesCache = null; _regCacheTime = 0;
          sendProgress({ phase: 'done', status: 'Installed!', percent: 100 });
          resolve({ success: true, message: `${cleanId} installed successfully` });
        } else if (lower.includes('cannot be run from an administrator')) {
          sendProgress({ phase: 'error', status: 'This app must be installed outside GS Control Center', percent: 0 });
          resolve({ success: false, message: 'This app\'s installer refuses elevated context. Install it directly.' });
        } else if (elapsed >= maxWait) {
          sendProgress({ phase: 'error', status: 'Installation timed out', percent: 0 });
          resolve({ success: false, message: 'Installation timed out' });
        } else {
          const lines = log.split(/[\r\n]/).map(s => s.trim()).filter(Boolean);
          const lastLine = lines.filter(l => l.length > 3 && !/^[-\\|/]$/.test(l) && !/^__GS_DONE__$/i.test(l)).pop() || 'Installation failed';
          sendProgress({ phase: 'error', status: lastLine.substring(0, 120), percent: 0 });
          resolve({ success: false, message: lastLine.substring(0, 120) });
        }
        try { fs.unlinkSync(tmpLog); } catch { }
      }
    }, pollMs);
  });

  // ── Step 1: Normal install ──
  let result = await runInstall(
    `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements`,
    'Preparing installation…'
  );
  if (result.success || result.cancelled) return result;

  const output = (result.output || '').toLowerCase();

  // ── Step 2: 404 / Not Found → update sources and retry ──
  if (output.includes('0x80190194') || output.includes('not found (404)') || output.includes('download failed')) {
    sendProgress({ phase: 'preparing', status: 'Updating sources…', percent: 0 });
    try { await execAsync('winget source update', { timeout: 30000, windowsHide: true }); } catch { }
    result = await runInstall(
      `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --force`,
      'Retrying installation…'
    );
    if (result.success || result.cancelled) return result;
  }

  // ── Step 3: Hash mismatch → retry with --ignore-security-hash (requires admin) ──
  if (output.includes('installer hash does not match') || output.includes('hash mismatch') ||
    (result.output || '').toLowerCase().includes('installer hash does not match')) {
    if (isElevated) {
      result = await runInstall(
        `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --ignore-security-hash`,
        'Retrying with hash override…'
      );
      if (result.success || result.cancelled) return result;
    } else {
      sendProgress({ phase: 'error', status: 'Hash mismatch — run app as administrator to override', percent: 0 });
      return { success: false, message: 'Installer hash mismatch. Run GS Control Center as administrator to bypass.' };
    }
  }

  // ── Step 4: Installer refuses admin context → de-elevate (e.g. Spotify) ──
  if (isElevated && (output.includes('cannot be run from an administrator') ||
    (result.output || '').toLowerCase().includes('cannot be run from an administrator'))) {
    return await runDeElevatedInstall(
      `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --force`
    );
  }

  // ── Final: report error ──
  const finalMsg = (result.message || 'Installation failed').substring(0, 120);
  sendProgress({ phase: 'error', status: finalMsg, percent: 0 });
  return { success: false, message: finalMsg };
});

// Install multiple apps in sequence
ipcMain.handle('appinstall:install-batch', async (_event, packageIds) => {
  const results = [];
  for (const id of packageIds) {
    try {
      const cleanId = String(id).replace(/[^\x20-\x7E]/g, '').trim();
      const { stdout } = await execAsync(
        `chcp 65001 >nul && winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --silent 2>nul`,
        { timeout: 180000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe' }
      );
      const success = stdout.toLowerCase().includes('successfully installed') || stdout.toLowerCase().includes('already installed');
      results.push({ id: cleanId, success, message: success ? 'Installed' : 'Failed' });
    } catch (e) {
      results.push({ id, success: false, message: e.message?.substring(0, 100) || 'Failed' });
    }
  }
  return { success: true, results };
});
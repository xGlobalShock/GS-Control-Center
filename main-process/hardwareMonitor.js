/**
 * Hardware Monitoring Module
 * LHM service, performance counters, stats, polling, and real-time push.
 */

const { ipcMain } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const si = require('systeminformation');
const { execAsync, execFileAsync, runPSScript } = require('./utils');
const windowManager = require('./windowManager');

// ── LHM state variables ──
let _lhmProcess = null;
let _lhmTemp = 0;
let _lhmCpuLoad = -1;
let _lhmGpuTemp = -1;
let _lhmGpuUsage = -1;
let _lhmGpuVramUsed = -1;
let _lhmGpuVramTotal = -1;
let _lhmDiskRead = 0;
let _lhmDiskWrite = 0;
let _lhmProcessCount = 0;
let _lhmNetRx = 0;
let _lhmNetTx = 0;
let _lhmCpuClock = -1;
let _lhmAvailable = false;
let _estimatedTemp = 40;
let _lhmCacheTimer = null;

// ── Perf counter state ──
let _perfCounterProcess = null;
let _perfCpuUtility = -1;
let _perfCpuPerfPct = -1;
let _perfPerCoreCpu = [];

// ── Stats / disk / RAM cache ──
let _lastStats = { cpu: 0, ram: 0, disk: 0, temperature: 0 };
let _tempSource = 'none';
let _cachedDiskPct = 0;
let _diskRefreshTimer = null;
let _cachedRamCachedGB = 0;
let _ramCacheTimer = null;

// ── Realtime push state ──
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
let _rtLastTempSource = '';

// ── Node.js process count fallback ──
let _nodeProcessCount = 0;
(async function _pollProcessCount() {
  const update = async () => {
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "(Get-Process).Count"',
        { timeout: 8000, windowsHide: true }
      );
      const n = parseInt(stdout.trim(), 10);
      if (n > 0) _nodeProcessCount = n;
    } catch { }
  };
  await update();
  setInterval(update, 5000);
})();

// ── nvidia-smi GPU fallback ──
let _nvGpuUsage = -1;
let _nvGpuTemp = -1;
let _nvGpuVramUsed = -1;
let _nvGpuVramTotal = -1;

// ── LHM sensor cache ──
function _getLhmCachePath() {
  try { return path.join(app.getPath('userData'), 'gs_lhm_cache.json'); }
  catch { return path.join(os.tmpdir(), 'gs_lhm_cache.json'); }
}

function _saveLhmCache() {
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
  _lhmCacheTimer = setInterval(_saveLhmCache, 30000);
}

function startLHMService() {
  _startLhmCacheTimer();

  const dllPath = app.isPackaged
    ? path.join(process.resourcesPath, 'lib', 'LibreHardwareMonitorLib.dll')
    : path.join(windowManager.getRootDir(), 'lib', 'LibreHardwareMonitorLib.dll');
  if (!fs.existsSync(dllPath)) {
    const fallbackPath = path.join(app.getAppPath(), 'lib', 'LibreHardwareMonitorLib.dll');
    if (!fs.existsSync(fallbackPath)) {
      return;
    }
    var resolvedDllPath = fallbackPath;
  } else {
    var resolvedDllPath = dllPath;
  }

  const scriptContent = [
    '# LHM sensor service — errors reported on stderr, data on stdout',
    '$ErrorActionPreference = "Stop"',
    '',
    '# — Admin detection (ring0 driver needs admin for MSR temp reads) —',
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
    '  $computer.IsNetworkEnabled = $true',
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
    '# Network I/O perf counters (fallback when LHM Throughput sensors are unavailable)',
    '$netRecvCounters = @(); $netSendCounters = @()',
    'try {',
    '  $netCat = New-Object System.Diagnostics.PerformanceCounterCategory("Network Interface")',
    '  foreach ($inst in $netCat.GetInstanceNames()) {',
    '    if ($inst -match "Loopback|isatap|Teredo|6to4|WFP") { continue }',
    '    try { $rc = New-Object System.Diagnostics.PerformanceCounter("Network Interface", "Bytes Received/sec", $inst); $rc.NextValue() | Out-Null; $netRecvCounters += $rc } catch {}',
    '    try { $sc = New-Object System.Diagnostics.PerformanceCounter("Network Interface", "Bytes Sent/sec", $inst); $sc.NextValue() | Out-Null; $netSendCounters += $sc } catch {}',
    '  }',
    '} catch {}',
    '$wddmGpuFailed = $false',
    '',
    '$iteration = 0',
    '',
    'while ($true) {',
    '  try {',
    '    if ($visitor) { $computer.Accept($visitor) }',
    '    else { foreach ($hw in $computer.Hardware) { $hw.Update(); foreach ($sub in $hw.SubHardware) { $sub.Update() } } }',
    '',
    '    $cpuTemp = $null; $cpuMaxClock = $null; $gpuTemp = $null; $gpuLoad = $null; $gpuVramUsed = $null; $gpuVramTotal = $null',
    '    $mbCpuTemp = $null; $netRxTotal = 0; $netTxTotal = 0',
    '    foreach ($hw in $computer.Hardware) {',
    '      $hwType = $hw.HardwareType.ToString()',
    '      if ($hwType -eq "Network") {',
    '        foreach ($s in $hw.Sensors) {',
    '          if ($null -eq $s.Value) { continue }',
    '          if ($s.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Throughput) {',
    '            if ($s.Name -eq "Download Speed") { $netRxTotal += $s.Value }',
    '            elseif ($s.Name -eq "Upload Speed") { $netTxTotal += $s.Value }',
    '          }',
    '        }',
    '        continue',
    '      }',
    '',
    '      $allSensors = @($hw.Sensors)',
    '      foreach ($sub in $hw.SubHardware) { $allSensors += $sub.Sensors }',
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
    '    if ($cpuTemp -eq $null -and $mbCpuTemp -ne $null) { $cpuTemp = $mbCpuTemp }',
    '',
    '    # Diagnostic dump on first iteration',
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
    '      $netDiag = @("HW_TYPES:")',
    '      foreach ($hw in $computer.Hardware) { $netDiag += $hw.HardwareType.ToString() + "=" + $hw.Name }',
    '      $netHw = @($computer.Hardware | Where-Object { $_.HardwareType.ToString() -eq "Network" })',
    '      $netDiag += "NET_HW_COUNT:" + $netHw.Count',
    '      foreach ($nh in $netHw) {',
    '        foreach ($s in $nh.Sensors) { $netDiag += "  S:" + $s.SensorType.ToString() + ":" + $s.Name + "=" + $s.Value }',
    '      }',
    '      $netDiag += "PERFCTR_NET:recv=" + $netRecvCounters.Count + ",send=" + $netSendCounters.Count',
    '      [Console]::Error.WriteLine("LHMNET:" + ($netDiag -join "|"))',
    '    }',
    '',
    '',
    '    # WDDM GPU fallback for AMD/Intel when LHM GPU sensors are unavailable',
    '    if ($gpuLoad -eq $null -and $gpuVramUsed -eq $null -and -not $wddmGpuFailed -and ($iteration -lt 2 -or $iteration % 6 -eq 0)) {',
    '      try {',
    '        $wMem = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -EA 0 | Where-Object { $_.Name -match "phys_0" } | Select-Object -First 1',
    '        if ($wMem -and $wMem.DedicatedUsage -gt 0) {',
    '          $gpuVramUsed = [math]::Round($wMem.DedicatedUsage / 1MB)',
    '          if ($wMem.DedicatedBudget -and $wMem.DedicatedBudget -gt 0) { $gpuVramTotal = [math]::Round($wMem.DedicatedBudget / 1MB) }',
    '        }',
    '        $wEng = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -EA 0 | Where-Object { $_.Name -match "engtype_3D" }',
    '        if ($wEng) { $gpuLoad = [math]::Min(($wEng | Measure-Object -Property UtilizationPercentage -Sum).Sum, 100) }',
    '        if ($wMem -eq $null -and $wEng -eq $null -and $iteration -gt 2) { $wddmGpuFailed = $true }',
    '      } catch { if ($iteration -gt 2) { $wddmGpuFailed = $true } }',
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
    '    if ($netRxTotal -eq 0 -and $netTxTotal -eq 0 -and $netRecvCounters.Count -gt 0) {',
    '      foreach ($rc in $netRecvCounters) { try { $netRxTotal += $rc.NextValue() } catch {} }',
    '      foreach ($sc in $netSendCounters) { try { $netTxTotal += $sc.NextValue() } catch {} }',
    '    }',
    '    $parts += "NETRX:" + [math]::Round($netRxTotal); $parts += "NETTX:" + [math]::Round($netTxTotal)',
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
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      const tokens = trimmed.split('|');
      for (const token of tokens) {
        const [key, valStr] = token.split(':');
        const v = parseFloat(valStr);
        if (isNaN(v)) continue;
        switch (key) {
          case 'CPUT': if (v > 0 && v < 150) { _lhmTemp = Math.round(v * 10) / 10; _lhmAvailable = true; } break;
          case 'CPUL': if (v >= 0 && v <= 100) _lhmCpuLoad = Math.round(v * 10) / 10; break;
          case 'CPUCLK': if (v > 0 && v < 10000) _lhmCpuClock = Math.round(v); break;
          case 'GPUT': if (v > 0 && v < 150) _lhmGpuTemp = Math.round(v); break;
          case 'GPUL': if (v >= 0 && v <= 100) { _lhmGpuUsage = Math.round(v); } break;
          case 'GPUVRU': if (v >= 0) _lhmGpuVramUsed = Math.round(v); break;
          case 'GPUVRT': if (v > 0) _lhmGpuVramTotal = Math.round(v); break;
          case 'DR': if (v >= 0) _lhmDiskRead = Math.round(v); break;
          case 'DW': if (v >= 0) _lhmDiskWrite = Math.round(v); break;
          case 'PROCS': if (v > 0) _lhmProcessCount = Math.round(v); break;
          case 'NETRX': if (v >= 0) _lhmNetRx = Math.round(v); break;
          case 'NETTX': if (v >= 0) _lhmNetTx = Math.round(v); break;
        }
      }
    }
  });

  const _lhmLogPath = path.join(os.tmpdir(), 'gs_lhm_diag.log');
  try { fs.writeFileSync(_lhmLogPath, `LHM service started at ${new Date().toISOString()}\n`, 'utf8'); } catch {}
  _lhmProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg) return;
    try { fs.appendFileSync(_lhmLogPath, `${msg}\n`, 'utf8'); } catch {}
  });

  _lhmProcess.on('exit', (code) => {
    _lhmProcess = null;
  });

  _lhmProcess.on('error', (err) => {
    _lhmProcess = null;
  });
}

function stopLHMService() {
  _saveLhmCache();
  if (_lhmCacheTimer) { clearInterval(_lhmCacheTimer); _lhmCacheTimer = null; }
  if (_lhmProcess) {
    try { _lhmProcess.kill(); } catch { }
    _lhmProcess = null;
  }
  const tmpFile = path.join(os.tmpdir(), `gs_lhm_service_${process.pid}.ps1`);
  try { fs.unlinkSync(tmpFile); } catch { }
}

function _startPerfCounterService() {
  if (_perfCounterProcess) return;

  const scriptContent = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '',
    'try { $cpuP = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Performance", "_Total") } catch { $cpuP = $null }',
    '',
    'if ($cpuP) { $cpuP.NextValue() | Out-Null }',
    'Start-Sleep -Milliseconds 500',
    '',
    'while ($true) {',
    '  $parts = @()',
    '  if ($cpuP) { try { $parts += "CPUP:" + [math]::Round($cpuP.NextValue(), 1) } catch {} }',
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
        const v = parseFloat(token.substring(colonIdx + 1));
        if (isNaN(v)) continue;
        if (key === 'CPUP' && v > 0) _perfCpuPerfPct = Math.round(v * 10) / 10;
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
}

function _stopPerfCounterService() {
  if (_perfCounterProcess) {
    try { _perfCounterProcess.kill(); } catch { }
    _perfCounterProcess = null;
  }
  const tmpFile = path.join(os.tmpdir(), `gs_perfctr_${process.pid}.ps1`);
  try { fs.unlinkSync(tmpFile); } catch { }
}

function _startDiskRefresh() {
  const refresh = () => {
    runPSScript(`
      try {
        $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        if ($d -and $d.Size -gt 0) { Write-Output ([math]::Round(($d.Size - $d.FreeSpace) / $d.Size * 100, 1)) }
        else { Write-Output '0' }
      } catch { Write-Output '0' }
    `, 10000).then(raw => {
      const v = parseFloat(raw);
      if (!isNaN(v) && v >= 0 && v <= 100) _cachedDiskPct = Math.round(v * 10) / 10;
    }).catch(() => { });
  };
  refresh();
  _diskRefreshTimer = setInterval(refresh, 10000);
}

function _startRamCacheRefresh() {
  const refresh = () => {
    runPSScript(`
      try {
        $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
        $c = [long]$m.StandbyCacheCoreBytes + [long]$m.StandbyCacheNormalPriorityBytes + [long]$m.StandbyCacheReserveBytes + [long]$m.ModifiedPageListBytes
        Write-Output ([math]::Round($c / 1073741824, 1))
      } catch { Write-Output '0' }
    `, 10000).then(raw => {
      const v = parseFloat(raw);
      if (!isNaN(v) && v >= 0) _cachedRamCachedGB = Math.round(v * 10) / 10;
    }).catch(() => { });
  };
  refresh();
  _ramCacheTimer = setInterval(refresh, 5000);
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

function _formatUptimeSeconds(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function _startLatencyPoll() {
  if (_realtimeLatencyTimer) return;

  (async () => {
    try {
      const { stdout } = await execAsync('ping -n 1 -w 2000 8.8.8.8', { shell: true, timeout: 5000 });
      const m = stdout.match(/time[=<]\s*(\d+)\s*ms/i);
      if (m) _rtLastLatency = parseInt(m[1], 10);
      _rtLastPacketLoss = 0;
    } catch { }
  })();

  const doPing = async () => {
    try {
      const { stdout } = await execAsync('ping -n 5 -w 2000 8.8.8.8', { shell: true, timeout: 20000 });
      const avgMatch = stdout.match(/Average\s*=\s*(\d+)\s*ms/i)
        || stdout.match(/Moyenne\s*=\s*(\d+)\s*ms/i)
        || stdout.match(/Media\s*=\s*(\d+)\s*ms/i);
      _rtLastLatency = avgMatch ? parseInt(avgMatch[1], 10) : 0;
      const lossMatch = stdout.match(/Lost\s*=\s*\d+\s*\((\d+)%/i)
        || stdout.match(/Perdus\s*=\s*\d+\s*\((\d+)%/i)
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

function _startWifiPoll() {
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
  fetchAdapter();
  _realtimeWifiTimer = setInterval(fetchAdapter, 5000);
}

function _startNvGpuPoll() {
  let failCount = 0;
  const MAX_FAILS = 3;
  let useWddm = false;
  let wddmFailed = false;

  const pollNvidia = async () => {
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
      failCount = 0;
    } catch {
      failCount++;
      if (failCount >= MAX_FAILS) { useWddm = true; }
    }
  };

  const pollWddm = async () => {
    if (wddmFailed) return;
    try {
      const script = '$m = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -EA 0 | Where-Object { $_.Name -match "phys_0" } | Select-Object -First 1; ' +
        '$e = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -EA 0 | Where-Object { $_.Name -match "engtype_3D" }; ' +
        '$u = 0; if ($e) { $u = [math]::Min(($e | Measure-Object -Property UtilizationPercentage -Sum).Sum, 100) }; ' +
        'Write-Output "$u,$([math]::Round($m.DedicatedUsage / 1MB)),$([math]::Round($m.DedicatedBudget / 1MB))"';
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`,
        { timeout: 8000, windowsHide: true }
      );
      const parts = (stdout || '').trim().split(',').map(s => parseFloat(s.trim()));
      if (parts.length >= 3) {
        if (!isNaN(parts[0])) _nvGpuUsage = Math.round(parts[0]);
        if (!isNaN(parts[1]) && parts[1] > 0) _nvGpuVramUsed = Math.round(parts[1]);
        if (!isNaN(parts[2]) && parts[2] > 0) _nvGpuVramTotal = Math.round(parts[2]);
      } else { wddmFailed = true; }
    } catch { wddmFailed = true; }
  };

  const poll = async () => {
    if (_lhmGpuUsage >= 0 && _lhmGpuTemp >= 0 && _lhmGpuVramTotal > 0) return;
    if (useWddm) return pollWddm();
    return pollNvidia();
  };
  poll();
  _realtimeNvGpuTimer = setInterval(poll, 3000);
}

function _startRealtimePush() {
  if (_realtimeTimer) return;

  if (!_rtPrimed) {
    _rtPrimed = true;
  }

  _startLatencyPoll();
  _startWifiPoll();
  _startNvGpuPoll();

  _realtimeTimer = setInterval(async () => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
      const [memData, cpuData] = await Promise.allSettled([
        si.mem(),
        si.currentLoad(),
      ]);

      const mem = memData.status === 'fulfilled' ? memData.value : null;
      const cpuLoad = cpuData.status === 'fulfilled' ? cpuData.value : null;
      const baseClock = os.cpus()[0]?.speed || 0;
      let resolvedClock = 0;
      if (_lhmCpuClock > 0) {
        resolvedClock = _lhmCpuClock;
      } else if (_perfCpuPerfPct > 0 && baseClock > 0) {
        resolvedClock = Math.round(baseClock * (_perfCpuPerfPct / 100));
      }

      let resolvedCpu = cpuLoad ? Math.round(cpuLoad.currentLoad * 10) / 10 : (_perfCpuUtility >= 0 ? _perfCpuUtility : 0);
      const perCoreCpu = cpuLoad && cpuLoad.cpus ? cpuLoad.cpus.map(c => Math.round(c.load * 10) / 10) : _perfPerCoreCpu;

      let resolvedTemp = 0;
      let tempSource = 'none';
      if (_lhmAvailable && _lhmTemp > 0) {
        resolvedTemp = _lhmTemp;
        tempSource = 'lhm';
      } else {
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

      if (!_rtLastTempSource || _rtLastTempSource !== tempSource) {
        _rtLastTempSource = tempSource;
      }

      const payload = {
        cpu: resolvedCpu,
        perCoreCpu: perCoreCpu.length > 0 ? perCoreCpu : [],
        cpuClock: resolvedClock,
        temperature: resolvedTemp,
        tempSource: tempSource,
        lhmReady: _lhmAvailable || _perfCpuUtility >= 0,
        gpuTemp: _lhmGpuTemp >= 0 ? _lhmGpuTemp : (_nvGpuTemp >= 0 ? _nvGpuTemp : -1),
        gpuUsage: _lhmGpuUsage >= 0 ? _lhmGpuUsage : (_nvGpuUsage >= 0 ? _nvGpuUsage : -1),
        gpuVramUsed: _lhmGpuVramUsed >= 0 ? _lhmGpuVramUsed : (_nvGpuVramUsed >= 0 ? _nvGpuVramUsed : -1),
        gpuVramTotal: _lhmGpuVramTotal > 0 ? _lhmGpuVramTotal : (_nvGpuVramTotal > 0 ? _nvGpuVramTotal : -1),
        ram: mem ? Math.round((mem.active / mem.total) * 1000) / 10 : 0,
        ramUsedGB: mem ? Math.round(mem.active / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramTotalGB: mem ? Math.round(mem.total / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramAvailableGB: mem ? Math.round(mem.available / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramCachedGB: _cachedRamCachedGB,
        disk: _cachedDiskPct,
        diskReadSpeed: _lhmDiskRead,
        diskWriteSpeed: _lhmDiskWrite,
        networkUp: _lhmNetTx,
        networkDown: _lhmNetRx,
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

      mainWindow.webContents.send('realtime-hw-update', payload);
    } catch (err) {
    }
  }, 1000);
}

function _stopRealtimePush() {
  if (_realtimeTimer) { clearInterval(_realtimeTimer); _realtimeTimer = null; }
  if (_realtimeLatencyTimer) { clearInterval(_realtimeLatencyTimer); _realtimeLatencyTimer = null; }
  if (_realtimeWifiTimer) { clearInterval(_realtimeWifiTimer); _realtimeWifiTimer = null; }
  if (_realtimeNvGpuTimer) { clearInterval(_realtimeNvGpuTimer); _realtimeNvGpuTimer = null; }
}

function getDiskRefreshTimer() { return _diskRefreshTimer; }
function clearDiskRefreshTimer() { if (_diskRefreshTimer) { clearInterval(_diskRefreshTimer); _diskRefreshTimer = null; } }

function registerIPC() {
  ipcMain.handle('system:get-stats', () => {
    return _getStatsImpl();
  });

  ipcMain.handle('system:start-realtime', () => {
    _startRealtimePush();
    return { success: true };
  });
}

module.exports = {
  startLHMService,
  stopLHMService,
  _startPerfCounterService,
  _stopPerfCounterService,
  _startDiskRefresh,
  _startRamCacheRefresh,
  _startRealtimePush,
  _stopRealtimePush,
  _startLatencyPoll,
  getDiskRefreshTimer,
  clearDiskRefreshTimer,
  registerIPC,
};

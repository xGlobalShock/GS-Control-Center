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
let _lhmGpuClock = -1;
let _lhmGpuFan = -1;
let _lhmGpuFanRpm = -1;
let _lhmDiskRead = 0;
let _lhmDiskWrite = 0;
let _lhmProcessCount = 0;
let _lhmNetRx = 0;
let _lhmNetTx = 0;
let _lhmCpuClock = -1;
let _lhmAvailable = false;
let _estimatedTemp = 40;
let _lhmCacheTimer = null;

// ── Network stats tracking (si-based fallback for realtime speed) ──
let _lastNetStats = null;
let _lastNetStatsTime = 0;
let _siNetRx = 0;
let _siNetTx = 0;

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

// ── LHM hardware identity (for splash screen) ──
let _lhmHwNames = null;
let _lhmHwNamesResolve = null;
const _lhmHwNamesPromise = new Promise((resolve) => { _lhmHwNamesResolve = resolve; });

function getLhmHardwareNamesPromise() { return _lhmHwNamesPromise; }

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
    '[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo(\'en-US\')',
    '[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::GetCultureInfo(\'en-US\')',
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
    '# Disk, process, and network counters use CIM (language-agnostic; no localized PerformanceCounter names)',
    '$wddmGpuFailed = $false',
    '',
    '$iteration = 0',
    '',
    'while ($true) {',
    '  try {',
    '    if ($visitor) { $computer.Accept($visitor) }',
    '    else { foreach ($hw in $computer.Hardware) { $hw.Update(); foreach ($sub in $hw.SubHardware) { $sub.Update() } } }',
    '',
    '    $cpuTemp = $null; $cpuMaxClock = $null; $gpuTemp = $null; $gpuLoad = $null; $gpuVramUsed = $null; $gpuVramTotal = $null; $gpuClock = $null; $gpuFan = $null; $gpuFanRpm = $null',
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
    '          if ($st -eq "Clock" -and ($sensor.Name -eq "GPU Core" -or $sensor.Name -like "*Core*" -or ($gpuClock -eq $null -and $sv -gt 100 -and $sv -lt 5000))) { if ($gpuClock -eq $null) { $gpuClock = $sv } }',
    '          if ($st -eq "Control" -and ($sensor.Name -like "GPU Fan*" -or $sensor.Name -eq "GPU Fan")) { if ($gpuFan -eq $null -and $sv -ge 0 -and $sv -le 100) { $gpuFan = $sv } }',
    '          if ($st -eq "Fan" -and ($sensor.Name -like "GPU Fan*" -or $sensor.Name -eq "GPU Fan")) { if ($gpuFanRpm -eq $null -and $sv -ge 0) { $gpuFanRpm = $sv } }',
    '        }',
    '      }',
    '    }',
    '',
    '    if ($cpuTemp -eq $null -and $mbCpuTemp -ne $null) { $cpuTemp = $mbCpuTemp }',
    '',
    '    # Output hardware identifiers on first iteration (for splash screen)',
    '    if ($iteration -eq 0) {',
    '      $hwCpuName = ""; $hwGpuName = ""; $hwRamTotalGB = 0',
    '      foreach ($hw in $computer.Hardware) {',
    '        $ht = $hw.HardwareType.ToString()',
    '        if ($ht -eq "Cpu" -and $hwCpuName -eq "") { $hwCpuName = $hw.Name }',
    '        if ($ht -match "Gpu" -and $hwGpuName -eq "") { $hwGpuName = $hw.Name }',
    '        if ($ht -eq "Memory") {',
    '          foreach ($s in $hw.Sensors) {',
    '            if ($s.SensorType.ToString() -eq "Data" -and $s.Name -eq "Memory Used" -and $null -ne $s.Value) {',
    '              # LHM shows used; we get total from system',
    '            }',
    '          }',
    '        }',
    '      }',
    '      try { $hwRamTotalGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch { $hwRamTotalGB = 0 }',
    '      [Console]::Out.WriteLine("HWNAMES|CPU:" + $hwCpuName + "|GPU:" + $hwGpuName + "|RAMGB:" + $hwRamTotalGB)',
    '      [Console]::Out.Flush()',
    '',
    '      # Diagnostic dump',
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
    '        if ($hwType -match "Gpu") {',
    '          $allSFull = @($hw.Sensors); foreach ($sub in $hw.SubHardware) { $allSFull += $sub.Sensors }',
    '          foreach ($s in $allSFull) {',
    '            $sv2 = if ($null -ne $s.Value) { [math]::Round($s.Value, 2) } else { "NULL" }',
    '            $st2 = $s.SensorType.ToString()',
    '            if ($st2 -in "Clock","Fan","Control","Load","SmallData") { $sensorInfo += "  GPU_$($st2):$($s.Name)=$sv2" }',
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
    '    if ($gpuClock -ne $null) { $parts += "GPUCLK:" + [math]::Round($gpuClock, 0) }',
    '    if ($gpuFan -ne $null) { $parts += "GPUFAN:" + [math]::Round($gpuFan, 1) }',
    '    if ($gpuFanRpm -ne $null) { $parts += "GPUFANRPM:" + [math]::Round($gpuFanRpm, 0) }',
    '    try { $dc = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name=\'_Total\'" -EA 0; if ($dc) { $parts += "DR:" + [math]::Round($dc.DiskReadBytesPersec); $parts += "DW:" + [math]::Round($dc.DiskWriteBytesPersec) } } catch {}',
    '    try { $psc = Get-CimInstance Win32_PerfFormattedData_PerfOS_System -EA 0; if ($psc -and $psc.Processes -gt 0) { $parts += "PROCS:" + [math]::Round($psc.Processes) } } catch {}',
    '    if ($netRxTotal -eq 0 -and $netTxTotal -eq 0) {',
    '      try { $ni = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -EA 0 | Where-Object { $_.Name -notmatch "Loopback|isatap|Teredo|6to4|WFP" }; if ($ni) { $netRxTotal = ($ni | Measure-Object -Property BytesReceivedPersec -Sum).Sum; $netTxTotal = ($ni | Measure-Object -Property BytesSentPersec -Sum).Sum } } catch {}',
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

      // Parse hardware identity line (first iteration only)
      if (trimmed.startsWith('HWNAMES|') && !_lhmHwNames) {
        const names = { cpuName: '', gpuName: '', ramTotalGB: 0 };
        for (const part of trimmed.split('|').slice(1)) {
          const colonIdx = part.indexOf(':');
          if (colonIdx === -1) continue;
          const k = part.substring(0, colonIdx);
          const val = part.substring(colonIdx + 1).trim();
          if (k === 'CPU') names.cpuName = val;
          else if (k === 'GPU') names.gpuName = val;
          else if (k === 'RAMGB') names.ramTotalGB = parseInt(val, 10) || 0;
        }
        _lhmHwNames = names;
        if (_lhmHwNamesResolve) { _lhmHwNamesResolve(names); _lhmHwNamesResolve = null; }
        continue;
      }

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
          case 'GPUCLK': if (v > 0 && v < 5000) _lhmGpuClock = Math.round(v); break;
          case 'GPUFAN': if (v >= 0 && v <= 100) _lhmGpuFan = Math.round(v * 10) / 10; break;
          case 'GPUFANRPM': if (v >= 0 && v < 10000) _lhmGpuFanRpm = Math.round(v); break;
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
    '[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo(\'en-US\')',
    '[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::GetCultureInfo(\'en-US\')',
    '$ErrorActionPreference = "SilentlyContinue"',
    '',
    'while ($true) {',
    '  $parts = @()',
    '  try { $cp = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name=\'_Total\'" -EA 0; if ($cp -and $cp.PercentProcessorPerformance -gt 0) { $parts += "CPUP:" + [math]::Round($cp.PercentProcessorPerformance, 1) } } catch {}',
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

const isWinPing = process.platform === 'win32';
// Low-end friendly behavior: single ping with low timeout, adaptive polling interval
const pingArgs1 = isWinPing ? ['-n', '1', '-w', '2000'] : ['-c', '1', '-W', '2'];
const pingArgsFast = pingArgs1; // keep single packet for smaller overhead
const LATENCY_POLL_INTERVAL_ACTIVE_MS = 1000; // 1s for active view
const LATENCY_POLL_INTERVAL_IDLE_MS = 10000; // 10s for inactive/minimized

// Rolling window for packet-loss calculation (20 samples ≈ 20 seconds of history)
const PING_WINDOW_SIZE = 20;
const MIN_SAMPLES_FOR_LOSS = 5; // show packet loss only once we have enough data
let _pingWindow = []; // 1 = received, 0 = dropped

let _rtWindowActive = true;
let _rtLatencyPollingIntervalMs = LATENCY_POLL_INTERVAL_ACTIVE_MS;
let _rtPingInFlight = false;

function _parsePingLatency(stdout) {
  const text = String(stdout);
  // Language/OS agnostic: matches "=14ms", "<1 ms", "=14 мс", etc.
  const timeMatch = text.match(/[=<]\s*([\d.]+)\s*(?:ms|мс)/i);
  return timeMatch ? Math.round(parseFloat(timeMatch[1])) : null;
}

async function _pingHost(host, args) {
  try {
    const { stdout } = await execFileAsync('ping', [...args, host], { timeout: 20000, windowsHide: true });
    return { success: true, time: _parsePingLatency(stdout) };
  } catch (err) {
    // Ping timed out or host unreachable — packet was dropped
    const time = err.stdout ? _parsePingLatency(err.stdout) : null;
    return { success: false, time, error: err.message || 'ping failed' };
  }
}

function _recordPingResult(success) {
  _pingWindow.push(success ? 1 : 0);
  if (_pingWindow.length > PING_WINDOW_SIZE) _pingWindow.shift();
  if (_pingWindow.length < MIN_SAMPLES_FOR_LOSS) return -1; // not enough data yet
  const dropped = _pingWindow.filter(v => v === 0).length;
  return Math.round((dropped / _pingWindow.length) * 100);
}

function _updateLatencyPollInterval() {
  if (!_realtimeLatencyTimer) return;
  clearInterval(_realtimeLatencyTimer);
  _realtimeLatencyTimer = setInterval(_doPing, _rtLatencyPollingIntervalMs);
}

async function _doPing() {
  if (_rtPingInFlight) return;
  _rtPingInFlight = true;
  try {
    const res = await _pingHost('8.8.8.8', pingArgsFast);
    if (res.success) {
      _rtLastLatency = res.time ?? 0;
    } else {
      // Keep last known latency on timeout instead of resetting to 0
      if (res.time != null) _rtLastLatency = res.time;
    }
    _rtLastPacketLoss = _recordPingResult(res.success);
  } finally {
    _rtPingInFlight = false;
  }
}

function _setRealtimeWindowActive(active) {
  _rtWindowActive = !!active;
  _rtLatencyPollingIntervalMs = _rtWindowActive ? LATENCY_POLL_INTERVAL_ACTIVE_MS : LATENCY_POLL_INTERVAL_IDLE_MS;
  if (_realtimeLatencyTimer) {
    _updateLatencyPollInterval();
  }
}

function _startLatencyPoll() {
  if (_realtimeLatencyTimer) return;

  _rtLatencyPollingIntervalMs = _rtWindowActive ? LATENCY_POLL_INTERVAL_ACTIVE_MS : LATENCY_POLL_INTERVAL_IDLE_MS;

  (async () => {
    const res = await _pingHost('8.8.8.8', pingArgs1);
    if (res.success && typeof res.time === 'number') {
      _rtLastLatency = res.time;
      _rtLastPacketLoss = _recordPingResult(true);
    } else {
      _rtLastPacketLoss = _recordPingResult(false);
    }
  })();

  _doPing();
  _realtimeLatencyTimer = setInterval(_doPing, _rtLatencyPollingIntervalMs);
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

async function _startRealtimePush() {
  if (_realtimeTimer) return;

  if (!_rtPrimed) {
    _rtPrimed = true;
    // Prime si.currentLoad() so the first real reading isn't cumulative-since-boot (80-100%)
    try { await si.currentLoad(); } catch {}
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

      // ── Update network stats from systeminformation (if LHM not available) ──
      let netRx = _lhmNetRx;
      let netTx = _lhmNetTx;
      if ((netRx <= 0 || netTx <= 0) && si.networkStats) {
        try {
          const stats = await si.networkStats();
          if (stats && Array.isArray(stats) && stats.length > 0) {
            const now = Date.now();
            const stat = stats[0]; // Use first interface
            if (_lastNetStats && now !== _lastNetStatsTime) {
              const timeDeltaMs = now - _lastNetStatsTime;
              const timeDeltaSec = timeDeltaMs / 1000;
              if (timeDeltaSec > 0.1) { // Only if meaningful time has passed
                const rxDelta = Math.max(0, (stat.rx_bytes || 0) - (_lastNetStats.rx_bytes || 0));
                const txDelta = Math.max(0, (stat.tx_bytes || 0) - (_lastNetStats.tx_bytes || 0));
                netRx = Math.round(rxDelta / timeDeltaSec);
                netTx = Math.round(txDelta / timeDeltaSec);
              }
            }
            _lastNetStats = stat;
            _lastNetStatsTime = now;
            _siNetRx = netRx;
            _siNetTx = netTx;
          }
        } catch (err) {}
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
        gpuClock: _lhmGpuClock >= 0 ? _lhmGpuClock : -1,
        gpuFan: _lhmGpuFan >= 0 ? _lhmGpuFan : -1,
        gpuFanRpm: _lhmGpuFanRpm >= 0 ? _lhmGpuFanRpm : -1,
        ram: mem ? Math.round((mem.active / mem.total) * 1000) / 10 : 0,
        ramUsedGB: mem ? Math.round(mem.active / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramTotalGB: mem ? Math.round(mem.total / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramAvailableGB: mem ? Math.round(mem.available / (1024 * 1024 * 1024) * 10) / 10 : 0,
        ramCachedGB: _cachedRamCachedGB > 0
          ? _cachedRamCachedGB
          : (mem && mem.buffcache > 0 ? Math.round(mem.buffcache / (1024 * 1024 * 1024) * 10) / 10 : 0),
        disk: _cachedDiskPct,
        diskReadSpeed: _lhmDiskRead,
        diskWriteSpeed: _lhmDiskWrite,
        networkUp: netTx,
        networkDown: netRx,
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

      try {
        mainWindow.webContents.send('realtime-hw-update', payload);
      } catch (_) {}

      // Push stats to overlay — isolated so renderer navigation never blocks it
      try {
        const overlay = require('./overlay');
        if (overlay.isVisible()) overlay.pushStatsToOverlay(payload);
      } catch (_) {}
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

  ipcMain.handle('system:stop-realtime', () => {
    // Don't stop if the overlay is actively showing — it needs the same timer
    try {
      const overlay = require('./overlay');
      if (overlay.isVisible()) return { success: true, skipped: 'overlay-active' };
    } catch (_) {}
    _stopRealtimePush();
    return { success: true };
  });

  ipcMain.handle('system:set-realtime-active', (_event, active) => {
    _setRealtimeWindowActive(!!active);
    return { success: true, active: !!active };
  });
}

module.exports = {
  startLHMService,
  stopLHMService,
  getLhmHardwareNamesPromise,
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

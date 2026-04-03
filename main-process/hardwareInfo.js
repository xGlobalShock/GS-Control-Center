/**
 * Hardware Info Module
 * One-shot hardware info fetch + slow background queries.
 */

const { ipcMain } = require('electron');
const os = require('os');
const si = require('systeminformation');
const { execAsync, execFileAsync, runPSScript } = require('./utils');
const windowManager = require('./windowManager');

let _hwInfoResult = null;
let _hwInfoPromise = null;

function getDefaultHardwareInfo() {
  return {
    cpuName: 'Unknown CPU',
    gpuName: 'Unknown GPU',
    ramInfo: 'Unknown',
    ramBrand: '',
    ramPartNumber: '',
    diskName: 'Unknown Disk',
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
    networkLinkSpeed: '',
    networkAdapters: [],
    ipAddress: '',
    ipv6Address: '',
    macAddress: '',
    gateway: '',
    dns: '',
    motherboardManufacturer: '',
    motherboardProduct: '',
    motherboardSerial: '',
    biosVersion: '',
    biosDate: '',
    windowsVersion: os.type(),
    windowsBuild: os.release(),
    systemUptime: `${Math.floor(os.uptime()/86400)}d ${Math.floor((os.uptime()%86400)/3600)}h ${Math.floor((os.uptime()%3600)/60)}m`,
    powerPlan: '',
    lastWindowsUpdate: '',
    windowsActivation: '',
    secureBoot: '',
    keyboardName: '',
    hasBattery: false,
    batteryPercent: 0,
    batteryStatus: '',
  };
}

function initHardwareInfo() {
  _hwInfoPromise = _fetchHardwareInfoImpl().then(info => {
    _hwInfoResult = info || getDefaultHardwareInfo();
    _fetchSlowHardwareInfo(_hwInfoResult).catch(err => {
      console.error('[HW Info] slow fetch failed:', err.message);
    });
    return _hwInfoResult;
  }).catch(err => {
    console.error('[HW Info] fetch failed:', err.message);
    _hwInfoResult = getDefaultHardwareInfo();
    return _hwInfoResult;
  });
}

function getHwInfoPromise() {
  return _hwInfoPromise;
}

async function _fetchHardwareInfoImpl() {
  const info = {
    cpuName: '', gpuName: '', ramInfo: '', ramBrand: '', ramPartNumber: '',
    diskName: '', cpuCores: 0, cpuThreads: 0, cpuMaxClock: '',
    gpuVramTotal: '', gpuDriverVersion: '', ramTotalGB: 0, ramUsedGB: 0,
    ramSticks: '', diskTotalGB: 0, diskFreeGB: 0, diskType: '', diskHealth: '',
    allDrives: [], networkAdapter: '', ipAddress: '',
    motherboardManufacturer: '', motherboardProduct: '', motherboardSerial: '',
    biosVersion: '', biosDate: '', lastWindowsUpdate: '', windowsActivation: '', secureBoot: '', keyboardName: '',
    windowsVersion: '', windowsBuild: '', systemUptime: '', powerPlan: '',
    hasBattery: false, batteryPercent: 0, batteryStatus: '',
  };

  const [hwAll, nvDriverR, lastUpdateR, licenseR] = await Promise.allSettled([
    runPSScript(`
# Section 0: CPU
$s0 = 'Unknown CPU|||0|||0|||0'
try {
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $s0 = "$($cpu.Name)|||$($cpu.NumberOfCores)|||$($cpu.NumberOfLogicalProcessors)|||$($cpu.MaxClockSpeed)"
} catch {}

# Section 1: GPU
$s1 = 'Unknown GPU|||0|||N/A'
try {
  $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.ConfigManagerErrorCode -eq 0 -and $_.Name -notmatch '(Virtual|Dummy|Parsec|Remote|Generic)' } | Select-Object -First 1
  if (-not $gpu) { $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.ConfigManagerErrorCode -eq 0 } | Select-Object -First 1 }
  if (-not $gpu) { $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch '(Virtual|Dummy|Parsec|Remote|Generic)' } | Select-Object -First 1 }
  if ($gpu) {
    $vramGB = 0
    if ($gpu.AdapterRAM -and $gpu.AdapterRAM -gt 0) {
      $vramGB = [math]::Round($gpu.AdapterRAM / 1GB, 1)
    } else {
      try {
        $regPaths = Get-ChildItem 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue
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
          $regPaths2 = Get-ChildItem 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue
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
    $driverStr = $gpu.DriverVersion
    if ($gpu.Name -match 'AMD|Radeon|ATI') {
      try {
        $amdVer = (Get-ItemProperty 'HKLM:\\SOFTWARE\\AMD\\CN' -EA 0).DriverVersion
        if (-not $amdVer) { $amdVer = (Get-ItemProperty 'HKLM:\\SOFTWARE\\ATI Technologies\\CBT' -EA 0).ReleaseVersion }
        if ($amdVer) { $driverStr = $amdVer }
      } catch {}
    }
    $s1 = "$($gpu.Name)|||$vramGB|||$driverStr"
  }
} catch {}

# Section 2: RAM
$s2 = '0||||||||||'
try {
  $mem = Get-CimInstance Win32_PhysicalMemory
  $totalGB = [math]::Round(($mem | Measure-Object -Property Capacity -Sum).Sum / 1GB)
  $first = $mem | Select-Object -First 1
  # Slot map — normalize DeviceLocator to short A1/A2/B1/B2 labels
  $slots = ($mem | ForEach-Object {
    $loc = ($_.DeviceLocator -replace '\s','').ToUpper()
    if    ($loc -match 'CHANNELA.*DIMM0') { 'A1' }
    elseif ($loc -match 'CHANNELA.*DIMM1') { 'A2' }
    elseif ($loc -match 'CHANNELB.*DIMM0') { 'B1' }
    elseif ($loc -match 'CHANNELB.*DIMM1') { 'B2' }
    elseif ($loc -match 'CHANNELC.*DIMM0') { 'C1' }
    elseif ($loc -match 'CHANNELC.*DIMM1') { 'C2' }
    elseif ($loc -match 'CHANNELD.*DIMM0') { 'D1' }
    elseif ($loc -match 'CHANNELD.*DIMM1') { 'D2' }
    elseif ($loc -match '^([A-D])([12])') { "$($Matches[1])$($Matches[2])" }
    else { ($loc -replace 'DIMM_?','') -replace '[^A-D0-9]','' }
  }) -join ' / '
  # DRAM chip brand via JEDEC manufacturer ID
  $mfrRaw = ($first.Manufacturer -replace '\s','').ToUpper()
  $dramBrand = if     ($mfrRaw -match '80CE|CE00|SAMSUNG')    { 'Samsung' }
               elseif ($mfrRaw -match '80AD|AD00|HYNIX|SKHY') { 'SK Hynix' }
               elseif ($mfrRaw -match '802C|2C00|MICRON|MT')   { 'Micron' }
               elseif ($mfrRaw -match 'KINGSTON|04F4')          { 'Kingston' }
               elseif ($mfrRaw -match 'CRUCIAL')                { 'Crucial' }
               elseif ($mfrRaw -match 'CORSAIR|029E')           { 'Corsair' }
               elseif ($mfrRaw -match 'GSKILL|G\.SKILL|04CD')   { 'G.Skill' }
               elseif ($mfrRaw -match 'TEAMGROUP|04CB')         { 'TeamGroup' }
               elseif ($mfrRaw -match 'PATRIOT|04C8')           { 'Patriot' }
               elseif ($mfrRaw -match 'ADATA|04F1')             { 'ADATA' }
               else { '' }
  $s2 = "$totalGB|||$($first.Speed)|||$($first.ConfiguredClockSpeed)|||$($mem.Count) stick(s)|||$($first.Manufacturer)|||$($first.PartNumber)|||$slots|||$dramBrand"
} catch {}

# Section 3: Disk
$s3 = '|||||||'
try {
  $cDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
  $cSize = if ($cDrive) { [math]::Round($cDrive.Size/1GB) } else { 0 }
  $d = Get-PhysicalDisk | Select-Object -First 1
  if ($d) {
    $pSize = [math]::Round($d.Size/1GB)
    $finalSize = if ($cSize -gt $pSize) { $cSize } else { $pSize }
    $hsVal = try { [int]$d.HealthStatus } catch { -1 }
    $hsStr = switch ($hsVal) { 0 { 'Healthy' } 1 { 'Warning' } 2 { 'Unhealthy' } default { "$($d.HealthStatus)" } }
    $s3 = "$($d.FriendlyName)|||$($d.MediaType)|||$hsStr|||$finalSize"
  } else {
    $d2 = Get-CimInstance Win32_DiskDrive | Select-Object -First 1
    $pSize2 = [math]::Round($d2.Size/1GB)
    $finalSize = if ($cSize -gt $pSize2) { $cSize } else { $pSize2 }
    $s3 = "$($d2.Model)|||Unknown|||Unknown|||$finalSize"
  }
} catch {}

# Section 4: All drives
$s4 = ''
try {
  $drvs = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    "$($_.DeviceID)|$([math]::Round($_.Size/1GB,1))|$([math]::Round($_.FreeSpace/1GB,1))|$($_.VolumeName)"
  }
  $s4 = ($drvs -join '~~')
} catch {}

# Section 5: Network
$s5 = '||||||||||||||'
try {
  $a = Get-NetAdapter | Where-Object { $_.ifOperStatus -eq 1 } | Select-Object -First 1
  $ipv4 = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
  $ipv6 = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
  $mac = $a.MacAddress
  $gw = (Get-NetIPConfiguration -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue).Ipv4DefaultGateway.NextHop
  $dns = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue -AddressFamily IPv4 | Select-Object -First 1).ServerAddresses -join ','
  $allAdapters = ''
  try {
    $adapters = Get-NetAdapter | Where-Object { $_.ifOperStatus -eq 1 }
    $parts = @()
    foreach ($ad in $adapters) {
      $adType = if ($ad.MediaType -match '802\\.11|Wireless|Wi-?Fi') { 'WiFi' } elseif ($ad.MediaType -match '802\\.3|Ethernet') { 'Ethernet' } else { 'Other' }
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

# Section 6: Windows
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

# Sections 7-11: Uptime, Power, Battery, RAM GB, Disk free
$osObj = $null
try { $osObj = Get-CimInstance Win32_OperatingSystem } catch {}

$s7 = ''
if ($osObj) { try { $up = (Get-Date) - $osObj.LastBootUpTime; $s7 = '{0}d {1}h {2}m' -f $up.Days, $up.Hours, $up.Minutes } catch {} }

$s8 = ''
try {
  $pp = Get-CimInstance -Namespace root\\cimv2\\power -ClassName Win32_PowerPlan | Where-Object { $_.IsActive } | Select-Object -First 1
  if ($pp) {
    # InstanceID format: "Microsoft:PowerPlan\\{GUID}" — extract the GUID
    $guid = if ($pp.InstanceID -match '\\{([^}]+)}') { $Matches[1] } else { '' }
    $s8 = "$guid|||$($pp.ElementName)"
  }
} catch {}

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

# Section 12: Motherboard
$s12 = '|||'
try {
  $bb = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($bb) {
    $prod = $bb.Product; if (-not $prod) { $prod = $bb.Name } if (-not $prod) { $prod = $bb.Caption }
    $s12 = "$($bb.Manufacturer)|||$prod|||$($bb.SerialNumber)"
  }
} catch {}

# Section 13: Physical disks
$s13 = ''
try {
  $pds = Get-CimInstance Win32_DiskDrive | ForEach-Object {
    $m = ($_.Model -replace '\\n',' '); $sn = ($_.SerialNumber -replace '\\s',''); $fw = ($_.FirmwareRevision -replace '\\s',''); $size = [math]::Round($_.Size/1GB)
    "$m|||$sn|||$fw|||$size"
  }
  $s13 = ($pds -join '~~')
} catch {}

# Section 14: BIOS
$s14 = '|||'
try {
  $bio = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($bio) {
    $ver = $bio.SMBIOSBIOSVersion; if (-not $ver) { $ver = $bio.Version } if (-not $ver) { $ver = $bio.BIOSVersion -join ',' }
    $date = ''; try { $date = ([Management.ManagementDateTimeConverter]::ToDateTime($bio.ReleaseDate).ToString('yyyy-MM-dd')) } catch {}
    $s14 = "$ver|||$date"
  }
} catch {}

# Section 15: Secure Boot
$s15 = 'Unknown'
try {
  $regVal = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State' -ErrorAction SilentlyContinue).UEFISecureBootEnabled
  if ($regVal -eq 1) { $s15 = 'Enabled' }
  elseif ($regVal -eq 0) { $s15 = 'Disabled' }
  else {
    $sb = Confirm-SecureBootUEFI -ErrorAction SilentlyContinue
    if ($sb -eq $true) { $s15 = 'Enabled' } elseif ($sb -eq $false) { $s15 = 'Disabled' }
  }
} catch { $s15 = 'Unknown' }

# Section 16: Keyboard
$s16 = ''
try {
  $kbVidPids = @(Get-PnpDevice -Class 'Keyboard' -Status 'OK' -ErrorAction SilentlyContinue |
    ForEach-Object { if ($_.InstanceId -match '(VID_[0-9A-Fa-f]+&PID_[0-9A-Fa-f]+)') { $matches[1] } } |
    Sort-Object -Unique)
  if ($kbVidPids.Count -gt 0) {
    $allDevices = Get-PnpDevice -Status 'OK' -ErrorAction SilentlyContinue
    foreach ($vp in $kbVidPids) {
      $named = $allDevices | Where-Object {
        $_.InstanceId -like "*$vp*" -and
        $_.Class -eq 'HIDClass' -and
        $_.FriendlyName -notmatch '^HID |^USB Input|^HID-compliant|^Standard|^PS/2'
      } | Select-Object -First 1
      if ($named) { $s16 = $named.FriendlyName; break }
    }
  }
  if (-not $s16) {
    $kb = Get-CimInstance Win32_Keyboard -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($kb) { $s16 = if ($kb.Description) { $kb.Description } else { $kb.Name } }
  }
} catch {}

# Section 17: Memory usage stats (page file, non-paged pool, standby/modified)
$s17 = ''
try {
  $pf = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue | Select-Object -First 1
  $pfUsed  = if ($pf) { $pf.CurrentUsage } else { 0 }
  $pfTotal = if ($pf) { $pf.AllocatedBaseSize } else { 0 }
  $npRaw  = (Get-Counter '\Memory\Pool Nonpaged Bytes' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue
  $npMB   = [math]::Round($npRaw / 1MB)
  $stRaw  = (Get-Counter '\Memory\Standby Cache Normal Priority Bytes' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue
  $stMB   = [math]::Round($stRaw / 1MB)
  $modRaw = (Get-Counter '\Memory\Modified Page List Bytes' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue
  $modMB  = [math]::Round($modRaw / 1MB)
  $s17 = "$pfUsed|||$pfTotal|||$npMB|||$stMB|||$modMB"
} catch {}

# Section 18: Top 4 RAM-consuming processes (grouped by name)
$s18 = ''
try {
  $top4 = Get-Process -ErrorAction SilentlyContinue |
    Group-Object Name |
    ForEach-Object { [PSCustomObject]@{ Name = $_.Name; TotalWS = ($_.Group | Measure-Object WorkingSet64 -Sum).Sum } } |
    Sort-Object TotalWS -Descending |
    Select-Object -First 4
  $s18 = ($top4 | ForEach-Object { "$($_.Name)|||$([math]::Round($_.TotalWS/1MB))" }) -join '~~'
} catch {}

Write-Output ($s0 + '@@' + $s1 + '@@' + $s2 + '@@' + $s3 + '@@' + $s4 + '@@' + $s5 + '@@' + $s6 + '@@' + $s7 + '@@' + $s8 + '@@' + $s9 + '@@' + $s10 + '@@' + $s11 + '@@' + $s12 + '@@' + $s13 + '@@' + $s14 + '@@' + $s15 + '@@' + $s16 + '@@' + $s17 + '@@' + $s18)
    `, 15000),

    execFileAsync('nvidia-smi', ['--query-gpu=driver_version,memory.total', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true })
      .then(r => (r.stdout || '').trim().split('\n')[0].trim()).catch(() => ''),

    runPSScript(`
try {
  $hf = Get-HotFix -EA SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
  if ($hf) { Write-Output $hf.InstalledOn.ToString('yyyy-MM-dd') } else { Write-Output 'Unknown' }
} catch { Write-Output 'Unknown' }
    `, 10000),

    runPSScript(`
try {
  $lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationId = '55c92734-d682-4d71-983e-d6ec3f16059f'" -EA 0 | Select-Object -First 1
  if ($lic) { Write-Output $lic.LicenseStatus } else { Write-Output '0' }
} catch { Write-Output '0' }
    `, 8000),
  ]);

  const valOf = (r) => r.status === 'fulfilled' ? (r.value || '') : '';
  const allSections = valOf(hwAll).split('@@');
  const nvRaw = valOf(nvDriverR);
  const nvParts = nvRaw.split(',').map(s => s.trim());
  const nvDriverVal = nvParts[0] || '';
  const nvVramMiB = nvParts.length >= 2 ? parseInt(nvParts[1]) : 0;
  const get = (i) => (allSections[i] || '').trim();

  const lastUpdRaw = valOf(lastUpdateR).trim();
  if (lastUpdRaw && lastUpdRaw !== 'Unknown') info.lastWindowsUpdate = lastUpdRaw;

  const licenseStatus = parseInt(valOf(licenseR).trim());
  if (!isNaN(licenseStatus)) {
    // LicenseStatus: 0=Unlicensed, 1=Licensed, 2=OOBGrace, 3=OOTGrace, 4=NonGenuineGrace, 5=Notification, 6=ExtendedGrace
    if (licenseStatus === 1) {
      info.windowsActivation = 'Licensed';
    } else if (licenseStatus >= 0) {
      info.windowsActivation = 'Not Activated';
    }
  }

  // 0: CPU
  try {
    const parts = get(0).split('|||').map(s => s.trim());
    info.cpuName = parts[0] || 'Unknown CPU';
    info.cpuCores = parseInt(parts[1]) || 0;
    info.cpuThreads = parseInt(parts[2]) || 0;
    info.cpuMaxClock = parts[3] ? `${(parseInt(parts[3]) / 1000).toFixed(2)} GHz` : '';
  } catch { info.cpuName = 'Unknown CPU'; }

  // 1: GPU
  try {
    const parts = get(1).split('|||').map(s => s.trim());
    info.gpuName = parts[0] || 'Unknown GPU';
    if (nvVramMiB > 0) {
      const gb = nvVramMiB / 1024;
      info.gpuVramTotal = gb % 1 === 0 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
    } else {
      info.gpuVramTotal = parts[1] && parts[1] !== '0' ? `${parts[1]} GB` : '';
    }
    info.gpuDriverVersion = nvDriverVal || (parts[2] || '');
  } catch { info.gpuName = 'Unknown GPU'; }

  // 2: RAM
  try {
    const parts = get(2).split('|||').map(s => s.trim());
    const totalGB = parseInt(parts[0]) || Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const jedecSpeed = parts[1] || '';
    const configSpeed = parts[2] || '';
    const speed = configSpeed && configSpeed !== '0' ? configSpeed : jedecSpeed;
    info.ramInfo = speed ? `${totalGB} GB @ ${speed} MHz` : `${totalGB} GB`;
    info.ramTotalGB = totalGB;
    info.ramSpeed = speed ? `${speed} MT/s` : '';
    info.ramSticks = parts[3] || '';
    info.ramBrand = resolveRamBrand(parts[4], parts[5]);
    info.ramPartNumber = (parts[5] || '').trim();
    info.ramSlotMap = (parts[6] || '').trim();
    info.ramDramBrand = (parts[7] || '').trim();
  } catch {
    const totalGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    info.ramInfo = `${totalGB} GB`;
    info.ramTotalGB = totalGB;
  }

  // 3: Disk
  try {
    const parts = get(3).split('|||').map(s => s.trim());
    info.diskName = parts[0] || 'Unknown Disk';
    info.diskType = parts[1] || '';
    info.diskHealth = parts[2] || '';
    info.diskTotalGB = parseInt(parts[3]) || 0;
  } catch { info.diskName = 'Unknown Disk'; }

  // 4: All drives
  try {
    const drivesRaw = get(4);
    if (drivesRaw) {
      info.allDrives = drivesRaw.split('~~').filter(l => l.trim()).map(line => {
        const [letter, totalGB, freeGB, label] = line.trim().split('|');
        return { letter: letter || '', totalGB: parseFloat(totalGB) || 0, freeGB: parseFloat(freeGB) || 0, label: label || '' };
      });
    }
  } catch { }

  // 5: Network
  try {
    const parts = get(5).split('|||').map(s => s.trim());
    info.networkAdapter = parts[0] || '';
    info.ipAddress = parts[1] || '';
    info.networkLinkSpeed = parts[2] || '';
    info.macAddress = parts[3] || '';
    info.ipv6Address = parts[4] || '';
    info.gateway = parts[5] || '';
    info.dns = parts[6] || '';
    if (parts[7]) {
      info.networkAdapters = parts[7].split('^^').filter(s => s.trim()).map(entry => {
        const [name, type, linkSpeed] = entry.split('~');
        return { name: name || '', type: type || 'Other', linkSpeed: linkSpeed || '' };
      });
    }
  } catch { }

  // 6: Windows
  try {
    let parts = get(6).split('|||').map(s => s.trim());
    let prod = parts[0] || '';
    let build = parts[1] || '';
    const buildMatch = build.match(/Build (\d+)/);
    const buildNum = buildMatch ? parseInt(buildMatch[1]) : 0;
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

  // 8: Power plan — GUID-based to avoid localized names
  const KNOWN_POWER_PLANS = {
    '381b4222-f694-41f0-9685-ff5bb260df2e': 'Balanced',
    '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'High Performance',
    'a1841308-3541-4fab-bc81-f71556f20b4a': 'Power Saver',
    'e9a42b02-d5df-448d-aa00-03f14749eb61': 'Ultimate Performance',
  };
  try {
    const s8raw = get(8);
    const s8parts = s8raw.split('|||');
    const guid = (s8parts[0] || '').trim().toLowerCase();
    const localName = (s8parts[1] || '').trim();
    if (guid && KNOWN_POWER_PLANS[guid]) {
      info.powerPlan = KNOWN_POWER_PLANS[guid];
    } else if (localName) {
      // Custom plan — no English equivalent exists, use OS name as-is
      info.powerPlan = localName;
    }
  } catch { }

  if (!info.powerPlan) {
    try {
      const pc = await execFileAsync('powercfg', ['/getactivescheme'], { timeout: 4000, windowsHide: true });
      const out = (pc.stdout || '').trim();
      // Extract GUID from line: "Power Scheme GUID: xxxxxxxx-... (Name)"
      const guidMatch = out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (guidMatch) {
        const g = guidMatch[1].toLowerCase();
        if (KNOWN_POWER_PLANS[g]) {
          info.powerPlan = KNOWN_POWER_PLANS[g];
        } else {
          const m = out.match(/\(([^)]+)\)$/);
          if (m && m[1]) info.powerPlan = m[1].trim();
        }
      }
    } catch { }
  }

  // 9: Battery
  try {
    const parts = get(9).split('|||').map(s => s.trim());
    info.hasBattery = parts[0] === 'true';
    if (info.hasBattery) {
      info.batteryPercent = parseInt(parts[1]) || 0;
      info.batteryStatus = parts[2] || '';
    }
  } catch { }

  // 10: RAM GB usage
  try {
    const parts = get(10).split('|||').map(s => s.trim());
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
      info.physicalDisks = pdRaw.split('~~').filter(l => l.trim()).map(line => {
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

  // 15: Secure Boot
  try {
    const sbRaw = get(15).trim();
    if (sbRaw === 'Enabled' || sbRaw === 'Disabled' || sbRaw === 'Unknown') info.secureBoot = sbRaw;
  } catch { }

  // 16: Keyboard
  try {
    const kbRaw = get(16).trim();
    if (kbRaw) info.keyboardName = kbRaw;
  } catch { }

  // 17: Memory usage stats
  try {
    const parts = get(17).split('|||').map(s => s.trim());
    info.ramPageFileUsed  = parseInt(parts[0]) || 0;
    info.ramPageFileTotal = parseInt(parts[1]) || 0;
    info.ramNonPagedPool  = parseInt(parts[2]) || 0;
    info.ramStandby       = parseInt(parts[3]) || 0;
    info.ramModified      = parseInt(parts[4]) || 0;
  } catch { }

  // 18: Top 3 RAM processes
  try {
    const raw = get(18);
    if (raw) {
      info.ramTopProcesses = raw.split('~~').filter(l => l.trim()).map(line => {
        const [name, mb] = line.split('|||');
        return { name: (name || '').trim(), mb: parseInt(mb) || 0 };
      });
    }
  } catch { }

  if (!info.systemUptime) {
    try {
      const uptimeSec = os.uptime();
      const days = Math.floor(uptimeSec / 86400);
      const hours = Math.floor((uptimeSec % 86400) / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      info.systemUptime = `${days}d ${hours}h ${minutes}m`;
    } catch { }
  }

  // Fallback using systeminformation for low-end or restricted environments
  try {
    const [cpu, mem, graphics, disks, osInfo] = await Promise.all([
      si.cpu().catch(() => null),
      si.mem().catch(() => null),
      si.graphics().catch(() => null),
      si.diskLayout().catch(() => null),
      si.osInfo().catch(() => null),
    ]);

    if ((!info.cpuName || info.cpuName === 'Unknown CPU') && cpu) {
      info.cpuName = `${cpu.manufacturer || ''} ${cpu.brand || ''}`.trim() || info.cpuName;
      info.cpuCores = info.cpuCores || cpu.cores || cpu.physicalCores || 0;
      info.cpuThreads = info.cpuThreads || cpu.processors || cpu.cores || 0;
      if (!info.cpuMaxClock && cpu.speedMax) info.cpuMaxClock = `${cpu.speedMax} GHz`;
    }

    if ((!info.gpuName || info.gpuName === 'Unknown GPU') && graphics && graphics.controllers && graphics.controllers.length > 0) {
      const gpu = graphics.controllers[0];
      info.gpuName = gpu.vendor && gpu.model ? `${gpu.vendor} ${gpu.model}` : gpu.model || info.gpuName;
      info.gpuVramTotal = info.gpuVramTotal || (gpu.vram ? `${gpu.vram} MB` : '');
      info.gpuDriverVersion = info.gpuDriverVersion || gpu.driverVersion || '';
    }

    if ((!info.ramInfo || info.ramInfo === 'Unknown') && mem) {
      const totalGB = Math.round((mem.total || 0) / (1024 * 1024 * 1024));
      info.ramInfo = `${totalGB || info.ramTotalGB || 0} GB`;
      info.ramTotalGB = info.ramTotalGB || totalGB;
      info.ramUsedGB = info.ramUsedGB || Math.round((mem.active || 0) / (1024 * 1024 * 1024));
    }

    if ((!info.diskName || info.diskName === 'Unknown Disk') && Array.isArray(disks) && disks.length > 0) {
      info.diskName = disks[0].name || disks[0].model || info.diskName;
      info.diskType = info.diskType || disks[0].type || '';
      info.diskTotalGB = info.diskTotalGB || Math.round((disks[0].size || 0) / (1024 * 1024 * 1024));
    }

    if ((!info.windowsVersion || info.windowsVersion === 'Windows' || info.windowsVersion === 'Unknown') && osInfo) {
      info.windowsVersion = osInfo.distro || osInfo.platform || info.windowsVersion;
      info.windowsBuild = osInfo.release || info.windowsBuild;
    }
  } catch (err) {
    console.error('[HW Info] systeminformation fallback failed:', err && err.message ? err.message : err);
  }

  return info;
}

function resolveRamBrand(mfr, partNum) {
  const part = (partNum || '').trim();
  const partLow = part.toLowerCase();
  const mfrLow = (mfr || '').toLowerCase().trim();

  if (/^f[34]-\d/i.test(part)) {
    const suffix = (part.split('-').pop() || '').replace(/^\d+/, '').toUpperCase();
    const gskillSeries = {
      'GTZRX': 'G.Skill Trident Z Royal', 'GTZRS': 'G.Skill Trident Z Royal Silver',
      'GTZR': 'G.Skill Trident Z RGB', 'GTZ': 'G.Skill Trident Z',
      'GTZN': 'G.Skill Trident Z Neo', 'GTZNR': 'G.Skill Trident Z Neo',
      'GFX': 'G.Skill Trident Z5 RGB', 'GX': 'G.Skill Trident Z5',
      'GVK': 'G.Skill Ripjaws V', 'GRK': 'G.Skill Ripjaws V',
      'GBKD': 'G.Skill Ripjaws 4', 'GNT': 'G.Skill Aegis',
      'GIS': 'G.Skill ARES', 'GQSB': 'G.Skill Sniper X',
    };
    for (const [code, name] of Object.entries(gskillSeries)) {
      if (suffix.endsWith(code)) return name;
    }
    return 'G.Skill';
  }

  if (/^cmk/i.test(part)) return 'Corsair Vengeance RGB Pro';
  if (/^cmt/i.test(part)) return 'Corsair Dominator Platinum';
  if (/^cmd/i.test(part)) return 'Corsair Dominator';
  if (/^cmw/i.test(part)) return 'Corsair Vengeance RGB';
  if (/^cms/i.test(part)) return 'Corsair';
  if (/vengeance/i.test(partLow)) return 'Corsair Vengeance';
  if (/dominator/i.test(partLow)) return 'Corsair Dominator';

  if (/^khx/i.test(part)) return 'Kingston HyperX';
  if (/^hx\d/i.test(part)) return 'Kingston HyperX';
  if (/^kf\d/i.test(part)) return 'Kingston Fury';
  if (/^kcp/i.test(part)) return 'Kingston';
  if (/fury/i.test(partLow)) return 'Kingston Fury';

  if (/^ble/i.test(part)) return 'Crucial Ballistix';
  if (/^bls/i.test(part)) return 'Crucial Ballistix Sport';
  if (/^ct\d/i.test(part)) return 'Crucial';
  if (/^mt\d/i.test(part)) return 'Micron';

  if (/^hma|^hmt|^hmab/i.test(part)) return 'SK Hynix';
  if (/^m3[78]/i.test(part)) return 'Samsung';

  if (/^tf[ab]\d|^tdeed/i.test(part)) return 'TeamGroup T-Force';
  if (/^tf\d/i.test(part)) return 'TeamGroup';

  if (/^psd|^pv[e34]/i.test(part)) return 'Patriot Viper';

  const jedecMap = {
    '04f1': 'G.Skill', '04cd': 'Kingston', '9e': 'Kingston',
    'ce': 'Samsung', '00ce': 'Samsung', '80ce': 'Samsung',
    'ad': 'SK Hynix', '00ad': 'SK Hynix', '80ad': 'SK Hynix',
    '2c': 'Micron', '002c': 'Micron', '802c': 'Micron',
    '859b': 'Corsair', '0cf8': 'Crucial', '0b': 'Nanya', '0783': 'Transcend',
  };
  const mfrKey = mfrLow.replace(/^0x/, '');
  if (jedecMap[mfrKey]) return jedecMap[mfrKey];

  if (mfr && !/^[0-9a-f]{2,8}$/i.test(mfr.trim())) return mfr.trim();

  return '';
}

async function _fetchSlowHardwareInfo(fastInfo) {
  const mainWindow = windowManager.getMainWindow();
  const pushUpdate = (partial) => {
    Object.assign(_hwInfoResult, partial);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hw-info-update', partial);
    }
  };

  const tasks = [];

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

  if (!fastInfo.windowsActivation || fastInfo.windowsActivation === 'Unknown') {
    tasks.push(runPSScript(`
try {
  $lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationId = '55c92734-d682-4d71-983e-d6ec3f16059f'" -EA 0 | Select-Object -First 1
  if ($lic) { Write-Output $lic.LicenseStatus } else { Write-Output '0' }
} catch { Write-Output '0' }
    `, 8000).then(result => {
      const status = parseInt((result || '').trim());
      const activation = status === 1 ? 'Licensed' : (status >= 0 ? 'Not Activated' : 'Unknown');
      pushUpdate({ windowsActivation: activation });
    }).catch(() => { pushUpdate({ windowsActivation: 'Unknown' }); }));
  }

  if (!fastInfo.motherboardProduct && !fastInfo.motherboardManufacturer) {
    tasks.push(execAsync('wmic baseboard get Manufacturer,Product /format:csv', {
      timeout: 8000, windowsHide: true
    }).then(({ stdout }) => {
      const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Node,') && !l.startsWith('Node'));
      if (lines.length > 0) {
        const parts = lines[lines.length - 1].split(',');
        if (parts.length >= 3) {
          pushUpdate({ motherboardManufacturer: parts[1]?.trim() || '', motherboardProduct: parts[2]?.trim() || '' });
        }
      }
    }).catch(() => {}));
  }

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

  if (!fastInfo.windowsVersion || fastInfo.windowsVersion === 'Unknown') {
    tasks.push(execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v ProductName', {
      timeout: 5000, windowsHide: true
    }).then(({ stdout }) => {
      const m = stdout.match(/ProductName\s+REG_SZ\s+(.+)/i);
      if (m && m[1]) pushUpdate({ windowsVersion: m[1].trim() });
    }).catch(() => {}));
  }

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

function registerIPC() {
  ipcMain.handle('system:get-hardware-info', async () => {
    if (_hwInfoResult) return _hwInfoResult;
    if (_hwInfoPromise) {
      const result = await _hwInfoPromise;
      if (result) return result;
      const fallback = await _fetchHardwareInfoImpl();
      _hwInfoResult = fallback || getDefaultHardwareInfo();
      return _hwInfoResult;
    }
    const result = await _fetchHardwareInfoImpl();
    _hwInfoResult = result || getDefaultHardwareInfo();
    return _hwInfoResult;
  });
}

module.exports = {
  initHardwareInfo,
  getHwInfoPromise,
  registerIPC,
};

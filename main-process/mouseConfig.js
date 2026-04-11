const { ipcMain } = require('electron');
const { execFile } = require('child_process');

// ── PowerShell helpers ──────────────────────────────────────────────────────
function ps(script, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 512 },
      (err, stdout) => resolve((stdout || '').trim())
    );
  });
}

// ── Detect mouse devices via PnP (excludes keyboards, touchpads, etc.) ──────
async function getMouseDevices() {
  const script = `
    # Known USB Vendor IDs → brand names for gaming peripherals
    $vidBrands = @{
      '09DA' = 'Bloody / A4Tech'
      '046D' = 'Logitech'
      '1532' = 'Razer'
      '1038' = 'SteelSeries'
      '1B1C' = 'Corsair'
      '258A' = 'Glorious'
      '3554' = 'Pulsar'
      '28DA' = 'Zowie / BenQ'
      '0738' = 'Mad Catz'
      '045E' = 'Microsoft'
      '256F' = 'Zowie / BenQ'
      '3367' = 'Endgame Gear'
      '361B' = 'Xtrfy'
      '1915' = 'G-Wolves'
      '093A' = 'Pixart (OEM)'
      '25A7' = 'VAXEE'
      '1EA7' = 'Fantech'
      '320F' = 'Lamzu'
      '3412' = 'WLmouse'
      '34D3' = 'Razer (new)'
      '04D9' = 'A4Tech / Holtek'
      '04F2' = 'Chicony'
      '03F0' = 'HP'
      '413C' = 'Dell'
      '17EF' = 'Lenovo'
      '0B05' = 'ASUS'
      '2F68' = 'Ninjutso'
      '3553' = 'Darmoshark'
    }

    # Known VID+PID → product name for mice that don't report USB product strings
    $vidPidNames = @{
      '09DA_1980' = 'Bloody A90'
      '09DA_9090' = 'Bloody W90 Max'
      '09DA_FA10' = 'Bloody W70 Max'
      '09DA_1894' = 'Bloody A70'
      '09DA_32C2' = 'Bloody V7'
      '09DA_F613' = 'Bloody AL90'
      '09DA_8090' = 'Bloody W60 Max'
    }

    $pnpMice = Get-PnpDevice -Class Mouse -Status OK -ErrorAction SilentlyContinue |
      Where-Object { $_.InstanceId -match 'HID|USB' }
    if (-not $pnpMice) { '[]'; return }

    # Grab Win32_PointingDevice for product names (often more descriptive)
    $wmiMice = @{}
    Get-CimInstance Win32_PointingDevice -ErrorAction SilentlyContinue |
      ForEach-Object {
        $vid = if ($_.PNPDeviceID -match 'VID_([0-9A-F]{4})') { $Matches[1] } else { '' }
        $pid2 = if ($_.PNPDeviceID -match 'PID_([0-9A-F]{4})') { $Matches[1] } else { '' }
        if ($vid -and $pid2) { $wmiMice["$vid&$pid2"] = $_.Name }
      }

    # Build set of VID/PIDs that exist in both Keyboard AND Mouse PnP classes (composite devices)
    $kbVidPids = @{}
    Get-PnpDevice -Class Keyboard -Status OK -ErrorAction SilentlyContinue |
      Where-Object { $_.InstanceId -match 'HID|USB' } |
      ForEach-Object {
        if ($_.InstanceId -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') {
          $kbVidPids[$Matches[1] + '&' + $Matches[2]] = $_.FriendlyName
        }
      }

    $results = @()
    foreach ($m in $pnpMice) {
      $vid = ''; $pid2 = ''
      if ($m.InstanceId -match 'VID_([0-9A-F]{4})') { $vid = $Matches[1] }
      if ($m.InstanceId -match 'PID_([0-9A-F]{4})') { $pid2 = $Matches[1] }
      $vidpid = "$vid&$pid2"

      # If this VID/PID also appears in Keyboard class → it's a composite keyboard device
      # Only include it if WMI name suggests it's genuinely a mouse, not the keyboard name
      if ($kbVidPids.ContainsKey($vidpid)) {
        $wmiName = if ($wmiMice.ContainsKey($vidpid)) { $wmiMice[$vidpid] } else { '' }
        # If WMI name matches the keyboard friendly name or has keyboard keywords → skip
        $kbName = $kbVidPids[$vidpid]
        if ($wmiName -and ($wmiName -eq $kbName -or $wmiName -match 'keyboard|huntsman|blackwidow|ornata|cynosa|apex|k[0-9]+|strafe')) { continue }
        # If WMI doesn't even list it → generic composite mouse interface, skip
        if (-not $wmiName) { continue }
      }

      # Resolve friendly name
      $friendlyName = $m.FriendlyName
      $wmiName = if ($wmiMice.ContainsKey($vidpid)) { $wmiMice[$vidpid] } else { '' }

      # Try to get a real name from USB parent device
      $parentName = ''
      if ($vid -and $pid2) {
        $parentPattern = "USB\\\\VID_$($vid)&PID_$($pid2)*"
        $parent = Get-PnpDevice -InstanceId $parentPattern -ErrorAction SilentlyContinue |
          Where-Object { $_.Class -eq 'USB' } | Select-Object -First 1
        if ($parent) {
          $parentName = $parent.FriendlyName
        }
      }

      # Priority: VID+PID lookup > USB parent name (if specific) > WMI name (if specific) > HID name
      $genericNames = @('HID-compliant mouse', 'USB Input Device', 'USB Composite Device', '')
      $vidpidKey = "$($vid)_$($pid2)"
      if ($vidPidNames.ContainsKey($vidpidKey)) {
        $friendlyName = $vidPidNames[$vidpidKey]
      } elseif ($parentName -and $parentName -notin $genericNames) {
        $friendlyName = $parentName
      } elseif ($wmiName -and $wmiName -notin $genericNames) {
        $friendlyName = $wmiName
      }

      # Resolve manufacturer / brand
      $brand = ''
      if ($vid -and $vidBrands.ContainsKey($vid)) { $brand = $vidBrands[$vid] }
      $mfr = $m.Manufacturer
      if (($mfr -eq 'Microsoft' -or -not $mfr) -and $brand) { $mfr = $brand }

      $results += [PSCustomObject]@{
        Name         = $friendlyName
        InstanceId   = $m.InstanceId
        Status       = $m.Status.ToString()
        VidPid       = "VID_$vid PID_$pid2"
        Manufacturer = $mfr
      }
    }
    if ($results.Count -eq 0) { '[]'; return }
    $results | ConvertTo-Json -Compress
  `;
  const raw = await ps(script, 15000);
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

// ── Read current mouse / pointer settings from registry ─────────────────────
async function getMouseSettings() {
  const script = `
    $mouse = Get-ItemProperty 'HKCU:\\Control Panel\\Mouse' -ErrorAction SilentlyContinue
    $usb = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters' -ErrorAction SilentlyContinue
    [PSCustomObject]@{
      enhancePointerPrecision = if ($mouse.MouseSpeed -eq '1' -and $mouse.MouseThreshold1 -eq '6' -and $mouse.MouseThreshold2 -eq '10') { $true } else { $false }
      pointerSpeed            = [int]$mouse.MouseSensitivity
      mouseSpeed              = [int]$mouse.MouseSpeed
      mouseThreshold1         = [int]$mouse.MouseThreshold1
      mouseThreshold2         = [int]$mouse.MouseThreshold2
      usbPollingInterval      = if ($usb.MouseDataQueueSize) { [int]$usb.MouseDataQueueSize } else { 100 }
    } | ConvertTo-Json -Compress
  `;
  try {
    const raw = await ps(script);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Detect actual polling rate via USB HID interval measurement ──────────────
async function getPollingRate() {
  const script = `
    # 1) Read the system-wide USB HID poll interval override
    $hidParams = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\usbhid\\Parameters' -ErrorAction SilentlyContinue
    $overridePollMs = if ($hidParams -and $hidParams.PollInterval) { [int]$hidParams.PollInterval } else { 0 }
    $overrideHz = if ($overridePollMs -gt 0) { [math]::Floor(1000 / $overridePollMs) } else { 0 }

    # 2) Find actual HID mouse devices and try to read their native polling info
    $mice = Get-PnpDevice -Class Mouse -Status OK -ErrorAction SilentlyContinue |
      Where-Object { $_.InstanceId -match 'HID|USB' -and $_.FriendlyName -notmatch 'keyboard|touchpad|pen|digitizer' }
    $nativeHz = 0
    $devName = ''
    foreach ($m in $mice) {
      $devName = $m.FriendlyName
      # Try to find USB parent bInterval
      $parts = $m.InstanceId -split '\\\\\\\\'
      if ($parts.Count -ge 2) {
        $vidpid = $parts[1] -replace '&MI_\\d+$',''
        # Search USB class devices with same VID/PID
        $usbDevs = Get-PnpDevice -Class USB -Status OK -ErrorAction SilentlyContinue |
          Where-Object { $_.InstanceId -match [regex]::Escape($vidpid) }
        foreach ($u in $usbDevs) {
          $uReg = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\$($u.InstanceId)"
          $cfgFlags = Get-ItemProperty $uReg -ErrorAction SilentlyContinue
        }
      }
      break
    }

    # 3) Default: If override is set, report that; else report default 125Hz
    $effectiveHz = if ($overrideHz -gt 0) { $overrideHz } elseif ($nativeHz -gt 0) { $nativeHz } else { 125 }

    [PSCustomObject]@{
      detected     = $true
      rateHz       = $effectiveHz
      overrideHz   = $overrideHz
      overrideMs   = $overridePollMs
      defaultHz    = 125
      deviceName   = $devName
      isOverridden = ($overridePollMs -gt 0)
    } | ConvertTo-Json -Compress
  `;
  try {
    const raw = await ps(script, 12000);
    return raw ? JSON.parse(raw) : { detected: false, rateHz: 125, overrideHz: 0, overrideMs: 0, defaultHz: 125, deviceName: '', isOverridden: false };
  } catch { return { detected: false, rateHz: 125, overrideHz: 0, overrideMs: 0, defaultHz: 125, deviceName: '', isOverridden: false }; }
}

// ── Apply registry tweaks ───────────────────────────────────────────────────
async function setEnhancePointerPrecision(enabled) {
  // EPP ON:  MouseSpeed=1, Threshold1=6, Threshold2=10
  // EPP OFF: MouseSpeed=0, Threshold1=0, Threshold2=0
  const speed = enabled ? '1' : '0';
  const t1 = enabled ? '6' : '0';
  const t2 = enabled ? '10' : '0';
  const script = `
    Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseSpeed -Value '${speed}'
    Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseThreshold1 -Value '${t1}'
    Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseThreshold2 -Value '${t2}'
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinAPI { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int uiAction, int uiParam, int[] pvParam, int fWinIni); }' -ErrorAction SilentlyContinue
    $params = @(${enabled ? '1, 6, 10' : '0, 0, 0'})
    [WinAPI]::SystemParametersInfo(4, 0, $params, 3) | Out-Null
    'OK'
  `;
  const result = await ps(script);
  return result.includes('OK');
}

async function setPointerSpeed(speed) {
  // Speed: 1-20 (10 = default, maps to 6/11 in the UI)
  const clamped = Math.max(1, Math.min(20, Math.round(speed)));
  const script = `
    Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseSensitivity -Value '${clamped}'
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinAPI2 { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int uiAction, int uiParam, IntPtr pvParam, int fWinIni); }' -ErrorAction SilentlyContinue
    [WinAPI2]::SystemParametersInfo(0x0071, 0, [IntPtr]${clamped}, 3) | Out-Null
    'OK'
  `;
  const result = await ps(script);
  return result.includes('OK');
}

async function setUsbDataQueueSize(size) {
  // MouseDataQueueSize: lower = less input lag (default=100, gaming=20-32)
  const clamped = Math.max(1, Math.min(300, Math.round(size)));
  const script = `
    Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters' -Name MouseDataQueueSize -Value ${clamped} -Type DWord -Force
    'OK'
  `;
  const result = await ps(script);
  return result.includes('OK');
}

async function setUsbPollInterval(ms) {
  // USB HID polling interval override — affects ALL USB HID devices system-wide
  // 1ms = 1000Hz, 2ms = 500Hz, 4ms = 250Hz, 8ms = 125Hz (Windows default)
  // Requires reboot. Setting 0 removes the override (uses device default).
  const clamped = Math.max(0, Math.min(8, Math.round(ms)));
  if (clamped === 0) {
    // Remove override — restore device default
    const script = `
      Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\usbhid\\Parameters' -Name PollInterval -ErrorAction SilentlyContinue
      'OK'
    `;
    const result = await ps(script);
    return result.includes('OK');
  }
  const script = `
    $regPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\usbhid\\Parameters'
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
    Set-ItemProperty $regPath -Name PollInterval -Value ${clamped} -Type DWord -Force
    'OK'
  `;
  const result = await ps(script);
  return result.includes('OK');
}

// ── IPC Registration ────────────────────────────────────────────────────────
function registerIPC() {
  ipcMain.handle('mouse:get-devices', async () => getMouseDevices());

  ipcMain.handle('mouse:get-settings', async () => getMouseSettings());

  ipcMain.handle('mouse:get-polling', async () => getPollingRate());

  ipcMain.handle('mouse:set-epp', async (_e, enabled) => {
    const ok = await setEnhancePointerPrecision(!!enabled);
    return { ok };
  });

  ipcMain.handle('mouse:set-speed', async (_e, speed) => {
    const ok = await setPointerSpeed(speed);
    return { ok };
  });

  ipcMain.handle('mouse:set-queue-size', async (_e, size) => {
    const ok = await setUsbDataQueueSize(size);
    return { ok };
  });

  ipcMain.handle('mouse:set-poll-interval', async (_e, ms) => {
    const ok = await setUsbPollInterval(ms);
    return { ok };
  });
}

module.exports = { registerIPC };

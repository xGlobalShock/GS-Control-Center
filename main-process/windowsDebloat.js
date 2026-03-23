'use strict';

const { ipcMain } = require('electron');
const { execAsync } = require('./utils');
const windowManager = require('./windowManager');

/* ─── Module state ──────────────────────────────────────────────────────── */
let _isElevated = false;

const WINDOWS_APPS_CATALOG = [
  { name: 'Calculator',                    pkg: 'Microsoft.WindowsCalculator' },
  { name: 'Camera',                        pkg: 'Microsoft.WindowsCamera' },
  { name: 'Microsoft Edge',               pkg: 'Microsoft.MicrosoftEdge' },
  { name: '3D Viewer',                     pkg: 'Microsoft.Microsoft3DViewer' },
  { name: 'Copilot',                       pkg: 'Microsoft.Copilot' },
  { name: 'Get Help',                      pkg: 'Microsoft.GetHelp' },
  { name: 'Alarms & Clock',               pkg: 'Microsoft.WindowsAlarms' },
  { name: 'Cortana',                       pkg: 'Microsoft.549981C3F5F10' }, // Cortana package name
  { name: 'Mail and Calendar',             pkg: 'microsoft.windowscommunicationsapps' },
  { name: 'Microsoft News',               pkg: 'Microsoft.BingNews' },
  { name: 'Movies & TV',                  pkg: 'Microsoft.ZuneVideo' },
  { name: 'Outlook for Windows',          pkg: 'Microsoft.OutlookForWindows' },
  { name: 'OneDrive',                      pkg: 'Microsoft.OneDriveSync' },
  { name: 'Terminal',                      pkg: 'Microsoft.WindowsTerminal' },
  { name: 'Clipchamp',                     pkg: 'Clipchamp.Clipchamp' },
  { name: 'Feedback Hub',                 pkg: 'Microsoft.WindowsFeedbackHub' },
  { name: 'Media Player',                 pkg: 'Microsoft.ZuneMusic' },
  { name: 'Microsoft Teams',              pkg: 'MicrosoftTeams' },
  { name: 'Microsoft Family Safety',      pkg: 'MicrosoftCorporationII.MicrosoftFamily' },
  { name: 'Mixed Reality Portal',         pkg: 'Microsoft.MixedReality.Portal' },
  { name: 'OneNote',                       pkg: 'Microsoft.Office.OneNote' },
  { name: 'Microsoft Store',              pkg: 'Microsoft.WindowsStore' },
  { name: 'MSN Weather',                  pkg: 'Microsoft.BingWeather' },
  { name: 'People',                        pkg: 'Microsoft.People' },
  { name: 'Quick Assist',                 pkg: 'MicrosoftCorporationII.QuickAssist' },
  { name: 'Skype',                         pkg: 'Microsoft.SkypeApp' },
  { name: 'Sound Recorder',              pkg: 'Microsoft.WindowsSoundRecorder' },
  { name: 'Xbox',                          pkg: 'Microsoft.GamingApp' },
  { name: 'Xbox Game Bar',               pkg: 'Microsoft.XboxGamingOverlay' },
  { name: 'Xbox Game Bar Plugin',        pkg: 'Microsoft.XboxGameOverlay' },
  { name: 'Xbox Identity Provider',      pkg: 'Microsoft.XboxIdentityProvider' },
  { name: 'Xbox Live In-Game Experience',pkg: 'Microsoft.Xbox.TCUI' },
  { name: 'Bing Search',                  pkg: 'Microsoft.BingSearch' },
  { name: 'Dev Home',                     pkg: 'Microsoft.Windows.DevHome' },
  { name: 'Maps',                          pkg: 'Microsoft.WindowsMaps' },
  { name: 'MS 365 Copilot (Office Hub)', pkg: 'Microsoft.MicrosoftOfficeHub' },
  { name: 'Paint',                         pkg: 'Microsoft.Paint' },
  { name: 'Paint 3D',                     pkg: 'Microsoft.MSPaint' },
  { name: 'Photos',                        pkg: 'Microsoft.Windows.Photos' },
  { name: 'Power Automate',              pkg: 'Microsoft.PowerAutomateDesktop' },
  { name: 'Solitaire Collection',        pkg: 'Microsoft.MicrosoftSolitaireCollection' },
  { name: 'Tips',                          pkg: 'Microsoft.Getstarted' },
  { name: 'To Do: Lists, Tasks & Reminder', pkg: 'Microsoft.Todos' },
  { name: 'Snipping Tool',               pkg: 'Microsoft.ScreenSketch' },
  { name: 'Phone Link',                  pkg: 'Microsoft.YourPhone' },
  { name: 'Sticky Notes',               pkg: 'Microsoft.MicrosoftStickyNotes' },
  { name: 'Notepad',                      pkg: 'Microsoft.WindowsNotepad' },
];

// WinHance-targeted Capabilities (friendly names derived from known packages)
const WINHANCE_CAPABILITIES = [
  { match: /internet.*explorer|intjudg/i, label: 'Internet Explorer' },
  { match: /notepad/i, label: 'Notepad (Legacy)' },
  { match: /openssh\.client/i, label: 'OpenSSH Client' },
  { match: /openssh\.server/i, label: 'OpenSSH Server' },
  { match: /powershell.*ise/i, label: 'PowerShell ISE' },
  { match: /windows\.media\.player/i, label: 'Windows Media Player' },
];

const WINHANCE_OPTIONAL_FEATURES = [
  { key: 'NetFx3', label: '.NET Framework 3.5' },
  { key: 'Microsoft-Windows-Sandbox', label: 'Windows Sandbox' },
  { key: 'Microsoft-Hyper-V-All', label: 'Hyper-V' },
  { key: 'Microsoft-Hyper-V-Management-Tools', label: 'Hyper-V Management Tools' },
  { key: 'Microsoft-Hyper-V-Hypervisor', label: 'Windows Hypervisor Platform' },
  { key: 'Microsoft-Windows-Subsystem-Linux', label: 'Subsystem for Linux' },
  { key: 'Microsoft-Window-Recall' , label: 'Recall' },
  { key: 'Microsoft-Windows-Internet-Explorer-Optional', label: 'Internet Explorer' },
];

function findWinHanceCapability(rawName) {
  if (!rawName) return null;
  const normalized = rawName.toString();
  const item = WINHANCE_CAPABILITIES.find(w => w.match.test(normalized));
  return item ? item.label : null;
}

function findWinHanceFeature(rawName) {
  if (!rawName) return null;
  const entry = WINHANCE_OPTIONAL_FEATURES.find(w => w.key.toLowerCase() === rawName.toString().toLowerCase());
  return entry ? entry.label : null;
}

async function runPS(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  const { stdout } = await execAsync(cmd, {
    timeout: 120000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  return stdout.trim();
}

function sendProgress(msg, current, total) {
  const win = windowManager.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('wdebloat:progress', { msg, current, total });
  }
}

async function handleListApps() {
  try {
    const script = `
$pkgs = Get-AppxPackage -AllUsers | Select-Object Name, PackageFamilyName, Version, NonRemovable | Sort-Object Name
$pkgs | ConvertTo-Json -Compress -Depth 2
`;
    const raw = await runPS(script);
    let packages = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        packages = Array.isArray(parsed) ? parsed : [parsed];
      } catch { packages = []; }
    }

    // Merge with catalog for friendly display names
    const items = packages.map(pkg => {
      const packageFamily = (pkg.PackageFamilyName || '').toLowerCase();
      const lowerName = (pkg.Name || '').toLowerCase();
      const catalogEntry = WINDOWS_APPS_CATALOG.find(c =>
        packageFamily.startsWith(c.pkg.toLowerCase()) ||
        lowerName.startsWith(c.pkg.toLowerCase()) ||
        lowerName === c.pkg.toLowerCase()
      );

      return {
        id: pkg.PackageFamilyName || pkg.Name,
        name: catalogEntry ? catalogEntry.name : pkg.Name,
        packageFamilyName: pkg.PackageFamilyName || '',
        version: pkg.Version || '',
        installed: true,
        nonRemovable: !!pkg.NonRemovable,
        isCatalog: !!catalogEntry,
      };
    });

    // Add catalog entries that are NOT installed (so user can reinstall them)
    for (const entry of WINDOWS_APPS_CATALOG) {
      const alreadyListed = items.some(i => {
        const idLower = (i.id || '').toLowerCase();
        const pfnLower = (i.packageFamilyName || '').toLowerCase();
        return idLower.startsWith(entry.pkg.toLowerCase()) || pfnLower.startsWith(entry.pkg.toLowerCase());
      });
      if (!alreadyListed) {
        items.push({
          id: entry.pkg,
          name: entry.name,
          packageFamilyName: '',
          version: '',
          installed: false,
          nonRemovable: false,
          isCatalog: true,
        });
      }
    }

    // Keep only catalog-managed entries for the Windows Apps tab and avoid showing low-level system packages.
    const catalogItems = items.filter(i => i.isCatalog);

    // Sort: catalog first (by name)
    catalogItems.sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, items: catalogItems };
  } catch (err) {
    return { success: false, error: err.message, items: [] };
  }
}

async function handleRemoveApp(_event, packageId) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  try {
    const script = `
try {
  $pkg = Get-AppxPackage -AllUsers | Where-Object { $_.Name -eq '${packageId.replace(/'/g, "''")}' }
  if ($pkg) {
    $pkg | Remove-AppxPackage -AllUsers -ErrorAction Stop
    [PSCustomObject]@{ success=$true; removed=$true } | ConvertTo-Json -Compress
  } else {
    # Try provisioned
    $prov = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq '${packageId.replace(/'/g, "''")}' }
    if ($prov) {
      Remove-AppxProvisionedPackage -Online -PackageName $prov.PackageName -ErrorAction Stop | Out-Null
      [PSCustomObject]@{ success=$true; removed=$true } | ConvertTo-Json -Compress
    } else {
      [PSCustomObject]@{ success=$false; error='Package not found' } | ConvertTo-Json -Compress
    }
  }
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
}
`;
    const raw = await runPS(script);
    return JSON.parse(raw || '{"success":false,"error":"No output"}');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * wdebloat:remove-apps  (bulk)
 * Removes multiple AppxPackages one at a time, broadcasting progress.
 */
async function handleRemoveApps(_event, packageIds) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  const results = [];
  let current = 0;
  for (const id of packageIds) {
    sendProgress(`Removing ${id}…`, ++current, packageIds.length);
    const r = await handleRemoveApp(null, id);
    results.push({ id, ...r });
  }
  sendProgress('Done', packageIds.length, packageIds.length);
  return { success: true, results };
}

/**
 * wdebloat:install-app
 * Re-register a built-in AppxPackage from the Windows installation (AllUsers provisioned store).
 * Note: works for apps still provisioned on the system; can also winget-install if that fails.
 */
async function handleInstallApp(_event, packageId) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  try {
    const script = `
try {
  # Try re-registering from provisioned package
  $prov = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -like '*${packageId.replace(/'/g, "''")}*' } | Select-Object -First 1
  if ($prov) {
    Add-AppxPackage -RegisterByFamilyName -MainPackage $prov.PackageName -ErrorAction Stop | Out-Null
    [PSCustomObject]@{ success=$true; method='provision' } | ConvertTo-Json -Compress
  } else {
    # Attempt re-register via family name
    $fam = (Get-AppxPackage -AllUsers | Where-Object { $_.Name -eq '${packageId.replace(/'/g, "''")}' }).PackageFamilyName
    if ($fam) {
      Add-AppxPackage -RegisterByFamilyName -MainPackage $fam -ErrorAction Stop | Out-Null
      [PSCustomObject]@{ success=$true; method='family' } | ConvertTo-Json -Compress
    } else {
      [PSCustomObject]@{ success=$false; error='Cannot reinstall: provisioned package or installed copy not found. Try reinstalling from the Microsoft Store.' } | ConvertTo-Json -Compress
    }
  }
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
}
`;
    const raw = await runPS(script);
    return JSON.parse(raw || '{"success":false,"error":"No output"}');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * wdebloat:install-apps  (bulk)
 */
async function handleInstallApps(_event, packageIds) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  const results = [];
  let current = 0;
  for (const id of packageIds) {
    sendProgress(`Installing ${id}…`, ++current, packageIds.length);
    const r = await handleInstallApp(null, id);
    results.push({ id, ...r });
  }
  sendProgress('Done', packageIds.length, packageIds.length);
  return { success: true, results };
}

/* ─── Capabilities ──────────────────────────────────────────────────────── */

async function handleListCapabilities() {
  try {
    const script = `
$caps = Get-WindowsCapability -Online | Select-Object Name, State | Sort-Object Name
$caps | ConvertTo-Json -Compress -Depth 2
`;
    const raw = await runPS(script);
    let caps = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        caps = Array.isArray(parsed) ? parsed : [parsed];
      } catch { caps = []; }
    }
    const items = caps
      .map(c => {
        const display = findWinHanceCapability(c.Name);
        return display ? {
          id: c.Name,
          name: display,
          rawName: c.Name,
          installed: c.State === 'Installed',
          state: c.State || 'Unknown',
        } : null;
      })
      .filter(Boolean);

    return { success: true, items };
  } catch (err) {
    return { success: false, error: err.message, items: [] };
  }
}

async function handleRemoveCapability(_event, capabilityName) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  try {
    const script = `
try {
  Remove-WindowsCapability -Online -Name '${capabilityName.replace(/'/g, "''")}' -ErrorAction Stop | Out-Null
  [PSCustomObject]@{ success=$true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
}
`;
    const raw = await runPS(script);
    return JSON.parse(raw || '{"success":false,"error":"No output"}');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleRemoveCapabilities(_event, names) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  const results = [];
  let i = 0;
  for (const n of names) {
    sendProgress(`Removing capability: ${n}…`, ++i, names.length);
    const r = await handleRemoveCapability(null, n);
    results.push({ id: n, ...r });
  }
  return { success: true, results };
}

async function handleAddCapability(_event, capabilityName) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  try {
    const script = `
try {
  Add-WindowsCapability -Online -Name '${capabilityName.replace(/'/g, "''")}' -ErrorAction Stop | Out-Null
  [PSCustomObject]@{ success=$true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
}
`;
    const raw = await runPS(script);
    return JSON.parse(raw || '{"success":false,"error":"No output"}');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleAddCapabilities(_event, names) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  const results = [];
  let i = 0;
  for (const n of names) {
    sendProgress(`Installing capability: ${n}…`, ++i, names.length);
    const r = await handleAddCapability(null, n);
    results.push({ id: n, ...r });
  }
  return { success: true, results };
}

/* ─── Optional Features ─────────────────────────────────────────────────── */

async function handleListFeatures() {
  try {
    const script = `
$feats = Get-WindowsOptionalFeature -Online | Select-Object FeatureName, State | Sort-Object FeatureName
$feats | ConvertTo-Json -Compress -Depth 2
`;
    const raw = await runPS(script);
    let feats = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        feats = Array.isArray(parsed) ? parsed : [parsed];
      } catch { feats = []; }
    }
    const items = feats
      .map(f => {
        const display = findWinHanceFeature(f.FeatureName);
        return display ? {
          id: f.FeatureName,
          name: display,
          rawName: f.FeatureName,
          installed: f.State === 'Enabled',
          state: f.State || 'Unknown',
        } : null;
      })
      .filter(Boolean);
    return { success: true, items };
  } catch (err) {
    return { success: false, error: err.message, items: [] };
  }
}

async function handleRemoveFeature(_event, featureName) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  try {
    const script = `
try {
  Disable-WindowsOptionalFeature -Online -FeatureName '${featureName.replace(/'/g, "''")}' -NoRestart -ErrorAction Stop | Out-Null
  [PSCustomObject]@{ success=$true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
}
`;
    const raw = await runPS(script);
    return JSON.parse(raw || '{"success":false,"error":"No output"}');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleRemoveFeatures(_event, names) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  const results = [];
  let i = 0;
  for (const n of names) {
    sendProgress(`Disabling feature: ${n}…`, ++i, names.length);
    const r = await handleRemoveFeature(null, n);
    results.push({ id: n, ...r });
  }
  return { success: true, results };
}

async function handleAddFeature(_event, featureName) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  try {
    const script = `
try {
  Enable-WindowsOptionalFeature -Online -FeatureName '${featureName.replace(/'/g, "''")}' -NoRestart -ErrorAction Stop | Out-Null
  [PSCustomObject]@{ success=$true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
}
`;
    const raw = await runPS(script);
    return JSON.parse(raw || '{"success":false,"error":"No output"}');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleAddFeatures(_event, names) {
  if (!_isElevated) return { success: false, error: 'Administrator privileges required.' };
  const results = [];
  let i = 0;
  for (const n of names) {
    sendProgress(`Enabling feature: ${n}…`, ++i, names.length);
    const r = await handleAddFeature(null, n);
    results.push({ id: n, ...r });
  }
  return { success: true, results };
}

/* ─── Module exports ────────────────────────────────────────────────────── */
module.exports = {
  init({ isElevated }) {
    _isElevated = isElevated;
  },

  registerIPC() {
    // Apps (AppxPackages)
    ipcMain.handle('wdebloat:list-apps',    handleListApps);
    ipcMain.handle('wdebloat:remove-app',   handleRemoveApp);
    ipcMain.handle('wdebloat:remove-apps',  handleRemoveApps);
    ipcMain.handle('wdebloat:install-app',  handleInstallApp);
    ipcMain.handle('wdebloat:install-apps', handleInstallApps);

    // Capabilities
    ipcMain.handle('wdebloat:list-capabilities',    handleListCapabilities);
    ipcMain.handle('wdebloat:remove-capability',    handleRemoveCapability);
    ipcMain.handle('wdebloat:remove-capabilities',  handleRemoveCapabilities);
    ipcMain.handle('wdebloat:add-capability',       handleAddCapability);
    ipcMain.handle('wdebloat:add-capabilities',     handleAddCapabilities);

    // Optional Features
    ipcMain.handle('wdebloat:list-features',   handleListFeatures);
    ipcMain.handle('wdebloat:remove-feature',  handleRemoveFeature);
    ipcMain.handle('wdebloat:remove-features', handleRemoveFeatures);
    ipcMain.handle('wdebloat:add-feature',     handleAddFeature);
    ipcMain.handle('wdebloat:add-features',    handleAddFeatures);
  },
};

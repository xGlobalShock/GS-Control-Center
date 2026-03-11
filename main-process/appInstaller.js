/**
 * App Installer Module
 * Install apps via winget with detection pipeline (registry + winget + filesystem + AppX).
 */

const { ipcMain, BrowserWindow, net } = require('electron');
const { app } = require('electron');
const { spawn, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execAsync } = require('./utils');
const windowManager = require('./windowManager');

let _isElevated = false;

// Registry display names cache
let _regNamesCache = null;
let _regCacheTime = 0;
const REG_CACHE_TTL = 60000;

// Winget list cache
let _wingetListCache = null;
let _wingetCacheTime = 0;
const WINGET_CACHE_TTL = 60000;

// AppX cache
let _appxCache = null;
let _appxCacheTime = 0;
const APPX_CACHE_TTL = 120000;

// Catalog mirror for splash pre-warm
const _APP_CATALOG_APPS = [
  { id: 'Brave.Brave', name: 'Brave' },
  { id: 'Google.Chrome', name: 'Chrome' },
  { id: 'Microsoft.Edge', name: 'Edge' },
  { id: 'Mozilla.Firefox', name: 'Firefox' },
  { id: 'Opera.OperaGX', name: 'Opera GX' },
  { id: 'TorProject.TorBrowser', name: 'Tor Browser' },
  { id: 'Discord.Discord', name: 'Discord' },
  { id: 'Microsoft.Teams', name: 'Teams' },
  { id: 'Telegram.TelegramDesktop', name: 'Telegram' },
  { id: 'Zoom.Zoom', name: 'Zoom' },
  { id: 'Valve.Steam', name: 'Steam' },
  { id: 'EpicGames.EpicGamesLauncher', name: 'Epic Games Launcher' },
  { id: 'ElectronicArts.EADesktop', name: 'EA App' },
  { id: 'Ubisoft.Connect', name: 'Ubisoft Connect' },
  { id: 'Blizzard.BattleNet', name: 'Battle.net' },
  { id: 'Nvidia.GeForceNow', name: 'GeForce NOW' },
  { id: 'Guru3D.Afterburner', name: 'MSI Afterburner' },
  { id: 'REALiX.HWiNFO', name: 'HWiNFO' },
  { id: 'TechPowerUp.GPU-Z', name: 'GPU-Z' },
  { id: 'CPUID.CPU-Z', name: 'CPU-Z' },
  { id: 'AMD.RyzenMaster', name: 'AMD Software' },
  { id: 'OBSProject.OBSStudio', name: 'OBS Studio' },
  { id: 'Streamlabs.Streamlabs', name: 'Streamlabs' },
  { id: 'File-New-Project.EarTrumpet', name: 'EarTrumpet' },
  { id: 'SteelSeries.GG', name: 'SteelSeries Sonar' },
  { id: 'VideoLAN.VLC', name: 'VLC' },
  { id: 'Microsoft.VisualStudioCode', name: 'VS Code' },
  { id: 'Git.Git', name: 'Git' },
  { id: 'GitHub.GitHubDesktop', name: 'GitHub Desktop' },
  { id: 'OpenJS.NodeJS.LTS', name: 'NodeJS LTS' },
  { id: 'Python.Python.3.12', name: 'Python 3' },
  { id: 'Microsoft.VisualStudio.2022.Community', name: 'Visual Studio 2022' },
  { id: 'Microsoft.WindowsTerminal', name: 'Windows Terminal' },
  { id: 'Notepad++.Notepad++', name: 'Notepad++' },
  { id: '7zip.7zip', name: '7-Zip' },
  { id: 'RARLab.WinRAR', name: 'WinRAR' },
  { id: 'RevoUninstaller.RevoUninstaller', name: 'Revo Uninstaller' },
  { id: 'Bitwarden.Bitwarden', name: 'Bitwarden' },
  { id: 'Spotify.Spotify', name: 'Spotify' },
];

function init({ isElevated }) {
  _isElevated = isElevated;
}

function invalidateCaches() {
  _wingetListCache = null;
  _wingetCacheTime = 0;
  _regNamesCache = null;
  _regCacheTime = 0;
}

function setWingetListCache(cache) {
  _wingetListCache = cache;
  _wingetCacheTime = Date.now();
}

// Registry scan helper (uses native reg.exe)
async function getRegistryDisplayNames() {
  const now = Date.now();
  if (_regNamesCache && (now - _regCacheTime) < REG_CACHE_TTL) return _regNamesCache;

  const { stdout } = await execAsync(
    'chcp 65001 >nul && ' +
    'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul & ' +
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul & ' +
    'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul',
    { timeout: 8000, windowsHide: true, encoding: 'utf8', shell: 'cmd.exe', maxBuffer: 1024 * 1024 * 5 }
  );

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
  for (const a of apps) {
    const catalogName = (a.name || '').toLowerCase();
    if (!catalogName) { installed[a.id] = false; continue; }
    if (regNames.has(catalogName)) { installed[a.id] = true; continue; }
    let found = false;
    for (const rn of regNames) {
      if (rn.startsWith(catalogName)) { found = true; break; }
      if (catalogName.startsWith(rn) && rn.length >= catalogName.length - 3) { found = true; break; }
    }
    installed[a.id] = found;
  }
  return installed;
}

function getAvailableDrives() {
  const drives = [];
  for (let code = 65; code <= 90; code++) {
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
  'File-New-Project.EarTrumpet': [],
  'SteelSeries.GG': ['SteelSeries\\GG'],
  'VideoLAN.VLC': ['VideoLAN\\VLC'],
  'Microsoft.VisualStudioCode': ['Microsoft VS Code'],
  'Git.Git': ['Git'],
  'GitHub.GitHubDesktop': ['GitHub Desktop', 'GitHubDesktop'],
  'OpenJS.NodeJS.LTS': ['nodejs'],
  'Python.Python.3.12': ['Python312', 'Python311', 'Python310', 'Python3'],
  'Microsoft.VisualStudio.2022.Community': ['Microsoft Visual Studio\\2022\\Community'],
  'Microsoft.WindowsTerminal': [],
  'Notepad++.Notepad++': ['Notepad++'],
  '7zip.7zip': ['7-Zip'],
  'RARLab.WinRAR': ['WinRAR'],
  'RevoUninstaller.RevoUninstaller': ['VS Revo Group\\Revo Uninstaller'],
  'Bitwarden.Bitwarden': ['Bitwarden'],
  'Spotify.Spotify': ['Spotify'],
};

function dirHasExe(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return false;
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return false;
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith('.exe')) return true;
    }
    for (const entry of entries) {
      try {
        const sub = path.join(dirPath, entry);
        if (fs.statSync(sub).isDirectory()) {
          const subEntries = fs.readdirSync(sub);
          for (const se of subEntries) {
            if (se.toLowerCase().endsWith('.exe')) return true;
          }
        }
      } catch {}
    }
    return false;
  } catch { return false; }
}

function scanFilesystemForApps(undetectedApps) {
  const drives = getAvailableDrives();
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const userPrograms = localAppData ? path.join(localAppData, 'Programs') : '';
  const found = {};

  for (const a of undetectedApps) {
    const candidates = new Set();
    if (KNOWN_APP_DIRS[a.id]) {
      for (const d of KNOWN_APP_DIRS[a.id]) candidates.add(d);
    }
    candidates.add(a.name || '');
    const idParts = (a.id || '').split('.');
    if (idParts.length > 1) candidates.add(idParts[idParts.length - 1]);
    candidates.delete('');

    let detected = false;
    for (const dirName of candidates) {
      if (detected) break;

      for (const base of [localAppData, userPrograms, appData]) {
        if (base && dirHasExe(path.join(base, dirName))) { detected = true; break; }
      }
      if (detected) break;

      for (const drive of drives) {
        for (const pfDir of ['Program Files', 'Program Files (x86)']) {
          if (dirHasExe(path.join(`${drive}\\`, pfDir, dirName))) { detected = true; break; }
        }
        if (detected) break;
      }
    }
    found[a.id] = detected;
  }
  return found;
}

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
  for (const a of undetectedApps) {
    const fragment = APPX_ID_MAP[a.id];
    if (!fragment) { found[a.id] = false; continue; }
    let detected = false;
    for (const pkgName of appxNames) {
      if (pkgName.includes(fragment)) { detected = true; break; }
    }
    found[a.id] = detected;
  }
  return found;
}

// Full installed-app detection: registry + winget + filesystem + AppX
async function _checkInstalledImpl(catalogApps) {
  const apps = Array.isArray(catalogApps)
    ? catalogApps.map(a => typeof a === 'string' ? { id: a, name: '' } : a)
    : [];

  try {
    const now = Date.now();

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

    const regMatches = matchCatalogToRegistry(apps, regNames);
    const installed = {};

    for (const a of apps) {
      if (regMatches[a.id]) { installed[a.id] = true; continue; }

      const catalogIdLower = a.id.toLowerCase();
      const catalogNameLower = (a.name || '').toLowerCase();

      if (installedIdSet.has(catalogIdLower)) { installed[a.id] = true; continue; }

      let found = false;
      for (const entry of installedEntries) {
        if (entry.id.startsWith(catalogIdLower) && entry.id.length <= catalogIdLower.length + 10) {
          found = true; break;
        }
      }
      if (found) { installed[a.id] = true; continue; }

      if (catalogNameLower && installedNameSet.has(catalogNameLower)) {
        installed[a.id] = true;
        continue;
      }

      const catalogIdPrefix = catalogIdLower.split('.')[0];
      if (catalogIdPrefix.length >= 3) {
        for (const entry of installedEntries) {
          if (entry.id.includes('\\') || entry.id.includes('arp')) {
            const segments = entry.id.replace(/\\\\/g, '\\').split('\\');
            const lastSeg = segments[segments.length - 1].replace(/_is\d*$/i, '').toLowerCase();
            if (lastSeg === catalogIdPrefix || lastSeg === catalogIdLower.replace(/\./g, '')) {
              found = true;
              break;
            }
          }
        }
      }
      installed[a.id] = found;
    }

    // Supplementary: Filesystem + AppX for still-undetected apps
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
    // Fallback: registry-only + filesystem + AppX
    try {
      const regNames = await getRegistryDisplayNames();
      const installed = matchCatalogToRegistry(apps, regNames);
      const undetected = apps.filter(a => !installed[a.id]);
      if (undetected.length > 0) {
        try { const fsm = scanFilesystemForApps(undetected); for (const [id, ok] of Object.entries(fsm)) { if (ok) installed[id] = true; } } catch { }
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
}

// Icon fetch cache
const _icoFetchCache = new Map();

// Active install state
let activeInstallProc = null;
let cancelledPids = new Set();
let installCancelled = false;

const killWingetProcesses = () => {
  try {
    spawn('taskkill', ['/F', '/IM', 'winget.exe'], { windowsHide: true });
  } catch {}
  try {
    const out = execSync('wmic process where "CommandLine like \'%winget%\'" get ProcessId /format:list',
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const pids = out.match(/ProcessId=(\d+)/g);
    if (pids) pids.forEach(p => {
      const id = p.split('=')[1];
      try { spawn('taskkill', ['/F', '/T', '/PID', id], { windowsHide: true }); } catch {}
    });
  } catch {}
};

function registerIPC() {

  // Pre-warm registry cache on startup (non-blocking)
  getRegistryDisplayNames().catch(() => { });

  ipcMain.handle('appinstall:check-installed', async (_event, catalogApps, forceRefresh) => {
    if (forceRefresh) {
      _wingetListCache = null; _wingetCacheTime = 0;
      _regNamesCache = null; _regCacheTime = 0;
    }

    const apps = Array.isArray(catalogApps)
      ? catalogApps.map(a => typeof a === 'string' ? { id: a, name: '' } : a)
      : [];
    try {
      return await _checkInstalledImpl(apps);
    } catch {
      return { success: false, installed: {} };
    }
  });

  ipcMain.handle('appinstall:cancel-install', async () => {
    installCancelled = true;
    if (activeInstallProc && !activeInstallProc.killed) {
      const pid = activeInstallProc.pid;
      cancelledPids.add(pid);
      activeInstallProc = null;
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
      } catch {}
    }
    killWingetProcesses();
    return { success: true };
  });

  ipcMain.handle('appinstall:install-app', async (_event, packageId) => {
    const TAG = '[AppInstall]';
    const cleanId = String(packageId).replace(/[^\x20-\x7E]/g, '').trim();
    const win = windowManager.getMainWindow() || BrowserWindow.getAllWindows()[0];

    const sendProgress = (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('appinstall:install-progress', { packageId: cleanId, ...data });
      }
    };

    /* Ensure InstallerHashOverride is enabled (3 methods) */
    const ensureHashOverride = () => {
      try { execSync('winget settings --enable InstallerHashOverride', { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch {}
      try {
        const settingsDir = path.join(process.env.LOCALAPPDATA || '', 'Packages',
          'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe', 'LocalState');
        const settingsFile = path.join(settingsDir, 'settings.json');
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
        if (!cfg.experimentalFeatures) cfg.experimentalFeatures = {};
        cfg.experimentalFeatures.enableInstallerHashOverride = true;
        try { fs.mkdirSync(settingsDir, { recursive: true }); } catch {}
        fs.writeFileSync(settingsFile, JSON.stringify(cfg, null, 2), 'utf8');
      } catch {}
      try {
        execSync('reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppInstaller" /v EnableHashOverride /t REG_DWORD /d 1 /f',
          { stdio: 'ignore', windowsHide: true, timeout: 5000 });
      } catch {}
    };

    /* Launch a .bat file de-elevated (Explorer token) */
    const launchDeElevated = (batPath) => {
      const tmpVbs = path.join(os.tmpdir(), `gs_appinst_vbs_${Date.now()}.vbs`);
      fs.writeFileSync(tmpVbs,
        `CreateObject("WScript.Shell").Run "cmd.exe /c """"` + batPath + `""""", 0, True\r\n`, 'utf8');

      // Method 1: Explorer-token via PowerShell (CreateProcessWithTokenW)
      try {
        const cs = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public class DeElev {
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
[DeElev]::Run('${tmpVbs.replace(/\\/g, '\\\\').replace(/'/g, "''")}')`;
        const res = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cs.replace(/"/g, '\\"')}"`,
          { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
        if (res === 'True') { console.log(TAG, 'De-elevated via Explorer token'); return true; }
      } catch (e) { console.error(TAG, 'Explorer-token failed:', (e.message || '').substring(0, 200)); }

      // Method 2: schtasks (RunLevel Limited)
      const taskName = `GSAppInstall_${process.pid}`;
      try {
        execSync(`schtasks /create /tn "${taskName}" /tr "wscript.exe \\"${tmpVbs}\\"" /sc once /st 00:00 /rl LIMITED /f`,
          { stdio: 'ignore', windowsHide: true, timeout: 10000 });
        execSync(`schtasks /run /tn "${taskName}"`,
          { stdio: 'ignore', windowsHide: true, timeout: 10000 });
        console.log(TAG, 'De-elevated via schtasks');
        setTimeout(() => { try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch {} }, 5000);
        return true;
      } catch (e) {
        console.error(TAG, 'schtasks failed:', (e.message || '').substring(0, 200));
        try { execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore', windowsHide: true }); } catch {}
      }

      // Method 3: runas /trustlevel:0x20000
      try {
        const r = spawnSync('runas.exe', ['/trustlevel:0x20000', 'wscript.exe', tmpVbs],
          { windowsHide: true, timeout: 10000 });
        if (!r.error) { console.log(TAG, 'De-elevated via runas /trustlevel'); return true; }
        throw r.error;
      } catch (e) { console.error(TAG, 'runas /trustlevel failed:', (e.message || '').substring(0, 200)); }

      try { fs.unlinkSync(tmpVbs); } catch {}
      return false;
    };

    /* Install via de-elevated process, poll log for progress */
    const installViaDeElevated = (cmd) => new Promise((resolve) => {
      const tmpLog = path.join(os.tmpdir(), `gs_appinst_${cleanId.replace(/[^a-zA-Z0-9]/g, '_')}.log`);
      const tmpBat = path.join(os.tmpdir(), `gs_appinst_de_${Date.now()}.bat`);

      try { fs.unlinkSync(tmpLog); } catch {}
      fs.writeFileSync(tmpBat,
        `@echo off\r\nchcp 65001 >nul\r\n${cmd} --disable-interactivity > "${tmpLog}" 2>&1\r\necho __GS_DONE__ >> "${tmpLog}"\r\n`, 'utf8');

      if (!launchDeElevated(tmpBat)) {
        try { fs.unlinkSync(tmpBat); } catch {}
        sendProgress({ phase: 'error', status: 'Failed to launch installer', percent: 0 });
        resolve({ success: false, message: 'Could not de-elevate the installer process.' });
        return;
      }

      let elapsed = 0;
      const pollMs = 1500;
      const maxWait = 300000;
      let lastLen = 0;
      let staleSince = 0;
      const staleLimit = 30000;
      let downloadSeen = false;
      let installSeen = false;

      const poll = setInterval(() => {
        if (installCancelled) {
          clearInterval(poll);
          killWingetProcesses();
          try { fs.unlinkSync(tmpBat); } catch {}
          try { fs.unlinkSync(tmpLog); } catch {}
          sendProgress({ phase: 'error', status: 'Installation cancelled', percent: 0 });
          resolve({ success: false, cancelled: true, message: 'Installation cancelled by user' });
          return;
        }

        elapsed += pollMs;
        let log = '';
        try { log = fs.readFileSync(tmpLog, 'utf8'); } catch {}
        const lower = log.toLowerCase();

        if (log.length === lastLen) { staleSince += pollMs; }
        else { lastLen = log.length; staleSince = 0; }

        if (!downloadSeen && (lower.includes('downloading') || /t.l.chargement/i.test(lower))) {
          downloadSeen = true;
          sendProgress({ phase: 'downloading', status: 'Downloading...', percent: -1 });
        }
        if (!installSeen && (lower.includes('starting package install') || /but de l.installation/i.test(lower))) {
          installSeen = true;
          sendProgress({ phase: 'installing', status: 'Installing...', percent: -1 });
        }

        const done = lower.includes('successfully installed') ||
          /install.+correctement/i.test(lower) ||
          /installation.+r.ussie/i.test(lower) ||
          lower.includes('already installed') ||
          /d.j.\s*install/i.test(lower) ||
          lower.includes('installer failed') ||
          lower.includes('failed to install') ||
          lower.includes('no applicable installer') ||
          lower.includes('__gs_done__') ||
          (lower.includes('exit code') && lower.includes('failed'));

        const stale = installSeen && staleSince >= staleLimit;

        if (done || stale || elapsed >= maxWait) {
          clearInterval(poll);
          try { fs.unlinkSync(tmpBat); } catch {}

          const success = lower.includes('successfully installed') || lower.includes('already installed') || /install.+correctement/i.test(lower) || /installation.+r.ussie/i.test(lower) || /d.j.\s*install/i.test(lower);
          const wasCancelled = installCancelled || lower.includes('exit code: 2');
          if (success && !wasCancelled) {
            invalidateCaches();
            sendProgress({ phase: 'done', status: 'Installed!', percent: 100 });
            resolve({ success: true, message: `${cleanId} installed successfully` });
          } else if (wasCancelled) {
            sendProgress({ phase: 'error', status: `${cleanId} installation was cancelled`, percent: 0 });
            resolve({ success: false, cancelled: true, message: 'Installation cancelled by user' });
          } else if (elapsed >= maxWait) {
            sendProgress({ phase: 'error', status: 'Installation timed out', percent: 0 });
            resolve({ success: false, message: 'Installation timed out' });
          } else {
            const lines = log.split(/[\r\n]/).map(s => s.trim()).filter(Boolean);
            const lastLine = lines.filter(l => l.length > 3 && !/^[-\\|/]$/.test(l) && !/^__GS_DONE__$/i.test(l)).pop() || 'Installation failed';
            sendProgress({ phase: 'error', status: lastLine.substring(0, 120), percent: 0 });
            resolve({ success: false, message: lastLine.substring(0, 120) });
          }
          try { fs.unlinkSync(tmpLog); } catch {}
        }
      }, pollMs);
    });

    /* Direct install (non-elevated fallback) */
    const installDirect = (cmd) => new Promise((resolve) => {
      let fullOutput = '';
      let phase = 'preparing';
      let cancelled = false;

      const proc = spawn('cmd.exe', ['/c', `chcp 65001 >nul && ${cmd}`],
        { windowsHide: true, env: process.env, cwd: process.env.SYSTEMROOT || 'C:\\Windows' });
      activeInstallProc = proc;

      const timeout = setTimeout(() => {
        cancelled = true; proc.kill();
        sendProgress({ phase: 'error', status: 'Installation timed out', percent: 0 });
        resolve({ success: false, message: 'Installation timed out', output: fullOutput });
      }, 300000);

      const processChunk = (chunk) => {
        const text = chunk.toString();
        fullOutput += text;
        const segments = text.split('\r').map(s => s.trim()).filter(s => s.length > 0);
        for (const seg of segments) {
          if (/^[-\\|/]$/.test(seg)) continue;
          if (/^(Downloading|T.l.chargement)\s/i.test(seg)) {
            phase = 'downloading';
            sendProgress({ phase: 'downloading', status: 'Downloading...', percent: -1 });
          } else if (/verified installer hash|hachage.+v.rifi/i.test(seg)) {
            sendProgress({ phase: 'verifying', status: 'Installer verified', percent: 100 });
          } else if (/Starting package install|but de l.installation/i.test(seg)) {
            phase = 'installing';
            sendProgress({ phase: 'installing', status: 'Installing...', percent: -1 });
          } else if (/Successfully installed|install.+correctement|installation.+r.ussie/i.test(seg)) {
            phase = 'done';
            sendProgress({ phase: 'done', status: 'Installed!', percent: 100 });
          } else if (/already installed|d.j.\s*install/i.test(seg)) {
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
        if (cancelled || proc.killed || cancelledPids.delete(proc.pid) || installCancelled) {
          sendProgress({ phase: 'error', status: `${cleanId} installation was cancelled`, percent: 0 });
          resolve({ success: false, cancelled: true, message: 'Installation cancelled by user', output: fullOutput });
          return;
        }
        const out = fullOutput.toLowerCase();
        const success = out.includes('successfully installed') || out.includes('already installed') || /install.+correctement/i.test(out) || /installation.+r.ussie/i.test(out) || /d.j.\s*install/i.test(out);
        if (success) {
          invalidateCaches();
          sendProgress({ phase: 'done', status: 'Installed!', percent: 100 });
          resolve({ success: true, message: `${cleanId} installed successfully`, output: fullOutput });
        } else {
          const msg = fullOutput.split('\r').map(s => s.trim()).filter(s => s.length > 0).pop() || `Failed (exit ${code})`;
          resolve({ success: false, message: msg, output: fullOutput });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        sendProgress({ phase: 'error', status: err.message, percent: 0 });
        resolve({ success: false, message: err.message, output: fullOutput });
      });
    });

    /* MAIN PIPELINE */
    installCancelled = false;
    const baseCmd = `winget install --id ${cleanId} --accept-source-agreements --accept-package-agreements --force --ignore-security-hash`;

    sendProgress({ phase: 'preparing', status: 'Verifying...', percent: 0 });

    if (_isElevated) ensureHashOverride();

    let result;
    if (_isElevated) {
      console.log(TAG, `Installing ${cleanId} via de-elevated path`);
      result = await installViaDeElevated(baseCmd);
    } else {
      console.log(TAG, `Installing ${cleanId} directly (not elevated)`);
      result = await installDirect(baseCmd);
    }
    if (result.success || result.cancelled) return result;

    // Fallback: source-404 => update sources and retry
    const outLower = ((result.output || '') + ' ' + (result.message || '')).toLowerCase();
    if (outLower.includes('0x80190194') || outLower.includes('not found (404)') || outLower.includes('download failed')) {
      sendProgress({ phase: 'preparing', status: 'Updating sources...', percent: 0 });
      try { await execAsync('winget source update', { timeout: 30000, windowsHide: true }); } catch {}
      if (_isElevated) {
        result = await installViaDeElevated(baseCmd);
      } else {
        result = await installDirect(baseCmd);
      }
      if (result.success || result.cancelled) return result;
    }

    const finalMsg = (result.message || 'Installation failed').substring(0, 120);
    sendProgress({ phase: 'error', status: finalMsg, percent: 0 });
    return { success: false, message: finalMsg };
  });

  // Proxy icon/favicon fetches through main process
  ipcMain.handle('appicon:fetch', async (_event, url) => {
    if (_icoFetchCache.has(url)) return { success: true, dataUrl: _icoFetchCache.get(url) };
    try {
      const resp = await net.fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!resp.ok) return { success: false };
      const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim();
      if (!mime.startsWith('image/')) return { success: false };
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 100) return { success: false };
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      _icoFetchCache.set(url, dataUrl);
      return { success: true, dataUrl };
    } catch {
      return { success: false };
    }
  });

} // end registerIPC

module.exports = {
  init,
  invalidateCaches,
  setWingetListCache,
  getRegistryDisplayNames,
  checkInstalledImpl: _checkInstalledImpl,
  APP_CATALOG_APPS: _APP_CATALOG_APPS,
  registerIPC,
};

/**
 * Game Profiles & V-Config Module
 * Game config read/write, display resolutions, and pro-player preset configs.
 */

const { ipcMain, app } = require('electron');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isPermissionError } = require('./utils');

function getGameConfigPath(gameId) {
  const userProfile = process.env.USERPROFILE || os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const configs = {
    'apex-legends': path.join(userProfile, 'Saved Games', 'Respawn', 'Apex', 'local', 'videoconfig.txt'),
    'valorant': path.join(localAppData, 'VALORANT', 'Saved', 'Config'),
    'cs2': path.join(localAppData, 'cs2', 'cfg', 'video.txt'),
  };
  return configs[gameId] || null;
}

function isFileReadOnly(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const writable = !!(stats.mode & 0o200);
    return !writable;
  } catch { return false; }
}

function unlockFile(filePath) {
  try {
    execSync(`attrib -R "${filePath}"`, { windowsHide: true, stdio: 'pipe', timeout: 5000 });
  } catch (err) {
    try { fs.chmodSync(filePath, 0o666); } catch { /* ignore */ }
  }
}

function lockFile(filePath) {
  try {
    execSync(`attrib +R "${filePath}"`, { windowsHide: true, stdio: 'pipe', timeout: 5000 });
  } catch (err) {
    try { fs.chmodSync(filePath, 0o444); } catch { /* ignore */ }
  }
}

function getVConfigDir(gameId) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'V-Config')
    : path.join(__dirname, '..', 'V-Config');
  return path.join(base, gameId);
}

function registerIPC() {

  ipcMain.handle('system:get-display-resolutions', async () => {
    try {
      const scriptPath = path.join(os.tmpdir(), 'gs_enum_res.ps1');
      const script = `$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ResEnumGS {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public int dmPositionX, dmPositionY;
        public uint dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public uint dmICMMethod, dmICMIntent, dmMediaType, dmDitherType;
        public uint dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    public static extern bool EnumDisplaySettingsA(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);
    public static string[] GetResolutions() {
        var seen = new HashSet<string>();
        var results = new List<string>();
        DEVMODE dm = new DEVMODE();
        dm.dmSize = (ushort)Marshal.SizeOf(dm);
        int i = 0;
        while (EnumDisplaySettingsA(null, i, ref dm)) {
            if (dm.dmPelsWidth >= 800) {
                string key = dm.dmPelsWidth + "x" + dm.dmPelsHeight;
                if (seen.Add(key)) results.Add(key);
            }
            i++;
        }
        return results.ToArray();
    }
}
"@
Add-Type -TypeDefinition $source
[ResEnumGS]::GetResolutions() | ForEach-Object { Write-Output $_ }
`;
      fs.writeFileSync(scriptPath, script, 'utf-8');
      const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
        windowsHide: true, stdio: 'pipe', timeout: 15000, encoding: 'utf-8'
      });
      const resolutions = result.trim().split(/\r?\n/).filter(Boolean).map(r => {
        const [w, h] = r.split('x').map(Number);
        return { w, h };
      }).filter(r => r.w > 0 && r.h > 0);
      return { success: true, resolutions };
    } catch (error) {
      return { success: false, message: error.message, resolutions: [] };
    }
  });

  ipcMain.handle('gameprofile:read-config', async (event, gameId) => {
    try {
      const cfgPath = getGameConfigPath(gameId);
      if (!cfgPath) return { success: false, message: 'Unsupported game.' };
      if (!fs.existsSync(cfgPath)) return { success: false, message: 'Config file not found. Game may not be installed.', path: cfgPath };

      const readOnly = isFileReadOnly(cfgPath);
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const settings = {};
      const keyOrder = [];
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const srcMatch = trimmed.match(/^"([^"]+)"\s+"([^"]*)"$/);
        if (srcMatch) { settings[srcMatch[1]] = srcMatch[2]; keyOrder.push(srcMatch[1]); continue; }
        const eqMatch = trimmed.match(/^([^\s=]+)\s*[=\s]\s*"?([^"]*)"?$/);
        if (eqMatch) { settings[eqMatch[1]] = eqMatch[2]; keyOrder.push(eqMatch[1]); }
      }
      return { success: true, settings, keyOrder, path: cfgPath, raw, isReadOnly: readOnly };
    } catch (error) {
      return { success: false, message: `Error reading config: ${error.message}` };
    }
  });

  ipcMain.handle('gameprofile:write-config', async (event, gameId, updates) => {
    try {
      const cfgPath = getGameConfigPath(gameId);
      if (!cfgPath) return { success: false, message: 'Unsupported game.' };
      if (!fs.existsSync(cfgPath)) return { success: false, message: 'Config file not found.' };

      const wasReadOnly = isFileReadOnly(cfgPath);
      if (wasReadOnly) unlockFile(cfgPath);

      try {
        const backupPath = cfgPath + '.bak';
        fs.copyFileSync(cfgPath, backupPath);

        let raw = fs.readFileSync(cfgPath, 'utf-8');
        for (const [key, value] of Object.entries(updates)) {
          const srcRegex = new RegExp(`^(\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+)"[^"]*"`, 'm');
          if (srcRegex.test(raw)) {
            raw = raw.replace(srcRegex, `$1"${value}"`);
            continue;
          }
          const eqRegex = new RegExp(`^(\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[=\\s]\\s*)"?[^"\\n]*"?`, 'm');
          if (eqRegex.test(raw)) {
            raw = raw.replace(eqRegex, `$1"${value}"`);
          }
        }
        fs.writeFileSync(cfgPath, raw, 'utf-8');

        if (wasReadOnly) lockFile(cfgPath);

        return { success: true, message: 'Settings saved successfully.', backupPath };
      } catch (writeErr) {
        if (wasReadOnly) lockFile(cfgPath);
        throw writeErr;
      }
    } catch (error) {
      if (isPermissionError(error)) {
        return { success: false, message: 'Run the app as administrator to modify game settings.' };
      }
      return { success: false, message: `Error writing config: ${error.message}` };
    }
  });

  ipcMain.handle('gameprofile:restore-backup', async (event, gameId) => {
    try {
      const cfgPath = getGameConfigPath(gameId);
      if (!cfgPath) return { success: false, message: 'Unsupported game.' };
      const backupPath = cfgPath + '.bak';
      if (!fs.existsSync(backupPath)) return { success: false, message: 'No backup found.' };

      const wasReadOnly = isFileReadOnly(cfgPath);
      if (wasReadOnly) unlockFile(cfgPath);

      fs.copyFileSync(backupPath, cfgPath);

      if (wasReadOnly) lockFile(cfgPath);

      return { success: true, message: 'Backup restored successfully.' };
    } catch (error) {
      return { success: false, message: `Error restoring backup: ${error.message}` };
    }
  });

  ipcMain.handle('gameprofile:set-readonly', async (event, gameId, readOnly) => {
    try {
      const cfgPath = getGameConfigPath(gameId);
      if (!cfgPath) return { success: false, message: 'Unsupported game.' };
      if (!fs.existsSync(cfgPath)) return { success: false, message: 'Config file not found.' };

      if (readOnly) {
        lockFile(cfgPath);
      } else {
        unlockFile(cfgPath);
      }
      const nowReadOnly = isFileReadOnly(cfgPath);
      return { success: true, isReadOnly: nowReadOnly };
    } catch (error) {
      return { success: false, message: `Error changing file attributes: ${error.message}` };
    }
  });

  // ── V-Config: Pro Player Configs ──────────────────────────────────
  ipcMain.handle('vconfig:list-players', async (event, gameId) => {
    try {
      const vconfigDir = getVConfigDir(gameId);
      const playersFile = path.join(vconfigDir, 'players.json');
      if (!fs.existsSync(playersFile)) return { success: false, message: 'No player configs found for this game.' };
      const players = JSON.parse(fs.readFileSync(playersFile, 'utf-8'));
      return { success: true, players };
    } catch (error) {
      return { success: false, message: `Error listing players: ${error.message}` };
    }
  });

  ipcMain.handle('vconfig:read-player-config', async (event, gameId, playerName) => {
    try {
      const safeName = path.basename(playerName);
      const cfgPath = path.join(getVConfigDir(gameId), safeName, 'videoconfig.txt');
      if (!fs.existsSync(cfgPath)) return { success: false, message: `Config not found for ${safeName}.` };

      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const settings = {};
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const srcMatch = trimmed.match(/^"([^"]+)"\s+"([^"]*)"$/);
        if (srcMatch) { settings[srcMatch[1]] = srcMatch[2]; continue; }
        const eqMatch = trimmed.match(/^([^\s=]+)\s*[=\s]\s*"?([^"]*)"?$/);
        if (eqMatch) { settings[eqMatch[1]] = eqMatch[2]; }
      }
      return { success: true, settings };
    } catch (error) {
      return { success: false, message: `Error reading player config: ${error.message}` };
    }
  });

} // end registerIPC

module.exports = { registerIPC };

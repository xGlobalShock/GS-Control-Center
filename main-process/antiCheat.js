/**
 * antiCheat.js – IPC module for detecting installed anti-cheat systems
 * Scans running services, processes, and common install paths.
 */

const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

/* ── Known anti-cheat fingerprints ──────────────────────────────── */
const AC_DEFS = [
  {
    id: 'eac',
    name: 'Easy Anti-Cheat',
    services: ['EasyAntiCheat', 'EasyAntiCheat_EOS'],
    processes: ['EasyAntiCheat.exe', 'EasyAntiCheat_EOS.exe', 'start_protected_game.exe'],
    paths: [
      'C:\\Program Files (x86)\\EasyAntiCheat',
      'C:\\Program Files\\EasyAntiCheat',
      'C:\\Program Files (x86)\\EasyAntiCheat_EOS',
      'C:\\Program Files\\EasyAntiCheat_EOS',
    ],
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    services: ['vgc', 'vgk'],
    processes: ['vgc.exe', 'vgtray.exe'],
    paths: [
      'C:\\Program Files\\Riot Vanguard',
    ],
  },
  {
    id: 'battleye',
    name: 'BattlEye',
    services: ['BEService'],
    processes: ['BEService.exe', 'BEService_x64.exe'],
    paths: [
      'C:\\Program Files (x86)\\Common Files\\BattlEye',
      'C:\\Program Files\\Common Files\\BattlEye',
    ],
  },
  {
    id: 'faceit',
    name: 'FACEIT Anti-Cheat',
    services: ['FACEIT'],
    processes: ['FACEITClient.exe', 'faceitservice.exe'],
    paths: [
      path.join(process.env.LOCALAPPDATA || '', 'FACEIT'),
    ],
  },
  {
    id: 'esea',
    name: 'ESEA Anti-Cheat',
    services: ['ESEADriver2'],
    processes: ['ESEA.exe', 'ESEAClient.exe'],
    paths: [],
  },
];

/* ── PowerShell detection script ────────────────────────────────── */
function _buildDetectionScript() {
  // Gather all services (any status) + running services + running processes
  return `
$ErrorActionPreference = 'SilentlyContinue'
$allSvc = (Get-Service | Select-Object -ExpandProperty Name) -join '|'
$runningSvc = (Get-Service | Where-Object { $_.Status -eq 'Running' } | Select-Object -ExpandProperty Name) -join '|'
$procNames = (Get-Process | Select-Object -ExpandProperty Name -Unique) -join '|'
Write-Output "ALLSVC:$allSvc"
Write-Output "SVC:$runningSvc"
Write-Output "PROC:$procNames"
  `.trim();
}

function _detectAntiCheats() {
  return new Promise((resolve) => {
    const fs = require('fs');

    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      _buildDetectionScript(),
    ], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) {
        // Fallback: just check paths
        const results = AC_DEFS.map(def => ({
          id: def.id,
          name: def.name,
          installed: def.paths.some(p => { try { return fs.existsSync(p); } catch { return false; } }),
          running: false,
        }));
        return resolve(results);
      }

      const lines = stdout.split('\n').map(l => l.trim());
      const allSvcLine = lines.find(l => l.startsWith('ALLSVC:')) || '';
      const svcLine = lines.find(l => l.startsWith('SVC:')) || '';
      const procLine = lines.find(l => l.startsWith('PROC:')) || '';
      const allServices = allSvcLine.replace('ALLSVC:', '').toLowerCase();
      const runningServices = svcLine.replace('SVC:', '').toLowerCase();
      const runningProcs = procLine.replace('PROC:', '').toLowerCase();

      const results = AC_DEFS.map(def => {
        const svcInstalled = def.services.some(s => allServices.includes(s.toLowerCase()));
        const svcRunning = def.services.some(s => runningServices.includes(s.toLowerCase()));
        const procMatch = def.processes.some(p => runningProcs.includes(p.replace('.exe', '').toLowerCase()));
        const pathMatch = def.paths.some(p => { try { return fs.existsSync(p); } catch { return false; } });

        return {
          id: def.id,
          name: def.name,
          installed: svcInstalled || procMatch || pathMatch,
          running: svcRunning || procMatch,
        };
      });

      resolve(results);
    });
  });
}

/* ── IPC Registration ───────────────────────────────────────────── */
function registerIPC() {
  ipcMain.handle('anticheat:detect', async () => {
    try {
      return await _detectAntiCheats();
    } catch (error) {
      return { error: error.message || String(error) };
    }
  });

  // Returns lowercase process names currently running on the system
  ipcMain.handle('anticheat:running-procs', async () => {
    try {
      return await _getRunningProcessNames();
    } catch {
      return [];
    }
  });
}

/* ── Grab unique running process names (lowercase, no .exe) ──── */
function _getRunningProcessNames() {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '(Get-Process | Select-Object -ExpandProperty Name -Unique) -join \"|\"',
    ], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.trim().toLowerCase().split('|').filter(Boolean));
    });
  });
}

module.exports = { registerIPC };

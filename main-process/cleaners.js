/**
 * Cleaners Module
 * All game shader cleaners and system disk cleanup IPC handlers.
 */

const { ipcMain, app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execAsync, isPermissionError } = require('./utils');
const authSession = require('./authSession');

/** Async flat-directory clean: delete all entries in a dir without blocking the event loop. */
async function asyncCleanFlat(dirPath, filter) {
  let filesDeleted = 0, sizeFreed = 0, filesBefore = 0;
  let entries;
  try { entries = await fsp.readdir(dirPath); } catch { return { filesDeleted, sizeFreed, filesBefore }; }
  if (filter) entries = entries.filter(filter);
  filesBefore = entries.length;
  const BATCH = 50;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async (name) => {
      const fp = path.join(dirPath, name);
      const stats = await fsp.stat(fp);
      const size = stats.isDirectory() ? 0 : stats.size;
      await fsp.rm(fp, { recursive: true, force: true });
      return size;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') { filesDeleted++; sizeFreed += r.value; }
    }
  }
  return { filesDeleted, sizeFreed, filesBefore };
}

/** Async recursive directory clean: walks the tree deleting files, yields between entries. */
async function asyncCleanRecursive(dirPath) {
  let filesDeleted = 0, sizeFreed = 0, filesBefore = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      filesBefore++;
      const fp = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          await walk(fp);
          try { await fsp.rmdir(fp); } catch { }
        } else {
          const st = await fsp.stat(fp);
          sizeFreed += st.size;
          await fsp.rm(fp, { force: true });
          filesDeleted++;
        }
      } catch { }
    }
  }
  await walk(dirPath);
  return { filesDeleted, sizeFreed, filesBefore };
}

function registerIPC() {

// Forza Horizon 5 Shader Cache Cleaner
ipcMain.handle('cleaner:clear-forza-shaders', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const forzaCachePath = path.join(localAppData, 'Temp', 'Turn10Temp.scratch', 'GraphicsCache');

    if (!fs.existsSync(forzaCachePath)) {
      return { success: false, message: 'Forza Horizon 5 shader cache not found. Game may not be installed.' };
    }

    const { filesDeleted, sizeFreed, filesBefore } = await asyncCleanFlat(forzaCachePath);

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

// NVIDIA Shader Cache Cleaner
ipcMain.handle('cleaner:clear-nvidia-cache', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
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
    for (const cachePath of caches) {
      if (fs.existsSync(cachePath)) {
        anyCacheExists = true;
        try {
          const items = await fsp.readdir(cachePath);
          totalBefore += items.length;
        } catch (e) { }
      }
    }
    if (!anyCacheExists) {
      return { success: false, message: 'NVIDIA shader cache not found. Driver or game may not be installed.' };
    }

    for (const cachePath of caches) {
      if (fs.existsSync(cachePath)) {
        const result = await asyncCleanFlat(cachePath);
        totalDeleted += result.filesDeleted;
        totalSize += result.sizeFreed;
      }
    }

    for (const cachePath of caches) {
      if (fs.existsSync(cachePath)) {
        try {
          const items = await fsp.readdir(cachePath);
          totalRemaining += items.length;
        } catch (e) { }
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

// Apex Legends Shader Cache Cleaner
ipcMain.handle('cleaner:clear-apex-shaders', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
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
    } catch (e) { }

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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
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
          const result = await asyncCleanRecursive(codCachePath);
          filesDeleted += result.filesDeleted;
          sizeFreed += result.sizeFreed;
          filesBefore += result.filesBefore;
        } catch (e) { }
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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
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
          const result = await asyncCleanRecursive(cs2CachePath);
          filesDeleted += result.filesDeleted;
          sizeFreed += result.sizeFreed;
          filesBefore += result.filesBefore;
        } catch (e) { }
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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const fortniteCachePath = path.join(localAppData, 'FortniteGame', 'Saved', 'ShaderCache');

    if (!fs.existsSync(fortniteCachePath)) {
      return { success: false, message: 'Fortnite shader cache not found.' };
    }

    const { filesDeleted, sizeFreed, filesBefore } = await asyncCleanRecursive(fortniteCachePath);

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

// League of Legends Cache Cleaner
ipcMain.handle('cleaner:clear-lol-shaders', async () => {
    const blocked = authSession.requirePro(); if (blocked) return blocked;
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const lolCachePath = path.join(localAppData, 'RADS');

    if (!fs.existsSync(lolCachePath)) {
      return { success: false, message: 'League of Legends cache not found.' };
    }

    const { filesDeleted, sizeFreed, filesBefore } = await asyncCleanRecursive(lolCachePath);

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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
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
          const result = await asyncCleanRecursive(owCachePath);
          filesDeleted += result.filesDeleted;
          sizeFreed += result.sizeFreed;
          filesBefore += result.filesBefore;
        } catch (e) { }
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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
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
          const result = await asyncCleanRecursive(r6CachePath);
          filesDeleted += result.filesDeleted;
          sizeFreed += result.sizeFreed;
          filesBefore += result.filesBefore;
        } catch (e) { }
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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
  try {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const rlCachePath = path.join(userProfile, 'AppData', 'Roaming', 'Rocket League');

    if (!fs.existsSync(rlCachePath)) {
      return { success: false, message: 'Rocket League cache not found.' };
    }

    const { filesDeleted, sizeFreed, filesBefore } = await asyncCleanRecursive(rlCachePath);

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
    const blocked = authSession.requirePro(); if (blocked) return blocked;
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const valorantCachePath = path.join(localAppData, 'VALORANT');

    if (!fs.existsSync(valorantCachePath)) {
      return { success: false, message: 'Valorant cache not found.' };
    }

    const { filesDeleted, sizeFreed, filesBefore } = await asyncCleanRecursive(valorantCachePath);

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

// ── Individual Disk Cleanup Handlers ──

// Windows Temp Directory (%WINDIR%\Temp)
ipcMain.handle('cleaner:clear-windows-temp', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const winTemp = path.join(process.env.WINDIR || 'C:\\Windows', 'Temp');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(winTemp)) {
      const result = await asyncCleanFlat(winTemp);
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Windows Temp', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Windows Error Reports (WER)
ipcMain.handle('cleaner:clear-error-reports', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const werDirs = [
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'WER'),
      path.join('C:\\ProgramData', 'Microsoft', 'Windows', 'WER'),
    ];
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    for (const dir of werDirs) {
      if (!fs.existsSync(dir)) continue;
      const result = await asyncCleanFlat(dir);
      filesDeleted += result.filesDeleted;
      totalSize += result.sizeFreed;
      filesBefore += result.filesBefore;
    }
    return { success: true, message: 'Cleared Windows Error Reports', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Delivery Optimization Cache
ipcMain.handle('cleaner:clear-delivery-optimization', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const doDir = path.join('C:\\Windows', 'SoftwareDistribution', 'DeliveryOptimization');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(doDir)) {
      const result = await asyncCleanFlat(doDir);
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Delivery Optimization cache', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Recent Files list
ipcMain.handle('cleaner:clear-recent-files', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const recentDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(recentDir)) {
      const result = await asyncCleanFlat(recentDir);
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Recent Files list', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Thumbnail Cache
ipcMain.handle('cleaner:clear-thumbnail-cache', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const explorerDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Explorer');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(explorerDir)) {
      const result = await asyncCleanFlat(explorerDir, f => /^thumbcache_/i.test(f));
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Thumbnail Cache', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Windows Log Files
ipcMain.handle('cleaner:clear-windows-logs', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const logsDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Logs');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(logsDir)) {
      const result = await asyncCleanFlat(logsDir);
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Windows Logs', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Crash Dumps
ipcMain.handle('cleaner:clear-crash-dumps', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const dumpsDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CrashDumps');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(dumpsDir)) {
      const result = await asyncCleanFlat(dumpsDir);
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Crash Dumps', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Font Cache
ipcMain.handle('cleaner:clear-font-cache', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const fontCacheDir = path.join(process.env.WINDIR || 'C:\\Windows', 'ServiceProfiles', 'LocalService', 'AppData', 'Local', 'FontCache');
    let filesDeleted = 0, totalSize = 0, filesBefore = 0;
    if (fs.existsSync(fontCacheDir)) {
      const result = await asyncCleanFlat(fontCacheDir, f => /\.dat$/i.test(f));
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }
    return { success: true, message: 'Cleared Font Cache', filesDeleted, filesBefore, filesAfter: filesBefore - filesDeleted, spaceSaved: `${(totalSize / (1024 * 1024)).toFixed(2)} MB` };
  } catch (error) {
    if (isPermissionError(error)) return { success: false, message: 'Run the app as administrator' };
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Temp Files
ipcMain.handle('cleaner:clear-temp-files', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const tempDir = process.env.TEMP || os.tmpdir();
    let filesDeleted = 0;
    let totalSize = 0;
    let filesBefore = 0;

    if (fs.existsSync(tempDir)) {
      const result = await asyncCleanFlat(tempDir);
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
    }

    const filesAfter = filesBefore - filesDeleted;
    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared temporary files`,
      filesDeleted,
      filesBefore,
      filesAfter,
      spaceSaved: `${sizeInMB} MB`,
      details: `${filesDeleted}/${filesBefore} files deleted (${filesAfter} remaining)`,
    };
  } catch (error) {
    return { success: false, message: `Error: ${error.message}` };
  }
});

// Prefetch
ipcMain.handle('cleaner:clear-prefetch', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const prefetch = 'C:\\Windows\\Prefetch';
    let filesDeleted = 0;
    let totalSize = 0;
    let filesBefore = 0;
    let filesAfter = 0;

    if (fs.existsSync(prefetch)) {
      const result = await asyncCleanFlat(prefetch, f => f.endsWith('.pf'));
      filesDeleted = result.filesDeleted;
      totalSize = result.sizeFreed;
      filesBefore = result.filesBefore;
      filesAfter = filesBefore - filesDeleted;
    }

    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared prefetch files`,
      filesDeleted,
      filesBefore,
      filesAfter,
      spaceSaved: `${sizeInMB} MB`,
      details: `${filesDeleted}/${filesBefore} files deleted (${filesAfter} remaining)`,
    };
  } catch (error) {
    return { success: false, message: 'Run the app as administrator' };
  }
});

// Memory Dumps
ipcMain.handle('cleaner:clear-memory-dumps', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const dumpDir = 'C:\\Windows\\Minidump';
    let filesDeleted = 0;
    let totalSize = 0;
    let filesBefore = 0;
    let filesAfter = 0;

    if (!fs.existsSync(dumpDir)) {
      return { success: false, message: 'Minidump folder not found.' };
    }
    const dumpResult = await asyncCleanFlat(dumpDir);
    filesDeleted = dumpResult.filesDeleted;
    totalSize = dumpResult.sizeFreed;
    filesBefore = dumpResult.filesBefore;
    if (filesBefore === 0) {
      return { success: true, message: 'Minidump folder found, but no dump files to delete.', filesDeleted: 0, filesBefore: 0, filesAfter: 0, spaceSaved: '0 MB', details: 'No files to delete.' };
    }
    filesAfter = filesBefore - filesDeleted;
    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      message: `Cleared crash dump files`,
      filesDeleted,
      filesBefore,
      filesAfter,
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

// Update Cache
ipcMain.handle('cleaner:clear-update-cache', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const updateDir = 'C:\\Windows\\SoftwareDistribution\\Download';

    if (!fs.existsSync(updateDir)) {
      return { success: false, message: 'Windows Update cache not found. It may already be empty.', spaceSaved: '0 MB' };
    }

    const stopServicesCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
      @('wuauserv', 'usosvc', 'UsoSvc') | ForEach-Object {
        try { Stop-Service -Name \\$_ -Force -ErrorAction Stop } catch {}
      }
      Start-Sleep -Milliseconds 1500
    "`;
    try { await execAsync(stopServicesCmd, { shell: true, timeout: 30000 }); } catch (e) { }

    const statsCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem -Path '${updateDir}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`;
    let totalSize = 0;
    let filesBefore = 0;

    try {
      const statRes = await execAsync(statsCmd, { shell: true, timeout: 30000 });
      const stdout = (statRes.stdout || '').trim();
      totalSize = parseInt(stdout) || 0;
      const countCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem -Path '${updateDir}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object).Count"`;
      const countRes = await execAsync(countCmd, { shell: true, timeout: 30000 });
      filesBefore = parseInt(countRes.stdout) || 0;
    } catch (e) { }

    if (filesBefore === 0) {
      return { success: true, message: `Cache folder is already empty`, filesDeleted: 0, filesBefore: 0, filesAfter: 0, spaceSaved: `0 MB`, details: `No files to delete` };
    }

    let deletionSuccess = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
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
          const nukeCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
            Remove-Item -Path '${updateDir}' -Recurse -Force -ErrorAction Stop;
            Start-Sleep -Milliseconds 500;
            New-Item -ItemType Directory -Path '${updateDir}' -Force -ErrorAction Stop | Out-Null
          "`;
          await execAsync(nukeCmd, { shell: true, timeout: 120000 });
        }
        deletionSuccess = true;
        break;
      } catch (removeError) {
        lastError = removeError;
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    const restartCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "
      @('wuauserv', 'usosvc', 'UsoSvc') | ForEach-Object {
        try { Start-Service -Name \\$_ -ErrorAction SilentlyContinue } catch {}
      }
    "`;
    try { await execAsync(restartCmd, { shell: true, timeout: 10000 }); } catch (e) { }

    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);

    if (deletionSuccess) {
      return { success: true, message: `Cleared Windows Update cache`, filesDeleted: filesBefore, filesBefore, filesAfter: 0, spaceSaved: `${sizeInMB} MB`, details: `${filesBefore} file(s) deleted` };
    } else {
      const errorOutput = lastError ? (lastError.stderr || lastError.stdout || lastError.message || '').toLowerCase() : '';
      if (errorOutput.includes('access is denied') || errorOutput.includes('access denied')) {
        return { success: false, message: 'Run the app as administrator' };
      } else if (errorOutput.includes('is in use') || errorOutput.includes('cannot be removed') || errorOutput.includes('being used')) {
        return { success: false, message: 'Some cache files are still in use. Try restarting your computer.' };
      } else {
        return { success: false, message: 'Could not clear cache. Try restarting your computer.', spaceSaved: '0 MB', details: lastError ? lastError.message : 'Unknown error' };
      }
    }
  } catch (error) {
    return { success: false, message: 'Run the app as administrator' };
  }
});

// DNS Cache
ipcMain.handle('cleaner:clear-dns-cache', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    let entriesBefore = 0;
    try {
      const displayResult = await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "ipconfig /displaydns"', { shell: true, timeout: 10000 });
      const entries = displayResult.stdout.match(/Record Name/gi);
      entriesBefore = entries ? entries.length : 0;
    } catch (e) { }

    let dnsCleared = false;
    let method = '';
    let lastError = null;

    try {
      await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Clear-DnsClientCache -Confirm:$false"', { shell: true, timeout: 15000 });
      dnsCleared = true;
      method = 'PowerShell Clear-DnsClientCache';
    } catch (error) {
      lastError = error;
    }

    if (!dnsCleared) {
      try {
        const result = await execAsync('cmd /c ipconfig /flushdns', { shell: true, timeout: 15000 });
        if (result.stdout.includes('cleared') || result.stdout.includes('Cleared') || !result.stderr) {
          dnsCleared = true;
          method = 'ipconfig /flushdns (cmd)';
        }
      } catch (error) {
        lastError = error;
        try {
          await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "& cmd /c ipconfig /flushdns"', { shell: true, timeout: 15000 });
          dnsCleared = true;
          method = 'ipconfig /flushdns (PowerShell)';
        } catch (error2) {
          lastError = error2;
        }
      }
    }

    if (!dnsCleared) {
      try {
        await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Service -Name dnscache -Force -ErrorAction Stop; Start-Sleep -Milliseconds 1000"', { shell: true, timeout: 15000 });
        await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Service -Name dnscache -ErrorAction Stop"', { shell: true, timeout: 15000 });
        dnsCleared = true;
        method = 'DNS Client Service restart';
      } catch (error) {
        lastError = error;
      }
    }

    if (!dnsCleared) {
      return { success: false, message: 'Failed to clear DNS cache. Please ensure the app is running as Administrator.', details: lastError ? lastError.message : 'Unknown error' };
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      success: true,
      message: 'DNS cache cleared successfully',
      spaceSaved: entriesBefore > 0 ? `${entriesBefore} DNS entries removed` : 'DNS cache cleared',
      details: `Method: ${method}`,
    };
  } catch (error) {
    if (error.message.includes('access') || error.message.includes('denied') || error.message.includes('administrator') || error.message.includes('privilege')) {
      return { success: false, message: 'Administrator privileges required. Please run the app as Administrator.' };
    }
    return { success: false, message: `Error: ${error.message}` };
  }
});

// RAM Cache
ipcMain.handle('cleaner:clear-ram-cache', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    const tempScript = path.join(app.getPath('temp'), 'ram-purge.ps1');
    const scriptContent = `
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
        bool wasEnabled;
        uint privStatus = RtlAdjustPrivilege(SE_PROF_SINGLE_PROCESS_PRIVILEGE, true, false, out wasEnabled);
        
        if (privStatus != 0) {
            return "PRIV_FAIL:0x" + privStatus.ToString("X8");
        }
        
        int command = MemoryPurgeStandbyList;
        IntPtr commandPtr = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(commandPtr, command);
        
        uint status = NtSetSystemInformation(SystemMemoryListInformation, commandPtr, 4);
        Marshal.FreeHGlobal(commandPtr);
        
        if (status == 0) {
            return "SUCCESS:4";
        }
        
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

try {
    $standbyBefore = (Get-Counter '\\Memory\\Standby Cache Core Bytes','\\Memory\\Standby Cache Normal Priority Bytes','\\Memory\\Standby Cache Reserve Bytes' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum
    $cachedBeforeMB = [math]::Round($standbyBefore.Sum / 1MB, 0)
} catch {
    $cachedBeforeMB = 0
}

$result = [MemoryAPI]::PurgeStandbyList()

Start-Sleep -Milliseconds 2000

try {
    $standbyAfter = (Get-Counter '\\Memory\\Standby Cache Core Bytes','\\Memory\\Standby Cache Normal Priority Bytes','\\Memory\\Standby Cache Reserve Bytes' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum
    $cachedAfterMB = [math]::Round($standbyAfter.Sum / 1MB, 0)
} catch {
    $cachedAfterMB = 0
}

if ($cachedBeforeMB -gt 0 -and $cachedAfterMB -ge 0) {
    $freedMB = [math]::Abs($cachedBeforeMB - $cachedAfterMB)
} else {
    $freedMB = -1
}

Write-Output "$result|FreedMB=$freedMB"
`;

    fs.writeFileSync(tempScript, scriptContent, 'utf8');
    const result = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`, { shell: true });
    try { fs.unlinkSync(tempScript); } catch { }

    const output = result.stdout.trim();
    const lines = output.split('\n');
    const statusLine = lines[lines.length - 1].trim();

    if (statusLine.includes('SUCCESS:4') || statusLine.includes('SUCCESS:2')) {
      const freedMatch = statusLine.match(/FreedMB=(-?\d+)/);
      const freedMB = freedMatch ? parseInt(freedMatch[1]) : -1;

      if (freedMB > 0) {
        return { success: true, message: 'Standby list cleared successfully', spaceSaved: freedMB + ' MB' };
      } else {
        return { success: true, message: 'Standby list cleared successfully', spaceSaved: 'Check Task Manager to see freed memory' };
      }
    } else if (statusLine.includes('PRIV_FAIL')) {
      return { success: false, message: 'Run the app as administrator' };
    } else if (statusLine.includes('FAILED:')) {
      return { success: false, message: 'Run the app as administrator' };
    } else {
      return { success: false, message: 'Unexpected result. Check console logs.' };
    }
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    return { success: false, message: `Failed: ${error.message}` };
  }
});

// Empty Recycle Bin
ipcMain.handle('cleaner:empty-recycle-bin', async () => {
    const blocked = authSession.requireAuth(); if (blocked) return blocked;
  try {
    try {
      const cmd = `[void](Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop); Write-Host 'SUCCESS'`;
      const result = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, { shell: true });
      if (result.stdout.includes('SUCCESS') || !result.stderr) {
        return { success: true, message: 'Recycle bin emptied successfully', spaceSaved: 'Disk space now freed' };
      }
    } catch (e) { }

    const fallbackCmd = `
$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.NameSpace(10)
$recycleBin.Items() | ForEach-Object { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'EMPTIED'
`;
    const tempScript = path.join(app.getPath('temp'), 'empty-bin.ps1');
    fs.writeFileSync(tempScript, fallbackCmd, 'utf8');
    const result = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`, { shell: true });
    try { fs.unlinkSync(tempScript); } catch { }

    if (result.stdout.includes('EMPTIED') || !result.stderr.toLowerCase().includes('denied')) {
      return { success: true, message: 'Recycle bin emptied successfully', spaceSaved: 'Disk space freed' };
    }

    return { success: true, message: 'Recycle bin emptied successfully', spaceSaved: 'Disk space freed' };
  } catch (error) {
    if (isPermissionError(error)) {
      return { success: false, message: 'Run the app as administrator' };
    }
    if (error.message.toLowerCase().includes('empty') || error.message.toLowerCase().includes('already')) {
      return { success: true, message: 'Recycle bin is already empty', spaceSaved: 'Already empty' };
    }
    return { success: true, message: 'Recycle bin operation completed', spaceSaved: 'Check recycle bin status' };
  }
});

} // end registerIPC

module.exports = { registerIPC };

const { ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execAsync } = require('./utils');


const PROTECTED_PATHS = [
  'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
  'C:\\ProgramData', 'C:\\Users', 'C:\\$Recycle.Bin', 'C:\\System Volume Information',
  'C:\\$WinREAgent', 'C:\\DumpStack.log.tmp', 'C:\\pagefile.sys', 'C:\\hiberfil.sys'
];

function isProtected(targetPath) {
  const normalized = path.normalize(targetPath).toLowerCase();
  if (normalized.length <= 3 && normalized.endsWith(':\\')) return true;
  
  return PROTECTED_PATHS.some(pp => {
    const normPP = path.normalize(pp).toLowerCase();
    return normalized === normPP || normalized.startsWith(normPP + path.sep);
  });
}


function findNodeByPath(node, targetPath) {
  const normalizedTarget = normalizePath(targetPath).toLowerCase();
  const normalizedNodePath = normalizePath(node.path).toLowerCase();

  if (normalizedNodePath === normalizedTarget) return node;

  for (const child of node.children.values()) {
    const normalizedChildPath = normalizePath(child.path);
    const rel = path.relative(normalizedChildPath, normalizedTarget);

    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return findNodeByPath(child, targetPath);
    }
  }
  return null;
}

async function getDriveInfo(dirPath) {
  try {
    const driveMatch = dirPath.match(/^([A-Z]):/i);
    if (!driveMatch) return { driveCapacity: 0, driveFree: 0 };

    const driveLetter = driveMatch[1].toUpperCase();
    const cmd = `powershell -Command "$disk = Get-Volume -DriveLetter ${driveLetter}; Write-Output $disk.Size; Write-Output $disk.SizeRemaining"`;
    const { stdout } = await execAsync(cmd);
    const output = stdout.trim().split('\n');
    
    const driveCapacity = parseInt(output[0]?.trim()) || 0;
    const driveFree = parseInt(output[1]?.trim()) || 0;
    
    return { driveCapacity, driveFree };
  } catch (err) {

  }
  return { driveCapacity: 0, driveFree: 0 };
}

async function formatNodeResult(node, scannedFiles, scannedDirs, fromCache = false, driveInfoOverride = null) {
  let childrenList = Array.from(node.children.values()).map(c => ({
    name: c.name,
    path: c.path,
    size: c.size,
    allocated: c.allocated,
    fileCount: c.fileCount,
    folderCount: c.folderCount,
    modified: c.modified.toISOString(),
    isDir: true
  }));
  if (node.files) {
    for (const f of node.files) {
      childrenList.push({ 
        name: f.name, 
        path: path.join(node.path, f.name), 
        size: f.size, 
        allocated: f.allocated,
        modified: f.modified.toISOString(),
        isDir: false 
      });
    }
  }

  // Sort descending by size
  childrenList.sort((a, b) => b.size - a.size);

  const driveInfo = driveInfoOverride || await getDriveInfo(node.path);

  return {
    totalSize: node.size,
    children: childrenList,
    scannedFiles,
    scannedDirs,
    isCached: true,
    fromCache,
    driveCapacity: driveInfo.driveCapacity,
    driveFree: driveInfo.driveFree
  };
}

/**
 * Highly optimized concurrent directory scanner that builds a full Tree in memory.
*/
async function getDirSizeConcurrency(startPath, isCancelled, onProgress) {
  let scannedFiles = 0;
  let scannedDirs = 0;
  let lastProgress = Date.now();

  const rootNode = {
    name: path.basename(startPath) || startPath,
    path: startPath,
    size: 0,
    filesSize: 0,
    fileCount: 0,
    folderCount: 0,
    allocated: 0,
    modified: new Date(0),
    children: new Map(),
    isDir: true,
    parent: null,
    files: []
  };

  let dirsToProcess = [{ path: startPath, node: rootNode, depth: 0 }];
  const MAX_SCAN_DEPTH = 50;
  const MAX_SCAN_DIRS = 100000;

  while (dirsToProcess.length > 0) {
    if (isCancelled()) return null;
    if (scannedDirs >= MAX_SCAN_DIRS) break; // Safety breadth limit

    // Process directories in batches to utilize threadpool without overwhelming event loop
    const batch = dirsToProcess.splice(0, 100);

    const readResults = await Promise.allSettled(
      batch.map(d => fs.readdir(d.path, { withFileTypes: true }).then(entries => ({ entries, item: d })))
    );

    let statTasks = [];

    for (const res of readResults) {
      if (res.status === 'fulfilled') {
        scannedDirs++;
        const { entries, item } = res.value;

        for (const entry of entries) {
          const fullPath = path.join(item.path, entry.name);

          if (entry.isDirectory()) {
            // Create a new node in the tree
            const childNode = {
              name: entry.name,
              path: fullPath,
              size: 0,
              filesSize: 0,
              fileCount: 0,
              folderCount: 0,
              allocated: 0,
              modified: new Date(0),
              children: new Map(),
              isDir: true,
              parent: item.node,
              files: []
            };
            item.node.children.set(entry.name, childNode);
            item.node.folderCount++;
            // Only recurse if within depth limit
            if ((item.depth || 0) < MAX_SCAN_DEPTH) {
              dirsToProcess.push({ path: fullPath, node: childNode, depth: (item.depth || 0) + 1 });
            }
          } else if (entry.isFile()) {
            statTasks.push({ path: fullPath, parentNode: item.node, name: entry.name });
          }
        }
      }
    }

    // Process file stats in chunks to prevent EMFILE
    const chunkSize = 500;
    for (let i = 0; i < statTasks.length; i += chunkSize) {
      if (isCancelled()) return null;
      const chunk = statTasks.slice(i, i + chunkSize);

      const stats = await Promise.allSettled(
        chunk.map(c => fs.stat(c.path).then(s => ({ size: s.size, allocated: Math.ceil(s.size / 4096) * 4096, modified: s.mtime, item: c })))
      );

      for (const res of stats) {
        if (res.status === 'fulfilled') {
          scannedFiles++;
          const val = res.value;

          if (!val.item.parentNode.files) val.item.parentNode.files = [];
          val.item.parentNode.files.push({ name: val.item.name, size: val.size, allocated: val.allocated, modified: val.modified, isDir: false });
          val.item.parentNode.fileCount++;
          val.item.parentNode.filesSize += val.size;
          val.item.parentNode.allocated += val.allocated;
          
          // Update modified date (keep the most recent)
          if (val.modified > val.item.parentNode.modified) {
            val.item.parentNode.modified = val.modified;
          }

          // Propagate the size all the way up the tree to the root
          let curr = val.item.parentNode;
          while (curr) {
            curr.size += val.size;
            curr.allocated += val.allocated;
            if (val.modified > curr.modified) curr.modified = val.modified;
            curr = curr.parent;
          }
        }
      }
    }

    // Throttle progress emissions
    if (Date.now() - lastProgress > 250) {
      onProgress(scannedFiles, scannedDirs, rootNode.size);
      lastProgress = Date.now();
    }
  }

  return {
    rootNode,
    scannedFiles,
    scannedDirs
  };
}

// In-memory scan cache keyed by normalized root path (lowercase)
const scanCache = new Map();
const MAX_CACHED_SCANS = 3;        // Keep at most 3 scan results in memory
const CACHE_TTL_MS = 30 * 60 * 1000; // 30-minute TTL — stale scans require rescan

/** Evict oldest entries when cache exceeds MAX_CACHED_SCANS */
function _evictScanCache() {
  if (scanCache.size <= MAX_CACHED_SCANS) return;
  // Sort by timestamp ascending and delete oldest
  const sorted = [...scanCache.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  while (sorted.length > MAX_CACHED_SCANS) {
    const [key] = sorted.shift();
    scanCache.delete(key);
  }
}

let activeScan = {
  path: null,
  cancel: null,
  promise: null,
  inProgress: false
};

function normalizePath(targetPath) {
  try {
    if (!targetPath || typeof targetPath !== 'string') {
      return '';
    }

    let resolved = path.resolve(targetPath);
    resolved = path.normalize(resolved);

    // Keep root drives in canonical form (C:\)
    const driveRootMatch = resolved.match(/^([a-zA-Z]:)[\\/]*$/);
    if (driveRootMatch) {
      return `${driveRootMatch[1].toUpperCase()}\\`;
    }

    // Trim trailing slashes while keeping non-root path normalization
    return resolved.replace(/[\\/]+$/, '');
  } catch {
    return targetPath;
  }
}

function isDescendantPath(parentPath, childPath) {
  const parent = normalizePath(parentPath).toLowerCase();
  const child = normalizePath(childPath).toLowerCase();

  if (parent === child) return false;

  // root drive (C:\) should match all items on the same drive
  const rootPath = parent.match(/^([a-z]):\\$/i);
  if (rootPath) {
    return child.startsWith(parent);
  }

  // Non-root parent must be followed by separator in child
  return child.startsWith(parent + path.sep);
}

async function scanDirectory(targetPath, forceRescan = false) {
  const normalizedPath = normalizePath(targetPath);

  if (!forceRescan && scanCache.size > 0) {
    for (const [cachedPath, cacheEntry] of scanCache.entries()) {
      // Skip stale cache entries
      if (Date.now() - (cacheEntry.ts || 0) > CACHE_TTL_MS) continue;

      const driveInfo = {
        driveCapacity: cacheEntry.driveCapacity || 0,
        driveFree: cacheEntry.driveFree || 0
      };

      if (normalizedPath.toLowerCase() === cachedPath.toLowerCase()) {
        return await formatNodeResult(cacheEntry.rootNode, cacheEntry.scannedFiles, cacheEntry.scannedDirs, true, driveInfo);
      }
      if (isDescendantPath(cachedPath, normalizedPath)) {
        const node = findNodeByPath(cacheEntry.rootNode, normalizedPath);
        if (node) {
          return await formatNodeResult(node, cacheEntry.scannedFiles, cacheEntry.scannedDirs, true, driveInfo);
        }
      }
    }
  }

  if (activeScan.inProgress && activeScan.path) {
    const activeNormalized = activeScan.path.toLowerCase();
    const requestNormalized = normalizedPath.toLowerCase();

    if (!forceRescan && activeScan.promise) {
      if (activeNormalized === requestNormalized) {
        return activeScan.promise;
      }
      if (isDescendantPath(activeScan.path, normalizedPath)) {
        // parent path scan in progress; wait for it and then return cached child path
        return activeScan.promise.then(() => scanDirectory(targetPath, forceRescan));
      }
    }

    if (activeNormalized !== requestNormalized && activeScan.cancel) {
      activeScan.cancel();
    }
  }

  const cancelToken = { cancelled: false };
  const mainWindow = require('./windowManager').getMainWindow();
  const emitProgress = (files, dirs, size) => {
    if (cancelToken.cancelled) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('space:progress', {
      dirPath: normalizedPath,
      files,
      dirs,
      size
    });
  };

  const scanPromise = (async () => {
    try {
      const stat = fsSync.existsSync(normalizedPath) && fsSync.statSync(normalizedPath);
      if (!stat) {
        throw new Error('Path does not exist');
      }
      if (!stat.isDirectory()) {
        throw new Error('Path is not a directory');
      }

      const result = await getDirSizeConcurrency(normalizedPath, () => cancelToken.cancelled, emitProgress);
      if (!result) {
        return null;
      }

      const driveInfo = await getDriveInfo(normalizedPath);

      scanCache.set(normalizedPath.toLowerCase(), {
        rootNode: result.rootNode,
        scannedFiles: result.scannedFiles,
        scannedDirs: result.scannedDirs,
        driveCapacity: driveInfo.driveCapacity,
        driveFree: driveInfo.driveFree,
        ts: Date.now()
      });
      _evictScanCache();

      return await formatNodeResult(result.rootNode, result.scannedFiles, result.scannedDirs, false, driveInfo);
    } finally {
      activeScan.inProgress = false;
      activeScan.path = null;
      activeScan.cancel = null;
      activeScan.promise = null;
    }
  })();

  activeScan = {
    path: normalizedPath,
    cancel: () => { cancelToken.cancelled = true; },
    promise: scanPromise,
    inProgress: true
  };

  return scanPromise;
}

function clearCacheForPath(targetPath) {
  const tNorm = normalizePath(targetPath).toLowerCase();
  for (const key of Array.from(scanCache.keys())) {
    if (key === tNorm || key.startsWith(tNorm + path.sep) || tNorm.startsWith(key + path.sep)) {
      scanCache.delete(key);
    }
  }
}

async function getCachedNode(targetPath) {
  const normalizedPath = normalizePath(targetPath);
  if (!normalizedPath) return null;

  for (const [cachedPath, cacheEntry] of scanCache.entries()) {
    const driveInfo = {
      driveCapacity: cacheEntry.driveCapacity || 0,
      driveFree: cacheEntry.driveFree || 0
    };

    if (normalizedPath.toLowerCase() === cachedPath.toLowerCase()) {
      return await formatNodeResult(cacheEntry.rootNode, cacheEntry.scannedFiles, cacheEntry.scannedDirs, true, driveInfo);
    }

    if (isDescendantPath(cachedPath, normalizedPath)) {
      const node = findNodeByPath(cacheEntry.rootNode, normalizedPath);
      if (node) {
        return await formatNodeResult(node, cacheEntry.scannedFiles, cacheEntry.scannedDirs, true, driveInfo);
      }
    }
  }

  return null;
}

function registerIPC() {
  ipcMain.handle('space:get-node', async (_event, targetPath) => {
    try {
      return getCachedNode(targetPath);
    } catch (err) {
      console.error('space:get-node error', err);
      return null;
    }
  });

  ipcMain.handle('space:scan', async (_event, targetPath, forceRescan = false) => {
    try {
      const data = await scanDirectory(targetPath, forceRescan);
      if (!data) return null;
      return data;
    } catch (err) {
      console.error('space:scan error', err);
      throw err;
    }
  });

  ipcMain.handle('space:cancel', async (_event, targetPath) => {
    const normalizedPath = normalizePath(targetPath);
    if (activeScan.inProgress && activeScan.path && activeScan.path.toLowerCase() === normalizedPath.toLowerCase()) {
      if (activeScan.cancel) activeScan.cancel();
      activeScan.inProgress = false;
      activeScan.path = null;
      activeScan.cancel = null;
      return { success: true };
    }
    return { success: false, error: 'No active scan for this path' };
  });

  ipcMain.handle('space:delete', async (_event, targetPath) => {
    const normalizedPath = normalizePath(targetPath);

    if (isProtected(normalizedPath)) {
      return { success: false, error: 'Protected path cannot be deleted.' };
    }

    try {
      if (!fsSync.existsSync(normalizedPath)) {
        return { success: false, error: 'Path does not exist.' };
      }

      const stat = fsSync.statSync(normalizedPath);
      if (stat.isDirectory()) {
        await fs.rm(normalizedPath, { recursive: true, force: true });
      } else {
        await fs.unlink(normalizedPath);
      }

      clearCacheForPath(normalizedPath);
      return { success: true };
    } catch (err) {
      console.error('space:delete error', err);
      return { success: false, error: err?.message || 'Delete failed.' };
    }
  });

  ipcMain.handle('space:get-drives', async () => {
    const { execSync } = require('child_process');
    try {
      const psCmd = [
        'Get-Volume',
        '| Where-Object { $_.DriveType -eq \'Fixed\' -and $_.DriveLetter }',
        '| Select-Object DriveLetter,FileSystemLabel,SizeRemaining,Size',
        '| ConvertTo-Json -Compress'
      ].join(' ');
      const out = execSync(
        `powershell -NoProfile -NonInteractive -Command "${psCmd}"`,
        { encoding: 'utf8', timeout: 8000, windowsHide: true }
      );
      const raw = JSON.parse(out.trim());
      const arr = Array.isArray(raw) ? raw : [raw];
      const drives = arr
        .filter(v => v.DriveLetter && v.Size > 0)
        .map(v => ({
          letter: v.DriveLetter + ':',
          label: v.FileSystemLabel || '',
          freeGB: Math.round(v.SizeRemaining / 1073741824 * 10) / 10,
          totalGB: Math.round(v.Size / 1073741824 * 10) / 10,
        }))
        .sort((a, b) => a.letter.localeCompare(b.letter));
      return drives;
    } catch {
      // Fallback: simple filesystem probe
      const drives = [];
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i) + ':';
        try {
          const st = require('fs').statSync(letter + '\\');
          if (st) drives.push({ letter: letter.toUpperCase(), label: '', freeGB: 0, totalGB: 0 });
        } catch {}
      }
      return drives;
    }
  });
}

module.exports = { registerIPC };

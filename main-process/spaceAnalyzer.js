const { ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

// Track active scans to allow cancellation
let activeScans = new Set();
// Track active internal promises to deduplicate identical concurrent scan requests
let activeScanPromises = new Map();

// Cache the last complete scan tree in memory for instant drill-down navigation
let cachedTree = null; // { rootNode, scannedFiles, scannedDirs }

/**
 * Searches the cached tree for a specific subdirectory node.
 * Uses path.relative to determine if the targetPath resides within a child.
 */
function findNodeByPath(node, targetPath) {
  if (node.path.toLowerCase() === targetPath.toLowerCase()) return node;

  for (const child of node.children.values()) {
    const rel = path.relative(child.path, targetPath);
    // If targetPath is inside child.path, the relative path won't start with '..' and won't be an absolute path (different drive)
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return findNodeByPath(child, targetPath);
    }
  }
  return null;
}

/**
 * Converts internal Node representation into the flat list array expected by React
 */
function formatNodeResult(node, scannedFiles, scannedDirs) {
  let childrenList = Array.from(node.children.values()).map(c => ({
    name: c.name,
    path: c.path,
    size: c.size,
    isDir: true
  }));
  // Add individual files instead of a single aggregate
  if (node.files) {
    for (const f of node.files) {
      childrenList.push({ name: f.name, path: path.join(node.path, f.name), size: f.size, isDir: false });
    }
  }

  // Sort descending by size
  childrenList.sort((a, b) => b.size - a.size);

  return {
    totalSize: node.size,
    children: childrenList,
    scannedFiles,
    scannedDirs,
    isCached: true
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
    children: new Map(),
    isDir: true,
    parent: null
  };

  let dirsToProcess = [{ path: startPath, node: rootNode }];

  while (dirsToProcess.length > 0) {
    if (isCancelled()) return null;

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
              children: new Map(),
              isDir: true,
              parent: item.node
            };
            item.node.children.set(entry.name, childNode);
            dirsToProcess.push({ path: fullPath, node: childNode });
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
        chunk.map(c => fs.stat(c.path).then(s => ({ size: s.size, item: c })))
      );

      for (const res of stats) {
        if (res.status === 'fulfilled') {
          scannedFiles++;
          const val = res.value;

          if (!val.item.parentNode.files) val.item.parentNode.files = [];
          val.item.parentNode.files.push({ name: val.item.name, size: val.size });

          val.item.parentNode.filesSize += val.size;

          // Propagate the size all the way up the tree to the root
          let curr = val.item.parentNode;
          while (curr) {
            curr.size += val.size;
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

function registerIPC() {
  ipcMain.handle('space:scan', async (event, dirPath, arg3) => {
    const forceRescan = !!arg3;

    // Check if we already have this directory inside our in-memory cached tree
    if (!forceRescan && cachedTree) {
      const cachedNode = findNodeByPath(cachedTree.rootNode, dirPath);
      if (cachedNode) {
        // Return instantly using the cached data
        return formatNodeResult(cachedNode, cachedTree.scannedFiles, cachedTree.scannedDirs);
      }
    }

    // If already scanning this path in the background, simply await the existing scan
    // But if forceRescan is active, we should wait for it to finish and then rescan it?
    // Let's just return the active promise for now to avoid double crawls.
    if (!forceRescan && activeScanPromises.has(dirPath)) {
      return await activeScanPromises.get(dirPath);
    }

    // Create the background scanning promise
    const scanPromise = (async () => {
      // If not in cache (e.g. completely new drive being scanned), wipe cache and start fresh
      cachedTree = null;
      activeScans.add(dirPath);

      const onProgress = (files, dirs, size) => {
        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send('space:progress', { dirPath, files, dirs, size });
        }
      };

      const result = await getDirSizeConcurrency(
        dirPath,
        () => !activeScans.has(dirPath),
        onProgress
      );

      activeScans.delete(dirPath);

      // Save to cache for instant sub-folder navigation
      if (result && result.rootNode) {
        cachedTree = result;

        const finalResult = formatNodeResult(result.rootNode, result.scannedFiles, result.scannedDirs);
        finalResult.isCached = false;
        return finalResult;
      }
      return null;
    })();

    activeScanPromises.set(dirPath, scanPromise);
    const resolvedResult = await scanPromise;
    activeScanPromises.delete(dirPath);
    return resolvedResult;
  });

  ipcMain.handle('space:cancel', (event, dirPath) => {
    activeScans.delete(dirPath);
    return true;
  });
}

module.exports = { registerIPC };

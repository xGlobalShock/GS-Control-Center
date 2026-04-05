const { app, ipcMain } = require('electron');
const { autoUpdater, CancellationToken } = require('electron-updater');
const windowManager = require('./windowManager');
const fs = require('fs');
const path = require('path');

let _downloadCancellationToken = null;
let _updateDownloadedAt = null;
let _updateLogPath = null;

function logUpdateEvent(line) {
  try {
    if (!_updateLogPath) return;
    const entry = `${new Date().toISOString()} ${line}\n`;
    fs.appendFile(_updateLogPath, entry, () => {});
  } catch (e) {
    // Best-effort logging only
  }
}

function sendUpdateStatus(data) {
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', data);
  }
}

function initAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[AutoUpdater] Skipping — running in dev mode');
    return;
  }

  // Ensure we have a path to write lightweight update telemetry/logs
  try {
    _updateLogPath = path.join(app.getPath('userData'), 'update-finalization.log');
  } catch (e) {
    _updateLogPath = null;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // Safety net: if app quits after download, install runs
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ event: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      event: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map(n => n.note || n).join('\n')
          : '',
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({ event: 'not-available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    sendUpdateStatus({
      event: 'download-progress',
      percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
    windowManager.sendSplashStatus('Downloading update...');
    windowManager.sendSplashProgress(percent);
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ event: 'downloaded', version: info.version });

    _updateDownloadedAt = Date.now();
    logUpdateEvent(`update-downloaded version=${info.version}`);

    windowManager.sendSplashStatus('Update downloaded. Installing...');
    windowManager.sendSplashProgress(100);

    // Auto-install immediately — app will quit, NSIS runs silently, then relaunches.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(true, true);
      } catch (e) {
        const msg = e?.message || 'Unknown error';
        console.error('[AutoUpdater] quitAndInstall failed:', msg);
        logUpdateEvent(`quitAndInstall-failed: ${msg}`);
        windowManager.sendSplashStatus(`Install failed: ${msg}. Returning to app...`);
        sendUpdateStatus({ event: 'error', message: `Install failed: ${msg}` });

        // Recover: close splash and restore the main window after a brief pause
        setTimeout(() => {
          try {
            const splash = windowManager.getSplashWindow();
            if (splash && !splash.isDestroyed()) splash.close();
          } catch {}
          try {
            const main = windowManager.getMainWindow();
            if (main && !main.isDestroyed()) main.show();
          } catch {}
        }, 3000);
      }
    }, 800);
  });

  autoUpdater.on('before-quit-for-update', () => {
    windowManager.sendSplashStatus('Installing update...');
    windowManager.sendSplashProgress(100);

    // Log how long we waited between download and install kickoff
    try {
      const elapsedMs = _updateDownloadedAt ? Date.now() - _updateDownloadedAt : null;
      logUpdateEvent(`before-quit-for-update elapsedMs=${elapsedMs ?? 'n/a'}`);
      sendUpdateStatus({ event: 'finalizing', elapsedMs: elapsedMs ?? null });
    } catch (e) {}
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err?.message || err);
    sendUpdateStatus({ event: 'error', message: err?.message || 'Unknown update error' });
  });

  autoUpdater.checkForUpdates().catch(err => {
    console.warn('[AutoUpdater] Check failed:', err?.message);
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 1000); // Check every 30 seconds
}

function registerIPC() {
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      return { event: 'not-available', version: app.getVersion(), dev: true };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { event: 'checked', version: result?.updateInfo?.version || app.getVersion() };
    } catch (err) {
      return { event: 'error', message: err?.message || 'Check failed' };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }

      if (!windowManager.getSplashWindow()) {
        windowManager.createSplashWindow();
      }

      windowManager.sendSplashStatus('Downloading update...');
      windowManager.sendSplashProgress(0);

      _downloadCancellationToken = new CancellationToken();
      await autoUpdater.downloadUpdate(_downloadCancellationToken);
      _downloadCancellationToken = null;

      // update-downloaded event already fired and queued quitAndInstall.
      // Just return success — do not overwrite the splash status set by the event handler.
      return { success: true };
    } catch (err) {
      _downloadCancellationToken = null;
      windowManager.sendSplashStatus('Download failed. Please retry.');
      if (err?.message === 'cancelled') return { success: false, cancelled: true };
      return { success: false, message: err?.message || 'Download failed' };
    }
  });

  ipcMain.handle('updater:cancel', () => {
    try {
      if (_downloadCancellationToken) {
        _downloadCancellationToken.cancel();
        _downloadCancellationToken = null;
      }
    } catch {}
    return { success: true };
  });

  ipcMain.handle('updater:install', () => {
    // This is a no-op in the auto-install flow — quitAndInstall is already
    // triggered automatically from the update-downloaded event handler.
    // Kept for API compatibility with the renderer.
    return { success: true };
  });

  ipcMain.handle('updater:get-version', () => {
    return app.getVersion();
  });
}

module.exports = { initAutoUpdater, registerIPC };

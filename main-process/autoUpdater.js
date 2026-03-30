const { app, ipcMain } = require('electron');
const { autoUpdater, CancellationToken } = require('electron-updater');
const windowManager = require('./windowManager');

let _downloadCancellationToken = null;

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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false; // Manual install step (user clicks Install button)
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
    sendUpdateStatus({
      event: 'downloaded',
      version: info.version,
    });
    windowManager.sendSplashStatus('Update downloaded. Ready to install.');
    windowManager.sendSplashProgress(100);

    // Auto-install shortly after download to avoid stale "ready" stall.
    setTimeout(() => {
      if (windowManager.getSplashWindow() && !windowManager.getSplashWindow().isDestroyed()) {
        windowManager.sendSplashStatus('Installing update...');
      }
      autoUpdater.quitAndInstall(true, true);
    }, 800);
  });

  autoUpdater.on('before-quit-for-update', () => {
    windowManager.sendSplashStatus('Installing update...');
    windowManager.sendSplashProgress(100);
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
  }, 4 * 60 * 60 * 1000);
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

      windowManager.sendSplashStatus('Update downloaded. Ready to install.');
      windowManager.sendSplashProgress(100);

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
    windowManager.sendSplashStatus('Installing update...');
    windowManager.sendSplashProgress(100);

    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }

    // Keep splash visible so user sees the transition, then quit and update.
    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 300);
  });

  ipcMain.handle('updater:get-version', () => {
    return app.getVersion();
  });
}

module.exports = { initAutoUpdater, registerIPC };

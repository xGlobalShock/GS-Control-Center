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
  autoUpdater.autoInstallOnAppQuit = true;
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
    sendUpdateStatus({
      event: 'download-progress',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      event: 'downloaded',
      version: info.version,
    });
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
      _downloadCancellationToken = new CancellationToken();
      await autoUpdater.downloadUpdate(_downloadCancellationToken);
      _downloadCancellationToken = null;
      return { success: true };
    } catch (err) {
      _downloadCancellationToken = null;
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
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('updater:get-version', () => {
    return app.getVersion();
  });
}

module.exports = { initAutoUpdater, registerIPC };

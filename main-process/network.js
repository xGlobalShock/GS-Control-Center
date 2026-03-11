/**
 * Network & Video Settings Presets Module
 */

const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execAsync } = require('./utils');

function registerIPC() {

  ipcMain.handle('network:ping', async (event, host) => {
    try {
      const cmd = `ping -n 1 ${host}`;
      const { stdout } = await execAsync(cmd, { shell: true, timeout: 10000 });
      const m = stdout.match(/time[=<]\s*(\d+)\s*ms/) || stdout.match(/temps[=<]\s*(\d+)\s*ms/i);
      const time = m ? parseInt(m[1], 10) : null;
      return { success: time !== null, time };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('preset:save-video-settings', async (event, filename, content) => {
    try {
      const dir = path.join(app.getPath('userData'), 'videosettings-presets');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

}

module.exports = { registerIPC };

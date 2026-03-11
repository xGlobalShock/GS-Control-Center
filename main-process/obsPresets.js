/**
 * OBS Presets Module
 * Check OBS installation, apply presets, launch OBS.
 */

const { ipcMain, app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execAsync } = require('./utils');

function registerIPC() {

  ipcMain.handle('obs:check-installed', async () => {
    try {
      const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

      const commonPaths = [
        path.join(roamingAppData, 'obs-studio'),
        path.join(localAppData, 'obs-studio'),
        path.join(localAppData, 'Programs', 'obs-studio'),
        'C:\\Program Files\\obs-studio\\bin\\64bit\\obs.exe',
        'C:\\Program Files\\obs-studio\\bin\\32bit\\obs.exe',
        'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs.exe',
        'C:\\Program Files (x86)\\obs-studio\\bin\\32bit\\obs.exe',
      ];

      for (const obsPath of commonPaths) {
        if (fs.existsSync(obsPath)) {
          console.log(`OBS detected at: ${obsPath}`);
          return true;
        }
      }

      try {
        await execAsync('where obs', { shell: true });
        console.log('OBS detected in PATH');
        return true;
      } catch (e) {
        // Not in PATH
      }

      console.log('OBS not detected on system');
      return false;
    } catch (error) {
      console.error('Error checking OBS installation:', error);
      return false;
    }
  });

  ipcMain.handle('obs:get-path', async () => {
    try {
      const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

      const commonPaths = [
        path.join(roamingAppData, 'obs-studio'),
        path.join(localAppData, 'obs-studio'),
        path.join(localAppData, 'Programs', 'obs-studio'),
        'C:\\Program Files\\obs-studio',
        'C:\\Program Files (x86)\\obs-studio',
      ];

      for (const obsPath of commonPaths) {
        if (fs.existsSync(obsPath)) {
          console.log(`Found OBS at: ${obsPath}`);
          return obsPath;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting OBS path:', error);
      return null;
    }
  });

  ipcMain.handle('obs:apply-preset', async (event, presetId) => {
    try {
      const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const obsConfigPath = path.join(roamingAppData, 'obs-studio');

      if (!fs.existsSync(obsConfigPath)) {
        return {
          success: false,
          message: 'OBS configuration directory not found. Please launch OBS at least once first.'
        };
      }

      console.log(`Found OBS config directory at: ${obsConfigPath}`);

      const appPath = app.isPackaged
        ? path.join(process.resourcesPath, 'data', 'obsPresetConfigs')
        : path.join(__dirname, '..', 'src', 'data', 'obsPresetConfigs');

      const presetPath = path.join(appPath, presetId);

      console.log(`Looking for preset at: ${presetPath}`);

      if (!fs.existsSync(presetPath)) {
        return {
          success: false,
          message: `Preset configuration not found: ${presetId}`
        };
      }

      // Find the default profile directory
      let profileDir = null;

      const profilesIniPath = path.join(obsConfigPath, 'profiles.ini');
      console.log(`Checking for profiles.ini at: ${profilesIniPath}`);

      if (fs.existsSync(profilesIniPath)) {
        try {
          const profilesContent = fs.readFileSync(profilesIniPath, 'utf-8');
          console.log(`Profiles content:\n${profilesContent}`);
          const defaultMatch = profilesContent.match(/Default=(.*)/);
          if (defaultMatch) {
            const profileName = defaultMatch[1].trim();
            profileDir = path.join(obsConfigPath, 'basic', 'profiles', profileName);
            console.log(`Found default profile from profiles.ini: ${profileName}`);
          }
        } catch (e) {
          console.warn(`Could not read profiles.ini: ${e.message}`);
        }
      }

      if (!profileDir) {
        const profilesPath = path.join(obsConfigPath, 'basic', 'profiles');
        if (fs.existsSync(profilesPath)) {
          const profiles = fs.readdirSync(profilesPath).filter(f =>
            fs.statSync(path.join(profilesPath, f)).isDirectory()
          );

          if (profiles.length > 0) {
            profileDir = path.join(profilesPath, profiles[0]);
            console.log(`Found existing profile: ${profiles[0]}`);
          }
        }
      }

      if (!profileDir) {
        profileDir = path.join(obsConfigPath, 'basic', 'profiles', 'Untitled');
        console.log(`No profiles found, will use default: Untitled`);
      }

      console.log(`Using profile directory: ${profileDir}`);

      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
        console.log(`Created profile directory`);
      }

      // Copy profile configuration files
      const presetProfileDir = path.join(presetPath, 'profile');
      if (fs.existsSync(presetProfileDir)) {
        const profileFiles = fs.readdirSync(presetProfileDir).filter(f => !f.includes('.bak'));
        console.log(`Found ${profileFiles.length} profile configuration files to copy`);

        for (const profileFile of profileFiles) {
          const sourceFile = path.join(presetProfileDir, profileFile);
          const targetFile = path.join(profileDir, profileFile);
          fs.copyFileSync(sourceFile, targetFile);
          console.log(`Copied profile config: ${profileFile}`);
        }
      }

      // Create scenes folder in basic directory
      const basicScenesDir = path.join(obsConfigPath, 'basic', 'scenes');
      if (!fs.existsSync(basicScenesDir)) {
        fs.mkdirSync(basicScenesDir, { recursive: true });
        console.log(`Created scenes directory at: ${basicScenesDir}`);
      }

      // Copy all scene files from preset to basic/scenes
      const presetScenesDir = path.join(presetPath, 'scenes');
      if (fs.existsSync(presetScenesDir)) {
        const sceneFiles = fs.readdirSync(presetScenesDir).filter(f => f.endsWith('.json'));
        console.log(`Found ${sceneFiles.length} scene files to copy`);

        for (const sceneFile of sceneFiles) {
          const sourceFile = path.join(presetScenesDir, sceneFile);
          const targetFile = path.join(basicScenesDir, sceneFile);
          fs.copyFileSync(sourceFile, targetFile);
          console.log(`Copied scene: ${sceneFile}`);
        }
      }

      // Copy scenes.json reference file to profile folder
      const sourceProfileScenes = path.join(presetPath, 'scenes.json');
      const targetProfileScenes = path.join(profileDir, 'scenes.json');
      if (fs.existsSync(sourceProfileScenes)) {
        fs.copyFileSync(sourceProfileScenes, targetProfileScenes);
        console.log(`Copied scenes.json reference to profile folder`);
      }

      return {
        success: true,
        message: `Successfully applied ${presetId} preset to OBS. All profile settings and scenes have been configured. Close OBS completely and restart it to see the changes.`,
        presetId
      };
    } catch (error) {
      console.error('Error applying OBS preset:', error);
      return {
        success: false,
        message: `Failed to apply preset: ${error.message}`
      };
    }
  });

  ipcMain.handle('obs:launch', async () => {
    try {
      const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

      const commonPaths = [
        path.join(roamingAppData, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
        path.join(roamingAppData, 'obs-studio', 'bin', '64bit', 'obs.exe'),
        path.join(roamingAppData, 'obs-studio', 'bin', '32bit', 'obs32.exe'),
        path.join(roamingAppData, 'obs-studio', 'bin', '32bit', 'obs.exe'),
        path.join(localAppData, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
        path.join(localAppData, 'obs-studio', 'bin', '64bit', 'obs.exe'),
        path.join(localAppData, 'obs-studio', 'bin', '32bit', 'obs32.exe'),
        path.join(localAppData, 'obs-studio', 'bin', '32bit', 'obs.exe'),
        'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe',
        'C:\\Program Files\\obs-studio\\bin\\64bit\\obs.exe',
        'C:\\Program Files\\obs-studio\\bin\\32bit\\obs32.exe',
        'C:\\Program Files\\obs-studio\\bin\\32bit\\obs.exe',
        'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs64.exe',
        'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs.exe',
        'C:\\Program Files (x86)\\obs-studio\\bin\\32bit\\obs32.exe',
        'C:\\Program Files (x86)\\obs-studio\\bin\\32bit\\obs.exe',
      ];

      let executablePath = null;

      for (const obsPath of commonPaths) {
        if (fs.existsSync(obsPath)) {
          executablePath = obsPath;
          console.log(`Found OBS executable at: ${obsPath}`);
          break;
        }
      }

      if (!executablePath) {
        return {
          success: false,
          message: 'OBS Studio executable not found. Please ensure OBS is installed.'
        };
      }

      const obsDir = path.dirname(executablePath);
      spawn(executablePath, [], {
        cwd: obsDir,
        detached: true,
        stdio: 'ignore'
      });

      return {
        success: true,
        message: 'OBS Studio launched successfully'
      };
    } catch (error) {
      console.error('Error launching OBS:', error);
      return {
        success: false,
        message: `Failed to launch OBS: ${error.message}`
      };
    }
  });

} // end registerIPC

module.exports = { registerIPC };

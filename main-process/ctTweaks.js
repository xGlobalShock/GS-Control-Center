const { ipcMain } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const windowManager = require('./windowManager');
const repairOverlay = require('./repairOverlay');

function sendTweakProgress(data) {
  const mainWin = windowManager.getMainWindow();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('tweak:progress', data);
  }
}

function registerCTTweaks() {
  const ctTweaks = require('./ctEssentialTweaks');

  Object.keys(ctTweaks).forEach(tweakId => {
    ipcMain.handle(`ct-tweak:${tweakId}`, async (event) => {
      const tweak = ctTweaks[tweakId];
      
      // Calculate total steps for the progress bar
      let totalSteps = 0;
      if (tweak.service) totalSteps += tweak.service.length;
      if (tweak.registry) totalSteps += tweak.registry.length;
      if (tweak.InvokeScript) totalSteps += 1;
      if (totalSteps === 0) totalSteps = 1;

      // Broadcast that tweak started to the Main renderer
      const initData = { id: tweakId, status: 'running', title: tweak.Content, line: 'Preparing tweak...', progress: 5 };
      sendTweakProgress(initData);
      
      // Also register into repair overlay in case user minimizes
      repairOverlay.setActiveRepair('tweak', tweak.Content, '#3b82f6');
      repairOverlay.pushProgress(initData);

      const tmpPath = path.join(os.tmpdir(), `cttweak_${Date.now()}.ps1`);
      const logPath = tmpPath + '.log';
      fs.writeFileSync(logPath, '', 'utf8');

      let psScript = `
$ErrorActionPreference = 'SilentlyContinue';
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Log-Progress {
    param([string]$Message)
    Add-Content -Path '${logPath}' -Value $Message -Encoding UTF8
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $proc = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "\`"${tmpPath}\`"" -Verb RunAs -PassThru -Wait
    if ($proc) { exit $proc.ExitCode } else { exit 1 }
}
`;
      let stepCounter = 0;

      // For Services tweak, prepend restore point creation into the same elevated session
      if (tweakId === 'WPFTweaksServices') {
        psScript += `Log-Progress "CTTWEAK_PROGRESS:1|Creating Restore Point...";\n`;
        psScript += `if (-not (Get-ComputerRestorePoint)) { Enable-ComputerRestore -Drive $Env:SystemDrive }\n`;
        psScript += `Checkpoint-Computer -Description "System Restore Point created by GC Center" -RestorePointType MODIFY_SETTINGS -ErrorAction SilentlyContinue\n`;
        psScript += `Log-Progress "CTTWEAK_PROGRESS:2|Restore Point Created";\n`;
      }

      if (tweak.service && tweak.service.length > 0) {
        for (const svc of tweak.service) {
          stepCounter++;
          const progress = Math.round((stepCounter / totalSteps) * 100);
          psScript += `Log-Progress "CTTWEAK_PROGRESS:${progress}|Service: ${svc.Name}";\n`;
          psScript += `Set-Service -Name "${svc.Name}" -StartupType ${svc.StartupType} -ErrorAction SilentlyContinue;\n`;
          if (svc.StartupType === 'Disable' || svc.StartupType === 'Disabled') {
            psScript += `Stop-Service -Name "${svc.Name}" -Force -ErrorAction SilentlyContinue;\n`;
          }
        }
      }

      if (tweak.registry && tweak.registry.length > 0) {
        for (const reg of tweak.registry) {
          stepCounter++;
          const progress = Math.round((stepCounter / totalSteps) * 100);
          const typeMap = { 'DWord': 'DWord', 'String': 'String', 'QWord': 'QWord', 'Binary': 'Binary' };
          const regType = typeMap[reg.Type] || 'String';
          const safeValue = reg.Type === 'DWord' || reg.Type === 'QWord' ? reg.Value : `"${reg.Value}"`;
          
          psScript += `Log-Progress "CTTWEAK_PROGRESS:${progress}|Registry: ${reg.Name}";\n`;
          psScript += `
if (-not (Test-Path -Path "${reg.Path}")) {
  New-Item -Path "${reg.Path}" -Force | Out-Null
}
Set-ItemProperty -Path "${reg.Path}" -Name "${reg.Name}" -Value ${safeValue} -Type ${regType} -Force -ErrorAction SilentlyContinue
`;
        }
      }

      if (tweak.InvokeScript && tweak.InvokeScript.length > 0) {
        stepCounter++;
        const progress = Math.round((stepCounter / totalSteps) * 100);
        psScript += `Log-Progress "CTTWEAK_PROGRESS:${progress}|Running Scripts...";\n`;
        psScript += tweak.InvokeScript.join('\n') + '\n';
      }

      psScript += `Log-Progress "CTTWEAK_PROGRESS:100|Done!";\n`;

      fs.writeFileSync(tmpPath, psScript, 'utf8');

      return new Promise((resolve) => {
        let lastReadPos = 0;
        let resolved = false;
        const POLL_TIMEOUT = 5 * 60 * 1000; // 5 minutes max

        const finish = (result) => {
          if (resolved) return;
          resolved = true;
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(result);
        };

        async function pollLog() {
          try {
            const content = await fsp.readFile(logPath, 'utf8');
            if (content.length > lastReadPos) {
              const newContent = content.substring(lastReadPos);
              const lastNewlineIndex = newContent.lastIndexOf('\n');
              if (lastNewlineIndex !== -1) {
                const completeChunks = newContent.substring(0, lastNewlineIndex);
                lastReadPos += lastNewlineIndex + 1;
                const lines = completeChunks.split('\n');
                lines.forEach(line => {
                  const match = line.match(/CTTWEAK_PROGRESS:(\d+)\|(.+)/);
                  if (match) {
                    const state = {
                      id: tweakId,
                      progress: parseInt(match[1]),
                      line: match[2].trim(),
                      status: 'running'
                    };
                    repairOverlay.pushProgress(state);
                    sendTweakProgress(state);
                  }
                });
              }
            }
          } catch {}
        }

        const interval = setInterval(pollLog, 250);

        const timeout = setTimeout(() => {
          if (child && !child.killed) child.kill();
          const state = { id: tweakId, progress: 100, status: 'error', line: 'Tweak timed out after 5 minutes' };
          repairOverlay.pushProgress(state);
          sendTweakProgress(state);
          finish({ success: false, message: 'Tweak timed out after 5 minutes' });
        }, POLL_TIMEOUT);

        const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPath], { windowsHide: true });
        
        child.on('close', async (code) => {
          // Final flush of remaining log content
          try {
            const content = await fsp.readFile(logPath, 'utf8');
            if (content.length > lastReadPos) {
              const completeChunks = content.substring(lastReadPos);
              const lines = completeChunks.split('\n');
              lines.forEach(line => {
                const match = line.match(/CTTWEAK_PROGRESS:(\d+)\|(.+)/);
                if (match) {
                  const state = { id: tweakId, progress: parseInt(match[1]), line: match[2].trim(), status: 'running' };
                  repairOverlay.pushProgress(state);
                  sendTweakProgress(state);
                }
              });
            }
          } catch (e) {}

          try { await fsp.unlink(tmpPath); } catch {}
          try { await fsp.unlink(logPath); } catch {}
          
          if (code === 0) {
            const state = { id: tweakId, progress: 100, status: 'done', line: `${tweak.Content} Applied Successfully!` };
            repairOverlay.pushProgress(state);
            sendTweakProgress(state);
            finish({ success: true, message: `${tweak.Content} Applied!` });
          } else {
            const state = { id: tweakId, progress: 100, status: 'error', line: `Tweak execution returned error code ${code}` };
            repairOverlay.pushProgress(state);
            sendTweakProgress(state);
            finish({ success: false, message: `Failed to apply tweak: script exited with code ${code}` });
          }
        });

        child.on('error', (err) => {
          fsp.unlink(tmpPath).catch(() => {});
          fsp.unlink(logPath).catch(() => {});
          const state = { id: tweakId, progress: 100, status: 'error', line: `Spawn error: ${err.message}` };
          repairOverlay.pushProgress(state);
          sendTweakProgress(state);
          finish({ success: false, message: `Failed to spawn tweak script: ${err.message}` });
        });
      });
    });
  });

  return Object.keys(ctTweaks).map(key => ({
    id: key, // e.g. WPFTweaksLocation
    title: ctTweaks[key].Content,
    description: ctTweaks[key].Description
  }));
}

module.exports = { registerCTTweaks };

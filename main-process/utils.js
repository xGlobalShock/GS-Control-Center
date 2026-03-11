const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

let _psTempCounter = 0;
function runPSScript(script, timeoutMs = 8000) {
  const tmpFile = path.join(os.tmpdir(), `gs_ps_${process.pid}_${++_psTempCounter}.ps1`);
  const wrappedScript = '$ErrorActionPreference = "SilentlyContinue"\n' + script + '\nexit 0';
  fs.writeFileSync(tmpFile, wrappedScript, 'utf8');
  return execFileAsync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
    { timeout: timeoutMs, windowsHide: true }
  ).then(r => {
    try { fs.unlinkSync(tmpFile); } catch { }
    return r.stdout.trim();
  }).catch(err => {
    try { fs.unlinkSync(tmpFile); } catch { }
    const stderr = (err.stderr || '').trim();
    const killed = err.killed ? ' (TIMEOUT)' : '';
    console.warn(`[runPSScript] PS error${killed}:`, err.message?.substring(0, 150), stderr ? `| stderr: ${stderr.substring(0, 200)}` : '');
    if (err.stdout) return err.stdout.trim();
    return '';
  });
}

function isPermissionError(error) {
  if (!error || !error.message) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('access is denied') ||
    msg.includes('permission denied') ||
    msg.includes('requires elevation') ||
    msg.includes('administrator') ||
    msg.includes('privilege') ||
    msg.includes('command failed') ||
    msg.includes('cannot remove item') ||
    msg.includes('unauthorized');
}

module.exports = { execAsync, execFileAsync, runPSScript, isPermissionError };

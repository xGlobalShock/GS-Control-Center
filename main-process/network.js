/**
 * Network & Video Settings Presets Module
 */

const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');


const pingCache = new Map();
const pendingPings = new Map();
const PING_CACHE_MS = 900;

const isWin = process.platform === 'win32';
const pingArgsBase = isWin ? ['-n', '1', '-w', '2000'] : ['-c', '1', '-W', '2'];

async function execPing(host) {
  return new Promise((resolve) => {
    const args = [...pingArgsBase, host];
    execFile('ping', args, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({ success: false, time: null, error: err ? err.message : 'no output' });
      }

      const output = stdout.toString();
      // Use language-agnostic regex for ping response time (ms or Cyrillic мс)
      // Matches: "=14ms", "<1 ms", "=14 мс", etc.
      let match = output.match(/[=<]\s*([\d.]+)\s*(?:ms|мс)/i);

      if (match) {
        const ms = Math.round(parseFloat(match[1]));
        return resolve({ success: true, time: ms });
      }

      return resolve({ success: false, time: null, error: 'parse error' });
    });
  });
}

async function checkHostLatency(host) {
  const now = Date.now();
  const cache = pingCache.get(host);
  if (cache && now - cache.ts < PING_CACHE_MS) {
    return cache.value;
  }

  if (pendingPings.has(host)) {
    return pendingPings.get(host);
  }

  const promise = (async () => {
    try {
      const value = await execPing(host);
      pingCache.set(host, { ts: Date.now(), value });
      return value;
    } catch (err) {
      const value = { success: false, time: null, error: err?.message || 'unreachable' };
      pingCache.set(host, { ts: Date.now(), value });
      return value;
    } finally {
      pendingPings.delete(host);
    }
  })();

  pendingPings.set(host, promise);
  return promise;
}

/**
 * Parse a single line from tracert/traceroute output into a hop object.
 * Windows tracert line format: "  3    12 ms    11 ms    12 ms  192.168.1.1"
 * Or timeout:                  "  4     *        *        *     Request timed out."
 */
function parseTracertLine(line) {
  if (!line || !line.trim()) return null;

  // Match hop number at start of line: "  3   ..."
  const hopMatch = line.match(/^\s*(\d{1,2})\s+/);
  if (!hopMatch) return null;

  const hopNum = parseInt(hopMatch[1], 10);
  if (hopNum < 1 || hopNum > 64) return null;

  // Extract up to 3 RTT values (ms or *)
  const rttPattern = /(\d+)\s*(?:ms|мс)|\*/g;
  const rtts = [];
  let m;
  while ((m = rttPattern.exec(line)) !== null) {
    rtts.push(m[1] ? parseInt(m[1], 10) : null);
  }

  // Extract IP address (IPv4 or IPv6 — last occurrence on the line)
  const ipMatch = line.match(/((?:\d{1,3}\.){3}\d{1,3}|(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4})\s*$/);
  const ip = ipMatch ? ipMatch[1] : null;

  // Calculate average RTT from successful pings
  const validRtts = rtts.filter(r => r !== null);
  const avgRtt = validRtts.length > 0
    ? Math.round(validRtts.reduce((a, b) => a + b, 0) / validRtts.length)
    : null;

  const timedOut = validRtts.length === 0;

  return {
    hop: hopNum,
    ip,
    rtts,
    avg: avgRtt,
    timedOut,
  };
}

function registerIPC() {

  ipcMain.handle('network:ping', async (event, host) => {
    if (typeof host !== 'string' || !host.trim()) {
      return { success: false, error: 'invalid host' };
    }
    try {
      return await checkHostLatency(host);
    } catch (err) {
      return { success: false, error: err?.message || 'failed' };
    }
  });

  /* ── Traceroute (streaming) ──────────────────────────────────────────── */
  ipcMain.handle('network:traceroute', async (event, host) => {
    if (typeof host !== 'string' || !host.trim()) {
      return { success: false, error: 'invalid host' };
    }

    // Sanitize: only allow hostnames and IPs
    const sanitized = host.trim();
    if (!/^[\w.\-:]+$/.test(sanitized)) {
      return { success: false, error: 'invalid host format' };
    }

    const sender = event.sender;
    const cmd = isWin ? 'tracert' : 'traceroute';
    const args = isWin ? ['-d', '-w', '3000', '-h', '30', sanitized] : ['-n', '-w', '3', '-m', '30', sanitized];

    return new Promise((resolve) => {
      const hops = [];
      let rawBuffer = '';

      const proc = spawn(cmd, args, { windowsHide: true, timeout: 90000 });

      proc.stdout.on('data', (data) => {
        rawBuffer += data.toString();
        const lines = rawBuffer.split(/\r?\n/);
        rawBuffer = lines.pop() || ''; // keep incomplete last line in buffer

        for (const line of lines) {
          const hop = parseTracertLine(line);
          if (hop) {
            hops.push(hop);
            try { sender.send('network:traceroute-hop', hop); } catch {}
          }
        }
      });

      proc.stderr.on('data', () => {});

      proc.on('close', () => {
        // Parse any remaining buffered line
        if (rawBuffer.trim()) {
          const hop = parseTracertLine(rawBuffer);
          if (hop) {
            hops.push(hop);
            try { sender.send('network:traceroute-hop', hop); } catch {}
          }
        }
        try { sender.send('network:traceroute-done', { hops }); } catch {}
        resolve({ success: true, hops });
      });

      proc.on('error', (err) => {
        try { sender.send('network:traceroute-done', { hops, error: err.message }); } catch {}
        resolve({ success: false, hops, error: err.message });
      });
    });
  });

  ipcMain.handle('preset:save-video-settings', async (event, filename, content) => {
    try {
      const dir = path.join(app.getPath('userData'), 'videosettings-presets');
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

}

module.exports = { registerIPC };

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, '..', 'dist');
const oldName = path.join(distDir, 'win-unpacked');
const newName = path.join(distDir, 'GS Center');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function removeWithRetry(target, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      return true;
    } catch (e) {
      if (i < retries - 1) {
        console.log(`  Retry ${i + 1}/${retries} after 2s (${e.code || e.message})...`);
        await sleep(2000);
      } else {
        try {
          console.log('  Trying rd /s /q fallback...');
          execSync(`rd /s /q "${target}"`, { stdio: 'pipe', windowsHide: true });
          return true;
        } catch {
          return false;
        }
      }
    }
  }
  return false;
}

(async () => {
  try {
    if (!fs.existsSync(oldName)) {
      console.log(`No 'dist/win-unpacked' folder found, skipping rename.`);
      return;
    }

    if (fs.existsSync(newName)) {
      console.log('Destination already exists, removing it first...');
      const removed = await removeWithRetry(newName);
      if (!removed) {
        console.warn(`Could not remove 'dist/GS Center' — build output is in 'dist/win-unpacked' instead.`);
        return;
      }
    }

    fs.renameSync(oldName, newName);
    console.log(`Renamed 'dist/win-unpacked' -> 'dist/GS Center'`);
  } catch (err) {
    console.warn('Rename skipped:', err.message || err);
    console.warn('Build output is available at: dist/win-unpacked');
  }
})();
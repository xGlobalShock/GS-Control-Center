#!/usr/bin/env node

const { spawn } = require('child_process');

console.log(`[dev-launcher] Starting at ${new Date().toLocaleTimeString()}`);
console.log('[dev-launcher] Launching React dev server and Electron...');

const cmd = 'cross-env NODE_OPTIONS=--no-deprecation NODE_MAX_OLD_SPACE_SIZE=4096 concurrently --silent --names "REACT,ELECTRON" --prefix-colors "cyan.bold,magenta.bold" --kill-others-on-fail "cross-env BROWSER=none npm --silent run react-start" "wait-on http://localhost:3000 --timeout 120000 && electron ."';

// Spawn the process with inherited stdio to show output directly
const proc = spawn(cmd, {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname,
  detached: false
});

// Handle graceful shutdown
const handleShutdown = (signal) => {
  console.log(`[dev-launcher] Received ${signal}, shutting down gracefully...`);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

proc.on('exit', (code) => {
  console.log(`[dev-launcher] Exited at ${new Date().toLocaleTimeString()} (code: ${code})`);
  process.exit(0);
});

proc.on('error', (err) => {
  console.error('[dev-launcher] Failed to start dev environment:', err);
  process.exit(1);
});

// Prevent the parent process from keeping the terminal alive if child exits
process.on('exit', () => {
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch (e) {
      // Process already terminated
    }
  }
});

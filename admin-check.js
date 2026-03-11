const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// For development and production: ensure app runs with admin privileges
if (process.platform === 'win32') {
  const isAdmin = require('is-admin');
  
  // Check if running as admin
  isAdmin().then(admin => {
    if (!admin && !process.env.ELECTRON_SQUIRREL_FIRSTRUN) {
      const { execFile } = require('child_process');
      
      // Re-launch with admin privileges
      execFile(process.execPath, process.argv.slice(1), {
        shell: true
      });
      
      // Exit the current process
      process.exit(0);
    }
  });
}

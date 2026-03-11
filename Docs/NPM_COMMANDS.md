# 🚀 NPM Commands Reference

## Available Scripts

Run these commands from the project root directory: `C:\Users\xSGCo\Desktop\Client`

---

## 🎮 Main Commands (Use These)

### `npm run client`
**Launches the Electron desktop application (Recommended)**
```bash
npm run client
```
- Starts desktop client without opening browser
- Full Electron window with native OS integration
- Best for actual use and gaming
- App runs independently from terminal
- **Use this for:** Daily gaming, testing, deployment

---

### `npm run dev`
**Development mode with hot reload for both React and Electron**
```bash
npm run dev
```
- Starts React dev server on http://localhost:3000
- Launches Electron with dev tools enabled
- Hot reload on file changes
- Console shows live updates
- **Use this for:** Development, debugging, making changes

---

### `npm run build`
**Create production-ready Electron app**
```bash
npm run build
```
- Builds React for production
- Creates Electron executable (dist/ folder)
- Optimized and minified code
- Ready for distribution
- **Use this for:** Creating final release, sharing with others

---

## 🔧 Development Commands

### `npm start`
**Start React development server only**
```bash
npm start
```
- Opens React app in browser
- Auto-refresh on code changes
- Good for UI development
- Requires manual Electron launch
- **Use this for:** React UI development

---

### `npm run react-build`
**Build React for production only (no Electron)**
```bash
npm run react-build
```
- Creates optimized React bundle
- Output in build/ folder
- Does NOT create Electron app
- Useful for web deployment
- **Use this for:** Web version, testing builds

---

### `npm run electron-build`
**Build Electron app with electron-builder**
```bash
npm run electron-build
```
- Uses react-build output
- Creates .exe installer
- Requires winCodeSign certificates (may fail on first run)
- Creates installers and updates
- **Use this for:** Creating installer, distribution

---

## 📦 Package Management

### `npm install`
**Install all dependencies**
```bash
npm install
```
- Installs 1553 packages
- Creates node_modules folder
- Sets up all development tools
- **Run once after** cloning or if dependencies changed

---

### `npm list`
**View installed packages**
```bash
npm list
```
- Shows dependency tree
- Displays version numbers
- Useful for troubleshooting

---

### `npm outdated`
**Check for outdated packages**
```bash
npm outdated
```
- Lists packages with newer versions
- Shows current, wanted, and latest versions
- Good for periodic maintenance

---

## 🔍 Utility Commands

### `npm test`
**Run test suite (if configured)**
```bash
npm test
```
- Runs Jest tests
- Watches for file changes
- Shows coverage reports
- **Note:** Tests not currently configured

---

### `npm run eject`
**Eject Create React App configuration**
```bash
npm run eject
```
- ⚠️ WARNING: This is permanent!
- Exposes webpack configuration
- Not recommended unless necessary
- Only do this if you know why you need it

---

## 🧹 Cleanup & Troubleshooting

### Clear Cache and Reinstall
If you're having issues:
```bash
# Windows Command Prompt:
rmdir /s /q node_modules
del package-lock.json
npm install
npm run client
```

Or in PowerShell:
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
npm run client
```

---

## 📋 Quick Command Cheatsheet

| Command | Purpose | Use When |
|---------|---------|----------|
| `npm run client` | Launch desktop app | Using the application |
| `npm run dev` | Development mode | Writing/debugging code |
| `npm run build` | Production build | Creating release |
| `npm start` | React dev server | UI development only |
| `npm run react-build` | React build only | Web deployment |
| `npm install` | Install deps | First setup, deps changed |
| `npm test` | Run tests | Testing code |
| `npm list` | Show packages | Check installations |
| `npm outdated` | Check updates | Maintenance |

---

## 🎯 Recommended Workflow

### First Time Setup
```bash
npm install                    # Install all dependencies
npm run client                 # Launch the app
```

### During Development
```bash
# Terminal 1:
npm run dev                    # Starts dev mode with hot reload

# Terminal 2 (optional):
# Edit files and watch hot reload in Electron window
```

### Before Release
```bash
npm run build                  # Create production build
# Test the built application
npm run client                 # Verify it works
```

### Troubleshooting
```bash
# If something breaks:
npm install                    # Reinstall clean dependencies
npm run client                 # Try again

# If that doesn't work:
rm -r node_modules package-lock.json   # Remove all packages
npm install                    # Fresh install
npm run client                 # Launch
```

---

## 🔐 Environment Variables

Currently used environment variables:
```
REACT_APP_VERSION=1.0.0
REACT_APP_NAME=GS Control Center
BROWSER=none                   # Prevents browser opening with npm start
ELECTRON_START_URL=http://localhost:3000  # Dev only
```

These are configured in:
- `package.json` (scripts section)
- `.env` file (if created)
- `main.js` (for Electron config)

---

## 📊 Build Output Locations

### After `npm run client`
- **Electron App**: Runs directly in memory
- **No output files** created in working directory
- **App window**: Native OS window

### After `npm run react-build`
- **Output folder**: `build/`
- **Files**: HTML, CSS, JS bundles, assets
- **Size**: ~200 KB gzipped

### After `npm run build` / `npm run electron-build`
- **Output folder**: `dist/`
- **Files**: .exe installer, update files
- **Size**: ~150 MB (includes Chromium)

---

## 🐛 Common Issues & Solutions

### "npm: command not found"
**Solution**: Install Node.js from nodejs.org

### "Module not found" errors
**Solution**: 
```bash
npm install                    # Reinstall packages
npm run client                 # Try again
```

### Port 3000 already in use
**Solution**: 
```bash
npm run client                 # Use Electron instead
# Or kill process on port 3000
netstat -ano | findstr :3000   # Find process ID
taskkill /PID <id> /F         # Kill it
```

### Build fails with signing errors
**Solution**: This is normal on first build
```bash
# Just use npm run client or npm run dev
# Signing is only needed for actual distribution
```

### App won't launch
**Solution**:
```bash
npm install                    # Clean install
npm run client                 # Launch again
# Or run as administrator if admin required
```

---

## 📞 Support

For issues with npm commands:
1. Check Node.js is installed: `node --version`
2. Check npm is updated: `npm --version`
3. Try reinstalling: `npm install`
4. Clear cache: `npm cache clean --force`
5. Restart terminal/computer

---

## 🔗 Links

- **Node.js**: https://nodejs.org/
- **npm**: https://www.npmjs.com/
- **Electron**: https://www.electronjs.org/
- **React**: https://react.dev/
- **Documentation**: See FEATURE_DOCUMENTATION.md and QUICK_START.md

---

**Happy optimizing!** 🎮⚡

If you need to launch the app:
```bash
npm run client
```

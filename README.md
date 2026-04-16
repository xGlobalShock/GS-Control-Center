# GS Center

**Set up your gaming or streaming PC in minutes — not hours.**

**GS Center** is a powerful desktop utility designed for **gamers, streamers, and PC enthusiasts**. It helps you quickly configure fresh Windows installations, improve performance, monitor system health, and troubleshoot issues — all from a single application.

Whether you're setting up a **new gaming rig**, optimizing your **streaming setup**, or simply keeping your PC running smoothly, GS Center provides the tools you need.

**Real-time monitoring • Smart optimizations • One-click setup • No bloat**

![Status](https://img.shields.io/badge/Status-BETA-orange)
![Version](https://img.shields.io/badge/Version-2.1.6-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64-blue)
![Electron](https://img.shields.io/badge/Electron-27-blueviolet)
![React](https://img.shields.io/badge/React-18-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

---

# Download

Download the latest installer from the newest release:

➡️ **[Download Latest Release](https://github.com/xGlobalShock/GS-Control-Center/releases/latest)**

<img width="1578" height="951" alt="image" src="https://github.com/user-attachments/assets/bbe5bd93-24cf-4942-8718-f19e751ab52e" />

---

# Installation

1. Download the latest installer from **[GitHub Releases](https://github.com/xGlobalShock/GS-Control-Center/releases)**
2. Run: `GS-Center-Setup-x.x.x.exe`

---

# Features

## Dashboard & Live Metrics

Monitor your system in real time with a clean, easy-to-read dashboard powered by a native C# sidecar (GCMonitor.exe / LibreHardwareMonitor).

Track:

- CPU usage, per-core load, clock speed, power draw & temperature
- GPU load, VRAM usage, clock, fan speed & temperature
- RAM usage, cached memory, standby/modified pools, top processes by RAM
- Disk activity (read/write speeds, health/lifespan, temperature)
- Network upload/download speeds, latency & packet loss
- Process count and system uptime
- **Health Score** — 0–100 composite score from CPU temp, usage, RAM pressure, disk free space, GPU temp, network latency & disk health
- **Advisor Panel** — AI-driven system insights (critical/warning/good) with hardware upgrade recommendations

---

## PC Tweaks (Performance)

Apply **17 registry-level performance tweaks** with one click, organized in 7 categories:

| Category | Tweaks |
|----------|--------|
| **CPU** | IRQ Priority, Win32 Priority Separation |
| **GPU** | Hardware-Accelerated GPU Scheduling, TDR Level |
| **Memory** | Disable Memory Compression, Large System Cache |
| **Network** | Network Interrupt Priority, Disable Network Throttling |
| **Display** | Disable Fullscreen Optimizations, DWM Overlay Test Mode, FSE Behavior |
| **Game DVR** | Disable Game DVR, App Capture, GDRV Policy |
| **Hardware** | Disable USB Selective Suspend, Game Priority |

- Individual toggle or batch apply
- System restore point creation before applying (Pro)
- One-click reset per tweak

---

## System Repair

Diagnose and repair Windows integrity issues without leaving the app.

- **SFC** (System File Checker) — real-time progress bar
- **DISM** (Windows Image Repair) — live fill-bar progress
- **ChkDsk** (Disk Check) — live output
- Floating repair overlay — minimized always-on-top window shows progress during long repairs

---

## Overlay HUD

A frameless, always-on-top gaming overlay that displays real-time system metrics without interrupting your game.

Metrics: FPS, CPU %, GPU %, CPU temp, GPU temp, RAM %, latency, packet loss, network speed.

Customization:

- Accent color picker (8 presets)
- Font style selector
- Opacity slider
- Screen position (top-left, top-right, bottom-left, bottom-right)
- Per-metric sensor toggles
- Global hotkey: `Ctrl+Shift+F`

---

## Cleanup Toolkit (Cleaner)

Remove unnecessary files and reclaim disk space. **30+ cleaners** across 6 categories:

- **Windows** — Temp files, Windows Update cache, DNS cache, RAM cache, Recycle Bin, thumbnails, logs, crash dumps, error reports, delivery optimization, recent files
- **Games** — Shader caches for 11 games: Apex Legends, Forza Horizon, Call of Duty, CS2, Fortnite, League of Legends, Overwatch, Rainbow Six Siege, Rocket League, Valorant
- **NVIDIA** — Driver cache (DXCache/GLCache)
- **Essential Tweaks** — Windows preference toggles (registry, services, scripts)
- **Repair** — SFC, DISM, ChkDsk (integrated repair panel)
- **Preferences** — Start Menu layout revert

Batch clean with live progress tracking per task.

---

## Games Manager (Game Library)

Built-in support for popular competitive games:

- Apex Legends, Valorant, CS2, Fortnite, League of Legends, Rocket League, Overwatch, Call of Duty

Features:

- Pro-player game profile editor (resolution, graphics, launch options)
- Per-game config file read/write
- Hardware vs game requirements comparison with FPS prediction
- Display resolution builder (16:9, 16:10, 4:3 + custom)

---

## Network Diagnostics

Diagnose and monitor your internet connection.

- **Ping tests** to 10 regional gaming servers (NA East/West, EU, Asia, Middle East, Oceania)
- **Speed tests** via Fast.com, Ookla Speedtest, testmy.net (isolated webview)
- Real-time latency display with color-coded quality indicators

---

## OBS Presets (Stream)

Instantly deploy stream-ready OBS configurations.

- Pre-built scenes: Gaming, Starting Soon, BRB, Ending
- Optimized game capture, video/audio settings
- Twitch-optimized output configuration
- One-click deploy + auto-launch OBS

---

## Software Updater (Pro)

Scan and manage installed software via winget.

- Detect outdated applications
- Update all at once or select individual packages
- Per-package progress tracking (preparing → downloading → verifying → installing → done)
- Cancellation support

---

## App Installer / Uninstaller

### Installer
Install essential applications directly from GS Center.

- **40+ curated applications** via winget
- Categories: Browsers, Communications, Gaming, Gaming Tools, Streaming & Audio, Development, Utilities, Media
- One-click install with progress tracking
- Bulk installation support

### Uninstaller
Remove installed applications with deep leftover cleaning.

- Detects apps from registry, WMI & AppX packages
- Leftover scan: orphaned files, folders, registry keys, services, scheduled tasks
- 3 scan modes: Safe, Moderate, Advanced
- Pre/post-uninstall snapshots for orphan detection

---

## Windows Debloat (Pro)

Remove **100+ pre-installed Windows bloatware apps**.

- Sources: AppX packages, Windows Capabilities, Windows Features
- Batch removal with per-item progress
- Reinstallation support for compatible packages
- Protected system apps excluded

---

## Startup Manager

Control which applications launch at Windows startup.

- Scans: User registry, Machine registry, User/Common Startup folders
- Enable/disable startup items
- Protected system entries (Windows Defender, Security Health)
- Running process status sync
- Sort/search/filter (enabled, disabled, running)

---

## Service Optimizer (Pro)

Optimize **60+ Windows services** across 10 categories.

Categories: Xbox, Telemetry, Remote Access, Media, Hyper-V, Networking, Security, System, Hardware, Misc.

- 3 optimization modes: Safe (low-risk), Balanced (low+medium), Aggressive (all)
- Risk level indicators (Low, Medium, High)
- Backup/restore per service
- Reset to Windows defaults

---

## Space Analyzer (Pro)

Analyze disk usage with recursive directory scanning.

- Drive selector with capacity/free display
- Context menu for file deletion/copy
- LRU caching for scan results
- Protected system paths excluded

---

## Resolution Manager

Manage display resolutions and refresh rates.

- Lists active displays with adapter info, current resolution & refresh rate
- Enumerate all supported resolution modes per display
- Apply custom resolutions via native C# ResolutionHelper

---

## Settings

Customize the application experience.

- **Startup**: Auto-cleanup on launch, launch on Windows start
- **Appearance**: Light rays color (11 presets), app background gradient (12 presets), font family & size
- **Overlay HUD**: FPS visibility, position, opacity, color, font, sensor toggles
- **System**: GPU acceleration toggle, minimize-to-tray, check for updates
- **About**: Version, changelog

---

# Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS 3, Framer Motion |
| Desktop | Electron 27 |
| Charts | Recharts |
| Icons | Lucide React |
| WebGL | OGL (light ray effects) |
| Hardware Monitor | Native C# sidecar (GCMonitor.exe, LibreHardwareMonitor) |
| Auth & Database | Supabase (Discord/Twitch OAuth) |
| Package Manager | winget (app install/update/uninstall) |
| Payments | PayPal |
| Auto-Updates | electron-updater |

---

# Who It's For

## Gamers

- Optimize performance with 17 registry tweaks
- Monitor system stats in real time with Overlay HUD
- Manage game configurations and compare hardware
- Diagnose network issues with regional ping tests

## Streamers

- Deploy OBS presets instantly
- Monitor system health while streaming
- Maintain stable network performance
- Prevent stutters with automated cleanup

## PC Enthusiasts & Fresh Windows Installs

- Set up a complete Windows environment quickly with 40+ app installer
- Debloat Windows in one click
- Optimize 60+ services
- Manage startup items
- Keep software up to date

---

# System Requirements

- Windows 10/11 (x64)
- .NET 8.0 Runtime (for GCMonitor sidecar)
- Administrator privileges (for registry tweaks, service management, system repair)
- Internet connection (for auth, updates, speed tests)

---

# Development

```bash
# Install dependencies
npm install

# Development (hot reload + Electron)
npm run dev

# Production React build
npm run react-build

# Desktop launch (recommended)
npm run client

# Package Windows installer
npm run electron-build

# Build native hardware monitor
npm run build:monitor
```

---

# Project Structure

```
GC Center/
├── electron/           # Electron main process entry points
│   ├── main.js         # Main process (window, tray, IPC registration)
│   ├── admin-check.js  # UAC elevation detection
│   ├── dev-launcher.js # Dev mode launcher
│   └── launcher.js     # Production launcher
├── main-process/       # IPC handler modules (20+ files)
│   ├── tweaks.js       # 17 registry performance tweaks
│   ├── cleaners.js     # 30+ cache/file cleaners
│   ├── hardwareMonitor.js  # GCMonitor sidecar management
│   ├── hardwareInfo.js     # Static hardware data collection
│   ├── healthScore.js      # System health score calculation
│   ├── advisor.js          # AI-driven system insights
│   ├── overlay.js          # FPS HUD overlay window
│   ├── gameProfiles.js     # Game config read/write
│   ├── appInstaller.js     # Winget app installation
│   ├── appUninstaller.js   # App removal + leftover cleanup
│   ├── windowsDebloat.js   # AppX bloatware removal
│   ├── startup.js          # Startup item management
│   ├── serviceTweaks.js    # Windows service optimization
│   ├── softwareUpdates.js  # Winget software updates
│   ├── network.js          # Ping/latency testing
│   ├── obsPresets.js       # OBS config deployment
│   ├── spaceAnalyzer.js    # Disk usage analysis
│   ├── resolutionManager.js # Display resolution control
│   ├── auth.js             # OAuth flow handler
│   ├── paypal.js           # PayPal checkout
│   ├── autoUpdater.js      # App auto-update
│   ├── ctTweaks.js         # Essential Windows tweaks runner
│   ├── ctEssentialTweaks.js # 30+ essential tweak definitions
│   ├── repairOverlay.js    # Floating repair progress window
│   ├── windowManager.js    # Window lifecycle management
│   └── utils.js            # Shared helpers
├── native-monitor/     # C# .NET hardware monitor sidecar
│   ├── Program.cs
│   ├── HardwareInfoCollector.cs
│   └── GCMonitor.csproj
├── src/                # React frontend
│   ├── App.tsx         # Root component, routing, state
│   ├── pages/          # 19 page components
│   ├── components/     # 21 UI components
│   ├── contexts/       # AuthContext, ToastContext
│   ├── hooks/          # useRealtimeHardware
│   ├── data/           # Static data (tweaks, cleaners, games, apps, presets)
│   ├── services/       # OBS preset service
│   ├── utils/          # Settings persistence, hardware comparison
│   ├── styles/         # 37 CSS files (Tailwind + custom)
│   ├── assets/         # Static images/icons
│   └── lib/            # Supabase client config
├── public/             # Electron HTML shells (overlay, splash, repair)
├── scripts/            # Build/utility scripts
├── supabase/           # Database schema
└── V-Config/           # Game configuration templates
```

---

# Future Enhancements

### Planned Features

- [ ] GPU driver management
- [ ] Built-in performance benchmarking
- [ ] Automatic game detection & auto-profiles
- [ ] Advanced process management (priority, affinity)
- [ ] Extended thermal monitoring & fan curves
- [ ] Overlay: custom layout editor & frame-time graph
- [ ] Multi-monitor wallpaper management
- [ ] Audio device quick-switcher for streamers
- [ ] Streamer mode (auto-hide sensitive info)

---

# License

GS Center is released under the **MIT License**.

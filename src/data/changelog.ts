export interface ChangelogEntry {
  version: string;
  date: string;
  highlights?: string;
  changes: {
    type: 'new' | 'improved' | 'fixed';
    text: string;
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: '1.6.7',
    date: '2026-04-02',
    highlights: 'PC Tweaks update with new features and improvements.',
    changes: [
      { type: 'new', text: 'Added two PC tweaks and integrated them into the Performance page.' },
      { type: 'improved', text: 'Clarified the TdrLevel description in the UI for clearer guidance.' },
      { type: 'improved', text: 'Updated the Memory Compression tweak to more accurately reflect its function and benefits.' },
    ],
  },
  {
    version: '1.6.6',
    date: '2026-04-02',
    highlights: 'Overlay & Hardware Acceleration updates with new features, UI improvements, and critical fixes.',
    changes: [
      // New Features
      { type: 'new', text: 'Overlay: Visible Metrics and Font Style redesigned as toggle switches and placed side by side in a twin-column layout.' },
      { type: 'new', text: 'Overlay: FPS Overlay enable toggle moved into the section panel header, freeing the body for configuration controls.' },
      { type: 'new', text: 'Settings: Hardware Acceleration toggle added to the GPU card with full on/off support and per-boot persistence.' },
      { type: 'new', text: 'Settings: toggling HW Acceleration shows a popup with Restart Now (saves + relaunches) and Dismiss (reverts toggle).' },
      { type: 'new', text: 'Settings: Rendering tab removed — Hardware Acceleration card consolidated into the About tab.' },
      { type: 'new', text: 'Settings: Check for Updates button moved inline into the About panel header next to the title.' },

      // Fixes
      { type: 'fixed', text: 'Fixed GPU card incorrectly displaying ACTIVE status when Hardware Acceleration was saved as disabled.' },
      { type: 'fixed', text: 'Fixed Hardware Acceleration being called after module requires — moved to top so it takes effect on boot.' },
      { type: 'fixed', text: 'Fixed SwiftShader (CPU renderer) being forced on all sessions regardless of the acceleration setting.' },
      { type: 'fixed', text: 'Fixed GPU Hardware Acceleration process crashes caused by raw GPU sandbox access on Windows.' },

      // Improvements
      { type: 'improved', text: 'Overlay position bounds corrected — window width to HUD content so the HUD sits flush with screen edges.' },
      { type: 'improved', text: 'Hardware Acceleration disabled mode fully removes the GPU process — app runs 100% on CPU.' },
      { type: 'improved', text: 'HW Acceleration IPC now reads from the settings file on every call.' },
    ],
  },
  {
    version: '1.6.5',
    date: '2026-04-02',
    highlights: 'UI overhaul for Settings and Disk Analyzer, plus performance and bug fixes.',
    changes: [
      // New Features
      { type: 'new', text: 'Settings page fully redesigned with a two-panel layout — vertical nav sidebar and animated content panels.' },
      { type: 'new', text: 'Hardware Acceleration card redesigned with animated scan-line, status pill, and renderer info rows.' },
      { type: 'new', text: 'Added Check for Updates button in Settings → About with live states (Checking, Up to Date, Available).' },

      // Fixes
      { type: 'fixed', text: 'Fixed Disk Space Analyzer showing "Scanning..." and "Loading..." on all metric cards before any scan is started.' },
      { type: 'fixed', text: 'Fixed navigation becoming laggy and unresponsive while Auto Cleanup Toolkit runs on startup.' },

      // Improvements
      { type: 'improved', text: 'Disk Space Analyzer metric cards now show a neutral dash when idle and animated dots during scanning.' },
      { type: 'improved', text: 'Auto-updater background check interval reduced from 4 hours to 30 seconds for near-instant new release detection.' },
    ],
  },
  {
    version: '1.6.4',
    date: '2026-04-02',
    highlights: 'Minor hotfix addressing critical bugs and improving stability.',
    changes: [
      // New Features
      { type: 'new', text: 'Added Clear Delivery Optimization, Clear Quick Access History, and Clear System Temp as dedicated cleaner cards.' },

      // Fixes
      { type: 'fixed', text: 'Fixed Microsoft Edge appearing twice in the Windows Debloat app list.' },
      { type: 'fixed', text: 'Fixed auto-updater freezing after download — app now auto-installs immediately without a manual Install step.' },
      { type: 'fixed', text: 'Fixed potential double quitAndInstall call that could cause update failures.' },
      { type: 'fixed', text: 'Fixed Full Cache Flush modal incorrectly including Quick Access History in its cleanup queue.' },

      // Improvements
      { type: 'improved', text: 'Windows Debloat now loads fresh on demand — removed stale preload cache that caused duplicates.' },
      { type: 'improved', text: 'Auto Cleanup on startup now only runs cleaners visible in the UI, preventing hidden background operations.' },
      { type: 'improved', text: 'autoInstallOnAppQuit enabled as a safety net so updates always apply if the app closes after a download.' },
    ],
  },
  {
    version: '1.6.3',
    date: '2026-04-01',
    highlights: 'Major update with new features, UI/UX improvements, and critical fixes.',
    changes: [
      // New Features
      { type: 'new', text: 'Overlay HUD: frameless, always-on-top overlay with FPS and real-time system metrics (configurable position and hotkey).' },
      { type: 'new', text: 'System Repair Panel: unified interface for SFC, DISM, and ChkDsk with live output and real-time SFC progress.' },
      { type: 'new', text: 'Display Manager revamped with per-display resolution control and refresh-rate (Hz) selection pills.' },
      { type: 'new', text: 'Auto Cleanup Toolkit can now run automatically on app startup with session guard and background execution.' },
      { type: 'new', text: 'PC Tweaks now include top navigation tabs with categorized groups and animated transitions.' },
      { type: 'new', text: 'Language-agnostic HW detection using numeric/CIM-based queries for consistent results across all Windows languages.' },

      // Splash Improvements
      { type: 'new', text: 'Splash screen now uses LHM for HW detection instead of PS WMI queries, dramatically reducing load time.' },
      { type: 'new', text: 'Added smooth progress tickers so the progress bar never stalls or freezes during loading.' },
      { type: 'new', text: 'Added a polished fade-out animation when transitioning to the main window.' },

      // Fixes (Splash + Core)
      { type: 'fixed', text: 'Fixed splash screen freezing at ~20% during hardware info loading.' },
      { type: 'fixed', text: 'Fixed blank gap between splash close and main window appearing.' },
      { type: 'fixed', text: 'Fixed overlay freezing or stopping updates when opening Settings.' },
      { type: 'fixed', text: 'Fixed overlay toggle and hotkey sync issues.' },
      { type: 'fixed', text: 'Fixed Apps Manager uninstall wizard blocking the Install tab.' },
      { type: 'fixed', text: 'Fixed Cached RAM value sometimes missing after updates.' },
      { type: 'fixed', text: 'Fixed packet loss always reporting 0% by implementing rolling measurement.' },
      { type: 'fixed', text: 'Fixed active task indicator visibility below cache overlay gauge.' },

      // Improvements (UI / UX)
      { type: 'improved', text: 'Cache cleanup overlay redesigned with 2-column grid layout — all cleanup items visible without scrolling.' },
      { type: 'improved', text: 'Cache overlay progress ring optimized from 160px to 120px for better space utilization.' },
      { type: 'improved', text: 'Task rows now feature colored left-accent borders for better visual state indication.' },
      { type: 'improved', text: 'Stat boxes enhanced with gradient backgrounds and colored top borders.' },
      { type: 'improved', text: 'Queue item count styled as a professional pill badge.' },
      { type: 'improved', text: 'Proceed button updated with gradient fill and enhanced hover state.' },
      { type: 'improved', text: 'Progress bar now smoothly animates from 0% to 100% without jumps or stalls.' },
      { type: 'improved', text: 'Display Manager redesigned with a Windows-style layout and improved readability.' },
      { type: 'improved', text: 'System Health and System Advisor moved to header with shared toggle behavior.' },
      { type: 'improved', text: 'Toast notifications widened for better readability of longer messages.' },
      { type: 'improved', text: 'System Advisor dropdown repositioned and widened to prevent text clipping.' },

      // Improvements (System / Backend)
      { type: 'improved', text: 'PowerShell execution forced to en-US culture for consistent hardware data parsing.' },
      { type: 'improved', text: 'Replaced localized PerformanceCounter usage with CIM Win32_PerfFormattedData queries.' },
      { type: 'improved', text: 'Improved IPC handling and isolated realtime update failures from UI navigation.' },
      { type: 'improved', text: 'Hardware monitoring and error handling hardened to prevent silent failures.' },
      { type: 'improved', text: 'Latency now preserves last known value and packet loss waits for sampling window.' },
      { type: 'improved', text: 'Cached RAM fallback added when PowerShell method is unavailable.' },

      // Behavior
      { type: 'improved', text: 'Auto Cleanup now runs silently on startup with delay and session-based execution guard.' },
      { type: 'improved', text: 'Overlay realtime updates persist independently of navigation state.' },

      // Performance
      { type: 'improved', text: 'Hardware info now loads in parallel during splash, ensuring System Details are ready on launch.' },
      { type: 'improved', text: 'Startup impact reduced by delaying background tasks and skipping non-critical failures.' },
    ],
  }
];

export default changelog;

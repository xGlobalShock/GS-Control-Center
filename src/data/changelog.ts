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
      { type: 'improved', text: 'System Health and AI Performance Advisor moved to header with shared toggle behavior.' },
      { type: 'improved', text: 'Toast notifications widened for better readability of longer messages.' },
      { type: 'improved', text: 'AI Advisor dropdown repositioned and widened to prevent text clipping.' },

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

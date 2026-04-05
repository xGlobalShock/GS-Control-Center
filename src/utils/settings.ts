// Settings persistence utilities for Phase 5

interface AppSettings {
  autoClean: boolean;
  notifications: boolean;
  autoOptimize: boolean;
  autoUpdate: boolean;
  theme: 'dark' | 'light';
  startupLaunch: boolean;
  cleanupSchedule?: 'daily' | 'weekly' | 'monthly';
  lastCleanup?: string;
  autoCleanupOnStartup?: boolean;
  raysColor?: string;
  accentColor?: string;
  appBgColor?: string;
}

const SETTINGS_KEY = 'pc-controlcenter-settings';
const DEFAULT_SETTINGS: AppSettings = {
  autoClean: true,
  notifications: true,
  autoOptimize: false,
  autoUpdate: true,
  theme: 'dark',
  startupLaunch: true,
  cleanupSchedule: 'weekly',
  autoCleanupOnStartup: false,
  raysColor: '#00C8FF',
  accentColor: '#00C8FF',
  appBgColor: 'radial-gradient(ellipse 70% 60% at 55% 45%, #081a1a 0%, transparent 100%), radial-gradient(ellipse 40% 35% at 30% 30%, rgba(0, 242, 255, 0.025) 0%, transparent 100%), #020606',
};

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    // Emit a window event so UI can react to settings changes
    try {
      if (typeof window !== 'undefined' && typeof (window as any).dispatchEvent === 'function') {
        (window as any).dispatchEvent(new CustomEvent('settings:updated', { detail: settings }));
      }
    } catch (e) {
      // ignore
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

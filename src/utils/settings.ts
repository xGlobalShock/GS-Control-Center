// Settings persistence utilities for Phase 5

interface AppSettings {
  autoClean: boolean;
  notifications: boolean;
  autoOptimize: boolean;
  theme: 'dark' | 'light';
  startupLaunch: boolean;
  cleanupSchedule?: 'daily' | 'weekly' | 'monthly';
  lastCleanup?: string;
}

const SETTINGS_KEY = 'pc-controlcenter-settings';
const DEFAULT_SETTINGS: AppSettings = {
  autoClean: true,
  notifications: true,
  autoOptimize: false,
  theme: 'dark',
  startupLaunch: true,
  cleanupSchedule: 'weekly',
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

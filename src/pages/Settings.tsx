import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import '../styles/Settings.css';
import { loadSettings, saveSettings } from '../utils/settings';
import PageHeader from '../components/PageHeader';
import { Settings as SettingsIcon, Monitor, AlertTriangle, Lock } from 'lucide-react';

const Settings: React.FC = () => {
  const [settings, setSettings] = useState(() => ({
    autoClean: false,
    notifications: false,
    autoOptimize: false,
    autoUpdate: false,
    theme: 'dark',
    startupLaunch: false,
  }));
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [gpuStatus, setGpuStatus] = useState<{ status: string; renderer: string; detail: string } | null>(null);

  useEffect(() => {
    window.electron?.updater?.getVersion().then((v: string) => {
      if (v) setAppVersion(v);
    }).catch(() => {});

    // Fetch GPU rendering status
    (window as any).electron?.gpu?.getStatus().then((s: any) => {
      if (s) setGpuStatus(s);
    }).catch(() => {});

    const unsub = (window as any).electron?.gpu?.onStatusChanged((s: any) => {
      if (s) setGpuStatus(s);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const s = loadSettings();
    setSettings(prev => ({ ...prev, ...s }));

    const onUpdated = (e: Event) => {
      try {
        // @ts-ignore
        const detail = (e as CustomEvent)?.detail || {};
        setSettings(prev => ({ ...prev, ...detail }));
      } catch {}
    };

    window.addEventListener('settings:updated', onUpdated as EventListener);
    return () => window.removeEventListener('settings:updated', onUpdated as EventListener);
  }, []);

  const handleToggle = (key: keyof typeof settings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    saveSettings(updated as any);
  };

  return (
    <motion.div
      className="settings-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <PageHeader icon={<SettingsIcon size={16} />} title="Settings" />

      <div className="settings-sections">
        <div className="settings-section settings-section--locked">
          <div className="settings-lock-overlay">
            <Lock size={22} />
            <span>COMING SOON</span>
          </div>
          <h3 className="section-header">General</h3>
          
          <div className="setting-item">
            <div className="setting-label">
              <span className="label-title">Auto Clean</span>
              <span className="label-description">Automatically clean junk files weekly</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.autoClean}
                onChange={() => handleToggle('autoClean')}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <span className="label-title">Enable Notifications</span>
              <span className="label-description">Receive alerts for system issues</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={() => handleToggle('notifications')}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <span className="label-title">Auto Optimize on Startup</span>
              <span className="label-description">Run optimization when launching games</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.autoOptimize}
                onChange={() => handleToggle('autoOptimize')}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <span className="label-title">Launch on Startup</span>
              <span className="label-description">Start GS Control Center when Windows boots</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.startupLaunch}
                onChange={() => handleToggle('startupLaunch')}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <span className="label-title">Auto Update</span>
              <span className="label-description">Automatically check for new versions</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.autoUpdate}
                onChange={() => handleToggle('autoUpdate')}
              />
              <span className="slider"></span>
            </label>
          </div>


        </div>

        <div className="settings-section">
          <h3 className="section-header">Appearance</h3>
          <div className="setting-item">
            <div className="setting-label">
              <span className="label-title">Theme</span>
              <span className="label-description">Choose your preferred theme</span>
            </div>
            <select
              className="theme-select"
              value={settings.theme}
              onChange={(e) => setSettings(prev => ({ ...prev, theme: e.target.value }))}
            >
              <option value="dark">Dark (Default)</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h3 className="section-header">Rendering</h3>
          <div className="gpu-status-card">
            <div className="gpu-status-row">
              <div className="gpu-status-icon-wrap">
                {gpuStatus?.status === 'crashed'
                  ? <AlertTriangle size={20} className="gpu-icon-crashed" />
                  : <Monitor size={20} className="gpu-icon-active" />
                }
              </div>
              <div className="gpu-status-info">
                <span className="gpu-status-label">Hardware Acceleration</span>
                <span className={`gpu-status-badge ${gpuStatus?.status === 'crashed' ? 'crashed' : 'active'}`}>
                  {gpuStatus?.status === 'crashed' ? 'Crashed' : 'Active'}
                </span>
              </div>
            </div>
            <div className="gpu-status-detail">
              <span className="gpu-detail-key">Renderer</span>
              <span className="gpu-detail-value">{gpuStatus?.renderer || '—'}</span>
            </div>
            <div className="gpu-status-detail">
              <span className="gpu-detail-key">Status</span>
              <span className="gpu-detail-value">{gpuStatus?.detail || 'Checking…'}</span>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3 className="section-header">About</h3>
          <div className="about-info">
            <p><strong>GS Control Center</strong></p>
            <p>Version {appVersion}</p>
            <p>Advanced system optimization tool with gaming focus</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(Settings);

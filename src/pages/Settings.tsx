import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../styles/Settings.css';
import { loadSettings, saveSettings } from '../utils/settings';
import {
  Zap, Palette, Monitor, AlertTriangle, Info,
  RefreshCw, CheckCircle, ArrowUpCircle, ChevronRight, ChevronDown, Check,
} from 'lucide-react';

type Section = 'startup' | 'appearance' | 'about';

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'startup',    label: 'Startup',    icon: <Zap size={15} />,     desc: 'Boot behavior'    },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} />, desc: 'Colors & effects'  },
  { id: 'about',      label: 'About',      icon: <Info size={15} />,    desc: 'Version & updates' },
];

const Settings: React.FC = () => {
  const [activeSection, setActiveSection] = useState<Section>('startup');
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings();
    return {
      autoCleanupOnStartup: saved.autoCleanupOnStartup ?? false,
    };
  });
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [gpuStatus, setGpuStatus] = useState<{ status: string; renderer: string; detail: string } | null>(null);
  const [hwAccelEnabled, setHwAccelEnabled] = useState(true);
  const [showHwAccelPopup, setShowHwAccelPopup] = useState(false);
  const [hwAccelBeforeChange, setHwAccelBeforeChange] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'up-to-date' | 'available'>('idle');
  const [checkVersion, setCheckVersion] = useState('');

  // Appearance state
  const [accentColor, setAccentColor] = useState<string>(() => loadSettings().accentColor ?? '#00C8FF');
  const [raysColor, setRaysColor] = useState<string>(() => loadSettings().raysColor ?? '#00C8FF');
  const [appBgColor, setAppBgColor] = useState<string>(() => loadSettings().appBgColor ?? 'linear-gradient(160deg, #050F1A 0%, #071828 60%, #030D18 100%)');
  const [showAccentDropdown, setShowAccentDropdown] = useState(false);
  const [showRaysDropdown, setShowRaysDropdown] = useState(false);
  const [showBgDropdown, setShowBgDropdown] = useState(false);
  const accentDropdownRef  = useRef<HTMLDivElement>(null);
  const raysDropdownRef    = useRef<HTMLDivElement>(null);
  const bgDropdownRef       = useRef<HTMLDivElement>(null);
  const ipc = (window as any).electron?.ipcRenderer;

  // ─── Accent Colors (global theme) ──────────────────────────────────────────
  const ACCENT_COLORS = [
    { hex: '#00C8FF', label: 'Plasma Cyan'   },
    { hex: '#00E87A', label: 'Ghost Green'   },
    { hex: '#7C45FF', label: 'Neon Violet'   },
    { hex: '#3B82F6', label: 'Electric Blue' },
    { hex: '#FF7820', label: 'Ember Orange'  },
    { hex: '#FF3EB5', label: 'Hot Magenta'   },
    { hex: '#FF1E4A', label: 'Crimson Red'   },
    { hex: '#FFB800', label: 'Solar Gold'    },
    { hex: '#E4E4E7', label: 'Platinum'      },
  ];

  // ─── Curated Light Ray Colors ───────────────────────────────────────────────
  // Each color is tuned to complement one or more of the BG presets below.
  const RAY_COLORS = [
    { hex: 'off',     label: 'Off'           }, // disable light rays
    { hex: '#FFFFFF', label: 'Default'       }, // original white rays
    { hex: '#00C8FF', label: 'Plasma Cyan'   }, // pairs with Cyber Blue
    { hex: '#7C45FF', label: 'Neon Violet'   }, // pairs with Void Purple
    { hex: '#5AAFFF', label: 'Arctic Blue'   }, // pairs with Arctic Haze
    { hex: '#FF7820', label: 'Ember Orange'  }, // pairs with Ember Forge
    { hex: '#00E87A', label: 'Ghost Green'   }, // pairs with Ghost Green
    { hex: '#FF1E4A', label: 'Crimson Red'   }, // pairs with Deep Crimson
    { hex: '#FFB800', label: 'Solar Gold'    }, // pairs with Solar Storm
    { hex: '#FF3EB5', label: 'Hot Magenta'   }, // versatile vivid accent
    { hex: '#C8DCFF', label: 'Moonlight'     }, // soft, low-contrast option
  ];

  // ─── Curated App Background Gradients ────────────────────────────────────────
  // 160-degree diagonal gradients give depth without heavy GPU load.
  const BG_COLORS = [
    { value: 'radial-gradient(ellipse 70% 60% at 55% 45%, #081a1a 0%, transparent 100%), radial-gradient(ellipse 40% 35% at 30% 30%, rgba(var(--accent), 0.025) 0%, transparent 100%), #020606', label: 'Default' },
    { value: 'linear-gradient(160deg, #050F1A 0%, #071828 60%, #030D18 100%)', label: 'Cyber Blue'    },
    { value: 'linear-gradient(160deg, #0D0518 0%, #130720 60%, #090315 100%)', label: 'Void Purple'   },
    { value: 'linear-gradient(160deg, #080808 0%, #101010 60%, #040404 100%)', label: 'Obsidian'      },
    { value: 'linear-gradient(160deg, #120800 0%, #1C0B00 60%, #0A0500 100%)', label: 'Ember Forge'   },
    { value: 'linear-gradient(160deg, #030E06 0%, #061508 60%, #020A04 100%)', label: 'Ghost Green'   },
    { value: 'linear-gradient(160deg, #0F0205 0%, #190408 60%, #0A0203 100%)', label: 'Deep Crimson'  },
    { value: 'linear-gradient(160deg, #050810 0%, #09101E 60%, #040609 100%)', label: 'Arctic Haze'   },
    { value: 'linear-gradient(160deg, #0C0800 0%, #1A1100 60%, #080600 100%)', label: 'Solar Storm'   },
  ];

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

    // Fetch hardware acceleration setting
    (window as any).electron?.gpu?.getHwAccel().then((enabled: boolean) => {
      setHwAccelEnabled(enabled);
    }).catch(() => {});

    // Fetch minimize-to-tray setting
    ipc?.invoke('app:get-minimize-to-tray').then((enabled: boolean) => {
      setMinimizeToTray(!!enabled);
    }).catch(() => {});

    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const s = loadSettings();
    setSettings(prev => ({ ...prev, ...s }));
    if (s.accentColor) setAccentColor(s.accentColor);
    if (s.raysColor)  setRaysColor(s.raysColor);
    if (s.appBgColor) setAppBgColor(s.appBgColor);

    const onUpdated = (e: Event) => {
      try {
        // @ts-ignore
        const detail = (e as CustomEvent)?.detail || {};
        setSettings(prev => ({ ...prev, ...detail }));
        if (detail.accentColor) setAccentColor(detail.accentColor);
        if (detail.raysColor)  setRaysColor(detail.raysColor);
        if (detail.appBgColor) setAppBgColor(detail.appBgColor);
      } catch {}
    };

    window.addEventListener('settings:updated', onUpdated as EventListener);
    return () => window.removeEventListener('settings:updated', onUpdated as EventListener);
  }, []);

  // Close all dropdowns on outside click
  useEffect(() => {
    if (!showAccentDropdown && !showRaysDropdown && !showBgDropdown) return;
    const handle = (e: MouseEvent) => {
      if (accentDropdownRef.current && !accentDropdownRef.current.contains(e.target as Node)) setShowAccentDropdown(false);
      if (raysDropdownRef.current   && !raysDropdownRef.current.contains(e.target as Node))   setShowRaysDropdown(false);
      if (bgDropdownRef.current     && !bgDropdownRef.current.contains(e.target as Node))     setShowBgDropdown(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showAccentDropdown, showRaysDropdown, showBgDropdown]);

  const handleToggle = (key: keyof typeof settings) => {
    const updatedLocal = { ...settings, [key]: !settings[key] };
    setSettings(updatedLocal);
    try {
      const s = loadSettings();
      const merged = { ...s, ...updatedLocal };
      saveSettings(merged as any);
    } catch {}
  };

  const handleCheckUpdate = async () => {
    const updater = window.electron?.updater;
    if (!updater || checkState === 'checking') return;

    setCheckState('checking');

    const finish = (state: 'up-to-date' | 'available' | 'idle', version = '') => {
      setCheckState(state);
      if (version) setCheckVersion(version);
      if (state === 'up-to-date') {
        setTimeout(() => setCheckState('idle'), 3000);
      }
    };

    const timer = setTimeout(() => finish('idle'), 15000);

    try {
      const result = await updater.checkForUpdates();
      clearTimeout(timer);
      if (result?.event === 'available') finish('available', result?.version || '');
      else if (result?.event === 'not-available' || result?.dev) finish('up-to-date');
      else finish('idle');
    } catch {
      clearTimeout(timer);
      finish('idle');
    }
  };

  const handleAccentColor = (color: string) => {
    setAccentColor(color);
    try {
      const s = loadSettings();
      saveSettings({ ...s, accentColor: color });
    } catch {}
  };

  const handleRaysColor = (color: string) => {
    setRaysColor(color);
    try {
      const s = loadSettings();
      saveSettings({ ...s, raysColor: color });
    } catch {}
  };

  const handleBgColor = (value: string) => {
    setAppBgColor(value);
    document.documentElement.style.setProperty('--app-bg', value);
    try {
      const s = loadSettings();
      saveSettings({ ...s, appBgColor: value });
    } catch {}
  };

  return (
    <>
    <motion.div
      className="settings-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <div className="settings-layout">

        {/* ── Left Navigation ── */}
        <nav className="settings-nav">
          <div className="settings-nav-header">
            <span className="settings-nav-title">SETTINGS</span>
          </div>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`settings-nav-item${activeSection === item.id ? ' settings-nav-item--active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="settings-nav-icon">{item.icon}</span>
              <span className="settings-nav-text">
                <span className="settings-nav-label">{item.label}</span>
                <span className="settings-nav-desc">{item.desc}</span>
              </span>
              <ChevronRight size={11} className="settings-nav-arrow" />
            </button>
          ))}
        </nav>

        {/* ── Content Area ── */}
        <div className="settings-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              className="settings-panel"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.12 }}
            >

              {/* STARTUP */}
              {activeSection === 'startup' && (
                <>
                  <div className="panel-header">
                    <span className="panel-header-icon"><Zap size={18} /></span>
                    <div>
                      <h2 className="panel-title">Startup</h2>
                      <p className="panel-subtitle">Configure app launch behavior</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="setting-row">
                      <div className="setting-row-info">
                        <span className="setting-row-title">Auto Cleanup Toolkit</span>
                        <span className="setting-row-desc">Automatically run Windows cache cleanup each time the app launches</span>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!settings.autoCleanupOnStartup}
                          onChange={() => handleToggle('autoCleanupOnStartup')}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                    <div className="setting-row">
                      <div className="setting-row-info">
                        <span className="setting-row-title">Minimize to Tray</span>
                        <span className="setting-row-desc">Minimize or close the window to the system tray instead of quitting</span>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={minimizeToTray}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            setMinimizeToTray(val);
                            try { await ipc?.invoke('app:set-minimize-to-tray', val); } catch {}
                          }}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* APPEARANCE */}
              {activeSection === 'appearance' && (
                <>
                  <div className="panel-header">
                    <span className="panel-header-icon"><Palette size={18} /></span>
                    <div>
                      <h2 className="panel-title">Appearance</h2>
                      <p className="panel-subtitle">Colors, accents and background effects</p>
                    </div>
                  </div>
                  <div className="panel-body">

                    {/* ── Accent Color ── */}
                    <div className="setting-row">
                      <div className="setting-row-info">
                        <span className="setting-row-title">Accent Color</span>
                        <span className="setting-row-desc">Global theme color for cards, charts, borders and highlights</span>
                      </div>
                      <div className="theme-dropdown" ref={accentDropdownRef}>
                        <button
                          className={`theme-dropdown__trigger${showAccentDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                          onClick={() => setShowAccentDropdown(p => !p)}
                          style={{ minWidth: 175 }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 11, height: 11, borderRadius: '50%', background: accentColor, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 6px ${accentColor}` }} />
                            {ACCENT_COLORS.find(c => c.hex === accentColor)?.label ?? 'Custom'}
                          </span>
                          <ChevronDown size={13} className="theme-dropdown__chevron" />
                        </button>
                        {showAccentDropdown && (
                          <div className="theme-dropdown__menu">
                            {ACCENT_COLORS.map(({ hex, label }) => (
                              <button
                                key={hex}
                                className={`theme-dropdown__item${accentColor === hex ? ' theme-dropdown__item--active' : ''}`}
                                onClick={() => { handleAccentColor(hex); setShowAccentDropdown(false); }}
                              >
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: hex, display: 'inline-block', flexShrink: 0 }} />
                                {accentColor === hex && <Check size={12} />}
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Light Rays Color ── */}
                    <div className="setting-row">
                      <div className="setting-row-info">
                        <span className="setting-row-title">Light Rays Color</span>
                        <span className="setting-row-desc">Color of the animated background rays</span>
                      </div>
                      <div className="theme-dropdown" ref={raysDropdownRef}>
                        <button
                          className={`theme-dropdown__trigger${showRaysDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                          onClick={() => setShowRaysDropdown(p => !p)}
                          style={{ minWidth: 175 }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {raysColor === 'off'
                              ? <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ width: 7, height: 1.5, background: 'rgba(255,255,255,0.35)', borderRadius: 1, transform: 'rotate(-45deg)' }} /></span>
                              : <span style={{ width: 11, height: 11, borderRadius: '50%', background: raysColor, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 6px ${raysColor}` }} />}
                            {RAY_COLORS.find(c => c.hex === raysColor)?.label ?? 'Custom'}
                          </span>
                          <ChevronDown size={13} className="theme-dropdown__chevron" />
                        </button>
                        {showRaysDropdown && (
                          <div className="theme-dropdown__menu">
                            {RAY_COLORS.map(({ hex, label }) => (
                              <button
                                key={hex}
                                className={`theme-dropdown__item${raysColor === hex ? ' theme-dropdown__item--active' : ''}`}
                                onClick={() => { handleRaysColor(hex); setShowRaysDropdown(false); }}
                              >
                                {hex === 'off'
                                  ? <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ width: 6, height: 1.5, background: 'rgba(255,255,255,0.35)', borderRadius: 1, transform: 'rotate(-45deg)' }} /></span>
                                  : <span style={{ width: 10, height: 10, borderRadius: '50%', background: hex, display: 'inline-block', flexShrink: 0 }} />}
                                {raysColor === hex && <Check size={12} />}
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── App Background ── */}
                    <div className="setting-row">
                      <div className="setting-row-info">
                        <span className="setting-row-title">App Background</span>
                        <span className="setting-row-desc">Changes only the application background — text and accents are unaffected</span>
                      </div>
                      <div className="theme-dropdown" ref={bgDropdownRef}>
                        <button
                          className={`theme-dropdown__trigger${showBgDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                          onClick={() => setShowBgDropdown(p => !p)}
                          style={{ minWidth: 185 }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 24, height: 12, borderRadius: 3,
                              background: appBgColor,
                              display: 'inline-block', flexShrink: 0,
                              border: '1px solid rgba(255,255,255,0.12)',
                            }} />
                            {BG_COLORS.find(c => c.value === appBgColor)?.label ?? 'Custom'}
                          </span>
                          <ChevronDown size={13} className="theme-dropdown__chevron" />
                        </button>
                        {showBgDropdown && (
                          <div className="theme-dropdown__menu">
                            {BG_COLORS.map(({ value, label }) => (
                              <button
                                key={label}
                                className={`theme-dropdown__item${appBgColor === value ? ' theme-dropdown__item--active' : ''}`}
                                onClick={() => { handleBgColor(value); setShowBgDropdown(false); }}
                              >
                                <span style={{
                                  width: 20, height: 10, borderRadius: 2,
                                  background: value,
                                  display: 'inline-block', flexShrink: 0,
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  marginRight: 2,
                                }} />
                                {appBgColor === value && <Check size={12} />}
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </>
              )}

              {/* ABOUT */}
              {activeSection === 'about' && (
                <>
                  <div className="panel-header">
                    <span className="panel-header-icon"><Info size={18} /></span>
                    <div style={{ flex: 1 }}>
                      <h2 className="panel-title">About</h2>
                      <p className="panel-subtitle">Version info & updates</p>
                    </div>
                    <div className="panel-header-toggle">
                      <button
                        className={`update-check-btn${checkState === 'checking' ? ' update-check-btn--checking' : checkState === 'up-to-date' ? ' update-check-btn--ok' : checkState === 'available' ? ' update-check-btn--available' : ''}`}
                        onClick={handleCheckUpdate}
                        disabled={checkState === 'checking'}
                      >
                        {checkState === 'checking'  && <><RefreshCw size={13} className="spin" /> Checking...</>}
                        {checkState === 'up-to-date' && <><CheckCircle size={13} /> Up to Date</>}
                        {checkState === 'available'  && <><ArrowUpCircle size={13} /> v{checkVersion} Available</>}
                        {checkState === 'idle'       && 'Check for Updates'}
                      </button>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="about-card">
                      <div className="about-card-logo">GS</div>
                      <div className="about-card-info">
                        <span className="about-card-name">GS Center</span>
                        <span className="about-card-desc">Advanced system optimization tool with gaming focus</span>
                      </div>
                      <div className="about-card-version">
                        <span className="about-version-label">VERSION</span>
                        <span className="about-version-value">{appVersion}</span>
                      </div>
                    </div>

                    {(() => {
                      const gpuDisplay = gpuStatus?.status === 'crashed'
                        ? 'crashed'
                        : hwAccelEnabled ? 'active' : 'disabled';
                      return (
                    <div className={`gpu-card ${gpuDisplay === 'active' ? 'gpu-card--active' : 'gpu-card--crashed'}`}>
                      <div className="gpu-card-scanline" />
                      <div className="gpu-card-top">
                        <div className="gpu-card-icon">
                          {gpuDisplay === 'crashed' ? <AlertTriangle size={24} /> : <Monitor size={24} />}
                        </div>
                        <div className="gpu-card-title-group">
                          <span className="gpu-card-title">Hardware Acceleration</span>
                          <span className="gpu-card-sub">Electron Chromium Renderer</span>
                        </div>
                        <div className="gpu-card-status-pill">
                          <span className="gpu-card-status-dot" />
                          {gpuDisplay === 'crashed' ? 'CRASHED' : gpuDisplay === 'disabled' ? 'DISABLED' : 'ACTIVE'}
                        </div>
                      </div>
                      <div className="gpu-card-divider" />
                      <div className="gpu-card-rows">
                        <div className="gpu-card-row">
                          <span className="gpu-card-row-key">Acceleration</span>
                          <span className="gpu-card-row-val">
                            {gpuDisplay === 'active' ? 'Hardware-accelerated' : gpuDisplay === 'crashed' ? 'Disabled — GPU process crashed' : 'Disabled'}
                          </span>
                        </div>
                        <div className="gpu-card-row">
                          <span className="gpu-card-row-key">Compositing</span>
                          <span className="gpu-card-row-val">
                            {gpuDisplay === 'active' ? 'GPU compositing' : 'Software fallback'}
                          </span>
                        </div>
                        <div className="gpu-card-row">
                          <span className="gpu-card-row-key">Status</span>
                          <span className={`gpu-card-row-val ${gpuDisplay === 'active' ? 'gpu-val--ok' : 'gpu-val--error'}`}>
                            {gpuDisplay === 'active' ? 'Running normally'
                              : gpuDisplay === 'crashed' ? 'Requires restart to recover'
                              : 'Will disable on next restart'}
                          </span>
                        </div>
                        <div className="gpu-card-divider" style={{ margin: '10px 0 6px' }} />
                        <div className="gpu-card-row gpu-card-row--toggle">
                          <div className="gpu-card-row-toggle-info">
                            <span className="gpu-card-row-key">Hardware Acceleration</span>
                          </div>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={hwAccelEnabled}
                              onChange={(e) => {
                                const newVal = e.target.checked;
                                setHwAccelBeforeChange(hwAccelEnabled);
                                setHwAccelEnabled(newVal);
                                setShowHwAccelPopup(true);
                              }}
                            />
                            <span className="slider"></span>
                          </label>
                        </div>
                      </div>
                    </div>
                      );
                    })()}

                    {checkState === 'available' && (
                      <div className="update-hint" style={{ paddingLeft: 2 }}>See the toolbar notification to download</div>
                    )}
                  </div>
                </>
              )}

            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </motion.div>

    {/* ── HW Accel restart popup ── */}
    {showHwAccelPopup && (
      <div className="hw-accel-popup-overlay">
        <div className="hw-accel-popup">
          <div className="hw-accel-popup-icon">
            <Monitor size={22} />
          </div>
          <div className="hw-accel-popup-body">
            <span className="hw-accel-popup-title">
              {hwAccelEnabled ? 'Enable' : 'Disable'} Hardware Acceleration?
            </span>
            <span className="hw-accel-popup-desc">
              This change requires an app restart to take effect.
            </span>
          </div>
          <div className="hw-accel-popup-actions">
            <button
              className="hw-accel-popup-btn hw-accel-popup-btn--dismiss"
              onClick={() => {
                setHwAccelEnabled(hwAccelBeforeChange);
                setShowHwAccelPopup(false);
              }}
            >
              Dismiss
            </button>
            <button
              className="hw-accel-popup-btn hw-accel-popup-btn--restart"
              onClick={async () => {
                try {
                  await (window as any).electron?.gpu?.setHwAccel(hwAccelEnabled);
                  await (window as any).electron?.gpu?.relaunch();
                } catch {}
                setShowHwAccelPopup(false);
              }}
            >
              Restart Now
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default React.memo(Settings);



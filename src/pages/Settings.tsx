import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../styles/Settings.css';
import { loadSettings, saveSettings } from '../utils/settings';
import {
  Zap, Palette, Layers, Monitor, AlertTriangle, Info,
  RefreshCw, CheckCircle, ArrowUpCircle, ChevronRight, ChevronDown, Check,
} from 'lucide-react';

type Section = 'startup' | 'appearance' | 'overlay' | 'about';

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'startup',    label: 'Startup',    icon: <Zap size={15} />,     desc: 'Boot behavior'       },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} />, desc: 'Theme & display'     },
  { id: 'overlay',    label: 'Overlay',    icon: <Layers size={15} />,  desc: 'FPS HUD'             },
  { id: 'about',      label: 'About',      icon: <Info size={15} />,    desc: 'Version & updates'   },
];

const Settings: React.FC = () => {
  const [activeSection, setActiveSection] = useState<Section>('startup');
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings();
    return {
      autoCleanupOnStartup: saved.autoCleanupOnStartup ?? false,
      theme: saved.theme ?? 'dark',
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
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  // Overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('top-right');
  const [overlayColor, setOverlayColor] = useState('#00CC6A');
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const [overlayFont, setOverlayFont] = useState('Share Tech Mono');
  const [overlaySensors, setOverlaySensors] = useState({
    showHeader:       true,
    showBackground:   true,
    showFps:          true,
    showCpuUsage:     true,
    showGpuUsage:     true,
    showCpuTemp:      true,
    showGpuTemp:      true,
    showRamUsage:     true,
    showLatency:      true,
    showPacketLoss:   true,
    showNetworkSpeed: true,
  });
  const ipc = (window as any).electron?.ipcRenderer;

  const OVERLAY_COLORS = [
    { hex: '#00CC6A', label: 'Cyan'   },
    { hex: '#00FF88', label: 'Green'  },
    { hex: '#FF8C00', label: 'Orange' },
    { hex: '#FF4444', label: 'Red'    },
    { hex: '#A855F7', label: 'Purple' },
    { hex: '#FFFFFF', label: 'White'  },
  ];

  const OVERLAY_FONTS = [
    { family: 'Share Tech Mono', label: 'Share Tech',  preview: 'ABC 123' },
    { family: 'JetBrains Mono',  label: 'JetBrains',   preview: 'ABC 123' },
    { family: 'Orbitron',        label: 'Orbitron',    preview: 'ABC 123' },
    { family: 'Rajdhani',        label: 'Rajdhani',    preview: 'ABC 123' },
    { family: 'Courier Prime',   label: 'Courier',     preview: 'ABC 123' },
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

    // Load overlay state
    ipc?.invoke('overlay:get-state').then((state: any) => {
      if (state) {
        setOverlayVisible(state.visible);
        if (state.config?.position) setOverlayPosition(state.config.position);
        if (state.config?.color)    setOverlayColor(state.config.color);
        if (state.config?.opacity != null) setOverlayOpacity(state.config.opacity);
        if (state.config?.font) setOverlayFont(state.config.font);
        setOverlaySensors(prev => ({
          showHeader:       state.config?.showHeader       ?? prev.showHeader,
          showBackground:   state.config?.showBackground   ?? prev.showBackground,
          showFps:          state.config?.showFps          ?? prev.showFps,
          showCpuUsage:     state.config?.showCpuUsage     ?? prev.showCpuUsage,
          showGpuUsage:     state.config?.showGpuUsage     ?? prev.showGpuUsage,
          showCpuTemp:      state.config?.showCpuTemp      ?? prev.showCpuTemp,
          showGpuTemp:      state.config?.showGpuTemp      ?? prev.showGpuTemp,
          showRamUsage:     state.config?.showRamUsage     ?? prev.showRamUsage,
          showLatency:      state.config?.showLatency      ?? prev.showLatency,
          showPacketLoss:   state.config?.showPacketLoss   ?? prev.showPacketLoss,
          showNetworkSpeed: state.config?.showNetworkSpeed ?? prev.showNetworkSpeed,
        }));
      }
    }).catch(() => {});

    // Keep toggle in sync when the hotkey is used
    const unsubOverlay = ipc?.on?.('overlay:state-changed', (visible: boolean) => {
      setOverlayVisible(!!visible);
    });

    return () => {
      unsub?.();
      if (typeof unsubOverlay === 'function') unsubOverlay();
    };
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

  // Close theme dropdown on outside click
  useEffect(() => {
    if (!showThemeDropdown) return;
    const handle = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node))
        setShowThemeDropdown(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showThemeDropdown]);

  const handleToggle = (key: keyof typeof settings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    saveSettings(updated as any);
  };

  const handleCheckUpdate = async () => {
    const updater = window.electron?.updater;
    if (!updater || checkState === 'checking') return;

    setCheckState('checking');

    let resolved = false;
    let unsubFn: (() => void) | null = null;

    const resolve = (state: 'up-to-date' | 'available' | 'idle', version = '') => {
      if (resolved) return;
      resolved = true;
      setCheckState(state);
      if (version) setCheckVersion(version);
      unsubFn?.();
    };

    unsubFn = updater.onStatus((data: any) => {
      if (data.event === 'not-available') resolve('up-to-date');
      else if (data.event === 'available') resolve('available', data.version || '');
      else if (data.event === 'error') resolve('idle');
    });

    // Safety net: never stay stuck longer than 10 seconds
    const timer = setTimeout(() => resolve('idle'), 10000);

    try {
      const result = await updater.checkForUpdates();
      clearTimeout(timer);
      // Fallback for dev mode where status events are never fired
      if (!resolved) {
        if (result?.dev || result?.event === 'not-available') resolve('up-to-date');
        else resolve('idle');
      }
    } catch {
      clearTimeout(timer);
      resolve('idle');
    }
  };

  const handleOverlayToggle = async () => {
    try {
      const res = await ipc?.invoke('overlay:toggle');
      if (res) setOverlayVisible(res.visible);
    } catch {}
  };

  const handleOverlayPosition = async (pos: typeof overlayPosition) => {
    setOverlayPosition(pos);
    try {
      await ipc?.invoke('overlay:set-config', { position: pos });
    } catch {}
  };

  const handleOverlayColor = async (color: string) => {
    setOverlayColor(color);
    try { await ipc?.invoke('overlay:set-config', { color }); } catch {}
  };

  const handleOverlayOpacity = async (opacity: number) => {
    setOverlayOpacity(opacity);
    try { await ipc?.invoke('overlay:set-config', { opacity }); } catch {}
  };

  const handleOverlayFont = async (font: string) => {
    setOverlayFont(font);
    try { await ipc?.invoke('overlay:set-config', { font }); } catch {}
  };

  const handleOverlaySensor = async (key: keyof typeof overlaySensors) => {
    const updated = { ...overlaySensors, [key]: !overlaySensors[key] };
    setOverlaySensors(updated);
    try { await ipc?.invoke('overlay:set-config', { [key]: updated[key] }); } catch {}
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
                      <p className="panel-subtitle">Customize the visual style</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="setting-row">
                      <div className="setting-row-info">
                        <span className="setting-row-title">Theme</span>
                        <span className="setting-row-desc">Choose your preferred color theme</span>
                      </div>
                      <div className="theme-dropdown" ref={themeDropdownRef}>
                        <button
                          className={`theme-dropdown__trigger${showThemeDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                          onClick={() => setShowThemeDropdown(p => !p)}
                        >
                          <span>{settings.theme === 'dark' ? 'Dark (Default)' : 'Light'}</span>
                          <ChevronDown size={13} className="theme-dropdown__chevron" />
                        </button>
                        {showThemeDropdown && (
                          <div className="theme-dropdown__menu">
                            {(['dark', 'light'] as const).map(opt => (
                              <button
                                key={opt}
                                className={`theme-dropdown__item${settings.theme === opt ? ' theme-dropdown__item--active' : ''}`}
                                onClick={() => {
                                  setSettings(prev => ({ ...prev, theme: opt }));
                                  setShowThemeDropdown(false);
                                }}
                              >
                                {settings.theme === opt && <Check size={12} />}
                                {opt === 'dark' ? 'Dark (Default)' : 'Light'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* OVERLAY */}
              {activeSection === 'overlay' && (
                <>
                  <div className="panel-header">
                    <span className="panel-header-icon"><Layers size={18} /></span>
                    <div style={{ flex: 1 }}>
                      <h2 className="panel-title">Overlay</h2>
                      <p className="panel-subtitle">Real-time in-game FPS HUD</p>
                    </div>
                    <div className="panel-header-toggle">
                      <div className="panel-header-toggle-info">
                        <span className={`overlay-enable-dot${overlayVisible ? ' overlay-enable-dot--on' : ''}`} style={{ display: 'inline-block' }} />
                        <span className="panel-header-toggle-label">FPS Overlay</span>
                        <kbd className="overlay-hotkey">Ctrl+Shift+F</kbd>
                      </div>
                      <label className="toggle-switch">
                        <input type="checkbox" checked={overlayVisible} onChange={handleOverlayToggle} />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>
                  <div className="panel-body">

                    {/* ── Controls grid ── */}
                    <div className="overlay-cfg-grid">

                      {/* Position — visual screen picker */}
                      <div className="overlay-cfg-card">
                        <span className="overlay-cfg-card-title">Position</span>
                        <div className="overlay-screen-picker">
                          <div className="overlay-screen-frame">
                            {([
                              ['top-left',     'top-left'    ],
                              ['top-right',    'top-right'   ],
                              ['bottom-left',  'bottom-left' ],
                              ['bottom-right', 'bottom-right'],
                            ] as const).map(([pos, corner]) => (
                              <button
                                key={pos}
                                className={`overlay-screen-dot overlay-screen-dot--${corner}${overlayPosition === pos ? ' overlay-screen-dot--active' : ''}`}
                                onClick={() => handleOverlayPosition(pos)}
                                title={pos.replace('-', ' ')}
                              />
                            ))}
                            <div className="overlay-screen-scanline" />
                          </div>
                          <span className="overlay-screen-label">
                            {overlayPosition.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </span>
                        </div>
                      </div>

                      {/* Color + Opacity */}
                      <div className="overlay-cfg-card">
                        <span className="overlay-cfg-card-title">Accent Color</span>
                        <div className="overlay-color-grid">
                          {OVERLAY_COLORS.map(({ hex, label }) => (
                            <button
                              key={hex}
                              className={`overlay-color-swatch${overlayColor === hex ? ' overlay-color-swatch--active' : ''}`}
                              style={{ '--swatch-color': hex } as React.CSSProperties}
                              onClick={() => handleOverlayColor(hex)}
                              title={label}
                            />
                          ))}
                        </div>

                        <div className="overlay-opacity-row">
                          <span className="overlay-cfg-card-title">Opacity</span>
                          <span className="overlay-opacity-val">{Math.round(overlayOpacity * 100)}%</span>
                        </div>
                        <div className="overlay-slider-track">
                          <div
                            className="overlay-slider-fill"
                            style={{ width: `${overlayOpacity * 100}%`, background: overlayColor }}
                          />
                          <input
                            type="range"
                            className="overlay-opacity-slider"
                            min={0}
                            max={1}
                            step={0.05}
                            value={overlayOpacity}
                            onChange={e => handleOverlayOpacity(parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Metrics + Font side by side ── */}
                    <div className="overlay-twin-grid">

                      {/* Visible Metrics */}
                      <div className="overlay-cfg-card">
                        <span className="overlay-cfg-card-title">Visible Metrics</span>
                        <div className="overlay-toggle-list">

                          <span className="overlay-toggle-group-label">HUD</span>
                          {([
                            ['showHeader',     'Header'    ],
                            ['showBackground', 'Background'],
                            ['showFps',        'FPS'       ],
                          ] as const).map(([key, label]) => (
                            <div key={key} className="overlay-toggle-row" style={{ '--sensor-color': overlayColor } as React.CSSProperties} onClick={() => handleOverlaySensor(key)}>
                              <span className="overlay-toggle-label">{label}</span>
                              <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`}><div className="overlay-toggle-thumb" /></div>
                            </div>
                          ))}

                          <span className="overlay-toggle-group-label">CPU</span>
                          {([
                            ['showCpuUsage', 'Usage'],
                            ['showCpuTemp',  'Temp' ],
                          ] as const).map(([key, label]) => (
                            <div key={key} className="overlay-toggle-row" style={{ '--sensor-color': overlayColor } as React.CSSProperties} onClick={() => handleOverlaySensor(key)}>
                              <span className="overlay-toggle-label">{label}</span>
                              <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`}><div className="overlay-toggle-thumb" /></div>
                            </div>
                          ))}

                          <span className="overlay-toggle-group-label">GPU</span>
                          {([
                            ['showGpuUsage', 'Usage'],
                            ['showGpuTemp',  'Temp' ],
                          ] as const).map(([key, label]) => (
                            <div key={key} className="overlay-toggle-row" style={{ '--sensor-color': overlayColor } as React.CSSProperties} onClick={() => handleOverlaySensor(key)}>
                              <span className="overlay-toggle-label">{label}</span>
                              <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`}><div className="overlay-toggle-thumb" /></div>
                            </div>
                          ))}

                          <span className="overlay-toggle-group-label">Memory</span>
                          {([
                            ['showRamUsage', 'RAM'],
                          ] as const).map(([key, label]) => (
                            <div key={key} className="overlay-toggle-row" style={{ '--sensor-color': overlayColor } as React.CSSProperties} onClick={() => handleOverlaySensor(key)}>
                              <span className="overlay-toggle-label">{label}</span>
                              <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`}><div className="overlay-toggle-thumb" /></div>
                            </div>
                          ))}

                          <span className="overlay-toggle-group-label">Network</span>
                          {([
                            ['showLatency',      'Ping'        ],
                            ['showPacketLoss',   'Packet Loss' ],
                            ['showNetworkSpeed', 'Net Speed'   ],
                          ] as const).map(([key, label]) => (
                            <div key={key} className="overlay-toggle-row" style={{ '--sensor-color': overlayColor } as React.CSSProperties} onClick={() => handleOverlaySensor(key)}>
                              <span className="overlay-toggle-label">{label}</span>
                              <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`}><div className="overlay-toggle-thumb" /></div>
                            </div>
                          ))}

                        </div>
                      </div>

                      {/* Font Style */}
                      <div className="overlay-cfg-card">
                        <span className="overlay-cfg-card-title">Font Style</span>
                        <div className="overlay-toggle-list">
                          {OVERLAY_FONTS.map(({ family, label }) => (
                            <div
                              key={family}
                              className="overlay-toggle-row"
                              style={{ '--sensor-color': overlayColor } as React.CSSProperties}
                              onClick={() => handleOverlayFont(family)}
                            >
                              <span className="overlay-toggle-label" style={{ fontFamily: family }}>{label}</span>
                              <div className={`overlay-toggle-switch${overlayFont === family ? ' overlay-toggle-switch--on' : ''}`}>
                                <div className="overlay-toggle-thumb" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                    <div className="overlay-note">
                      Works in <strong>Borderless Windowed</strong> mode. Exclusive fullscreen bypasses the compositor.
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

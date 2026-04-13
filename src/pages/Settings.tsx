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
  { id: 'startup',    label: 'Startup',    icon: <Zap size={15} />,     desc: 'Boot behavior'    },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} />, desc: 'Colors & effects'  },
  { id: 'overlay',    label: 'Overlay',    icon: <Layers size={15} />,  desc: 'FPS HUD'          },
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
  const fontDropdownRef     = useRef<HTMLDivElement>(null);
  const fontSizeDropdownRef = useRef<HTMLDivElement>(null);
  const colorDropdownRef    = useRef<HTMLDivElement>(null);
  const [showFontDropdown,     setShowFontDropdown]     = useState(false);
  const [showFontSizeDropdown, setShowFontSizeDropdown] = useState(false);
  const [showColorDropdown,    setShowColorDropdown]    = useState(false);
  const [overlayFontSize, setOverlayFontSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('top-right');
  const [overlayColor, setOverlayColor] = useState('rgb(var(--accent))');
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
    { hex: 'rgb(var(--accent))', label: 'Cyan'   },
    { hex: '#00FF88', label: 'Green'  },
    { hex: '#4488FF', label: 'Blue'   },
    { hex: '#FF4444', label: 'Red'    },
    { hex: '#FF8C00', label: 'Orange' },
    { hex: '#FF69B4', label: 'Pink'   },
    { hex: '#A855F7', label: 'Purple' },
    { hex: '#FFFFFF', label: 'White'  },
  ];

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

  const OVERLAY_FONTS = [
    { family: 'Share Tech Mono', label: 'Share Tech'    },
    { family: 'JetBrains Mono',  label: 'JetBrains'     },
    { family: 'Space Mono',      label: 'Space Mono'    },
    { family: 'Nova Mono',       label: 'Nova Mono'     },
    { family: 'Orbitron',        label: 'Orbitron'      },
    { family: 'Chakra Petch',    label: 'Chakra Petch'  },
    { family: 'Exo 2',           label: 'Exo 2'         },
    { family: 'Rajdhani',        label: 'Rajdhani'      },
    { family: 'Courier Prime',   label: 'Courier'       },
  ];

  const FONT_SIZES = [
    { value: 'small',  label: 'Small'  },
    { value: 'medium', label: 'Medium' },
    { value: 'large',  label: 'Large'  },
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
    if (!showAccentDropdown && !showRaysDropdown && !showBgDropdown && !showFontDropdown && !showFontSizeDropdown && !showColorDropdown) return;
    const handle = (e: MouseEvent) => {
      if (accentDropdownRef.current  && !accentDropdownRef.current.contains(e.target as Node))  setShowAccentDropdown(false);
      if (raysDropdownRef.current    && !raysDropdownRef.current.contains(e.target as Node))    setShowRaysDropdown(false);
      if (bgDropdownRef.current      && !bgDropdownRef.current.contains(e.target as Node))      setShowBgDropdown(false);
      if (fontDropdownRef.current    && !fontDropdownRef.current.contains(e.target as Node))    setShowFontDropdown(false);
      if (fontSizeDropdownRef.current && !fontSizeDropdownRef.current.contains(e.target as Node)) setShowFontSizeDropdown(false);
      if (colorDropdownRef.current   && !colorDropdownRef.current.contains(e.target as Node))   setShowColorDropdown(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showRaysDropdown, showBgDropdown, showFontDropdown, showFontSizeDropdown, showColorDropdown]);

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

    let resolved = false;
    let unsubFn: (() => void) | null = null;

    const resolve = (state: 'up-to-date' | 'available' | 'idle', version = '') => {
      if (resolved) return;
      resolved = true;
      setCheckState(state);
      if (version) setCheckVersion(version);
      unsubFn?.();
      // Reset to idle after a short display window so the button is clickable again
      if (state === 'up-to-date') {
        setTimeout(() => setCheckState('idle'), 3000);
      }
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
        else if (result?.event === 'available') resolve('available', result?.version || '');
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

  const handleOverlayFontSize = async (size: 'small' | 'medium' | 'large') => {
    setOverlayFontSize(size);
    try { await ipc?.invoke('overlay:set-config', { fontSize: size }); } catch {}
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
                  <div className="panel-body ovl-panel-body">

                    {/* ── Top Grid: Metrics (left) + Controls (right) ── */}
                    <div className="ovl-top-grid">

                      {/* Visible Metrics */}
                      <div className="ovl-metrics-card" style={{ '--ovl-color': overlayColor } as React.CSSProperties}>
                        <span className="ovl-section-label">Visible Metrics</span>
                        <div className="ovl-ml-grid">

                          {/* Column 1: HUD + CPU */}
                          <div className="ovl-ml-col">
                            <span className="ovl-ml-group-hdr">HUD</span>
                            {([
                              ['showHeader',     'Header'    ],
                              ['showBackground', 'Background'],
                              ['showFps',        'FPS'       ],
                            ] as const).map(([key, label]) => (
                              <div key={key} className={`ovl-ml-row${overlaySensors[key] ? ' ovl-ml-row--on' : ''}`} onClick={() => handleOverlaySensor(key)}>
                                <span className="ovl-ml-label">{label}</span>
                                <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`} style={{ '--sensor-color': overlayColor } as React.CSSProperties}><div className="overlay-toggle-thumb" /></div>
                              </div>
                            ))}

                            <span className="ovl-ml-group-hdr">CPU</span>
                            {([
                              ['showCpuUsage', 'Usage'],
                              ['showCpuTemp',  'Temp' ],
                            ] as const).map(([key, label]) => (
                              <div key={key} className={`ovl-ml-row${overlaySensors[key] ? ' ovl-ml-row--on' : ''}`} onClick={() => handleOverlaySensor(key)}>
                                <span className="ovl-ml-label">{label}</span>
                                <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`} style={{ '--sensor-color': overlayColor } as React.CSSProperties}><div className="overlay-toggle-thumb" /></div>
                              </div>
                            ))}
                          </div>

                          {/* Column 2: GPU + Memory + Network */}
                          <div className="ovl-ml-col">
                            <span className="ovl-ml-group-hdr">GPU</span>
                            {([
                              ['showGpuUsage', 'Usage'],
                              ['showGpuTemp',  'Temp' ],
                            ] as const).map(([key, label]) => (
                              <div key={key} className={`ovl-ml-row${overlaySensors[key] ? ' ovl-ml-row--on' : ''}`} onClick={() => handleOverlaySensor(key)}>
                                <span className="ovl-ml-label">{label}</span>
                                <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`} style={{ '--sensor-color': overlayColor } as React.CSSProperties}><div className="overlay-toggle-thumb" /></div>
                              </div>
                            ))}

                            <span className="ovl-ml-group-hdr">Memory</span>
                            <div className={`ovl-ml-row${overlaySensors.showRamUsage ? ' ovl-ml-row--on' : ''}`} onClick={() => handleOverlaySensor('showRamUsage')}>
                              <span className="ovl-ml-label">RAM</span>
                              <div className={`overlay-toggle-switch${overlaySensors.showRamUsage ? ' overlay-toggle-switch--on' : ''}`} style={{ '--sensor-color': overlayColor } as React.CSSProperties}><div className="overlay-toggle-thumb" /></div>
                            </div>

                            <span className="ovl-ml-group-hdr">Network</span>
                            {([
                              ['showLatency',      'Ping'       ],
                              ['showPacketLoss',   'Packet Loss'],
                              ['showNetworkSpeed', 'Net Speed'  ],
                            ] as const).map(([key, label]) => (
                              <div key={key} className={`ovl-ml-row${overlaySensors[key] ? ' ovl-ml-row--on' : ''}`} onClick={() => handleOverlaySensor(key)}>
                                <span className="ovl-ml-label">{label}</span>
                                <div className={`overlay-toggle-switch${overlaySensors[key] ? ' overlay-toggle-switch--on' : ''}`} style={{ '--sensor-color': overlayColor } as React.CSSProperties}><div className="overlay-toggle-thumb" /></div>
                              </div>
                            ))}
                          </div>

                        </div>
                      </div>

                      {/* Right column: Display + Position */}
                      <div className="ovl-controls-col">

                        {/* Display Settings */}
                        <div className="ovl-control-group">
                          <span className="ovl-section-label">Display</span>

                          {/* Accent Color */}
                          <div className="ovl-control-row">
                            <span className="ovl-control-label">Accent Color</span>
                            <div className="theme-dropdown" ref={colorDropdownRef}>
                              <button
                                className={`theme-dropdown__trigger${showColorDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                                onClick={() => setShowColorDropdown(p => !p)}
                                style={{ minWidth: 160 }}
                              >
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: overlayColor, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 6px ${overlayColor}` }} />
                                  {OVERLAY_COLORS.find(c => c.hex === overlayColor)?.label ?? 'Custom'}
                                </span>
                                <ChevronDown size={13} className="theme-dropdown__chevron" />
                              </button>
                              {showColorDropdown && (
                                <div className="theme-dropdown__menu">
                                  {OVERLAY_COLORS.map(({ hex, label }) => (
                                    <button
                                      key={hex}
                                      className={`theme-dropdown__item${overlayColor === hex ? ' theme-dropdown__item--active' : ''}`}
                                      onClick={() => { handleOverlayColor(hex); setShowColorDropdown(false); }}
                                    >
                                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: hex, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 5px ${hex}` }} />
                                      {overlayColor === hex && <Check size={12} />}
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Font Dropdown */}
                          <div className="ovl-control-row">
                            <span className="ovl-control-label">Font</span>
                            <div className="theme-dropdown" ref={fontDropdownRef}>
                              <button
                                className={`theme-dropdown__trigger${showFontDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                                onClick={() => setShowFontDropdown(p => !p)}
                                style={{ minWidth: 148, fontFamily: overlayFont }}
                              >
                                <span>{OVERLAY_FONTS.find(f => f.family === overlayFont)?.label ?? overlayFont}</span>
                                <ChevronDown size={13} className="theme-dropdown__chevron" />
                              </button>
                              {showFontDropdown && (
                                <div className="theme-dropdown__menu">
                                  {OVERLAY_FONTS.map(({ family, label }) => (
                                    <button
                                      key={family}
                                      className={`theme-dropdown__item${overlayFont === family ? ' theme-dropdown__item--active' : ''}`}
                                      style={{ fontFamily: family }}
                                      onClick={() => { handleOverlayFont(family); setShowFontDropdown(false); }}
                                    >
                                      {overlayFont === family && <Check size={12} />}
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Font Size Dropdown */}
                          <div className="ovl-control-row">
                            <span className="ovl-control-label">Font Size</span>
                            <div className="theme-dropdown" ref={fontSizeDropdownRef}>
                              <button
                                className={`theme-dropdown__trigger${showFontSizeDropdown ? ' theme-dropdown__trigger--open' : ''}`}
                                onClick={() => setShowFontSizeDropdown(p => !p)}
                                style={{ minWidth: 148 }}
                              >
                                <span>{FONT_SIZES.find(s => s.value === overlayFontSize)?.label ?? 'Medium'}</span>
                                <ChevronDown size={13} className="theme-dropdown__chevron" />
                              </button>
                              {showFontSizeDropdown && (
                                <div className="theme-dropdown__menu">
                                  {FONT_SIZES.map(({ value, label }) => (
                                    <button
                                      key={value}
                                      className={`theme-dropdown__item${overlayFontSize === value ? ' theme-dropdown__item--active' : ''}`}
                                      onClick={() => { handleOverlayFontSize(value as 'small' | 'medium' | 'large'); setShowFontSizeDropdown(false); }}
                                    >
                                      {overlayFontSize === value && <Check size={12} />}
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Opacity */}
                          <div className="ovl-control-row ovl-control-row--col">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                              <span className="ovl-control-label">Opacity</span>
                              <span className="overlay-opacity-val">{Math.round(overlayOpacity * 100)}%</span>
                            </div>
                            <div className="overlay-slider-track" style={{ width: '100%' }}>
                              <div className="overlay-slider-fill" style={{ width: `${overlayOpacity * 100}%`, background: overlayColor }} />
                              <input
                                type="range"
                                className="overlay-opacity-slider"
                                min={0} max={1} step={0.05}
                                value={overlayOpacity}
                                onChange={e => handleOverlayOpacity(parseFloat(e.target.value))}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Position Picker */}
                        <div className="ovl-control-group">
                          <span className="ovl-section-label">Position</span>
                          <div className="overlay-screen-picker" style={{ marginTop: 4 }}>
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



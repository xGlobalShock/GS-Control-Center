import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2,
  Download,
  Search,
  X,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertTriangle,
  FolderOpen,
  FileKey,
  Server,
  Clock,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  Check,
} from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import '../styles/AppUninstaller.css';

/* ─── Types ──────────────────────────────────────────────────────── */
interface InstalledApp {
  name: string;
  publisher: string;
  version: string;
  size: number;       // MB
  installDate: string;
  installLocation: string;
  uninstallString: string;
  registryKey: string;
  source: string;
}

interface LeftoverItem {
  type: 'file' | 'folder' | 'registry' | 'service' | 'task';
  path: string;
  size: number;
  selected: boolean;
  detail?: string;
}

type Phase = 'list' | 'confirm' | 'uninstalling' | 'scanning' | 'leftovers' | 'deleting' | 'done';
type ScanMode = 'safe' | 'moderate' | 'advanced';

type AppTab = 'install' | 'uninstall';

interface AppUninstallerProps {
  isActive?: boolean;
  activeTab?: AppTab;
  onTabChange?: (tab: AppTab) => void;
}

/* ─── Helpers ────────────────────────────────────────────────────── */
const fmtSize = (bytes: number) => {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  file: <FolderOpen size={13} />,
  folder: <FolderOpen size={13} />,
  registry: <FileKey size={13} />,
  service: <Server size={13} />,
  task: <Clock size={13} />,
};

const TYPE_LABELS: Record<string, string> = {
  file: 'Files',
  folder: 'Folders',
  registry: 'Registry',
  service: 'Services',
  task: 'Scheduled Tasks',
};

/* Module-level cache: installLocation|uninstallString → base64 data URL */
const _nativeIconCache = new Map<string, string>();

/* Fetches the real Windows exe icon via IPC, falls back to domain/initial */
const AppIconNative: React.FC<{ app: InstalledApp; size?: number }> = ({ app, size = 16 }) => {
  const cacheKey = app.installLocation || app.uninstallString || app.name;
  const [iconUrl, setIconUrl] = React.useState<string | null>(
    () => _nativeIconCache.get(cacheKey) ?? null
  );
  const [imgErr, setImgErr] = React.useState(false);

  React.useEffect(() => {
    if (iconUrl || _nativeIconCache.has(cacheKey)) return;
    if (!window.electron?.ipcRenderer) return;
    let cancelled = false;
    window.electron.ipcRenderer
      .invoke('appuninstall:get-icon', app.installLocation, app.uninstallString)
      .then((r: any) => {
        if (!cancelled && r?.success && r.dataUrl) {
          _nativeIconCache.set(cacheKey, r.dataUrl);
          setIconUrl(r.dataUrl);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cacheKey]);

  if (iconUrl && !imgErr) {
    return (
      <img
        src={iconUrl} width={size} height={size} alt="" draggable={false}
        onError={() => setImgErr(true)}
        style={{ borderRadius: 3, objectFit: 'contain', flexShrink: 0 }}
      />
    );
  }
  // Fallback: domain lookup → clearbit → Google S2 → coloured initial
  const domain = getAppDomain(app.name);
  if (domain) {
    return <AppIconFavicon domain={domain} name={app.name} size={size} />;
  }
  const hue = app.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: 4, flexShrink: 0,
      background: `hsla(${hue},55%,45%,0.25)`,
      color: `hsla(${hue},75%,70%,0.9)`,
      fontSize: Math.round(size * 0.65), fontWeight: 700, lineHeight: 1,
    }}>{app.name.charAt(0).toUpperCase()}</span>
  );
};

/* Thin favicon component used as fallback inside AppIconNative */
const AppIconFavicon: React.FC<{ domain: string; name: string; size: number }> = ({ domain, name, size }) => {
  const cacheKey = `fav:${domain}`;
  const [iconUrl, setIconUrl] = React.useState<string | null>(
    () => _nativeIconCache.get(cacheKey) ?? null
  );

  React.useEffect(() => {
    if (_nativeIconCache.has(cacheKey)) { setIconUrl(_nativeIconCache.get(cacheKey)!); return; }
    if (!window.electron?.ipcRenderer) return;
    let cancelled = false;
    const urls = [
      `https://logo.clearbit.com/${domain}`,
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    ];
    (async () => {
      for (const url of urls) {
        const r = await window.electron.ipcRenderer.invoke('appicon:fetch', url).catch(() => null);
        if (cancelled) return;
        if (r?.success && r.dataUrl) {
          _nativeIconCache.set(cacheKey, r.dataUrl);
          setIconUrl(r.dataUrl);
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cacheKey]);

  if (iconUrl) {
    return <img src={iconUrl} width={size} height={size} alt="" draggable={false} style={{ borderRadius: 3, objectFit: 'contain', flexShrink: 0 }} />;
  }
  const hue = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: 4, flexShrink: 0, background: `hsla(${hue},55%,45%,0.25)`, color: `hsla(${hue},75%,70%,0.9)`, fontSize: Math.round(size * 0.65), fontWeight: 700, lineHeight: 1 }}>{name.charAt(0).toUpperCase()}</span>;
};
const KNOWN_DOMAINS: Record<string, string> = {
  discord: 'discord.com', chrome: 'google.com', 'google chrome': 'google.com',
  firefox: 'mozilla.org', 'mozilla firefox': 'mozilla.org', brave: 'brave.com',
  edge: 'microsoft.com', 'microsoft edge': 'microsoft.com', opera: 'opera.com',
  steam: 'steampowered.com', 'epic games': 'epicgames.com',
  'ubisoft connect': 'ubisoft.com', 'battle.net': 'battle.net', blizzard: 'battle.net',
  spotify: 'spotify.com', vlc: 'videolan.org', obs: 'obsproject.com',
  'obs studio': 'obsproject.com', zoom: 'zoom.us', telegram: 'telegram.org',
  teams: 'microsoft.com', 'microsoft teams': 'microsoft.com',
  'visual studio code': 'code.visualstudio.com', 'vs code': 'code.visualstudio.com',
  git: 'git-scm.com', 'github desktop': 'github.com',
  'node.js': 'nodejs.org', nodejs: 'nodejs.org', python: 'python.org',
  'visual studio': 'visualstudio.microsoft.com',
  '7-zip': '7-zip.org', winrar: 'win-rar.com', bitwarden: 'bitwarden.com',
  'notepad++': 'notepad-plus-plus.org', 'revo uninstaller': 'revouninstaller.com',
  steelseries: 'steelseries.com', nvidia: 'nvidia.com', geforce: 'nvidia.com',
  amd: 'amd.com', 'msi afterburner': 'msi.com', hwinfo: 'hwinfo.com',
  'cpu-z': 'cpuid.com', 'gpu-z': 'techpowerup.com',
  'ea ': 'ea.com', ubisoft: 'ubisoft.com', streamlabs: 'streamlabs.com',
  eartrumpet: 'eartrumpet.app',
};
function getAppDomain(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, domain] of Object.entries(KNOWN_DOMAINS)) {
    if (lower.includes(key)) return domain;
  }
  return undefined;
}

/* App favicon — Google S2 service, falls back to coloured initial */
const AppIcon: React.FC<{ domain?: string; name: string; size?: number }> = ({ domain, name, size = 16 }) => {
  const [err, setErr] = React.useState(false);
  if (domain && !err) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        width={size} height={size} alt="" draggable={false}
        onError={() => setErr(true)}
        style={{ borderRadius: 3, objectFit: 'contain', flexShrink: 0 }}
      />
    );
  }
  const hue = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: 4, flexShrink: 0,
      background: `hsla(${hue},55%,45%,0.25)`,
      color: `hsla(${hue},75%,70%,0.9)`,
      fontSize: Math.round(size * 0.65), fontWeight: 700, lineHeight: 1,
    }}>{name.charAt(0).toUpperCase()}</span>
  );
};

/* ─── Component ──────────────────────────────────────────────────── */
const AppUninstaller: React.FC<AppUninstallerProps> = ({ isActive = false, activeTab = 'uninstall', onTabChange }) => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('list');
  const [targetApp, setTargetApp] = useState<InstalledApp | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('safe');
  const [leftovers, setLeftovers] = useState<LeftoverItem[]>([]);
  const [leftoverTotalSize, setLeftoverTotalSize] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [deleteResult, setDeleteResult] = useState<{ deletedCount: number; freedBytes: number } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const hasLoaded = React.useRef(false);
  const { addToast } = useToast();

  /* ── Reset overlay when navigating away from Apps page ── */
  useEffect(() => {
    if (!isActive && phase !== 'list' && phase !== 'uninstalling' && phase !== 'scanning' && phase !== 'deleting') {
      setPhase('list');
      setTargetApp(null);
      setLeftovers([]);
      setDeleteResult(null);
    }
  }, [isActive]);

  /* ── Fetch installed apps ── */
  const fetchApps = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    setLoading(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('appuninstall:list-apps');
      if (result.success) {
        setApps(result.apps);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (isActive && !hasLoaded.current && !loading) {
      hasLoaded.current = true;
      fetchApps();
    }
  }, [isActive, loading, fetchApps]);

  /* ── Listen for uninstall progress ── */
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('appuninstall:progress', (data: any) => {
      setProgressMsg(data.status || '');
    });
    return () => { if (unsub) unsub(); };
  }, []);

  /* ── Actions ── */
  const startUninstall = (app: InstalledApp) => {
    setTargetApp(app);
    setPhase('confirm');
    setScanMode('safe');
    setLeftovers([]);
    setDeleteResult(null);
    setCollapsedGroups(new Set());
  };

  const confirmUninstall = async (mode: ScanMode = scanMode) => {
    if (!targetApp || !window.electron?.ipcRenderer) return;
    setPhase('uninstalling');
    setProgressMsg(`Uninstalling ${targetApp.name}, please wait...`);

    try {
      const result = await window.electron.ipcRenderer.invoke('appuninstall:uninstall-app', targetApp);

      if (result.cancelled) {
        setPhase('confirm');
        return;
      }

      if (result.success) {
        addToast(`${targetApp.name} uninstalled`, 'success');
      }

      // If 'safe' mode = Uninstall App Only — skip leftover scan entirely
      if (mode === 'safe') {
        addToast(`${targetApp.name} uninstalled`, 'success');
        setPhase('done');
        setDeleteResult({ deletedCount: 0, freedBytes: 0 });
        return;
      }

      // Always proceed to leftover scan — even if exit code was non-zero
      // (user may have completed the uninstall via the native GUI wizard)
      setPhase('scanning');
      setProgressMsg('Scanning for leftover files and registry entries...');

      try {
        const scanResult = await window.electron.ipcRenderer.invoke(
          'appuninstall:scan-leftovers', targetApp, mode, true  // true = use pre-snapshot (Revo-style)
        );
        if (scanResult.success && scanResult.leftovers.length > 0) {
          setLeftovers(scanResult.leftovers);
          setLeftoverTotalSize(scanResult.totalSize);
          setPhase('leftovers');
        } else {
          addToast('No leftovers found — clean uninstall!', 'success');
          setPhase('done');
          setDeleteResult({ deletedCount: 0, freedBytes: 0 });
        }
      } catch {
        addToast('Leftover scan failed', 'error');
        setPhase('done');
        setDeleteResult({ deletedCount: 0, freedBytes: 0 });
      }
    } catch {
      addToast('Error during uninstall', 'error');
      setPhase('confirm');
    }
  };

  const skipToScan = async () => {
    if (!targetApp || !window.electron?.ipcRenderer) return;
    setPhase('scanning');
    setProgressMsg('Scanning for leftover files and registry entries...');
    try {
      const scanResult = await window.electron.ipcRenderer.invoke(
        'appuninstall:scan-leftovers', targetApp, scanMode, false  // false = name-matching (app still installed)
      );
      if (scanResult.success && scanResult.leftovers.length > 0) {
        setLeftovers(scanResult.leftovers);
        setLeftoverTotalSize(scanResult.totalSize);
        setPhase('leftovers');
      } else {
        addToast('No leftovers found', 'info');
        backToList();
      }
    } catch {
      addToast('Leftover scan failed', 'error');
      backToList();
    }
  };

  const toggleLeftover = (idx: number) => {
    setLeftovers(prev => prev.map((l, i) => i === idx ? { ...l, selected: !l.selected } : l));
  };

  const selectAllOfType = (type: string, selected: boolean) => {
    setLeftovers(prev => prev.map(l => l.type === type ? { ...l, selected } : l));
  };

  const toggleGroup = (type: string) => {
    setCollapsedGroups(prev => {
      const n = new Set(prev);
      n.has(type) ? n.delete(type) : n.add(type);
      return n;
    });
  };

  const deleteLeftovers = async () => {
    if (!window.electron?.ipcRenderer) return;
    const toDelete = leftovers.filter(l => l.selected);
    if (toDelete.length === 0) { addToast('No items selected', 'info'); return; }

    setPhase('deleting');
    setProgressMsg(`Deleting ${toDelete.length} leftover items...`);

    try {
      const result = await window.electron.ipcRenderer.invoke('appuninstall:delete-leftovers', toDelete);
      setDeleteResult({ deletedCount: result.deletedCount, freedBytes: result.freedBytes });
      setPhase('done');
      addToast(`Cleaned ${result.deletedCount} leftover items`, 'success');
    } catch {
      addToast('Error deleting leftovers', 'error');
      setPhase('leftovers');
    }
  };

  const cancelUninstall = async () => {
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('appuninstall:cancel').catch(() => {});
    }
    setPhase('confirm');
  };

  const backToList = () => {
    setPhase('list');
    setTargetApp(null);
    setLeftovers([]);
    setDeleteResult(null);
    fetchApps(); // Refresh the list
  };

  /* ── Filtered app list ── */
  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return apps;
    const q = searchQuery.toLowerCase();
    return apps.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.publisher || '').toLowerCase().includes(q)
    );
  }, [apps, searchQuery]);

  /* ── Grouped leftovers ── */
  const groupedLeftovers = useMemo(() => {
    const groups: Record<string, LeftoverItem[]> = {};
    for (const l of leftovers) {
      if (!groups[l.type]) groups[l.type] = [];
      groups[l.type].push(l);
    }
    return groups;
  }, [leftovers]);

  const selectedCount = leftovers.filter(l => l.selected).length;
  const selectedSize = leftovers.filter(l => l.selected).reduce((s, l) => s + (l.size || 0), 0);

  return (
    <motion.div className="au" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      {/* ── Toolbar ── */}
      <div className="au-toolbar">
        <div className="au-toolbar-l">
          {phase === 'list' && (
            <div className="au-search-wrap">
              <Search size={12} className="au-search-icon" />
              <input
                className="au-search"
                placeholder="Search installed apps…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="au-search-x" onClick={() => setSearchQuery('')}><X size={11} /></button>
              )}
            </div>
          )}
          {phase !== 'list' && targetApp && (
            <span className="au-toolbar-ctx">{targetApp.name}</span>
          )}
        </div>
        <div className="au-toolbar-c">
          <div className="apps-hdr-sw">
            <button
              className={`apps-hdr-sw-btn apps-hdr-sw-btn--install${activeTab === 'install' ? ' apps-hdr-sw-btn--on' : ''}`}
              onClick={() => onTabChange?.('install')}
            >
              <span className="apps-hdr-sw-btn-icon"><Download size={15} strokeWidth={2} /></span>
              <span className="apps-hdr-sw-btn-body">
                <span className="apps-hdr-sw-btn-title">Install Apps</span>
                <span className="apps-hdr-sw-btn-sub">Deploy software</span>
              </span>
            </button>
            <div className="apps-hdr-sw-sep" />
            <button
              className={`apps-hdr-sw-btn apps-hdr-sw-btn--uninstall${activeTab === 'uninstall' ? ' apps-hdr-sw-btn--on' : ''}`}
              onClick={() => onTabChange?.('uninstall')}
            >
              <span className="apps-hdr-sw-btn-icon"><Trash2 size={15} strokeWidth={2} /></span>
              <span className="apps-hdr-sw-btn-body">
                <span className="apps-hdr-sw-btn-title">Uninstall Apps</span>
                <span className="apps-hdr-sw-btn-sub">Remove &amp; clean up</span>
              </span>
            </button>
          </div>
        </div>
        <div className="au-toolbar-r">
          {phase === 'list' && !loading && apps.length > 0 && (
            <span className="au-stat"><CheckCircle size={10} /> {apps.length} Apps Installed</span>
          )}
          <button className="au-icon-btn" onClick={fetchApps} disabled={loading} title="Refresh">
            <RefreshCw size={13} className={loading ? 'au-spin' : ''} />
          </button>
        </div>
      </div>

      <div className={`au-body${phase !== 'list' ? ' au-body--dim' : ''}`}>
        {loading ? (
          <div className="au-loading">
            <Loader2 size={28} className="au-spin" />
            <span>Scanning installed programs...</span>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="au-empty">
            {searchQuery ? 'No apps match your search' : 'No installed apps found'}
          </div>
        ) : (
        <motion.div className="au-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {filteredApps.map((app, i) => (
              <div key={`${app.name}-${i}`} className="au-card">
                <div className="au-card-icon">
                  <AppIconNative app={app} size={16} />
                </div>
                <div className="au-card-info">
                  <span className="au-card-name">{app.name}</span>
                  <span className="au-card-meta">
                    {[app.publisher, app.version ? `v${app.version}` : null, app.size > 0 ? `${app.size} MB` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <button
                  className="au-card-del"
                  onClick={() => startUninstall(app)}
                  title={`Uninstall ${app.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </motion.div>
        )}
      </div>

      {/* ══ UNIFIED UNINSTALL OVERLAY ══ */}
      <AnimatePresence>
        {phase !== 'list' && targetApp && (
          <motion.div
            className="au-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className={`au-ovl-card${phase === 'leftovers' ? ' au-ovl-card--lg' : ''}`}
              initial={{ opacity: 0, scale: 0.90, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.90, y: 18 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            >
              {/* App identity — always visible */}
              <div className="au-ovl-header">
                <div className="au-ovl-app-icon">
                  <AppIconNative app={targetApp} size={22} />
                </div>
                <div>
                  <p className="au-ovl-app-name">{targetApp.name}</p>
                  {targetApp.publisher && <p className="au-ovl-app-pub">{targetApp.publisher}</p>}
                </div>
              </div>

              {/* Phase-switching content */}
              <AnimatePresence mode="wait">
                {/* ── Choose mode ── */}
                {phase === 'confirm' && (
                  <motion.div key="confirm" className="au-ovl-body"
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}>
                    <p className="au-ovl-prompt">How would you like to uninstall?</p>
                    <div className="au-ovl-opts">
                      <button className="au-ovl-opt" onClick={() => confirmUninstall('safe')}>
                        <span className="au-ovl-opt-ico au-ovl-opt-ico--safe"><ShieldCheck size={18} /></span>
                        <span className="au-ovl-opt-body">
                          <span className="au-ovl-opt-title">Uninstall App Only</span>
                          <span className="au-ovl-opt-desc">Run native uninstaller, no leftover scan</span>
                        </span>
                        <ChevronRight size={14} className="au-ovl-opt-arrow" />
                      </button>
                      <button className="au-ovl-opt au-ovl-opt--deep" onClick={() => confirmUninstall('moderate')}>
                        <span className="au-ovl-opt-ico au-ovl-opt-ico--deep"><ShieldAlert size={18} /></span>
                        <span className="au-ovl-opt-body">
                          <span className="au-ovl-opt-title">Uninstall + Clean Leftovers</span>
                          <span className="au-ovl-opt-desc">Uninstall then deep-scan files, registry &amp; tasks</span>
                        </span>
                        <ChevronRight size={14} className="au-ovl-opt-arrow" />
                      </button>
                    </div>
                    <button className="au-ovl-cancel" onClick={backToList}>Cancel</button>
                  </motion.div>
                )}

                {/* ── In progress ── */}
                {(phase === 'uninstalling' || phase === 'scanning' || phase === 'deleting') && (
                  <motion.div key="progress" className="au-ovl-body au-ovl-body--center"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}>
                    <Loader2 size={28} className="au-spin au-ovl-spinner" />
                    <p className="au-ovl-progress-msg">{progressMsg}</p>
                    {phase === 'uninstalling' && (
                      <button className="au-ovl-cancel" onClick={cancelUninstall}>Cancel</button>
                    )}
                  </motion.div>
                )}

                {/* ── Leftovers found ── */}
                {phase === 'leftovers' && (
                  <motion.div key="leftovers" className="au-ovl-body"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}>
                    <div className="au-ovl-leftover-meta">
                      <AlertTriangle size={14} className="au-warn-icon" />
                      <span>{leftovers.length} leftover items found</span>
                      <span className="au-leftover-summary">&middot; {fmtSize(leftoverTotalSize)}</span>
                    </div>
                    <div className="au-leftover-groups au-ovl-groups">
                      {Object.entries(groupedLeftovers).map(([type, items]) => {
                        const collapsed = collapsedGroups.has(type);
                        const allSelected = items.every(i => i.selected);
                        const someSelected = items.some(i => i.selected);
                        return (
                          <div key={type} className="au-group">
                            <div className="au-group-header">
                              <button className="au-group-toggle" onClick={() => toggleGroup(type)}>
                                {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                <span className="au-group-icon">{TYPE_ICONS[type]}</span>
                                <span className="au-group-label">{TYPE_LABELS[type] || type}</span>
                                <span className="au-group-count">{items.length}</span>
                              </button>
                              <button
                                className={`au-group-check${allSelected ? ' au-group-check--all' : someSelected ? ' au-group-check--some' : ''}`}
                                onClick={() => selectAllOfType(type, !allSelected)}
                                title={allSelected ? 'Deselect all' : 'Select all'}
                              >
                                <Check size={10} />
                              </button>
                            </div>
                            {!collapsed && (
                              <div className="au-group-items">
                                {items.map((item, idx) => {
                                  const globalIdx = leftovers.indexOf(item);
                                  return (
                                    <div
                                      key={idx}
                                      className={`au-leftover-item${item.selected ? ' au-leftover-item--sel' : ''}`}
                                      onClick={() => toggleLeftover(globalIdx)}
                                    >
                                      <div className={`au-item-check${item.selected ? ' au-item-check--on' : ''}`}>
                                        {item.selected && <Check size={9} />}
                                      </div>
                                      <span className="au-item-path" title={item.path}>{item.path}</span>
                                      {item.detail && <span className="au-item-detail">{item.detail}</span>}
                                      {item.size > 0 && <span className="au-item-size">{fmtSize(item.size)}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="au-ovl-leftover-footer">
                      <span className="au-leftover-sel">{selectedCount} selected &middot; {fmtSize(selectedSize)}</span>
                      <div className="au-panel-actions">
                        <button className="au-btn au-btn--secondary" onClick={backToList}>Skip</button>
                        <button className="au-btn au-btn--danger" onClick={deleteLeftovers} disabled={selectedCount === 0}>
                          <Trash2 size={13} /> Delete Selected
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ── Done ── */}
                {phase === 'done' && (
                  <motion.div key="done" className="au-ovl-body au-ovl-body--center"
                    initial={{ opacity: 0, scale: 0.90 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.20 }}>
                    <CheckCircle size={32} className="au-done-icon" />
                    <h3 className="au-ovl-done-title">
                      {scanMode === 'safe' ? 'Uninstalled Successfully' : 'Cleanup Complete'}
                    </h3>
                    {scanMode === 'safe' ? (
                      <p className="au-done-detail">{targetApp?.name} has been uninstalled</p>
                    ) : deleteResult && deleteResult.deletedCount > 0 ? (
                      <p className="au-done-detail">
                        Removed {deleteResult.deletedCount} leftover items
                        {deleteResult.freedBytes > 0 ? ` — freed ${fmtSize(deleteResult.freedBytes)}` : ''}
                      </p>
                    ) : (
                      <p className="au-done-detail">No leftovers found — clean uninstall</p>
                    )}
                    <button className="au-btn au-btn--primary" onClick={backToList}>Back to App List</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AppUninstaller;

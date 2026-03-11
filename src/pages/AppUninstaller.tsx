import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  LayoutGrid,
} from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
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
  displayIcon: string;
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
  refreshSignal?: number;
  onAppUninstalled?: () => void;
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
      .invoke('appuninstall:get-icon', app.installLocation, app.uninstallString, app.displayIcon)
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
  const domain = getAppDomain(app.name, app.publisher);
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
      `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`,
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
  steelseries: 'steelseries.com',
  amd: 'amd.com', 'msi afterburner': 'msi.com', hwinfo: 'hwinfo.com',
  'cpu-z': 'cpuid.com', 'gpu-z': 'techpowerup.com',
  'ea ': 'ea.com', ubisoft: 'ubisoft.com', streamlabs: 'streamlabs.com',
  eartrumpet: 'eartrumpet.app',
  // Adobe
  'adobe premiere': 'adobe.com', 'adobe photoshop': 'adobe.com',
  'adobe after effects': 'adobe.com', 'adobe illustrator': 'adobe.com',
  'adobe creative': 'adobe.com', 'adobe acrobat': 'adobe.com', adobe: 'adobe.com',
  // Remote / Streaming
  anydesk: 'anydesk.com', parsec: 'parsec.app', teamviewer: 'teamviewer.com',
  // Games & Launchers
  'apex legends': 'ea.com', valorant: 'playvalorant.com',
  'riot client': 'riotgames.com', 'riot vanguard': 'riotgames.com', 'riot games': 'riotgames.com',
  'rockstar games': 'rockstargames.com', 'grand theft auto': 'rockstargames.com',
  'gog galaxy': 'gog.com', 'amazon games': 'gaming.amazon.com',
  'google play games': 'play.google.com',
  // NVIDIA (all components)
  nvidia: 'nvidia.com', nvcpl: 'nvidia.com', nvcontainer: 'nvidia.com',
  geforce: 'nvidia.com', 'physx': 'nvidia.com', nvdlisr: 'nvidia.com',
  shadowplay: 'nvidia.com', 'frameview': 'nvidia.com',
  // Intel
  'intel(r)': 'intel.com', intel: 'intel.com', 'intelr': 'intel.com',
  // Realtek
  realtek: 'realtek.com',
  // Microsoft tools
  powershell: 'microsoft.com', 'microsoft .net': 'microsoft.com',
  'microsoft asp': 'microsoft.com', 'microsoft visual c': 'microsoft.com',
  'microsoft windows des': 'microsoft.com',
  // Internet / Download
  'internet download manager': 'internetdownloadmanager.com',
  // Misc
  'davinci resolve': 'blackmagicdesign.com', audacity: 'audacityteam.org',
  gimp: 'gimp.org', 'libre office': 'libreoffice.org', libreoffice: 'libreoffice.org',
  'wire shark': 'wireshark.org', wireshark: 'wireshark.org',
  postman: 'postman.com', figma: 'figma.com', notion: 'notion.so',
  slack: 'slack.com', signal: 'signal.org', whatsapp: 'whatsapp.com',
  'google play': 'play.google.com',
  rsreloaded: 'rsreloaded.com', 'documentation manager': 'intel.com',
  'intelr software': 'intel.com',
};
const PUBLISHER_DOMAINS: Record<string, string> = {
  'nvidia corporation': 'nvidia.com',
  'intel corporation': 'intel.com',
  'microsoft corporation': 'microsoft.com',
  'realtek semiconductor': 'realtek.com',
  'realtek': 'realtek.com',
  'riot games': 'riotgames.com',
  'rockstar games': 'rockstargames.com',
  'adobe': 'adobe.com',
  'adobe systems': 'adobe.com',
  'valve corporation': 'steampowered.com',
  'parsec cloud': 'parsec.app',
  'vs revo group': 'revouninstaller.com',
  'the git development': 'git-scm.com',
  'node.js foundation': 'nodejs.org',
  'steelseries': 'steelseries.com',
  'tonec inc': 'internetdownloadmanager.com',
  'spotify ab': 'spotify.com',
  'brave software': 'brave.com',
  'discord inc': 'discord.com',
  'google llc': 'google.com',
  'anydesk software': 'anydesk.com',
  'respawn': 'ea.com',
};
function getAppDomain(name: string, publisher?: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, domain] of Object.entries(KNOWN_DOMAINS)) {
    if (lower.includes(key)) return domain;
  }
  if (publisher) {
    const lowerPub = publisher.toLowerCase();
    for (const [key, domain] of Object.entries(PUBLISHER_DOMAINS)) {
      if (lowerPub.includes(key)) return domain;
    }
  }
  return undefined;
}

/* ─── Component ──────────────────────────────────────────────────── */
const AppUninstaller: React.FC<AppUninstallerProps> = ({ isActive = false, activeTab = 'uninstall', onTabChange, refreshSignal = 0, onAppUninstalled }) => {
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
    if (isActive && !loading) {
      hasLoaded.current = true;
      fetchApps();
    }
  }, [isActive, fetchApps]);

  // Silent refresh triggered by the other tab (e.g. app was installed)
  useEffect(() => {
    if (refreshSignal > 0) fetchApps();
  }, [refreshSignal, fetchApps]);

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
    setScanMode(mode);
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
    onAppUninstalled?.(); // Notify installer tab to re-check
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
      {/* ── Page header ── */}
      <PageHeader icon={<LayoutGrid size={16} />} title="Apps Manager" />

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

      {/* ══ POPUP WIZARD OVERLAY ══ */}
      {createPortal(
        <AnimatePresence>
          {phase !== 'list' && targetApp && (
            <motion.div
              className="au-wiz-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => { if (e.target === e.currentTarget && phase === 'confirm') backToList(); }}
            >
              <motion.div
                className={`au-wiz${phase === 'leftovers' ? ' au-wiz--wide' : ''}`}
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                {/* ── Header bar ── */}
                <div className="au-wiz-header">
                  <div className="au-wiz-header-left">
                    <div className="au-wiz-header-icon">
                      <AppIconNative app={targetApp} size={22} />
                    </div>
                    <div className="au-wiz-header-info">
                      <span className="au-wiz-header-name">{targetApp.name}</span>
                      <div className="au-wiz-steps">
                        {[
                          { key: 'select', label: 'Select', num: 1 },
                          { key: 'remove', label: 'Remove', num: 2 },
                          { key: 'clean',  label: 'Clean',  num: 3 },
                          { key: 'finish', label: 'Done',   num: 4 },
                        ].map((step, i) => {
                          const stepPhases: Record<string, string[]> = {
                            select: ['confirm'],
                            remove: ['uninstalling'],
                            clean: ['scanning', 'deleting', 'leftovers'],
                            finish: ['done'],
                          };
                          const isActive = stepPhases[step.key].includes(phase);
                          const isPast = (() => {
                            const order = ['confirm', 'uninstalling', 'scanning', 'leftovers', 'deleting', 'done'];
                            const stepFirstPhase = stepPhases[step.key][0];
                            return order.indexOf(phase) > order.indexOf(stepFirstPhase);
                          })();
                          const cls = `au-wiz-step${isActive ? ' au-wiz-step--active' : ''}${isPast ? ' au-wiz-step--done' : ''}`;
                          return (
                            <React.Fragment key={step.key}>
                              {i > 0 && <div className={`au-wiz-step-line${isPast ? ' au-wiz-step-line--done' : ''}${isActive ? ' au-wiz-step-line--active' : ''}`} />}
                              <div className={cls}>
                                <span className="au-wiz-step-dot">
                                  {isPast ? <Check size={10} strokeWidth={3} /> : step.num}
                                </span>
                                <span className="au-wiz-step-label">{step.label}</span>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {(phase === 'confirm' || phase === 'uninstalling') && (
                    <button className="au-wiz-close" onClick={phase === 'confirm' ? backToList : cancelUninstall}>
                      <X size={16} />
                    </button>
                  )}
                </div>

                {/* ── Body ── */}
                <div className="au-wiz-body">
                  <AnimatePresence mode="wait">
                    {/* ── STEP 1: Choose method ── */}
                    {phase === 'confirm' && (
                      <motion.div key="confirm" className="au-wiz-panel"
                        initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 32 }}>
                        <div className="au-wiz-section-header">
                          <h2 className="au-wiz-title">How do you want to remove this app?</h2>
                          <p className="au-wiz-subtitle">Choose a removal method for <strong>{targetApp.name}</strong></p>
                        </div>

                        <div className="au-wiz-methods">
                          <button className="au-method au-method--safe" onClick={() => confirmUninstall('safe')}>
                            <div className="au-method-glow" />
                            <div className="au-method-icon"><ShieldCheck size={24} /></div>
                            <div className="au-method-info">
                              <span className="au-method-name">Quick Remove</span>
                              <span className="au-method-desc">Runs the app's native uninstaller. Fast and straightforward.</span>
                            </div>
                            <div className="au-method-tag">Recommended</div>
                            <ChevronRight size={16} className="au-method-arrow" />
                          </button>

                          <button className="au-method au-method--deep" onClick={() => confirmUninstall('moderate')}>
                            <div className="au-method-glow" />
                            <div className="au-method-icon"><ShieldAlert size={24} /></div>
                            <div className="au-method-info">
                              <span className="au-method-name">Deep Clean</span>
                              <span className="au-method-desc">Uninstall then scan for leftover files, registry keys &amp; scheduled tasks.</span>
                            </div>
                            <div className="au-method-tag">Thorough</div>
                            <ChevronRight size={16} className="au-method-arrow" />
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {/* ── STEP 2: In progress ── */}
                    {(phase === 'uninstalling' || phase === 'scanning' || phase === 'deleting') && (
                      <motion.div key="progress" className="au-wiz-panel au-wiz-panel--center"
                        initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 32 }}>
                        <div className="au-wiz-progress-stage">
                          <div className="au-wiz-progress-orb">
                            <div className="au-wiz-orb-pulse" />
                            <svg className="au-wiz-orb-svg" viewBox="0 0 100 100">
                              <circle className="au-wiz-orb-track" cx="50" cy="50" r="42" />
                              <circle className="au-wiz-orb-arc" cx="50" cy="50" r="42" />
                            </svg>
                            <div className="au-wiz-orb-center">
                              <AppIconNative app={targetApp} size={22} />
                            </div>
                          </div>

                          <div className="au-wiz-progress-text">
                            <h2 className="au-wiz-progress-title">
                              {phase === 'uninstalling' ? 'Removing application...' : phase === 'scanning' ? 'Scanning for leftovers...' : 'Cleaning selected items...'}
                            </h2>
                            <p className="au-wiz-progress-detail">{progressMsg}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* ── STEP 3: Leftovers ── */}
                    {phase === 'leftovers' && (
                      <motion.div key="leftovers" className="au-wiz-panel"
                        initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 32 }}>
                        <div className="au-wiz-section-header">
                          <div className="au-wiz-leftovers-title-row">
                            <h2 className="au-wiz-title">Leftover files detected</h2>
                            <div className="au-wiz-leftover-badge">
                              <AlertTriangle size={12} />
                              <span>{leftovers.length} items</span>
                              <span className="au-wiz-leftover-size">{fmtSize(leftoverTotalSize)}</span>
                            </div>
                          </div>
                          <p className="au-wiz-subtitle">Select items to remove, or skip to finish.</p>
                        </div>

                        <div className="au-wiz-leftover-list au-ovl-groups">
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
                                          <span className="au-item-path" title={item.path}>
                                            {item.path.includes(' → ') ? item.path.split(' → ')[1] : item.path}
                                          </span>
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

                        <div className="au-wiz-leftover-actions">
                          <span className="au-wiz-sel-info">{selectedCount} selected &middot; {fmtSize(selectedSize)}</span>
                          <div className="au-panel-actions">
                            <button className="au-btn au-btn--ghost" onClick={backToList}>Skip</button>
                            <button className="au-btn au-btn--danger" onClick={deleteLeftovers} disabled={selectedCount === 0}>
                              <Trash2 size={12} /> Delete Selected
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* ── STEP 4: Done ── */}
                    {phase === 'done' && (
                      <motion.div key="done" className="au-wiz-panel au-wiz-panel--center"
                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
                        <div className="au-wiz-done-stage">
                          <motion.div className="au-wiz-done-ring"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}>
                            <motion.div
                              initial={{ scale: 0, rotate: -120 }}
                              animate={{ scale: 1, rotate: 0 }}
                              transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.25 }}>
                              <CheckCircle size={36} className="au-wiz-done-check" />
                            </motion.div>
                          </motion.div>

                          <motion.div className="au-wiz-done-text"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.35, duration: 0.3 }}>
                            <h2 className="au-wiz-done-title">
                              {scanMode === 'safe' ? 'Successfully Removed' : 'Deep Clean Complete'}
                            </h2>
                            {scanMode === 'safe' ? (
                              <p className="au-wiz-done-detail">{targetApp?.name} has been removed from your system.</p>
                            ) : deleteResult && deleteResult.deletedCount > 0 ? (
                              <p className="au-wiz-done-detail">
                                Cleaned {deleteResult.deletedCount} leftover{deleteResult.deletedCount !== 1 ? 's' : ''}
                                {deleteResult.freedBytes > 0 ? ` — freed ${fmtSize(deleteResult.freedBytes)}` : ''}
                              </p>
                            ) : (
                              <p className="au-wiz-done-detail">No leftovers found — clean removal.</p>
                            )}
                            <button className="au-btn au-btn--primary au-wiz-done-btn" onClick={backToList}>
                              <CheckCircle size={13} /> Close
                            </button>
                          </motion.div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
};

export default AppUninstaller;

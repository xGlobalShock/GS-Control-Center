import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Trash2,
  CheckCircle,
  Search,
  Loader2,
  X,
  RefreshCw,
  Globe,
  MessageCircle,
  Gamepad2,
  Wrench,
  Radio,
  Code2,
  FolderCog,
  Music,
  Check,
  LayoutGrid,
  Sparkles,
} from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { APP_CATALOG, APP_CATEGORIES, CatalogApp } from '../data/appCatalog';
import '../styles/AppInstaller.css';

interface InstallProgress {
  packageId: string;
  phase: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  status: string;
  percent: number;
}

type AppTab = 'install' | 'uninstall';

interface AppInstallerProps {
  isActive?: boolean;
  activeTab?: AppTab;
  onTabChange?: (tab: AppTab) => void;
}

/* Category → icon */
const CAT_ICONS: Record<string, React.ReactNode> = {
  'Browsers': <Globe size={14} />,
  'Communications': <MessageCircle size={14} />,
  'Gaming': <Gamepad2 size={14} />,
  'Gaming Tools': <Wrench size={14} />,
  'Streaming & Audio': <Radio size={14} />,
  'Development': <Code2 size={14} />,
  'Utilities': <FolderCog size={14} />,
  'Media': <Music size={14} />,
};

/* App favicon — fetched via main process (avoids renderer CSP/CORS) */
const _aiIconCache = new Map<string, string>();

const AppIcon: React.FC<{ domain?: string; name: string; size?: number }> = ({ domain, name, size = 16 }) => {
  const [iconUrl, setIconUrl] = React.useState<string | null>(
    () => domain ? (_aiIconCache.get(domain) ?? null) : null
  );

  React.useEffect(() => {
    if (!domain) { setIconUrl(null); return; }
    if (_aiIconCache.has(domain)) { setIconUrl(_aiIconCache.get(domain)!); return; }
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
          _aiIconCache.set(domain, r.dataUrl);
          setIconUrl(r.dataUrl);
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [domain]);

  if (iconUrl) {
    return (
      <img src={iconUrl} width={size} height={size} alt="" draggable={false}
        style={{ borderRadius: 4, objectFit: 'contain', flexShrink: 0 }} />
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

const AppInstaller: React.FC<AppInstallerProps> = ({ isActive = false, activeTab = 'install', onTabChange }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingInstalled, setCheckingInstalled] = useState(false);
  const [activeCat, setActiveCat] = useState('All');
  const hasChecked = useRef(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('appinstall:install-progress', (data: InstallProgress) => {
      setProgress(data);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // Listen for preloaded installed-app data pushed from backend during splash
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('appinstall:preloaded', (data: any) => {
      if (data?.success && data.installed) {
        setInstalled(prev => {
          const merged = new Set<string>(prev);
          for (const [id, ok] of Object.entries(data.installed)) { if (ok) merged.add(id); }
          return merged;
        });
        hasChecked.current = true;
      }
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const checkInstalled = useCallback(async (forceRefresh = false) => {
    if (!window.electron?.ipcRenderer) return;
    setCheckingInstalled(true);
    try {
      const allApps = APP_CATALOG.map(a => ({ id: a.id, name: a.name }));
      const result = await window.electron.ipcRenderer.invoke('appinstall:check-installed', allApps, forceRefresh);
      if (result.success) {
        const set = new Set<string>();
        for (const [id, ok] of Object.entries(result.installed)) { if (ok) set.add(id); }
        setInstalled(set);
      }
    } catch { /* ignore */ }
    finally { setCheckingInstalled(false); }
  }, []);

  // Fallback: if preloaded data hasn't arrived when page becomes active, scan silently
  useEffect(() => {
    if (isActive && !hasChecked.current) {
      hasChecked.current = true;
      (async () => {
        if (!window.electron?.ipcRenderer) return;
        try {
          const allApps = APP_CATALOG.map(a => ({ id: a.id, name: a.name }));
          const result = await window.electron.ipcRenderer.invoke('appinstall:check-installed', allApps, false);
          if (result.success) {
            setInstalled(prev => {
              const merged = new Set<string>(prev);
              for (const [id, ok] of Object.entries(result.installed)) { if (ok) merged.add(id); }
              return merged;
            });
          }
        } catch {}
      })();
    }
  }, [isActive]);

  const refreshInstalled = useCallback(() => {
    hasChecked.current = false; setInstalled(new Set()); checkInstalled(true);
  }, [checkInstalled]);

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const clearSelection = () => setSelected(new Set());

  const handleInstallSingle = async (app: CatalogApp) => {
    if (!window.electron?.ipcRenderer) return;
    setInstallingId(app.id);
    setProgress(null);
    try {
      const result = await window.electron.ipcRenderer.invoke('appinstall:install-app', app.id);
      if (result.success) {
        addToast(`${app.name} installed successfully!`, 'success');
        setInstalled(prev => new Set(prev).add(app.id));
        setSelected(prev => { const n = new Set(prev); n.delete(app.id); return n; });
      } else if (result.message !== 'Installation cancelled by user') {
        addToast(result.message || `Failed to install ${app.name}`, 'error');
      }
    } catch { addToast(`Error installing ${app.name}`, 'error'); }
    finally { setTimeout(() => setProgress(null), 1500); setInstallingId(null); }
  };

  const handleCancelInstall = async () => {
    if (!window.electron?.ipcRenderer) return;
    try {
      await window.electron.ipcRenderer.invoke('appinstall:cancel-install');
      addToast('Installation cancelled', 'info');
    } catch { /* ignore */ }
  };

  const handleInstallSelected = async () => {
    if (!window.electron?.ipcRenderer || selected.size === 0) return;
    const ids = Array.from(selected);
    const names = APP_CATALOG.reduce((a, c) => { a[c.id] = c.name; return a; }, {} as Record<string, string>);
    addToast(`Installing ${ids.length} app${ids.length > 1 ? 's' : ''}…`, 'info');
    let wasCancelled = false;
    for (const id of ids) {
      setInstallingId(id);
      setProgress(null);
      try {
        const r = await window.electron.ipcRenderer.invoke('appinstall:install-app', id);
        if (r.success) {
          setInstalled(prev => new Set(prev).add(id));
          setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
        } else if (r.message === 'Installation cancelled by user') {
          wasCancelled = true;
          break;
        } else { addToast(`Failed: ${names[id] || id}`, 'error'); }
      } catch { addToast(`Error: ${names[id] || id}`, 'error'); }
    }
    setInstallingId(null);
    setTimeout(() => setProgress(null), 2500);
    if (!wasCancelled) addToast('Batch install complete!', 'success');
  };

  /* Filter: category tab → search → sort A-Z */
  const visibleApps = useMemo(() => {
    let apps = activeCat === 'All' ? [...APP_CATALOG] : APP_CATALOG.filter(a => a.category === activeCat);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      apps = apps.filter(a => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q));
    }
    apps.sort((a, b) => {
      const aNum = /^[\d.]/.test(a.name);
      const bNum = /^[\d.]/.test(b.name);
      if (aNum !== bNum) return aNum ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return apps;
  }, [activeCat, searchQuery]);

  /* Badge counts for tabs */
  const catCounts = useMemo(() => {
    const c: Record<string, number> = { All: APP_CATALOG.length };
    APP_CATEGORIES.forEach(cat => { c[cat] = APP_CATALOG.filter(a => a.category === cat).length; });
    return c;
  }, []);

  return (
    <motion.div className="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      {/* ── Toolbar ── */}
      <div className="ai-toolbar">
        <div className="ai-toolbar-l">
          <div className="ai-search-wrap">
            <Search size={12} className="ai-search-icon" />
            <input
              className="ai-search"
              placeholder="Search apps…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="ai-search-x" onClick={() => setSearchQuery('')}><X size={11} /></button>
            )}
          </div>
        </div>
        <div className="ai-toolbar-c">
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
        <div className="ai-toolbar-r">
          {checkingInstalled
            ? <span className="ai-stat"><Loader2 size={10} className="ai-spin" /> Scanning…</span>
            : installed.size > 0
              ? <span className="ai-stat"><CheckCircle size={10} /> {installed.size}/{APP_CATALOG.length} Apps Installed</span>
              : null
          }
          <button className="ai-icon-btn" onClick={refreshInstalled} disabled={checkingInstalled} title="Re-scan">
            <RefreshCw size={13} className={checkingInstalled ? 'ai-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Category pills ── */}
      <div className="ai-cats">
        {(['All', ...APP_CATEGORIES] as string[]).map(cat => (
          <button
            key={cat}
            className={`ai-cat${activeCat === cat ? ' ai-cat--on' : ''}`}
            onClick={() => setActiveCat(cat)}
          >
            {cat === 'All' ? <LayoutGrid size={12} /> : <span className="ai-cat-ico">{CAT_ICONS[cat]}</span>}
            <span>{cat}</span>
            <span className="ai-cat-n">{catCounts[cat]}</span>
          </button>
        ))}
      </div>

      {/* ── App grid ── */}
      <div className="ai-grid">
          {visibleApps.map((app) => {
            const done = installed.has(app.id);
            const sel = selected.has(app.id);
            const busy = installingId === app.id;
            const prog = progress?.packageId === app.id ? progress : null;

            return (
              <div
                key={app.id}
                className={`ai-card${sel ? ' ai-card--sel' : ''}${done ? ' ai-card--done' : ''}${busy ? ' ai-card--busy' : ''}`}
                onClick={() => !done && !busy && toggleSelect(app.id)}
              >
                {/* Status icon */}
                <div className="ai-card-icon">
                  {done ? (
                    <span className="ai-card-sel-icon">
                      <AppIcon domain={app.domain} name={app.name} size={16} />
                      <span className="ai-card-check-badge ai-card-check-badge--done"><Check size={8} /></span>
                    </span>
                  ) : busy ? <Loader2 size={15} className="ai-spin" />
                    : sel ? (
                      <span className="ai-card-sel-icon">
                        <AppIcon domain={app.domain} name={app.name} size={16} />
                        <span className="ai-card-check-badge"><Check size={8} /></span>
                      </span>
                    )
                    : <AppIcon domain={app.domain} name={app.name} size={16} />}
                </div>

                <div className="ai-card-info">
                  <span className="ai-card-name">{app.name}</span>
                  {activeCat === 'All' && <span className="ai-card-cat">{app.category}</span>}
                  {busy && prog && (
                    <span className={`ai-card-phase ai-card-phase--${prog.phase}`}>
                      {prog.phase === 'preparing' && 'Preparing…'}
                      {prog.phase === 'downloading' && 'Downloading…'}
                      {prog.phase === 'installing' && 'Installing…'}
                      {prog.phase === 'verifying' && 'Verifying…'}
                      {prog.phase === 'done' && 'Done!'}
                      {prog.phase === 'error' && 'Failed'}
                    </span>
                  )}
                  {done && <span className="ai-card-installed">Installed</span>}
                </div>

                {!done && !busy && (
                  <button
                    className="ai-card-dl"
                    onClick={e => { e.stopPropagation(); handleInstallSingle(app); }}
                    title={`Install ${app.name}`}
                  >
                    <Download size={12} />
                  </button>
                )}
                {busy && (
                  <button
                    className="ai-card-cancel"
                    onClick={e => { e.stopPropagation(); handleCancelInstall(); }}
                    title="Cancel installation"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}

        {visibleApps.length === 0 && (
          <div className="ai-empty">
            <Search size={28} strokeWidth={1} />
            <p>No apps found</p>
          </div>
        )}
      </div>

      {/* ── Floating install dock ── */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            className="ai-dock"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="ai-dock-left">
              <Sparkles size={15} />
              <span><strong>{selected.size}</strong> app{selected.size > 1 ? 's' : ''} selected</span>
            </div>
            <div className="ai-dock-right">
              {installingId ? (
                <button className="ai-dock-cancel" onClick={handleCancelInstall}>
                  <X size={13} /> Cancel
                </button>
              ) : (
                <>
                  <button className="ai-dock-clear" onClick={clearSelection}><X size={13} /> Clear</button>
                  <button className="ai-dock-go" onClick={handleInstallSelected}>
                    <Download size={14} /> Install All
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AppInstaller;

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  CheckCircle,
  Search,
  Package,
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
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import { APP_CATALOG, APP_CATEGORIES, CatalogApp } from '../data/appCatalog';
import '../styles/AppInstaller.css';

interface InstallProgress {
  packageId: string;
  phase: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  status: string;
  percent: number;
}

interface AppInstallerProps {
  isActive?: boolean;
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

const AppInstaller: React.FC<AppInstallerProps> = ({ isActive = false }) => {
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

  const checkInstalled = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    const allApps = APP_CATALOG.map(a => ({ id: a.id, name: a.name }));

    // Phase 1: instant registry scan (~100ms cached, ~200ms cold)
    try {
      const fast = await window.electron.ipcRenderer.invoke('appinstall:check-installed-fast', allApps);
      if (fast.success) {
        const set = new Set<string>();
        for (const [id, ok] of Object.entries(fast.installed)) { if (ok) set.add(id); }
        setInstalled(set);
      }
    } catch { /* ignore — full scan will cover it */ }

    // Phase 2: full winget refinement (background, no spinner — Phase 1 already populated)
    setCheckingInstalled(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('appinstall:check-installed', allApps);
      if (result.success) {
        const set = new Set<string>();
        for (const [id, ok] of Object.entries(result.installed)) { if (ok) set.add(id); }
        setInstalled(set);
      }
    } catch { /* ignore */ }
    finally { setCheckingInstalled(false); }
  }, []);

  useEffect(() => {
    if (isActive && !hasChecked.current) { hasChecked.current = true; checkInstalled(); }
  }, [isActive, checkInstalled]);

  const refreshInstalled = useCallback(() => {
    hasChecked.current = false; setInstalled(new Set()); checkInstalled();
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
    <motion.div className="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <PageHeader
        icon={<Package size={16} />}
        title="App Installer"
        stat={
          <div className="ai-header-row">
            <div className="ai-search-wrap ai-search-wrap--header">
              <Search size={13} className="ai-search-icon" />
              <input
                className="ai-search"
                placeholder="Search apps…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="ai-search-x" onClick={() => setSearchQuery('')}><X size={13} /></button>
              )}
            </div>
            {checkingInstalled
              ? <span className="ai-stat"><Loader2 size={12} className="ai-spin" /> Scanning…</span>
              : installed.size > 0
                ? <span className="ai-stat"><CheckCircle size={12} /> {installed.size}/{APP_CATALOG.length} installed</span>
                : null
            }
          </div>
        }
        actions={
          <div className="ai-actions">
            <button className="ai-icon-btn" onClick={refreshInstalled} disabled={checkingInstalled} title="Re-scan">
              <RefreshCw size={14} className={checkingInstalled ? 'ai-spin' : ''} />
            </button>
          </div>
        }
      />

      {/* ── Category tabs ── */}
      <div className="ai-tabs">
        {(['All', ...APP_CATEGORIES] as string[]).map(cat => (
          <button
            key={cat}
            className={`ai-tab ${activeCat === cat ? 'ai-tab--active' : ''}`}
            onClick={() => setActiveCat(cat)}
          >
            {cat !== 'All' && <span className="ai-tab-icon">{CAT_ICONS[cat]}</span>}
            {cat === 'All' && <LayoutGrid size={13} />}
            <span>{cat}</span>
            <span className="ai-tab-count">{catCounts[cat]}</span>
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
                  {done ? <CheckCircle size={15} />
                    : busy ? <Loader2 size={15} className="ai-spin" />
                    : sel ? <div className="ai-card-check"><Check size={10} /></div>
                    : <div className="ai-card-dot" />}
                </div>

                <div className="ai-card-info">
                  <span className="ai-card-name">{app.name}</span>
                  {activeCat === 'All' && <span className="ai-card-cat">{app.category}</span>}
                  {busy && prog && (
                    <span className={`ai-card-phase ai-card-phase--${prog.phase}`}>
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
              <button className="ai-dock-clear" onClick={clearSelection}><X size={13} /> Clear</button>
              <button className="ai-dock-go" onClick={handleInstallSelected} disabled={installingId !== null}>
                <Download size={14} />
                {installingId ? 'Installing…' : 'Install All'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AppInstaller;

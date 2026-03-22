import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PackageX,
  Search,
  X,
  RefreshCw,
  Loader2,
  Download,
  Trash2,
  AlertTriangle,
  LayoutGrid,
  Lock,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import '../styles/WindowsDebloat.css';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface DebloatItem {
  id: string;
  name: string;
  rawName?: string;
  packageFamilyName?: string;
  version?: string;
  installed: boolean;
  nonRemovable?: boolean;
  isCatalog?: boolean;
  state?: string;
}

type DebloatTab = 'apps' | 'capabilities' | 'features';

interface WindowsDebloatProps {
  isActive?: boolean;
}

/* ─── Component ──────────────────────────────────────────────────────────── */
const WindowsDebloat: React.FC<WindowsDebloatProps> = ({ isActive = false }) => {
  const { addToast } = useToast();

  const IS_COMING_SOON = true; // LOCK / UNLOCK PAGE

  /* ── State ── */
  const [tab, setTab] = useState<DebloatTab>('apps');
  const [items, setItems] = useState<DebloatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isElevated, setIsElevated] = useState(true); // assume elevated; update if IPC says otherwise

  const hasLoaded = React.useRef<Record<DebloatTab, boolean>>({ apps: false, capabilities: false, features: false });

  /* ── IPC channel map ── */
  const LIST_CHANNEL: Record<DebloatTab, string> = {
    apps: 'wdebloat:list-apps',
    capabilities: 'wdebloat:list-capabilities',
    features: 'wdebloat:list-features',
  };
  const REMOVE_BULK_CHANNEL: Record<DebloatTab, string> = {
    apps: 'wdebloat:remove-apps',
    capabilities: 'wdebloat:remove-capabilities',
    features: 'wdebloat:remove-features',
  };
  const INSTALL_BULK_CHANNEL: Record<DebloatTab, string> = {
    apps: 'wdebloat:install-apps',
    capabilities: 'wdebloat:add-capabilities',
    features: 'wdebloat:add-features',
  };

  /* ── Fetch list for the current tab ── */
  const fetchItems = useCallback(async (targetTab: DebloatTab = tab) => {
    if (IS_COMING_SOON) return;
    if (!window.electron?.ipcRenderer) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const result = await window.electron.ipcRenderer.invoke(LIST_CHANNEL[targetTab]);
      if (result.success) {
        setItems(result.items || []);
        hasLoaded.current[targetTab] = true;
      } else {
        if (result.error?.includes('privilege') || result.error?.includes('elevation')) {
          setIsElevated(false);
        }
        addToast(result.error || 'Failed to load items', 'error');
      }
    } catch (err: any) {
      addToast('Failed to load: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  /* ── Load on activate or tab change ── */
  useEffect(() => {
    if (!isActive) return;
    if (!hasLoaded.current[tab]) {
      fetchItems(tab);
    }
  }, [isActive, tab]);

  /* ── Listen for progress events ── */
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('wdebloat:progress', (data: any) => {
      setProgressMsg(data?.msg || '');
    });
    return () => { if (unsub) unsub(); };
  }, []);

  /* ── Tab switch ── */
  const switchTab = (t: DebloatTab) => {
    if (t === tab) return;
    setTab(t);
    setSearchQuery('');
    setSelected(new Set());
    setItems([]);
    if (!hasLoaded.current[t]) {
      // fetchItems with explicit tab because state hasn't updated yet
      setTimeout(() => fetchItems(t), 0);
    }
  };

  /* ── Filtered items ── */
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  /* ── Selection helpers ── */
  const toggleItem = (id: string, nonRemovable?: boolean) => {
    if (nonRemovable) return;
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    setSelected(new Set(filtered.filter(i => !i.nonRemovable).map(i => i.id)));
  };

  const selectInstalled = () => {
    setSelected(new Set(filtered.filter(i => i.installed && !i.nonRemovable).map(i => i.id)));
  };

  const selectNotInstalled = () => {
    setSelected(new Set(filtered.filter(i => !i.installed && !i.nonRemovable).map(i => i.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const allFilteredSelected =
    filtered.filter(i => !i.nonRemovable).length > 0 &&
    filtered.filter(i => !i.nonRemovable).every(i => selected.has(i.id));

  /* ── Uninstall selected ── */
  const handleRemoveSelected = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(true);
    setProgressMsg('Starting removal…');
    try {
      const result = await window.electron.ipcRenderer.invoke(REMOVE_BULK_CHANNEL[tab], ids);
      if (result.success) {
        const failed = (result.results || []).filter((r: any) => !r.success);
        if (failed.length === 0) {
          addToast(`Removed ${ids.length} item${ids.length !== 1 ? 's' : ''} successfully`, 'success');
        } else {
          addToast(`Removed ${ids.length - failed.length}/${ids.length}. ${failed.length} failed.`, 'info');
        }
        await fetchItems(tab);
      } else {
        addToast(result.error || 'Removal failed', 'error');
      }
    } catch (err: any) {
      addToast('Error: ' + err.message, 'error');
    } finally {
      setBusy(false);
      setProgressMsg('');
    }
  };

  /* ── Install selected ── */
  const handleInstallSelected = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(true);
    setProgressMsg('Starting installation…');
    try {
      const result = await window.electron.ipcRenderer.invoke(INSTALL_BULK_CHANNEL[tab], ids);
      if (result.success) {
        const failed = (result.results || []).filter((r: any) => !r.success);
        if (failed.length === 0) {
          addToast(`Installed ${ids.length} item${ids.length !== 1 ? 's' : ''} successfully`, 'success');
        } else {
          addToast(`Installed ${ids.length - failed.length}/${ids.length}. ${failed.length} failed.`, 'info');
        }
        await fetchItems(tab);
      } else {
        addToast(result.error || 'Installation failed', 'error');
      }
    } catch (err: any) {
      addToast('Error: ' + err.message, 'error');
    } finally {
      setBusy(false);
      setProgressMsg('');
    }
  };

  /* ── Stats ── */
  const installedCount = items.filter(i => i.installed).length;
  const notInstalledCount = items.filter(i => !i.installed).length;

  /* ── Selected item breakdown ── */
  const selectedInstalled = Array.from(selected).filter(id => items.find(i => i.id === id)?.installed).length;
  const selectedNotInstalled = selected.size - selectedInstalled;

  /* ── Tab labels ── */
  const TAB_LABELS: Record<DebloatTab, string> = {
    apps: 'Windows Apps',
    capabilities: 'Capabilities',
    features: 'Optional Features',
  };

  return (
    <motion.div
      className="wd"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      {/* ── Page Header ── */}
      <PageHeader
        icon={<PackageX size={16} />}
        title="Windows Apps & Features"
        stat={
          !loading && items.length > 0 ? (
            <span style={{ fontSize: 10, color: 'rgba(145,168,195,0.45)', display: 'flex', gap: 6 }}>
              <span style={{ color: '#34d399' }}>{installedCount} installed</span>
              {notInstalledCount > 0 && <span>· {notInstalledCount} removed</span>}
            </span>
          ) : undefined
        }
      />

      {IS_COMING_SOON && (
        <div className="wd-lock-overlay">
          <Lock size={36} strokeWidth={1.5} />
          <span className="wd-lock-caption">Coming Soon</span>
          <span className="wd-lock-sub">Windows Debloat is currently in development</span>
        </div>
      )}

      {/* ── Page Content (Locked) ── */}
      <div className={`wd-content ${IS_COMING_SOON ? 'wd-content--locked' : ''}`}>
        {/* ── Not-elevated warning ── */}
        {!isElevated && (
          <div className="wd-elevate-warn">
            <AlertTriangle size={15} />
            <span>
              Some actions require <strong>Administrator</strong> privileges. Restart the app as admin to enable debloat operations.
            </span>
          </div>
        )}

        {/* ── Tab Switcher ── */}
        <div className="wd-tabs">
          {(['apps', 'capabilities', 'features'] as DebloatTab[]).map(t => (
            <button
              key={t}
              className={`wd-tab${tab === t ? ' wd-tab--active' : ''}`}
              onClick={() => switchTab(t)}
              disabled={busy}
            >
              <LayoutGrid size={12} />
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="wd-toolbar">
          <div className="wd-toolbar-l">
            {/* Search */}
            <div className="wd-search-wrap">
              <Search size={12} className="wd-search-icon" />
              <input
                className="wd-search"
                placeholder={`Search ${TAB_LABELS[tab].toLowerCase()}…`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                disabled={loading || busy}
              />
              {searchQuery && (
                <button className="wd-search-x" onClick={() => setSearchQuery('')}>
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Progress msg during bulk ops */}
            {busy && progressMsg && (
              <span className="wd-progress-msg">{progressMsg}</span>
            )}
          </div>

          <div className="wd-toolbar-r">
            {/* Install selected */}
            <button
              className="wd-btn wd-btn--install"
              onClick={handleInstallSelected}
              disabled={loading || busy || selectedNotInstalled === 0}
              title={`Install ${selectedNotInstalled} selected item${selectedNotInstalled !== 1 ? 's' : ''}`}
            >
              {busy && selectedNotInstalled > 0
                ? <Loader2 size={12} className="wd-spin" />
                : <Download size={12} />
              }
              Install Selected
              {selectedNotInstalled > 0 && <span style={{ opacity: 0.7 }}>({selectedNotInstalled})</span>}
            </button>

            {/* Uninstall selected */}
            <button
              className="wd-btn wd-btn--remove"
              onClick={handleRemoveSelected}
              disabled={loading || busy || selectedInstalled === 0}
              title={`Remove ${selectedInstalled} selected item${selectedInstalled !== 1 ? 's' : ''}`}
            >
              {busy && selectedInstalled > 0
                ? <Loader2 size={12} className="wd-spin" />
                : <Trash2 size={12} />
              }
              Uninstall Selected
              {selectedInstalled > 0 && <span style={{ opacity: 0.7 }}>({selectedInstalled})</span>}
            </button>

            {/* Refresh */}
            <button
              className="wd-icon-btn"
              onClick={() => fetchItems(tab)}
              disabled={loading || busy}
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? 'wd-spin' : ''} />
            </button>
          </div>
        </div>

        {/* ── Selection Bar ── */}
        <div className="wd-sel-bar">
          <label className="wd-check-label">
            <input
              type="checkbox"
              className="wd-check"
              checked={allFilteredSelected}
              onChange={allFilteredSelected ? clearSelection : selectAll}
              disabled={loading || busy}
            />
            Select All
          </label>
          <label className="wd-check-label">
            <input
              type="checkbox"
              className="wd-check"
              checked={filtered.filter(i => i.installed && !i.nonRemovable).length > 0 &&
                filtered.filter(i => i.installed && !i.nonRemovable).every(i => selected.has(i.id))}
              onChange={e => e.target.checked ? selectInstalled() : clearSelection()}
              disabled={loading || busy}
            />
            Select All Installed
          </label>
          <label className="wd-check-label">
            <input
              type="checkbox"
              className="wd-check"
              checked={filtered.filter(i => !i.installed && !i.nonRemovable).length > 0 &&
                filtered.filter(i => !i.installed && !i.nonRemovable).every(i => selected.has(i.id))}
              onChange={e => e.target.checked ? selectNotInstalled() : clearSelection()}
              disabled={loading || busy}
            />
            Select All Not Installed
          </label>

          {selected.size > 0 && (
            <span className="wd-sel-count">{selected.size} selected</span>
          )}
        </div>

        {/* ── Body ── */}
        <div className="wd-body">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                className="wd-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Loader2 size={28} className="wd-spin" />
                <span>Loading {TAB_LABELS[tab].toLowerCase()}…</span>
              </motion.div>
            ) : filtered.length === 0 ? (
              <motion.div
                key="empty"
                className="wd-empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <PackageX size={32} className="wd-empty-icon" />
                <span>{searchQuery ? 'No items match your search' : `No ${TAB_LABELS[tab].toLowerCase()} found`}</span>
              </motion.div>
            ) : (
              <motion.div
                key={`grid-${tab}`}
                className="wd-grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {filtered.map(item => {
                  const isSelected = selected.has(item.id);
                  const dotClass = item.installed ? 'wd-dot wd-dot--on' : 'wd-dot wd-dot--off';
                  const cardClass = [
                    'wd-card',
                    isSelected ? 'wd-card--selected' : '',
                    item.nonRemovable ? 'wd-card--non-removable' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <div
                      key={item.id}
                      className={cardClass}
                      onClick={() => toggleItem(item.id, item.nonRemovable)}
                      title={item.nonRemovable ? 'This component cannot be removed' : undefined}
                    >
                      {/* Checkbox */}
                      <div className="wd-card-cb" />

                      {/* Status dot */}
                      <span className={dotClass} />

                      {/* Info */}
                      <div className="wd-card-info">
                        <span className="wd-card-name">{item.name}</span>
                        {tab === 'apps' && item.version && (
                          <span className="wd-card-sub">v{item.version}</span>
                        )}
                        {tab !== 'apps' && item.rawName && item.rawName !== item.name && (
                          <span className="wd-card-sub" title={item.rawName}>{item.rawName}</span>
                        )}
                      </div>

                      {/* Badge for capabilities / features */}
                      {tab !== 'apps' && (
                        <span className={`wd-card-badge ${item.installed ? 'wd-card-badge--enabled' : 'wd-card-badge--disabled'}`}>
                          {item.installed ? (tab === 'features' ? 'Enabled' : 'Installed') : (tab === 'features' ? 'Disabled' : 'Not Installed')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export default WindowsDebloat;

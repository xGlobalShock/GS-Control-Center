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
  Lock,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import '../styles/WindowsDebloat.css';

/* ─── Types ──────────────────────────────────────────────────────────────── */
type DebloatSource = 'apps' | 'capabilities' | 'features';

interface DebloatItem {
  id: string;
  name: string;
  source: DebloatSource;
  rawName?: string;
  packageFamilyName?: string;
  version?: string;
  installed: boolean;
  nonRemovable?: boolean;
  isCatalog?: boolean;
  state?: string;
}

// no longer using tabs replacement


interface WindowsDebloatProps {
  isActive?: boolean;
}

/* ─── Component ──────────────────────────────────────────────────────────── */
const WindowsDebloat: React.FC<WindowsDebloatProps> = ({ isActive = false }) => {
  const { addToast } = useToast();

  const IS_COMING_SOON = true; // LOCK / UNLOCK PAGE

  /* ── State ────────────────────────────────────────────────────────────── */
  const [items, setItems] = useState<DebloatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isElevated, setIsElevated] = useState(true); // assume elevated; update if IPC says otherwise

  const hasLoaded = React.useRef<Record<DebloatSource, boolean>>({ apps: false, capabilities: false, features: false });

  /* ── IPC channel map ── */
  const LIST_CHANNEL: Record<DebloatSource, string> = {
    apps: 'wdebloat:list-apps',
    capabilities: 'wdebloat:list-capabilities',
    features: 'wdebloat:list-features',
  };
  const REMOVE_BULK_CHANNEL: Record<DebloatSource, string> = {
    apps: 'wdebloat:remove-apps',
    capabilities: 'wdebloat:remove-capabilities',
    features: 'wdebloat:remove-features',
  };
  const INSTALL_BULK_CHANNEL: Record<DebloatSource, string> = {
    apps: 'wdebloat:install-apps',
    capabilities: 'wdebloat:add-capabilities',
    features: 'wdebloat:add-features',
  };

  /* ── Fetch all sections in one view ── */
  const fetchItems = useCallback(async () => {
    if (IS_COMING_SOON) return;
    if (!window.electron?.ipcRenderer) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const [apps, caps, feats] = await Promise.all([
        window.electron.ipcRenderer.invoke(LIST_CHANNEL.apps),
        window.electron.ipcRenderer.invoke(LIST_CHANNEL.capabilities),
        window.electron.ipcRenderer.invoke(LIST_CHANNEL.features),
      ]);

      const merged: DebloatItem[] = [];
      if (apps.success) {
        merged.push(...(apps.items || []).map((i: any) => ({ ...i, source: 'apps' as DebloatSource })));
      } else {
        if (apps.error?.includes('privilege') || apps.error?.includes('elevation')) setIsElevated(false);
        addToast(apps.error || 'Failed to load apps list', 'error');
      }
      if (caps.success) {
        merged.push(...(caps.items || []).map((i: any) => ({ ...i, source: 'capabilities' as DebloatSource })));
      }
      if (feats.success) {
        merged.push(...(feats.items || []).map((i: any) => ({ ...i, source: 'features' as DebloatSource })));
      }

      setItems(merged);
      hasLoaded.current.apps = true;
      hasLoaded.current.capabilities = true;
      hasLoaded.current.features = true;
    } catch (err: any) {
      addToast('Failed to load: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Load on activate only ── */
  useEffect(() => {
    if (!isActive) return;
    if (!hasLoaded.current.apps || !hasLoaded.current.capabilities || !hasLoaded.current.features) {
      fetchItems();
    }
  }, [isActive]);

  /* ── Listen for progress events ── */
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('wdebloat:progress', (data: any) => {
      setProgressMsg(data?.msg || '');
    });
    return () => { if (unsub) unsub(); };
  }, []);


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
    const appIds: string[] = [];
    const capIds: string[] = [];
    const featIds: string[] = [];
    for (const id of ids) {
      const item = items.find(i => i.id === id);
      if (!item || item.nonRemovable) continue;
      if (item.source === 'apps') appIds.push(id);
      if (item.source === 'capabilities') capIds.push(id);
      if (item.source === 'features') featIds.push(id);
    }

    setBusy(true);
    setProgressMsg('Starting removal…');
    try {
      const allResults: any[] = [];
      if (appIds.length > 0) {
        const r = await window.electron.ipcRenderer.invoke(REMOVE_BULK_CHANNEL.apps, appIds);
        if (r.success) allResults.push(...r.results);
      }
      if (capIds.length > 0) {
        const r = await window.electron.ipcRenderer.invoke(REMOVE_BULK_CHANNEL.capabilities, capIds);
        if (r.success) allResults.push(...r.results);
      }
      if (featIds.length > 0) {
        const r = await window.electron.ipcRenderer.invoke(REMOVE_BULK_CHANNEL.features, featIds);
        if (r.success) allResults.push(...r.results);
      }

      const failed = allResults.filter((r: any) => !r.success);
      if (failed.length === 0) {
        addToast(`Removed ${ids.length} item${ids.length !== 1 ? 's' : ''} successfully`, 'success');
      } else {
        addToast(`Removed ${ids.length - failed.length}/${ids.length}. ${failed.length} failed.`, 'info');
      }
      await fetchItems();
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
    const appIds: string[] = [];
    const capIds: string[] = [];
    const featIds: string[] = [];
    for (const id of ids) {
      const item = items.find(i => i.id === id);
      if (!item) continue;
      if (item.source === 'apps') appIds.push(id);
      if (item.source === 'capabilities') capIds.push(id);
      if (item.source === 'features') featIds.push(id);
    }

    setBusy(true);
    setProgressMsg('Starting installation…');
    try {
      const allResults: any[] = [];
      if (appIds.length > 0) {
        const r = await window.electron.ipcRenderer.invoke(INSTALL_BULK_CHANNEL.apps, appIds);
        if (r.success) allResults.push(...r.results);
      }
      if (capIds.length > 0) {
        const r = await window.electron.ipcRenderer.invoke(INSTALL_BULK_CHANNEL.capabilities, capIds);
        if (r.success) allResults.push(...r.results);
      }
      if (featIds.length > 0) {
        const r = await window.electron.ipcRenderer.invoke(INSTALL_BULK_CHANNEL.features, featIds);
        if (r.success) allResults.push(...r.results);
      }

      const failed = allResults.filter((r: any) => !r.success);
      if (failed.length === 0) {
        addToast(`Installed ${ids.length} item${ids.length !== 1 ? 's' : ''} successfully`, 'success');
      } else {
        addToast(`Installed ${ids.length - failed.length}/${ids.length}. ${failed.length} failed.`, 'info');
      }
      await fetchItems();
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

  /* ── Section grouping (layout) ── */
  const apps = filtered.filter(i => i.source === 'apps');
  const capabilities = filtered.filter(i => i.source === 'capabilities');
  const features = filtered.filter(i => i.source === 'features');

  const renderItemCard = (item: DebloatItem) => {
    const isSelected = selected.has(item.id);
    const dotClass = item.installed ? 'wd-dot wd-dot--on' : 'wd-dot wd-dot--off';
    const cardClass = ['wd-card', isSelected ? 'wd-card--selected' : '', item.nonRemovable ? 'wd-card--non-removable' : ''].filter(Boolean).join(' ');

    const badgeClass = item.installed ? 'wd-card-badge wd-card-badge--enabled' : 'wd-card-badge wd-card-badge--disabled';
    let badgeText = 'Unknown';
    if (item.source === 'apps') {
      badgeText = item.installed ? 'Installed' : item.isCatalog ? 'Reinstallable' : 'Not Installed';
    } else if (item.source === 'features') {
      badgeText = item.installed ? 'Enabled' : 'Disabled';
    } else {
      badgeText = item.installed ? 'Installed' : 'Not Installed';
    }

    return (
      <div
        key={item.id}
        className={cardClass}
        onClick={() => toggleItem(item.id, item.nonRemovable)}
        title={item.nonRemovable ? 'This component cannot be removed' : undefined}
      >
        <div className="wd-card-cb" />
        <span className={dotClass} />
        <div className="wd-card-info">
          <span className="wd-card-name">{item.name}</span>
          {item.source === 'apps' && item.version && <span className="wd-card-sub">v{item.version}</span>}
          {item.source !== 'apps' && item.rawName && item.rawName !== item.name && <span className="wd-card-sub" title={item.rawName}>{item.rawName}</span>}
        </div>
        <span className={badgeClass}>{badgeText}</span>
      </div>
    );
  };

  const renderSection = (title: string, sectionItems: DebloatItem[]) => (
    <div className="wd-section" key={title}>
      <div className="wd-section-header">
        <span>{title}</span>
        <span className="wd-section-count">{sectionItems.length}</span>
      </div>
      {sectionItems.length === 0 ? (
        <div className="wd-section-empty">No items in this section.</div>
      ) : (
        <div className="wd-grid">{sectionItems.map(renderItemCard)}</div>
      )}
    </div>
  );

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

        <div className="wd-tabs">{/* tabs removed; integrated sections below */}</div>

        {/* ── Toolbar ── */}
        <div className="wd-toolbar">
          <div className="wd-toolbar-l">
            {/* Search */}
            <div className="wd-search-wrap">
              <Search size={12} className="wd-search-icon" />
              <input
                className="wd-search"
                placeholder="Search Windows apps, capabilities, and features…"
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
              onClick={() => fetchItems()}
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
                <span>Loading Windows apps and features…</span>
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
                <span>{searchQuery ? 'No items match your search' : 'No items found'}</span>
              </motion.div>
            ) : (
              <motion.div
                key="grid"
                className="wd-grid-sections"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {renderSection('Windows Apps', apps)}
                {renderSection('Windows Capabilities', capabilities)}
                {renderSection('Windows Optional Features', features)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export default WindowsDebloat;

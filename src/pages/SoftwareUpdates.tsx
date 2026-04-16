import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Download, CheckCircle, Package, X,
  ArrowRight, Clock, HardDrive, Zap, AlertTriangle, Activity,
  ShieldCheck, Layers,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import '../styles/SoftwareUpdates.css';
import { useAuth } from '../contexts/AuthContext';
import ProLockedWrapper from '../components/ProLockedWrapper';
import ProLineBadge from '../components/ProLineBadge';

/* ═══════════════════ Types ═══════════════════ */

interface PackageUpdate {
  name: string;
  id: string;
  version: string;
  available: string;
  source: string;
}

interface UpdateProgress {
  packageId: string;
  phase: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  status: string;
  percent: number;
  bytesDownloaded?: number;
  bytesTotal?: number;
  bytesPerSec?: number;
}

type RowState = 'idle' | 'queued' | 'updating' | 'done' | 'error';

const PHASES = ['preparing', 'downloading', 'verifying', 'installing', 'done'] as const;
type Phase = (typeof PHASES)[number] | 'error';

/* ═══════════════════ Helpers ═══════════════════ */

const fmtBytes = (n?: number): string => {
  if (!n || n <= 0) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576)    return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024)       return `${(n / 1024).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
};

const getInitials = (name: string): string => {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

const sizeToBytes = (s: string): number => {
  if (!s) return 0;
  const m = s.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  return u === 'GB' ? n * 1073741824 : u === 'MB' ? n * 1048576 : u === 'KB' ? n * 1024 : n;
};

const phaseLabel = (phase: Phase): string => ({
  preparing:   'Preparing',
  downloading: 'Downloading',
  verifying:   'Verifying',
  installing:  'Installing',
  done:        'Complete',
  error:       'Failed',
}[phase] || '');

const phaseIndex = (phase: Phase): number => {
  const idx = PHASES.indexOf(phase as typeof PHASES[number]);
  return idx >= 0 ? idx : -1;
};

/* ═══════════════════ Component ═══════════════════ */

interface SoftwareUpdatesProps {
  isActive?: boolean;
}

const SoftwareUpdates: React.FC<SoftwareUpdatesProps> = ({ isActive = false }) => {
  const { isPro } = useAuth();

  const [packages, setPackages] = useState<PackageUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [packageSizes, setPackageSizes] = useState<Record<string, string>>({});
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelAllRef = useRef(false);
  const hasScanned = useRef(false);
  const updateAllIndex = useRef(0);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('software:update-progress', (data: UpdateProgress) => {
      setProgress(data);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const checkUpdates = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    setLoading(true);
    setUpdatedIds(new Set());
    setPackages([]);
    setPackageSizes({});
    setProgress(null);
    try {
      const result = await window.electron.ipcRenderer.invoke('software:check-updates', true);
      if (result.success) {
        setPackages(result.packages);
        setPackageSizes({});
        setLastChecked(new Date().toLocaleTimeString());
        if (result.count === 0) {
          // empty state shown in UI
        } else {
          (async () => {
            for (const pkg of result.packages) {
              try {
                const res: { id: string; size: string } = await window.electron.ipcRenderer.invoke('software:get-package-size', pkg.id);
                setPackageSizes(prev => ({ ...prev, [res.id]: res.size }));
              } catch {
                setPackageSizes(prev => ({ ...prev, [pkg.id]: '' }));
              }
            }
          })();
        }
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive && isPro && !hasScanned.current) {
      hasScanned.current = true;
      checkUpdates();
    }
  }, [isActive, isPro, checkUpdates]);

  const handleCancelUpdate = async () => {
    if (!window.electron?.ipcRenderer) return;
    setCancelRequested(true);
    cancelAllRef.current = true;
    try {
      await window.electron.ipcRenderer.invoke('software:cancel-update');
    } catch {}
  };

  const handleUpdate = async (pkg: PackageUpdate) => {
    if (!window.electron?.ipcRenderer) return;
    setUpdatingId(pkg.id);
    setProgress(null);
    setCancelRequested(false);
    cancelAllRef.current = false;
    try {
      const result = await window.electron.ipcRenderer.invoke('software:update-app', pkg.id);
      if (result.success) {
        setUpdatedIds(prev => new Set(prev).add(pkg.id));
        setTimeout(() => setPackages(prev => prev.filter(p => p.id !== pkg.id)), 2400);
      }
    } catch {
    } finally {
      setProgress(null);
      setUpdatingId(null);
      setCancelRequested(false);
    }
  };

  const handleUpdateAll = async () => {
    if (!window.electron?.ipcRenderer) return;
    setUpdatingAll(true);
    setCancelRequested(false);
    cancelAllRef.current = false;
    updateAllIndex.current = 0;
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < pendingPackages.length; i++) {
      const pkg = pendingPackages[i];
      if (cancelAllRef.current) break;
      updateAllIndex.current = i;
      setUpdatingId(pkg.id);
      setProgress(null);
      try {
        const result = await window.electron.ipcRenderer.invoke('software:update-app', pkg.id);
        if (cancelAllRef.current || result.cancelled) break;
        if (result.success) {
          successCount++;
          setUpdatedIds(prev => new Set(prev).add(pkg.id));
          setPackages(prev => prev.filter(p => p.id !== pkg.id));
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }
    setUpdatingId(null);
    setTimeout(() => setProgress(null), 3000);
    const wasCancelled = cancelAllRef.current;
    setUpdatingAll(false);
    setCancelRequested(false);
    cancelAllRef.current = false;
    // Status shown in floating progress + update tab
  };

  const pendingPackages = packages.filter(p => !updatedIds.has(p.id));

  const totalSize = useMemo(() => {
    const sum = pendingPackages.reduce((acc, p) => acc + sizeToBytes(packageSizes[p.id] || ''), 0);
    return sum > 0 ? fmtBytes(sum) : null;
  }, [pendingPackages, packageSizes]);

  /* ── Status text (single source of truth — no duplication) ── */
  const statusInfo = useMemo(() => {
    if (loading) return { text: 'Scanning system packages…', tone: 'active' as const };
    if (updatingAll && updatingId) {
      const current = packages.find(p => p.id === updatingId);
      return {
        text: `Updating ${updateAllIndex.current + 1} of ${pendingPackages.length + updatedIds.size}${current ? ` · ${current.name}` : ''}`,
        tone: 'active' as const,
      };
    }
    if (updatingId) {
      const current = packages.find(p => p.id === updatingId);
      return { text: `Updating${current ? ` · ${current.name}` : ''}`, tone: 'active' as const };
    }
    if (pendingPackages.length > 0) {
      const sizeStr = totalSize ? ` · ${totalSize}` : '';
      return {
        text: `${pendingPackages.length} update${pendingPackages.length !== 1 ? 's' : ''} available${sizeStr}`,
        tone: 'warn' as const,
      };
    }
    return { text: 'All packages current', tone: 'success' as const };
  }, [loading, updatingAll, updatingId, pendingPackages, packages, totalSize, updatedIds.size]);

  return (
    <motion.div className="su" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      <PageHeader
        icon={<Package size={16} />}
        title="Software Updates"
        lineContent={<ProLineBadge pageName="Software Updates" />}
        actions={isPro ? (
          <>
            {updatingAll ? (
              <button className="su-btn su-btn--cancel" onClick={handleCancelUpdate} disabled={cancelRequested}>
                <X size={14} />
                {cancelRequested ? 'Cancelling…' : 'Cancel All'}
              </button>
            ) : pendingPackages.length > 1 ? (
              <button className="su-btn su-btn--update-all" onClick={handleUpdateAll} disabled={updatingId !== null}>
                <Zap size={14} />
                {`Update All (${pendingPackages.length})`}
              </button>
            ) : null}
            <button className="su-btn su-btn--scan" onClick={checkUpdates} disabled={loading || updatingId !== null || updatingAll}>
              <RefreshCw size={14} className={loading ? 'su-spin' : ''} />
              {loading ? 'Scanning…' : 'Scan'}
            </button>
          </>
        ) : undefined}
      />

      <ProLockedWrapper featureName="Software Updates" message="PRO Feature">

        {/* ── Status Command Bar ── */}
        <div className={`su-command su-command--${statusInfo.tone}`}>
          <div className="su-command__status">
            <span className={`su-command__dot su-command__dot--${statusInfo.tone}`} />
            <span className="su-command__text">{statusInfo.text}</span>
          </div>
          <span className="su-command__time">
            {lastChecked ? `Last scan ${lastChecked}` : 'Never scanned'}
          </span>
        </div>

        {/* ── Scanner (loading) ── */}
        {loading && (
          <motion.div
            className="su-scanner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="su-scanner__rings">
              <span className="su-scanner__ring su-scanner__ring--1" />
              <span className="su-scanner__ring su-scanner__ring--2" />
              <span className="su-scanner__ring su-scanner__ring--3" />
              <span className="su-scanner__core" />
            </div>
            <p className="su-scanner__label">Analyzing installed packages…</p>
          </motion.div>
        )}

        {/* ── Empty: All Up to Date ── */}
        {!loading && packages.length === 0 && (
          <motion.div
            className="su-clear"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            <div className="su-clear__icon">
              <ShieldCheck size={48} strokeWidth={1.5} />
            </div>
            <h3 className="su-clear__title">All Up to Date</h3>
            <p className="su-clear__sub">Your software is running the latest versions.</p>
          </motion.div>
        )}

        {/* ── Update Queue ── */}
        {!loading && packages.length > 0 && (
          <div className="su-queue">
            {/* Column header */}
            <div className="su-queue__header">
              <div className="su-queue__left">
                <span className="su-queue__col">Application</span>
                <span className="su-queue__col">Version</span>
              </div>
              <div className="su-queue__right">
                <span className="su-queue__col su-queue__col--size">Size</span>
                <span className="su-queue__col su-queue__col--source">Source</span>
                <span className="su-queue__col su-queue__col--action" />
              </div>
            </div>

            <AnimatePresence>
              {packages.map((pkg, i) => {
                const isUpdated  = updatedIds.has(pkg.id);
                const isUpdating = updatingId === pkg.id;
                const isQueued   = updatingAll && !isUpdating && !isUpdated;
                const pkgProgress = progress && progress.packageId === pkg.id ? progress : null;

                let state: RowState = 'idle';
                if (isUpdated) state = 'done';
                else if (isUpdating) state = pkgProgress?.phase === 'error' ? 'error' : 'updating';
                else if (isQueued) state = 'queued';

                const showPipeline = isUpdating || (pkgProgress && (pkgProgress.phase === 'done' || pkgProgress.phase === 'error'));
                const rawPct = pkgProgress?.percent ?? 0;
                const indeterminate = rawPct < 0;
                const displayPct = indeterminate ? 0 : Math.max(0, Math.min(100, Math.round(rawPct)));
                const activePhaseIdx = pkgProgress ? phaseIndex(pkgProgress.phase as Phase) : -1;

                return (
                  <motion.div
                    key={pkg.id}
                    layout
                    className={`su-card su-card--${state}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
                    transition={{ delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {/* Accent edge */}
                    <span className="su-card__edge" />

                    {/* ── Single row: left group | right group | action ── */}
                    <div className="su-card__row">
                      <div className="su-card__left">
                        <div className="su-card__app">
                          <div className="su-card__icon">
                            <span>{getInitials(pkg.name)}</span>
                          </div>
                          <span className="su-card__name">{pkg.name}</span>
                        </div>
                        <div className="su-card__ver">
                          <span className="su-card__ver-old">{pkg.version}</span>
                          <ArrowRight size={9} className="su-card__ver-arrow" />
                          <span className="su-card__ver-new">{pkg.available}</span>
                        </div>
                      </div>
                      <div className="su-card__right">
                        <span className="su-card__size">
                          {packageSizes[pkg.id] === undefined
                            ? <span className="su-card__loading">…</span>
                            : (packageSizes[pkg.id] || '—')}
                        </span>
                        <span className="su-card__source">{pkg.source}</span>
                        <div className="su-card__action">
                          {state === 'done' ? (
                            <span className="su-card__badge su-card__badge--done">
                              <CheckCircle size={13} /> Done
                            </span>
                          ) : state === 'queued' ? (
                            <span className="su-card__badge su-card__badge--queued">
                              <Clock size={11} /> Queued
                            </span>
                          ) : state === 'updating' && !updatingAll ? (
                            <button className="su-btn su-btn--cancel-sm" onClick={handleCancelUpdate} disabled={cancelRequested}>
                              <X size={13} /> {cancelRequested ? 'Stopping…' : 'Cancel'}
                            </button>
                          ) : state === 'updating' && updatingAll ? (
                            <span className="su-card__badge su-card__badge--active">
                              <Activity size={11} /> Active
                            </span>
                          ) : (
                            <button
                              className="su-btn su-btn--row-update"
                              onClick={() => handleUpdate(pkg)}
                              disabled={isUpdating || updatingAll || !isPro}
                            >
                              <Download size={12} /> Update
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Progress Pipeline ── */}
                    {showPipeline && pkgProgress && (
                      <motion.div
                        className="su-card__progress"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        {/* Phase nodes */}
                        <div className="su-pipeline__phases">
                          {PHASES.map((phase, pi) => {
                            const isActive   = pi === activePhaseIdx;
                            const isComplete = pi < activePhaseIdx || pkgProgress.phase === 'done';
                            const isFuture   = pi > activePhaseIdx && pkgProgress.phase !== 'done';
                            const isError    = pkgProgress.phase === 'error' && pi === activePhaseIdx;
                            return (
                              <React.Fragment key={phase}>
                                {pi > 0 && (
                                  <span className={`su-pipeline__line ${isComplete || isActive ? 'su-pipeline__line--done' : ''}`} />
                                )}
                                <span
                                  className={[
                                    'su-pipeline__node',
                                    isComplete && 'su-pipeline__node--done',
                                    isActive && !isError && 'su-pipeline__node--active',
                                    isError && 'su-pipeline__node--error',
                                    isFuture && 'su-pipeline__node--future',
                                  ].filter(Boolean).join(' ')}
                                >
                                  <span className="su-pipeline__dot" />
                                  <span className="su-pipeline__label">{phaseLabel(phase as Phase)}</span>
                                </span>
                              </React.Fragment>
                            );
                          })}
                        </div>

                        {/* Progress bar */}
                        <div className="su-pipeline__bar-track">
                          <div
                            className={`su-pipeline__bar-fill su-pipeline__bar-fill--${pkgProgress.phase}${indeterminate ? ' su-pipeline__bar-fill--indeterminate' : ''}`}
                            style={{ width: indeterminate ? '100%' : `${Math.max(displayPct, 2)}%` }}
                          />
                        </div>

                        {/* Stats */}
                        <div className="su-pipeline__stats">
                          <span className={`su-pipeline__phase-label su-pipeline__phase-label--${pkgProgress.phase}`}>
                            {pkgProgress.phase === 'error' && <AlertTriangle size={11} />}
                            {phaseLabel(pkgProgress.phase as Phase)}
                          </span>
                          <span className="su-pipeline__detail">
                            {pkgProgress.phase === 'downloading' && pkgProgress.bytesTotal ? (
                              <>
                                {fmtBytes(pkgProgress.bytesDownloaded)}
                                <span className="su-pipeline__sep"> / </span>
                                {fmtBytes(pkgProgress.bytesTotal)}
                                {pkgProgress.bytesPerSec ? (
                                  <>
                                    <span className="su-pipeline__sep"> · </span>
                                    <span className="su-pipeline__speed">{fmtBytes(pkgProgress.bytesPerSec)}/s</span>
                                  </>
                                ) : null}
                              </>
                            ) : (
                              pkgProgress.status
                            )}
                          </span>
                          <span className="su-pipeline__pct">
                            {indeterminate ? '…' : `${displayPct}%`}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </ProLockedWrapper>
    </motion.div>
  );
};

export default React.memo(SoftwareUpdates);

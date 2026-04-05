import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, ShieldCheck, ShieldAlert, RotateCcw, Play, Search, Info,
  AlertTriangle, XCircle, Loader2, Check, X, Minimize2, CheckCircle,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import '../styles/ServiceOptimizer.css';

/* ───────────────── Types ───────────────── */
interface ServiceDef {
  name: string;
  target: string;
  risk: 'low' | 'medium' | 'high';
  category: string;
  description: string;
}

interface ServiceState {
  Exists: boolean;
  Status: string | null;
  StartType: string | null;
}

type Mode = 'safe' | 'balanced' | 'aggressive';

interface ProgressLogEntry {
  name: string;
  status: 'success' | 'skipped' | 'failed';
  reason?: string;
  prev: string | null;
  target: string;
}

interface ProgressSummary {
  total: number;
  success: number;
  skipped: number;
  failed: number;
}

/* ── Mode card definitions ── */
const MODE_CARDS: { id: Mode; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
  { id: 'safe',       label: 'Safe',       icon: <Shield size={20} />,      desc: 'Low-risk services only',  color: '#00F2FF' },
  { id: 'balanced',   label: 'Balanced',   icon: <ShieldCheck size={20} />, desc: 'Low + Medium risk',       color: '#FFD600' },
  { id: 'aggressive', label: 'Aggressive', icon: <ShieldAlert size={20} />, desc: 'Full Chris Titus config', color: '#FF2D55' },
];

function normStartType(raw: string | null): string {
  if (!raw) return 'Unknown';
  const m: Record<string, string> = { Auto: 'Automatic', Manual: 'Manual', Disabled: 'Disabled' };
  return m[raw] ?? raw;
}

function alreadyMatches(current: string | null, target: string): boolean {
  const c = normStartType(current);
  if (target === 'AutomaticDelayedStart') return c === 'Automatic';
  return c === target;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
const ServiceOptimizer: React.FC = () => {
  const { addToast } = useToast();

  const [mode, setMode] = useState<Mode>('safe');
  const [allDefs, setAllDefs] = useState<ServiceDef[]>([]);
  const [states, setStates] = useState<Record<string, ServiceState>>({});
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [isElevated, setIsElevated] = useState(false);
  const [hasBackup, setHasBackup] = useState<{ exists: boolean; timestamp?: string; count?: number }>({ exists: false });
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scannedOnce = useRef(false);

  const [progressPhase, setProgressPhase] = useState<'idle' | 'start' | 'working' | 'done'>('idle');
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressService, setProgressService] = useState('');
  const [progressLog, setProgressLog] = useState<ProgressLogEntry[]>([]);
  const [progressSummary, setProgressSummary] = useState<ProgressSummary | null>(null);
  const [progressMinimized, setProgressMinimized] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      if (!window.electron?.ipcRenderer) return;
      try {
        const [defs, elev, backup] = await Promise.all([
          window.electron.ipcRenderer.invoke('svc:get-all-definitions'),
          window.electron.ipcRenderer.invoke('svc:is-elevated'),
          window.electron.ipcRenderer.invoke('svc:has-backup'),
        ]);
        setAllDefs(defs);
        setIsElevated(!!elev?.elevated);
        setHasBackup(backup || { exists: false });
      } catch (e) {
        console.error('[ServiceOptimizer] init error:', e);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('svc:progress', (data: any) => {
      if (!data) return;
      if (data.phase === 'start') {
        setProgressPhase('start');
        setProgressTotal(data.total);
        setProgressCurrent(0);
        setProgressLog([]);
        setProgressSummary(null);
        setProgressService('');
        setProgressMinimized(false);
      } else if (data.phase === 'working') {
        setProgressPhase('working');
        setProgressCurrent(data.current);
        setProgressService(data.service || '');
        if (data.entry) setProgressLog(prev => [...prev, data.entry]);
      } else if (data.phase === 'done') {
        setProgressPhase('done');
        setProgressCurrent(data.total);
        setProgressSummary(data.summary || null);
        setProgressMinimized(false);
      }
    });
    return () => { if (unsub) unsub(); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progressLog]);

  const scan = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    setScanning(true);
    try {
      const result: any = await window.electron.ipcRenderer.invoke('svc:scan');
      if (result?.success) {
        setStates(result.states);
        scannedOnce.current = true;
      } else {
        addToast(result?.message || 'Scan failed', 'error');
      }
    } catch {
      addToast('Failed to scan services', 'error');
    } finally {
      setScanning(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!scannedOnce.current && allDefs.length > 0) scan();
  }, [allDefs, scan]);

  const handleApply = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    if (!isElevated) {
      addToast('Administrator privileges required. Restart GS Center as admin.', 'error');
      return;
    }
    setApplying(true);
    setProgressPhase('start');
    setProgressLog([]);
    setProgressSummary(null);
    setProgressCurrent(0);
    setProgressService('');
    setProgressMinimized(false);
    try {
      const payload = selected.size > 0
        ? { mode, selectedNames: Array.from(selected) }
        : { mode, selectedNames: null };
      const result: any = await window.electron.ipcRenderer.invoke('svc:apply', payload);
      if (result?.success) {
        addToast(result.message, 'success');
        await scan();
        const backup = await window.electron.ipcRenderer.invoke('svc:has-backup');
        setHasBackup(backup || { exists: false });
      } else {
        addToast(result?.message || 'Apply failed', 'error');
      }
    } catch {
      addToast('Apply failed', 'error');
      setProgressPhase('idle');
    } finally {
      setApplying(false);
    }
  }, [mode, selected, isElevated, addToast, scan]);

  const handleRestore = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    if (!isElevated) {
      addToast('Administrator privileges required.', 'error');
      return;
    }
    setRestoring(true);
    try {
      const result: any = await window.electron.ipcRenderer.invoke('svc:restore');
      if (result?.success) {
        addToast(result.message, 'success');
        await scan();
      } else {
        addToast(result?.message || 'Restore failed', 'error');
      }
    } catch {
      addToast('Restore failed', 'error');
    } finally {
      setRestoring(false);
    }
  }, [isElevated, addToast, scan]);

  const filteredServices = useMemo(() => {
    const modeRisks: Record<Mode, Set<string>> = {
      safe: new Set(['low']),
      balanced: new Set(['low', 'medium']),
      aggressive: new Set(['low', 'medium', 'high']),
    };
    const allowed = modeRisks[mode];
    let list = allDefs.filter(s => allowed.has(s.risk));
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [allDefs, mode, searchTerm]);

  const totalListCount = filteredServices.length;

  const matchingCount = useMemo(() => {
    let count = 0;
    for (const s of filteredServices) {
      const st = states[s.name];
      if (st?.Exists && alreadyMatches(st.StartType, s.target)) count++;
    }
    return count;
  }, [filteredServices, states]);

  const allOptimized = useMemo(() => {
    if (!scannedOnce.current || totalListCount === 0) return false;
    if (selected.size > 0) {
      return Array.from(selected).every(name => {
        const def = filteredServices.find(s => s.name === name);
        if (!def) return true;
        const st = states[name];
        return st?.Exists && alreadyMatches(st.StartType, def.target);
      });
    }
    const existing = filteredServices.filter(s => states[s.name]?.Exists);
    return existing.length > 0 && existing.every(s => alreadyMatches(states[s.name].StartType, s.target));
  }, [filteredServices, states, selected, totalListCount]);

  const toggleService = (name: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  };

  const selectAll = () => {
    const s = new Set(selected);
    for (const svc of filteredServices) s.add(svc.name);
    setSelected(s);
  };
  const selectNone = () => setSelected(new Set());

  const dismissProgress = () => {
    setProgressPhase('idle');
    setProgressLog([]);
    setProgressSummary(null);
    setProgressMinimized(false);
  };

  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;
  const isRunning = progressPhase === 'start' || progressPhase === 'working';
  const modeColor = MODE_CARDS.find(c => c.id === mode)?.color ?? '#00F2FF';

  /* ═══════ RENDER ═══════ */
  return (
    <>
      <div className="svc-page">
        <PageHeader
          icon={<Shield size={20} />}
          title="Services"
          stat={
            scannedOnce.current
              ? <span className="svc-header-stat">{matchingCount} / {totalListCount} optimized</span>
              : undefined
          }
        />

        {!isElevated && (
          <motion.div className="svc-admin-warn" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <AlertTriangle size={16} />
            <span>GS Center is <b>not</b> running as Administrator. Service changes require elevation.</span>
          </motion.div>
        )}

        <div className="svc-mode-row">
          {MODE_CARDS.map(m => (
            <button
              key={m.id}
              className={`svc-mode-card${mode === m.id ? ' svc-mode-card--active' : ''}`}
              style={{ '--mode-color': m.color } as React.CSSProperties}
              onClick={() => { setMode(m.id); setSelected(new Set()); }}
            >
              <span className="svc-mode-icon">{m.icon}</span>
              <span className="svc-mode-label">{m.label}</span>
              <span className="svc-mode-desc">{m.desc}</span>
            </button>
          ))}
        </div>

        <AnimatePresence>
          {mode === 'aggressive' && (
            <motion.div
              className="svc-aggro-warn"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AlertTriangle size={15} />
              <span><b>Aggressive mode</b> modifies all services including high-risk system components. A backup is always created before applying.</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="svc-actions-bar">
          <div className="svc-actions-left">
            <button className="svc-btn svc-btn--scan" onClick={scan} disabled={scanning}>
              {scanning ? <Loader2 size={14} className="svc-spin" /> : <Search size={14} />}
              {scanning ? 'Scanning\u2026' : 'Scan Services'}
            </button>
            <button
              className="svc-btn svc-btn--apply"
              onClick={handleApply}
              disabled={applying || !scannedOnce.current || allOptimized}
            >
              {applying ? <Loader2 size={14} className="svc-spin" /> : allOptimized ? <Check size={14} /> : <Play size={14} />}
              {applying
                ? 'Applying\u2026'
                : allOptimized
                  ? 'All Optimized'
                  : selected.size > 0
                    ? `Apply ${selected.size} Selected`
                    : `Apply ${MODE_CARDS.find(c => c.id === mode)!.label} Mode`}
            </button>
          </div>
          <div className="svc-actions-right">
            <button
              className="svc-btn svc-btn--restore"
              onClick={handleRestore}
              disabled={restoring || !hasBackup.exists}
              title={hasBackup.exists
                ? `Restore ${hasBackup.count} services from backup (${new Date(hasBackup.timestamp!).toLocaleString()})`
                : 'No backup yet — a backup is created automatically when you apply tweaks'}
            >
              {restoring ? <Loader2 size={14} className="svc-spin" /> : <RotateCcw size={14} />}
              {restoring ? 'Restoring\u2026' : 'Restore Backup'}
            </button>
          </div>
        </div>

        <div className="svc-selection-row">
          <button className="svc-link-btn" onClick={selectAll}>Select All</button>
          <span className="svc-selection-sep">|</span>
          <button className="svc-link-btn" onClick={selectNone}>Select None</button>
          {selected.size > 0 && <span className="svc-selection-count">{selected.size} selected</span>}
          <div className="svc-search-wrap">
            <Search size={13} className="svc-search-icon" />
            <input
              className="svc-search"
              placeholder="Filter services\u2026"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {hasBackup.exists && progressPhase === 'idle' && (
          <div className="svc-backup-info">
            <Info size={13} />
            <span>Backup: {hasBackup.count} services saved on {new Date(hasBackup.timestamp!).toLocaleString()}</span>
          </div>
        )}

        <div className="svc-grid svc-grid--flat">
          {filteredServices.length === 0 && (
            <div className="svc-empty">No services match your filter.</div>
          )}
          {filteredServices.map(svc => {
            const st = states[svc.name];
            const exists = st?.Exists ?? false;
            const matches = exists && alreadyMatches(st?.StartType ?? null, svc.target);
            const isSelected = selected.has(svc.name);

            const cardClass = [
              'svc-card svc-card--flat',
              isSelected ? 'svc-card--selected' : '',
              !exists ? 'svc-card--missing' : '',
              matches ? 'svc-card--match' : '',
            ].filter(Boolean).join(' ');

            const dotClass = !exists
              ? 'svc-dot svc-dot--off'
              : matches ? 'svc-dot svc-dot--good' : 'svc-dot svc-dot--pending';

            const badgeClass = !exists
              ? 'svc-card-badge svc-card-badge--missing'
              : matches ? 'svc-card-badge svc-card-badge--match' : 'svc-card-badge svc-card-badge--pending';

            return (
              <div
                key={svc.name}
                className={cardClass}
                onClick={() => exists && toggleService(svc.name)}
                title={`${svc.description}\n${svc.category} \u00b7 ${svc.risk} risk`}
              >
                <div className="svc-card-cb" />
                <span className={dotClass} />
                <div className="svc-card-info">
                  <span className="svc-card-name">{svc.name}</span>
                </div>
                <div className={badgeClass}>
                  {!exists
                    ? <XCircle size={10} />
                    : matches
                      ? <Check size={10} strokeWidth={3} />
                      : <AlertTriangle size={10} />
                  }
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {progressPhase !== 'idle' && !progressMinimized && (
            <>
              <motion.div
                className="svc-modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
              <div className="svc-modal-wrapper">
                <motion.div
                  className="svc-modal"
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                  style={{ '--svc-modal-color': modeColor } as React.CSSProperties}
                >
                  <div className="svc-modal-header">
                    <div className="svc-modal-title-row">
                      <div className="svc-modal-icon">
                        <Shield size={16} />
                      </div>
                      <div>
                        <div className="svc-modal-title">Service Optimizer</div>
                        <div className="svc-modal-subtitle">{MODE_CARDS.find(c => c.id === mode)?.label} Mode</div>
                      </div>
                      <div className={`svc-modal-badge ${progressPhase === 'done' ? 'svc-modal-badge--done' : 'svc-modal-badge--running'}`}>
                        {progressPhase === 'done'
                          ? <><CheckCircle size={11} /><span>Completed</span></>
                          : <><Loader2 size={11} className="svc-spin" /><span>Running...</span></>
                        }
                      </div>
                    </div>
                    {isRunning && (
                      <button className="svc-modal-minimize" onClick={() => setProgressMinimized(true)} title="Minimize">
                        <Minimize2 size={15} />
                      </button>
                    )}
                    <button
                      className="svc-modal-close"
                      onClick={dismissProgress}
                      disabled={isRunning}
                      title={isRunning ? 'Running\u2026' : 'Close'}
                    >
                      <X size={15} />
                    </button>
                  </div>

                  <div className="svc-modal-bar-track">
                    <motion.div
                      className="svc-modal-bar-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPct}%` }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  </div>

                  <div className="svc-modal-log" ref={logRef}>
                    {progressLog.length === 0 ? (
                      <div className="svc-modal-log-empty">
                        <Loader2 size={16} className="svc-spin" />
                        <span>Preparing services\u2026</span>
                      </div>
                    ) : (
                      <>
                        {progressLog.map((entry, i) => {
                          const icon = entry.status === 'success' ? '\u2714' : entry.status === 'skipped' ? '\u2192' : '\u2716';
                          const detail = entry.status === 'success'
                            ? `${entry.prev || '?'} \u2192 ${entry.target}`
                            : entry.reason || (entry.status === 'skipped' ? 'Already set' : 'Failed');
                          return (
                            <div key={i} className={`svc-log-line svc-log-line--${entry.status}`}>
                              <span className="svc-log-glyph">{icon}</span>
                              <span className="svc-log-svc">{entry.name}</span>
                              <span className="svc-log-detail">{detail}</span>
                            </div>
                          );
                        })}
                        {isRunning && <div className="svc-log-cursor" />}
                      </>
                    )}
                  </div>

                  <div className="svc-modal-footer">
                    {isRunning && (
                      <button className="svc-modal-minimize-btn" onClick={() => setProgressMinimized(true)}>
                        <Minimize2 size={13} />
                        <span>Minimize</span>
                      </button>
                    )}
                    {progressPhase === 'done' && progressSummary && (
                      <div className="svc-modal-summary">
                        <span className="svc-mps svc-mps--success">{progressSummary.success} changed</span>
                        <span className="svc-mps svc-mps--skipped">{progressSummary.skipped} skipped</span>
                        {progressSummary.failed > 0 && (
                          <span className="svc-mps svc-mps--failed">{progressSummary.failed} failed</span>
                        )}
                      </div>
                    )}
                    <button className="svc-modal-close-btn" onClick={dismissProgress} disabled={isRunning}>
                      {isRunning ? 'Running\u2026' : 'Close'}
                    </button>
                  </div>
                </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {progressPhase !== 'idle' && progressMinimized && (
            <motion.div
              className="svc-mini-overlay"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{ '--svc-modal-color': modeColor } as React.CSSProperties}
            >
              <div className="svc-mini-header">
                <span className="svc-mini-title">Service Optimizer</span>
                <div className={`svc-mini-badge ${progressPhase === 'done' ? 'svc-mini-badge--done' : 'svc-mini-badge--running'}`}>
                  {isRunning
                    ? <><Loader2 size={10} className="svc-spin" /><span>Running</span></>
                    : <><CheckCircle size={10} /><span>Done</span></>
                  }
                </div>
              </div>
              <div className="svc-mini-bar-row">
                <div className="svc-mini-bar-track">
                  <motion.div
                    className="svc-mini-bar-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
                <span className="svc-mini-pct">{progressPct}%</span>
              </div>
              <button className="svc-mini-restore" onClick={() => setProgressMinimized(false)}>
                <Minimize2 size={12} style={{ transform: 'rotate(180deg)' }} />
                <span>Restore</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default React.memo(ServiceOptimizer);

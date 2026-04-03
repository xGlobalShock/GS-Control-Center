import React, { useEffect, useMemo, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { CheckCircle2, AlertCircle, Loader2, Trash2, X, Shield, Zap } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import '../styles/CacheCleanupToast.css';

interface Props {
  toastKey: string;
  windowsIds?: string[];
}

interface CleanResult {
  success: boolean;
  message?: string;
  spaceSaved?: string;
}

const TASK_LABELS: Record<string, string> = {
  'temp-files': 'Temp Files',
  'update-cache': 'Update Cache',
  'dns-cache': 'DNS Cache',
  'ram-cache': 'RAM Cache',
  'recycle-bin': 'Recycle Bin',
  'thumbnail-cache': 'Thumbnail Cache',
  'windows-logs': 'Windows Logs',
  'crash-dumps': 'Crash Dumps',
  'prefetch': 'Prefetch Cache',
  'font-cache': 'Font Cache',
  'memory-dumps': 'Memory Dumps',
  'windows-temp': 'Windows Temp',
  'error-reports': 'Error Reports',
  'delivery-optimization': 'Delivery Optimizer',
  'recent-files': 'Recent Files',
  'nvidia-cache': 'NVIDIA Cache',
  'apex-shaders': 'Apex Shaders',
  'forza-shaders': 'Forza Shaders',
  'cod-shaders': 'CoD Shaders',
  'cs2-shaders': 'CS2 Shaders',
  'fortnite-shaders': 'Fortnite Shaders',
  'lol-shaders': 'LoL Shaders',
  'overwatch-shaders': 'Overwatch Shaders',
  'r6-shaders': 'R6 Shaders',
  'rocket-league-shaders': 'Rocket League Shaders',
  'valorant-shaders': 'Valorant Shaders',
};

const CacheCleanupToast: React.FC<Props> = ({ toastKey, windowsIds }) => {
  const { toasts, removeToast, addToast } = useToast();
  const [toastId, setToastId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ id: string; success: boolean; message?: string; spaceSaved?: string }>>([]);
  const [started, setStarted] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  const formatElapsed = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  // mapping of utility id -> ipc channel (kept in sync with Cleaner)
  const cleanerMap: { [key: string]: string } = {
    'nvidia-cache': 'cleaner:clear-nvidia-cache',
    'apex-shaders': 'cleaner:clear-apex-shaders',
    'forza-shaders': 'cleaner:clear-forza-shaders',
    'cod-shaders': 'cleaner:clear-cod-shaders',
    'cs2-shaders': 'cleaner:clear-cs2-shaders',
    'fortnite-shaders': 'cleaner:clear-fortnite-shaders',
    'lol-shaders': 'cleaner:clear-lol-shaders',
    'overwatch-shaders': 'cleaner:clear-overwatch-shaders',
    'r6-shaders': 'cleaner:clear-r6-shaders',
    'rocket-league-shaders': 'cleaner:clear-rocket-league-shaders',
    'valorant-shaders': 'cleaner:clear-valorant-shaders',
    'temp-files': 'cleaner:clear-temp-files',
    'update-cache': 'cleaner:clear-update-cache',
    'dns-cache': 'cleaner:clear-dns-cache',
    'ram-cache': 'cleaner:clear-ram-cache',
    'recycle-bin': 'cleaner:empty-recycle-bin',
    'thumbnail-cache': 'cleaner:clear-thumbnail-cache',
    'windows-logs': 'cleaner:clear-windows-logs',
    'crash-dumps': 'cleaner:clear-crash-dumps',
    'windows-temp': 'cleaner:clear-windows-temp',
    'delivery-optimization': 'cleaner:clear-delivery-optimization',
    'font-cache': 'cleaner:clear-font-cache',
    'prefetch': 'cleaner:clear-prefetch',
    'memory-dumps': 'cleaner:clear-memory-dumps',
  };

  const windowsUtilityIds = useMemo(() => {
    if (windowsIds && Array.isArray(windowsIds) && windowsIds.length) return windowsIds;
    return [
      'thumbnail-cache',
      'windows-logs',
      'crash-dumps',
      'temp-files',
      'update-cache',
      'dns-cache',
      'ram-cache',
      'recycle-bin',
      'windows-temp',
      'delivery-optimization',
    ];
  }, [windowsIds]);

  // parse human-readable size strings (e.g. "93.38 MB", "1.2 GB") to MB
  // This will scan the provided string for all occurrences like "12 MB", "1.2 GB" etc
  // and sum them. Returns null if no explicit unit-based sizes are found.
  const parseSizeToMB = (s?: string): number | null => {
    if (!s) return null;
    const text = String(s);
    const regex = /([\d,]+(?:\.\d+)?)\s*(tb|gb|mb|kb|b)\b/gi;
    let m: RegExpExecArray | null;
    let total = 0;
    let found = false;

    while ((m = regex.exec(text)) !== null) {
      const raw = (m[1] || '').replace(/,/g, '');
      const num = parseFloat(raw);
      if (Number.isNaN(num)) continue;
      found = true;
      const unit = (m[2] || '').toLowerCase();
      switch (unit) {
        case 'tb':
          total += num * 1024 * 1024; // TB -> MB
          break;
        case 'gb':
          total += num * 1024; // GB -> MB
          break;
        case 'kb':
          total += num / 1024; // KB -> MB
          break;
        case 'b':
          total += num / (1024 * 1024); // bytes -> MB
          break;
        case 'mb':
        default:
          total += num; // MB
          break;
      }
    }

    if (!found) {
      // fallback: look for patterns like "FreedMB=123" or "FreedMB:123"
      const freedMatch = text.match(/freedmb\s*[:=]?\s*([-\d,]+(?:\.\d+)?)/i);
      if (freedMatch) {
        const raw = freedMatch[1].replace(/,/g, '');
        const num = parseFloat(raw);
        if (!Number.isNaN(num)) return num; // assume MB when returned as plain number
      }
      return null;
    }

    return total;
  };

  const formatMB = (mb: number): string => {
    if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(2)} TB`;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
  };

  useEffect(() => {
    // find the toast id that contains this component (by matching the toastKey prop)
    const matched = toasts.find((t) => {
      try {
        // toast.message may be a React element with props
        // @ts-ignore
        return React.isValidElement(t.message) && (t.message.props?.toastKey === toastKey);
      } catch (e) {
        return false;
      }
    });

    if (matched) setToastId(matched.id);
  }, [toasts, toastKey]);

  const close = () => {
    if (toastId) removeToast(toastId);
    // reset transient overlay state when closed
    setSummary(null);
    setStarted(false);
    setResults([]);
  };

  const runAll = async () => {
    if (running) return;
    if (!window.electron?.ipcRenderer) {
      addToast('IPC not available — cannot run cleanup', 'error');
      return;
    }

    // mark that the user started the clear-all flow so size boxes become visible
    setStarted(true);
    setRunning(true);
    setResults([]);
    setProgress(0);

    const total = windowsUtilityIds.length;
    let succeeded = 0;
    let totalSavedMB = 0; // accumulate numeric MB values from handlers
    let permissionErrorDetected = false;

    for (let i = 0; i < windowsUtilityIds.length; i++) {
      const id = windowsUtilityIds[i];
      const channel = cleanerMap[id];
      setCurrentTask(id);

      if (!channel) {
        setResults((r) => [...r, { id, success: false, message: 'No handler registered', spaceSaved: undefined }]);
        setProgress(Math.round(((i + 1) / total) * 100));
        // slight pause for UI flow
        // eslint-disable-next-line no-await-in-loop
        // @ts-ignore
        await new Promise((res) => setTimeout(res, 200));
        continue;
      }

      try {
        // call main process
        // @ts-ignore
        const res: CleanResult = await window.electron.ipcRenderer.invoke(channel);

        if (res && res.success) {
          succeeded += 1;
          if (res.spaceSaved) {
            const mb = parseSizeToMB(res.spaceSaved);
            if (mb !== null) totalSavedMB += mb;
          }
          setResults((r) => [...r, { id, success: true, message: res.message, spaceSaved: res.spaceSaved }]);
        } else {
          const msg = res?.message || 'Failed';
          setResults((r) => [...r, { id, success: false, message: msg, spaceSaved: res?.spaceSaved }]);
          if (isPermissionError(msg)) {
            permissionErrorDetected = true;
            setAdminError(msg);
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err) || 'Error';
        setResults((r) => [...r, { id, success: false, message: errMsg, spaceSaved: undefined }]);
        if (isPermissionError(errMsg)) {
          permissionErrorDetected = true;
          setAdminError(errMsg);
        }
      }

      // update progress
      setProgress(Math.round(((i + 1) / total) * 100));
      // slight pause for UI flow
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 300));
    }

    setCurrentTask(null);
    setRunning(false);

    // show concise summary inside the overlay (instead of an external toast)
    const displayCount = total >= 8 ? 8 : total;
    const totalFreed = formatMB(totalSavedMB);

    if (succeeded === total) {
      setSummary({ type: 'success', message: `Cleared ${displayCount} Windows cache items, freed ${totalFreed}` });
    } else if (succeeded > 0) {
      setSummary({ type: 'info', message: `${succeeded}/${total} items cleared, freed ${totalFreed}` });
    } else {
      setSummary({ type: 'error', message: 'Cache cleanup failed for all items' });
    }

    // If a permission error was detected, keep the overlay open and show the banner
    // (do not show a duplicate toast since the inline banner already informs the user).
    if (!permissionErrorDetected) {
      // auto-close overlay after giving user a moment
      setTimeout(() => {
        close();
      }, 1400);
    }
  };

  // basic permission error heuristic
  function isPermissionError(msg?: string) {
    if (!msg) return false;
    const text = String(msg).toLowerCase();
    const patterns = ['access is denied', 'administrator', 'requires elevation', 'elevat', 'eperm', 'eacces', 'permission denied', 'not enough privileges', 'privileges'];
    return patterns.some((p) => text.includes(p));
  }

  // Compute live totals for stats display
  const completedCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const totalSavedMBDisplay = useMemo(() => {
    let mb = 0;
    results.forEach(r => {
      if (r.success && r.spaceSaved) {
        const parsed = parseSizeToMB(r.spaceSaved);
        if (parsed !== null) mb += parsed;
      }
    });
    return mb > 0 ? formatMB(mb) : '0.00 MB';
  }, [results]);

  // SVG ring dimensions
  const RING_R = 44;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const ringOffset = RING_CIRC - (progress / 100) * RING_CIRC;

  const phaseLabel = running ? 'PROCESSING' : started ? (summary?.type === 'error' ? 'ERROR' : 'COMPLETE') : 'IDLE';

  return ReactDOM.createPortal(
    <div className="purge-overlay">
      <div className="purge-panel">
        {/* Animated corner brackets */}
        <span className="purge-corner purge-corner-tl" />
        <span className="purge-corner purge-corner-tr" />
        <span className="purge-corner purge-corner-bl" />
        <span className="purge-corner purge-corner-br" />

        {/* Horizontal scan line while running */}
        {running && <div className="purge-scanline" />}

        {/* ── HEADER ── */}
        <div className="purge-header">
          <div className="purge-header-icon">
            <Trash2 size={18} />
            {running && <span className="purge-icon-ping" />}
          </div>
          <div className="purge-header-text">
            <div className="purge-title">SYSTEM CACHE FLUSH</div>
          </div>
          <button className="purge-close-btn" onClick={close} title="Close" disabled={running}>
            <X size={15} />
          </button>
        </div>

        <div className="purge-header-divider" />

        {/* ── MAIN CONTENT: ring + stats ── */}
        <div className="purge-main">
          {/* Circular progress ring */}
          <div className="purge-ring-section">
            <div className="purge-ring-wrap">
              <svg width="120" height="120" viewBox="0 0 120 120" className="purge-ring-svg">
                <defs>
                  <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00CC6A" />
                    <stop offset="100%" stopColor="#00CC6A" />
                  </linearGradient>
                  <filter id="ringGlow">
                    <feGaussianBlur stdDeviation="2.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {/* Outer background track */}
                <circle cx="60" cy="60" r={RING_R} fill="none" stroke="rgba(0, 204, 106,0.07)" strokeWidth="6" />
                {/* Outer decorative dashed ring */}
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,212,170,0.1)" strokeWidth="1" strokeDasharray="3 8" />
                {/* Inner decorative ring */}
                <circle cx="60" cy="60" r="33" fill="none" stroke="rgba(0, 204, 106,0.06)" strokeWidth="1" strokeDasharray="2 6" />
                {/* Progress arc */}
                <circle
                  cx="60" cy="60" r={RING_R}
                  fill="none"
                  stroke="url(#ringGrad)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRC}
                  strokeDashoffset={ringOffset}
                  transform="rotate(-90 60 60)"
                  filter="url(#ringGlow)"
                  style={{ transition: 'stroke-dashoffset 420ms cubic-bezier(0.4,0,0.2,1)' }}
                />
                {/* Spinning orbit arc while running */}
                {running && (
                  <circle
                    cx="60" cy="60" r="52"
                    fill="none"
                    stroke="rgba(0, 204, 106,0.22)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray="20 307"
                    className="purge-orbit-spin"
                  />
                )}
              </svg>
              {/* Ring center text */}
              <div className="purge-ring-center">
                <div className="purge-ring-pct">
                  {progress}<span className="purge-ring-pct-sign">%</span>
                </div>
                <div className={`purge-ring-phase purge-phase-${phaseLabel.toLowerCase()}`}>{phaseLabel}</div>
              </div>
            </div>

            {/* Active task indicator below the ring */}
            <div className="purge-active-task">
              {running && currentTask ? (
                <>
                  <span className="purge-task-pulse" />
                  <span className="purge-active-task-label">
                    {TASK_LABELS[currentTask] ?? currentTask.replace(/-/g, ' ').toUpperCase()}
                  </span>
                </>
              ) : (
                <span className="purge-active-task-idle">
                  {started ? (summary?.type === 'error' ? 'Process Aborted' : 'Cleanup Complete') : 'Ready'}
                </span>
              )}
            </div>
          </div>

          {/* Stats panel */}
          <div className="purge-stats-panel">
            <div className="purge-stat-row">
              <div className="purge-stat-box">
                <div className="purge-stat-num">
                  {completedCount}<span className="purge-stat-denom">/{windowsUtilityIds.length}</span>
                </div>
                <div className="purge-stat-label">CLEARED</div>
              </div>
              <div className="purge-stat-box purge-stat-freed">
                <div className="purge-stat-num">{totalSavedMBDisplay}</div>
                <div className="purge-stat-label">FREED</div>
              </div>
              <div className="purge-stat-box purge-stat-time">
                <div className="purge-stat-num">{formatElapsed(elapsed)}</div>
                <div className="purge-stat-label">ELAPSED</div>
              </div>
              {failedCount > 0 && (
                <div className="purge-stat-box purge-stat-fail-box">
                  <div className="purge-stat-num">{failedCount}</div>
                  <div className="purge-stat-label">FAILED</div>
                </div>
              )}
            </div>

            {/* Linear progress bar inside stats area */}
            <div className="purge-linebar-wrap">
              <div className="purge-linebar-track">
                <div className="purge-linebar-fill" style={{ width: `${progress}%` }} />
                <div className="purge-linebar-shimmer" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── QUEUE HEADER ── */}
        <div className="purge-queue-header">
          <Zap size={11} className="purge-queue-icon" />
          <span className="purge-queue-label">CLEANUP QUEUE</span>
          <div className="purge-queue-line" />
          <span className="purge-queue-count">{windowsUtilityIds.length} ITEMS</span>
        </div>

        {/* ── TASK LIST ── */}
        <div className="purge-task-list">
          {windowsUtilityIds.map((id, idx) => {
            const r = results.find(x => x.id === id);
            const isActive = started && currentTask === id && running;
            const label = TASK_LABELS[id] ?? id.replace(/-/g, ' ');
            const stateClass = r ? (r.success ? 'ok' : 'fail') : isActive ? 'active' : 'idle';

            return (
              <div key={id} className={`purge-task purge-task-${stateClass}`}>
                <span className="purge-task-index">{String(idx + 1).padStart(2, '0')}</span>
                <span className={`purge-task-dot purge-dot-${stateClass}`} />
                <span className="purge-task-name">{label}</span>
                <div className="purge-task-right">
                  {r?.success && r.spaceSaved && (
                    <span className="purge-task-size">{r.spaceSaved}</span>
                  )}
                  {r?.success && !r.spaceSaved && (
                    <span className="purge-task-badge purge-badge-ok">Success</span>
                  )}
                  {r && !r.success && (
                    <span className="purge-task-badge purge-badge-fail">
                      {isPermissionError(r.message) ? 'Run app as Admin' : 'Failed'}
                    </span>
                  )}
                  {isActive && (
                    <span className="purge-task-badge purge-badge-active">
                      <Loader2 size={10} className="purge-micro-spin" />
                    </span>
                  )}
                  {!r && !isActive && (
                    <span className="purge-task-badge purge-badge-idle">Waiting</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── ACTION BUTTONS ── */}
        <div className="purge-actions-divider" />
        <div className="purge-actions">
          <button
            className={`purge-btn-start ${running ? 'purge-btn-running' : ''}`}
            onClick={runAll}
            disabled={running}
          >
            {running ? (
              <><Loader2 size={14} className="purge-spin" /> In Progress...</>
            ) : (
              <><Shield size={14} /> Proceed</>
            )}
          </button>
        </div>
      </div>
    </div>
  , document.body);
};

export default CacheCleanupToast;

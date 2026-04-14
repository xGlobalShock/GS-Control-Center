import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Loader2, Play, Pause, RotateCcw, Sliders, X, Power, AlertTriangle } from 'lucide-react';
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
  'nvidia-cache': 'NVIDIA Shader Cache',
  'apex-shaders': 'Apex Legends Shaders',
  'forza-shaders': 'Forza Shaders',
  'cod-shaders': 'Call of Duty Shaders',
  'cs2-shaders': 'CS2 Shaders',
  'fortnite-shaders': 'Fortnite Shaders',
  'lol-shaders': 'League of Legends Shaders',
  'overwatch-shaders': 'Overwatch Shaders',
  'r6-shaders': 'Rainbow Six Shaders',
  'rocket-league-shaders': 'Rocket League Shaders',
  'valorant-shaders': 'Valorant Shaders',
};

const CLEANER_MAP: Record<string, string> = {
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

type TaskState = 'dormant' | 'queued' | 'active' | 'purged' | 'failed' | 'skipped';

interface TaskRecord {
  id: string;
  state: TaskState;
  startedAt?: number;
  finishedAt?: number;
  spaceSaved?: string;
  spaceSavedMB?: number;
  message?: string;
  progress: number;
}

const parseSizeToMB = (s?: string): number | null => {
  if (!s) return null;
  const regex = /([\d,]+(?:\.\d+)?)\s*(tb|gb|mb|kb|b)\b/gi;
  let m: RegExpExecArray | null;
  let total = 0;
  let found = false;
  while ((m = regex.exec(s)) !== null) {
    const raw = (m[1] || '').replace(/,/g, '');
    const num = parseFloat(raw);
    if (Number.isNaN(num)) continue;
    found = true;
    const unit = (m[2] || '').toLowerCase();
    switch (unit) {
      case 'tb': total += num * 1024 * 1024; break;
      case 'gb': total += num * 1024; break;
      case 'kb': total += num / 1024; break;
      case 'b': total += num / (1024 * 1024); break;
      default: total += num;
    }
  }
  if (!found) {
    const freed = s.match(/freedmb\s*[:=]?\s*([-\d,]+(?:\.\d+)?)/i);
    if (freed) {
      const num = parseFloat(freed[1].replace(/,/g, ''));
      if (!Number.isNaN(num)) return num;
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

const formatElapsed = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};

const formatClock = (d: Date): string =>
  `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;

const isPermissionError = (msg?: string): boolean => {
  if (!msg) return false;
  const t = msg.toLowerCase();
  return ['access is denied', 'administrator', 'requires elevation', 'elevat', 'eperm', 'eacces', 'permission denied', 'not enough privileges', 'privileges']
    .some(p => t.includes(p));
};

const HEX_POSITIONS = [
  { x: 45, y: 24 }, { x: 85, y: 24 }, { x: 125, y: 24 },
  { x: 25, y: 60 }, { x: 65, y: 60 }, { x: 105, y: 60 }, { x: 145, y: 60 },
  { x: 45, y: 96 }, { x: 85, y: 96 }, { x: 125, y: 96 },
];

const HEX_ADJACENCIES: Array<[number, number]> = [
  [0, 1], [1, 2],
  [0, 3], [0, 4], [1, 4], [1, 5], [2, 5], [2, 6],
  [3, 4], [4, 5], [5, 6],
  [3, 7], [4, 7], [4, 8], [5, 8], [5, 9], [6, 9],
  [7, 8], [8, 9],
];

const hexPoints = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
};

const SEG_CELLS = 32;

const CacheCleanupToast: React.FC<Props> = ({ toastKey, windowsIds }) => {
  const { toasts, removeToast, addToast } = useToast();
  const [toastId, setToastId] = useState<string | null>(null);

  const defaultIds = useMemo(() => {
    if (windowsIds && windowsIds.length) return windowsIds.slice(0, 10);
    return [
      'thumbnail-cache', 'windows-logs', 'crash-dumps', 'temp-files', 'update-cache',
      'dns-cache', 'ram-cache', 'recycle-bin', 'windows-temp', 'delivery-optimization',
    ];
  }, [windowsIds]);

  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const activeIds = useMemo(() => defaultIds.filter(id => !disabledIds.has(id)), [defaultIds, disabledIds]);

  const [tasks, setTasks] = useState<TaskRecord[]>(() =>
    defaultIds.map(id => ({ id, state: 'dormant', progress: 0 }))
  );

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [adminError, setAdminError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const ledgerRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const resumeResolverRef = useRef<(() => void) | null>(null);
  const abortRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const totalMBRef = useRef<number>(0);

  useEffect(() => {
    setTasks(defaultIds.map(id => ({ id, state: 'dormant', progress: 0 })));
  }, [defaultIds]);

  useEffect(() => {
    const tick = setInterval(() => {
      setClock(formatClock(new Date()));
      if (running && !pausedRef.current) {
        setElapsedMs(Date.now() - startTimeRef.current);
      }
    }, 500);
    return () => clearInterval(tick);
  }, [running]);

  useEffect(() => {
    const matched = toasts.find(t => {
      try {
        return React.isValidElement(t.message) && (t.message as any).props?.toastKey === toastKey;
      } catch { return false; }
    });
    if (matched) setToastId(matched.id);
  }, [toasts, toastKey]);

  useEffect(() => {
    if (ledgerRef.current && currentIdx !== null) {
      const rows = ledgerRef.current.querySelectorAll('.xfl-ledger-row');
      const el = rows[currentIdx] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIdx]);

  const close = () => {
    abortRef.current = true;
    if (resumeResolverRef.current) { resumeResolverRef.current(); resumeResolverRef.current = null; }
    if (toastId) removeToast(toastId);
  };

  const toggleScope = (id: string) => {
    if (running) return;
    setDisabledIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePause = () => {
    if (!running) return;
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      resumeResolverRef.current?.();
      resumeResolverRef.current = null;
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  };

  const resetForRerun = () => {
    setTasks(defaultIds.map(id => ({ id, state: 'dormant', progress: 0 })));
    setStarted(false);
    setSummary(null);
    setAdminError(null);
    setElapsedMs(0);
    setCurrentIdx(null);
  };

  const runAll = async () => {
    if (running) return;
    if (!window.electron?.ipcRenderer) {
      addToast('IPC not available — cannot run cleanup', 'error');
      return;
    }

    resetForRerun();
    setStarted(true);
    setRunning(true);
    abortRef.current = false;
    startTimeRef.current = Date.now();
    totalMBRef.current = 0;

    const queue = activeIds;
    setTasks(prev => prev.map(t => (queue.includes(t.id) ? { ...t, state: 'queued' as TaskState } : { ...t, state: 'skipped' as TaskState })));

    let succeeded = 0;
    let permissionSeen = false;

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;

      if (pausedRef.current) {
        await new Promise<void>(resolve => { resumeResolverRef.current = resolve; });
      }

      const id = queue[i];
      const taskIdx = defaultIds.indexOf(id);
      setCurrentIdx(taskIdx);

      setTasks(prev => prev.map(t => t.id === id ? { ...t, state: 'active', startedAt: Date.now(), progress: 0 } : t));

      const progressTick = setInterval(() => {
        setTasks(prev => prev.map(t => t.id === id && t.state === 'active'
          ? { ...t, progress: Math.min(0.92, t.progress + 0.08 + Math.random() * 0.06) }
          : t));
      }, 180);

      const channel = CLEANER_MAP[id];
      let result: CleanResult | null = null;
      let errMsg: string | null = null;

      if (!channel) {
        errMsg = 'No handler registered';
      } else {
        try {
          result = await (window as any).electron.ipcRenderer.invoke(channel);
        } catch (err: any) {
          errMsg = err?.message || String(err) || 'Error';
        }
      }

      clearInterval(progressTick);

      if (result && result.success) {
        succeeded += 1;
        const mb = result.spaceSaved ? parseSizeToMB(result.spaceSaved) : null;
        if (mb != null) totalMBRef.current += mb;
        setTasks(prev => prev.map(t => t.id === id
          ? { ...t, state: 'purged', finishedAt: Date.now(), spaceSaved: result!.spaceSaved, spaceSavedMB: mb ?? undefined, progress: 1 }
          : t));
      } else {
        const msg = result?.message || errMsg || 'Failed';
        if (isPermissionError(msg)) { permissionSeen = true; setAdminError(msg); }
        setTasks(prev => prev.map(t => t.id === id
          ? { ...t, state: 'failed', finishedAt: Date.now(), message: msg, progress: 1 }
          : t));
      }

      await new Promise(res => setTimeout(res, 260));
    }

    setCurrentIdx(null);
    setRunning(false);
    setPaused(false);
    pausedRef.current = false;

    if (abortRef.current) return;
    const total = queue.length;
    const freed = formatMB(totalMBRef.current);
    if (succeeded === total) setSummary({ type: 'success', message: `Cleaned ${total} tasks · Recovered ${freed}` });
    else if (succeeded > 0) setSummary({ type: 'info', message: `${succeeded}/${total} tasks cleaned · Recovered ${freed}` });
    else setSummary({ type: 'error', message: 'Cleanup aborted — all tasks failed' });
    void permissionSeen;
  };

  const totalMB = tasks.reduce((sum, t) => sum + (t.spaceSavedMB || 0), 0);
  const purgedCount = tasks.filter(t => t.state === 'purged').length;
  const failedCount = tasks.filter(t => t.state === 'failed').length;
  const finishedCount = purgedCount + failedCount;
  const queueLen = activeIds.length;
  const activeProgress = currentIdx !== null && tasks[currentIdx]?.state === 'active' ? tasks[currentIdx].progress : 0;
  const donePct = queueLen > 0 ? Math.min(100, Math.round(((finishedCount + activeProgress) / queueLen) * 100)) : (started ? 100 : 0);
  const litCells = Math.floor((donePct / 100) * SEG_CELLS);

  const throughputSamples = useMemo(() => {
    return tasks.filter(t => t.state === 'purged' || t.state === 'failed').map(t => t.spaceSavedMB || 0);
  }, [tasks]);

  const maxSample = Math.max(1, ...throughputSamples);

  const phaseLabel = running ? (paused ? 'PAUSED' : 'CLEANING') : started ? (summary?.type === 'error' ? 'ABORTED' : 'COMPLETE') : 'READY';

  const displayValue = totalMB < 1024 ? totalMB.toFixed(2) : (totalMB / 1024).toFixed(2);
  const displayUnit = totalMB < 1024 ? 'MB' : 'GB';
  const ghostDigits = displayValue.replace(/\d/g, '8');

  const currentLabel = running && currentIdx !== null
    ? (TASK_LABELS[tasks[currentIdx]?.id] || '—')
    : phaseLabel === 'COMPLETE' ? 'Cleanup complete'
    : phaseLabel === 'ABORTED' ? 'Stopped'
    : phaseLabel === 'PAUSED' ? 'Paused'
    : 'Ready to start';

  return ReactDOM.createPortal(
    <div className="xfl-overlay">
      <div className={`xfl-panel xfl-phase-${phaseLabel.toLowerCase()}`}>
        <span className="xfl-corner xfl-corner-tl" />
        <span className="xfl-corner xfl-corner-tr" />
        <span className="xfl-corner xfl-corner-bl" />
        <span className="xfl-corner xfl-corner-br" />
        <div className="xfl-ruler xfl-ruler-top"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <div className="xfl-ruler xfl-ruler-bot"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        {running && <div className="xfl-scanline" />}
        <button className="xfl-rail-close xfl-panel-close" onClick={close} title="Dismiss" disabled={running && !paused}>
          <X size={13} />
        </button>

        {/* ═══ CORE — dual visualization (hex + LED readout) ═══ */}
        <div className="xfl-core">
          <div className="xfl-core-left">
            <div className="xfl-core-frame">
              <span className="xfl-core-frame-label">Task overview</span>
              <span className="xfl-core-frame-tag">10 tasks</span>
            </div>
            <div className="xfl-hex-zone">
              <svg viewBox="0 0 170 120" className="xfl-hex-svg" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <radialGradient id="xflHexActive" cx="50%" cy="50%" r="60%">
                    <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0.15" />
                  </radialGradient>
                  <radialGradient id="xflHexPurged" cx="50%" cy="50%" r="60%">
                    <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0.12" />
                  </radialGradient>
                  <filter id="xflHexGlow"><feGaussianBlur stdDeviation="1.2" /></filter>
                </defs>

                {HEX_ADJACENCIES.map(([a, b], i) => {
                  const ta = tasks[a];
                  const tb = tasks[b];
                  const liveEdge = (ta && tb && ((ta.state === 'purged' && tb.state === 'active') || (ta.state === 'active' && tb.state === 'queued')));
                  return (
                    <line
                      key={`edge-${i}`}
                      x1={HEX_POSITIONS[a].x} y1={HEX_POSITIONS[a].y}
                      x2={HEX_POSITIONS[b].x} y2={HEX_POSITIONS[b].y}
                      className={`xfl-hex-edge ${liveEdge ? 'xfl-hex-edge-live' : ''}`}
                    />
                  );
                })}

                {HEX_POSITIONS.map((pos, i) => {
                  const t = tasks[i];
                  const state = t?.state ?? 'dormant';
                  return (
                    <g key={`hex-${i}`} className={`xfl-hex-group xfl-hex-${state}`}>
                      <polygon points={hexPoints(pos.x, pos.y, 20)} className="xfl-hex-outer" />
                      <polygon points={hexPoints(pos.x, pos.y, 16)} className="xfl-hex-inner" />
                      {state === 'active' && (
                        <circle cx={pos.x} cy={pos.y} r="22" className="xfl-hex-ring" />
                      )}
                      <text x={pos.x} y={pos.y + 3} textAnchor="middle" className="xfl-hex-idx">
                        {(i + 1).toString().padStart(2, '0')}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="xfl-core-stats">
              <div className="xfl-core-stat"><span className="xfl-core-stat-dot xfl-core-stat-dot-armed" /><span>{queueLen - finishedCount} pending</span></div>
              <div className="xfl-core-stat"><span className="xfl-core-stat-dot xfl-core-stat-dot-done" /><span>{purgedCount} completed</span></div>
              {failedCount > 0 && <div className="xfl-core-stat"><span className="xfl-core-stat-dot xfl-core-stat-dot-fail" /><span>{failedCount} failed</span></div>}
              {disabledIds.size > 0 && <div className="xfl-core-stat"><span className="xfl-core-stat-dot xfl-core-stat-dot-skip" /><span>{disabledIds.size} skipped</span></div>}
            </div>
          </div>

          <div className="xfl-core-divider" />

          <div className="xfl-core-right">
            <div className="xfl-core-frame">
              <span className="xfl-core-frame-label">Summary</span>
              <span className="xfl-core-frame-tag">Active</span>
            </div>

            <div className="xfl-led">
              <span className="xfl-led-corner xfl-led-corner-tl" />
              <span className="xfl-led-corner xfl-led-corner-tr" />
              <span className="xfl-led-corner xfl-led-corner-bl" />
              <span className="xfl-led-corner xfl-led-corner-br" />
              <div className="xfl-led-digits">
                <span className="xfl-led-ghost">{ghostDigits}</span>
                <span className="xfl-led-value">{displayValue}</span>
              </div>
              <span className="xfl-led-unit">{displayUnit}</span>
              <div className="xfl-led-label">TOTAL RECLAIMED</div>
            </div>

            <div className="xfl-seg">
              <div className="xfl-seg-head">
                <span className="xfl-seg-head-label">Progress</span>
                <span className="xfl-seg-head-val">{donePct.toString().padStart(3, '0')}%</span>
              </div>
              <div className="xfl-seg-bar">
                {Array.from({ length: SEG_CELLS }, (_, i) => {
                  const isOn = i < litCells;
                  const isEdge = running && i === litCells && litCells < SEG_CELLS;
                  return <span key={i} className={`xfl-seg-cell${isOn ? ' on' : ''}${isEdge ? ' edge' : ''}`} />;
                })}
              </div>
              <div className="xfl-seg-foot">
                <span>TASK {Math.min(queueLen, finishedCount + (running ? 1 : 0)).toString().padStart(2, '0')} / {queueLen.toString().padStart(2, '0')}</span>
                <span className="xfl-seg-foot-sep" />
                <span>{phaseLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {adminError && (
          <div className="xfl-banner xfl-banner-error">
            <AlertTriangle size={13} />
            <div className="xfl-banner-text">
              <span className="xfl-banner-title">Administrator required</span>
              <span className="xfl-banner-msg">One or more cleanup tasks need elevated permissions. Restart the app as Administrator to continue.</span>
            </div>
          </div>
        )}

        {/* ═══ LOG — execution record ═══ */}
        <div className="xfl-log">
          <div className="xfl-log-head">
            <span className="xfl-log-tag">TASK LOG</span>
            <span className="xfl-log-sep" />
            <span className="xfl-log-count">{queueLen.toString().padStart(2, '0')} TASKS</span>
            {disabledIds.size > 0 && (
              <span className="xfl-log-muted">{disabledIds.size.toString().padStart(2, '0')} SKIPPED</span>
            )}
          </div>

          <div className="xfl-ledger" ref={ledgerRef}>
            {tasks.map((t, i) => {
              const label = TASK_LABELS[t.id] || t.id.toUpperCase();
              const idx = (i + 1).toString().padStart(2, '0');
              const time = t.startedAt ? formatClock(new Date(t.startedAt)) : '--:--:--';
              const bar = Array.from({ length: 10 }, (_, k) => {
                if (t.state === 'purged' || t.state === 'failed') return '█';
                if (t.state === 'active') return k < Math.floor(t.progress * 10) ? '█' : '░';
                return '░';
              }).join('');
              const glyph = t.state === 'purged' ? '✓' : t.state === 'failed' ? '✗' : t.state === 'active' ? '▸' : t.state === 'skipped' ? '⊘' : '·';
              const stateLabel = t.state === 'purged' ? 'CLEANED'
                : t.state === 'dormant' ? 'PENDING'
                : t.state.toUpperCase();
              const detail = t.state === 'purged' ? (t.spaceSaved || 'OK')
                : t.state === 'failed' ? (isPermissionError(t.message) ? 'ADMIN REQUIRED' : 'BLOCKED')
                : t.state === 'active' ? `${Math.floor(t.progress * 100)}%`
                : t.state === 'skipped' ? 'SKIPPED'
                : t.state === 'queued' ? 'QUEUED' : 'PENDING';

              return (
                <div key={t.id} className={`xfl-ledger-row xfl-ledger-${t.state}`}>
                  <span className="xfl-ld-idx">[{idx}]</span>
                  <span className="xfl-ld-time">{time}</span>
                  <span className="xfl-ld-glyph">{glyph}</span>
                  <span className="xfl-ld-name">{label.padEnd(22, '\u00A0')}</span>
                  <span className="xfl-ld-bar">{bar}</span>
                  <span className="xfl-ld-state">{stateLabel}</span>
                  <span className="xfl-ld-detail">· {detail}</span>
                </div>
              );
            })}
          </div>
        </div>

        {summary && (
          <div className={`xfl-summary xfl-summary-${summary.type}`}>
            <span className="xfl-summary-glyph">{summary.type === 'success' ? '◉' : summary.type === 'info' ? '◐' : '◌'}</span>
            <span>{summary.message}</span>
          </div>
        )}

        {/* ═══ CONSOLE — action deck ═══ */}
        <div className="xfl-console">
          <span className="xfl-console-edge xfl-console-edge-l" />
          <span className="xfl-console-edge xfl-console-edge-r" />
          {!started || summary ? (
            <>
              <button className="xfl-btn xfl-btn-primary" onClick={runAll} disabled={running || queueLen === 0}>
                <Power size={13} />
                <span>{started ? 'RESTART' : 'START'}</span>
              </button>
              <button className={`xfl-btn ${scopeOpen ? 'xfl-btn-on' : ''}`} onClick={() => setScopeOpen(v => !v)} disabled={running}>
                <Sliders size={13} /><span>Choose</span>
                {disabledIds.size > 0 && <span className="xfl-btn-badge">{disabledIds.size}</span>}
              </button>
              <div className="xfl-console-status">
                <span className="xfl-console-status-dot" />
                <span>{started ? (summary?.type === 'error' ? 'FAILED' : 'COMPLETED') : 'Ready'}</span>
              </div>
            </>
          ) : (
            <>
              <button className={`xfl-btn xfl-btn-primary ${running && !paused ? 'xfl-btn-live' : ''}`} onClick={togglePause} disabled={!running}>
                {paused ? <Play size={13} /> : <Pause size={13} />}
                <span>{paused ? 'RESUME' : 'PAUSE'}</span>
              </button>
              <button className="xfl-btn" onClick={() => { abortRef.current = true; if (resumeResolverRef.current) resumeResolverRef.current(); }} disabled={!running}>
                <RotateCcw size={13} /><span>CANCEL</span>
              </button>
              <div className="xfl-console-status">
                {running && <Loader2 size={12} className="xfl-spin" />}
                <span>{running ? (paused ? 'Paused' : `Running · task ${(currentIdx ?? 0) + 1} of ${queueLen}`) : 'Idle'}</span>
              </div>
            </>
          )}
        </div>

        {scopeOpen && !running && (
          <div className="xfl-scope">
            <div className="xfl-scope-head">
              <span>Select tasks to include in the next cleanup</span>
              <button className="xfl-scope-close" onClick={() => setScopeOpen(false)}><X size={12} /></button>
            </div>
            <div className="xfl-scope-grid">
              {defaultIds.map((id, i) => {
                const on = !disabledIds.has(id);
                return (
                  <button key={id} className={`xfl-scope-item ${on ? 'on' : 'off'}`} onClick={() => toggleScope(id)}>
                    <span className="xfl-scope-idx">{(i + 1).toString().padStart(2, '0')}</span>
                    <span className="xfl-scope-name">{TASK_LABELS[id] || id}</span>
                    <span className={`xfl-scope-pill ${on ? 'on' : 'off'}`}>{on ? 'ENABLED' : 'SKIPPED'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default CacheCleanupToast;

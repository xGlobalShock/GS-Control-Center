import React, { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import {
  antiCheatSystems,
  riskyApps,
  statusLabel,
  type CompatStatus,
  type AntiCheatSystem,
} from '../data/antiCheatCompat';
import '../styles/AntiCheatChecker.css';

interface DetectedAC {
  id: string;
  name: string;
  installed: boolean;
  running: boolean;
}

interface AntiCheatCheckerProps {
  compact?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}

const AntiCheatChecker: React.FC<AntiCheatCheckerProps> = ({ compact, isExpanded, onToggle }) => {
  const [expandedInternal, setExpandedInternal] = useState(false);
  const expanded = isExpanded !== undefined ? isExpanded : expandedInternal;
  const handleToggle = onToggle ?? (() => setExpandedInternal(v => !v));

  const [detectedAC, setDetectedAC] = useState<DetectedAC[]>([]);
  const [runningProcs, setRunningProcs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);

  /* ── Detect installed anti-cheats + running processes ───── */
  useEffect(() => {
    const scan = async () => {
      if (!window.electron?.ipcRenderer || inflightRef.current) return;
      inflightRef.current = true;
      try {
        const [acResult, procs] = await Promise.all([
          window.electron.ipcRenderer.invoke('anticheat:detect'),
          window.electron.ipcRenderer.invoke('anticheat:running-procs'),
        ]);
        if (Array.isArray(acResult)) setDetectedAC(acResult);
        if (Array.isArray(procs)) setRunningProcs(procs);
      } catch {} finally {
        inflightRef.current = false;
        setLoading(false);
      }
    };
    scan();
    timerRef.current = setInterval(scan, 15000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  /* ── Which AC systems are installed ──────────────────────── */
  const installedACIds = useMemo(
    () => new Set(detectedAC.filter(ac => ac.installed).map(ac => ac.id)),
    [detectedAC]
  );

  /* ── Which risky apps are currently running ─────────────── */
  const flaggedApps = useMemo(() => {
    if (installedACIds.size === 0) return [];
    const procSet = new Set(runningProcs);
    return riskyApps.filter(app => {
      const isRunning = app.processNames.some(p => procSet.has(p.toLowerCase()));
      if (!isRunning) return false;
      // Only flag if at least one installed AC has caution or risky
      return Array.from(installedACIds).some(acId => {
        const s = app.status[acId];
        return s === 'caution' || s === 'risky';
      });
    });
  }, [runningProcs, installedACIds]);

  const riskyCount = useMemo(() =>
    flaggedApps.filter(app =>
      Array.from(installedACIds).some(acId => app.status[acId] === 'risky')
    ).length,
  [flaggedApps, installedACIds]);

  const cautionCount = flaggedApps.length - riskyCount;
  const allClear = flaggedApps.length === 0 && !loading;

  /* ── Summary text ────────────────────────────────────────── */
  const summaryText = loading ? 'Scanning...'
    : installedACIds.size === 0 ? 'No anti-cheat detected'
    : allClear ? 'No risky apps found'
    : `${riskyCount > 0 ? `${riskyCount} risky` : ''}${riskyCount > 0 && cautionCount > 0 ? ', ' : ''}${cautionCount > 0 ? `${cautionCount} caution` : ''} app${flaggedApps.length > 1 ? 's' : ''}`;

  /* ── Relevant AC systems for badge display ─────────────── */
  const relevantSystems: AntiCheatSystem[] = useMemo(
    () => antiCheatSystems.filter(acs => installedACIds.has(acs.id)),
    [installedACIds]
  );

  const cardClass = [
    'ac-card',
    compact ? 'ac-card--compact' : '',
    allClear ? 'ac-card--clear' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      <div className="ac-header" onClick={handleToggle}>
        <div className="ac-icon-wrap">
          {allClear
            ? <ShieldCheck size={18} className="ac-icon-good" />
            : <ShieldAlert size={18} className="ac-icon-warn" />
          }
        </div>
        <div className="ac-title-area">
          <div className="ac-title">Anti-Cheat</div>
          <div className="ac-summary">{summaryText}</div>
        </div>
        <div className="ac-toggle">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && !loading && (
          <motion.div
            className="ac-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {/* Detected AC systems pills */}
            <div className="ac-systems">
              {antiCheatSystems.map(acs => {
                const detected = installedACIds.has(acs.id);
                // Determine pill state: installed with issues = warning, installed & clear = ok, not found = dim
                const hasIssues = detected && flaggedApps.some(app => {
                  const s = app.status[acs.id];
                  return s === 'caution' || s === 'risky';
                });
                const pillClass = !detected
                  ? 'ac-system-pill--not-found'
                  : hasIssues
                    ? 'ac-system-pill--warning'
                    : 'ac-system-pill--ok';
                return (
                  <span
                    key={acs.id}
                    className={`ac-system-pill ${pillClass}`}
                  >
                    {acs.shortName}
                    {detected && detectedAC.find(d => d.id === acs.id)?.running && ' ●'}
                  </span>
                );
              })}
            </div>

            {allClear ? (
              <div className="ac-all-clear">
                <CheckCircle2 size={16} className="ac-all-clear-icon" />
                <span className="ac-all-clear-text">
                  {installedACIds.size === 0
                    ? 'No anti-cheat systems detected. All GC Center tweaks are safe to use.'
                    : 'No risky applications detected. All running processes are compatible with your anti-cheat systems.'}
                </span>
              </div>
            ) : (
              <div className="ac-matrix">
                <div className="ac-matrix-header">
                  <AlertTriangle size={14} /> Risky Apps Running
                </div>
                {flaggedApps.map(app => (
                  <React.Fragment key={app.label}>
                    <div className="ac-row">
                      <span className="ac-row-label">{app.label}</span>
                      <div className="ac-badges">
                        {relevantSystems.map(acs => {
                          const s: CompatStatus = app.status[acs.id] || 'safe';
                          return (
                            <span
                              key={acs.id}
                              className={`ac-badge ac-badge--${s}`}
                              title={`${acs.name}: ${statusLabel[s]}`}
                            >
                              {acs.shortName}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    {app.note && <div className="ac-row-note">{app.note}</div>}
                    {app.resolution && (
                      <div className="ac-row-resolution">
                        <Wrench size={12} className="ac-resolution-icon" />
                        <span>{app.resolution}</span>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AntiCheatChecker;

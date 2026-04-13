import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanLine, Cpu, Thermometer, HardDrive, Wifi, MemoryStick, MonitorCheck, ChevronDown, ChevronUp, Lightbulb, ArrowUpCircle, Zap, BatteryCharging, Activity, Eye, X, Monitor } from 'lucide-react';
import '../styles/AdvisorPanel.css';

interface Insight {
  id: string;
  severity: 'critical' | 'warning' | 'good';
  icon: string;
  title: string;
  description: string;
  suggestions: string[];
}

interface Upgrade {
  component: string;
  reason: string;
  specifics: string;
  impact: string;
  priority: number;
}

interface AdvisorData {
  insights: Insight[];
  upgrades: Upgrade[];
}

interface AdvisorPanelProps {
  systemStats: { cpu: number; ram: number; disk: number; temperature: number };
  extendedStats?: {
    gpuTemp?: number; gpuUsage?: number; gpuVramUsed?: number; gpuVramTotal?: number;
    latencyMs?: number; packetLoss?: number;
    ramTotalGB?: number; ramUsedGB?: number; ramAvailableGB?: number;
    processCount?: number; networkUp?: number; networkDown?: number;
  };
  hardwareInfo?: {
    cpuName?: string; cpuCores?: number; ramTotalGB?: number; ramType?: string;
    ramSlotsTotal?: number; ramSlotsUsed?: number; ramSpeed?: string;
    diskType?: string; diskName?: string; gpuVramTotal?: string;
    hasBattery?: boolean;
  };
  compact?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  cpu: <Cpu size={15} />,
  gpu: <MonitorCheck size={15} />,
  thermometer: <Thermometer size={15} />,
  memory: <MemoryStick size={15} />,
  disk: <HardDrive size={15} />,
  network: <Wifi size={15} />,
  check: <MonitorCheck size={15} />,
  zap: <Zap size={15} />,
  'battery-charging': <BatteryCharging size={15} />,
  activity: <Activity size={15} />,
  monitor: <Monitor size={15} />,
};

const ICON_MAP_LG: Record<string, React.ReactNode> = {
  cpu: <Cpu size={22} />,
  gpu: <MonitorCheck size={22} />,
  thermometer: <Thermometer size={22} />,
  memory: <MemoryStick size={22} />,
  disk: <HardDrive size={22} />,
  network: <Wifi size={22} />,
  check: <MonitorCheck size={22} />,
  zap: <Zap size={22} />,
  'battery-charging': <BatteryCharging size={22} />,
  activity: <Activity size={22} />,
  monitor: <Monitor size={22} />,
};

const severityClass: Record<string, string> = {
  critical: 'advisor-severity-critical',
  warning: 'advisor-severity-warning',
  good: 'advisor-severity-good',
};

const AdvisorPanel: React.FC<AdvisorPanelProps> = ({ systemStats, extendedStats, hardwareInfo, compact, isExpanded, onToggle }) => {
  const [data, setData] = useState<AdvisorData | null>(null);
  const [expandedInternal, setExpandedInternal] = useState(false);
  const expanded = isExpanded !== undefined ? isExpanded : expandedInternal;
  const handleToggle = onToggle ?? (() => setExpandedInternal(v => !v));
  const [showOverlay, setShowOverlay] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);
  const latestPropsRef = useRef({ systemStats, extendedStats, hardwareInfo });
  latestPropsRef.current = { systemStats, extendedStats, hardwareInfo };

  useEffect(() => {
    const analyze = async () => {
      if (!window.electron?.ipcRenderer || inflightRef.current) return;
      inflightRef.current = true;
      try {
        const { systemStats: s, extendedStats: e, hardwareInfo: h } = latestPropsRef.current;
        const stats = {
          ...s,
          gpuTemp: e?.gpuTemp,
          gpuUsage: e?.gpuUsage,
          gpuVramUsed: e?.gpuVramUsed,
          gpuVramTotal: e?.gpuVramTotal,
          latencyMs: e?.latencyMs,
          packetLoss: e?.packetLoss,
          ramTotalGB: e?.ramTotalGB ?? h?.ramTotalGB,
          ramUsedGB: e?.ramUsedGB,
          ramAvailableGB: e?.ramAvailableGB,
          processCount: e?.processCount,
          networkUp: e?.networkUp,
          networkDown: e?.networkDown,
        };
        const result = await window.electron.ipcRenderer.invoke('advisor:analyze', stats, h);
        setData(result);
      } catch {} finally { inflightRef.current = false; }
    };
    analyze();
    timerRef.current = setInterval(analyze, 8000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const criticalCount = data?.insights.filter(i => i.severity === 'critical').length ?? 0;
  const warningCount = data?.insights.filter(i => i.severity === 'warning').length ?? 0;
  const isAllGood = data?.insights.length === 1 && data.insights[0].id === 'all-good';

  const advisorStatus = !data ? ''
    : isAllGood ? 'advisor-card--good'
    : criticalCount > 0 ? 'advisor-card--critical'
    : 'advisor-card--warning';
  const dotStatus = !data ? 'good' : isAllGood ? 'good' : criticalCount > 0 ? 'critical' : 'warning';

  return (
    <div className={[
      'advisor-card',
      compact ? 'advisor-card--compact' : '',
      compact && data ? advisorStatus : '',
    ].filter(Boolean).join(' ')}>
      <div className="advisor-header" onClick={handleToggle}>
        <div className="advisor-icon-wrap">
          <ScanLine size={18} className={isAllGood ? 'advisor-brain-good' : 'advisor-brain-active'} />
        </div>
        <div className="advisor-title-area">
          <div className="advisor-title">System Advisor</div>
          <div className={`advisor-summary${
              !data ? '' :
              isAllGood ? ' advisor-summary--good' :
              criticalCount > 0 ? ' advisor-summary--critical' :
              ' advisor-summary--warning'
            }`}>
            {!data ? 'Analyzing...' :
              isAllGood ? 'System running optimally' :
              `${criticalCount > 0 ? `${criticalCount} critical` : ''}${criticalCount > 0 && warningCount > 0 ? ', ' : ''}${warningCount > 0 ? `${warningCount} warning${warningCount > 1 ? 's' : ''}` : ''}`
            }
          </div>
        </div>
        <div className="advisor-toggle">
          {compact && <span className={`hud-dot hud-dot--${dotStatus}`} />}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && data && (
          <motion.div
            className="advisor-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {isAllGood ? (
              <div className="advisor-insight advisor-severity-good">
                <div className="advisor-insight-header">
                  <span className="advisor-insight-icon">{ICON_MAP['check']}</span>
                  <span className="advisor-insight-title">No Issues Detected</span>
                </div>
                <p className="advisor-insight-desc">Your system is running smoothly.</p>
              </div>
            ) : (
              <div className="advisor-insight advisor-severity-warning">
                <div className="advisor-insight-header">
                  <span className="advisor-insight-icon"><Activity size={15} /></span>
                  <span className="advisor-insight-title">Issue Detected</span>
                </div>
                <p className="advisor-insight-desc">We've detected an issue with your PC, click view details for more info.</p>
                <button
                  className="advisor-view-details-btn"
                  onClick={(e) => { e.stopPropagation(); setShowOverlay(true); }}
                >
                  <Eye size={11} /> View Details
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Full Analysis Overlay ── */}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {showOverlay && data && !isAllGood && (
            <motion.div
              className="advisor-overlay-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowOverlay(false)}
            >
              <motion.div
                className="advisor-overlay-panel advisor-overlay-full"
                initial={{ opacity: 0, y: 30, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <button className="advisor-overlay-close" onClick={() => setShowOverlay(false)}>
                  <X size={16} />
                </button>

                <div className="advisor-overlay-header">
                  <div className="advisor-overlay-icon advisor-severity-warning">
                    <ScanLine size={22} />
                  </div>
                  <div className="advisor-overlay-title-area">
                    <h3 className="advisor-overlay-title">System Analysis</h3>
                  </div>
                </div>

                <div className="advisor-overlay-body">
                  {data.insights.filter(i => i.id !== 'all-good').map((insight) => (
                    <div key={insight.id} className={`advisor-overlay-insight ${severityClass[insight.severity] || ''}`}>
                      <div className="advisor-overlay-insight-header">
                        <span className="advisor-overlay-insight-icon">{ICON_MAP[insight.icon] || <ScanLine size={15} />}</span>
                        <span className={`advisor-overlay-severity-badge advisor-badge-${insight.severity}`}>
                          {insight.severity}
                        </span>
                        <span className="advisor-overlay-insight-title">{insight.title}</span>
                      </div>
                      <p className="advisor-overlay-desc">{insight.description}</p>
                      {insight.suggestions.length > 0 && (
                        <div className="advisor-overlay-suggestions">
                          <div className="advisor-overlay-suggestions-label">
                            <Lightbulb size={13} /> Recommendations
                          </div>
                          <ul>
                            {insight.suggestions.filter(Boolean).map((s, i) => (
                              <li key={i}><Lightbulb size={11} /> {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}

                  {data.upgrades.length > 0 && (
                    <div className="advisor-overlay-upgrades">
                      <div className="advisor-upgrades-title">
                        <ArrowUpCircle size={14} /> Upgrade Recommendations
                      </div>
                      {data.upgrades.map((u, i) => (
                        <div key={i} className="advisor-upgrade-row">
                          <div className="advisor-upgrade-header">
                            <span className="advisor-upgrade-component">{u.component}</span>
                            <span className="advisor-upgrade-impact">{u.impact}</span>
                          </div>
                          <p className="advisor-upgrade-reason">{u.reason}</p>
                          <span className="advisor-upgrade-specifics">{u.specifics}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default AdvisorPanel;

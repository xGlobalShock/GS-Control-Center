import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Cpu, Thermometer, HardDrive, Wifi, MemoryStick, MonitorCheck, ChevronDown, ChevronUp, Lightbulb, ArrowUpCircle, Zap, BatteryCharging, Activity } from 'lucide-react';
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
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
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

  return (
    <div className={`advisor-card${compact ? ' advisor-card--compact' : ''}`}>
      <div className="advisor-header" onClick={handleToggle}>
        <div className="advisor-icon-wrap">
          <Brain size={18} className={isAllGood ? 'advisor-brain-good' : 'advisor-brain-active'} />
        </div>
        <div className="advisor-title-area">
          <div className="advisor-title">System Advisor</div>
          <div className="advisor-summary">
            {!data ? 'Analyzing...' :
              isAllGood ? 'System running optimally' :
              `${criticalCount > 0 ? `${criticalCount} critical` : ''}${criticalCount > 0 && warningCount > 0 ? ', ' : ''}${warningCount > 0 ? `${warningCount} warning${warningCount > 1 ? 's' : ''}` : ''}`
            }
          </div>
        </div>
        <div className="advisor-toggle">
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
            {data.insights.map((insight) => (
              <div key={insight.id} className={`advisor-insight ${severityClass[insight.severity] || ''}`}>
                <div
                  className="advisor-insight-header"
                  onClick={(e) => { e.stopPropagation(); setExpandedInsight(expandedInsight === insight.id ? null : insight.id); }}
                >
                  <span className="advisor-insight-icon">{ICON_MAP[insight.icon] || <Brain size={15} />}</span>
                  <span className="advisor-insight-title">{insight.title}</span>
                  {insight.suggestions.length > 0 && (
                    <span className="advisor-insight-expand">
                      {expandedInsight === insight.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </span>
                  )}
                </div>
                <p className="advisor-insight-desc">{insight.description}</p>
                <AnimatePresence>
                  {expandedInsight === insight.id && insight.suggestions.length > 0 && (
                    <motion.ul
                      className="advisor-suggestions"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {insight.suggestions.map((s, i) => (
                        <li key={i}><Lightbulb size={11} /> {s}</li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>
            ))}

            {data.upgrades.length > 0 && (
              <div className="advisor-upgrades">
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdvisorPanel;

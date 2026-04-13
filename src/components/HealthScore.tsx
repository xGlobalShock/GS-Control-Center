import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import '../styles/HealthScore.css';

interface HealthFactor {
  key: string;
  label: string;
  score: number;
  weight: number;
  value: string;
  status: 'good' | 'warning' | 'critical' | 'unknown';
}

interface HealthData {
  score: number;
  factors: HealthFactor[];
}

interface HealthScoreProps {
  systemStats: { cpu: number; ram: number; disk: number; temperature: number };
  extendedStats?: { gpuTemp?: number; gpuUsage?: number; latencyMs?: number; ramTotalGB?: number };
  hardwareInfo?: { diskHealth?: string; ramTotalGB?: number };
  compact?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'good': return <CheckCircle2 size={13} className="health-icon-good" />;
    case 'warning': return <AlertTriangle size={13} className="health-icon-warning" />;
    case 'critical': return <XCircle size={13} className="health-icon-critical" />;
    default: return <HelpCircle size={13} className="health-icon-unknown" />;
  }
};

const scoreColor = (score: number) => {
  if (score >= 75) return '#00CC6A';
  if (score >= 60) return '#FFD600';
  if (score >= 40) return '#f97316';
  return '#ef4444';
};

const scoreLabel = (score: number) => {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 55) return 'Fair';
  if (score >= 35) return 'Poor';
  return 'Critical';
};

const HealthScore: React.FC<HealthScoreProps> = ({ systemStats, extendedStats, hardwareInfo, compact, isExpanded, onToggle }) => {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [expandedInternal, setExpandedInternal] = useState(false);
  const expanded = isExpanded !== undefined ? isExpanded : expandedInternal;
  const handleToggle = onToggle ?? (() => setExpandedInternal(v => !v));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);
  const latestPropsRef = useRef({ systemStats, extendedStats, hardwareInfo });
  latestPropsRef.current = { systemStats, extendedStats, hardwareInfo };

  useEffect(() => {
    const compute = async () => {
      if (!window.electron?.ipcRenderer || inflightRef.current) return;
      inflightRef.current = true;
      try {
        const { systemStats: s, extendedStats: e, hardwareInfo: h } = latestPropsRef.current;
        const stats = {
          ...s,
          gpuTemp: e?.gpuTemp,
          gpuUsage: e?.gpuUsage,
          latencyMs: e?.latencyMs,
          ramTotalGB: e?.ramTotalGB ?? h?.ramTotalGB,
        };
        const result = await window.electron.ipcRenderer.invoke('health:compute', stats, h);
        setHealthData(result);
      } catch {} finally { inflightRef.current = false; }
    };
    compute();
    timerRef.current = setInterval(compute, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const score = healthData?.score ?? 0;
  const color = scoreColor(score);
  const textColor = color === '#00CC6A' ? '#FFFFFF' : color;
  const labelColor = score >= 90 ? '#00CC6A' : textColor;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (score / 100) * circumference;

  const statusModifier = !healthData ? ''
    : score >= 75 ? 'health-score-card--good'
    : score >= 50 ? 'health-score-card--warning'
    : 'health-score-card--critical';
  const dotStatus = !healthData ? 'good' : score >= 75 ? 'good' : score >= 50 ? 'warning' : 'critical';

  return (
    <div className={[
      'health-score-card',
      compact ? 'health-score-card--compact' : '',
      compact && healthData ? statusModifier : '',
    ].filter(Boolean).join(' ')}>
      <div className="health-score-header" onClick={handleToggle}>
        <div className="health-score-gauge">
          <svg viewBox="0 0 100 100" className="health-score-ring">
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <motion.circle
              cx="50" cy="50" r="42" fill="none"
              stroke={color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </svg>
          <div className="health-score-number" style={{ color: textColor }}>
            {healthData ? score : '—'}
          </div>
        </div>
        <div className="health-score-info">
          <div className="health-score-title">System Health</div>
          <div className="health-score-label" style={{ color: labelColor }}>
            {healthData ? scoreLabel(score) : 'Analyzing...'}
          </div>
        </div>
        <div className="health-score-toggle">
          {compact && <span className={`hud-dot hud-dot--${dotStatus}`} />}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && healthData && (
          <motion.div
            className="health-factors"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {healthData.factors.map((f) => (
              <div key={f.key} className="health-factor-row">
                {statusIcon(f.status)}
                <span className="health-factor-label">{f.label}</span>
                <span className="health-factor-value">{f.value}</span>
                {/*
                GPU-composited bar: --bar-scale drives transform: scaleX() via CSS.
                Replaces Framer Motion animate width → which triggered layout recalc per frame.
                @keyframes healthBarFill handles entrance; CSS transition handles score updates.
              */}
              <div className="health-factor-bar-wrap">
                <div
                  className={`health-factor-bar health-bar-${f.status}`}
                  style={{ '--bar-scale': `${f.score / 100}` } as React.CSSProperties}
                />
              </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HealthScore;


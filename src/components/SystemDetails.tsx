import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu, MonitorSpeaker, MemoryStick, HardDrive,
  Network, Wifi, Zap, Battery, Monitor, Server,
  ArrowUp, ArrowDown, Activity, Gauge, Clock,
} from 'lucide-react';
import type { HardwareInfo, ExtendedStats } from '../App';
import '../styles/SystemDetails.css';

/* ═══════════════════════════════════════════
   Types
═══════════════════════════════════════════ */
interface SystemDetailsProps {
  systemStats?: {
    cpu: number; ram: number; disk: number; temperature: number;
    tempSource?: string;
    lhmReady?: boolean;
    gpuTemp?: number; gpuUsage?: number; gpuVramUsed?: number; gpuVramTotal?: number;
  };
  hardwareInfo?: HardwareInfo;
  extendedStats?: ExtendedStats;
  hideHeader?: boolean; // when true, skip the internal section header (outer page already has one)
}

/* ═══════════════════════════════════════════
   Formatters
═══════════════════════════════════════════ */
const fmt = (n: number): string => {
  if (n <= 0) return '0 B/s';
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB/s`;
  return `${(n / 1073741824).toFixed(2)} GB/s`;
};

const fmtMbps = (bytesPerSec?: number) => {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 Mbps';
  const mbps = (bytesPerSec * 8) / (1024 * 1024);
  return mbps >= 100 ? `${Math.round(mbps)} Mbps` : `${mbps.toFixed(1)} Mbps`;
};

const formatMiBtoGB = (mb?: number | null): string => {
  if (!mb || mb <= 0) return '—';
  const gb = mb / 1024;
  return gb % 1 === 0 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
};

const cleanBoardName = (name?: string) => {
  if (!name) return '';
  return name.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*-\s*.*/g, '').trim();
};

const isPlaceholderSerial = (s?: string) => {
  if (!s) return true;
  const v = s.trim().toLowerCase();
  const invalid = ['default string', 'to be filled by o.e.m.', 'to be filled by oem', 'system serial number', 'not specified', 'none', 'unknown', 'baseboard serial number'];
  if (invalid.includes(v)) return true;
  if (/^0+$/.test(s)) return true;
  if (s.trim().length < 3) return true;
  return false;
};

const parseLinkSpeedStr = (s?: string): number | undefined => {
  if (!s) return undefined;
  const str = String(s).trim();
  const m = str.match(/([0-9]+(?:\.[0-9]+)?)\s*(g|m)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    return unit === 'g' ? val * 1000 : val;
  }
  const num = parseFloat(str.replace(/[^0-9\.]/g, ''));
  if (!isNaN(num)) {
    if (num > 10000) return Math.round(num / 1000000);
    return num;
  }
  return undefined;
};

/* ═══════════════════════════════════════════
   SVG Gradient Definitions
═══════════════════════════════════════════ */
const HudGradients: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }}>
    <defs>
      <linearGradient id="hud-cyan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00F2FF" />
        <stop offset="100%" stopColor="#00D4AA" />
      </linearGradient>
      <linearGradient id="hud-emerald-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00FF88" />
        <stop offset="100%" stopColor="#00F2FF" />
      </linearGradient>
      <linearGradient id="hud-heat-low" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#00F2FF" />
        <stop offset="100%" stopColor="#00D4AA" />
      </linearGradient>
      <linearGradient id="hud-heat-mid" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#00F2FF" />
        <stop offset="100%" stopColor="#FFD600" />
      </linearGradient>
      <linearGradient id="hud-heat-high" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#FF6B00" />
        <stop offset="100%" stopColor="#FF2D55" />
      </linearGradient>
    </defs>
  </svg>
);

/* ═══════════════════════════════════════════
   Radial Gauge — glowing circular indicator
═══════════════════════════════════════════ */
const RadialGauge: React.FC<{
  value: number; unit?: string; displayValue?: string | number; size?: number;
}> = ({ value, unit = '%', displayValue, size = 64 }) => {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(value, 100));
  const arcLen = circ * 0.75;
  const offset = arcLen - (pct / 100) * arcLen;
  const rotation = 135;
  const center = size / 2;
  const color = pct > 80 ? '#FF2D55' : pct > 60 ? '#FFD600' : '#00F2FF';

  return (
    <div className="hud-radial-gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* bg track */}
        <circle cx={center} cy={center} r={r}
          fill="none" stroke="rgba(0,242,255,0.08)" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circ}`} strokeDashoffset={0}
          transform={`rotate(${rotation} ${center} ${center})`}
        />
        {/* active arc */}
        <circle cx={center} cy={center} r={r}
          fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circ}`} strokeDashoffset={offset}
          transform={`rotate(${rotation} ${center} ${center})`}
          style={{
            transition: 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease',
            filter: `drop-shadow(0 0 6px ${color}88)`,
          }}
        />
      </svg>
      <div className="hud-radial-text">
        <span className="hud-radial-val" style={{ color }}>{displayValue ?? Math.round(value)}</span>
        <span className="hud-radial-unit">{unit}</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Neon Bar Gauge — thin glowing horizontal bar
═══════════════════════════════════════════ */
const NeonBar: React.FC<{ pct: number; label?: string; display?: string; color?: string }> = ({
  pct, label, display, color = '#00F2FF',
}) => (
  <div className="hud-neon-bar-wrap">
    {(label || display) && (
      <div className="hud-neon-bar-header">
        {label && <span className="hud-neon-bar-label">{label}</span>}
        {display && <span className="hud-neon-bar-display" style={{ color }}>{display}</span>}
      </div>
    )}
    <div className="hud-neon-bar-track">
      <div
        className="hud-neon-bar-fill"
        style={{
          width: `${Math.min(pct, 100)}%`,
          background: `linear-gradient(90deg, ${color}00, ${color})`,
          boxShadow: `0 0 8px ${color}66, 0 0 2px ${color}44`,
        }}
      />
    </div>
  </div>
);

/* ═══════════════════════════════════════════
   Shimmer Loader
═══════════════════════════════════════════ */
const ValueLoader: React.FC = () => (
  <span className="hud-value-loader"><span className="hud-value-loader-bar" /></span>
);

/* ═══════════════════════════════════════════
   Skeleton Loading Screen  —  shown while
   the first batch of hardware data arrives
═══════════════════════════════════════════ */
const SKELETON_CARDS = [
  { cls: 'hud-tile-cpu',     icon: <Cpu size={18} />,            title: 'PROCESSOR',  rows: 4 },
  { cls: 'hud-tile-gpu',     icon: <MonitorSpeaker size={18} />, title: 'GRAPHICS',   rows: 3 },
  { cls: 'hud-tile-mem',     icon: <MemoryStick size={18} />,    title: 'MEMORY',     rows: 3 },
  { cls: 'hud-tile-storage', icon: <HardDrive size={18} />,      title: 'STORAGE',    rows: 3 },
  { cls: 'hud-tile-net',     icon: <Network size={18} />,        title: 'NETWORK',    rows: 4 },
  { cls: 'hud-tile-sys',     icon: <Monitor size={18} />,        title: 'SYSTEM',     rows: 4 },
];

interface SkeletonProps {
  hideHeader?: boolean;
}

const SkeletonLoading: React.FC<SkeletonProps> = ({ hideHeader }) => (
  <motion.section
    className="hud-section"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.35 }}
  >
    {/* Header - may be hidden when outer page already has one */}
    {!hideHeader && (
      <div className="hud-section-header">
        <div className="hud-section-icon"><Server size={16} /></div>
        <h3 className="hud-section-title">SYSTEM DETAILS</h3>
        <div className="hud-section-line" />
      </div>
    )}

    {/* Skeleton status bar */}
    <div className="hud-skel-status">
      <Activity size={13} className="hud-skel-status-icon" />
      <span>Initializing hardware monitors…</span>
      <span className="hud-skel-dots" />
    </div>

    {/* Skeleton bento grid */}
    <div className="hud-bento-grid">
      {SKELETON_CARDS.map((card, i) => (
        <motion.div
          key={card.cls}
          className={`hud-bento-card hud-skel-card ${card.cls}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Scanning line animation */}
          <div className="hud-skel-scan-line" />

          {/* Corner accents (reuse existing classes) */}
          <div className="hud-corner hud-corner-tl" />
          <div className="hud-corner hud-corner-tr" />
          <div className="hud-corner hud-corner-bl" />
          <div className="hud-corner hud-corner-br" />

          <div className="hud-card-inner">
            {/* Header skeleton */}
            <div className="hud-card-head">
              <div className="hud-card-icon hud-skel-dim">{card.icon}</div>
              <div className="hud-card-title-group">
                <div className="hud-card-title">{card.title}</div>
                <div className="hud-skel-subtitle-bar" />
              </div>
              {/* Ghost gauge */}
              <div className="hud-skel-gauge" />
            </div>

            {/* Row skeletons */}
            <div className="hud-card-body">
              {Array.from({ length: card.rows }).map((_, ri) => (
                <div key={ri} className="hud-row hud-skel-row">
                  <span className="hud-skel-row-label" />
                  <span className="hud-skel-row-value" />
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  </motion.section>
);

/* ═══════════════════════════════════════════
   Info Row
═══════════════════════════════════════════ */
const Row: React.FC<{
  label: string; value?: React.ReactNode; accent?: boolean;
  chip?: 'green' | 'yellow'; loading?: boolean;
}> = ({ label, value, accent, chip, loading }) => (
  <div className="hud-row">
    <span className="hud-label">{label}</span>
    {loading ? (
      <ValueLoader />
    ) : chip ? (
      <span className={`hud-chip ${chip}`}>{value ?? '—'}</span>
    ) : (
      <div className={`hud-value${accent ? ' hud-accent' : ''}`}>{value ?? '—'}</div>
    )}
  </div>
);

/* ═══════════════════════════════════════════
   IO Speed Badges
═══════════════════════════════════════════ */
const IOStrip: React.FC<{ up: string; down: string }> = ({ up, down }) => (
  <div className="hud-io-strip">
    <span className="hud-io-badge up"><ArrowUp size={9} />{up}</span>
    <span className="hud-io-badge down"><ArrowDown size={9} />{down}</span>
  </div>
);

/* ═══════════════════════════════════════════
   Per-Core Inline Strip
═══════════════════════════════════════════ */
const CoreHeatMap: React.FC<{ cores: number[]; threadCount?: number; coreCount?: number; loading?: boolean }> = ({
  cores, threadCount, coreCount, loading,
}) => {
  const getColor = (pct: number) => {
    if (pct < 25) return '#00F2FF';
    if (pct < 60) return '#00D4AA';
    if (pct < 85) return '#FFD600';
    return '#FF2D55';
  };

  const totalThreads = loading ? (threadCount || 8) : cores.length;
  const physCores = coreCount || Math.ceil(totalThreads / 2);
  const hasHT = totalThreads > physCores;

  const avg = !loading && cores.length > 0
    ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length)
    : 0;
  const avgColor = getColor(avg);

  const grouped: number[] = [];
  if (!loading && cores.length > 0) {
    if (hasHT) {
      for (let i = 0; i < physCores; i++) {
        grouped.push(Math.max(cores[i * 2] ?? 0, cores[i * 2 + 1] ?? 0));
      }
    } else {
      cores.forEach(p => grouped.push(p));
    }
  } else {
    for (let i = 0; i < (coreCount || Math.ceil(totalThreads / 2) || 4); i++) {
      grouped.push(0);
    }
  }

  return (
    <div className="hud-usage-rt">
      <div className="hud-usage-rt-stat">
        <div className="hud-usage-rt-head">
          <span className="hud-usage-rt-dot" style={{ background: loading ? 'rgba(255,255,255,0.1)' : avgColor, boxShadow: loading ? 'none' : `0 0 5px ${avgColor}` }} />
          <span className="hud-usage-rt-key">Per-Core</span>
        </div>
        <span className="hud-usage-rt-big" style={{ color: loading ? 'rgba(255,255,255,0.1)' : avgColor }}>
          {loading ? '—' : `${avg}%`}<small> avg</small>
        </span>
        <div className="hud-cstrip-bar">
          {grouped.map((raw, i) => {
            const pct = loading ? 0 : Math.min(raw, 100);
            const color = getColor(pct);
            return (
              <div
                key={i}
                className={`hud-cstrip-seg ${loading ? 'hud-cstrip-dim' : ''}`}
                style={{ background: loading ? 'rgba(255,255,255,0.06)' : color, opacity: loading ? 0.3 : Math.max(0.25, pct / 100) }}
                title={`Core ${i}: ${Math.round(pct)}%`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Bento Card — Glassmorphic container
═══════════════════════════════════════════ */
const BentoCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  gaugeValue?: number;
  gaugeUnit?: string;
  gaugeDisplay?: string | number;
  className?: string;
  delay?: number;
  pulse?: 'high' | 'warn' | false;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, gaugeValue, gaugeUnit, gaugeDisplay, className = '', delay = 0, pulse = false, children }) => {
  const pulseClass = pulse === 'high' ? 'hud-pulse' : pulse === 'warn' ? 'hud-pulse-warn' : '';
  return (
  <motion.div
    className={`hud-bento-card ${className} ${pulseClass}`}
    initial={{ opacity: 0, y: 20, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
  >
    {/* Scanline overlay */}
    <div className="hud-scanline-overlay" />
    {/* Animated scan line */}
    <div className="hud-scan-line" />
    {/* Corner accents */}
    <div className="hud-corner hud-corner-tl" />
    <div className="hud-corner hud-corner-tr" />
    <div className="hud-corner hud-corner-bl" />
    <div className="hud-corner hud-corner-br" />

    {/* Top accent line */}
    <div className="hud-card-accent-line">
      <div className="hud-card-accent-fill" style={{ width: `${gaugeValue ?? 0}%` }} />
    </div>

    <div className="hud-card-inner">
      {/* Header */}
      <div className="hud-card-head">
        <div className="hud-card-icon">{icon}</div>
        <div className="hud-card-title-group">
          <div className="hud-card-title">{title}</div>
          {subtitle && <div className="hud-card-subtitle" title={subtitle}>{subtitle}</div>}
        </div>
        {gaugeValue !== undefined && (
          <RadialGauge value={gaugeValue} unit={gaugeUnit} displayValue={gaugeDisplay} />
        )}
      </div>

      {/* Body */}
      <div className="hud-card-body">{children}</div>
    </div>
  </motion.div>
  );
};

/* ═══════════════════════════════════════════
   Main SystemDetails Component
═══════════════════════════════════════════ */
const SystemDetails: React.FC<SystemDetailsProps> = ({ systemStats, hardwareInfo, extendedStats, hideHeader }) => {
  const hw = hardwareInfo;
  const ext = extendedStats;
  const s = systemStats;

  // ── Network info blur toggle (double-click to hide/show) ──
  const [blurredFields, setBlurredFields] = useState<Record<string, boolean>>({});
  const toggleBlur = useCallback((field: string) => {
    setBlurredFields(prev => ({ ...prev, [field]: !prev[field] }));
  }, []);

  // ── Show skeleton while no meaningful data has arrived ──
  const hasAnyData = (s && s.cpu > 0) || hw || ext;
  if (!hasAnyData) return <SkeletonLoading hideHeader={hideHeader} />;

  const gpuUsage = ext?.gpuUsage != null && ext.gpuUsage >= 0 ? ext.gpuUsage : (s?.gpuUsage ?? -1);
  const gpuTemp = ext?.gpuTemp != null && ext.gpuTemp >= 0 ? ext.gpuTemp : (s?.gpuTemp ?? -1);
  const gpuVramUsed = ext?.gpuVramUsed != null && ext.gpuVramUsed >= 0 ? ext.gpuVramUsed : (s?.gpuVramUsed ?? -1);
  const gpuVramTotal = ext?.gpuVramTotal != null && ext.gpuVramTotal > 0 ? ext.gpuVramTotal : (s?.gpuVramTotal ?? -1);
  // hasGpu: true if ANY live GPU metric is available (usage, temp, or VRAM)
  const hasGpu = gpuUsage >= 0 || gpuTemp >= 0 || gpuVramUsed >= 0 || gpuVramTotal > 0;
  // gpuInitializing: LHM + nvidia-smi haven't provided data yet (show shimmers, not "no drivers")
  const gpuInitializing = !hasGpu && (!s?.lhmReady || !ext);

  const lhmLoading = !s?.lhmReady;
  const hwLoading = !hw;
  const extLoading = !ext;

  // Breathing pulse thresholds
  const cpuLoad = s?.cpu ?? 0;
  const ramLoad = s?.ram ?? 0;
  const cpuPulse: 'high' | 'warn' | false = cpuLoad > 85 ? 'high' : cpuLoad > 65 ? 'warn' : false;
  const gpuPulse: 'high' | 'warn' | false = gpuUsage > 85 ? 'high' : gpuUsage > 65 ? 'warn' : false;
  const ramPulse: 'high' | 'warn' | false = ramLoad > 85 ? 'high' : ramLoad > 65 ? 'warn' : false;

  // Temperature source resolution
  const tempSource = s?.tempSource ?? 'none';
  const hasRealTemp = tempSource === 'lhm' && s?.temperature && s.temperature > 0;
  const isEstimatedTemp = tempSource === 'estimation' && s?.temperature && s.temperature > 0;
  const hasAnyTemp = hasRealTemp || isEstimatedTemp;

  return (
    <motion.section
      className="hud-section"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <HudGradients />

      {/* Section Header (skip if hideHeader) */}
      {!hideHeader && (
        <div className="hud-section-header">
          <div className="hud-section-icon"><Server size={16} /></div>
          <h3 className="hud-section-title">SYSTEM DETAILS</h3>
          <div className="hud-section-line" />
        </div>
      )}

      {/* Bento Grid */}
      <div className="hud-bento-grid">

        {/* ── PROCESSOR (large tile) ── */}
        <BentoCard
          icon={<Cpu size={18} />}
          title="PROCESSOR"
          subtitle={hw?.cpuName}
          gaugeValue={hasAnyTemp ? Math.min(s!.temperature, 100) : undefined}
          gaugeUnit="°C"
          gaugeDisplay={hasAnyTemp ? Math.trunc(s!.temperature) : undefined}
          className="hud-tile-cpu"
          delay={0.05}
          pulse={cpuPulse}
        >
          <Row label="Cores / Threads" value={hw ? `${hw.cpuCores}C / ${hw.cpuThreads}T` : undefined} loading={hwLoading} />
          <Row label="Max Clock" value={hw?.cpuMaxClock} loading={hwLoading} />
          {ext && ext.cpuClock > 0 ? (
            <NeonBar
              pct={ext.cpuClock > 0 ? Math.min((ext.cpuClock / (parseFloat(hw?.cpuMaxClock || '5') * 1000)) * 100, 100) : 0}
              label="Current Clock"
              display={`${(ext.cpuClock / 1000).toFixed(2)} GHz`}
            />
          ) : extLoading ? (
            <Row label="Current Clock" loading />
          ) : null}
          {/* Temperature source indicator */}
          {!hasAnyTemp && !lhmLoading && (
            <div className="hud-temp-unavail">
              <div className="hud-temp-unavail-icon">
                <Gauge size={12} />
              </div>
              <div className="hud-temp-unavail-text">
                <span className="hud-temp-unavail-title">Temperature Unavailable</span>
                <span className="hud-temp-unavail-sub">Requires LibreHardwareMonitor sensor access (admin)</span>
              </div>
            </div>
          )}
          {ext?.perCoreCpu && ext.perCoreCpu.length > 0 ? (
            <CoreHeatMap cores={ext.perCoreCpu} coreCount={hw?.cpuCores} />
          ) : (
            <CoreHeatMap cores={[]} threadCount={hw?.cpuThreads || 8} coreCount={hw?.cpuCores} loading={extLoading} />
          )}
        </BentoCard>

        {/* ── GRAPHICS (large tile) ── */}
        <BentoCard
          icon={<MonitorSpeaker size={18} />}
          title="GRAPHICS"
          subtitle={hw?.gpuName}
          gaugeValue={hasGpu ? gpuUsage : 0}
          gaugeUnit="%"
          className="hud-tile-gpu"
          delay={0.1}
          pulse={gpuPulse}
        >
          {gpuVramTotal > 0 ? (
            <Row label="VRAM" value={formatMiBtoGB(gpuVramTotal)} />
          ) : hw?.gpuVramTotal ? (
            <Row label="VRAM" value={hw.gpuVramTotal} />
          ) : (
            <Row label="VRAM" loading={gpuInitializing} />
          )}
          {hw?.gpuDriverVersion ? (
            <Row label="Driver" value={hw.gpuDriverVersion} />
          ) : (
            <Row label="Driver" loading={hwLoading} />
          )}
          {hasGpu ? (
            <>
              <Row label="GPU Temp" value={gpuTemp >= 0 ? `${Math.trunc(gpuTemp)}°C` : undefined} accent loading={gpuTemp < 0} />
              {gpuVramUsed >= 0 && gpuVramTotal > 0 ? (() => {
                const pct = (gpuVramUsed / gpuVramTotal) * 100;
                const c = pct > 90 ? '#FF2D55' : pct > 70 ? '#FFD600' : '#00D4AA';
                return (
                  <div className="hud-usage-rt">
                    <div className="hud-usage-rt-stat">
                      <div className="hud-usage-rt-head">
                        <span className="hud-usage-rt-dot" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                        <span className="hud-usage-rt-key">VRAM Used</span>
                      </div>
                      <span className="hud-usage-rt-big" style={{ color: c }}>
                        {formatMiBtoGB(gpuVramUsed)}<small> / {formatMiBtoGB(gpuVramTotal)}</small>
                      </span>
                      <div className="hud-usage-rt-track">
                        <div className="hud-usage-rt-fill" style={{ width: `${Math.min(pct, 100)}%`, background: `linear-gradient(90deg, ${c}00, ${c})`, boxShadow: `0 0 6px ${c}50` }} />
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <Row label="VRAM Used" loading />
              )}
            </>
          ) : gpuInitializing ? (
            <>
              <Row label="GPU Temp" loading />
              <Row label="VRAM Used" loading />
            </>
          ) : (
            <div className="hud-note">Live stats require NVIDIA drivers</div>
          )}
        </BentoCard>

        {/* ── MEMORY ── */}
        <BentoCard
          icon={<MemoryStick size={18} />}
          title="MEMORY"
          subtitle={hw?.ramBrand || hw?.ramInfo}
          gaugeValue={s?.ram}
          gaugeUnit="%"
          className="hud-tile-mem"
          delay={0.15}
          pulse={ramPulse}
        >
          {hw?.ramInfo ? <Row label="Config" value={hw.ramInfo} /> : <Row label="Config" loading={hwLoading} />}
          {hw?.ramPartNumber ? <Row label="Part Number" value={hw.ramPartNumber} /> : hwLoading && <Row label="Part Number" loading />}
          {hw?.ramSticks ? <Row label="Sticks" value={hw.ramSticks} /> : hwLoading && <Row label="Sticks" loading />}
          {ext && ext.ramTotalGB > 0 ? (() => {
            const pct = (ext.ramUsedGB / ext.ramTotalGB) * 100;
            const c = pct > 90 ? '#FF2D55' : pct > 70 ? '#FFD600' : '#00F2FF';
            return (
              <div className="hud-usage-rt">
                <div className="hud-usage-rt-stat">
                  <div className="hud-usage-rt-head">
                    <span className="hud-usage-rt-dot" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                    <span className="hud-usage-rt-key">RAM Used</span>
                  </div>
                  <span className="hud-usage-rt-big" style={{ color: c }}>
                    {ext.ramUsedGB.toFixed(1)}<small> / {ext.ramTotalGB.toFixed(1)} GB</small>
                  </span>
                  <div className="hud-usage-rt-track">
                    <div className="hud-usage-rt-fill" style={{ width: `${Math.min(pct, 100)}%`, background: `linear-gradient(90deg, ${c}00, ${c})`, boxShadow: `0 0 6px ${c}50` }} />
                  </div>
                </div>
              </div>
            );
          })() : (
            <Row label="Used" loading={extLoading} />
          )}
        </BentoCard>

        {/* ── STORAGE ── */}
        <BentoCard
          icon={<HardDrive size={18} />}
          title="STORAGE"
          subtitle={hw?.diskName}
          gaugeValue={s?.disk}
          gaugeUnit="%"
          className="hud-tile-storage"
          delay={0.2}
        >
          {/* ── Diagnostic readout: Type + Health ── */}
          {(hw?.diskType || hw?.diskHealth || hwLoading) && (
            <div className="hud-stor-diag">
              {hwLoading && !hw?.diskType ? (
                <div className="hud-stor-diag-cell"><ValueLoader /></div>
              ) : hw?.diskType && (
                <div className="hud-stor-diag-cell">
                  <div className="hud-stor-diag-top">
                    <span className="hud-stor-diag-dot" style={{ background: '#00F2FF', boxShadow: '0 0 6px #00F2FF88' }} />
                    <span className="hud-stor-diag-key">Type</span>
                  </div>
                  <span className="hud-stor-diag-val" style={{ color: '#00F2FF' }}>{hw.diskType}</span>
                  <span className="hud-stor-diag-sub">{hw.diskType === 'SSD' ? 'Solid State Drive' : hw.diskType === 'HDD' ? 'Hard Disk Drive' : 'Storage Device'}</span>
                </div>
              )}
              {hwLoading && !hw?.diskHealth ? (
                <div className="hud-stor-diag-cell"><ValueLoader /></div>
              ) : hw?.diskHealth && (() => {
                const ok = hw.diskHealth.toLowerCase() === 'healthy';
                const c = ok ? '#00FF88' : '#FFD600';
                return (
                  <div className="hud-stor-diag-cell">
                    <div className="hud-stor-diag-top">
                      <span className="hud-stor-diag-dot" style={{ background: c, boxShadow: `0 0 6px ${c}88` }} />
                      <span className="hud-stor-diag-key">Health</span>
                    </div>
                    <span className="hud-stor-diag-val" style={{ color: c }}>{hw.diskHealth}</span>
                    <span className="hud-stor-diag-sub">{ok ? 'No issues detected' : 'Attention needed'}</span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Compact R/W speed strip ── */}
          {(ext || extLoading) && (
            <>
              <div className="hud-stor-section-hdr">Read / Write</div>
              <div className="hud-stor-speed">
                {ext ? (() => {
                  const r = ext.diskReadSpeed || 0;
                  const w = ext.diskWriteSpeed || 0;
                  return (
                    <>
                      <div className="hud-stor-speed-half">
                        <ArrowDown size={9} className="hud-stor-speed-ic read" />
                        <span className="hud-stor-speed-val read">{fmt(r)}</span>
                      </div>
                      <span className="hud-stor-speed-div" />
                      <div className="hud-stor-speed-half">
                        <ArrowUp size={9} className="hud-stor-speed-ic write" />
                        <span className="hud-stor-speed-val write">{fmt(w)}</span>
                      </div>
                    </>
                  );
                })() : <ValueLoader />}
              </div>
            </>
          )}

          {/* ── Volumes — segmented power-cell bars ── */}
          {hw?.allDrives && hw.allDrives.length > 0 && (
            <div className="hud-stor-vols">
              <div className="hud-stor-vols-hdr">Volumes</div>
              {hw.allDrives.map((d) => {
                const usedGB = d.totalGB - d.freeGB;
                const pct = d.totalGB > 0 ? Math.round((usedGB / d.totalGB) * 100) : 0;
                const color = pct > 90 ? '#FF2D55' : pct > 70 ? '#FFD600' : '#00F2FF';
                const SEGS = 12;
                const litCount = Math.round((pct / 100) * SEGS);
                return (
                  <div key={d.letter} className="hud-stor-vol">
                    <span className="hud-stor-vol-id" style={{ color }}>{d.letter}</span>
                    <div className="hud-stor-vol-cells">
                      {Array.from({ length: SEGS }, (_, i) => (
                        <div
                          key={i}
                          className={`hud-stor-cell ${i < litCount ? 'lit' : ''}`}
                          style={i < litCount ? {
                            background: color,
                            boxShadow: `0 0 4px ${color}66`,
                          } : undefined}
                        />
                      ))}
                    </div>
                    <span className="hud-stor-vol-pct" style={{ color }}>{pct}%</span>
                    <span className="hud-stor-vol-free">{d.freeGB} GB</span>
                  </div>
                );
              })}
            </div>
          )}
        </BentoCard>

        {/* ── NETWORK ── */}
        <BentoCard
          icon={<Network size={18} />}
          title="NETWORK"
          subtitle={hw?.networkAdapter}
          gaugeValue={(() => {
            const up = ext?.networkUp ?? 0;
            const down = ext?.networkDown ?? 0;
            const bytes = up + down;
            const mbps = Math.round(((bytes * 8) / (1024 * 1024)) * 10) / 10;
            const link = parseLinkSpeedStr(hw?.networkLinkSpeed) ?? 1000;
            return link > 0 ? Math.min((mbps / link) * 100, 100) : 0;
          })()}
          gaugeDisplay={Math.round(((ext?.networkUp ?? 0) + (ext?.networkDown ?? 0)) * 8 / (1024 * 1024))}
          gaugeUnit="Mbps"
          className="hud-tile-net"
          delay={0.25}
        >
          {/* Static info — standard rows (double-click to blur/unblur) */}
          <Row label="Local IP Address" loading={hwLoading} value={
            <span className={blurredFields['ip'] ? 'hud-blurred' : 'hud-blurrable'} onDoubleClick={() => toggleBlur('ip')} title="Double-click to blur">
              {ext?.activeLocalIP || hw?.ipAddress || '—'}
            </span>
          } />
          <Row label="Gateway" loading={hwLoading} value={
            <span className={blurredFields['gateway'] ? 'hud-blurred' : 'hud-blurrable'} onDoubleClick={() => toggleBlur('gateway')} title="Double-click to blur">
              {ext?.activeGateway || hw?.gateway || '—'}
            </span>
          } />
          <Row label="DNS" loading={hwLoading} value={
            <span className={blurredFields['dns'] ? 'hud-blurred' : 'hud-blurrable'} onDoubleClick={() => toggleBlur('dns')} title="Double-click to blur">
              {hw?.dns ?? '—'}
            </span>
          } />
          {(ext?.activeMac || hw?.macAddress) ? <Row label="MAC" value={
            <span className={blurredFields['mac'] ? 'hud-blurred' : 'hud-blurrable'} onDoubleClick={() => toggleBlur('mac')} title="Double-click to blur">
              {ext?.activeMac || hw?.macAddress}
            </span>
          } /> : hwLoading && <Row label="MAC" loading />}
          {/* ── Active connection ── */}
          {(() => {
            // Determine connection type: WiFi if SSID present, otherwise Ethernet
            const isWifi = ext?.ssid && ext.ssid.length > 0 && ext.wifiSignal > 0;
            const adapters = hw?.networkAdapters;
            const activeAdapter = adapters
              ? adapters.find(a => isWifi ? a.type === 'WiFi' : a.type === 'Ethernet') || adapters[0]
              : null;
            // Prefer realtime link speed from extended stats (refreshes every ~5s)
            const linkSpeed = ext?.activeLinkSpeed || activeAdapter?.linkSpeed || hw?.networkLinkSpeed || '—';
            const adapterName = ext?.activeAdapterName || activeAdapter?.name || (isWifi ? 'Wi-Fi' : 'Ethernet');

            if (!activeAdapter && !hw?.networkLinkSpeed && !ext?.activeLinkSpeed && hwLoading) {
              return <Row label="Connection" loading />;
            }

            return activeAdapter || hw?.networkLinkSpeed || ext?.activeLinkSpeed ? (
              <div className="hud-net-adapters">
                <div className="hud-net-adapter">
                  <span className="hud-net-adapter-icon">
                    {isWifi ? <Wifi size={11} /> : <Network size={11} />}
                  </span>
                  <span className="hud-net-adapter-name">
                    {adapterName}
                  </span>
                  <span className="hud-net-adapter-right">
                    {isWifi && ext?.ssid && (
                      <><span className="hud-net-adapter-lbl">SSID:</span><span className="hud-net-wifi-sig">{ext.ssid}</span></>
                    )}
                    {isWifi && ext && ext.wifiSignal > 0 && (
                      <><span className="hud-net-adapter-lbl">Signal:</span><span className="hud-net-wifi-sig">{ext.wifiSignal}%</span></>
                    )}
                    <span className="hud-net-adapter-lbl">Link Speed:</span>
                    <span className="hud-net-adapter-speed">{linkSpeed}</span>
                  </span>
                </div>
              </div>
            ) : null;
          })()}

          {/* ── Realtime Stats ── */}
          {(ext || extLoading) && (
            <div className="hud-net-rt">
              {/* Ping + Packet Loss */}
              {ext ? (
                ext.latencyMs != null && ext.latencyMs > 0 ? (() => {
                  const ms = ext.latencyMs;
                  const c = ms <= 80 ? '#00FF88' : ms <= 180 ? '#FFD600' : '#FF2D55';
                  const q = ms <= 30 ? 'Excellent' : ms <= 80 ? 'Good' : ms <= 180 ? 'Fair' : 'Poor';
                  const pl = ext.packetLoss ?? -1;
                  const plColor = pl <= 0 ? '#00FF88' : pl < 3 ? '#FFD600' : '#FF2D55';
                  return (
                    <>
                      <div className="hud-net-rt-stat">
                        <div className="hud-net-rt-head">
                          <span className="hud-net-rt-dot" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                          <span className="hud-net-rt-key">Ping</span>
                        </div>
                        <span className="hud-net-rt-big" style={{ color: c }}>{ms}<small>ms</small></span>
                      </div>
                      {pl >= 0 && (
                        <div className="hud-net-rt-stat">
                          <div className="hud-net-rt-head">
                            <span className="hud-net-rt-dot" style={{ background: plColor, boxShadow: `0 0 5px ${plColor}` }} />
                            <span className="hud-net-rt-key">Packet Loss</span>
                          </div>
                          <span className="hud-net-rt-big" style={{ color: plColor }}>{pl}<small>%</small></span>
                        </div>
                      )}
                    </>
                  );
                })() : null
              ) : (
                <div className="hud-net-rt-stat"><ValueLoader /></div>
              )}

              {/* Throughput */}
              {ext ? (() => {
                const up = ext.networkUp ?? 0;
                const down = ext.networkDown ?? 0;
                const scale = (b: number) => {
                  const mbps = (b * 8) / (1024 * 1024);
                  return mbps > 0 ? Math.max(3, Math.min(Math.pow(mbps / 1000, 0.35) * 100, 100)) : 0;
                };
                return (
                  <div className="hud-net-rt-stat">
                    <div className="hud-net-rt-head">
                      <Activity size={10} className="hud-net-rt-pulse" />
                      <span className="hud-net-rt-key">Live Speed</span>
                    </div>
                    <div className="hud-net-bars">
                      <div className="hud-net-bar-row">
                        <ArrowDown size={9} className="hud-net-bar-icon dn" />
                        <div className="hud-net-bar-track">
                          <div className="hud-net-bar-fill dn" style={{ width: `${scale(down)}%` }} />
                        </div>
                        <span className="hud-net-bar-val dn">{fmtMbps(down)}</span>
                      </div>
                      <div className="hud-net-bar-row">
                        <ArrowUp size={9} className="hud-net-bar-icon up" />
                        <div className="hud-net-bar-track">
                          <div className="hud-net-bar-fill up" style={{ width: `${scale(up)}%` }} />
                        </div>
                        <span className="hud-net-bar-val up">{fmtMbps(up)}</span>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="hud-net-rt-stat"><ValueLoader /></div>
              )}
            </div>
          )}
        </BentoCard>

        {/* ── SYSTEM ── */}
        <BentoCard
          icon={<Monitor size={18} />}
          title="SYSTEM"
          subtitle={hw?.windowsVersion}
          gaugeValue={ext && ext.processCount > 0 ? Math.min((ext.processCount / 500) * 100, 100) : 0}
          gaugeUnit="proc"
          gaugeDisplay={ext?.processCount ?? 0}
          className="hud-tile-sys"
          delay={0.3}
        >
          <Row label="Motherboard" value={hw?.motherboardProduct ? cleanBoardName(hw.motherboardProduct) : hw?.motherboardManufacturer} loading={hwLoading} />
          <Row label="BIOS Version" value={(hw?.biosVersion || hw?.biosDate) ? `${hw?.biosVersion || 'Unknown'}${hw?.biosDate ? ' — ' + hw.biosDate : ''}` : undefined} loading={hwLoading} />
          <Row label="Board Serial Number" value={!isPlaceholderSerial(hw?.motherboardSerial) ? hw?.motherboardSerial : (hw ? '—' : undefined)} loading={hwLoading} />
          <Row label="Windows Build" value={hw?.windowsBuild} loading={hwLoading} />
          {hw?.lastWindowsUpdate ? <Row label="Last Windows Update" value={hw.lastWindowsUpdate} accent={hw.lastWindowsUpdate !== 'Unknown'} /> : hwLoading && <Row label="Last Windows Update" loading />}
          {hw?.windowsActivation ? <Row label="Windows License" value={hw.windowsActivation} accent={hw.windowsActivation === 'Licensed'} /> : hwLoading && <Row label="Windows License" loading />}

          {/* ── Realtime panel (matches Network card style) ── */}
          {(ext || hw || extLoading || hwLoading) && (
            <div className="hud-sys-rt">
              {/* Uptime */}
              <div className="hud-sys-rt-stat">
                <div className="hud-sys-rt-head">
                  <span className="hud-sys-rt-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                  <span className="hud-sys-rt-key">Uptime</span>
                </div>
                <span className="hud-sys-rt-big">{ext?.systemUptime ?? hw?.systemUptime ?? '—'}</span>
              </div>

              {/* Power & Resources */}
              <div className="hud-sys-rt-stat">
                <div className="hud-sys-rt-head">
                  <span className="hud-sys-rt-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                  <span className="hud-sys-rt-key">Power Plan</span>
                </div>
                <span className="hud-sys-rt-big">{hw?.powerPlan ?? '—'}</span>
                {hw?.hasBattery && (
                  <div className="hud-sys-rt-batt">
                    <Battery size={11} />
                    <span>{hw.batteryPercent}% — {hw.batteryStatus}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </BentoCard>

      </div>
    </motion.section>
  );
};

export default SystemDetails;


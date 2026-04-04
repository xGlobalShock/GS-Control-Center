import React, { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip as RechartsTip, YAxis,
} from 'recharts';
import {
  Cpu, MonitorSpeaker, MemoryStick, HardDrive, Network, Wifi,
  Monitor, TrendingUp, TrendingDown, Minus as FlatIcon, CheckCircle,
  ArrowUp, ArrowDown, Info, X as XIcon,
  Weight,
} from 'lucide-react';
import type { HardwareInfo, ExtendedStats } from '../App';
import '../styles/DashboardHero.css';

/* ══════════════════════════════════════════
   Types
══════════════════════════════════════════ */
export interface MetricPoint { v: number; }

interface DashboardHeroProps {
  systemStats: {
    cpu: number;
    ram: number;
    disk: number;
    temperature: number;
    tempSource?: string;
    lhmReady?: boolean;
    gpuTemp?: number;
    gpuUsage?: number;
    gpuVramUsed?: number;
    gpuVramTotal?: number;
  };
  hardwareInfo?: HardwareInfo;
  extendedStats?: ExtendedStats;
  cpuHistory: MetricPoint[];
  gpuHistory: MetricPoint[];
  ramHistory: MetricPoint[];
  netHistory: MetricPoint[];
  lossHistory: MetricPoint[];
  diskHistory: MetricPoint[];
  processHistory: MetricPoint[];
}

/* ══════════════════════════════════════════
   Helpers
══════════════════════════════════════════ */
const statusColor = (pct: number): string => {
  if (pct >= 85) return '#FF2D55';
  if (pct >= 65) return '#FFD600';
  return '#00CC6A';
};

const statusLabel = (pct: number, labels = ['Normal', 'Moderate', 'High']): string => {
  if (pct >= 85) return labels[2];
  if (pct >= 65) return labels[1];
  return labels[0];
};

const fmt = (n: number): string => {
  if (n <= 0) return '0 B/s';
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB/s`;
  return `${(n / 1073741824).toFixed(2)} GB/s`;
};

const fmtMiB = (mb?: number | null): string => {
  if (!mb || mb <= 0) return '—';
  const gb = mb / 1024;
  return gb % 1 === 0 ? `${gb} GB` : `${gb.toFixed(1)} GB`;
};

const parseLinkSpeed = (s?: string): number => {
  if (!s) return 1000;
  const m = String(s).match(/([0-9.]+)\s*(g|m)/i);
  if (m) { const v = parseFloat(m[1]); return m[2].toLowerCase() === 'g' ? v * 1000 : v; }
  const num = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return !isNaN(num) ? (num > 10000 ? Math.round(num / 1000000) : num) : 1000;
};

const fmtLinkSpeed = (s?: string): string => {
  if (!s) return s ?? '';
  const mbps = parseLinkSpeed(s);
  if (mbps >= 1000) {
    const gbps = mbps / 1000;
    return `${gbps % 1 === 0 ? gbps.toFixed(0) : gbps.toFixed(1)} Gbps`;
  }
  return `${mbps} Mbps`;
};

const cleanBoard = (name?: string) =>
  name ? name.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*-\s*.*/g, '').trim() : '';

const isPlaceholder = (s?: string) => {
  if (!s) return true;
  const v = s.trim().toLowerCase();
  return ['default string', 'to be filled by o.e.m.', 'to be filled by oem',
    'system serial number', 'not specified', 'none', 'unknown', 'baseboard serial number',
  ].includes(v) || /^0+$/.test(s) || s.trim().length < 3;
};

const getTrend = (history: MetricPoint[]): { dir: 'up' | 'down' | 'flat'; delta: number } => {
  if (history.length < 8) return { dir: 'flat', delta: 0 };
  const recent = history[history.length - 1].v;
  const older = history[Math.max(0, history.length - 8)].v;
  const delta = Math.round(recent - older);
  if (Math.abs(delta) < 2) return { dir: 'flat', delta: 0 };
  return { dir: delta > 0 ? 'up' : 'down', delta: Math.abs(delta) };
};

/* ══════════════════════════════════════════
   Sparkline Chart
══════════════════════════════════════════ */
const Sparkline: React.FC<{ data: MetricPoint[]; color: string; gradId: string }> = ({ data, color, gradId }) => {
  const chartData = useMemo(() => {
    const pts = data.length >= 2 ? data : [{ v: 0 }, { v: 0 }, { v: 0 }];
    return pts.map((d, i) => ({ i, v: d.v }));
  }, [data]);
  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false}
          activeDot={{ r: 3, fill: color, strokeWidth: 0 }} isAnimationActive={false}
        />
        <RechartsTip
          contentStyle={{ background: 'rgba(4,6,16,0.96)', border: `1px solid ${color}33`,
            borderRadius: '6px', fontSize: '11px', color: '#c8d8f0', padding: '3px 8px' }}
          formatter={(v: number) => [`${v.toFixed(1)}`, '']}
          labelFormatter={() => ''} separator=""
          cursor={{ stroke: `${color}55`, strokeWidth: 1, strokeDasharray: '3 3' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

/* ══════════════════════════════════════════
   Dual Sparkline (two overlaid series)
══════════════════════════════════════════ */
interface DualSparklineProps {
  dataA: MetricPoint[]; colorA: string; gradIdA: string; labelA: string;
  dataB: MetricPoint[]; colorB: string; gradIdB: string; labelB: string;
}
const DualSparkline: React.FC<DualSparklineProps> = ({ dataA, colorA, gradIdA, labelA, dataB, colorB, gradIdB, labelB }) => {
  const chartData = useMemo(() => {
    const len = Math.max(dataA.length, dataB.length, 3);
    const padA = dataA.length < len ? [...Array(len - dataA.length).fill({ v: 0 }), ...dataA] : dataA;
    const padB = dataB.length < len ? [...Array(len - dataB.length).fill({ v: 0 }), ...dataB] : dataB;
    return padA.map((d, i) => ({ i, a: d.v, b: padB[i]?.v ?? 0 }));
  }, [dataA, dataB]);
  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          {/* Primary — ping: rich fill matching other sparklines */}
          <linearGradient id={gradIdA} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={colorA} stopOpacity={0.32} />
            <stop offset="60%"  stopColor={colorA} stopOpacity={0.08} />
            <stop offset="100%" stopColor={colorA} stopOpacity={0} />
          </linearGradient>
          {/* Secondary — loss: minimal fill, spikes pop on red stroke */}
          <linearGradient id={gradIdB} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={colorB} stopOpacity={0.30} />
            <stop offset="100%" stopColor={colorB} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis yAxisId="a" hide domain={[(dataMin: number) => Math.max(0, Math.round(dataMin * 0.5)), 'auto']} />
        <YAxis yAxisId="b" hide domain={[0, 10]} orientation="right" />
        {/* Primary — ping drawn first (behind) */}
        <Area yAxisId="a" type="monotone" dataKey="a" stroke={colorA} strokeWidth={1.5}
          fill={`url(#${gradIdA})`} dot={false}
          activeDot={{ r: 3, fill: colorA, strokeWidth: 0 }} isAnimationActive={false}
        />
        {/* Secondary — loss drawn on top, smooth wave spike */}
        <Area yAxisId="b" type="basis" dataKey="b" stroke={colorB} strokeWidth={1.5}
          strokeOpacity={0.9}
          fill={`url(#${gradIdB})`} dot={false}
          activeDot={{ r: 3, fill: colorB, strokeWidth: 0 }} isAnimationActive={false}
        />
        <RechartsTip
          contentStyle={{ background: 'rgba(4,6,16,0.96)', border: `1px solid rgba(255,255,255,0.1)`,
            borderRadius: '6px', fontSize: '11px', color: '#c8d8f0', padding: '3px 8px' }}
          formatter={(v: number, name: string) => [
            name === 'a' ? `${v.toFixed(0)} ms` : `${v.toFixed(1)}%`,
            name === 'a' ? labelA : labelB,
          ]}
          labelFormatter={() => ''} separator=": "
          cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, strokeDasharray: '3 3' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

/* ══════════════════════════════════════════
   DetailRow
══════════════════════════════════════════ */
const DetailRow: React.FC<{ label: string; value?: React.ReactNode; accent?: string }> = ({ label, value, accent }) => (
  <div className="dh-row">
    <span className="dh-row-label">{label}</span>
    <span className="dh-row-value" style={accent ? { color: accent } : undefined}>{value ?? '—'}</span>
  </div>
);

/* ══════════════════════════════════════════
   DetailBar
══════════════════════════════════════════ */
/*
  DetailBar — GPU-optimized progress bar.
  Uses CSS custom property --bar-scale (0–1) + transform: scaleX().
  BEFORE: transition: width → layout recalc per frame (CPU-bound).
  AFTER:  transition: transform → GPU compositor only, zero layout/paint per frame.
*/
const DetailBar: React.FC<{ pct: number; label: string; display: string; color: string }> = ({ pct, label, display, color }) => (
  <div className="dh-bar-wrap">
    <div className="dh-bar-head">
      <span className="dh-bar-label">{label}</span>
      <span className="dh-bar-display" style={{ color: '#FFFFFF' }}>{display}</span>
    </div>
    <div className="dh-bar-track">
      <div className="dh-bar-fill" style={{
        '--bar-scale': `${Math.min(Math.max(pct, 0), 100) / 100}`,
        background: `linear-gradient(90deg, ${color}55, ${color})`,
        boxShadow: `0 0 8px ${color}55`,
      } as React.CSSProperties} />
    </div>
  </div>
);

/* ══════════════════════════════════════════
   CoreStrip
══════════════════════════════════════════ */
const CoreStrip: React.FC<{ cores: number[]; coreCount?: number; threadCount?: number; loading?: boolean }> = ({
  cores, coreCount, threadCount, loading,
}) => {
  const gc = (p: number) => p < 25 ? '#00F2FF' : p < 60 ? '#00F2FF' : p < 85 ? '#FFD600' : '#FF2D55';
  const totalT = loading ? (threadCount || 8) : cores.length;
  const phys   = coreCount || Math.ceil(totalT / 2);
  const hasHT  = totalT > phys;
  const grouped: number[] = [];
  if (!loading && cores.length > 0) {
    if (hasHT) { for (let i = 0; i < phys; i++) grouped.push(Math.max(cores[i * 2] ?? 0, cores[i * 2 + 1] ?? 0)); }
    else { cores.forEach(p => grouped.push(p)); }
  } else { for (let i = 0; i < (coreCount || 4); i++) grouped.push(0); }
  const avg = !loading && grouped.length > 0 ? Math.round(grouped.reduce((a, b) => a + b, 0) / grouped.length) : 0;
  const ac  = gc(avg);
  return (
    <div className="dh-cores-wrap">
      <div className="dh-cores-head">
        <span className="dh-cores-dot" style={{ background: '#00F2FF', boxShadow: loading ? 'none' : '0 0 4px #00F2FF' }} />
        <span className="dh-cores-label">Per-Core Load</span>
        <span className="dh-cores-avg" style={{ color: loading ? 'rgba(255,255,255,0.15)' : (ac === '#00F2FF' ? '#FFFFFF' : ac) }}>{loading ? '—' : `${avg}% avg`}</span>
      </div>
      <div className="dh-cores-bar">
        {grouped.map((raw, i) => {
          const p = loading ? 0 : Math.min(raw, 100);
          const c = gc(p);
          return (<div key={i} className="dh-core-seg"
            style={{ background: loading ? 'rgba(255,255,255,0.06)' : c, opacity: loading ? 0.3 : Math.max(0.18, p / 100) }}
            title={`Core ${i}: ${Math.round(p)}%`}
          />);
        })}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   VolumeStrip
══════════════════════════════════════════ */
const VolumeStrip: React.FC<{ drives: { letter: string; totalGB: number; freeGB: number; label: string }[] }> = ({ drives }) => {
  const SEGS = 12;
  return (
    <div className="dh-vols">
      {drives.map(d => {
            const pct   = d.totalGB > 0 ? Math.round(((d.totalGB - d.freeGB) / d.totalGB) * 100) : 0;
            const color = pct > 90 ? '#FF2D55' : pct > 70 ? '#FFD600' : '#00F2FF';
            const textColor = color === '#00F2FF' ? '#FFFFFF' : color;
            const lit   = Math.round((pct / 100) * SEGS);
            return (
              <div key={d.letter} className="dh-vol-row">
                <span className="dh-vol-id" style={{ color: textColor }}>{d.letter}</span>
                <div className="dh-vol-cells">
                  {Array.from({ length: SEGS }, (_, i) => (
                    <div key={i} className="dh-vol-cell"
                      style={i < lit ? { background: color, boxShadow: `0 0 3px ${color}77` } : undefined}
                    />
                  ))}
                </div>
                <span className="dh-vol-pct" style={{ color: textColor }}>{pct}%</span>
                <span className="dh-vol-free">{d.freeGB}GB</span>
              </div>
            );
          })}
    </div>
  );
};

/* ══════════════════════════════════════════
   LiveBadge
══════════════════════════════════════════ */
/*
  LiveBadge — stateless: CSS @keyframes dhLivePulse handles the pulse animation.
  Eliminated setInterval+setState which caused a React re-render every 1 second.
*/
const LiveBadge: React.FC = () => (
  <div className="dh-live-badge">
    <span className="dh-live-dot" />
    LIVE
  </div>
);

/* ══════════════════════════════════════════
   HeroCard
══════════════════════════════════════════ */
interface HeroCardProps {
  icon: React.ReactNode;
  cardLabel: string;
  subtitle?: string;
  mainValue: string;
  mainSuffix?: string;
  statusPct: number;
  chipLabel: string;
  accentColor: string;
  cardClass?: string;
  history?: MetricPoint[];
  gradId?: string;
  history2?: MetricPoint[];
  gradId2?: string;
  color2?: string;
  label2?: string;
  delay?: number;
  children?: React.ReactNode;
  frontExtra?: React.ReactNode;
  backContent?: React.ReactNode;
}

const HeroCard: React.FC<HeroCardProps> = ({
  icon, cardLabel, subtitle, mainValue, mainSuffix,
  statusPct, chipLabel, accentColor,
  history, gradId, history2, gradId2, color2, label2,
  delay = 0, children, frontExtra, backContent,
  cardClass,
}) => {
  const [flipped, setFlipped] = useState(false);
  const sc = statusColor(statusPct);
  const trend = useMemo(() => history ? getTrend(history) : { dir: 'flat' as const, delta: 0 }, [history]);
  const TrendIcon = trend.dir === 'up' ? TrendingUp : trend.dir === 'down' ? TrendingDown : CheckCircle;
  const trendText  = trend.dir === 'flat' ? 'Stable' : `${trend.dir === 'up' ? '+' : '−'}${trend.delta}%`;
  const trendColor = trend.dir === 'flat' ? '#FFFFFF'
    : trend.dir === 'up' ? (statusPct >= 65 ? '#FF2D55' : '#FFD600') : '#00F2FF';

  return (
    <motion.div className={`dh-card${flipped ? ' is-flipped' : ''}${cardClass ? ' ' + cardClass : ''}`}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
        {/* ── FRONT FACE ── */}
        <motion.div
          className="dh-face dh-face-front"
          initial={{ rotateY: 0 }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="dh-inner">
            <div className="dh-head">
              <div className="dh-icon" style={{ color: accentColor, background: `${accentColor}14` }}>{icon}</div>
              <div className="dh-label-group">
                <span className="dh-label">{cardLabel}</span>
                {subtitle && <span className="dh-subtitle">{subtitle}</span>}
              </div>
              {backContent && (
                <button
                  className="dh-info-btn"
                  onClick={() => setFlipped(true)}
                  title="More info"
                  style={{ color: '#ffffff' }}
                >
                  <Info size={13} />
                  <span style={{ fontSize: '10px', letterSpacing: '0.04em' }}>More Info</span>
                </button>
              )}
            </div>

            <div className="dh-value-row">
              <span className="dh-value-num" style={{ color: '#FFFFFF', textShadow: `0 0 28px ${accentColor}50` }}>
                {mainValue}
              </span>
              {mainSuffix && <span className="dh-value-suffix">{mainSuffix}</span>}
              {history && (
                <div className={`dh-trend${trend.dir === 'flat' ? ' dh-trend--stable' : ''}`} style={{ color: trendColor }}>
                  <TrendIcon size={12} strokeWidth={2.5} />
                  <span>{trendText}</span>
                </div>
              )}
            </div>

            {frontExtra}

            {history && gradId && (
              <div className="dh-chart">
                {history2 && gradId2 && color2 ? (
                  <DualSparkline
                    dataA={history} colorA={accentColor} gradIdA={gradId} labelA="Ping"
                    dataB={history2} colorB={color2} gradIdB={gradId2} labelB={label2 ?? 'Loss'}
                  />
                ) : (
                  <Sparkline data={history} color={accentColor} gradId={gradId} />
                )}
              </div>
            )}

            {children && <div className="dh-detail">{children}</div>}
          </div>
        </motion.div>

        {/* ── BACK FACE ── */}
        {backContent && (
          <motion.div
            className="dh-face dh-face-back"
            initial={{ rotateY: -180 }}
            animate={{ rotateY: flipped ? 0 : -180 }}
            transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="dh-card-accent" style={{
              background: `linear-gradient(90deg, transparent 0%, ${accentColor} 50%, transparent 100%)`,
              boxShadow: `0 0 12px ${accentColor}55`,
            }} />
            <div className="dh-corner dh-tl" style={{ borderColor: `${accentColor}CC` }} />
            <div className="dh-corner dh-tr" style={{ borderColor: `${accentColor}CC` }} />
            <div className="dh-corner dh-bl" style={{ borderColor: `${accentColor}77` }} />
            <div className="dh-corner dh-br" style={{ borderColor: `${accentColor}77` }} />
            <div className="dh-scanline" />

            <div className="dh-inner">
              <div className="dh-head">
                <div className="dh-icon" style={{ color: accentColor, background: `${accentColor}14` }}>{icon}</div>
                <div className="dh-label-group">
                  <span className="dh-label">{cardLabel}</span>
                  <span className="dh-subtitle">Hardware Info</span>
                </div>
                <button
                  className="dh-info-btn dh-info-btn-close"
                  onClick={() => setFlipped(false)}
                  title="Back to live metrics"
                  style={{ color: '#ffffff' }}
                >
                  <XIcon size={13} />
                </button>
              </div>
              <div className="dh-back-content">{backContent}</div>
            </div>
          </motion.div>
        )}

        {/* ── SHARED DECORATIONS — always rendered on top of both faces ── */}
        <div className="dh-card-accent" style={{
          background: `linear-gradient(90deg, transparent 0%, ${accentColor} 50%, transparent 100%)`,
          boxShadow: `0 0 12px ${accentColor}55`,
        }} />
        <div className="dh-corner dh-tl" style={{ borderColor: `${accentColor}CC` }} />
        <div className="dh-corner dh-tr" style={{ borderColor: `${accentColor}CC` }} />
        <div className="dh-corner dh-bl" style={{ borderColor: `${accentColor}77` }} />
        <div className="dh-corner dh-br" style={{ borderColor: `${accentColor}77` }} />
        <div className="dh-scanline" />
    </motion.div>
  );
};

/* ══════════════════════════════════════════
   DashboardHero
══════════════════════════════════════════ */
const DashboardHero: React.FC<DashboardHeroProps> = ({
  systemStats, hardwareInfo, extendedStats,
  cpuHistory, gpuHistory, ramHistory, netHistory, lossHistory, diskHistory, processHistory,
}) => {
  const s   = systemStats;
  const hw  = hardwareInfo;
  const ext = extendedStats;

  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const toggleBlur = useCallback((k: string) => setBlurred(p => ({ ...p, [k]: !p[k] })), []);

  const gpuUsage = ext?.gpuUsage  != null && ext.gpuUsage  >= 0 ? ext.gpuUsage  : 0;
  const gpuTemp  = ext?.gpuTemp   != null && ext.gpuTemp   >= 0 ? ext.gpuTemp   : -1;
  const gpuVramU = ext?.gpuVramUsed  != null && ext.gpuVramUsed  >= 0 ? ext.gpuVramUsed  : -1;
  const gpuVramT = ext?.gpuVramTotal != null && ext.gpuVramTotal  > 0 ? ext.gpuVramTotal  : -1;
  const hasGpu   = ext?.gpuUsage != null && ext.gpuUsage >= 0;

  const hasRealTemp = s?.tempSource === 'lhm'       && s?.temperature > 0;
  const hasEstTemp  = s?.tempSource === 'estimation' && s?.temperature > 0;
  const hasAnyTemp  = hasRealTemp || hasEstTemp;

  const cpuPct  = s?.cpu  ?? 0;
  const ramPct  = s?.ram  ?? 0;
  const diskPct = s?.disk ?? 0;

  const netUp    = ext ? (ext.networkUp   * 8) / 1048576 : 0;
  const netDown  = ext ? (ext.networkDown * 8) / 1048576 : 0;
  const netTotal = netUp + netDown;
  const linkMbps = parseLinkSpeed(ext?.activeLinkSpeed || hw?.networkLinkSpeed);
  const netPct   = Math.min((netTotal / linkMbps) * 100, 100);
  const isWifi   = !!(ext?.ssid && ext.ssid.length > 0 && ext.wifiSignal > 0);
  const fmtMbps  = (v: number) => v >= 100 ? `${Math.round(v)} Mbps` : v > 0 ? `${v.toFixed(1)} Mbps` : '0 Mbps';

  return (
    <section className="dh-section">
      <div className="dh-grid">

        {/* ══ CPU ═════════════════════════════ */}
        <HeroCard
          icon={<Cpu size={15} />}
          cardLabel="CPU USAGE" subtitle={hw?.cpuName}
          mainValue={`${Math.round(cpuPct)}`} mainSuffix="%"
          statusPct={cpuPct} chipLabel={statusLabel(cpuPct)}
          accentColor="#00F2FF"
          history={cpuHistory} gradId="dhGradCpu"
          delay={0}
        >
          {/* Stat tiles: Temp · Cores · Max Clock */}
          <div className="dh-stat-tiles">
            {hasAnyTemp && (() => {
              const tc = s.temperature >= 90 ? '#FF2D55' : s.temperature >= 70 ? '#FFD600' : '#FFFFFF';
              return (
                <div className="dh-stat-tile">
                  <div className="dh-stat-tile-top">
                    <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                    <span className="dh-stat-tile-label">TEMP</span>
                  </div>
                  <span className="dh-stat-tile-val" style={{ color: tc }}>{Math.trunc(s.temperature)}<small>°C</small></span>
                </div>
              );
            })()}
            {hw && (
                <div className="dh-stat-tile">
                <div className="dh-stat-tile-top">
                  <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                  <span className="dh-stat-tile-label">CORES</span>
                </div>
                <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{hw.cpuCores}C<small> / {hw.cpuThreads}T</small></span>
              </div>
            )}
            {hw?.cpuMaxClock && (
              <div className="dh-stat-tile">
                <div className="dh-stat-tile-top">
                  <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', opacity: 0.6 }} />
                  <span className="dh-stat-tile-label">MAX CLK</span>
                </div>
                <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{hw.cpuMaxClock}</span>
              </div>
            )}
          </div>
          {ext && ext.cpuClock > 0 && (
            <DetailBar
              pct={Math.min((ext.cpuClock / (parseFloat(hw?.cpuMaxClock || '5') * 1000)) * 100, 100)}
              label="Current Clock" display={`${(ext.cpuClock / 1000).toFixed(2)} GHz`} color="#00F2FF"
            />
          )}
          {ext?.perCoreCpu && ext.perCoreCpu.length > 0 ? (
            <CoreStrip cores={ext.perCoreCpu} coreCount={hw?.cpuCores} />
          ) : (
            <CoreStrip cores={[]} coreCount={hw?.cpuCores || 4} threadCount={hw?.cpuThreads || 8} loading={!ext} />
          )}
        </HeroCard>

        {/* ══ GPU ═════════════════════════════ */}
        <HeroCard
          icon={<MonitorSpeaker size={15} />}
          cardLabel="GPU USAGE" subtitle={hw?.gpuName}
          mainValue={hasGpu ? `${Math.round(gpuUsage)}` : '—'} mainSuffix={hasGpu ? '%' : undefined}
          statusPct={gpuUsage} chipLabel={statusLabel(gpuUsage, ['Idle', 'Active', 'High'])}
          accentColor="#00F2FF"
          history={gpuHistory} gradId="dhGradGpu"
          delay={0.07}
          backContent={(hw?.gpuName || hw?.gpuDriverVersion || (ext?.gpuFan != null && ext.gpuFan >= 0)) ? (
            <div className="dh-info-block">
              {hw?.gpuName && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Model</span>
                  <span className="dh-info-val">{hw.gpuName}</span>
                </div>
              )}
              {hw?.gpuDriverVersion && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Driver</span>
                  <span className="dh-info-val">{hw.gpuDriverVersion}</span>
                </div>
              )}
              {(ext?.gpuFan != null && ext.gpuFan >= 0) && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Fan Speed</span>
                  <span className="dh-info-val">{ext.gpuFan}%</span>
                </div>
              )}
            </div>
          ) : undefined}
        >
          {/* GPU stat tiles: Temp · FAN · TOTAL (VRAM) — FAN and TOTAL swapped per request */}
          {(gpuTemp >= 0 || gpuVramT > 0 || (ext?.gpuFan != null && ext.gpuFan >= 0)) && (
            <div className="dh-stat-tiles">
              {gpuTemp >= 0 && (() => {
                const tc = gpuTemp >= 85 ? '#FF2D55' : gpuTemp >= 65 ? '#FFD600' : '#FFFFFF';
                return (
                  <div className="dh-stat-tile">
                    <div className="dh-stat-tile-top">
                      <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                      <span className="dh-stat-tile-label">GPU TEMP</span>
                    </div>
                    <span className="dh-stat-tile-val" style={{ color: tc }}>{Math.trunc(gpuTemp)}<small>°C</small></span>
                  </div>
                );
              })()}

              {(ext?.gpuFan != null && ext.gpuFan >= 0) && (() => {
                const fc = ext.gpuFan > 80 ? '#FF2D55' : ext.gpuFan > 60 ? '#FFD600' : '#00F2FF';
                const hasRpm = ext?.gpuFanRpm != null && ext.gpuFanRpm >= 0;
                return (
                  <div className="dh-stat-tile">
                    <div className="dh-stat-tile-top">
                      <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                      <span className="dh-stat-tile-label">Fan Speed</span>
                    </div>
                    {hasRpm ? (
                      <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{ext.gpuFanRpm!}<small> RPM</small></span>
                    ) : (
                      <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{ext.gpuFan}<small>%</small></span>
                    )}
                  </div>
                );
              })()}

              {gpuVramT > 0 && (
                <div className="dh-stat-tile">
                  <div className="dh-stat-tile-top">
                    <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', opacity: 0.6 }} />
                    <span className="dh-stat-tile-label">TOTAL</span>
                  </div>
                  <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{fmtMiB(gpuVramT)}</span>
                </div>
              )}
            </div>
          )}
          {gpuVramT > 0 && (
            <DetailBar
              pct={gpuVramU >= 0 ? (gpuVramU / gpuVramT) * 100 : 0}
              label="VRAM Used"
              display={`${fmtMiB(gpuVramU)} / ${fmtMiB(gpuVramT)}`}
              color={gpuVramU >= 0 && (gpuVramU / gpuVramT) > 0.9 ? '#FF2D55' : (gpuVramU / gpuVramT) > 0.7 ? '#FFD600' : '#00F2FF'}
            />
          )}
          {(ext?.gpuClock != null && ext.gpuClock > 0) && (
            <DetailBar
              pct={Math.min((ext.gpuClock / 2800) * 100, 100)}
              label="GPU Clock"
              display={`${ext.gpuClock} MHz`}
              color="#00F2FF"
            />
          )}
        </HeroCard>

        {/* ══ RAM ═════════════════════════════ */}
        <HeroCard
          icon={<MemoryStick size={15} />}
          cardLabel="MEMORY" subtitle={hw?.ramBrand || hw?.ramInfo}
          mainValue={ext?.ramUsedGB ? ext.ramUsedGB.toFixed(1) : `${Math.round(ramPct)}`}
          mainSuffix={ext?.ramTotalGB ? ` / ${ext.ramTotalGB.toFixed(0)} GB` : '%'}
          statusPct={ramPct} chipLabel={statusLabel(ramPct, ['Normal', 'High', 'Critical'])}
          accentColor="#00F2FF"
          history={ramHistory} gradId="dhGradRam"
          delay={0.14}
          backContent={(hw?.ramInfo || hw?.ramPartNumber || hw?.ramSticks || hw?.ramSlotMap || hw?.ramPageFileTotal || hw?.ramTopProcesses?.length) ? (
            <div className="dh-info-block">
              {/* ── Specs ── */}
              {hw?.ramInfo && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Config</span>
                  <span className="dh-info-val">{hw.ramInfo}</span>
                </div>
              )}
              {hw?.ramPartNumber && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Part No.</span>
                  <span className="dh-info-val">{hw.ramPartNumber}</span>
                </div>
              )}
              {hw?.ramSticks && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Sticks</span>
                  <span className="dh-info-val">{hw.ramSticks}{hw?.ramSlotMap ? ` · ${hw.ramSlotMap}` : ''}</span>
                </div>
              )}
              {/* ── Usage ── */}
              {(hw?.ramPageFileTotal ?? 0) > 0 && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Page File</span>
                  <span className="dh-info-val">{hw!.ramPageFileUsed} / {hw!.ramPageFileTotal} MB</span>
                </div>
              )}
              {(hw?.ramNonPagedPool ?? 0) > 0 && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Non-Paged Pool</span>
                  <span className="dh-info-val">{hw!.ramNonPagedPool} MB</span>
                </div>
              )}
              {(hw?.ramStandby ?? 0) > 0 && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Standby</span>
                  <span className="dh-info-val">{hw!.ramStandby! > 1024 ? `${(hw!.ramStandby! / 1024).toFixed(1)} GB` : `${hw!.ramStandby} MB`}</span>
                </div>
              )}
              {/* ── Top processes ── */}
              {hw?.ramTopProcesses && hw.ramTopProcesses.length > 0 && (
                <div className="dh-ram-procs">
                  <div className="dh-ram-procs-hdr">
                    <span>Top Processes</span>
                    <span>RAM</span>
                  </div>
                  {hw.ramTopProcesses.map((p, i) => (
                    <div key={i} className="dh-ram-procs-row">
                      <span className="dh-ram-procs-rank">#{i + 1}</span>
                      <span className="dh-ram-procs-name">{p.name}</span>
                      <span className="dh-ram-procs-val">
                        {p.mb >= 1024 ? `${(p.mb / 1024).toFixed(1)} GB` : `${p.mb} MB`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : undefined}
        >
          {ext && ext.ramTotalGB > 0 && (() => {
            const uc = ramPct > 90 ? '#FF2D55' : ramPct > 70 ? '#FFD600' : '#00CC6A';
            return (
              <>
              <div className="dh-stat-tiles">
                <div className="dh-stat-tile">
                  <div className="dh-stat-tile-top">
                    <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                    <span className="dh-stat-tile-label">IN‑USE</span>
                  </div>
                  <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{ext.ramUsedGB.toFixed(1)}<small> GB</small></span>
                </div>
                <div className="dh-stat-tile">
                  <div className="dh-stat-tile-top">
                    <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                    <span className="dh-stat-tile-label">Available</span>
                  </div>
                  <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{ext.ramAvailableGB.toFixed(1)}<small> GB</small></span>
                </div>
                {ext.ramCachedGB > 0 && (
                  <div className="dh-stat-tile">
                    <div className="dh-stat-tile-top">
                      <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                      <span className="dh-stat-tile-label">CACHED</span>
                    </div>
                    <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{ext.ramCachedGB.toFixed(1)}<small> GB</small></span>
                  </div>
                )}
              </div>
              {(hw?.ramSpeed || hw?.ramDramBrand) && (
                <div className="dh-info-block" style={{ marginTop: 6 }}>
                  {hw?.ramDramBrand ? (
                    <div className="dh-info-row">
                      <span className="dh-info-key">RAM Brand</span>
                      <span className="dh-info-val">{hw.ramDramBrand}</span>
                    </div>
                  ) : null}
                  {hw?.ramSpeed ? (
                    <div className="dh-info-row">
                      <span className="dh-info-key">RAM Speed</span>
                      <span className="dh-info-val">{hw.ramSpeed}</span>
                    </div>
                  ) : null}
                </div>
              )}
              </>
            );
          })()}
        </HeroCard>

        {/* ══ STORAGE ═════════════════════════ */}
        <HeroCard
          icon={<HardDrive size={15} />}
          cardLabel="STORAGE" subtitle={hw?.diskName}
          mainValue={`${Math.round(diskPct)}`} mainSuffix="%"
          statusPct={diskPct}
          chipLabel={hw?.diskHealth ? (hw.diskHealth.toLowerCase() === 'healthy' ? 'Healthy' : 'Warning') : statusLabel(diskPct)}
          accentColor="#00F2FF"
          history={diskHistory} gradId="dhGradDisk"
          delay={0.21}
          backContent={hw?.allDrives && hw.allDrives.length > 2 ? (
            <div style={{ padding: 8 }}>
              <div className="dh-sect-hdr" style={{ marginBottom: 6 }}>Other Volumes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {hw.allDrives.slice(2).map((d) => {
                  const pct = d.totalGB > 0 ? Math.round(((d.totalGB - d.freeGB) / d.totalGB) * 100) : 0;
                  const color = pct > 90 ? '#FF2D55' : pct > 70 ? '#FFD600' : '#00F2FF';
                  const textColor = color === '#00F2FF' ? '#FFFFFF' : color;
                  return (
                    <div key={d.letter} className="dh-net-info-row">
                      <span className="dh-net-info-key">{d.letter}</span>
                      <span className="dh-net-info-val" style={{ color: textColor }}>{pct}%</span>
                      <span className="dh-net-info-val" style={{ color: 'rgba(190,215,255,0.65)', marginLeft: 8 }}>{d.freeGB}GB</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : undefined}
        >
          {(hw?.diskType || hw?.diskHealth) && (
            <div className="dh-stat-tiles">
              {hw?.diskType && (
                <div className="dh-stat-tile">
                  <div className="dh-stat-tile-top">
                    <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF88' }} />
                    <span className="dh-stat-tile-label">TYPE</span>
                  </div>
                  <span className="dh-stat-tile-val" style={{ color: '#FFFFFF' }}>{hw.diskType}</span>
                </div>
              )}
              {hw?.diskHealth && (() => {
                const ok = hw.diskHealth.toLowerCase() === 'healthy';
                const c  = ok ? '#FFFFFF' : (hw.diskHealth.toLowerCase() === 'warning' ? '#FFD600' : '#FF2D55');
                return (
                  <div className="dh-stat-tile">
                    <div className="dh-stat-tile-top">
                      <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF88' }} />
                      <span className="dh-stat-tile-label">HEALTH</span>
                    </div>
                    <span className="dh-stat-tile-val" style={{ color: c }}>{hw.diskHealth}</span>
                  </div>
                );
              })()}
            </div>
          )}
          {ext && (
            <div className="dh-speed">
              <div className="dh-speed-half">
                <span className="dh-net-speed-ic dn"><ArrowDown size={10} /></span>
                <span className="dh-speed-val read">{fmt(ext.diskReadSpeed)}</span>
              </div>
              <span className="dh-speed-div" />
              <div className="dh-speed-half">
                <span className="dh-net-speed-ic up"><ArrowUp size={10} /></span>
                <span className="dh-speed-val write">{fmt(ext.diskWriteSpeed)}</span>
              </div>
            </div>
          )}
          {hw?.allDrives && hw.allDrives.length > 0 && (
            <>
              <span className="dh-sect-hdr">Volumes</span>
              <VolumeStrip drives={hw.allDrives.slice(0, 2)} />
            </>
          )}
        </HeroCard>

        {/* ══ NETWORK ═════════════════════════ */}
        <HeroCard
          icon={isWifi ? <Wifi size={15} /> : <Network size={15} />}
          cardLabel="NETWORK" subtitle={ext?.activeAdapterName || hw?.networkAdapter}
          mainValue={ext?.latencyMs ? `${ext.latencyMs}` : '—'} mainSuffix={ext?.latencyMs ? ' ms' : undefined}
          statusPct={ext?.latencyMs ? Math.min((ext.latencyMs / 300) * 100, 100) : 0}
          chipLabel={ext?.latencyMs && ext.latencyMs > 150 ? 'High Latency' : isWifi || ext?.activeAdapterName ? 'Connected' : 'Offline'}
          accentColor="#00F2FF"
          history={netHistory} gradId="dhGradNetPing"
          history2={lossHistory} gradId2="dhGradNetLoss" color2="#FF2D55" label2="LOSS"
          delay={0.28}
          backContent={
            <div className="dh-net-info">
              <div className="dh-net-info-row">
                <span className="dh-net-info-key">IP Address</span>
                <span className={blurred['ip'] ? 'dh-net-info-val dh-blurred' : 'dh-net-info-val dh-blur-field'} onDoubleClick={() => toggleBlur('ip')} title="Double-click to blur">{ext?.activeLocalIP || hw?.ipAddress || '—'}</span>
              </div>
              <div className="dh-net-info-row">
                <span className="dh-net-info-key">Gateway</span>
                <span className={blurred['gw'] ? 'dh-net-info-val dh-blurred' : 'dh-net-info-val dh-blur-field'} onDoubleClick={() => toggleBlur('gw')} title="Double-click to blur">{ext?.activeGateway || hw?.gateway || '—'}</span>
              </div>
              <div className="dh-net-info-row">
                <span className="dh-net-info-key">DNS</span>
                <span className={blurred['dns'] ? 'dh-net-info-val dh-blurred' : 'dh-net-info-val dh-blur-field'} onDoubleClick={() => toggleBlur('dns')} title="Double-click to blur">{hw?.dns || '—'}</span>
              </div>
              {(ext?.activeMac || hw?.macAddress) && (
                <div className="dh-net-info-row">
                  <span className="dh-net-info-key">MAC Address</span>
                  <span className={blurred['mac'] ? 'dh-net-info-val dh-blurred' : 'dh-net-info-val dh-blur-field'} onDoubleClick={() => toggleBlur('mac')} title="Double-click to blur">{ext?.activeMac || hw?.macAddress}</span>
                </div>
              )}
            </div>
          }
        >
          {/* Quality tiles: PING · PACKET LOSS · LINK · (SSID / SIGNAL if WiFi) */}
          {(() => {
            const ms  = ext?.latencyMs ?? 0;
            const mc  = ms <= 95 ? '#FFFFFF' : ms <= 210 ? '#FFD600' : '#FF2D55';
            const pl  = ext?.packetLoss ?? -1;
            const plIsZero = pl === 0;
            const plDotColor = plIsZero ? '#FFFFFF' : '#FF2D55';
            const plValColor = plIsZero ? '#FFFFFF' : '#FF2D55';
            const link = ext?.activeLinkSpeed || hw?.networkLinkSpeed;
            if (!ms && !link) return null;
            return (
              <div className="dh-net-quality">
                {ms > 0 && (
                  <div className="dh-net-q-tile">
                    <span className="dh-net-q-dot" style={{ background: '#00F2FF', boxShadow: '0 0 6px #00F2FF' }} />
                    <div>
                      <span className="dh-net-q-label">PING</span>
                      <span className="dh-net-q-val" style={{ color: mc }}>{ms}<small> ms</small></span>
                    </div>
                  </div>
                )}
                {pl >= 0 && (
                  <div className="dh-net-q-tile">
                    <span className="dh-net-q-dot" style={{ background: plDotColor, boxShadow: plIsZero ? '0 0 6px rgba(255,255,255,0.12)' : '0 0 6px #FF2D55' }} />
                    <div>
                      <span className="dh-net-q-label">PACKET LOSS</span>
                      <span className="dh-net-q-val" style={{ color: plValColor }}>{pl}<small>%</small></span>
                    </div>
                  </div>
                )}
                {link && (
                  <div className="dh-net-q-tile">
                    <span className="dh-net-q-dot" style={{ background: '#00F2FF', boxShadow: '0 0 6px #00F2FF66' }} />
                    <div>
                      <span className="dh-net-q-label">LINK</span>
                      <span className="dh-net-q-val" style={{ color: '#FFFFFF' }}>{fmtLinkSpeed(link)}</span>
                    </div>
                  </div>
                )}
                {isWifi && ext?.ssid && (
                  <div className="dh-net-q-tile">
                    <span className="dh-net-q-dot" style={{ background: '#00F2FF', boxShadow: '0 0 6px #00F2FF99' }} />
                    <div>
                      <span className="dh-net-q-label">SSID</span>
                      <span className="dh-net-q-val">{ext.ssid}</span>
                    </div>
                  </div>
                )}
                {isWifi && (ext?.wifiSignal ?? 0) > 0 && (
                  <div className="dh-net-q-tile">
                    <span className="dh-net-q-dot" style={{ background: '#00F2FF', boxShadow: '0 0 6px #00F2FF' }} />
                    <div>
                      <span className="dh-net-q-label">SIGNAL</span>
                      <span className="dh-net-q-val" style={{ color: ext!.wifiSignal > 70 ? '#FFFFFF' : ext!.wifiSignal > 40 ? '#FFD600' : '#FF2D55' }}>{ext!.wifiSignal}<small>%</small></span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {/* Speed split panel */}
          <div className="dh-net-speeds" style={{ marginTop: '8px' }}>
            <div className="dh-net-speed-half dn">
              <div className="dh-net-speed-top">
                <span className="dh-net-speed-ic dn"><ArrowDown size={10} /></span>
                <span className="dh-net-speed-lbl">DOWNLOAD</span>
              </div>
              <span className="dh-net-speed-num dn">{fmtMbps(netDown)}</span>
              <div className="dh-net-speed-track">
                {/* GPU scaleX bar — --bar-scale is 0–1; CSS handles transform: scaleX() */}
              <div className="dh-net-speed-fill dn" style={{ '--bar-scale': `${Math.max(netDown > 0 ? 0.03 : 0, Math.min(Math.pow(netDown / 1000, 0.35), 1))}` } as React.CSSProperties} />
              </div>
            </div>
            <div className="dh-net-speeds-sep" />
            <div className="dh-net-speed-half up">
              <div className="dh-net-speed-top">
                <span className="dh-net-speed-ic up"><ArrowUp size={10} /></span>
                <span className="dh-net-speed-lbl">UPLOAD</span>
              </div>
              <span className="dh-net-speed-num up">{fmtMbps(netUp)}</span>
              <div className="dh-net-speed-track">
                <div className="dh-net-speed-fill up" style={{ '--bar-scale': `${Math.max(netUp > 0 ? 0.03 : 0, Math.min(Math.pow(netUp / 1000, 0.35), 1))}` } as React.CSSProperties} />
              </div>
            </div>
          </div>

        </HeroCard>

        {/* ══ SYSTEM ══════════════════════════ */}
        <HeroCard
          icon={<Monitor size={15} />}
          cardLabel="SYSTEM" subtitle={hw?.windowsVersion}
          mainValue={ext?.processCount != null ? `${ext.processCount}` : '—'}
          mainSuffix={ext?.processCount != null ? ' Processes' : undefined}
          statusPct={ext?.processCount ? Math.min((ext.processCount / 500) * 100, 100) : 0}
          chipLabel={hw?.windowsActivation === 'Licensed' ? 'Licensed' : hw?.windowsActivation ?? 'System'}
          accentColor="#00F2FF"
          cardClass="dh-card--system"
          history={processHistory} gradId="dhGradProc"
          delay={0.35}
          backContent={(hw?.biosVersion || hw?.windowsBuild || hw?.windowsActivation || hw?.lastWindowsUpdate || hw?.secureBoot) ? (
            <div className="dh-info-block">
              {(hw?.biosVersion || hw?.biosDate) && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>BIOS</span>
                  <span className="dh-info-val">{hw?.biosVersion ?? 'Unknown'}{hw?.biosDate ? ' · ' + hw.biosDate : ''}</span>
                </div>
              )}
              {hw?.windowsBuild && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Build</span>
                  <span className="dh-info-val">{hw.windowsBuild}</span>
                </div>
              )}
              {hw?.windowsActivation && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Activation</span>
                  <span className="dh-info-val" style={{ color: hw.windowsActivation === 'Licensed' ? '#FFFFFF' : undefined }}>{hw.windowsActivation}</span>
                </div>
              )}
              {hw?.secureBoot && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Secure Boot</span>
                  <span className="dh-info-val" style={{ color: hw.secureBoot === 'Enabled' ? '#FFFFFF' : hw.secureBoot === 'Disabled' ? '#FF2D55' : undefined }}>{hw.secureBoot}</span>
                </div>
              )}
              {hw?.lastWindowsUpdate && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: '#00F2FF' }}>Last Update</span>
                  <span className="dh-info-val">{hw.lastWindowsUpdate}</span>
                </div>
              )}
            </div>
          ) : undefined}
        >
          {/* Runtime stat tiles */}
          <div className="dh-stat-tiles">
            {(ext?.systemUptime || hw?.systemUptime) && (
                  <div className="dh-stat-tile" style={{ flex: 2 }}>
                <div className="dh-stat-tile-top">
                  <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                  <span className="dh-stat-tile-label">UPTIME</span>
                </div>
                <span className="dh-stat-tile-val dh-stat-tile-val--small" style={{ color: '#FFFFFF' }}>{ext?.systemUptime || hw?.systemUptime}</span>
              </div>
            )}
            {hw?.powerPlan && (
              <div className="dh-stat-tile" style={{ flex: 2 }}>
                <div className="dh-stat-tile-top">
                  <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                  <span className="dh-stat-tile-label">POWER</span>
                </div>
                <span className="dh-stat-tile-val dh-stat-tile-val--small" style={{ color: '#FFFFFF' }}>{hw.powerPlan}</span>
              </div>
            )}
            {hw?.hasBattery && (() => {
              const bc = (hw.batteryPercent ?? 100) < 20 ? '#FF2D55' : (hw.batteryPercent ?? 100) < 50 ? '#FFD600' : '#00F2FF';
              return (
                  <div className="dh-stat-tile">
                    <div className="dh-stat-tile-top">
                      <span className="dh-stat-tile-dot" style={{ background: '#00F2FF', boxShadow: '0 0 5px #00F2FF' }} />
                      <span className="dh-stat-tile-label">BATTERY</span>
                    </div>
                    <span className="dh-stat-tile-val" style={{ color: bc }}>{hw.batteryPercent}<small>%</small></span>
                  </div>
              );
            })()}
          </div>
          {(hw?.windowsVersion || hw?.motherboardProduct || hw?.motherboardManufacturer || hw?.keyboardName) && (
            <div className="dh-info-block" style={{ marginTop: 6 }}>
              {hw?.windowsVersion && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: 'rgba(255,255,255,0.55)' }}>Operating System</span>
                  <span className="dh-info-val">{hw.windowsVersion}</span>
                </div>
              )}
              {(hw?.motherboardProduct || hw?.motherboardManufacturer) && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: 'rgba(255,255,255,0.55)' }}>Motherboard</span>
                  <span className="dh-info-val">{hw?.motherboardProduct ? cleanBoard(hw.motherboardProduct) : hw?.motherboardManufacturer}</span>
                </div>
              )}
              {hw?.keyboardName && (
                <div className="dh-info-row">
                  <span className="dh-info-key" style={{ color: 'rgba(255,255,255,0.55)' }}>Keyboard</span>
                  <span className="dh-info-val">{hw.keyboardName}</span>
                </div>
              )}
            </div>
          )}
        </HeroCard>

      </div>
    </section>
  );
};

export default DashboardHero;





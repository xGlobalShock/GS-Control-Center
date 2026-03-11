import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Wifi, Activity, Globe, Signal, Zap, BarChart3, Radio } from 'lucide-react';
import { ArrowCounterClockwise } from 'phosphor-react';
import PageHeader from '../components/PageHeader';
import '../styles/Network.css';

/* ── Types ── */
interface PingTarget {
  id: string;
  label: string;
  host: string;
  category: 'dns' | 'gaming';
}
interface PingResult { time: number | null; loading: boolean; }

/* ── Targets ── */
const PING_TARGETS: PingTarget[] = [
  { id: 'google',     label: 'Google DNS',           host: '8.8.8.8',        category: 'dns' },
  { id: 'cloudflare', label: 'Cloudflare DNS',       host: '1.1.1.1',        category: 'dns' },
  { id: 'quad9',      label: 'Quad9 DNS',            host: '9.9.9.9',        category: 'dns' },
  { id: 'opendns',    label: 'OpenDNS (Cisco)',      host: '208.67.222.222', category: 'dns' },
  { id: 'adguard',    label: 'AdGuard DNS',          host: '94.140.14.14',   category: 'dns' },
  { id: 'nextdns',    label: 'NextDNS',              host: '45.90.28.0',     category: 'dns' },
  { id: 'gm-use',     label: 'US East (Virginia)',   host: 'dynamodb.us-east-1.amazonaws.com',        category: 'gaming' },
  { id: 'gm-usw',     label: 'US West (Oregon)',     host: 'dynamodb.us-west-2.amazonaws.com',        category: 'gaming' },
  { id: 'gm-eu',      label: 'EU Central (Frankfurt)', host: 'dynamodb.eu-central-1.amazonaws.com',   category: 'gaming' },
  { id: 'gm-euw',     label: 'EU West (Ireland)',    host: 'dynamodb.eu-west-1.amazonaws.com',        category: 'gaming' },
  { id: 'gm-asia',    label: 'Asia (Tokyo)',         host: 'dynamodb.ap-northeast-1.amazonaws.com',   category: 'gaming' },
  { id: 'gm-oce',     label: 'Oceania (Sydney)',     host: 'dynamodb.ap-southeast-2.amazonaws.com',   category: 'gaming' },
];

const SECTIONS: { key: PingTarget['category']; title: string; icon: React.ReactNode }[] = [
  { key: 'dns',    title: 'DNS Resolvers',               icon: <Globe size={13} /> },
  { key: 'gaming', title: 'Gaming Cloud Regions — AWS',   icon: <Radio size={13} /> },
];

/* ── Helpers ── */
const pingColor = (t: number | null) => {
  if (t == null) return 'neutral';
  if (t < 90) return 'green';
  if (t < 180) return 'amber';
  return 'red';
};
const qualityLabel = (avg: number | null) => {
  if (avg == null) return { text: 'SCANNING', cls: 'neutral' };
  if (avg < 50)  return { text: 'EXCELLENT', cls: 'green' };
  if (avg < 90)  return { text: 'GOOD', cls: 'green' };
  if (avg < 180) return { text: 'MODERATE', cls: 'amber' };
  return { text: 'POOR', cls: 'red' };
};

/* ══════════════════════════════════════════════════════ */
const Network: React.FC = () => {
  const [results, setResults] = useState<Record<string, PingResult>>(() => {
    const init: Record<string, PingResult> = {};
    PING_TARGETS.forEach(t => { init[t.id] = { time: null, loading: false }; });
    return init;
  });
  const mountedRef = useRef(true);

  const pingOne = useCallback(async (target: PingTarget) => {
    if (!window.electron?.ipcRenderer) return;
    setResults(prev => ({ ...prev, [target.id]: { ...prev[target.id], loading: true } }));
    try {
      const res: any = await window.electron.ipcRenderer.invoke('network:ping', target.host);
      if (!mountedRef.current) return;
      const time = res && typeof res.time === 'number' ? res.time : null;
      setResults(prev => ({ ...prev, [target.id]: { time, loading: false } }));
    } catch {
      if (!mountedRef.current) return;
      setResults(prev => ({ ...prev, [target.id]: { time: null, loading: false } }));
    }
  }, []);

  const pingAll = useCallback(() => { PING_TARGETS.forEach(t => pingOne(t)); }, [pingOne]);

  useEffect(() => {
    mountedRef.current = true;
    pingAll();
    const iv = setInterval(pingAll, 1000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [pingAll]);

  /* ── Stats ── */
  const allTimes = PING_TARGETS.map(t => results[t.id]?.time).filter((t): t is number => t != null);
  const avg = allTimes.length ? Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length) : null;
  const best = allTimes.length ? Math.min(...allTimes) : null;
  const worst = allTimes.length ? Math.max(...allTimes) : null;
  const jitter = allTimes.length >= 2
    ? Math.round(allTimes.reduce((sum, t, i, a) => i === 0 ? 0 : sum + Math.abs(t - a[i - 1]), 0) / (allTimes.length - 1))
    : null;
  const online = allTimes.length;
  const total = PING_TARGETS.length;
  const quality = qualityLabel(avg);

  /* Gauge arc (0-180 deg mapping) — lower ping = fuller arc */
  const gaugePercent = avg != null ? Math.max(0, Math.min(100, 100 - (avg / 200) * 100)) : 0;
  const gaugeDeg = (gaugePercent / 100) * 180;

  return (
    <motion.div className="nv" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {/* Background effects */}
      <div className="nv-bg-grid" />


      <PageHeader
        icon={<Wifi size={16} />}
        title="Network Diagnostics"
        actions={
          <button className="nv-refresh" onClick={pingAll} title="Refresh all">
            <ArrowCounterClockwise size={14} weight="bold" />
            <span>Rescan</span>
          </button>
        }
      />

      {/* ═══ TOP SECTION: Gauge + Metric Tiles ═══ */}
      <div className="nv-command">
        {/* Central Gauge */}
        <motion.div
          className="nv-gauge-wrap"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 120 }}
        >
          <div className="nv-gauge">
            <svg viewBox="0 0 200 120" className="nv-gauge-svg">
              <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" strokeLinecap="round" />
              <motion.path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none" stroke="url(#gaugeGrad)" strokeWidth="6" strokeLinecap="round"
                strokeDasharray="251.2"
                initial={{ strokeDashoffset: 251.2 }}
                animate={{ strokeDashoffset: 251.2 - (gaugeDeg / 180) * 251.2 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
              <motion.path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round"
                strokeDasharray="251.2"
                initial={{ strokeDashoffset: 251.2 }}
                animate={{ strokeDashoffset: 251.2 - (gaugeDeg / 180) * 251.2 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                opacity="0.15" filter="blur(6px)"
              />
              <defs>
                <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#FF4D4D" />
                  <stop offset="40%" stopColor="#FFD600" />
                  <stop offset="100%" stopColor="#00FFB2" />
                </linearGradient>
              </defs>
            </svg>
            <div className="nv-gauge-center">
              <span className={`nv-gauge-value nv-c-${quality.cls}`}>{avg != null ? avg : '–'}</span>
              <span className="nv-gauge-unit">ms avg</span>
              <span className={`nv-gauge-quality nv-c-${quality.cls}`}>{quality.text}</span>
            </div>
          </div>
          <div className="nv-gauge-ring nv-gauge-ring--1" />
          <div className="nv-gauge-ring nv-gauge-ring--2" />
        </motion.div>

        {/* Metric Tiles */}
        <div className="nv-metrics">
          {[
            { label: 'ONLINE', value: `${online}/${total}`, icon: <Signal size={15} />, cls: online === total ? 'green' : 'amber' },
            { label: 'BEST', value: best != null ? `${best}ms` : '–', icon: <Zap size={15} />, cls: pingColor(best) },
            { label: 'WORST', value: worst != null ? `${worst}ms` : '–', icon: <Activity size={15} />, cls: pingColor(worst) },
            { label: 'JITTER', value: jitter != null ? `${jitter}ms` : '–', icon: <BarChart3 size={15} />, cls: jitter != null ? (jitter < 20 ? 'green' : jitter < 50 ? 'amber' : 'red') : 'neutral' },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              className={`nv-tile nv-tile--${m.cls}`}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.07, type: 'spring', stiffness: 160, damping: 20 }}
            >
              <div className="nv-tile-icon">{m.icon}</div>
              <div className="nv-tile-data">
                <span className="nv-tile-value">{m.value}</span>
                <span className="nv-tile-label">{m.label}</span>
              </div>
              <div className="nv-tile-glow" />
            </motion.div>
          ))}
        </div>
      </div>

      {/* ═══ ENDPOINT TABLES — side by side ═══ */}
      <div className="nv-tables-row">
      {SECTIONS.map((section, si) => {
        const targets = PING_TARGETS.filter(t => t.category === section.key);
        return (
          <motion.div
            key={section.key}
            className="nv-section"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 + si * 0.12, type: 'spring', stiffness: 140, damping: 22 }}
          >
            <div className="nv-section-head">
              <span className="nv-section-icon">{section.icon}</span>
              <h3 className="nv-section-title">{section.title}</h3>
              <div className="nv-section-line" />
              <span className="nv-section-count">{targets.filter(t => results[t.id]?.time != null).length}/{targets.length}</span>
            </div>

            <div className="nv-table">
              <div className="nv-table-head">
                <span className="nv-th nv-th-status">STATUS</span>
                <span className="nv-th nv-th-name">ENDPOINT</span>
                <span className="nv-th nv-th-ping">LATENCY</span>
                <span className="nv-th nv-th-bar">QUALITY</span>
              </div>
              {targets.map((t, ti) => {
                const r = results[t.id];
                const color = pingColor(r?.time);
                const barW = r?.time != null ? Math.min((r.time / 150) * 100, 100) : 0;
                return (
                  <motion.div
                    key={t.id}
                    className={`nv-row nv-row--${color}`}
                    initial={{ x: -16, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.5 + si * 0.12 + ti * 0.06, type: 'spring', stiffness: 180, damping: 22 }}
                  >
                    <span className="nv-td nv-td-status">
                      <span className={`nv-dot nv-dot--${color}`} />
                    </span>
                    <span className="nv-td nv-td-name">{t.label}</span>
                    <span className={`nv-td nv-td-ping nv-c-${color}`}>
                      {r?.time != null ? r.time : r?.loading ? '···' : '–'}
                      <small>ms</small>
                    </span>
                    <span className="nv-td nv-td-bar">
                      <span className="nv-bar-track">
                        <motion.span
                          className={`nv-bar-fill nv-bg-${color}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${barW}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </span>
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        );
      })}
      </div>
    </motion.div>
  );
};

export default React.memo(Network);

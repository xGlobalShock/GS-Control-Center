import React from 'react';
import { motion } from 'framer-motion';
import {
  Cpu, MonitorSpeaker, MemoryStick, HardDrive,
  Network, Monitor, Activity,
} from 'lucide-react';
import '../styles/Loader.css';

const SKELETON_CARDS = [
  { cls: 'hud-tile-cpu',     icon: <Cpu size={18} />,            title: 'PROCESSOR',  rows: 4 },
  { cls: 'hud-tile-gpu',     icon: <MonitorSpeaker size={18} />, title: 'GRAPHICS',   rows: 3 },
  { cls: 'hud-tile-mem',     icon: <MemoryStick size={18} />,    title: 'MEMORY',     rows: 3 },
  { cls: 'hud-tile-storage', icon: <HardDrive size={18} />,      title: 'STORAGE',    rows: 3 },
  { cls: 'hud-tile-net',     icon: <Network size={18} />,        title: 'NETWORK',    rows: 4 },
  { cls: 'hud-tile-sys',     icon: <Monitor size={18} />,        title: 'SYSTEM',     rows: 4 },
];

const Loader: React.FC = () => (
  <div className="loader-skeleton-wrapper">
    {/* Status bar */}
    <div className="loader-skel-status">
      <Activity size={13} className="loader-skel-status-icon" />
      <span>Initializing hardware monitors…</span>
      <span className="loader-skel-dots" />
    </div>

    {/* Skeleton bento grid */}
    <div className="loader-skel-grid">
      {SKELETON_CARDS.map((card, i) => (
        <motion.div
          key={card.cls}
          className={`loader-skel-card ${card.cls}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Scanning line animation */}
          <div className="loader-skel-scan-line" />

          <div className="loader-skel-inner">
            {/* Header skeleton */}
            <div className="loader-skel-head">
              <div className="loader-skel-icon">{card.icon}</div>
              <div className="loader-skel-title-group">
                <div className="loader-skel-title">{card.title}</div>
                <div className="loader-skel-subtitle-bar" />
              </div>
              <div className="loader-skel-gauge" />
            </div>

            {/* Row skeletons */}
            <div className="loader-skel-body">
              {Array.from({ length: card.rows }).map((_, ri) => (
                <div key={ri} className="loader-skel-row">
                  <span className="loader-skel-row-label" />
                  <span className="loader-skel-row-value" />
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  </div>
);

export default Loader;

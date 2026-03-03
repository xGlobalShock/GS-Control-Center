import React, { useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
  Home,
  Activity,
  Trash2,
  Settings,
  Gamepad2,
  Zap,
  Video,
  Wifi,
  RefreshCw,
  Download,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import '../styles/Sidebar.css';

/* ─── Types ──────────────────────────────────────────────────────────── */
interface SidebarProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  online?: boolean;
}

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

/* ─── Magnetic Icon Wrapper ──────────────────────────────────────────── */
const MAGNETIC_RANGE = 40; // px radius of magnetic pull
const MAGNETIC_STRENGTH = 0.35; // 0-1 pull intensity

const MagneticIcon: React.FC<{
  children: React.ReactNode;
  isActive: boolean;
  label: string;
  onClick: () => void;
}> = ({ children, isActive, label, onClick }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 250, damping: 20 });
  const springY = useSpring(y, { stiffness: 250, damping: 20 });

  // Glow opacity driven by magnetic distance
  const glowOpacity = useTransform(
    [springX, springY] as any,
    ([sx, sy]: number[]) => {
      const dist = Math.sqrt(sx * sx + sy * sy);
      return Math.min(dist / MAGNETIC_RANGE, 1) * 0.45;
    }
  );
  const springGlow = useSpring(glowOpacity, { stiffness: 200, damping: 25 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < MAGNETIC_RANGE) {
      x.set(dx * MAGNETIC_STRENGTH);
      y.set(dy * MAGNETIC_STRENGTH);
    }
  }, [x, y]);

  const handleMouseLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  return (
    <motion.button
      ref={ref}
      className={`ks-nav-item${isActive ? ' ks-active' : ''}`}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      whileTap={{ scale: 0.92 }}
      aria-label={label}
    >
      {/* Ambient glow (hover proximity) */}
      <motion.span
        className="ks-hover-glow"
        style={{ opacity: springGlow }}
        aria-hidden
      />
      {/* Active glow */}
      {isActive && (
        <motion.span
          className="ks-active-glow"
          layoutId="activeGlow"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          aria-hidden
        />
      )}
      {children}
      <span className="ks-tooltip">{label}</span>
    </motion.button>
  );
};

/* ─── Breathing Ring (status) ────────────────────────────────────────── */
const BreathingRing: React.FC<{ online: boolean }> = ({ online }) => (
  <div className={`ks-breathing-ring${online ? ' ks-online' : ''}`} aria-hidden>
    <svg viewBox="0 0 36 36" className="ks-ring-svg">
      <circle
        cx="18" cy="18" r="14"
        fill="none"
        strokeWidth="1.5"
        className="ks-ring-track"
      />
      {online && (
        <circle
          cx="18" cy="18" r="14"
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="88"
          strokeDashoffset="0"
          strokeLinecap="round"
          className="ks-ring-pulse"
        />
      )}
    </svg>
    <span className="ks-ring-dot" />
  </div>
);

/* ─── Main Sidebar ──────────────────────────────────────────────────── */
const Sidebar: React.FC<SidebarProps> = ({ currentPage, setCurrentPage, online: onlineProp }) => {
  const [online, setOnline] = React.useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  React.useEffect(() => {
    if (typeof onlineProp === 'boolean') {
      setOnline(onlineProp);
      return;
    }
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onlineProp]);

  const menuItems: MenuItem[] = useMemo(() => [
    { id: 'dashboard', label: 'System Details', icon: Home },
    { id: 'performance', label: 'PC Tweaks', icon: Activity },
    { id: 'network', label: 'Network Diagnostics', icon: Wifi },
    { id: 'gameLibrary', label: 'Game Presets', icon: Gamepad2 },
    { id: 'obsPresets', label: 'Streaming Presets', icon: Video },
    { id: 'softwareUpdates', label: 'Software Updates', icon: RefreshCw },
    { id: 'appInstaller', label: 'App Installer', icon: Download },
    { id: 'cleaner', label: 'Cleanup Toolkit', icon: Trash2 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ], []);

  // Track active index for the data-line slider
  const activeIndex = menuItems.findIndex((m) => m.id === currentPage);

  return (
    <aside className="ks-sidebar">
      {/* Glass strip */}
      <div className="ks-glass-strip">
        {/* ── Logo ── */}
        <div className="ks-logo">
          <div className="ks-logo-ring" aria-hidden>
            <Zap size={20} className="ks-logo-icon" />
          </div>
          <span className="ks-logo-text">GS</span>
        </div>

        {/* ── Navigation ── */}
        <nav className="ks-nav">
          {/* Sliding data-line */}
          <motion.div
            className="ks-data-line"
            animate={{
              y: activeIndex * 56,     // 48px icon height + 8px gap
            }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            aria-hidden
          />

          <AnimatePresence>
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <MagneticIcon
                  key={item.id}
                  isActive={currentPage === item.id}
                  label={item.label}
                  onClick={() => setCurrentPage(item.id)}
                >
                  <Icon size={20} className="ks-icon" />
                </MagneticIcon>
              );
            })}
          </AnimatePresence>
        </nav>

        {/* ── Bottom Status ── */}
        <div className="ks-footer">
          <BreathingRing online={online} />
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

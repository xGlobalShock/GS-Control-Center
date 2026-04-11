import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Home,
  Activity,
  SlidersHorizontal,
  Gamepad2,
  Video,
  Wifi,
  RefreshCw,
  Layers,
  MonitorSmartphone,
  Shield,
  Crown,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import { PRO_PAGE_IDS } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import '../styles/Sidebar.css';

/* ─── Types ──────────────────────────────────────────────────────────── */
interface SidebarProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

/* ─── Bottom Navigation Bar ──────────────────────────────────────────── */
const Sidebar: React.FC<SidebarProps> = ({ currentPage, setCurrentPage }) => {
  const { isPro } = useAuth();

  const navItems: MenuItem[] = useMemo(() => [
    { id: 'dashboard',         label: 'Home',      icon: Home             },
    { id: 'performance',       label: 'Tweaks',    icon: Activity         },
    { id: 'gameLibrary',       label: 'Games',     icon: Gamepad2         },
    { id: 'obsPresets',        label: 'Stream',    icon: Video            },
    { id: 'resolutionManager', label: 'Devices',  icon: MonitorSmartphone },
    { id: 'network',           label: 'Network',   icon: Wifi             },
    { id: 'apps',              label: 'Apps',      icon: Layers           },
    { id: 'softwareUpdates',   label: 'Updates',   icon: RefreshCw        },
    // { id: 'serviceOptimizer',  label: 'Services',  icon: Shield            },
    { id: 'cleaner',           label: 'Utilities', icon: SlidersHorizontal},
  ], []);

  return (
    <nav className="ks-bottom-nav">
      <div className="ks-bottom-bar">
        <div className="ks-bottom-items">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <motion.button
                key={item.id}
                className={`ks-bottom-item${isActive ? ' ks-active' : ''}`}
                onClick={() => setCurrentPage(item.id)}
                aria-label={item.label}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              >
                {/* Sliding active pill background */}
                {isActive && (
                  <motion.span
                    className="ks-bottom-active-bg"
                    layoutId="activeBg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                {/* Sliding top indicator */}
                {isActive && (
                  <motion.span
                    className="ks-bottom-indicator"
                    layoutId="bottomIndicator"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="ks-bottom-icon-wrap">
                  <Icon size={18} className="ks-bottom-icon" />
                  {!isPro && PRO_PAGE_IDS.has(item.id) && (
                    <Crown size={8} className="ks-pro-badge" />
                  )}
                </span>
                <span className="ks-bottom-label">{item.label}</span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default Sidebar;

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PerformanceTweakCard from '../components/PerformanceTweakCard';
import { ArrowCounterClockwise } from 'phosphor-react';
import { performanceTweaks } from '../data/performanceTweaks';
import { useToast } from '../contexts/ToastContext';
import '../styles/Performance.css';
import '../styles/Cleaner.css';
import { Activity, Cpu, Layers, Server, Wifi, Monitor, Gamepad2, Usb } from 'lucide-react';
import PageHeader from '../components/PageHeader';

/* ── IPC channel maps — constant, never need to be recreated ── */
const TWEAK_MAP: Record<string, string> = {
  'irq-priority': 'tweak:apply-irq-priority',
  'network-interrupts': 'tweak:apply-network-interrupts',
  'gpu-scheduling': 'tweak:apply-gpu-scheduling',
  'tdr-level': 'tweak:apply-tdr-level',
  'gdrv-policy': 'tweak:apply-gdrv-policy',
  'appcapture-disabled': 'tweak:apply-appcapture-disabled',
  'fse-behavior-mode': 'tweak:apply-fse-behavior-mode',
  'overlay-test-mode': 'tweak:apply-overlay-test-mode',
  'fullscreen-optimization': 'tweak:apply-fullscreen-optimization',
  'usb-suspend': 'tweak:apply-usb-suspend',
  'game-dvr': 'tweak:apply-game-dvr',
  'win32-priority': 'tweak:apply-win32-priority',
  'memory-compression': 'tweak:apply-memory-compression',
  'games-priority': 'tweak:apply-games-priority',
  'network-throttling-index': 'tweak:apply-network-throttling-index',
  'large-system-cache': 'tweak:apply-large-system-cache',
};

const RESET_MAP: Record<string, string> = {
  'irq-priority': 'tweak:reset-irq-priority',
  'network-interrupts': 'tweak:reset-network-interrupts',
  'gpu-scheduling': 'tweak:reset-gpu-scheduling',
  'tdr-level': 'tweak:reset-tdr-level',
  'gdrv-policy': 'tweak:reset-gdrv-policy',
  'appcapture-disabled': 'tweak:reset-appcapture-disabled',
  'fse-behavior-mode': 'tweak:reset-fse-behavior-mode',
  'overlay-test-mode': 'tweak:reset-overlay-test-mode',
  'fullscreen-optimization': 'tweak:reset-fullscreen-optimization',
  'usb-suspend': 'tweak:reset-usb-suspend',
  'game-dvr': 'tweak:reset-game-dvr',
  'win32-priority': 'tweak:reset-win32-priority',
  'memory-compression': 'tweak:reset-memory-compression',
  'games-priority': 'tweak:reset-games-priority',
  'network-throttling-index': 'tweak:reset-network-throttling-index',
  'large-system-cache': 'tweak:reset-large-system-cache',
};

const CHECK_MAP: Record<string, string> = {
  'irq-priority': 'tweak:check-irq-priority',
  'network-interrupts': 'tweak:check-network-interrupts',
  'gpu-scheduling': 'tweak:check-gpu-scheduling',
  'tdr-level': 'tweak:check-tdr-level',
  'gdrv-policy': 'tweak:check-gdrv-policy',
  'appcapture-disabled': 'tweak:check-appcapture-disabled',
  'fse-behavior-mode': 'tweak:check-fse-behavior-mode',
  'overlay-test-mode': 'tweak:check-overlay-test-mode',
  'fullscreen-optimization': 'tweak:check-fullscreen-optimization',
  'usb-suspend': 'tweak:check-usb-suspend',
  'game-dvr': 'tweak:check-game-dvr',
  'win32-priority': 'tweak:check-win32-priority',
  'memory-compression': 'tweak:check-memory-compression',
  'games-priority': 'tweak:check-games-priority',
  'network-throttling-index': 'tweak:check-network-throttling-index',
  'large-system-cache': 'tweak:check-large-system-cache',
};

type CategoryId = 'cpu' | 'gpu' | 'memory' | 'network' | 'display' | 'gamedvr' | 'hardware';

const TWEAK_CATEGORIES: Record<CategoryId, string[]> = {
  cpu:      ['irq-priority', 'win32-priority', 'games-priority'],
  gpu:      ['gpu-scheduling', 'tdr-level'],
  memory:   ['memory-compression', 'large-system-cache'],
  network:  ['network-interrupts', 'network-throttling-index'],
  display:  ['fullscreen-optimization', 'overlay-test-mode', 'fse-behavior-mode'],
  gamedvr:  ['game-dvr', 'gdrv-policy', 'appcapture-disabled'],
  hardware: ['usb-suspend'],
};

const Performance: React.FC = () => {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [enabledTweaks, setEnabledTweaks] = useState<{ [key: string]: boolean }>({});
  const [tweakChecks, setTweakChecks] = useState<Record<string, any>>({});
  const [creatingRestore, setCreatingRestore] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryId>('cpu');
  const { addToast } = useToast();

  const runChecks = useCallback(async () => {
    const entries = Object.entries(CHECK_MAP);
    const initial: Record<string, any> = {};
    for (const [tweakId] of entries) initial[tweakId] = { loading: true };
    setTweakChecks(prev => ({ ...prev, ...initial }));

    const promises = entries.map(async ([tweakId, channel]) => {
      try {
        const result = await window.electron!.ipcRenderer.invoke(channel);
        setTweakChecks(prev => ({ ...prev, [tweakId]: { loading: false, applied: !!result.applied, exists: !!result.exists, value: result.value ?? null } }));
        setEnabledTweaks(prev => ({ ...prev, [tweakId]: !!result.applied }));
      } catch (err) {
        setTweakChecks(prev => ({ ...prev, [tweakId]: { loading: false, applied: false, exists: false, error: err instanceof Error ? err.message : String(err) } }));
        setEnabledTweaks(prev => ({ ...prev, [tweakId]: false }));
      }
    });

    await Promise.all(promises);
  }, []);

  const handleCreateRestorePoint = async () => {
    setCreatingRestore(true);
    try {
      if (window.electron?.ipcRenderer) {
        const restoreDesc = `GS Control Center - Before Tweak Application`;
        const maxAttempts = 3;
        let attempt = 0;
        let success = false;
        let lastMessage = '';

        while (attempt < maxAttempts && !success) {
          attempt++;
          const restoreResult: any = await window.electron.ipcRenderer.invoke('system:create-restore-point', restoreDesc);
          if (restoreResult && restoreResult.success) {
            addToast(restoreResult.message || `System restore point created (attempt ${attempt})`, 'info');
            success = true;
            break;
          } else {
            lastMessage = restoreResult?.message || 'Failed to create system restore point';
            // small delay before retrying
            if (attempt < maxAttempts) await new Promise(res => setTimeout(res, 1500));
          }
        }

        if (!success) {
          addToast(lastMessage, 'error');
        }
      }
    } catch (error) {
      const msg = `Error creating restore point: ${error instanceof Error ? error.message : 'Unknown'}`;
      addToast(msg, 'error');
    } finally {
      setCreatingRestore(false);
    }
  };

  // Check tweak status on mount only. Manual refresh via Scan Status button.
  useEffect(() => {
    runChecks();
  }, [runChecks]);

  const handleApplyTweak = async (id: string) => {
    setApplyingId(id);
    try {
      // Apply tweak
      const channel = TWEAK_MAP[id];
      if (window.electron?.ipcRenderer && channel) {
        const result: any = await window.electron.ipcRenderer.invoke(channel);
        if (result.success) {
          addToast(result.message, 'success');
          // Check status after applying
          const checkChannel = CHECK_MAP[id];
          if (checkChannel) {
            const checkResult = await window.electron.ipcRenderer.invoke(checkChannel);
            setEnabledTweaks({ ...enabledTweaks, [id]: checkResult.applied });
          }
        } else {
          addToast(result.message || 'Failed to apply tweak', 'error');
        }
      } else {
        addToast('IPC not available', 'error');
      }
    } catch (error) {
      addToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setTimeout(() => {
        setApplyingId(null);
      }, 2000);
    }
  };

  const handleResetTweak = async (id: string) => {
    setApplyingId(id);
    try {
      const channel = RESET_MAP[id];
      if (window.electron?.ipcRenderer && channel) {
        const result: any = await window.electron.ipcRenderer.invoke(channel);
        if (result.success) {
          addToast(result.message, 'success');
          await new Promise(resolve => setTimeout(resolve, 500));
          // Force Win32 Priority to not applied after reset
          if (id === 'win32-priority') {
            setEnabledTweaks(prev => ({ ...prev, [id]: false }));
          } else {
            const checkChannel = CHECK_MAP[id];
            if (checkChannel) {
              const checkResult = await window.electron.ipcRenderer.invoke(checkChannel);
              setEnabledTweaks(prev => ({ ...prev, [id]: checkResult.applied || false }));
            }
          }
        } else {
          addToast(result.message || 'Failed to reset tweak', 'error');
        }
      } else {
        addToast('IPC not available', 'error');
      }
    } catch (error) {
      addToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setTimeout(() => {
        setApplyingId(null);
      }, 2000);
    }
  };

  // Use categories matching the current performanceTweaks dataset.
  const allTweakIds = Object.values(TWEAK_CATEGORIES).flat();
  const activeTweaks = performanceTweaks.filter(item => allTweakIds.includes(item.id));
  const appliedCount = activeTweaks.reduce((total, tweak) => {
    return total + (enabledTweaks[tweak.id] ? 1 : 0);
  }, 0);
  const totalCount = activeTweaks.length;

  const categories = [
    { id: 'cpu'      as CategoryId, label: 'CPU & Priority', icon: <Cpu size={18} />,     count: TWEAK_CATEGORIES.cpu.length,      description: 'Boost CPU scheduling and IRQ priority.',              accent: '#00CC6A' },
    { id: 'gpu'      as CategoryId, label: 'GPU',            icon: <Layers size={18} />,   count: TWEAK_CATEGORIES.gpu.length,      description: 'GPU scheduling and timeout detection.',               accent: '#9D4EDD' },
    { id: 'memory'   as CategoryId, label: 'Memory',         icon: <Server size={18} />,   count: TWEAK_CATEGORIES.memory.length,   description: 'Physical RAM usage and compression.',                 accent: '#FF851B' },
    { id: 'network'  as CategoryId, label: 'Network',        icon: <Wifi size={18} />,     count: TWEAK_CATEGORIES.network.length,  description: 'Reduce latency and stabilize ping.',                  accent: '#00CC6A' },
    { id: 'display'  as CategoryId, label: 'Display',        icon: <Monitor size={18} />,  count: TWEAK_CATEGORIES.display.length,  description: 'Fullscreen optimization and overlay mode.',           accent: '#FFDC00' },
    { id: 'gamedvr'  as CategoryId, label: 'Game DVR',       icon: <Gamepad2 size={18} />, count: TWEAK_CATEGORIES.gamedvr.length,  description: 'Disable recording, capture and DVR features.',        accent: '#FF4455' },
    { id: 'hardware' as CategoryId, label: 'Hardware',       icon: <Usb size={18} />,      count: TWEAK_CATEGORIES.hardware.length, description: 'USB and peripheral suspend settings.',                accent: '#7ED321' },
  ];

  const visibleTweaks = performanceTweaks.filter(t => TWEAK_CATEGORIES[activeCategory].includes(t.id));

  return (
    <motion.div
      className="perf-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <PageHeader
        icon={<Activity size={16} />}
        title="PC Tweaks"
        stat={
          <div className="perf-hero-stat">
            <div className="perf-hero-stat-ring">
              <svg className="perf-ring-svg" viewBox="0 0 56 56">
                <circle className="perf-ring-track" cx="28" cy="28" r="24" />
                <circle
                  className="perf-ring-fill"
                  cx="28"
                  cy="28"
                  r="24"
                  strokeDasharray={`${totalCount > 0 ? (appliedCount / totalCount) * 150.8 : 0} 150.8`}
                />
              </svg>
              <span className="perf-ring-label">{appliedCount}/{totalCount}</span>
            </div>
            <span className="perf-hero-stat-text">Applied</span>
          </div>
        }
        actions={
          <div className="perf-hero-actions">
            <button
              className="perf-action-btn"
              onClick={handleCreateRestorePoint}
              disabled={creatingRestore}
              title="Create a system restore point"
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              <span>{creatingRestore ? 'Creating...' : 'Restore Point'}</span>
            </button>
          </div>
        }
      />

      <div className="cleaner-split">
        {/* ── LEFT: Vertical nav ── */}
        <nav className="cleaner-sidenav">
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`cleaner-navitem ${activeCategory === cat.id ? 'cleaner-navitem--active' : ''}`}
              style={{ '--cat-accent': cat.accent } as React.CSSProperties}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span className="cleaner-navitem-icon">{cat.icon}</span>
              <span className="cleaner-navitem-body">
                <span className="cleaner-navitem-label">{cat.label}</span>
                <span className="cleaner-navitem-desc">{cat.description}</span>
              </span>
              <span className="cleaner-navitem-count">{cat.count}</span>
            </button>
          ))}
        </nav>

        {/* ── RIGHT: Content ── */}
        <div className="cleaner-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.16 }}
            >
              <div className="perf-tweaks-grid">
                {visibleTweaks.map((tweak, index) => (
                  <motion.div
                    key={tweak.id}
                    initial={{ y: 20, opacity: 0, scale: 0.97 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.06, type: 'spring', stiffness: 200, damping: 22 }}
                  >
                    <PerformanceTweakCard
                      id={tweak.id}
                      title={tweak.title}
                      icon={tweak.icon}
                      category={tweak.category}
                      description={tweak.description}
                      buttonText={tweak.buttonText}
                      color={tweak.color}
                      onApply={handleApplyTweak}
                      onReset={handleResetTweak}
                      isLoading={applyingId === tweak.id}
                      isEnabled={enabledTweaks[tweak.id] || false}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(Performance);

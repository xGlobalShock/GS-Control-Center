import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import PerformanceTweakCard from '../components/PerformanceTweakCard';
import { ArrowCounterClockwise } from 'phosphor-react';
import { performanceTweaks } from '../data/performanceTweaks';
import { useToast } from '../contexts/ToastContext';
import '../styles/Performance.css';

declare global {
  interface Window {
    electron?: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        on: (channel: string, func: (...args: any[]) => void) => (() => void);
        once: (channel: string, func: (...args: any[]) => void) => void;
        removeAllListeners: (channel: string) => void;
      };
      windowControls?: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (callback: (isMaximized: boolean) => void) => (() => void);
      };
      updater?: {
        checkForUpdates: () => Promise<any>;
        downloadUpdate: () => Promise<any>;
        cancelUpdate: () => Promise<any>;
        installUpdate: () => Promise<void>;
        getVersion: () => Promise<string>;
        onStatus: (callback: (data: any) => void) => (() => void);
      };
    };
  }
}

import { Activity } from 'lucide-react';
import PageHeader from '../components/PageHeader';

const Performance: React.FC = () => {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [enabledTweaks, setEnabledTweaks] = useState<{ [key: string]: boolean }>({});
  const [tweakChecks, setTweakChecks] = useState<Record<string, any>>({});
  const [creatingRestore, setCreatingRestore] = useState(false);
  const { addToast } = useToast();

  const runChecksOnDemand = async () => {
    // expose to refresh button
    if (typeof window !== 'undefined') {
      // run the checks by triggering focus handler approach
      try {
        // reuse the effect's runChecks by programmatically focusing window, but better to call same logic inline
        const entries = Object.entries(checkMap);
        const initial: any = {};
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
      } catch (e) {
        // ignore
      }
    }
  };

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

  const tweakMap: { [key: string]: string } = {
    'irq-priority': 'tweak:apply-irq-priority',
    'network-interrupts': 'tweak:apply-network-interrupts',
    'gpu-scheduling': 'tweak:apply-gpu-scheduling',
    'fullscreen-optimization': 'tweak:apply-fullscreen-optimization',
    'usb-suspend': 'tweak:apply-usb-suspend',
    'game-dvr': 'tweak:apply-game-dvr',
    'win32-priority': 'tweak:apply-win32-priority',
  };

  const resetMap: { [key: string]: string } = {
    'irq-priority': 'tweak:reset-irq-priority',
    'network-interrupts': 'tweak:reset-network-interrupts',
    'gpu-scheduling': 'tweak:reset-gpu-scheduling',
    'fullscreen-optimization': 'tweak:reset-fullscreen-optimization',
    'usb-suspend': 'tweak:reset-usb-suspend',
    'game-dvr': 'tweak:reset-game-dvr',
    'win32-priority': 'tweak:reset-win32-priority',
  };

  const checkMap: { [key: string]: string } = {
    'irq-priority': 'tweak:check-irq-priority',
    'network-interrupts': 'tweak:check-network-interrupts',
    'gpu-scheduling': 'tweak:check-gpu-scheduling',
    'fullscreen-optimization': 'tweak:check-fullscreen-optimization',
    'usb-suspend': 'tweak:check-usb-suspend',
    'game-dvr': 'tweak:check-game-dvr',
    'win32-priority': 'tweak:check-win32-priority',
  };

  // Check tweak status on mount and when window gains focus
  useEffect(() => {
    let mounted = true;

    const setChecking = (id: string, loading: boolean) => {
      setTweakChecks(prev => ({ ...prev, [id]: { ...(prev[id] || {}), loading } }));
    };

    const runChecks = async () => {
      const entries = Object.entries(checkMap);
      // mark all as loading
      const initial: any = {};
      for (const [tweakId] of entries) initial[tweakId] = { loading: true };
      setTweakChecks(prev => ({ ...prev, ...initial }));

      // run checks in parallel
      const promises = entries.map(async ([tweakId, channel]) => {
        try {
          const result = await window.electron!.ipcRenderer.invoke(channel);
          if (!mounted) return;
          setTweakChecks(prev => ({ ...prev, [tweakId]: { loading: false, applied: !!result.applied, exists: !!result.exists, value: result.value ?? null } }));
          setEnabledTweaks(prev => ({ ...prev, [tweakId]: !!result.applied }));
        } catch (err) {
          if (!mounted) return;
          setTweakChecks(prev => ({ ...prev, [tweakId]: { loading: false, applied: false, exists: false, error: err instanceof Error ? err.message : String(err) } }));
          setEnabledTweaks(prev => ({ ...prev, [tweakId]: false }));
        }
      });

      await Promise.all(promises);
    };

    // initial run
    runChecks();

    const onFocus = () => runChecks();
    window.addEventListener('focus', onFocus);

    return () => {
      mounted = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleApplyTweak = async (id: string) => {
    setApplyingId(id);
    try {
      // Apply tweak
      const channel = tweakMap[id];
      if (window.electron?.ipcRenderer && channel) {
        const result: any = await window.electron.ipcRenderer.invoke(channel);
        if (result.success) {
          addToast(result.message, 'success');
          // Check status after applying
          const checkChannel = checkMap[id];
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
      const channel = resetMap[id];
      if (window.electron?.ipcRenderer && channel) {
        const result: any = await window.electron.ipcRenderer.invoke(channel);
        if (result.success) {
          addToast(result.message, 'success');
          await new Promise(resolve => setTimeout(resolve, 500));
          // Force Win32 Priority to not applied after reset
          if (id === 'win32-priority') {
            setEnabledTweaks(prev => ({ ...prev, [id]: false }));
          } else {
            const checkChannel = checkMap[id];
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

  const appliedCount = Object.values(enabledTweaks).filter(Boolean).length;
  const totalCount = performanceTweaks.length;

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
            <button
              className="perf-action-btn perf-action-refresh"
              onClick={() => { addToast('Scanning tweak status...', 'info'); runChecksOnDemand(); }}
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              <span>Scan Status</span>
            </button>
          </div>
        }
      />

      {/* Tweaks Grid */}
      <div className="perf-tweaks-grid">
        {performanceTweaks.map((tweak, index) => (
          <motion.div
            key={tweak.id}
            initial={{ y: 30, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.08, type: 'spring', stiffness: 200, damping: 20 }}
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
              isChecking={!!tweakChecks[tweak.id]?.loading}
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default React.memo(Performance);

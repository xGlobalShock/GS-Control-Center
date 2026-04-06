import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CleanerCard from '../components/CleanerCard';
import { cleanerUtilities } from '../data/cleanerUtilities';
import { useToast } from '../contexts/ToastContext';
import CacheCleanupToast from '../components/CacheCleanupToast';
import PageHeader from '../components/PageHeader';
import SystemRepairPanel from '../components/SystemRepairPanel';
import { Monitor, Gamepad2, Wrench, Cpu, Sparkles, SlidersHorizontal } from 'lucide-react';
import '../styles/Cleaner.css';
import ProPreviewBanner from '../components/ProPreviewBanner';
import ProLockedWrapper from '../components/ProLockedWrapper';
import { useAuth } from '../contexts/AuthContext';

interface CleanResult {
  success: boolean;
  message: string;
  spaceSaved: string;
  filesDeleted?: number;
  filesBefore?: number;
  filesAfter?: number;
  details?: string;
}

const Cleaner: React.FC = () => {
  const [cleaningId, setCleaningId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<'windows' | 'games' | 'nvidia' | 'repair'>('windows');
  const { addToast } = useToast();
  const { isPro } = useAuth();

  const handleShowClearAllToast = () => {
    const k = Math.random().toString(36).substring(2, 11);
    const windowsIds = utilityTabs.windows.map((u) => u.id).filter(id => id !== 'recent-files');
    addToast(<CacheCleanupToast toastKey={k} windowsIds={windowsIds} />, 'info', 0);
  };

  const cleanerMap: { [key: string]: string } = {
    'nvidia-cache': 'cleaner:clear-nvidia-cache',
    'apex-shaders': 'cleaner:clear-apex-shaders',
    'forza-shaders': 'cleaner:clear-forza-shaders',
    'cod-shaders': 'cleaner:clear-cod-shaders',
    'cs2-shaders': 'cleaner:clear-cs2-shaders',
    'fortnite-shaders': 'cleaner:clear-fortnite-shaders',
    'lol-shaders': 'cleaner:clear-lol-shaders',
    'overwatch-shaders': 'cleaner:clear-overwatch-shaders',
    'r6-shaders': 'cleaner:clear-r6-shaders',
    'rocket-league-shaders': 'cleaner:clear-rocket-league-shaders',
    'valorant-shaders': 'cleaner:clear-valorant-shaders',
    'temp-files': 'cleaner:clear-temp-files',
    'update-cache': 'cleaner:clear-update-cache',
    'dns-cache': 'cleaner:clear-dns-cache',
    'ram-cache': 'cleaner:clear-ram-cache',
    'recycle-bin': 'cleaner:empty-recycle-bin',
    'windows-temp': 'cleaner:clear-windows-temp',
    'thumbnail-cache': 'cleaner:clear-thumbnail-cache',
    'windows-logs': 'cleaner:clear-windows-logs',
    'crash-dumps': 'cleaner:clear-crash-dumps',
    'error-reports': 'cleaner:clear-error-reports',
    'delivery-optimization': 'cleaner:clear-delivery-optimization',
    'recent-files': 'cleaner:clear-recent-files',
  };

  // Categorize utilities by category
  const utilityTabs = {
    windows: cleanerUtilities.filter(u => ['windows-temp', 'thumbnail-cache', 'windows-logs', 'crash-dumps', 'error-reports', 'delivery-optimization', 'recent-files', 'temp-files', 'update-cache', 'dns-cache', 'ram-cache', 'recycle-bin'].includes(u.id)),
    games: cleanerUtilities.filter(u => ['forza-shaders', 'apex-shaders', 'cod-shaders', 'cs2-shaders', 'fortnite-shaders', 'lol-shaders', 'overwatch-shaders', 'r6-shaders', 'rocket-league-shaders', 'valorant-shaders'].includes(u.id)),
    nvidia: cleanerUtilities.filter(u => ['nvidia-cache'].includes(u.id)),
  };

  const categories = [
    {
      id: 'windows' as const,
      label: 'Windows Cache',
      icon: <Monitor size={18} />,
      count: utilityTabs.windows.length,
      description: 'Clear temp files, DNS cache, logs, crash dumps and system junk.',
      accent: '#00F2FF',
    },
    {
      id: 'games' as const,
      label: 'Game Shaders',
      icon: <Gamepad2 size={18} />,
      count: utilityTabs.games.length,
      description: 'Remove game shader caches for smoother performance.',
      accent: '#00F2FF',
    },
    {
      id: 'nvidia' as const,
      label: 'NVIDIA Cache',
      icon: <Cpu size={18} />,
      count: utilityTabs.nvidia.length,
      description: 'Clear NVIDIA driver artifacts and shader cache.',
      accent: '#76B900',
    },
    {
      id: 'repair' as const,
      label: 'System Repair',
      icon: <Wrench size={18} />,
      count: 3,
      description: 'Run ChkDsk, SFC and DISM to fix corrupted files and disk errors.',
      accent: '#FF9500',
    },
  ];

  const handleClean = async (id: string) => {
    setCleaningId(id);
    try {
      const channel = cleanerMap[id];
      if (window.electron?.ipcRenderer && channel) {
        const result: CleanResult = await window.electron.ipcRenderer.invoke(channel);
        
        if (result.success) {
          const filesText = result.filesDeleted !== undefined ? `${result.filesDeleted} file${result.filesDeleted !== 1 ? 's' : ''}` : null;
          const sizeText = result.spaceSaved ? result.spaceSaved : null;

          const dnsMatch = typeof result.spaceSaved === 'string' ? result.spaceSaved.match(/(\d+)\s*DNS entries removed/i) : null;
          const mbMatch = typeof result.spaceSaved === 'string' ? result.spaceSaved.match(/(\d+(?:\.\d+)?)\s*(MB|GB|KB)/i) : null;

          const normalizedSizeText = (() => {
            if (!sizeText || !mbMatch) return sizeText;
            const value = Number(mbMatch[1]);
            const unit = mbMatch[2].toUpperCase();
            if (unit === 'MB' && value >= 1000) {
              return `${(value / 1024).toFixed(2)} GB`;
            }
            if (unit === 'KB') {
              return `${value.toFixed(0)} KB`;
            }
            if (unit === 'GB') {
              return `${value.toFixed(2)} GB`;
            }
            return `${value.toFixed(2)} ${unit}`;
          })();

        if (filesText && mbMatch) {
          addToast(
            <span>
              Successfully removed <strong className="toast-highlight">{filesText}</strong>, freeing{' '}
              <strong className="toast-highlight">{normalizedSizeText}</strong>
            </span>,
            'success'
          );
        } else if (filesText && normalizedSizeText) {
          addToast(
            <span>
              Successfully removed <strong className="toast-highlight">{filesText}</strong>
              {normalizedSizeText ? <> (saved <strong className="toast-highlight">{normalizedSizeText}</strong>)</> : ''}
            </span>,
            'success'
          );
        } else if (dnsMatch) {
          addToast(
            <span>
              Successfully removed <strong className="toast-highlight">{dnsMatch[1]} DNS entries</strong>
            </span>,
            'success'
          );
        } else if (typeof result.spaceSaved === 'string' && /disk space (now )?freed/i.test(result.spaceSaved)) {
          addToast(result.message || 'Recycle bin emptied successfully', 'success');
        } else if (normalizedSizeText) {
          if (/standby list cleared successfully/i.test(result.message || '')) {
            addToast(
              <span>
                Purged <strong className="toast-highlight">{normalizedSizeText}</strong> of cached memory
              </span>,
              'success'
            );
          } else {
            addToast(
              <span>
                Successfully freed <strong className="toast-highlight">{normalizedSizeText}</strong>
              </span>,
              'success'
            );
          }
        } else {
          const message = result.message || 'Cleanup complete';
          addToast(message, 'success');
        }
        } else {
          addToast(result.message || 'Cleanup failed', 'error');
        }
      } else {
        addToast('IPC not available', 'error');
      }
    } catch (error) {
      addToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      // Keep the loading state for 2 seconds to show feedback
      setTimeout(() => {
        setCleaningId(null);
      }, 2000);
    }
  };

  return (
    <motion.div
      className="cleaner-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <PageHeader icon={<SlidersHorizontal size={16} strokeWidth={3} />} title="Utilities" />

      <ProPreviewBanner pageName="Utilities" />

      {isPro && activeCategory === 'windows' && (
        <button className="cleaner-clearall-btn" onClick={handleShowClearAllToast}>
          <Sparkles size={13} fill="currentColor" strokeWidth={0} />
          Full Cache Cleanup
        </button>
      )}

      <ProLockedWrapper featureName="Utilities" message="PRO Feature">

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
              {activeCategory === 'repair' ? (
                <SystemRepairPanel />
              ) : (
                <div className="cleaner-grid cleaner-grid--small">
                  {utilityTabs[activeCategory as 'windows' | 'games' | 'nvidia'].map((utility, index) => (
                    <motion.div
                      key={utility.id}
                      initial={{ y: 20, opacity: 0, scale: 0.97 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05, type: 'spring', stiffness: 200, damping: 22 }}
                    >
                      <CleanerCard
                        id={utility.id}
                        title={utility.title}
                        icon={utility.icon}
                        cacheType={utility.cacheType}
                        description={utility.description}
                        buttonText={utility.buttonText}
                        color={utility.color}
                        onClean={handleClean}
                        isLoading={cleaningId === utility.id}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      </ProLockedWrapper>
    </motion.div>
  );
};

export default React.memo(Cleaner);


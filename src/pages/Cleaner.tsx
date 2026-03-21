import React, { useState } from 'react';
import { motion } from 'framer-motion';
import CleanerCard from '../components/CleanerCard';
import { cleanerUtilities } from '../data/cleanerUtilities';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import { Trash2 } from 'lucide-react';
import '../styles/Cleaner.css';

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
  const [activeTab, setActiveTab] = useState<'windows' | 'games' | 'nvidia'>('windows');
  const { addToast } = useToast();

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

  // Categorize utilities by tab
  const utilityTabs = {
    windows: cleanerUtilities.filter(u => ['windows-temp', 'thumbnail-cache', 'windows-logs', 'crash-dumps', 'error-reports', 'delivery-optimization', 'recent-files', 'temp-files', 'update-cache', 'dns-cache', 'ram-cache', 'recycle-bin'].includes(u.id)),
    games: cleanerUtilities.filter(u => ['forza-shaders', 'apex-shaders', 'cod-shaders', 'cs2-shaders', 'fortnite-shaders', 'lol-shaders', 'overwatch-shaders', 'r6-shaders', 'rocket-league-shaders', 'valorant-shaders'].includes(u.id)),
    nvidia: cleanerUtilities.filter(u => ['nvidia-cache'].includes(u.id)),
  };

  const tabs = [
    { id: 'windows', label: 'Windows Cache', count: utilityTabs.windows.length },
    { id: 'games', label: 'Games Cache', count: utilityTabs.games.length },
    { id: 'nvidia', label: 'NVIDIA Cache', count: utilityTabs.nvidia.length },
  ];

  const tabDescriptions: { [key in 'windows' | 'games' | 'nvidia']: React.ReactNode } = {
    windows: (
      <>
        <strong>Windows Cache:</strong> clears out <strong>leftover temporary files</strong> and <strong>system junk</strong> from Windows and installed apps.
      </>
    ),
    games: (
      <>
        Remove <strong>temporary game data caches</strong> to help keep games running smoothly.
      </>
    ),
    nvidia: (
      <>
        Clear <strong>NVIDIA driver caches</strong> to resolve graphics hiccups.
      </>
    ),
  };

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
      <PageHeader icon={<Trash2 size={16} />} title="Cleanup Toolkit" />

      {/* Tab Navigation + description */}
      <div className="cleaner-tabs-container">
        <div className="cleaner-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`cleaner-tab ${activeTab === tab.id ? 'cleaner-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id as any)}
            >
              <span className="cleaner-tab-label">{tab.label}</span>
              <span className="cleaner-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="cleaner-tab-desc">{tabDescriptions[activeTab]}</div>
      </div>

      {/* Cards grid */}
      <div className="cleaner-grid cleaner-grid--small">
        {utilityTabs[activeTab].map((utility, index) => (
          <motion.div
            key={utility.id}
            initial={{ y: 25, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.06, type: 'spring', stiffness: 200, damping: 22 }}
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
    </motion.div>
  );
};

export default React.memo(Cleaner);

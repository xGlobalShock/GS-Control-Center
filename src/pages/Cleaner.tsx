import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CleanerCard from '../components/CleanerCard';
import { cleanerUtilities } from '../data/cleanerUtilities';
import { useToast } from '../contexts/ToastContext';
import CacheCleanupToast from '../components/CacheCleanupToast';
import PageHeader from '../components/PageHeader';
import SystemRepairPanel from '../components/SystemRepairPanel';
import { Monitor, Gamepad2, Wrench, Cpu, Sparkles, SlidersHorizontal, Crown } from 'lucide-react';
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
  const [activeCategory, setActiveCategory] = useState<'windows' | 'games' | 'nvidia' | 'repair' | 'essential' | 'preferences'>('windows');
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
    'revert-startmenu': 'tweak:apply-revert-startmenu',
  };

  // Categorize utilities by category
  const utilityTabs = {
    windows: cleanerUtilities.filter(u => ['windows-temp', 'thumbnail-cache', 'windows-logs', 'crash-dumps', 'error-reports', 'delivery-optimization', 'recent-files', 'temp-files', 'update-cache', 'dns-cache', 'ram-cache', 'recycle-bin'].includes(u.id)),
    games: cleanerUtilities.filter(u => ['forza-shaders', 'apex-shaders', 'cod-shaders', 'cs2-shaders', 'fortnite-shaders', 'lol-shaders', 'overwatch-shaders', 'r6-shaders', 'rocket-league-shaders', 'valorant-shaders'].includes(u.id)),
    nvidia: cleanerUtilities.filter(u => ['nvidia-cache'].includes(u.id)),
    essential: cleanerUtilities.filter(u => ['revert-startmenu'].includes(u.id)),
    preferences: [],
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
      id: 'essential' as const,
      label: 'Essential Tweaks',
      icon: <Sparkles size={18} />,
      count: utilityTabs.essential.length,
      description: 'Important small tweaks and fixes for common Windows annoyances.',
      accent: '#8B5CF6',
      premium: true,
    },
    {
      id: 'preferences' as const,
      label: 'Preferences',
      icon: <SlidersHorizontal size={18} />,
      count: 5,
      description: 'Quick preference toggles: mouse, start recommendations, settings, Bing, theme.',
      accent: '#00F2FF',
    },
    {
      id: 'games' as const,
      label: 'Game Shaders',
      icon: <Gamepad2 size={18} />,
      count: utilityTabs.games.length,
      description: 'Remove game shader caches for smoother performance.',
      accent: '#00F2FF',
      premium: true,
    },
    {
      id: 'nvidia' as const,
      label: 'NVIDIA Cache',
      icon: <Cpu size={18} />,
      count: utilityTabs.nvidia.length,
      description: 'Clear NVIDIA driver artifacts and shader cache.',
      accent: '#76B900',
      premium: true,
    },
    {
      id: 'repair' as const,
      label: 'System Repair',
      icon: <Wrench size={18} />,
      count: 3,
      description: 'Run ChkDsk, SFC and DISM to fix corrupted files and disk errors.',
      accent: '#FF9500',
      premium: true,
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

  // Preferences state and handlers
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [mouseEnabled, setMouseEnabled] = useState<boolean | null>(null);
  const [mouseLoading, setMouseLoading] = useState(false);
  const [startRecEnabled, setStartRecEnabled] = useState<boolean | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [settingsHomeEnabled, setSettingsHomeEnabled] = useState<boolean | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [bingEnabled, setBingEnabled] = useState<boolean | null>(null);
  const [bingLoading, setBingLoading] = useState(false);
  const [darkEnabled, setDarkEnabled] = useState<boolean | null>(null);
  const [darkLoading, setDarkLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setPrefsLoading(true);
      try {
        if (!window.electron?.ipcRenderer) return;
        const [mouseRes, startRes, settingsRes, bingRes, darkRes] = await Promise.all([
          window.electron.ipcRenderer.invoke('pref:check-mouse-acceleration'),
          window.electron.ipcRenderer.invoke('pref:check-startmenu-recommendations'),
          window.electron.ipcRenderer.invoke('pref:check-settings-home'),
          window.electron.ipcRenderer.invoke('pref:check-bing-search'),
          window.electron.ipcRenderer.invoke('pref:check-dark-theme'),
        ]);
        if (!mounted) return;
        setMouseEnabled(!!(mouseRes && mouseRes.applied));
        setStartRecEnabled(!!(startRes && startRes.applied));
        setSettingsHomeEnabled(!!(settingsRes && settingsRes.value === 'show:home'));
        setBingEnabled(!!(bingRes && bingRes.value === 0));
        setDarkEnabled(!!(darkRes && darkRes.applied));
      } catch (e) {
        addToast('Failed to load preferences', 'error');
      } finally {
        if (mounted) setPrefsLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const applyPref = async (channel: string, value: any, setLoading: (v:boolean)=>void, setState: (v:boolean|null)=>void, successMsg?: string) => {
    setLoading(true);
    try {
      if (!window.electron?.ipcRenderer) { addToast('IPC not available', 'error'); return; }
      const res = await window.electron.ipcRenderer.invoke(channel, value);
      if (res && res.success) {
        if (typeof res.applied === 'boolean') {
          setState(res.applied);
        } else if (res.value && typeof (res.value as any).MouseSpeed !== 'undefined') {
          try {
            const v = res.value as any;
            const parsedApplied = !!(v.MouseSpeed === 1 && v.MouseThreshold1 === 0 && v.MouseThreshold2 === 0);
            setState(parsedApplied);
          } catch {
            setState(!!value);
          }
        } else {
          setState(!!value);
        }
        addToast(res.message || successMsg || 'Preference updated', 'success');
      } else {
        addToast(res?.message || 'Failed to update preference', 'error');
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err || 'Error updating preference');
      console.error('[Cleaner] applyPref error:', channel, err);
      addToast(msg || 'Error updating preference', 'error');
    } finally {
      setLoading(false);
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

      {activeCategory !== 'windows' && <ProPreviewBanner pageName="Utilities" />}

      {isPro && activeCategory === 'windows' && (
        <button className="cleaner-clearall-btn" onClick={handleShowClearAllToast}>
          <Sparkles size={13} fill="currentColor" strokeWidth={0} />
          Full Cache Cleanup
        </button>
      )}

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
                <span className="cleaner-navitem-label">
                  {cat.label}
                  {(cat as any).premium && !isPro && (
                    <span className="nav-pro-pill"><Crown size={8} />PRO</span>
                  )}
                </span>
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
              {activeCategory === 'windows' ? (
                <div className="cleaner-grid cleaner-grid--small">
                  {utilityTabs.windows.map((utility, index) => (
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
              ) : activeCategory === 'preferences' ? (
                <div className="cleaner-grid cleaner-grid--small cleaner-grid--prefs">
                  {[
                    {
                      id: 'start-rec',
                      title: 'Remove Pinned Apps from Start',
                      desc: 'Toggle Start menu recommendations to quickly unpin unwanted apps and declutter your Start menu.',
                      onClick: () => applyPref('pref:apply-startmenu-recommendations', !startRecEnabled, setStartLoading, setStartRecEnabled, 'Start menu recommendations updated'),
                      enabled: startRecEnabled,
                      loading: startLoading,
                      icon: <Sparkles size={28} />,
                    },
                    {
                      id: 'bing-search',
                      title: 'Bing Search in Start Menu',
                      desc: 'Toggle Bing web search results in the Start menu to speed up search performance and reduce distractions when looking for local files and apps.',
                      onClick: () => applyPref('pref:apply-bing-search', !bingEnabled, setBingLoading, setBingEnabled, 'Bing search preference updated'),
                      enabled: bingEnabled,
                      loading: bingLoading,
                      icon: <Wrench size={28} />,
                    },
                    {
                      id: 'dark-theme',
                      title: 'Dark Theme for Windows',
                      desc: 'Toggle dark (Apps/System) theme via registry keys.',
                      onClick: () => applyPref('pref:apply-dark-theme', !darkEnabled, setDarkLoading, setDarkEnabled, 'Theme preference updated'),
                      enabled: darkEnabled,
                      loading: darkLoading,
                      icon: <Sparkles size={28} />,
                    },
                  ].map((pref, index) => (
                    <motion.div
                      key={pref.id}
                      initial={{ y: 20, opacity: 0, scale: 0.97 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05, type: 'spring', stiffness: 200, damping: 22 }}
                    >
                      <div className="cleaner-pref-card">
                        <div className="cleaner-pref-icon">{pref.icon}</div>
                        <div className="cleaner-pref-body">
                          <div className="cleaner-pref-title">{pref.title}</div>
                          <div className="cleaner-pref-desc">{pref.desc}</div>
                        </div>
                        <div className="cleaner-pref-meta">
                          <button
                            className={`futuristic-toggle gl-profile__preset-toggle ${pref.enabled ? 'gl-profile__preset-toggle--on' : ''}`}
                            onClick={pref.onClick}
                            disabled={pref.loading || prefsLoading}
                            aria-pressed={pref.enabled ? 'true' : 'false'}
                          >
                            <div className="gl-profile__preset-toggle-track"><div className="gl-profile__preset-toggle-thumb" /></div>
                            <span className="gl-profile__preset-toggle-label">{pref.enabled ? 'ON' : 'OFF'}</span>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : activeCategory === 'repair' ? (
                <ProLockedWrapper featureName="Utilities" message="PRO Feature">
                  <SystemRepairPanel />
                </ProLockedWrapper>
              ) : activeCategory === 'games' ? (
                <ProLockedWrapper featureName="Utilities" message="PRO Feature">
                  <div className="cleaner-grid cleaner-grid--small">
                    {utilityTabs.games.map((utility, index) => (
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
                </ProLockedWrapper>
              ) : (
                <ProLockedWrapper featureName="Utilities" message="PRO Feature">
                  <div className="cleaner-grid cleaner-grid--small">
                    {utilityTabs[activeCategory as 'nvidia'].map((utility, index) => (
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
                </ProLockedWrapper>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(Cleaner);


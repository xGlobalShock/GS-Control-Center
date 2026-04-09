import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CleanerCard from '../components/CleanerCard';
import { cleanerUtilities } from '../data/cleanerUtilities';
import { useToast } from '../contexts/ToastContext';
import CacheCleanupToast from '../components/CacheCleanupToast';
import PageHeader from '../components/PageHeader';
import SystemRepairPanel from '../components/SystemRepairPanel';
import TweakExecutionModal from '../components/TweakExecutionModal';
import { Monitor, ShieldAlert, Info, Loader2, Gamepad2, Settings, Server, Box, Globe, Wrench, Shield, Trash2, Zap, LayoutDashboard, Search, EyeOff, X, Cpu, Sparkles, SlidersHorizontal, Crown, Check, Download, Square, CheckSquare } from 'lucide-react';
import '../styles/Cleaner.css';
import '../styles/AppInstaller.css';
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
  const [activeCategory, setActiveCategory] = useState<'windows' | 'games' | 'nvidia' | 'repair' | 'preferences' | 'essential'>('windows');
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
    'revert-startmenu': 'pref:apply-revert-startmenu',
  };

  // Categorize utilities by category
  const utilityTabs = {
    windows: cleanerUtilities.filter(u => ['windows-temp', 'thumbnail-cache', 'windows-logs', 'crash-dumps', 'error-reports', 'delivery-optimization', 'recent-files', 'temp-files', 'update-cache', 'dns-cache', 'ram-cache', 'recycle-bin'].includes(u.id)),
    essential: cleanerUtilities.filter(u => u.id.startsWith('ct-tweak:') || (u.id === 'revert-startmenu' || !['windows-temp', 'thumbnail-cache', 'windows-logs', 'crash-dumps', 'error-reports', 'delivery-optimization', 'recent-files', 'temp-files', 'update-cache', 'dns-cache', 'ram-cache', 'recycle-bin', 'forza-shaders', 'apex-shaders', 'cod-shaders', 'cs2-shaders', 'fortnite-shaders', 'lol-shaders', 'overwatch-shaders', 'r6-shaders', 'rocket-league-shaders', 'valorant-shaders', 'nvidia-cache'].includes(u.id))),
    games: cleanerUtilities.filter(u => ['forza-shaders', 'apex-shaders', 'cod-shaders', 'cs2-shaders', 'fortnite-shaders', 'lol-shaders', 'overwatch-shaders', 'r6-shaders', 'rocket-league-shaders', 'valorant-shaders'].includes(u.id)),
    nvidia: cleanerUtilities.filter(u => ['nvidia-cache'].includes(u.id)),
  };

  

  const [activeTweakModalId, setActiveTweakModalId] = useState<string | null>(null);
  const [selectedTweaks, setSelectedTweaks] = useState<Set<string>>(new Set());
  const [isBatchTweaking, setIsBatchTweaking] = useState(false);
  const cancelBatchRef = useRef(false);

  // Allow toggling of essential tweaks
  const toggleTweakSelection = (id: string) => {
    setSelectedTweaks(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleApplySelectedTweaks = async () => {
    if (selectedTweaks.size === 0) return;
    setIsBatchTweaking(true);
    cancelBatchRef.current = false;
    
    // Convert to array of IDs
    const queue = Array.from(selectedTweaks);
    
    for (const id of queue) {
      if (cancelBatchRef.current) break; // User closed modal or cancelled
      
      setActiveTweakModalId(id.replace('ct-tweak:', ''));
      setCleaningId(id);
      try {
        const channel = cleanerMap[id] || id;
        await window.electron?.ipcRenderer.invoke(channel);
      } catch (error) {
        addToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
      
      setCleaningId(null);
      // Remove it from selected exactly as it finishes so UI updates live
      setSelectedTweaks(prev => { const n = new Set(prev); n.delete(id); return n; });
      
      // Pause so user can see "Done!" log
      if (!cancelBatchRef.current) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    setIsBatchTweaking(false);
    if (!cancelBatchRef.current) {
      setActiveTweakModalId(null);
      addToast('Batch tweaks applied successfully!', 'success');
    }
  };

  const handleClean = async (id: string) => {
    setCleaningId(id);

    if (id.startsWith('ct-tweak:')) {
      setActiveTweakModalId(id.replace('ct-tweak:', ''));
      cancelBatchRef.current = false;
      try {
        await window.electron?.ipcRenderer.invoke(id);
      } catch (error) {
        addToast(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      } finally {
        setTimeout(() => setCleaningId(null), 1000);
      }
      return;
    }

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
  const [revertStartMenuEnabled, setRevertStartMenuEnabled] = useState<boolean | null>(null);
  const [revertLoading, setRevertLoading] = useState(false);
  const [centerTaskbarEnabled, setCenterTaskbarEnabled] = useState<boolean | null>(null);
  const [centerTaskbarLoading, setCenterTaskbarLoading] = useState(false);
  const [crossDeviceEnabled, setCrossDeviceEnabled] = useState<boolean | null>(null);
  const [crossDeviceLoading, setCrossDeviceLoading] = useState(false);
  const [detailedBsodEnabled, setDetailedBsodEnabled] = useState<boolean | null>(null);
  const [detailedBsodLoading, setDetailedBsodLoading] = useState(false);
  const [mpoEnabled, setMpoEnabled] = useState<boolean | null>(null);
  const [mpoLoading, setMpoLoading] = useState(false);
  const [modernStandbyEnabled, setModernStandbyEnabled] = useState<boolean | null>(null);
  const [modernStandbyLoading, setModernStandbyLoading] = useState(false);
  const [newOutlookEnabled, setNewOutlookEnabled] = useState<boolean | null>(null);
  const [newOutlookLoading, setNewOutlookLoading] = useState(false);
  const [numlockEnabled, setNumlockEnabled] = useState<boolean | null>(null);
  const [numlockLoading, setNumlockLoading] = useState(false);
  const [searchTaskbarEnabled, setSearchTaskbarEnabled] = useState<boolean | null>(null);
  const [searchTaskbarLoading, setSearchTaskbarLoading] = useState(false);
  const [showExtensionsEnabled, setShowExtensionsEnabled] = useState<boolean | null>(null);
  const [showExtensionsLoading, setShowExtensionsLoading] = useState(false);
  const [showHiddenEnabled, setShowHiddenEnabled] = useState<boolean | null>(null);
  const [showHiddenLoading, setShowHiddenLoading] = useState(false);
  const [stickyKeysEnabled, setStickyKeysEnabled] = useState<boolean | null>(null);
  const [stickyKeysLoading, setStickyKeysLoading] = useState(false);
  const [taskViewEnabled, setTaskViewEnabled] = useState<boolean | null>(null);
  const [taskViewLoading, setTaskViewLoading] = useState(false);
  const [verboseLogonEnabled, setVerboseLogonEnabled] = useState<boolean | null>(null);
  const [verboseLogonLoading, setVerboseLogonLoading] = useState(false);

  // Preference items (built after state declarations so they reflect current state)
  const preferenceItems = [
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
    {
      id: 'center-taskbar',
      title: 'Center Taskbar Items',
      desc: 'Align taskbar items to the center or back to the left (Windows 11).',
      onClick: () => applyPref('pref:apply-center-taskbar', !centerTaskbarEnabled, setCenterTaskbarLoading, setCenterTaskbarEnabled, 'Taskbar alignment updated'),
      enabled: centerTaskbarEnabled,
      loading: centerTaskbarLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'cross-device',
      title: 'Cross-Device Resume',
      desc: 'Enable Activity Feed to resume actions across devices.',
      onClick: () => applyPref('pref:apply-cross-device', !crossDeviceEnabled, setCrossDeviceLoading, setCrossDeviceEnabled, 'Cross-Device resume updated'),
      enabled: crossDeviceEnabled,
      loading: crossDeviceLoading,
      icon: <Sparkles size={28} />,
    },
    {
      id: 'detailed-bsod',
      title: 'Detailed BSoD',
      desc: 'Show technical details automatically when Windows crashes.',
      onClick: () => applyPref('pref:apply-detailed-bsod', !detailedBsodEnabled, setDetailedBsodLoading, setDetailedBsodEnabled, 'Detailed BSoD updated'),
      enabled: detailedBsodEnabled,
      loading: detailedBsodLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'mpo',
      title: 'Disable Multiplane Overlay',
      desc: 'Toggle MPO. Disabling can fix screen stuttering or black screens on some NVIDIA/AMD GPUs.',
      onClick: () => applyPref('pref:apply-mpo', !mpoEnabled, setMpoLoading, setMpoEnabled, 'MPO setting updated'),
      enabled: mpoEnabled,
      loading: mpoLoading,
      icon: <Gamepad2 size={28} />,
    },
    {
      id: 'modern-standby',
      title: 'Modern Standby fix',
      desc: 'Disable Connected Standby to prevent battery drain while computer is asleep.',
      onClick: () => applyPref('pref:apply-modern-standby', !modernStandbyEnabled, setModernStandbyLoading, setModernStandbyEnabled, 'Modern Standby/S3 setting updated'),
      enabled: modernStandbyEnabled,
      loading: modernStandbyLoading,
      icon: <Sparkles size={28} />,
    },
    {
      id: 'new-outlook',
      title: 'New Outlook',
      desc: 'Show or hide the "Try New Outlook" toggle within Mail.',
      onClick: () => applyPref('pref:apply-new-outlook', !newOutlookEnabled, setNewOutlookLoading, setNewOutlookEnabled, 'New Outlook setting updated'),
      enabled: newOutlookEnabled,
      loading: newOutlookLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'numlock',
      title: 'Num Lock on Startup',
      desc: 'Enable Num Lock automatically when you boot your PC.',
      onClick: () => applyPref('pref:apply-numlock', !numlockEnabled, setNumlockLoading, setNumlockEnabled, 'Num Lock setup updated'),
      enabled: numlockEnabled,
      loading: numlockLoading,
      icon: <Sparkles size={28} />,
    },
    {
      id: 'search-taskbar',
      title: 'Search Button in Taskbar',
      desc: 'Toggle the search box style on your Windows taskbar.',
      onClick: () => applyPref('pref:apply-search-taskbar', !searchTaskbarEnabled, setSearchTaskbarLoading, setSearchTaskbarEnabled, 'Search button setting updated'),
      enabled: searchTaskbarEnabled,
      loading: searchTaskbarLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'show-extensions',
      title: 'Show File Extensions',
      desc: 'Show file type extensions (e.g., .txt, .exe) natively in file explorer.',
      onClick: () => applyPref('pref:apply-show-extensions', !showExtensionsEnabled, setShowExtensionsLoading, setShowExtensionsEnabled, 'File extensions setting updated'),
      enabled: showExtensionsEnabled,
      loading: showExtensionsLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'show-hidden',
      title: 'Show Hidden Files',
      desc: 'Reveal hidden files, folders, and drives in Explorer.',
      onClick: () => applyPref('pref:apply-show-hidden', !showHiddenEnabled, setShowHiddenLoading, setShowHiddenEnabled, 'Hidden files setting updated'),
      enabled: showHiddenEnabled,
      loading: showHiddenLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'sticky-keys',
      title: 'Sticky Keys',
      desc: 'Toggle Sticky Keys, letting you use Shift, Ctrl, Alt, or Windows Logo keys by pressing one key at a time.',
      onClick: () => applyPref('pref:apply-sticky-keys', !stickyKeysEnabled, setStickyKeysLoading, setStickyKeysEnabled, 'Sticky Keys setting updated'),
      enabled: stickyKeysEnabled,
      loading: stickyKeysLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'task-view',
      title: 'Task View Button in Taskbar',
      desc: 'Show or hide the Task View timeline button.',
      onClick: () => applyPref('pref:apply-task-view', !taskViewEnabled, setTaskViewLoading, setTaskViewEnabled, 'Task view button setting updated'),
      enabled: taskViewEnabled,
      loading: taskViewLoading,
      icon: <Wrench size={28} />,
    },
    {
      id: 'verbose-logon',
      title: 'Verbose Messages During Logon',
      desc: 'Display highly detailed status messages during startup, shutdown, and logon.',
      onClick: () => applyPref('pref:apply-verbose-logon', !verboseLogonEnabled, setVerboseLogonLoading, setVerboseLogonEnabled, 'Verbose logon messages updated'),
      enabled: verboseLogonEnabled,
      loading: verboseLogonLoading,
      icon: <Wrench size={28} />,
    },
  ];

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
      label: 'Games Shaders',
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
    {
      id: 'essential' as const,
      label: 'Win Tweaks',
      icon: <Settings size={18} />,
      count: utilityTabs.essential.length,
      description: 'System-level tweaks and modifications.',
      accent: '#3b82f6',
    },
    {
      id: 'preferences' as const,
      label: 'Win Preferences',
      icon: <SlidersHorizontal size={18} />,
      count: preferenceItems.length,
      description: 'Quick preference toggles for common system settings.',
      accent: '#00F2FF',
    },
  ];


  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setPrefsLoading(true);
      try {
        if (!window.electron?.ipcRenderer) return;
        const [mouseRes, startRes, settingsRes, bingRes, darkRes, revertRes, res0, res1, res2, res3, res4, res5, res6, res7, res8, res9, res10, res11, res12] = await Promise.all([
          window.electron.ipcRenderer.invoke('pref:check-mouse-acceleration'),
          window.electron.ipcRenderer.invoke('pref:check-startmenu-recommendations'),
          window.electron.ipcRenderer.invoke('pref:check-settings-home'),
          window.electron.ipcRenderer.invoke('pref:check-bing-search'),
          window.electron.ipcRenderer.invoke('pref:check-dark-theme'),
          window.electron.ipcRenderer.invoke('pref:check-revert-startmenu'),
          window.electron.ipcRenderer.invoke('pref:check-center-taskbar'),
          window.electron.ipcRenderer.invoke('pref:check-cross-device'),
          window.electron.ipcRenderer.invoke('pref:check-detailed-bsod'),
          window.electron.ipcRenderer.invoke('pref:check-mpo'),
          window.electron.ipcRenderer.invoke('pref:check-modern-standby'),
          window.electron.ipcRenderer.invoke('pref:check-new-outlook'),
          window.electron.ipcRenderer.invoke('pref:check-numlock'),
          window.electron.ipcRenderer.invoke('pref:check-search-taskbar'),
          window.electron.ipcRenderer.invoke('pref:check-show-extensions'),
          window.electron.ipcRenderer.invoke('pref:check-show-hidden'),
          window.electron.ipcRenderer.invoke('pref:check-sticky-keys'),
          window.electron.ipcRenderer.invoke('pref:check-task-view'),
          window.electron.ipcRenderer.invoke('pref:check-verbose-logon'),
        ]);
        if (!mounted) return;
        setMouseEnabled(!!(mouseRes && mouseRes.applied));
        setStartRecEnabled(!!(startRes && startRes.applied));
        setSettingsHomeEnabled(!!(settingsRes && settingsRes.value === 'show:home'));
        setBingEnabled(!!(bingRes && bingRes.value === 0));
        setDarkEnabled(!!(darkRes && darkRes.applied));
        setRevertStartMenuEnabled(!!(revertRes && revertRes.applied));
        setCenterTaskbarEnabled(!!(res0 && res0.applied));
        setCrossDeviceEnabled(!!(res1 && res1.applied));
        setDetailedBsodEnabled(!!(res2 && res2.applied));
        setMpoEnabled(!!(res3 && res3.applied));
        setModernStandbyEnabled(!!(res4 && res4.applied));
        setNewOutlookEnabled(!!(res5 && res5.applied));
        setNumlockEnabled(!!(res6 && res6.applied));
        setSearchTaskbarEnabled(!!(res7 && res7.applied));
        setShowExtensionsEnabled(!!(res8 && res8.applied));
        setShowHiddenEnabled(!!(res9 && res9.applied));
        setStickyKeysEnabled(!!(res10 && res10.applied));
        setTaskViewEnabled(!!(res11 && res11.applied));
        setVerboseLogonEnabled(!!(res12 && res12.applied));
      } catch (e) {
        addToast('Failed to load preferences', 'error');
      } finally {
        if (mounted) setPrefsLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const applyPref = async (channel: string, value: any, setLoading: (v: boolean) => void, setState: (v: boolean | null) => void, successMsg?: string) => {
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
                <ProLockedWrapper featureName="Win Preferences" message="PRO Feature">
                <div className="ai-grid" style={{ gap: '12px', gridAutoRows: 'auto', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))' }}>
                  {preferenceItems.map((pref, index) => (
                    <motion.div
                      key={pref.id}
                      initial={{ y: 20, opacity: 0, scale: 0.97 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05, type: 'spring', stiffness: 200, damping: 22 }}
                    >
                      <div className={`ai-card${pref.loading ? ' ai-card--busy' : ''}`} style={{ padding: '12px 14px', height: '76px', cursor: 'default' }}>
                        <div className="ai-card-icon" style={{ background: 'transparent', color: '#00F2FF' }}>
                          {pref.loading ? <Loader2 size={16} className="ai-spin" /> : (
                            <div style={{ opacity: 0.8 }}>{pref.icon && React.isValidElement(pref.icon) ? React.cloneElement(pref.icon as React.ReactElement, { size: 18 }) : pref.icon}</div>
                          )}
                        </div>
                        <div className="ai-card-info" style={{ justifyContent: 'center' }}>
                          <span className="ai-card-name" style={{ fontSize: '13px', lineHeight: '1.2', color: '#F8FAFC', fontWeight: 600 }}>{pref.title}</span>
                          <span className="ai-card-cat" style={{ fontSize: '11.5px', marginTop: '3px', lineHeight: '1.4', color: '#94A3B8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={pref.desc}>{pref.desc}</span>
                        </div>
                        <div className="ai-card-actions" style={{ marginLeft: 'auto' }}>
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
                </ProLockedWrapper>
              ) : activeCategory === 'repair' ? (
                <ProLockedWrapper featureName="Utilities" message="PRO Feature">
                  <SystemRepairPanel />
                </ProLockedWrapper>
              ) : activeCategory === 'essential' ? (
                <ProLockedWrapper featureName="Win Tweaks" message="PRO Feature">
                <div className="ai-grid" style={{ gap: '12px', gridAutoRows: 'auto', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))' }}>
                  {utilityTabs.essential.map((utility, index) => {
                    const busy = cleaningId === utility.id;
                    const sel = selectedTweaks.has(utility.id);
                    return (
                      <motion.div
                        key={utility.id}
                        initial={{ y: 20, opacity: 0, scale: 0.97 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.02, type: 'spring', stiffness: 200, damping: 22 }}
                        className={`ai-card${busy ? ' ai-card--busy' : ''}${sel ? ' ai-card--sel' : ''}`}
                        onClick={() => !busy && !isBatchTweaking && toggleTweakSelection(utility.id)}
                        style={{ cursor: busy ? 'default' : 'pointer', padding: '12px 14px', height: '76px' }}
                      >
                        <div className="ai-card-icon" style={{ background: 'transparent' }}>
                          {busy ? <Loader2 size={16} className="ai-spin" /> : 
                            sel ? (
                              <span className="ai-card-sel-icon" style={{
                                width: 24, height: 24, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: utility.color
                              }}>
                                <CheckSquare size={18} />
                              </span>
                            ) : (
                            <span style={{ 
                               display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                               width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                               color: 'rgba(255,255,255,0.15)',
                            }}>
                              <Square size={18} />
                            </span>
                          )}
                        </div>
                        <div className="ai-card-info" style={{ justifyContent: 'center' }}>
                          <span className="ai-card-name" style={{ fontSize: '13px', lineHeight: '1.2', color: '#F8FAFC', fontWeight: 600 }}>{utility.title}</span>
                          <span className="ai-card-cat" style={{ fontSize: '11.5px', marginTop: '3px', lineHeight: '1.4', color: '#94A3B8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={utility.description}>{utility.description}</span>
                        </div>
                        {!busy && !isBatchTweaking && !sel && (
                          <button
                            className="ai-card-dl"
                            onClick={(e) => { e.stopPropagation(); handleClean(utility.id); }}
                            title={`Run ${utility.title}`}
                            style={{ opacity: 0.7 }}
                          >
                            <Zap size={14} />
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
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

      <AnimatePresence>
        {selectedTweaks.size > 0 && activeCategory === 'essential' && (
          <motion.div
            className="ai-dock"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="ai-dock-left">
              <Sparkles size={15} />
              <span><strong>{selectedTweaks.size}</strong> tweak{selectedTweaks.size > 1 ? 's' : ''} selected</span>
            </div>
            <div className="ai-dock-right">
              {isBatchTweaking ? (
                <button className="ai-dock-cancel" onClick={() => { cancelBatchRef.current = true; setIsBatchTweaking(false); setActiveTweakModalId(null); }}>
                  <X size={13} /> Cancel Batch
                </button>
              ) : (
                <>
                  <button className="ai-dock-clear" onClick={() => setSelectedTweaks(new Set())}><X size={13} /> Clear</button>
                  <button className="ai-dock-go" onClick={handleApplySelectedTweaks}>
                    <Download size={14} /> Apply Selected
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <TweakExecutionModal
        tweakId={activeTweakModalId}
        onClose={() => {
          cancelBatchRef.current = true;
          setActiveTweakModalId(null);
        }}
      />
    </motion.div>
  );
};

export default React.memo(Cleaner);


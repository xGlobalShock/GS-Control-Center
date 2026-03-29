import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Loader from './components/Loader';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Performance from './pages/Performance';
import Cleaner from './pages/Cleaner';
import Settings from './pages/Settings';
import GameLibrary from './pages/GameLibrary';
import OBSPresets from './pages/OBSPresets';
import Network from './pages/Network';
import SoftwareUpdates from './pages/SoftwareUpdates';
import AppsPage from './pages/AppsPage';
import SpaceAnalyzer from './pages/SpaceAnalyzer';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ToastContainer';
import { useRealtimeHardware } from './hooks/useRealtimeHardware';
import './App.css';

export interface HardwareInfo {
  cpuName: string;
  gpuName: string;
  ramInfo: string;
  ramBrand: string;
  ramPartNumber: string;
  diskName: string;
  cpuCores: number;
  cpuThreads: number;
  cpuMaxClock: string;
  gpuVramTotal: string;
  gpuDriverVersion: string;
  ramTotalGB: number;
  ramUsedGB: number;
  ramSticks: string;
  diskTotalGB: number;
  diskFreeGB: number;
  diskType: string;
  diskHealth: string;
  allDrives: { letter: string; totalGB: number; freeGB: number; label: string }[];
  networkAdapter: string;
  networkLinkSpeed?: string;
  networkAdapters?: { name: string; type: string; linkSpeed: string }[];
  ipAddress: string;
  ipv6Address?: string;
  macAddress?: string;
  gateway?: string;
  dns?: string;
  // Motherboard & BIOS
  motherboardManufacturer?: string;
  motherboardProduct?: string;
  motherboardSerial?: string;
  biosVersion?: string;
  biosDate?: string;
  windowsVersion: string;
  windowsBuild: string;
  systemUptime: string;
  powerPlan: string;
  lastWindowsUpdate?: string;
  windowsActivation?: string;
  hasBattery: boolean;
  batteryPercent: number;
  batteryStatus: string;
}

export interface ExtendedStats {
  cpuClock: number;
  perCoreCpu: number[];
  gpuUsage: number;
  gpuTemp: number;
  gpuVramUsed: number;
  gpuVramTotal: number;
  networkUp: number;
  networkDown: number;
  ssid?: string;
  wifiSignal: number;
  activeAdapterName?: string;
  activeLinkSpeed?: string;
  activeLocalIP?: string;
  activeMac?: string;
  activeGateway?: string;
  latencyMs?: number;
  packetLoss?: number;
  ramUsedGB: number;
  ramTotalGB: number;
  ramAvailableGB: number;
  ramCachedGB: number;
  diskReadSpeed: number;
  diskWriteSpeed: number;
  processCount: number;
  systemUptime: string;
}

function App() {
    const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | undefined>(undefined);

  // ── Real-Time Push: subscribe to hardware metrics from main process ──
  // The hook listens for 'realtime-hw-update' events pushed via webContents.send
  // at 1000ms intervals. Uses useRef internally to avoid re-rendering on every push;
  // state is flushed once per animation frame for smooth batched UI updates.
  const shouldStream = isLoading || currentPage === 'dashboard' || currentPage === 'performance';
  const { systemStats, extendedStats, connected } = useRealtimeHardware({ enabled: shouldStream });

  // Dismiss the loader as soon as the first real-time push arrives
  useEffect(() => {
    if (isLoading && connected) {
      setIsLoading(false);
    }
  }, [isLoading, connected]);

  // Fallback: if real-time push hasn't connected within 5s, try a single poll
  // to unblock the loader (covers dev mode without Electron)
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(async () => {
      if (!connected && window.electron?.ipcRenderer) {
        try {
          await window.electron.ipcRenderer.invoke('system:get-stats');
          setIsLoading(false);
        } catch {}
      }
      // If no electron at all (browser dev), just dismiss after timeout
      if (!window.electron) setIsLoading(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [isLoading, connected]);

  useEffect(() => {
    // Fetch hardware info once (always fresh, no disk cache)
    const fetchHardwareInfo = async () => {
      if (window.electron?.ipcRenderer) {
        try {
          const info = await window.electron.ipcRenderer.invoke('system:get-hardware-info');
          setHardwareInfo(info);
        } catch (error) {
          console.error('Error fetching hardware info:', error);
        }
      }
    };
    fetchHardwareInfo();

    // Trigger silent background preload for Space Analyzer
    if (window.electron?.ipcRenderer) {
      (async () => {
        try {
          const spaceData = await window.electron.ipcRenderer.invoke('space:scan', 'C:\\');
          (window as any).__SPACE_ANALYZER_PRELOADED__ = spaceData;
        } catch (err) {
          console.warn('Background space analyzer preload failed:', err);
        }
      })();
    }

    // Listen for slow background data (phase 2) and merge into state
    let unsub: (() => void) | undefined;
    if (window.electron?.ipcRenderer) {
      unsub = window.electron.ipcRenderer.on('hw-info-update', (partial: Partial<HardwareInfo>) => {
        setHardwareInfo(prev => prev ? { ...prev, ...partial } : prev);
      });
      
      // Catch pre-loaded Windows Debloat data dispatched during splash screen
      window.electron.ipcRenderer.on('wdebloat:preloaded', (data: any) => {
        (window as any).__WDEBLOAT_PRELOADED__ = data;
      });
    }
    return () => { unsub?.(); };
  }, []);

  // Pre-computed display styles to avoid creating new objects on every render
  const show = { display: 'block' } as const;
  const hide = { display: 'none' } as const;
  const pageStyle = useCallback((id: string) => currentPage === id ? show : hide, [currentPage]);

  // Memoize static pages so they don't create new JSX on every state change
  const staticPages = useMemo(() => (
    <>
      <div style={pageStyle('performance')}><Performance /></div>
      <div style={pageStyle('cleaner')}><Cleaner /></div>
      <div style={pageStyle('network')}><Network /></div>
      <div style={pageStyle('obsPresets')}><OBSPresets /></div>
      <div style={pageStyle('settings')}><Settings /></div>
    </>
  ), [pageStyle]);

  const renderPage = () => {
    return (
      <>
        <div style={pageStyle('dashboard')}>
          <Dashboard
            systemStats={systemStats}
            hardwareInfo={hardwareInfo}
            extendedStats={extendedStats}
          />
        </div>
        {staticPages}
        <div style={pageStyle('gameLibrary')}>
          <GameLibrary hardwareInfo={hardwareInfo} isActive={currentPage === 'gameLibrary'} />
        </div>
        <div style={pageStyle('softwareUpdates')}>
          <SoftwareUpdates isActive={currentPage === 'softwareUpdates'} />
        </div>
        <div style={pageStyle('apps')}>
          <AppsPage isActive={currentPage === 'apps'} />
        </div>
        <div style={pageStyle('space')}>
          <SpaceAnalyzer isActive={currentPage === 'space'} />
        </div>
      </>
    );
  };

  return (
    <ToastProvider>
      {isLoading ? (
        <div className="app-container">
          <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
          <div className="main-content">
            <Header />
            <div className="page-content">
              <Loader />
            </div>
          </div>
        </div>
      ) : (
        <div className="app-container">
          <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
          <div className="main-content">
            <Header />
            <div className="page-content">
              {renderPage()}
            </div>
          </div>
          <ToastContainer />
        </div>
      )}
    </ToastProvider>
  );
}

export default App;

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LightRays from './components/LightRays';
import LiveMetrics from './pages/LiveMetrics';
import Performance from './pages/Performance';
import Cleaner from './pages/Cleaner';
import GameLibrary from './pages/GameLibrary';
import OBSPresets from './pages/OBSPresets';
import Network from './pages/Network';
import SoftwareUpdates from './pages/SoftwareUpdates';
import AppsPage from './pages/AppsPage';
import SpaceAnalyzer from './pages/SpaceAnalyzer';
import ServiceOptimizer from './pages/ServiceOptimizer';
import ResolutionManager from './pages/ResolutionManager';
import AdminPanel from './pages/AdminPanel';
import ManageSubscription from './pages/ManageSubscription';
import LoginPage from './pages/LoginPage';
import { ToastProvider } from './contexts/ToastContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProGuard } from './components/PaywallModal';
import { ToastContainer } from './components/ToastContainer';
import AutoCleanupRunner from './components/AutoCleanupRunner';
import { useRealtimeHardware } from './hooks/useRealtimeHardware';
import { loadSettings } from './utils/settings';

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
  ramSpeed?: string;
  ramSticks: string;
  ramSlotMap?: string;
  ramDramBrand?: string;
  ramPageFileUsed?: number;
  ramPageFileTotal?: number;
  ramNonPagedPool?: number;
  ramStandby?: number;
  ramModified?: number;
  ramTopProcesses?: { name: string; mb: number }[];
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
  secureBoot?: string;
  keyboardName?: string;
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
  gpuClock?: number;
  gpuFan?: number;
  gpuFanRpm?: number;
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

function AppInner() {
  const [hardwareReady, setHardwareReady] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const [raysColor, setRaysColor] = useState<string>(() => loadSettings().raysColor ?? '#00F2FF');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | undefined>(undefined);
  // Always stream on dashboard/performance; also stream during initial boot so
  // the first payload arrives as soon as possible.
  const shouldStream = !hardwareReady || currentPage === 'dashboard' || currentPage === 'performance';
  const { systemStats, extendedStats, connected } = useRealtimeHardware({ enabled: shouldStream });

  // Mark hardware as ready once the first realtime payload arrives
  useEffect(() => {
    if (!hardwareReady && connected) {
      setHardwareReady(true);
    }
  }, [hardwareReady, connected]);

  // Signal the main process that the renderer is fully loaded.
  // Fire as soon as hardware is ready OR after a 3-second grace period,
  // whichever comes first — so the splash screen doesn't hang.
  const appReadySentRef = React.useRef(false);
  useEffect(() => {
    if (appReadySentRef.current) return;
    if (hardwareReady) {
      appReadySentRef.current = true;
      try { (window as any).electron?.ipcRenderer?.send('app:ready'); } catch (_) {}
    }
  }, [hardwareReady]);

  // Fallback: send app:ready after 3 s even if hardware hasn't connected
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!appReadySentRef.current) {
        appReadySentRef.current = true;
        try { (window as any).electron?.ipcRenderer?.send('app:ready'); } catch (_) {}
      }
      // In non-Electron mode, mark hardware ready so we don't wait forever
      if (!window.electron) setHardwareReady(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
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

    let unsub: (() => void) | undefined;
    if (window.electron?.ipcRenderer) {
      unsub = window.electron.ipcRenderer.on('hw-info-update', (partial: Partial<HardwareInfo>) => {
        setHardwareInfo(prev => prev ? { ...prev, ...partial } : prev);
      });
      
      window.electron.ipcRenderer.on('wdebloat:preloaded', (data: any) => {
        (window as any).__WDEBLOAT_PRELOADED__ = data;
      });
    }
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    const s = loadSettings();
    if (s.appBgColor) {
      document.documentElement.style.setProperty('--app-bg', s.appBgColor);
    }
  }, []);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      try {
        // @ts-ignore
        const detail = (e as CustomEvent)?.detail || {};
        if (detail.raysColor) setRaysColor(detail.raysColor);
        if (detail.appBgColor) {
          document.documentElement.style.setProperty('--app-bg', detail.appBgColor);
        }
      } catch {}
    };
    window.addEventListener('settings:updated', onUpdated as EventListener);
    return () => window.removeEventListener('settings:updated', onUpdated as EventListener);
  }, []);

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const page = (e as CustomEvent<{ page: string }>).detail?.page;
      if (page) setCurrentPage(page);
    };
    window.addEventListener('navigate:page', onNavigate as EventListener);
    return () => window.removeEventListener('navigate:page', onNavigate as EventListener);
  }, []);

  const show = { display: 'block' } as const;
  const hide = { display: 'none' } as const;

  const pageStyle = useCallback((id: string) => currentPage === id ? show : hide, [currentPage]);
  const staticPages = useMemo(() => (
    <>
      <div style={pageStyle('performance')}><ProGuard pageName="PC Tweaks"><Performance /></ProGuard></div>
      <div style={pageStyle('serviceOptimizer')}><ServiceOptimizer /></div>
      <div style={pageStyle('cleaner')}><ProGuard pageName="Utilities"><Cleaner /></ProGuard></div>
      <div style={pageStyle('network')}><Network /></div>
      <div style={pageStyle('obsPresets')}><OBSPresets /></div>
      <div style={pageStyle('resolutionManager')}><ResolutionManager /></div>
    </>
  ), [pageStyle]);

  const renderPage = () => {
    return (
      <>
        <div style={pageStyle('dashboard')}>
          <LiveMetrics
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
          <ProGuard pageName="Software Updates">
            <SoftwareUpdates isActive={currentPage === 'softwareUpdates'} />
          </ProGuard>
        </div>
        <div style={pageStyle('apps')}>
          <ProGuard pageName="Apps Manager">
            <AppsPage isActive={currentPage === 'apps'} />
          </ProGuard>
        </div>
        <div style={pageStyle('space')}>
          <ProGuard pageName="Disk Analyzer">
            <SpaceAnalyzer isActive={currentPage === 'space'} />
          </ProGuard>
        </div>
        <div style={pageStyle('admin')}>
          <AdminPanel />
        </div>
        <div style={pageStyle('subscription')}>
          <ManageSubscription />
        </div>
      </>
    );
  };

  return (
    <ToastProvider>
      {/* Show login page if not authenticated */}
      {!authLoading && !user && <LoginPage />}
      {raysColor !== 'off' && (
      <LightRays
        raysColor={raysColor}
        raysSpeed={1}
        lightSpread={1.6}
        rayLength={1.5}
        followMouse={false}
        mouseInfluence={0}
        noiseAmount={0.02}
        distortion={0}
        pulsating={false}
        fadeDistance={1}
        saturation={2.5}
      />
      )}
      <div className="app-container">
        <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
        <div className="main-content">
          <Header />
          <div className="page-content">
            {renderPage()}
          </div>
        </div>
        <ToastContainer />
        <AutoCleanupRunner ready={hardwareReady} />
      </div>
    </ToastProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

export default App;

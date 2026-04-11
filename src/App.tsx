import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  cpuSocket?: string;
  cpuL2Cache?: string;
  cpuL3Cache?: string;
  cpuArch?: string;
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
  cpuPower: number;
  cpuVoltage: number;
  perCoreCpu: number[];
  gpuUsage: number;
  gpuTemp: number;
  gpuVramUsed: number;
  gpuVramTotal: number;
  gpuClock?: number;
  gpuFan?: number;
  gpuFanRpm?: number;
  gpuPower: number;
  gpuMemClock: number;
  gpuHotSpot: number;
  gpuMemTemp: number;
  gpuVoltage: number;
  gpuFanControllable: boolean;
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
  internetLoss?: number;
  gatewayLoss?: number;
  gatewayLatency?: number;
  pingGateway?: string;
  pingMin?: number;
  pingMax?: number;
  pingAvg?: number;
  pingJitter?: number;
  pingSent?: number;
  pingRecv?: number;
  nicErrors?: number;
  nicDiscards?: number;
  ramUsedGB: number;
  ramTotalGB: number;
  ramAvailableGB: number;
  ramCachedGB: number;
  diskReadSpeed: number;
  diskWriteSpeed: number;
  diskTemp: number;
  diskLife: number;
  processCount: number;
  systemUptime: string;
}

function AppInner() {
  const [hardwareReady, setHardwareReady] = useState(false);
  const { user, loading: authLoading, appReady } = useAuth();
  const [raysColor, setRaysColor] = useState<string>(() => loadSettings().raysColor ?? '#00F2FF');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const pageContentRef = useRef<HTMLDivElement>(null);

  // Reset scroll to top on every page navigation
  useEffect(() => {
    if (pageContentRef.current) pageContentRef.current.scrollTop = 0;
  }, [currentPage]);
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | undefined>(undefined);
  const shouldStream = appReady && user && (!hardwareReady || currentPage === 'dashboard' || currentPage === 'performance');
  const { systemStats, extendedStats, connected } = useRealtimeHardware({ enabled: !!shouldStream });

  useEffect(() => {
    if (!hardwareReady && connected) {
      setHardwareReady(true);
    }
  }, [hardwareReady, connected]);

  const appReadySentRef = React.useRef(false);
  useEffect(() => {
    if (appReadySentRef.current || !appReady) return;

    appReadySentRef.current = true;
    try { (window as any).electron?.ipcRenderer?.send('app:ready'); } catch (_) { }
  }, [appReady]);



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
    let unsubWdebloat: (() => void) | undefined;
    if (window.electron?.ipcRenderer) {
      unsub = window.electron.ipcRenderer.on('hw-info-update', (partial: Partial<HardwareInfo>) => {
        setHardwareInfo(prev => prev ? { ...prev, ...partial } : prev);
      });

      unsubWdebloat = window.electron.ipcRenderer.on('wdebloat:preloaded', (data: any) => {
        (window as any).__WDEBLOAT_PRELOADED__ = data;
      });
    }
    return () => { unsub?.(); unsubWdebloat?.(); };
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
      } catch { }
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
      {/* 1. App Not Ready -> Wait indefinitely (splash screen handles visuals) */}
      {!appReady && (
        <div style={{ width: '100vw', height: '100vh', background: 'var(--app-bg, #040610)' }} />
      )}

      {/* 2. App Ready but Not Authenticated -> Show Login Page ONLY */}
      {appReady && !user && <LoginPage />}

      {/* 3. App Ready & Authenticated -> Render Full Application Tree */}
      {appReady && user && (
        <>
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
              <div className="page-content" ref={pageContentRef}>
                {renderPage()}
              </div>
            </div>
            <ToastContainer />
            <AutoCleanupRunner ready={hardwareReady} />
          </div>
        </>
      )}
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

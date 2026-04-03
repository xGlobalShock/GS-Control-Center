import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Activity, Globe, Play, RefreshCcw, CloudLightning, Zap, Terminal } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import '../styles/Network.css';

interface PingTarget { id: string; label: string; host: string; category: 'gaming' | 'social'; }
interface PingResult { time: number | null; loading: boolean; }
type TestProvider = 'fast' | 'ookla' | 'testmy';
type TestState = 'idle' | 'running';

// Restoration of ORIGINAL regional gaming servers (NA, EU, OCE, ME, ASIA)
const PING_TARGETS: PingTarget[] = [
  { id: 'na-east', label: 'NA East (VA)', host: 'dynamodb.us-east-1.amazonaws.com', category: 'gaming' },
  { id: 'na-west', label: 'NA West (OR)', host: 'dynamodb.us-west-2.amazonaws.com', category: 'gaming' },
  { id: 'na-central', label: 'NA Central (TX)', host: 'dynamodb.us-east-2.amazonaws.com', category: 'gaming' },
  { id: 'eu-west', label: 'EU West (IRE)', host: 'dynamodb.eu-west-1.amazonaws.com', category: 'gaming' },
  { id: 'eu-central', label: 'EU Central (FRA)', host: 'dynamodb.eu-central-1.amazonaws.com', category: 'gaming' },
  { id: 'eu-london', label: 'EU North (LDN)', host: 'dynamodb.eu-west-2.amazonaws.com', category: 'gaming' },
  { id: 'oce', label: 'Oceania (SYD)', host: 'dynamodb.ap-southeast-2.amazonaws.com', category: 'gaming' },
  { id: 'asia-tokyo', label: 'Asia (TYO)', host: 'dynamodb.ap-northeast-1.amazonaws.com', category: 'gaming' },
  { id: 'asia-sgp', label: 'Asia (SGP)', host: 'dynamodb.ap-southeast-1.amazonaws.com', category: 'gaming' },
  { id: 'me', label: 'Middle East (DXB)', host: 'dynamodb.me-south-1.amazonaws.com', category: 'gaming' }
];

const pingColor = (t: number | null, loading?: boolean) => {
  if (t === null || t === undefined) return loading ? 'neutral' : 'red';
  if (t <= 90) return 'green';
  if (t <= 190) return 'amber';
  if (t <= 300) return 'orange';
  return 'red';
};

// ── SpeedEngine Component (Isolated for Stability) ─────────────────────────────────
// Memoized to prevent parent re-renders (from pings) from touching the webview process.
const SpeedEngine = React.memo(({ 
  provider, 
  testState, 
  warmedUp, 
  setWvLoading, 
  injectCleanerStyles 
}: { 
  provider: TestProvider; 
  testState: TestState; 
  warmedUp: React.MutableRefObject<Record<TestProvider, boolean>>;
  setWvLoading: (val: boolean) => void;
  injectCleanerStyles: (wv: any) => void;
}) => {
  const wvRef = useRef<any>(null);

  const getTargetUrl = () => {
    if (testState === 'idle') return 'about:blank';
    if (provider === 'ookla') return 'https://www.speedtest.net/';
    if (provider === 'testmy') return 'https://testmy.net/';
    return 'https://fast.com';
  };

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;

    let failSafeTimer: ReturnType<typeof setTimeout> | undefined;
    const clearLoader = () => {
      setWvLoading(false);
      if (failSafeTimer) clearTimeout(failSafeTimer);
    };

    const onFinish = () => {
      clearLoader();
      warmedUp.current[provider] = true;
      injectCleanerStyles(wv);
    };

    const onFail = (_err: any) => {
      console.error('Telemetry Provider unreachable:', _err);
      clearLoader();
    };

    wv.addEventListener('did-finish-load', onFinish);
    wv.addEventListener('dom-ready', onFinish);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('did-stop-loading', clearLoader);

    return () => {
      if (failSafeTimer) clearTimeout(failSafeTimer);
      wv.removeEventListener('did-finish-load', onFinish);
      wv.removeEventListener('dom-ready', onFinish);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('did-stop-loading', clearLoader);
    };
  }, [provider, setWvLoading, injectCleanerStyles, warmedUp]);

  return (
    <webview
      key={provider}
      ref={wvRef}
      id="speed-engine"
      src={getTargetUrl()}
      partition="persist:speedtest"
      useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      style={{ width: '100%', height: '100%' }}
      webpreferences="contextIsolation=yes, enableRemoteModule=no, sandbox=no, nodeIntegration=no, webSecurity=no, allowRunningInsecureContent=yes, disableBlinkFeatures=AutomationControlled"
    />
  );
});

const Network: React.FC = () => {
  const [results, setResults] = useState<Record<string, PingResult>>(() => {
    const init: Record<string, PingResult> = {};
    PING_TARGETS.forEach(t => { init[t.id] = { time: null, loading: false }; });
    return init;
  });

  const [provider, setProvider] = useState<TestProvider>('fast');
  const [testState, setTestState] = useState<TestState>('idle');
  const warmedUp = useRef<Record<TestProvider, boolean>>({ fast: false, ookla: false, testmy: false });
  const [wvLoading, setWvLoading] = useState(false);
  const mountedRef = useRef(true);

  const pingOne = useCallback(async (target: PingTarget) => {
    if (!window.electron?.ipcRenderer) return;
    if (!mountedRef.current) return;
    setResults(prev => ({ ...prev, [target.id]: { ...prev[target.id], loading: true } }));
    try {
      const res: any = await window.electron.ipcRenderer.invoke('network:ping', target.host);
      if (!mountedRef.current) return;
      const time = res && typeof res.time === 'number' ? res.time : null;
      setResults(prev => ({ ...prev, [target.id]: { time, loading: false } }));
    } catch {
      if (!mountedRef.current) return;
      setResults(prev => ({ ...prev, [target.id]: { time: null, loading: false } }));
    }
  }, []);

  const pingAll = useCallback(() => {
    PING_TARGETS.forEach((t, idx) => {
      setTimeout(() => { if (mountedRef.current) pingOne(t); }, idx * 100);
    });
  }, [pingOne]);

  useEffect(() => {
    mountedRef.current = true;
    pingAll();
    let nextIndex = 0;
    const intervalId = setInterval(() => {
      if (testState === 'running') return; // Pause pings during speed tests
      const target = PING_TARGETS[nextIndex];
      nextIndex = (nextIndex + 1) % PING_TARGETS.length;
      pingOne(target);
    }, 1500);

    return () => { clearInterval(intervalId); mountedRef.current = false; };
  }, [pingAll, pingOne, testState]);

  const injectCleanerStyles = useCallback((wv: any) => {
    if (!wv) return;
    const commonCSS = `
        html, body { overflow: hidden !important; scrollbar-width: none !important; -ms-overflow-style: none !important; background: transparent !important; }
        ::-webkit-scrollbar { display: none !important; }
     `;
    const fastCSS = `
        ${commonCSS}
        html, body { background: #FFF !important; }
        header, footer, .netflix-logo, .nav-container { display: none !important; }
        .speed-controls-container { transform: scale(1.1) !important; margin-top: 40px !important; }
     `;
    const ooklaCSS = `
        ${commonCSS}
        html, body { overflow: hidden !important; }
        html { zoom: 0.9 !important; }
        .ad-unit, .pure-ad, .sidebar, .ad-column, .gam-ad-unit, .masthead, .masthead-apps, .masthead-nav, a[href="/results"], a[href="/settings"], .btn-server-select, a[href="/register"], a.nav-link[href*="/login"], .below-start-button { display: none !important; }
        .main-content, .pure-g { margin: 0 auto !important; float: none !important; }
        .speedtest-container { 
            transform: scale(1) !important; 
            margin-top: -100px !important; 
            margin-left: -150px !important; 
            transform-origin: top center !important; 
            will-change: transform !important;
            backface-visibility: hidden !important;
            transform-style: preserve-3d !important;
        }
        .gauge-container, .test-holder, .gauge-assembly, .gauge-vessel, .gauge-canvas { 
            overflow: visible !important; 
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
     `;
    const testmyCSS = `
        ${commonCSS}
        html { zoom: 1 !important; }
        .navbar, .ad, .useragent, .note, .msg, .jumbotron, .hero-unit, .top-banner, .combined, .latency, .well.well-sm, .google-ads, .adsbygoogle { display: none !important; }
        .container { width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
        #main-content > .well, .testpanel, .test-box {
            transform: scale(1) !important;
            transform-origin: top center !important;
            margin-top: 60px !important;
            background: rgba(255,255,255,0.05) !important;
            border: 1px solid rgba(0, 242, 255,0.1) !important;
            border-radius: 12px !important;
            box-shadow: none !important;
        }
    `;

    if (provider === 'fast') wv.insertCSS(fastCSS);
    else if (provider === 'ookla') wv.insertCSS(ooklaCSS);
    else if (provider === 'testmy') wv.insertCSS(testmyCSS);
  }, [provider]);

  const initiateScan = () => {
    setTestState('running');
    if (!warmedUp.current[provider]) setWvLoading(true);
    else setWvLoading(false);
  };

  const allTimes = PING_TARGETS.map(t => results[t.id]?.time).filter((t): t is number => t != null);
  const avgPing = allTimes.length ? Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length) : null;
  const online = allTimes.length;
  const total = PING_TARGETS.length;

  return (
    <motion.div className="nv-master" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <div className="nv-bg-ambient" />
      <div className="nv-grid-overlay" />

      <PageHeader
        icon={<Wifi size={18} className="nv-cyan-accent" />}
        title="Network Diagnostics"
        actions={
          <div className="nv-global-stats">
            <div className="nv-gstat">
              <Activity size={12} className="nv-cyan-accent" />
              <span>AVERAGE PING:</span>
              <span className="font-mono">{avgPing != null ? `${avgPing}ms` : '---'}</span>
            </div>
            <div className="nv-gstat">
              <RefreshCcw size={12} className="nv-cyan-accent" />
              <button onClick={pingAll} className="nv-gstat-btn">REFRESH SERVERS</button>
            </div>
          </div>
        }
      />

      <div className="nv-dashboard">
        <div className="nv-panel nv-sidebar">
          <div className="nv-panel-header">
            <Zap size={14} className="nv-cyan-accent" />
            <span>SPEED TEST TOOLS</span>
          </div>

          <div className="nv-provider-list">
            <button className={`nv-p-btn ${provider === 'fast' ? 'active' : ''}`} onClick={() => { setProvider('fast'); setTestState('idle'); }}>
              <div className="nv-p-icon native"><CloudLightning size={18} /></div>
              <div className="nv-p-info"><span className="nv-p-name">Fast.com</span><span className="nv-p-type">CDN Speed Test</span></div>
              <div className="nv-p-edge" />
            </button>
            <button className={`nv-p-btn ${provider === 'ookla' ? 'active' : ''}`} onClick={() => { setProvider('ookla'); setTestState('idle'); }}>
              <div className="nv-p-icon ookla"><Terminal size={18} /></div>
              <div className="nv-p-info"><span className="nv-p-name">Speedtest.net</span><span className="nv-p-type">Bandwidth & Latency</span></div>
              <div className="nv-p-edge" />
            </button>
            <button className={`nv-p-btn ${provider === 'testmy' ? 'active' : ''}`} onClick={() => { setProvider('testmy'); setTestState('idle'); }}>
              <div className="nv-p-icon testmy"><Globe size={18} /></div>
              <div className="nv-p-info"><span className="nv-p-name">TestMy.net</span><span className="nv-p-type">Multi-Thread Test</span></div>
              <div className="nv-p-edge" />
            </button>
          </div>

          <div className="nv-scan-control">
            <div className="nv-scan-status">
              <span className={`nv-status-dot ${testState === 'running' ? 'pulsing' : ''}`} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>{testState === 'running' ? 'Test in Progress' : 'Ready to Test'}</span>
            </div>
            <button 
              className={`nv-fire-btn ${testState === 'running' ? 'stop' : ''}`} 
              onClick={testState === 'running' ? () => { setTestState('idle'); pingAll(); } : initiateScan}
            >
              {testState === 'running' ? <RefreshCcw size={16} /> : <Play size={16} fill="currentColor" />}
              <span style={{ fontWeight: 700 }}>{testState === 'running' ? 'Stop Test' : 'Start Test'}</span>
            </button>
          </div>
        </div>

        <div className="nv-panel nv-center-stage">
          <div className="nv-stage-glow"></div>
          <div className="nv-webview-wrapper">
            <AnimatePresence>
              {testState === 'idle' && (
                <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="nv-wv-placeholder">
                  <Zap size={48} className="nv-cyan-accent" />
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: '12px', fontWeight: 700, color: 'rgba(255, 255, 255, 0.7)' }}>Select Test Provider to Begin</div>
                </motion.div>
              )}
              {wvLoading && (
                <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="nv-wv-loader">
                  <div className="nv-wv-loader-content">
                    <div className="nv-loader-ring"><div className="nv-loader-ring-inner" /></div>
                    <div className="nv-loader-text" style={{ fontSize: '11px', fontWeight: 700 }}>Connecting to Server...</div>
                    <div className="nv-loader-bar"><div className="nv-loader-bar-fill" /></div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className={`nv-wv-container ${testState === 'running' ? 'active' : 'hidden'}`}>
              <SpeedEngine 
                provider={provider}
                testState={testState}
                warmedUp={warmedUp}
                setWvLoading={setWvLoading}
                injectCleanerStyles={injectCleanerStyles}
              />
            </div>
          </div>
        </div>

        <div className="nv-panel nv-telemetry">
          <div className="nv-panel-header">
            <Globe size={14} className="nv-cyan-accent" />
            <span>SERVER RESPONSE TIMES ({online}/{total})</span>
          </div>
          <div className="nv-target-list">
            {[...PING_TARGETS]
              .sort((a, b) => {
                const rtA = results[a.id]?.time;
                const rtB = results[b.id]?.time;
                const aValid = rtA !== null && rtA !== undefined;
                const bValid = rtB !== null && rtB !== undefined;
                if (aValid && bValid) return rtA - rtB;
                if (aValid) return -1;
                if (bValid) return 1;
                return 0;
              })
              .map(t => {
                const r = results[t.id];
                const c = pingColor(r?.time, r?.loading);
                const hasTime = r?.time !== null && r?.time !== undefined;
                return (
                  <div key={t.id} className={`nv-tele-row bg-${c}`}>
                    <span className="nv-tele-dot" />
                    <div className="nv-tele-name">
                      <span className="nv-tn-label" style={{ fontWeight: 700 }}>{t.label}</span>
                      <span className="nv-tn-type">{t.category === 'gaming' ? 'Gaming Server' : 'Network Node'}</span>
                    </div>
                    <span className="nv-tele-ping font-mono" style={{ fontSize: !hasTime && !r?.loading ? '10px' : '14px' }}>
                      {hasTime ? r.time : r?.loading ? '...' : 'UNREACHABLE'}
                      {hasTime && <small>ms</small>}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(Network);


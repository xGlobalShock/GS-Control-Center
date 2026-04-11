import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Activity, Globe, Play, RefreshCcw, CloudLightning, Zap, Terminal, Route, MapPin, AlertTriangle, CheckCircle, Clock, ArrowRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import '../styles/Network.css';

interface PingTarget { id: string; label: string; host: string; category: 'gaming' | 'social'; }
interface PingResult { time: number | null; loading: boolean; }
type TestProvider = 'fast' | 'ookla' | 'testmy';
type TestState = 'idle' | 'running';
type NetworkTab = 'diagnostics' | 'traceroute';

interface TracerouteHop {
  hop: number;
  ip: string | null;
  rtts: (number | null)[];
  avg: number | null;
  timedOut: boolean;
}

interface TracerouteTarget {
  id: string;
  label: string;
  host: string;
  region: string;
}

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

const hopColor = (avg: number | null, timedOut: boolean) => {
  if (timedOut || avg === null) return 'timeout';
  if (avg <= 30) return 'excellent';
  if (avg <= 80) return 'good';
  if (avg <= 150) return 'warn';
  return 'bad';
};

const hopLatencyDelta = (hops: TracerouteHop[], index: number): number | null => {
  const current = hops[index]?.avg;
  if (current === null) return null;
  // Find previous hop with valid RTT
  for (let i = index - 1; i >= 0; i--) {
    if (hops[i]?.avg !== null) return current - hops[i].avg!;
  }
  return current;
};

const TRACEROUTE_TARGETS: TracerouteTarget[] = [
  { id: 'tr-na-east', label: 'NA East (Virginia)', host: 'dynamodb.us-east-1.amazonaws.com', region: 'NA' },
  { id: 'tr-na-west', label: 'NA West (Oregon)', host: 'dynamodb.us-west-2.amazonaws.com', region: 'NA' },
  { id: 'tr-eu-west', label: 'EU West (Ireland)', host: 'dynamodb.eu-west-1.amazonaws.com', region: 'EU' },
  { id: 'tr-eu-central', label: 'EU Central (Frankfurt)', host: 'dynamodb.eu-central-1.amazonaws.com', region: 'EU' },
  { id: 'tr-asia-tokyo', label: 'Asia (Tokyo)', host: 'dynamodb.ap-northeast-1.amazonaws.com', region: 'ASIA' },
  { id: 'tr-asia-sgp', label: 'Asia (Singapore)', host: 'dynamodb.ap-southeast-1.amazonaws.com', region: 'ASIA' },
  { id: 'tr-oce', label: 'Oceania (Sydney)', host: 'dynamodb.ap-southeast-2.amazonaws.com', region: 'OCE' },
  { id: 'tr-me', label: 'Middle East (Bahrain)', host: 'dynamodb.me-south-1.amazonaws.com', region: 'ME' },
];

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
  const [activeTab, setActiveTab] = useState<NetworkTab>('diagnostics');
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

  /* ── Traceroute State ──────────────────────────────────────────────── */
  const [trTarget, setTrTarget] = useState<TracerouteTarget>(TRACEROUTE_TARGETS[0]);
  const [trCustomHost, setTrCustomHost] = useState('');
  const [trHops, setTrHops] = useState<TracerouteHop[]>([]);
  const [trRunning, setTrRunning] = useState(false);
  const [trDone, setTrDone] = useState(false);
  const trListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const offHop = window.electron.ipcRenderer.on('network:traceroute-hop', (hop: TracerouteHop) => {
      setTrHops(prev => [...prev, hop]);
      // Auto-scroll to bottom
      setTimeout(() => { trListRef.current?.scrollTo({ top: trListRef.current.scrollHeight, behavior: 'smooth' }); }, 50);
    });
    const offDone = window.electron.ipcRenderer.on('network:traceroute-done', () => {
      setTrRunning(false);
      setTrDone(true);
    });
    return () => { offHop(); offDone(); };
  }, []);

  const startTraceroute = useCallback(async () => {
    if (!window.electron?.ipcRenderer || trRunning) return;
    const host = trCustomHost.trim() || trTarget.host;
    setTrHops([]);
    setTrRunning(true);
    setTrDone(false);
    try {
      await window.electron.ipcRenderer.invoke('network:traceroute', host);
    } catch {
      setTrRunning(false);
      setTrDone(true);
    }
  }, [trTarget, trCustomHost, trRunning]);

  /* ── Computed Stats ────────────────────────────────────────────────── */
  const allTimes = PING_TARGETS.map(t => results[t.id]?.time).filter((t): t is number => t != null);
  const avgPing = allTimes.length ? Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length) : null;
  const online = allTimes.length;
  const total = PING_TARGETS.length;

  // Traceroute stats
  const trTimeouts = trHops.filter(h => h.timedOut).length;
  const trValidHops = trHops.filter(h => !h.timedOut && h.avg !== null);
  const trFinalRtt = trValidHops.length > 0 ? trValidHops[trValidHops.length - 1].avg : null;
  const trWorstHop = trValidHops.length > 0 ? trValidHops.reduce((worst, h) => {
    const delta = hopLatencyDelta(trHops, trHops.indexOf(h));
    const worstDelta = hopLatencyDelta(trHops, trHops.indexOf(worst));
    return (delta ?? 0) > (worstDelta ?? 0) ? h : worst;
  }, trValidHops[0]) : null;

  return (
    <motion.div className="nv-master" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <div className="nv-bg-ambient" />
      <div className="nv-grid-overlay" />

      <PageHeader
        icon={<Wifi size={18} className="nv-cyan-accent" />}
        title="Network Diagnostics"
        actions={
          <div className="nv-global-stats">
            {activeTab === 'diagnostics' && (
              <>
                <div className="nv-gstat">
                  <Activity size={12} className="nv-cyan-accent" />
                  <span>AVERAGE PING:</span>
                  <span className="font-mono">{avgPing != null ? `${avgPing}ms` : '---'}</span>
                </div>
                <div className="nv-gstat">
                  <RefreshCcw size={12} className="nv-cyan-accent" />
                  <button onClick={pingAll} className="nv-gstat-btn">REFRESH SERVERS</button>
                </div>
              </>
            )}
            {activeTab === 'traceroute' && trDone && trHops.length > 0 && (
              <>
                <div className="nv-gstat">
                  <MapPin size={12} className="nv-cyan-accent" />
                  <span>HOPS:</span>
                  <span className="font-mono">{trHops.length}</span>
                </div>
                <div className="nv-gstat">
                  <Activity size={12} className="nv-cyan-accent" />
                  <span>FINAL RTT:</span>
                  <span className="font-mono">{trFinalRtt != null ? `${trFinalRtt}ms` : '---'}</span>
                </div>
              </>
            )}
          </div>
        }
      />

      {/* ── Tab Bar ──────────────────────────────────────────────── */}
      <div className="nv-tab-bar">
        <button
          className={`nv-tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          <Wifi size={14} />
          <span>Diagnostics</span>
        </button>
        <button
          className={`nv-tab-btn ${activeTab === 'traceroute' ? 'active' : ''}`}
          onClick={() => setActiveTab('traceroute')}
        >
          <Route size={14} />
          <span>Trace Route</span>
        </button>
      </div>

      {/* ── Diagnostics Tab (original content) ───────────────────── */}
      {activeTab === 'diagnostics' && (
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
      )}

      {/* ── Trace Route Tab ──────────────────────────────────────── */}
      {activeTab === 'traceroute' && (
      <div className="nv-dashboard nv-tr-layout">
        {/* Left: Server Selection + Controls */}
        <div className="nv-panel nv-tr-sidebar">
          <div className="nv-panel-header">
            <Route size={14} className="nv-cyan-accent" />
            <span>TARGET SERVER</span>
          </div>

          <div className="nv-tr-server-list">
            {TRACEROUTE_TARGETS.map(t => (
              <button
                key={t.id}
                className={`nv-tr-server-btn ${trTarget.id === t.id && !trCustomHost.trim() ? 'active' : ''}`}
                onClick={() => { setTrTarget(t); setTrCustomHost(''); }}
                disabled={trRunning}
              >
                <MapPin size={12} />
                <div className="nv-tr-server-info">
                  <span className="nv-tr-server-name">{t.label}</span>
                  <span className="nv-tr-server-region">{t.region}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="nv-tr-custom">
            <div className="nv-panel-header" style={{ marginTop: '4px' }}>
              <Terminal size={14} className="nv-cyan-accent" />
              <span>CUSTOM HOST</span>
            </div>
            <input
              className="nv-tr-input"
              type="text"
              placeholder="e.g. google.com or 8.8.8.8"
              value={trCustomHost}
              onChange={e => setTrCustomHost(e.target.value)}
              disabled={trRunning}
              onKeyDown={e => { if (e.key === 'Enter') startTraceroute(); }}
            />
          </div>

          <button
            className={`nv-fire-btn nv-tr-fire ${trRunning ? 'stop' : ''}`}
            onClick={startTraceroute}
            disabled={trRunning}
          >
            {trRunning ? <RefreshCcw size={16} className="nv-spin" /> : <Play size={16} fill="currentColor" />}
            <span style={{ fontWeight: 700 }}>{trRunning ? 'Tracing Route...' : 'Start Trace'}</span>
          </button>
        </div>

        {/* Center: Hop-by-Hop Results */}
        <div className="nv-panel nv-tr-results">
          <div className="nv-panel-header">
            <Activity size={14} className="nv-cyan-accent" />
            <span>ROUTE HOPS {trHops.length > 0 ? `(${trHops.length} hops)` : ''}</span>
            {trRunning && <span className="nv-tr-live-badge">● LIVE</span>}
          </div>

          <div className="nv-tr-hop-list" ref={trListRef}>
            {trHops.length === 0 && !trRunning && (
              <div className="nv-tr-placeholder">
                <Route size={40} className="nv-cyan-accent" style={{ opacity: 0.3 }} />
                <p>Select a server and click <strong>Start Trace</strong> to map the route</p>
                <p className="nv-tr-placeholder-hint">Each hop shows latency added at that network node</p>
              </div>
            )}

            {trHops.length === 0 && trRunning && (
              <div className="nv-tr-placeholder">
                <div className="nv-loader-ring" style={{ width: 32, height: 32 }}><div className="nv-loader-ring-inner" /></div>
                <p>Discovering route...</p>
              </div>
            )}

            {trHops.map((hop, idx) => {
              const color = hopColor(hop.avg, hop.timedOut);
              const delta = hopLatencyDelta(trHops, idx);
              const isWorst = trWorstHop && hop.hop === trWorstHop.hop && !hop.timedOut && (delta ?? 0) > 20;

              return (
                <motion.div
                  key={hop.hop}
                  className={`nv-tr-hop nv-tr-hop-${color} ${isWorst ? 'nv-tr-hop-worst' : ''}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: idx * 0.03 }}
                >
                  <div className="nv-tr-hop-num">{hop.hop}</div>

                  <div className="nv-tr-hop-connector">
                    <div className={`nv-tr-hop-dot nv-tr-dot-${color}`} />
                    {idx < trHops.length - 1 && <div className="nv-tr-hop-line" />}
                  </div>

                  <div className="nv-tr-hop-body">
                    <div className="nv-tr-hop-ip">
                      {hop.timedOut ? (
                        <span className="nv-tr-timeout">
                          <Clock size={12} /> Request timed out
                        </span>
                      ) : (
                        <span className="font-mono">{hop.ip || 'Unknown'}</span>
                      )}
                    </div>
                    {!hop.timedOut && (
                      <div className="nv-tr-hop-rtts">
                        {hop.rtts.map((rtt, i) => (
                          <span key={i} className={`nv-tr-rtt ${rtt === null ? 'timeout' : ''}`}>
                            {rtt !== null ? `${rtt}ms` : '*'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="nv-tr-hop-stats">
                    {!hop.timedOut && hop.avg !== null && (
                      <>
                        <span className={`nv-tr-avg nv-tr-avg-${color}`}>{hop.avg}ms</span>
                        {delta !== null && delta > 0 && (
                          <span className={`nv-tr-delta ${delta > 30 ? 'high' : delta > 10 ? 'medium' : 'low'}`}>
                            +{delta}ms
                          </span>
                        )}
                      </>
                    )}
                    {isWorst && (
                      <span className="nv-tr-bottleneck">
                        <AlertTriangle size={11} /> Bottleneck
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {trRunning && trHops.length > 0 && (
              <div className="nv-tr-hop nv-tr-hop-pending">
                <div className="nv-tr-hop-num">?</div>
                <div className="nv-tr-hop-connector">
                  <div className="nv-tr-hop-dot nv-tr-dot-pending" />
                </div>
                <div className="nv-tr-hop-body">
                  <span className="nv-tr-discovering">Tracing next hop...</span>
                </div>
              </div>
            )}
          </div>

          {/* Summary Bar */}
          {trDone && trHops.length > 0 && (
            <motion.div 
              className="nv-tr-summary"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="nv-tr-summary-item">
                <MapPin size={13} />
                <span>Total Hops</span>
                <strong>{trHops.length}</strong>
              </div>
              <div className="nv-tr-summary-item">
                <Activity size={13} />
                <span>Final RTT</span>
                <strong>{trFinalRtt != null ? `${trFinalRtt}ms` : '---'}</strong>
              </div>
              <div className="nv-tr-summary-item">
                <Clock size={13} />
                <span>Timeouts</span>
                <strong className={trTimeouts > 0 ? 'nv-tr-warn' : ''}>{trTimeouts}</strong>
              </div>
              {trWorstHop && (
                <div className="nv-tr-summary-item">
                  <AlertTriangle size={13} />
                  <span>Biggest Jump</span>
                  <strong className="nv-tr-warn">Hop {trWorstHop.hop} (+{hopLatencyDelta(trHops, trHops.indexOf(trWorstHop))}ms)</strong>
                </div>
              )}
              <div className="nv-tr-summary-item">
                <CheckCircle size={13} />
                <span>Status</span>
                <strong className={trTimeouts === 0 ? 'nv-tr-good' : 'nv-tr-warn'}>{trTimeouts === 0 ? 'Clean Route' : 'Issues Detected'}</strong>
              </div>
            </motion.div>
          )}
        </div>
      </div>
      )}
    </motion.div>
  );
};

export default React.memo(Network);


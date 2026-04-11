import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, RefreshCw, Check, Mouse } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import MousePollingRate from '../components/MousePollingRate';
import '../styles/ResolutionManager.css';

type DisplayTab = 'display' | 'mouse';

interface Resolution {
  Width: number;
  Height: number;
  RefreshRates: number[];
}

interface DisplayInfo {
  DeviceName: string;
  MonitorName: string;
  Adapter: string;
  Width: number;
  Height: number;
  RefreshRate: number;
  Primary: boolean;
}

const ResolutionManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DisplayTab>('display');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [activeDisplay, setActiveDisplay] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [loading, setLoading] = useState(false);
  const [modesLoading, setModesLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedRes, setSelectedRes] = useState<string | null>(null);
  const [selectedHz, setSelectedHz] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const ipc = window.electron?.ipcRenderer;

  // Load displays on mount
  const loadDisplays = useCallback(async () => {
    if (!ipc) return;
    setLoading(true);
    try {
      const disp: DisplayInfo[] = await ipc.invoke('resolution:get-displays');
      setDisplays(disp || []);
      // Auto-select primary display
      if (!activeDisplay && disp?.length) {
        const primary = disp.find(d => d.Primary) || disp[0];
        setActiveDisplay(primary.DeviceName);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [ipc, activeDisplay]);

  // Load modes when the active display changes
  const loadModes = useCallback(async (deviceName: string) => {
    if (!ipc) return;
    setModesLoading(true);
    setSelectedRes(null);
    setSelectedHz(null);
    setStatusMsg(null);
    try {
      const modes: Resolution[] = await ipc.invoke('resolution:get-modes', deviceName);
      setResolutions(modes || []);
    } catch {
      setResolutions([]);
    } finally {
      setModesLoading(false);
    }
  }, [ipc]);

  useEffect(() => { loadDisplays(); }, [loadDisplays]);

  useEffect(() => {
    if (activeDisplay) loadModes(activeDisplay);
  }, [activeDisplay, loadModes]);

  const currentDisplay = useMemo(
    () => displays.find(d => d.DeviceName === activeDisplay) || null,
    [displays, activeDisplay]
  );

  const selectDisplay = (deviceName: string) => {
    if (deviceName !== activeDisplay) setActiveDisplay(deviceName);
  };

  const handleSelectRes = (res: Resolution) => {
    const key = `${res.Width}x${res.Height}`;
    if (selectedRes === key) {
      setSelectedRes(null);
      setSelectedHz(null);
    } else {
      setSelectedRes(key);
      setSelectedHz(res.RefreshRates[0] || 60);
    }
  };

  const selectedRates = useMemo(() => {
    if (!selectedRes) return [];
    return resolutions.find(r => `${r.Width}x${r.Height}` === selectedRes)?.RefreshRates || [];
  }, [selectedRes, resolutions]);

  const applyResolution = async () => {
    if (!ipc || !selectedRes || !selectedHz) return;
    const [w, h] = selectedRes.split('x').map(Number);
    setApplying(true);
    setStatusMsg(null);
    try {
      const result = await ipc.invoke('resolution:set', w, h, selectedHz, activeDisplay);
      if (result.success) {
        setStatusMsg(`Applied ${w}×${h} @ ${selectedHz}Hz`);
        await loadDisplays();
        if (activeDisplay) await loadModes(activeDisplay);
      } else {
        setStatusMsg(`Failed: ${result.result}`);
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message || 'Unknown'}`);
    } finally {
      setApplying(false);
    }
  };

  const isCurrent = (w: number, h: number) =>
    currentDisplay?.Width === w && currentDisplay?.Height === h;

  const resLabel = (h: number) => {
    if (h >= 2160) return '4K';
    if (h >= 1440) return '1440p';
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    if (h >= 576) return '576p';
    if (h >= 480) return '480p';
    return `${h}p`;
  };

  return (
    <motion.div className="rm-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <PageHeader icon={<Monitor size={16} />} title="Devices" />

      {/* ── Tab Bar ──────────────────────────────────────────── */}
      <div className="rm-tab-bar">
        <button
          className={`rm-tab-btn ${activeTab === 'display' ? 'active' : ''}`}
          onClick={() => setActiveTab('display')}
        >
          <Monitor size={14} />
          <span>Display</span>
        </button>
        <button
          className={`rm-tab-btn ${activeTab === 'mouse' ? 'active' : ''}`}
          onClick={() => setActiveTab('mouse')}
        >
          <Mouse size={14} />
          <span>Mouse / Polling Rate</span>
        </button>
      </div>

      {/* ── Display Tab ─────────────────────────────────────── */}
      {activeTab === 'display' && (
      <>
      <div className="rm-layout">
        {/* ── Left: Display selector ─────────────────────────── */}
        <div className="rm-displays">
          <div className="rm-panel-head">
            <span className="rm-panel-head-label">DISPLAYS</span>
            <button className="rm-icon-btn" onClick={loadDisplays} disabled={loading}>
              <RefreshCw size={12} className={loading ? 'res-spin' : ''} />
            </button>
          </div>

          {displays.map((d) => (
            <motion.div
              key={d.DeviceName}
              className={`rm-display-card ${activeDisplay === d.DeviceName ? 'rm-display-card--active' : ''}`}
              onClick={() => selectDisplay(d.DeviceName)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="rm-display-card-corner rm-display-card-corner--tl" />
              <div className="rm-display-card-corner rm-display-card-corner--br" />
              <div className="rm-display-icon-wrap">
                <Monitor size={26} strokeWidth={1.4} />
                {activeDisplay === d.DeviceName && <div className="rm-display-icon-glow" />}
              </div>
              <div className="rm-display-info">
                <div className="rm-display-name" title={d.MonitorName}>{d.MonitorName}</div>
                <div className="rm-display-res">{d.Width}×{d.Height} @ {d.RefreshRate}Hz</div>
                {d.Primary && <span className="rm-primary-badge">PRIMARY</span>}
              </div>
              {activeDisplay === d.DeviceName && <div className="rm-display-active-stripe" />}
            </motion.div>
          ))}

          {displays.length === 0 && !loading && (
            <div className="rm-empty">No displays detected</div>
          )}
        </div>

        {/* ── Right: Resolution + Hz picker ─────────────────── */}
        <div className="rm-right">
          {currentDisplay ? (
            <>
              {/* Current display info strip */}
              <div className="rm-strip">
                <div className="rm-strip-item">
                  <span className="rm-strip-label">ACTIVE DISPLAY</span>
                  <span className="rm-strip-val">{currentDisplay.MonitorName}</span>
                </div>
                <div className="rm-strip-divider" />
                <div className="rm-strip-item">
                  <span className="rm-strip-label">RESOLUTION</span>
                  <span className="rm-strip-val rm-strip-val--accent">{currentDisplay.Width}×{currentDisplay.Height}</span>
                </div>
                <div className="rm-strip-divider" />
                <div className="rm-strip-item">
                  <span className="rm-strip-label">REFRESH RATE</span>
                  <span className="rm-strip-val rm-strip-val--accent">{currentDisplay.RefreshRate}Hz</span>
                </div>
                <div className="rm-strip-actions">
                  <AnimatePresence>
                    {selectedRes && selectedHz && (
                      <motion.button
                        className="rm-apply-btn"
                        onClick={applyResolution}
                        disabled={applying}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.15 }}
                      >
                        {applying ? (
                          <><RefreshCw size={12} className="res-spin" /> Applying…</>
                        ) : (
                          <><Check size={12} /> Apply {selectedRes.replace('x', '×')} @ {selectedHz}Hz</>
                        )}
                      </motion.button>
                    )}
                  </AnimatePresence>
                  <button className="rm-icon-btn" onClick={() => activeDisplay && loadModes(activeDisplay)} disabled={modesLoading}>
                    <RefreshCw size={12} className={modesLoading ? 'res-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Resolution list + Hz pills */}
              <div className="rm-picker-body">
                {/* Resolution col */}
                <div className="rm-res-col">
                  <div className="rm-col-head"><span>RESOLUTION</span></div>
                  <div className="rm-res-list">
                    {resolutions.map((res) => {
                      const key = `${res.Width}x${res.Height}`;
                      const isSelected = selectedRes === key;
                      const isNow = isCurrent(res.Width, res.Height);
                      return (
                        <div
                          key={key}
                          className={`rm-res-row ${isSelected ? 'rm-res-row--active' : ''} ${isNow ? 'rm-res-row--current' : ''}`}
                          onClick={() => handleSelectRes(res)}
                        >
                          <span className="rm-res-tag">{resLabel(res.Height)}</span>
                          <span className="rm-res-dims">{res.Width} × {res.Height}</span>
                          {isNow && (
                            <span className="rm-res-current-badge">
                              <Check size={9} /> CURRENT
                            </span>
                          )}
                          {isSelected && !isNow && <div className="rm-res-row-indicator" />}
                        </div>
                      );
                    })}
                    {resolutions.length === 0 && !modesLoading && (
                      <div className="rm-empty rm-empty--list">No modes available</div>
                    )}
                    {modesLoading && (
                      <div className="rm-empty rm-empty--list">Loading…</div>
                    )}
                  </div>
                </div>

                {/* Hz col */}
                <div className="rm-hz-col">
                  <div className="rm-col-head"><span>REFRESH RATE</span></div>
                  <div className="rm-hz-list">
                    {selectedRates.length > 0 ? selectedRates.map((hz) => (
                      <button
                        key={hz}
                        className={`rm-hz-pill ${selectedHz === hz ? 'rm-hz-pill--active' : ''}`}
                        onClick={() => setSelectedHz(hz)}
                      >
                        <span className="rm-hz-num">{hz}</span>
                        <span className="rm-hz-unit">Hz</span>
                      </button>
                    )) : (
                      <div className="rm-hz-hint">Select a resolution</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rm-empty rm-empty--right">
              {loading ? 'Detecting displays…' : 'Select a display to continue'}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {statusMsg && (
          <motion.div
            className={`rm-status ${statusMsg.startsWith('Applied') ? 'rm-status--ok' : 'rm-status--err'}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {statusMsg.startsWith('Applied') ? <Check size={12} /> : null}
            {statusMsg}
          </motion.div>
        )}
      </AnimatePresence>
      </>
      )}

      {/* ── Mouse / Polling Rate Tab ────────────────────────── */}
      {activeTab === 'mouse' && <MousePollingRate />}
    </motion.div>
  );
};

export default React.memo(ResolutionManager);

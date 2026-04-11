import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mouse, RefreshCw, Shield, Gauge, Zap, Info, ChevronDown, ChevronUp, Activity, Crosshair } from 'lucide-react';
import '../styles/MousePollingRate.css';

interface MouseDevice {
  Name: string;
  InstanceId: string;
  Status: string;
  VidPid: string;
  Manufacturer: string;
}

interface MouseSettings {
  enhancePointerPrecision: boolean;
  pointerSpeed: number;
  mouseSpeed: number;
  mouseThreshold1: number;
  mouseThreshold2: number;
  usbPollingInterval: number;
}

interface PollingInfo {
  detected: boolean;
  rateHz: number;
  overrideHz: number;
  overrideMs: number;
  defaultHz: number;
  deviceName: string;
  isOverridden: boolean;
}

const MousePollingRate: React.FC = () => {
  const [devices, setDevices] = useState<MouseDevice[]>([]);
  const [settings, setSettings] = useState<MouseSettings | null>(null);
  const [polling, setPolling] = useState<PollingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dpi, setDpi] = useState<number>(() => {
    const saved = localStorage.getItem('gc_mouse_dpi');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return !isNaN(parsed) && parsed >= 100 && parsed <= 32000 ? parsed : 800;
  });
  const [customDpi, setCustomDpi] = useState<string>('');
  const [showCustomDpi, setShowCustomDpi] = useState(false);
  const [inGameSens, setInGameSens] = useState<number>(() => {
    const saved = localStorage.getItem('gc_mouse_igs');
    const parsed = saved ? parseFloat(saved) : NaN;
    return !isNaN(parsed) && parsed > 0 && parsed <= 100 ? parsed : 1.0;
  });

  const ipc = window.electron?.ipcRenderer;

  const loadAll = useCallback(async () => {
    if (!ipc) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [devs, sett, poll] = await Promise.all([
        ipc.invoke('mouse:get-devices'),
        ipc.invoke('mouse:get-settings'),
        ipc.invoke('mouse:get-polling'),
      ]);
      setDevices(devs || []);
      setSettings(sett);
      setPolling(poll);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [ipc]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const toggleEPP = async () => {
    if (!ipc || !settings) return;
    const newVal = !settings.enhancePointerPrecision;
    setApplying('epp');
    try {
      const r = await ipc.invoke('mouse:set-epp', newVal);
      if (r.ok) {
        setSettings({ ...settings, enhancePointerPrecision: newVal });
        showStatus(newVal ? 'Pointer acceleration enabled' : 'Pointer acceleration disabled — raw input active');
      } else {
        showStatus('Failed to apply — run as admin');
      }
    } catch { showStatus('Error applying setting'); }
    setApplying(null);
  };

  const changeSpeed = async (val: number) => {
    if (!ipc || !settings) return;
    setApplying('speed');
    try {
      const r = await ipc.invoke('mouse:set-speed', val);
      if (r.ok) {
        setSettings({ ...settings, pointerSpeed: val });
        showStatus(`Pointer speed set to ${val}/20`);
      } else {
        showStatus('Failed to apply');
      }
    } catch { showStatus('Error applying setting'); }
    setApplying(null);
  };

  const changeQueueSize = async (val: number) => {
    if (!ipc) return;
    setApplying('queue');
    try {
      const r = await ipc.invoke('mouse:set-queue-size', val);
      if (r.ok) {
        if (settings) setSettings({ ...settings, usbPollingInterval: val });
        showStatus(`USB data queue size set to ${val} — restart required`);
      } else {
        showStatus('Failed — requires admin privileges');
      }
    } catch { showStatus('Error applying setting'); }
    setApplying(null);
  };

  const changePollInterval = async (ms: number) => {
    if (!ipc) return;
    setApplying('poll');
    try {
      const r = await ipc.invoke('mouse:set-poll-interval', ms);
      if (r.ok) {
        const hz = ms > 0 ? Math.floor(1000 / ms) : 0;
        setPolling(prev => prev ? {
          ...prev,
          overrideMs: ms,
          overrideHz: hz,
          isOverridden: ms > 0,
          rateHz: ms > 0 ? hz : prev.defaultHz,
        } : prev);
        showStatus(ms > 0
          ? `USB poll interval set to ${ms}ms (${Math.floor(1000 / ms)}Hz) — reboot required`
          : 'USB poll override removed — using device default — reboot required'
        );
      } else {
        showStatus('Failed — requires admin privileges');
      }
    } catch { showStatus('Error applying setting'); }
    setApplying(null);
  };

  const primaryDevice = devices.length > 0 ? devices[0] : null;
  const eppOff = settings && !settings.enhancePointerPrecision;

  // DPI helpers
  const selectDpi = (val: number) => {
    setDpi(val);
    localStorage.setItem('gc_mouse_dpi', String(val));
    setShowCustomDpi(false);
    showStatus(`DPI profile saved: ${val} — make sure your mouse matches this setting`);
  };

  const applyCustomDpi = () => {
    const val = parseInt(customDpi, 10);
    if (val >= 100 && val <= 32000) {
      selectDpi(val);
      setCustomDpi('');
    } else {
      showStatus('DPI must be between 100 and 32,000');
    }
  };

  const updateInGameSens = (val: number) => {
    setInGameSens(val);
    localStorage.setItem('gc_mouse_igs', String(val));
  };

  // Calculated values
  const eDPI = dpi * (settings?.pointerSpeed ?? 10);
  const cmPer360 = inGameSens > 0 ? +((2.54 * 360) / (dpi * inGameSens * 0.022)).toFixed(1) : 0;

  if (loading) {
    return (
      <div className="mp-loading">
        <RefreshCw size={16} className="mp-spin" />
        <span>Detecting mouse devices…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mp-loading">
        <span>Failed to load mouse settings.</span>
        <button className="mp-icon-btn" onClick={loadAll} title="Retry" style={{ marginLeft: 8 }}>
          <RefreshCw size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="mp-container">
      {/* ── Device Info Panel ─────────────────────────────── */}
      <div className="mp-section">
        <div className="mp-section-head">
          <Mouse size={13} />
          <span>DETECTED DEVICE</span>
          <button className="mp-icon-btn" onClick={loadAll} title="Refresh">
            <RefreshCw size={11} />
          </button>
        </div>

        {primaryDevice ? (
          <div className="mp-device-card">
            <div className="mp-device-icon-wrap">
              <Mouse size={28} strokeWidth={1.2} />
            </div>
            <div className="mp-device-info">
              <div className="mp-device-name">{primaryDevice.Name}</div>
              <div className="mp-device-meta">
                <span className="mp-meta-tag">Mouse</span>
                <span className="mp-meta-tag">{primaryDevice.Status === 'OK' ? 'Connected' : primaryDevice.Status}</span>
                {primaryDevice.Manufacturer && <span className="mp-meta-tag">{primaryDevice.Manufacturer}</span>}
                {polling?.rateHz ? <span className="mp-meta-tag">{polling.rateHz} Hz</span> : null}
              </div>
              <div className="mp-device-id">{primaryDevice.InstanceId}</div>
            </div>
          </div>
        ) : (
          <div className="mp-empty">No mouse device detected</div>
        )}

        {devices.length > 1 && (
          <div className="mp-extra-devices">
            <span className="mp-extra-label">+{devices.length - 1} more device{devices.length > 2 ? 's' : ''}</span>
            {devices.slice(1).map((d, i) => (
              <div key={i} className="mp-extra-row">
                <span className="mp-extra-name">{d.Name}</span>
                <span className="mp-extra-status">{d.Status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Polling Rate Panel ────────────────────────────── */}
      {polling && (
        <div className="mp-section">
          <div className="mp-section-head">
            <Activity size={13} />
            <span>USB POLLING RATE</span>
          </div>

          <div className="mp-polling-display">
            <div className="mp-poll-hz">
              <span className="mp-poll-hz-value">{polling.rateHz}</span>
              <span className="mp-poll-hz-unit">Hz</span>
            </div>
            <div className="mp-poll-info">
              {polling.isOverridden
                ? <span className="mp-poll-badge mp-poll-badge--override">Override active ({polling.overrideMs}ms)</span>
                : <span className="mp-poll-badge mp-poll-badge--default">Default (8ms / 125Hz)</span>
              }
            </div>
          </div>

          <div className="mp-setting-row">
            <div className="mp-setting-info">
              <div className="mp-setting-label">
                <Activity size={12} />
                USB HID Poll Interval
              </div>
              <div className="mp-setting-desc">
                System-wide USB polling override. <strong>1ms = 1000Hz</strong>. Requires reboot.
                Hardware polling (e.g. Razer 8KHz) is set in vendor software.
              </div>
            </div>
            <div className="mp-queue-btns">
              {[
                { ms: 0, label: 'Default' },
                { ms: 8, label: '125Hz' },
                { ms: 4, label: '250Hz' },
                { ms: 2, label: '500Hz' },
                { ms: 1, label: '1000Hz' },
              ].map(opt => (
                <button
                  key={opt.ms}
                  className={`mp-queue-pill ${
                    (opt.ms === 0 && !polling.isOverridden) || (polling.overrideMs === opt.ms && opt.ms > 0)
                      ? 'mp-queue-pill--active' : ''
                  }`}
                  onClick={() => changePollInterval(opt.ms)}
                  disabled={applying === 'poll'}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Panel ────────────────────────────────── */}
      {settings && (
        <div className="mp-section">
          <div className="mp-section-head">
            <Gauge size={13} />
            <span>MOUSE SETTINGS</span>
          </div>

          {/* Enhance Pointer Precision toggle */}
          <div className="mp-setting-row">
            <div className="mp-setting-info">
              <div className="mp-setting-label">
                <Shield size={12} />
                Enhance Pointer Precision
              </div>
              <div className="mp-setting-desc">
                Mouse acceleration — recommended <strong>OFF</strong> for gaming
              </div>
            </div>
            <button
              className={`mp-toggle ${eppOff ? 'mp-toggle--off' : 'mp-toggle--on'}`}
              onClick={toggleEPP}
              disabled={applying === 'epp'}
            >
              <span className="mp-toggle-knob" />
              <span className="mp-toggle-label">{eppOff ? 'OFF' : 'ON'}</span>
            </button>
          </div>

          {/* Pointer speed slider */}
          <div className="mp-setting-row">
            <div className="mp-setting-info">
              <div className="mp-setting-label">
                <Zap size={12} />
                Pointer Speed
              </div>
              <div className="mp-setting-desc">
                Windows sensitivity (1–20, default 10)
              </div>
            </div>
            <div className="mp-slider-group">
              <input
                type="range"
                className="mp-slider"
                min={1} max={20} step={1}
                value={settings.pointerSpeed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSettings({ ...settings, pointerSpeed: v });
                }}
                onMouseUp={(e) => changeSpeed(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => changeSpeed(Number((e.target as HTMLInputElement).value))}
              />
              <span className="mp-slider-val">{settings.pointerSpeed}</span>
            </div>
          </div>

          {/* USB Data Queue Size */}
          <div className="mp-setting-row">
            <div className="mp-setting-info">
              <div className="mp-setting-label">
                <Gauge size={12} />
                USB Data Queue Size
              </div>
              <div className="mp-setting-desc">
                Lower = less input lag (default 100, gaming 20–32). Requires restart.
              </div>
            </div>
            <div className="mp-queue-btns">
              {[16, 32, 64, 100].map(v => (
                <button
                  key={v}
                  className={`mp-queue-pill ${settings.usbPollingInterval === v ? 'mp-queue-pill--active' : ''}`}
                  onClick={() => changeQueueSize(v)}
                  disabled={applying === 'queue'}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── DPI / Sensitivity Panel ─────────────────────── */}
      <div className="mp-section">
        <div className="mp-section-head">
          <Crosshair size={13} />
          <span>DPI / SENSITIVITY</span>
        </div>

        <div className="mp-setting-row">
          <div className="mp-setting-info">
            <div className="mp-setting-label">
              <Crosshair size={12} />
              Mouse DPI
            </div>
            <div className="mp-setting-desc">
              Select your mouse's current DPI to calculate eDPI and cm/360°. This <strong>does not change</strong> your actual mouse DPI — use your mouse's DPI button or vendor software (Bloody Software, Synapse, G Hub, etc.) for that.
            </div>
          </div>
          <div className="mp-dpi-controls">
            <div className="mp-queue-btns">
              {[400, 800, 1600, 3200].map(v => (
                <button
                  key={v}
                  className={`mp-queue-pill ${dpi === v && !showCustomDpi ? 'mp-queue-pill--active' : ''}`}
                  onClick={() => selectDpi(v)}
                >
                  {v}
                </button>
              ))}
              <button
                className={`mp-queue-pill ${![400, 800, 1600, 3200].includes(dpi) || showCustomDpi ? 'mp-queue-pill--active' : ''}`}
                onClick={() => setShowCustomDpi(!showCustomDpi)}
              >
                {![400, 800, 1600, 3200].includes(dpi) ? dpi : 'Custom'}
              </button>
            </div>
            {showCustomDpi && (
              <div className="mp-custom-dpi">
                <input
                  type="number"
                  className="mp-dpi-input"
                  placeholder="e.g. 1200"
                  min={100}
                  max={32000}
                  value={customDpi}
                  onChange={e => setCustomDpi(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyCustomDpi()}
                />
                <button className="mp-dpi-apply" onClick={applyCustomDpi}>Set</button>
              </div>
            )}
          </div>
        </div>

        {/* eDPI + cm/360 readout */}
        <div className="mp-dpi-stats">
          <div className="mp-dpi-stat">
            <span className="mp-dpi-stat-label">eDPI</span>
            <span className="mp-dpi-stat-value">{eDPI.toLocaleString()}</span>
            <span className="mp-dpi-stat-sub">DPI × Win Sens ({dpi} × {settings?.pointerSpeed ?? 10})</span>
          </div>
          <div className="mp-dpi-stat-divider" />
          <div className="mp-dpi-stat">
            <span className="mp-dpi-stat-label">cm / 360°</span>
            <span className="mp-dpi-stat-value">{cmPer360 > 0 ? `${cmPer360} cm` : '—'}</span>
            <span className="mp-dpi-stat-sub">
              In-game sens:
              <input
                type="number"
                className="mp-igs-input"
                min={0.01}
                max={100}
                step={0.1}
                value={inGameSens}
                onChange={e => updateInGameSens(parseFloat(e.target.value) || 0)}
              />
            </span>
          </div>
        </div>
      </div>

      {/* ── Advanced / HID Info ────────────────────────────── */}
      <div className="mp-section">
        <button className="mp-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          <Info size={13} />
          <span>RAW HID PROPERTIES</span>
          {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        <AnimatePresence>
          {showAdvanced && settings && (
            <motion.div
              className="mp-advanced-grid"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mp-adv-row"><span>MouseSpeed</span><span>{settings.mouseSpeed}</span></div>
              <div className="mp-adv-row"><span>MouseThreshold1</span><span>{settings.mouseThreshold1}</span></div>
              <div className="mp-adv-row"><span>MouseThreshold2</span><span>{settings.mouseThreshold2}</span></div>
              <div className="mp-adv-row"><span>MouseSensitivity</span><span>{settings.pointerSpeed}</span></div>
              <div className="mp-adv-row"><span>DataQueueSize</span><span>{settings.usbPollingInterval}</span></div>
              {polling && (
                <>
                  <div className="mp-adv-row"><span>PollInterval</span><span>{polling.isOverridden ? `${polling.overrideMs}ms` : 'default'}</span></div>
                  <div className="mp-adv-row"><span>EffectiveHz</span><span>{polling.rateHz}Hz</span></div>
                </>
              )}
              {primaryDevice && (
                <>
                  <div className="mp-adv-row"><span>InstanceId</span><span className="mp-adv-mono">{primaryDevice.InstanceId}</span></div>
                  <div className="mp-adv-row"><span>Manufacturer</span><span>{primaryDevice.Manufacturer || '—'}</span></div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Status toast ──────────────────────────────────── */}
      <AnimatePresence>
        {statusMsg && (
          <motion.div
            className="mp-status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {statusMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default React.memo(MousePollingRate);

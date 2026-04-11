import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wifi, MonitorPlay, ChevronRight, ChevronLeft, Check,
  Lightbulb, AlertTriangle, ClipboardCheck, Settings2,
  Network, Zap,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import {
  WIZARD_STEPS,
  CHECKLIST_ITEMS,
  TROUBLESHOOT_ITEMS,
  NDI_PRESETS,
  type ConnectionMethod,
  type NDISettings,
} from '../data/dualPCWizard';
import '../styles/DualPCWizard.css';

interface NetworkAdapter {
  name: string;
  description: string;
  linkSpeed: string;
  mac: string;
}

const ACCENT = '#00F2FF';

/** Pick best NDI preset based on detected link speed */
function recommendNDI(adapters: NetworkAdapter[]): NDISettings {
  const hasGigabit = adapters.some(a => {
    const s = a.linkSpeed || '';
    const mbps = parseFloat(s);
    return mbps >= 1000 || /gbps|gbit/i.test(s);
  });
  const has100 = adapters.some(a => {
    const s = a.linkSpeed || '';
    const mbps = parseFloat(s);
    return mbps >= 100;
  });
  if (hasGigabit) return NDI_PRESETS[0]; // Best quality
  if (has100)     return NDI_PRESETS[2]; // Low bandwidth
  return NDI_PRESETS[3];                 // WiFi fallback
}

const DualPCWizard: React.FC = () => {
  const { addToast } = useToast();

  // ── State ──
  const [method, setMethod] = useState<ConnectionMethod>('ndi');
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [adapters, setAdapters] = useState<NetworkAdapter[]>([]);
  const [loadingAdapters, setLoadingAdapters] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [expandedTrouble, setExpandedTrouble] = useState<string | null>(null);

  // ── Detect network adapters ──
  useEffect(() => {
    if (method !== 'ndi') return;
    let cancelled = false;
    (async () => {
      setLoadingAdapters(true);
      try {
        const res = await window.electron?.ipcRenderer?.invoke('obs:get-network-adapters');
        if (!cancelled && res?.success) setAdapters(res.adapters);
      } catch { /* silent */ }
      if (!cancelled) setLoadingAdapters(false);
    })();
    return () => { cancelled = true; };
  }, [method]);

  const recommended = useMemo(() => recommendNDI(adapters), [adapters]);

  // ── Filtered checklist / troubleshoot ──
  const filteredChecklist = useMemo(
    () => CHECKLIST_ITEMS.filter(c => c.method === 'both' || c.method === method),
    [method],
  );
  const filteredTrouble = useMemo(
    () => TROUBLESHOOT_ITEMS.filter(t => t.method === 'both' || t.method === method),
    [method],
  );

  const checkProgress = filteredChecklist.length
    ? Math.round((filteredChecklist.filter(c => checked.has(c.id)).length / filteredChecklist.length) * 100)
    : 0;

  // ── Handlers ──
  const toggleCheck = useCallback((id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const goNext = useCallback(() => {
    setCompletedSteps(prev => new Set(prev).add(step));
    setStep(s => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }, [step]);

  const goPrev = useCallback(() => {
    setStep(s => Math.max(s - 1, 0));
  }, []);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    try {
      const presetId = method === 'ndi' ? 'dualpc-ndi' : 'dualpc-capture';
      const res = await window.electron?.ipcRenderer?.invoke('obs:apply-dualpc-preset', presetId);
      if (res?.success) {
        addToast('Dual-PC OBS preset applied! Restart OBS to see changes.', 'success');
      } else {
        addToast(res?.message || 'Failed to apply preset.', 'error');
      }
    } catch {
      addToast('Failed to apply dual-PC preset.', 'error');
    }
    setDeploying(false);
  }, [method, addToast]);

  const currentStep = WIZARD_STEPS[step];
  const instructions = currentStep.instructions[method];

  return (
    <div className="dpw" style={{ '--dpw-accent': ACCENT } as React.CSSProperties}>

      {/* ── Connection Method Selector ── */}
      <div className="dpw-method">
        <button
          className={`dpw-method__btn ${method === 'ndi' ? 'dpw-method__btn--active' : ''}`}
          onClick={() => { setMethod('ndi'); setStep(0); }}
        >
          <Wifi size={22} className="dpw-method__icon" />
          <div className="dpw-method__text">
            <span className="dpw-method__title">NDI (Network)</span>
            <span className="dpw-method__subtitle">Low latency via Ethernet — no extra hardware</span>
          </div>
        </button>
        <button
          className={`dpw-method__btn ${method === 'capture-card' ? 'dpw-method__btn--active' : ''}`}
          onClick={() => { setMethod('capture-card'); setStep(0); }}
        >
          <MonitorPlay size={22} className="dpw-method__icon" />
          <div className="dpw-method__text">
            <span className="dpw-method__title">Capture Card (HDMI)</span>
            <span className="dpw-method__subtitle">Zero-latency via Elgato / AVerMedia device</span>
          </div>
        </button>
      </div>

      {/* ── Step Indicator ── */}
      <div className="dpw-stepper">
        {WIZARD_STEPS.map((s, i) => (
          <React.Fragment key={s.id}>
            <div
              className={`dpw-stepper__step ${i === step ? 'dpw-stepper__step--active' : ''} ${completedSteps.has(i) ? 'dpw-stepper__step--done' : ''}`}
              onClick={() => setStep(i)}
            >
              <div className="dpw-stepper__num">
                {completedSteps.has(i) ? <Check size={13} /> : i + 1}
              </div>
              <span className="dpw-stepper__label">{s.title}</span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div className={`dpw-stepper__line ${completedSteps.has(i) ? 'dpw-stepper__line--done' : ''}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ── Main Content Grid ── */}
      <div className="dpw-panel">

        {/* Left: Step Instructions */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${method}-${step}`}
            className="dpw-card"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
          >
            <div className="dpw-card__header">
              <h3 className="dpw-card__title">{currentStep.title}</h3>
              <p className="dpw-card__desc">{currentStep.description}</p>
            </div>

            <ol className="dpw-instructions">
              {instructions.map((text, i) => (
                <li key={i} className="dpw-instruction">
                  <span className="dpw-instruction__num">{i + 1}</span>
                  <span className="dpw-instruction__text">{text}</span>
                </li>
              ))}
            </ol>

            {currentStep.tips && currentStep.tips.length > 0 && (
              <div className="dpw-tips">
                {currentStep.tips.map((tip, i) => (
                  <div key={i} className="dpw-tip">
                    <Lightbulb size={14} className="dpw-tip__icon" />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Right: Sidebar */}
        <div className="dpw-sidebar">

          {/* NDI Settings Panel (only for NDI method) */}
          {method === 'ndi' && (
            <div className="dpw-ndi">
              <div className="dpw-ndi__title">
                <Network size={14} /> Network Adapters
              </div>
              <div className="dpw-ndi__adapters">
                {loadingAdapters ? (
                  <div className="dpw-ndi__adapter">
                    <span className="dpw-spinner" /> Detecting adapters…
                  </div>
                ) : adapters.length === 0 ? (
                  <div className="dpw-ndi__adapter">No active adapters detected</div>
                ) : adapters.map((a, i) => (
                  <div key={i} className="dpw-ndi__adapter">
                    <Wifi size={13} className="dpw-ndi__adapter-icon" />
                    <span className="dpw-ndi__adapter-name">{a.name}</span>
                    <span className="dpw-ndi__adapter-speed">{a.linkSpeed}</span>
                  </div>
                ))}
              </div>

              <div className="dpw-ndi__recommended">
                <div className="dpw-ndi__rec-label">Recommended NDI Settings</div>
                <div className="dpw-ndi__rec-grid">
                  <div className="dpw-ndi__rec-item">
                    <span className="dpw-ndi__rec-key">Resolution</span>
                    <span className="dpw-ndi__rec-val">{recommended.resolution}</span>
                  </div>
                  <div className="dpw-ndi__rec-item">
                    <span className="dpw-ndi__rec-key">Bitrate</span>
                    <span className="dpw-ndi__rec-val">{recommended.bitrate}</span>
                  </div>
                  <div className="dpw-ndi__rec-item">
                    <span className="dpw-ndi__rec-key">Codec</span>
                    <span className="dpw-ndi__rec-val">{recommended.codec}</span>
                  </div>
                  <div className="dpw-ndi__rec-item">
                    <span className="dpw-ndi__rec-key">Link</span>
                    <span className="dpw-ndi__rec-val">{recommended.linkSpeed}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Verification Checklist */}
          <div className="dpw-checklist">
            <div className="dpw-checklist__title">
              <ClipboardCheck size={14} /> Verification Checklist
            </div>
            <div className="dpw-checklist__progress">
              <div className="dpw-checklist__bar" style={{ width: `${checkProgress}%` }} />
            </div>
            <div className="dpw-checklist__items">
              {filteredChecklist.map(c => (
                <div
                  key={c.id}
                  className={`dpw-check ${checked.has(c.id) ? 'dpw-check--done' : ''}`}
                  onClick={() => toggleCheck(c.id)}
                >
                  <div className="dpw-check__box">
                    {checked.has(c.id) && <Check size={11} color="#fff" />}
                  </div>
                  <span className="dpw-check__label">{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Troubleshooting */}
          <div className="dpw-trouble">
            <div className="dpw-trouble__title">
              <AlertTriangle size={14} /> Troubleshooting
            </div>
            <div className="dpw-trouble__items">
              {filteredTrouble.map(t => (
                <div
                  key={t.issue}
                  className="dpw-trouble__item"
                  onClick={() => setExpandedTrouble(expandedTrouble === t.issue ? null : t.issue)}
                >
                  <div className="dpw-trouble__issue">
                    <AlertTriangle size={12} /> {t.issue}
                  </div>
                  <AnimatePresence>
                    {expandedTrouble === t.issue && (
                      <motion.div
                        className="dpw-trouble__solution"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {t.solution}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav Buttons ── */}
      <div className="dpw-nav">
        <button className="dpw-nav__btn" onClick={goPrev} disabled={step === 0}>
          <ChevronLeft size={16} /> Previous
        </button>
        {step < WIZARD_STEPS.length - 1 ? (
          <button className="dpw-nav__btn dpw-nav__btn--primary" onClick={goNext}>
            Next <ChevronRight size={16} />
          </button>
        ) : (
          <button className="dpw-nav__btn dpw-nav__btn--primary" onClick={() => setCompletedSteps(prev => new Set(prev).add(step))}>
            Finish <Check size={16} />
          </button>
        )}
      </div>

      {/* ── Deploy Preset Bar ── */}
      <div className="dpw-deploy">
        <Settings2 size={20} style={{ color: ACCENT, opacity: 0.6, flexShrink: 0 }} />
        <div className="dpw-deploy__info">
          <div className="dpw-deploy__label">
            Apply {method === 'ndi' ? 'NDI Streaming PC' : 'Capture Card Streaming PC'} OBS Preset
          </div>
          <div className="dpw-deploy__sub">
            Pre-configured OBS profile optimized for a dedicated streaming PC
          </div>
        </div>
        <button className="dpw-deploy__btn" onClick={handleDeploy} disabled={deploying}>
          {deploying ? <><span className="dpw-spinner" /> Applying…</> : <><Zap size={15} /> Deploy Preset</>}
        </button>
      </div>
    </div>
  );
};

export default React.memo(DualPCWizard);

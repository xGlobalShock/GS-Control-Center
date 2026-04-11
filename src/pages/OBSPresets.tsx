import React, { useState } from 'react';
import { OBS_PRESETS } from '../data/obsPresets';
import { applyObsPreset, launchObs } from '../services/obsPresetsService';
import { useToast } from '../contexts/ToastContext';
import { motion } from 'framer-motion';
import { Check, Zap, Radio, MonitorPlay } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import DualPCWizard from '../components/DualPCWizard';
import '../styles/OBSPresets.css';

const ICON_MAP: Record<string, React.ReactNode> = {
  broadcast: <Radio size={48} />,
  gamepad:   <Radio size={48} />,
};

/* Only show the Gaming preset */
const GAMING_PRESET = OBS_PRESETS.find(p => p.id === 'gaming') ?? OBS_PRESETS[0];

const OBSPresets: React.FC = () => {
  const [loadingPreset, setLoadingPreset]   = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const [tab, setTab] = useState<'preset' | 'dualpc'>('preset');
  const { addToast } = useToast();

  const preset = GAMING_PRESET;
  const loading = applyingPreset === preset.id || loadingPreset === preset.id;
  const applying = applyingPreset === preset.id;
  const launching = loadingPreset === preset.id;

  const handleApplyPreset = async (presetId: string) => {
    setApplyingPreset(presetId);
    try {
      const result = await applyObsPreset(presetId);
      if (result.success) {
        addToast('Preset deployed! Launching OBS...', 'success');
        setTimeout(async () => {
          setLoadingPreset(presetId);
          try {
            const lr = await launchObs();
            if (lr.success) addToast('OBS Studio launched successfully!', 'success');
            else addToast(lr.message || 'Failed to launch OBS', 'error');
          } catch { addToast('Failed to launch OBS', 'error'); }
          finally { setTimeout(() => setLoadingPreset(null), 2000); }
        }, 500);
      } else {
        addToast(result.message, 'error');
      }
    } catch { addToast('Failed to deploy preset', 'error'); }
    finally { setApplyingPreset(null); }
  };

  return (
    <div className="aur" style={{ '--a-accent': preset.color } as React.CSSProperties}>
      {/* OG Page Header with tab toggle */}
      <PageHeader
        icon={<Radio size={16} />}
        title="Stream"
        actions={
          <div className="aur-tabs">
            <button
              className={`aur-tab ${tab === 'preset' ? 'aur-tab--active' : ''}`}
              onClick={() => setTab('preset')}
            >
              <Radio size={13} /> OBS Preset
            </button>
            <button
              className={`aur-tab ${tab === 'dualpc' ? 'aur-tab--active' : ''}`}
              onClick={() => setTab('dualpc')}
            >
              <MonitorPlay size={13} /> Dual-PC Guide
            </button>
          </div>
        }
      />

      {tab === 'dualpc' ? (
        <DualPCWizard />
      ) : (
      /* Single preset showcase */
      <motion.div
        className="aur-slide"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 26 }}
      >
        {/* Floating icon orb */}
        <div className="aur-orb">
          <div className="aur-orb__ring aur-orb__ring--outer" />
          <div className="aur-orb__ring aur-orb__ring--inner" />
          <div className="aur-orb__glow" />
          <div className="aur-orb__icon">{ICON_MAP[preset.iconName]}</div>
        </div>

        {/* Preset name */}
        <h1 className="aur-title">{preset.name}</h1>

        {/* Difficulty tag */}
        <span className={`aur-diff aur-diff--${preset.difficulty.toLowerCase()}`}>
          {preset.difficulty}
        </span>

        {/* Description */}
        <p className="aur-desc">{preset.description}</p>

        {/* Feature pills row */}
        <div className="aur-features">
          {preset.features.map((feat, fi) => (
            <motion.div
              key={fi}
              className="aur-feat"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + fi * 0.05 }}
            >
              <Check size={18} className="aur-feat__icon" />
              <span>{feat}</span>
            </motion.div>
          ))}
        </div>

        {/* Deploy button */}
        <motion.button
          className={`aur-deploy ${loading ? 'aur-deploy--busy' : ''}`}
          onClick={() => handleApplyPreset(preset.id)}
          disabled={loading}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <div className="aur-deploy__shimmer" />
          {applying ? (
            <><span className="aur-spinner" /> Deploying...</>
          ) : launching ? (
            <><span className="aur-spinner" /> Launching OBS...</>
          ) : (
            <>Setup OBS</>
          )}
        </motion.button>
      </motion.div>
      )}
    </div>
  );
};

export default React.memo(OBSPresets);


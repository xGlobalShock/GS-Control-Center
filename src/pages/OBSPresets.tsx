import React, { useState } from 'react';
import { OBS_PRESETS } from '../data/obsPresets';
import { applyObsPreset, launchObs } from '../services/obsPresetsService';
import { useToast } from '../contexts/ToastContext';
import { motion } from 'framer-motion';
import { Broadcast, Monitor } from 'phosphor-react';
import { Radio, Zap, ChevronRight, Layers, Sparkles } from 'lucide-react';
import '../styles/OBSPresets.css';

/* Icon mapping */
const getIconComponent = (iconName: string) => {
  const map: Record<string, React.ReactNode> = {
    broadcast: <Broadcast size={26} weight="bold" />,
    gamepad: <Monitor size={26} weight="bold" />,
  };
  return map[iconName] || null;
};

const OBSPresets: React.FC = () => {
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const { addToast } = useToast();

  const handleApplyPreset = async (presetId: string) => {
    setApplyingPreset(presetId);
    try {
      const result = await applyObsPreset(presetId);
      if (result.success) {
        addToast('Preset applied successfully! Launching OBS with the new configuration...', 'success');
        setTimeout(async () => {
          setLoadingPreset(presetId);
          try {
            const launchResult = await launchObs();
            if (launchResult.success) addToast('OBS Studio launched successfully!', 'success');
            else addToast(launchResult.message || 'Failed to launch OBS', 'error');
          } catch { addToast('Failed to launch OBS', 'error'); }
          finally { setTimeout(() => setLoadingPreset(null), 2000); }
        }, 500);
      } else {
        addToast(result.message, 'error');
      }
    } catch { addToast('Failed to apply preset', 'error'); }
    finally { setApplyingPreset(null); }
  };

  const isLoading = (id: string) => applyingPreset === id || loadingPreset === id;

  return (
    <motion.div className="sp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      {/* ═══ Grid background ═══ */}
      <div className="sp-grid-bg" />

      <div className="sp-layout">
        {/* ═══════════ LEFT — Hero ═══════════ */}
        <motion.div
          className="sp-hero"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Animated broadcast ring */}
          <div className="sp-ring-wrap">
            <svg className="sp-ring-svg" viewBox="0 0 200 200">
              <circle className="sp-ring sp-ring--outer" cx="100" cy="100" r="90" />
              <circle className="sp-ring sp-ring--mid" cx="100" cy="100" r="68" />
              <circle className="sp-ring sp-ring--inner" cx="100" cy="100" r="46" />
              {/* Orbiting dot */}
              <circle className="sp-ring-dot" cx="100" cy="10" r="4" />
            </svg>
            <div className="sp-ring-icon">
              <Radio size={32} />
            </div>
          </div>

          <div className="sp-hero-text">
            <div className="sp-hero-label">
              <Sparkles size={11} />
              OBS STUDIO INTEGRATION
            </div>

            <h1 className="sp-hero-title">
              Streaming<br /><span className="sp-hero-accent">Presets</span>
            </h1>

            <p className="sp-hero-desc">
              One-click OBS configurations crafted for performance and aesthetics.
              Apply a preset and launch OBS instantly — overlays, scenes, and encoder
              settings are handled automatically.
            </p>

            <div className="sp-hero-stats">
              <div className="sp-hero-stat">
                <Layers size={14} />
                <span className="sp-hero-stat__val">{OBS_PRESETS.length}</span>
                <span className="sp-hero-stat__lbl">Presets</span>
              </div>
              <div className="sp-hero-stat">
                <Zap size={14} />
                <span className="sp-hero-stat__val">{OBS_PRESETS.reduce((a, p) => a + p.features.length, 0)}</span>
                <span className="sp-hero-stat__lbl">Features</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ═══════════ RIGHT — Cards ═══════════ */}
        <div className="sp-cards">
          {OBS_PRESETS.map((preset, i) => {
            const loading = isLoading(preset.id);
            const applying = applyingPreset === preset.id;
            const launching = loadingPreset === preset.id;
            const hovered = hoveredCard === preset.id;

            return (
              <motion.div
                key={preset.id}
                className={`sp-card ${loading ? 'sp-card--busy' : ''}`}
                style={{ '--accent': preset.color } as React.CSSProperties}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.15, type: 'spring', stiffness: 160, damping: 18 }}
                onMouseEnter={() => setHoveredCard(preset.id)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                {/* Top accent bar */}
                <div className="sp-card-bar" />
                {loading && <div className="sp-card-sweep" />}

                {/* Header row */}
                <div className="sp-card-head">
                  <div className="sp-card-icon">{getIconComponent(preset.iconName)}</div>
                  <div className="sp-card-meta">
                    <h2 className="sp-card-title">{preset.name}</h2>
                    <span className={`sp-badge sp-badge--${preset.difficulty.toLowerCase()}`}>
                      {preset.difficulty}
                    </span>
                  </div>
                </div>

                <p className="sp-card-desc">{preset.description}</p>

                {/* Feature chips */}
                <div className="sp-card-chips">
                  {preset.features.map((feat, fi) => (
                    <span key={fi} className="sp-chip">{feat}</span>
                  ))}
                </div>

                {/* Apply button */}
                <button
                  className="sp-card-btn"
                  onClick={() => handleApplyPreset(preset.id)}
                  disabled={loading}
                >
                  {applying ? (
                    <><span className="sp-spinner" /> Applying...</>
                  ) : launching ? (
                    <><span className="sp-spinner" /> Launching OBS...</>
                  ) : (
                    <>
                      Apply Preset
                      <ChevronRight size={14} className="sp-card-btn__arrow" />
                    </>
                  )}
                </button>

                {/* Bottom rail glow */}
                <div className="sp-card-rail" />
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(OBSPresets);


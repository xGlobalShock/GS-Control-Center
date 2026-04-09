import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import '../styles/LoginPage.css';

const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const LogoIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 36, height: 36 }}>
    <path
      d="M24 4L8 10v12c0 10 6.8 19.4 16 22 9.2-2.6 16-12 16-22V10L24 4z"
      stroke="url(#logoGrad)"
      strokeWidth="2"
      strokeLinejoin="round"
      fill="rgba(0,242,255,0.06)"
    />
    <path
      d="M24 16v8M24 28v2"
      stroke="url(#logoGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <defs>
      <linearGradient id="logoGrad" x1="8" y1="4" x2="40" y2="44">
        <stop stopColor="#00f2ff" />
        <stop offset="1" stopColor="#7b61ff" />
      </linearGradient>
    </defs>
  </svg>
);

const TwitchIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
  </svg>
);

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [loading, setLoading] = useState<'discord' | 'twitch' | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const controls = window.electron?.windowControls;
    if (!controls) return;
    controls.isMaximized().then(setIsMaximized);
    const unsub = controls.onMaximizedChange(setIsMaximized);
    return unsub;
  }, []);

  const handleMinimize = () => window.electron?.windowControls?.minimize();
  const handleMaximize = () => window.electron?.windowControls?.maximize();
  const handleClose    = () => window.electron?.windowControls?.close();

  const handleLogin = async (provider: 'discord' | 'twitch') => {
    setLoading(provider);
    try {
      await login(provider);
    } finally {
      setTimeout(() => setLoading(null), 8000);
    }
  };

  return (
    <div className="lp-root">
      {/* ── Window controls ── */}
      <div className="lp-wc" aria-label="Window controls">
        <button className="lp-wc-btn lp-wc-btn--min" onClick={handleMinimize} aria-label="Minimize"><Minus size={12} /></button>
        <button className="lp-wc-btn lp-wc-btn--max" onClick={handleMaximize} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? <Copy size={11} /> : <Square size={11} />}
        </button>
        <button className="lp-wc-btn lp-wc-btn--close" onClick={handleClose} aria-label="Close"><X size={12} /></button>
      </div>

      {/* ── Layered background ── */}
      <div className="lp-bg-deep" aria-hidden />

      {/* ── Nebula clouds ── */}
      <div className="lp-nebula" aria-hidden>
        <div className="lp-nebula-cloud" /><div className="lp-nebula-cloud" /><div className="lp-nebula-cloud" />
      </div>

      {/* ── Hex grid ── */}
      <div className="lp-hex-grid" aria-hidden />

      {/* ── Orbiting ring structures ── */}
      <div className="lp-orbit-rings" aria-hidden>
        <div className="lp-orbit-ring" /><div className="lp-orbit-ring" /><div className="lp-orbit-ring" />
      </div>

      {/* ── Chromatic aberration streaks ── */}
      <div className="lp-chroma" aria-hidden>
        <div className="lp-chroma-streak" /><div className="lp-chroma-streak" /><div className="lp-chroma-streak" />
        <div className="lp-chroma-streak" /><div className="lp-chroma-streak" />
      </div>

      {/* ── Volumetric god-rays ── */}
      <div className="lp-godrays" aria-hidden />

      {/* ── Rising embers ── */}
      <div className="lp-particles" aria-hidden>
        <div className="lp-particle" /><div className="lp-particle" /><div className="lp-particle" />
        <div className="lp-particle" /><div className="lp-particle" /><div className="lp-particle" />
        <div className="lp-particle" /><div className="lp-particle" /><div className="lp-particle" />
        <div className="lp-particle" />
      </div>

      {/* ── Noise overlay ── */}
      <div className="lp-noise" aria-hidden />

      {/* ── Card ── */}
      <motion.div
        className="lp-card"
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Corner accents */}
        <span className="lp-corner lp-corner--tl" aria-hidden />
        <span className="lp-corner lp-corner--tr" aria-hidden />
        <span className="lp-corner lp-corner--bl" aria-hidden />
        <span className="lp-corner lp-corner--br" aria-hidden />

        {/* Top accent bar */}
        <div className="lp-accent-bar" aria-hidden />

        {/* Logo with rotating ring */}
        <motion.div
          className="lp-logo-wrap"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="lp-logo-ring" aria-hidden />
          <LogoIcon />
        </motion.div>

        {/* Heading */}
        <motion.div
          className="lp-heading"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.45 }}
        >
          <h1 className="lp-title">GS <span className="lp-title-accent">CENTER</span></h1>
          <p className="lp-subtitle">Performance Control Center</p>
        </motion.div>

        {/* Version / status badge */}
        <motion.div
          className="lp-version"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          <span className="lp-version-dot" />
          <span>AWAITING AUTHENTICATION</span>
        </motion.div>

        {/* Divider */}
        <motion.div
          className="lp-divider"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Auth buttons */}
        <motion.div
          className="lp-buttons"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.48, duration: 0.45 }}
        >
          <button
            className="lp-btn lp-btn--discord"
            onClick={() => handleLogin('discord')}
            disabled={!!loading}
          >
            <span className="lp-btn-bg" aria-hidden />
            <span className="lp-btn-content">
              {loading === 'discord'
                ? <span className="lp-spinner" />
                : <span className="lp-btn-icon"><DiscordIcon /></span>
              }
              <span className="lp-btn-label">Continue with Discord</span>
            </span>
            <span className="lp-btn-glow" aria-hidden />
          </button>

          <button
            className="lp-btn lp-btn--twitch"
            onClick={() => handleLogin('twitch')}
            disabled={!!loading}
          >
            <span className="lp-btn-bg" aria-hidden />
            <span className="lp-btn-content">
              {loading === 'twitch'
                ? <span className="lp-spinner" />
                : <span className="lp-btn-icon"><TwitchIcon /></span>
              }
              <span className="lp-btn-label">Continue with Twitch</span>
            </span>
            <span className="lp-btn-glow" aria-hidden />
          </button>
        </motion.div>

        {/* Footer */}
        <motion.p
          className="lp-footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.58, duration: 0.4 }}
        >
          Sign in to access your GS Center tools
        </motion.p>
      </motion.div>
    </div>
  );
};

export default LoginPage;

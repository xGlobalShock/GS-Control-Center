import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Crown, Shield, User, ChevronDown, ShieldCheck, Zap, CreditCard, Share2, Settings as SettingsIcon, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SettingsPage from '../pages/Settings';
import ReportCardButton from './ReportCardButton';
import type { ReportCardHandle } from './ReportCardButton';
import '../styles/Auth.css';

const ROLE_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  owner: { label: 'Owner',  className: 'role-owner', icon: <Crown  size={10} /> },
  admin: { label: 'Admin',  className: 'role-admin', icon: <Shield size={10} /> },
  pro:   { label: 'PRO',    className: 'role-pro',   icon: <Zap    size={10} /> },
  user:  { label: 'Free',   className: 'role-free',  icon: <User   size={10} /> },
};

const DiscordIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const TwitchIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
  </svg>
);

const PROVIDER_MAP: Record<string, { icon: React.ReactNode; name: string; color: string }> = {
  discord: { icon: <DiscordIcon size={13} />, name: 'Discord', color: '#5865f2' },
  twitch:  { icon: <TwitchIcon  size={13} />, name: 'Twitch',  color: '#9146ff' },
};

const ProfileDropdown: React.FC = () => {
  const { profile, user, loading, logout, currentProvider, isOwner, profileReady } = useAuth();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reportRef = useRef<ReportCardHandle>(null);

  // Cache the last valid profile so a brief auth-state flicker (token refresh
  // emitting a null session) doesn't unmount the component and reset open state.
  const prevProfileRef = useRef(profile);
  if (profile) prevProfileRef.current = profile;
  const stableProfile = profile ?? prevProfileRef.current;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (!showSettings) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSettings(false); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [showSettings]);

  if (!stableProfile && !user) return null;

  // Show loading skeleton while profile is being fetched
  if (!stableProfile) {
    return (
      <div className="pd-wrapper">
        <div className="pd-trigger pd-trigger--loading" style={{ pointerEvents: 'none' }}>
          <div className="pd-skel-avatar" />
          <div className="pd-skel-name" />
          <div className="pd-skel-badge" />
        </div>
      </div>
    );
  }

  /* ── Signed in ───────────────────────────────────────────────────── */
  const role = ROLE_CONFIG[stableProfile!.role] || ROLE_CONFIG.user;
  const provider = currentProvider ? PROVIDER_MAP[currentProvider] : null;

  return (
    <div className="pd-wrapper" ref={ref}>
      <button className="pd-trigger" onClick={() => setOpen(p => !p)} title={stableProfile!.username}>
        <div className={`pd-trigger-avatar-wrap pd-trigger-avatar-wrap--${stableProfile!.role}`}>
          {stableProfile!.avatar_url
            ? <img src={stableProfile!.avatar_url} alt="" className="pd-trigger-avatar" />
            : <div className="pd-trigger-avatar pd-trigger-avatar--ghost"><User size={13} /></div>
          }
          {provider && (
            <span className="pd-trigger-provider" style={{ color: provider.color }} title={provider.name}>
              {provider.icon}
            </span>
          )}
        </div>
        <span className="pd-trigger-name">{stableProfile!.username}</span>
        <span className={`pd-role-chip pd-role-chip--${profileReady ? stableProfile!.role : 'loading'}`}>
          {profileReady ? <>{role.icon}{role.label}</> : <span className="pd-role-shimmer" />}
        </span>
        <ChevronDown size={11} className={`pd-chevron${open ? ' pd-chevron--open' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="pd-panel"
            data-role={stableProfile!.role}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Hero */}
            <div className={`pd-hero pd-hero--${stableProfile!.role}`}>
              <div className={`pd-hero-avatar-wrap pd-hero-avatar-wrap--${stableProfile!.role}`}>
                {stableProfile!.avatar_url
                  ? <img src={stableProfile!.avatar_url} alt="" className="pd-hero-avatar" />
                  : <div className="pd-hero-avatar-ghost"><User size={24} /></div>
                }
                {provider && (
                  <span className="pd-hero-provider-badge" style={{ color: provider.color }} title={provider.name}>
                    {provider.icon}
                  </span>
                )}
              </div>
              <div className="pd-hero-info">
                <span className="pd-hero-name">{stableProfile!.username}</span>
                <span className="pd-hero-email">{stableProfile!.email}</span>
                <span className={`pd-role-chip pd-role-chip--${profileReady ? stableProfile!.role : 'loading'}`}>
                  {profileReady ? <>{role.icon}{role.label}</> : <span className="pd-role-shimmer" />}
                </span>
              </div>
            </div>

            <div className="pd-divider" />

            {isOwner && (
              <button
                className="pd-action pd-action--admin"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('navigate:page', { detail: { page: 'admin' } }));
                  setOpen(false);
                }}
              >
                <span className="pd-action-icon"><ShieldCheck size={14} /></span>
                <span>Admin Panel</span>
              </button>
            )}

            {stableProfile!.role === 'user' && (
              <button
                className="pd-action pd-action--upgrade"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('navigate:page', { detail: { page: 'subscription' } }));
                  setOpen(false);
                }}
              >
                <span className="pd-action-icon"><Zap size={14} /></span>
                <span>Upgrade to PRO</span>
              </button>
            )}

            <button
              className="pd-action pd-action--subscription"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('navigate:page', { detail: { page: 'subscription' } }));
                setOpen(false);
              }}
            >
              <span className="pd-action-icon"><CreditCard size={14} /></span>
              <span>Manage Subscription</span>
            </button>

            <button
              className="pd-action pd-action--report"
              onClick={() => { reportRef.current?.generate(); setOpen(false); }}
            >
              <span className="pd-action-icon"><Share2 size={14} /></span>
              <span>Share Hardware Report</span>
            </button>

            {/* Subscription section */}
            <button
              className="pd-action pd-action--settings"
              onClick={() => { setShowSettings(true); setOpen(false); }}
            >
              <span className="pd-action-icon"><SettingsIcon size={14} /></span>
              <span>Settings</span>
            </button>

            <button className="pd-action pd-action--logout" onClick={() => { logout(); setOpen(false); }}>
              <span className="pd-action-icon"><LogOut size={14} /></span>
              <span>Sign Out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <ReportCardButton ref={reportRef} headless />
      {showSettings && createPortal(
        <div
          className="settings-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <div className="settings-modal">
            <div className="settings-modal-header">
              <span className="settings-modal-title">
                <SettingsIcon size={14} />
                Settings
              </span>
              <button
                className="settings-modal-close"
                onClick={() => setShowSettings(false)}
                aria-label="Close Settings"
              >
                <X size={14} />
              </button>
            </div>
            <div className="settings-modal-body">
              <SettingsPage />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProfileDropdown;

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Zap, Gamepad2, RefreshCw, Layers, SlidersHorizontal, PieChart, X, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import '../styles/Auth.css';

const PRO_FEATURES = [
  { icon: <Zap size={16} />,                label: 'PC Tweaks',         desc: 'Advanced system optimizations' },
  { icon: <Gamepad2 size={16} />,            label: 'Games Library',     desc: 'Game benchmarks & config tools' },
  { icon: <RefreshCw size={16} />,           label: 'Software Updates',  desc: 'Batch update all software' },
  { icon: <Layers size={16} />,              label: 'Apps Manager',      desc: 'Install, uninstall & debloat' },
  { icon: <SlidersHorizontal size={16} />,   label: 'Utilities',         desc: 'Game cache & system cleanup' },
  { icon: <PieChart size={16} />,            label: 'Disk Analyzer',     desc: 'Storage usage visualization' },
  { icon: <SlidersHorizontal size={16} />,   label: 'Win Tweaks',        desc: 'Registry & system-level tweaks' },
  { icon: <SlidersHorizontal size={16} />,   label: 'Win Preferences',   desc: 'Quick Windows preference toggles' },
];

interface PaywallModalProps {
  pageName?: string;
  onClose?: () => void;
}

const PaywallModal: React.FC<PaywallModalProps> = ({ pageName, onClose }) => {
  const { user, login, refreshProfile } = useAuth();
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [successExpiry, setSuccessExpiry] = useState<string | null>(null);

  // Auto-close the success screen after 3 seconds
  useEffect(() => {
    if (successExpiry === null) return;
    const t = setTimeout(() => onClose?.(), 3000);
    return () => clearTimeout(t);
  }, [successExpiry, onClose]);

  const handleLogin = async (provider: 'discord' | 'twitch') => {
    setLoginLoading(provider);
    try {
      await login(provider);
    } finally {
      setLoginLoading(null);
    }
  };

  const handlePayPalCheckout = async () => {
    if (!user) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const { data: orderData, error: orderError } = await supabase.functions.invoke(
        'create-paypal-order',
        { body: { user_id: user.id } }
      );
      if (orderError || !orderData?.approval_url) {
        throw new Error(orderError?.message || 'Failed to create payment order');
      }
      const result = await (window as any).electron.ipcRenderer.invoke('paypal:checkout', {
        approval_url: orderData.approval_url,
        order_id: orderData.order_id,
      });
      if (result?.cancelled) { setCheckoutLoading(false); return; }
      if (!result?.order_id) throw new Error('No order ID returned from PayPal');
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'verify-payment',
        { body: { user_id: user.id, transaction_id: result.order_id } }
      );
      if (verifyError || !verifyData?.success) {
        throw new Error(verifyError?.message || 'Payment verification failed');
      }
      await refreshProfile();
      setSuccessExpiry(verifyData.pro_expires_at ?? null);
    } catch (err: any) {
      setCheckoutError(err?.message || 'Payment failed. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="paywall-overlay">
      <motion.div
        className="paywall-modal"
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* ── Payment success screen ── */}
        {successExpiry !== null ? (
          <div className="paywall-success">
            <div className="paywall-success-icon">
              <CheckCircle2 size={44} strokeWidth={1.5} />
            </div>
            <h2 className="paywall-success-title">You're now PRO!</h2>
            <p className="paywall-success-sub">
              Payment confirmed. All features are unlocked.
            </p>
            <p className="paywall-success-expiry">
              Active until{' '}
              {new Date(successExpiry).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <div className="paywall-success-close-bar" />
          </div>
        ) : (
          <>
            {onClose && (
              <button className="paywall-close" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            )}

            {/* Header */}
            <div className="paywall-header">
              <div className="paywall-icon-wrap">
                <Crown size={28} />
              </div>
              <h2 className="paywall-title">
                {pageName ? `${pageName} is a Pro Feature` : 'Upgrade to Pro'}
              </h2>
              <p className="paywall-subtitle">
                Unlock the full power of GS Center with a Pro subscription
              </p>
            </div>

            {/* Feature list */}
            <div className="paywall-features">
              {PRO_FEATURES.map((f) => (
                <div key={f.label} className="paywall-feature">
                  <span className="paywall-feature-icon">{f.icon}</span>
                  <div className="paywall-feature-text">
                    <span className="paywall-feature-label">{f.label}</span>
                    <span className="paywall-feature-desc">{f.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            {!user ? (
              <div className="paywall-cta">
                <p className="paywall-cta-note">Sign in to purchase a PRO subscription</p>
                <button
                  className="paywall-btn paywall-btn-discord"
                  onClick={() => handleLogin('discord')}
                  disabled={!!loginLoading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                  {loginLoading === 'discord' ? 'Connecting…' : 'Sign in with Discord'}
                </button>
                <button
                  className="paywall-btn paywall-btn-twitch"
                  onClick={() => handleLogin('twitch')}
                  disabled={!!loginLoading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
                  {loginLoading === 'twitch' ? 'Connecting…' : 'Sign in with Twitch'}
                </button>
              </div>
            ) : (
              <div className="paywall-cta">
                {checkoutError && (
                  <p className="paywall-error">{checkoutError}</p>
                )}
                <button
                  className="paywall-btn paywall-btn-upgrade"
                  onClick={handlePayPalCheckout}
                  disabled={checkoutLoading}
                >
                  {checkoutLoading
                    ? <><Loader2 size={16} className="upgrade-spin" /> Processing…</>
                    : <><Crown size={18} /> Upgrade to Pro — $4.99</>
                  }
                </button>
                <p className="paywall-cta-note">
                  Secure checkout via PayPal · Pro activates instantly
                </p>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
};

/* ─── ProGuard Wrapper ───────────────────────────────────────────────── */

interface ProGuardProps {
  pageName?: string;
  children: React.ReactNode;
}

export const ProGuard: React.FC<ProGuardProps> = ({ pageName, children }) => {
  const { isPro, loading } = useAuth();

  if (loading) return null;

  // PRO users — full access
  if (isPro) return <>{children}</>;

  // Free or not logged in — preview mode (ProLockedWrapper + ProPreviewBanner handle the locked state)
  return <>{children}</>;
};

export default PaywallModal;

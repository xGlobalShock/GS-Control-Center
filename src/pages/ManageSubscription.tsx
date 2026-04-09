import React, { useState, useEffect } from 'react';
import { Crown, Zap, CalendarDays, XCircle, CheckCircle2, Infinity as InfinityIcon, CreditCard, AlertTriangle, Loader2, Lock, Shield } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import '../styles/ManageSubscription.css';

/* ── Helpers ────────────────────────────────────────────────────────── */
const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

const useCountdown = (expiresAt: string | null, role: string) => {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!expiresAt || role !== 'pro') { setText(''); return; }
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setText('Expired'); return; }
      const d = Math.floor(diff / 86_400_000);
      const h = Math.floor((diff % 86_400_000) / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setText(d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, role]);
  return text;
};

/* ── Status helpers ─────────────────────────────────────────────────── */
const getStatusLabel = (
  role: string,
  subscriptionStatus: string | null,
  isExpired: boolean,
): { label: string; mod: string } => {
  if (role === 'owner' || role === 'admin') return { label: 'Lifetime', mod: 'lifetime' };
  if (isExpired)                             return { label: 'Expired',  mod: 'expired'  };
  if (subscriptionStatus === 'cancelled')    return { label: 'Cancelled — access until expiry', mod: 'cancelled' };
  if (role === 'pro')                        return { label: 'Active',   mod: 'active'   };
  return { label: 'Free', mod: 'free' };
};

/* ═══════════════════════════════════════════════════════════════════
   Page
═══════════════════════════════════════════════════════════════════ */
const ManageSubscription: React.FC = () => {
  const { profile, loading, isExpired, cancelSubscription, refreshProfile } = useAuth();
  const countdown = useCountdown(profile?.pro_expires_at ?? null, profile?.role ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelDone, setCancelDone] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [waitingBrowser, setWaitingBrowser] = useState(false);

  useEffect(() => {
    if (!loading && !profile) {
      window.dispatchEvent(new CustomEvent('navigate:page', { detail: { page: 'dashboard' } }));
    }
  }, [loading, profile]);

  if (!profile) return null;

  const { role, pro_source, pro_expires_at, subscription_status } = profile;
  const isElevated = role === 'admin' || role === 'owner';
  const isPro = role === 'pro' && !isExpired;
  const isFree = role === 'user';
  const { label: statusLabel, mod: statusMod } = getStatusLabel(role, subscription_status ?? null, isExpired);

  const handleCancel = async () => {
    setCancelling(true);
    await cancelSubscription();
    setCancelling(false);
    setConfirmCancel(false);
    setCancelDone(true);
  };

  const handleUpgrade = async () => {
    if (!profile) return;
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      // 1) Create PayPal order
      const { data: orderData, error: orderError } = await supabase.functions.invoke(
        'create-paypal-order',
        { body: { user_id: profile.id } }
      );
      if (orderError || !orderData?.approval_url) {
        throw new Error(orderError?.message || 'Failed to create payment order');
      }

      // 2) Open checkout in system browser
      setWaitingBrowser(true);
      const result = await (window as any).electron.ipcRenderer.invoke('paypal:checkout', {
        approval_url: orderData.approval_url,
        order_id: orderData.order_id,
      });
      setWaitingBrowser(false);

      if (result?.cancelled) {
        if (result?.timeout) {
          setUpgradeError('Checkout timed out. Please try again.');
        }
        return;
      }
      if (!result?.order_id) throw new Error('No order ID returned from PayPal');

      // 3) Verify & capture payment server-side
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'verify-payment',
        { body: { user_id: profile.id, transaction_id: result.order_id } }
      );
      if (verifyError || !verifyData?.success) {
        throw new Error(verifyError?.message || 'Payment verification failed');
      }

      // 4) Refresh — PRO activates instantly
      await refreshProfile();
    } catch (err: any) {
      setWaitingBrowser(false);
      setUpgradeError(err?.message || 'Payment failed. Please try again.');
    } finally {
      setUpgradeLoading(false);
    }
  };

  /* ── No plan ──────────────────────────────────────────────────────── */
  if (isFree) {
    return (
      <div className="ms-page">
        <PageHeader icon={<Crown size={16} />} title="Manage Subscription" />
        <div className="ms-center-zone">
          <div className="ms-panel ms-panel--upgrade">
            <div className="ms-panel-corner ms-panel-corner--tl" />
            <div className="ms-panel-corner ms-panel-corner--tr" />
            <div className="ms-panel-corner ms-panel-corner--bl" />
            <div className="ms-panel-corner ms-panel-corner--br" />
            <div className="ms-upgrade-icon-wrap">
              <Crown size={38} strokeWidth={1.2} />
            </div>
            <div className="ms-upgrade-badge">UPGRADE</div>
            <h2 className="ms-upgrade-heading">GO PRO</h2>
            <p className="ms-upgrade-tagline">$4.99 — Unlock all PRO features for 30 days</p>
            <div className="ms-features-grid">
              <div className="ms-feature"><Zap size={11} /><span>PC Tweaks &amp; Optimizations</span></div>
              <div className="ms-feature"><Zap size={11} /><span>Games Library &amp; Benchmarks</span></div>
              <div className="ms-feature"><Zap size={11} /><span>Software Updates &amp; Apps</span></div>
              <div className="ms-feature"><Zap size={11} /><span>Disk Analyzer &amp; Utilities</span></div>
            </div>
            {upgradeError && <div className="ms-error-bar">{upgradeError}</div>}
            <button className="ms-btn-upgrade" onClick={handleUpgrade} disabled={upgradeLoading}>
              {waitingBrowser
                ? <><Loader2 size={14} className="ms-spin" /> Complete checkout in your browser…</>
                : upgradeLoading
                  ? <><Loader2 size={14} className="ms-spin" /> Processing…</>
                  : <><Crown size={14} /> Upgrade — $4.99 / 30 days</>
              }
            </button>
            <div className="ms-secure-note">
              <Lock size={9} /> {waitingBrowser ? 'PayPal checkout is open in your browser' : 'Secure checkout via PayPal'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Elevated (admin / owner) ─────────────────────────────────────── */
  if (isElevated) {
    return (
      <div className="ms-page">
        <PageHeader icon={<Crown size={16} />} title="Manage Subscription" />
        <div className="ms-center-zone">
          <div className="ms-panel ms-panel--lifetime">
            <div className="ms-panel-corner ms-panel-corner--tl" />
            <div className="ms-panel-corner ms-panel-corner--tr" />
            <div className="ms-panel-corner ms-panel-corner--bl" />
            <div className="ms-panel-corner ms-panel-corner--br" />
            <div className="ms-lifetime-orb">
              <InfinityIcon size={44} strokeWidth={1.1} />
            </div>
            <div className="ms-lifetime-badge-text">LIFETIME</div>
            <h2 className="ms-lifetime-title">Permanent Access</h2>
            <p className="ms-lifetime-sub">
              Your account has permanent PRO access. No subscription required.
            </p>
            <div className="ms-lifetime-features">
              <div className="ms-lf-item"><Shield size={12} /><span>Full PRO access</span></div>
              <div className="ms-lf-item"><Zap size={12} /><span>All features unlocked</span></div>
              <div className="ms-lf-item"><InfinityIcon size={12} /><span>Never expires</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── PRO subscriber ───────────────────────────────────────────────── */
  return (
    <div className="ms-page">
      <PageHeader icon={<Crown size={16} />} title="Manage Subscription" />
      <div className="ms-center-zone">
        <div className={`ms-panel ms-panel--${statusMod}`}>
          <div className="ms-panel-corner ms-panel-corner--tl" />
          <div className="ms-panel-corner ms-panel-corner--tr" />
          <div className="ms-panel-corner ms-panel-corner--bl" />
          <div className="ms-panel-corner ms-panel-corner--br" />
          <div className={`ms-accent-bar ms-accent-bar--${statusMod}`} />

          {/* Header row */}
          <div className="ms-hdr">
            <div className="ms-status-chip-wrap">
              <span className={`ms-pulse ms-pulse--${statusMod}`} />
              <span className={`ms-status-badge ms-status-badge--${statusMod}`}>
                {statusMod === 'cancelled' ? 'CANCELLED' : statusLabel.toUpperCase()}
              </span>
            </div>
            <div className="ms-plan-banner">
              <span className="ms-plan-icon-wrap"><Zap size={13} /></span>
              <span className="ms-plan-name-text">PRO</span>
              <span className="ms-plan-price-text">$4.99 / 30d</span>
            </div>
          </div>

          {/* Countdown */}
          {countdown && (
            <div className="ms-countdown-zone">
              <span className="ms-countdown-label-text">TIME REMAINING</span>
              <div className={`ms-big-countdown${isExpired ? ' ms-big-countdown--red' : ''}`}>
                {countdown}
              </div>
            </div>
          )}

          {/* Separator */}
          <div className="ms-rule" />

          {/* Data strip */}
          <div className="ms-data-strip">
            <div className="ms-data-block">
              <span className="ms-data-label-txt">PLAN</span>
              <span className="ms-data-val ms-data-val--cyan"><Zap size={11} /> PRO</span>
            </div>
            <div className="ms-data-sep" />
            <div className="ms-data-block">
              <span className="ms-data-label-txt">PAYMENT</span>
              <span className="ms-data-val">
                <CreditCard size={11} />
                {pro_source === 'paypal' ? 'PayPal' : pro_source === 'manual' ? 'Manual' : '—'}
              </span>
            </div>
            <div className="ms-data-sep" />
            <div className="ms-data-block">
              <span className="ms-data-label-txt">
                {subscription_status === 'cancelled' ? 'ACCESS UNTIL' : 'EXPIRES'}
              </span>
              <span className={`ms-data-val${isExpired ? ' ms-data-val--red' : ''}`}>
                <CalendarDays size={11} /> {formatDate(pro_expires_at)}
              </span>
            </div>
          </div>

          {/* Cancel action */}
          {isPro && subscription_status !== 'cancelled' && !cancelDone && (
            <div className="ms-action-zone">
              {!confirmCancel ? (
                <button className="ms-btn-ghost-red" onClick={() => setConfirmCancel(true)}>
                  <XCircle size={13} /> Cancel subscription
                </button>
              ) : (
                <div className="ms-confirm-box">
                  <div className="ms-confirm-warn">
                    <AlertTriangle size={14} className="ms-warn-icon" />
                    <span>Are you sure? This cannot be undone.</span>
                  </div>
                  <div className="ms-confirm-row">
                    <button className="ms-btn-neutral" onClick={() => setConfirmCancel(false)} disabled={cancelling}>
                      Keep Plan
                    </button>
                    <button className="ms-btn-red" onClick={handleCancel} disabled={cancelling}>
                      {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cancelled notice */}
          {(cancelDone || subscription_status === 'cancelled') && !isExpired && (
            <div className="ms-notice-bar ms-notice-bar--green">
              <CheckCircle2 size={14} />
              <div>
                <span className="ms-notice-ttl">Subscription cancelled</span>
                <span className="ms-notice-sub">PRO access remains until {formatDate(pro_expires_at)}.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManageSubscription;

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, CheckCircle, AlertTriangle, Package } from 'lucide-react';

interface UpdateProgress {
  packageId: string;
  packageName?: string;
  phase: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  status: string;
  percent: number;
  bytesDownloaded?: number;
  bytesTotal?: number;
  bytesPerSec?: number;
}

const fmtBytes = (n?: number): string => {
  if (!n || n <= 0) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576)    return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024)       return `${(n / 1024).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
};

const PHASE_PERCENT: Record<UpdateProgress['phase'], number> = {
  preparing:   10,
  downloading: 40,
  verifying:   70,
  installing:  85,
  done:        100,
  error:       0,
};

const FloatingUpdateProgress: React.FC = () => {
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ipc = (window as any).electron?.ipcRenderer;
    if (!ipc) return;
    const unsub = ipc.on('software:update-progress', (data: UpdateProgress) => {
      if (!data) return;
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setProgress(data);
      if (data.phase === 'done' || data.phase === 'error') {
        hideTimerRef.current = setTimeout(() => setProgress(null), 3500);
      }
    });
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const goToUpdatesPage = () => {
    try {
      window.dispatchEvent(new CustomEvent('navigate:page', { detail: { page: 'softwareUpdates' } }));
    } catch {}
  };

  const phase = progress?.phase;
  const rawPercent = progress?.percent ?? 0;
  const isIndeterminate = rawPercent < 0;
  const displayPercent = Math.min(100, Math.max(0, Math.round(
    rawPercent >= 0 ? rawPercent : (phase ? PHASE_PERCENT[phase] : 0)
  )));
  const Icon = phase === 'done' ? CheckCircle : phase === 'error' ? AlertTriangle : phase === 'installing' ? Package : Download;
  const title = phase === 'done' ? 'Update complete'
    : phase === 'error' ? (progress?.status || 'Update failed')
    : progress?.packageName
      ? `Updating ${progress.packageName}`
      : 'Updating software';

  return (
    <AnimatePresence>
      {progress && (
        <motion.button
          key="floating-update"
          className={`floating-update floating-update--${phase}`}
          onClick={goToUpdatesPage}
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          title="Open Software Updates"
        >
          <span className="floating-update__icon"><Icon size={14} /></span>
          <span className="floating-update__body">
            <span className="floating-update__title-row">
              <span className="floating-update__title">{title}</span>
              <span className="floating-update__percent">{displayPercent}%</span>
            </span>
            <span className="floating-update__status">
              {phase === 'downloading' && progress.bytesTotal
                ? `${fmtBytes(progress.bytesDownloaded)} / ${fmtBytes(progress.bytesTotal)}${progress.bytesPerSec ? `  ·  ${fmtBytes(progress.bytesPerSec)}/s` : ''}`
                : progress.status}
            </span>
          </span>
          <span className="floating-update__bar-wrap">
            <span
              className={`floating-update__bar${isIndeterminate ? ' floating-update__bar--indeterminate' : ''}`}
              style={{ width: isIndeterminate ? '100%' : `${Math.max(displayPercent, 2)}%` }}
            />
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default FloatingUpdateProgress;

import React, { useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Copy, Download, Check, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../contexts/ToastContext';
import { GAME_REQUIREMENTS } from '../data/gameRequirements';
import { performanceTweaks } from '../data/performanceTweaks';
import { compareHardware, predictFps } from '../utils/hardwareCompare';
import type { HardwareInfo } from '../App';
import '../styles/ReportCard.css';

/* ── Tweak ID → friendly label ──────────────────────────────────── */
const TWEAK_LABEL: Record<string, string> = {};
performanceTweaks.forEach(t => { TWEAK_LABEL[t.id] = t.title; });

/* ── Game ID → display name ─────────────────────────────────────── */
const GAME_NAME: Record<string, string> = {
  'apex-legends': 'Apex Legends',
  'valorant': 'Valorant',
  'cs2': 'CS2',
  'fortnite': 'Fortnite',
  'overwatch': 'Overwatch 2',
  'league-of-legends': 'League of Legends',
  'rocket-league': 'Rocket League',
  'cod': 'Call of Duty',
};

const VERDICT_LABEL: Record<string, string> = {
  'exceeds': 'Exceeds',
  'meets-recommended': 'Meets Rec.',
  'meets-minimum': 'Meets Min.',
  'below': 'Below Min.',
};

export interface ReportCardHandle {
  generate: () => void;
}

interface ReportCardButtonProps {
  variant?: 'button' | 'menu-item';
  headless?: boolean;
  onGenerate?: () => void;
}

const ReportCardButton = forwardRef<ReportCardHandle, ReportCardButtonProps>(({
  variant = 'button',
  headless = false,
  onGenerate,
}, ref) => {
  const [generating, setGenerating] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const { addToast } = useToast();

  const generate = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    onGenerate?.();
    setGenerating(true);
    setImageBase64(null);

    try {
      let hardwareInfo: HardwareInfo | null = null;
      let systemStats = { cpu: 0, ram: 0, disk: 0, temperature: 0, gpuTemp: 0, gpuUsage: 0 };
      try {
        hardwareInfo = await window.electron.ipcRenderer.invoke('system:get-hardware-info');
      } catch {}
      try {
        const stats = await window.electron.ipcRenderer.invoke('system:get-stats');
        if (stats) systemStats = stats;
      } catch {}

      if (!hardwareInfo) {
        addToast('Hardware info not available yet', 'error');
        return;
      }

      let health = { score: 0, factors: [] as any[] };
      try {
        health = await window.electron.ipcRenderer.invoke('health:compute', systemStats, hardwareInfo);
      } catch {}

      let advisor = { insights: [], upgrades: [] };
      try {
        advisor = await window.electron.ipcRenderer.invoke('advisor:analyze', systemStats, hardwareInfo);
      } catch {}

      const tweaks: Record<string, boolean> = {};
      const checkPromises = Object.keys(TWEAK_LABEL).map(async (id) => {
        try {
          const result = await window.electron!.ipcRenderer.invoke(`tweak:check-${id}`);
          tweaks[TWEAK_LABEL[id] || id] = result?.applied === true;
        } catch {}
      });
      await Promise.all(checkPromises);

      const games: any[] = [];
      for (const [gameId, req] of Object.entries(GAME_REQUIREMENTS)) {
        const comparison = compareHardware(hardwareInfo, req);
        const fps = predictFps(comparison, req);
        games.push({
          name: GAME_NAME[gameId] || gameId,
          fpsLow: fps.yours.low,
          fpsMedium: fps.yours.medium,
          fpsHigh: fps.yours.high,
          overall: comparison.overall,
          verdict: VERDICT_LABEL[comparison.overall] || comparison.overall,
        });
      }

      const result = await window.electron.ipcRenderer.invoke('report:generate', {
        hardware: hardwareInfo,
        health,
        advisor,
        tweaks,
        games,
      });

      setImageBase64(result.imageBase64);
      setShowPreview(true);
    } catch (err) {
      console.error('Report generation failed:', err);
      addToast('Failed to generate report card', 'error');
    } finally {
      setGenerating(false);
    }
  }, [addToast, onGenerate]);

  useImperativeHandle(ref, () => ({ generate }), [generate]);

  const copyToClipboard = useCallback(async () => {
    if (!imageBase64 || !window.electron?.ipcRenderer) return;
    try {
      await window.electron.ipcRenderer.invoke('report:copy-image', imageBase64);
      setCopied(true);
      addToast('Copied to clipboard — paste in Discord!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy to clipboard', 'error');
    }
  }, [imageBase64, addToast]);

  const saveToFile = useCallback(async () => {
    if (!imageBase64 || !window.electron?.ipcRenderer) return;
    try {
      const result = await window.electron.ipcRenderer.invoke('report:save-image', imageBase64);
      if (result?.ok) addToast('Report saved!', 'success');
    } catch {
      addToast('Failed to save report', 'error');
    }
  }, [imageBase64, addToast]);

  const closePreview = useCallback(() => {
    setShowPreview(false);
  }, []);

  /* ── Preview modal (portalled to body) ────────── */
  const previewPortal = createPortal(
    <AnimatePresence>
      {showPreview && imageBase64 && (
        <motion.div
          className="rc-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}
        >
          <motion.div
            className="rc-modal"
            initial={{ y: 30, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Top bar */}
            <div className="rc-topbar">
              <span className="rc-topbar-title">PC Report Card</span>
              <div className="rc-topbar-actions">
                <button className="rc-action rc-action--copy" onClick={copyToClipboard} title="Copy to clipboard">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
                <button className="rc-action rc-action--save" onClick={saveToFile} title="Save as PNG">
                  <Download size={14} />
                  <span>Save</span>
                </button>
                <button className="rc-action rc-action--close" onClick={closePreview} title="Close">
                  <X size={14} />
                </button>
              </div>
            </div>
            {/* Image */}
            <div className="rc-scroll">
              <img
                src={`data:image/png;base64,${imageBase64}`}
                alt="PC Report Card"
                className="rc-img"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );

  if (headless) return previewPortal;

  if (variant === 'menu-item') {
    return (
      <>
        <button
          className="pd-action pd-action--report"
          onClick={generate}
          disabled={generating}
        >
          <span className="pd-action-icon">
            {generating ? <Loader2 size={14} className="rc-spin" /> : <Share2 size={14} />}
          </span>
          <span>{generating ? 'Generating...' : 'Share Hardware Report'}</span>
        </button>
        {previewPortal}
      </>
    );
  }

  return (
    <>
      <button
        className="rc-trigger"
        onClick={generate}
        disabled={generating}
        title="Generate PC Report Card"
      >
        {generating ? <Loader2 size={15} className="rc-spin" /> : <Share2 size={15} />}
        <span className="rc-trigger-label">{generating ? 'Generating...' : 'Share Hardware Report'}</span>
      </button>
      {previewPortal}
    </>
  );
});

export default ReportCardButton;

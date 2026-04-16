import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Zap, Wrench, Trash2, Star, Rocket } from 'lucide-react';
import changelog, { ChangelogEntry } from '../data/changelog';
import '../styles/WhatsNew.css';

interface WhatsNewModalProps {
  open: boolean;
  onClose: () => void;
}

/* ── Change-type metadata ── */
const TYPE_META: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
  new:      { icon: <Star size={12} />,   label: 'New',      cls: 'wn-chip--new' },
  improved: { icon: <Zap size={12} />,    label: 'Improved', cls: 'wn-chip--improved' },
  fixed:    { icon: <Wrench size={12} />, label: 'Fixed',    cls: 'wn-chip--fixed' },
  removed:  { icon: <Trash2 size={12} />, label: 'Removed',  cls: 'wn-chip--removed' },
};

/* ── Group changes by type for a single release ── */
function groupByType(entry: ChangelogEntry) {
  const groups: Record<string, string[]> = {};
  for (const c of entry.changes) {
    (groups[c.type] ??= []).push(c.text);
  }
  return Object.entries(groups);
}

/* ── Stagger children ── */
const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};
const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 },
};

const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const entry = changelog[selectedIdx];
  const grouped = useMemo(() => groupByType(entry), [entry]);

  return ReactDOM.createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="wn-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="wn-modal"
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 40 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Decorative elements */}
            <div className="wn-scanlines" />
            <div className="wn-glow wn-glow--top" />
            <div className="wn-glow wn-glow--accent" />

            {/* ── Sidebar: version timeline ── */}
            <aside className="wn-sidebar">
              <div className="wn-sidebar__head">
                <Rocket size={14} />
                <span>Releases</span>
              </div>
              <div className="wn-timeline">
                {changelog.map((rel, i) => (
                  <button
                    key={rel.version}
                    className={`wn-timeline__item${i === selectedIdx ? ' wn-timeline__item--active' : ''}`}
                    onClick={() => setSelectedIdx(i)}
                  >
                    <span className="wn-timeline__dot" />
                    <div className="wn-timeline__info">
                      <span className="wn-timeline__ver">v{rel.version}</span>
                      <span className="wn-timeline__date">{rel.date}</span>
                    </div>
                    {i === 0 && <span className="wn-timeline__badge">Latest</span>}
                  </button>
                ))}
              </div>
            </aside>

            {/* ── Main content ── */}
            <div className="wn-main">
              {/* Top bar */}
              <div className="wn-topbar">
                <div className="wn-topbar__left">
                  <div className="wn-topbar__icon">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <h2 className="wn-topbar__title">What's New</h2>
                    <span className="wn-topbar__sub">Changelog & release notes</span>
                  </div>
                </div>
                <button className="wn-close" onClick={onClose} aria-label="Close">
                  <X size={15} />
                </button>
              </div>

              {/* Hero title — full width banner */}
              {entry.highlights && (
                <div className="wn-hero">
                  <span>{entry.highlights}</span>
                </div>
              )}

              {/* Changes grouped by type */}
              <div className="wn-content">
                <div className="wn-content__label">Changes</div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={entry.version}
                    variants={listVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    className="wn-groups"
                  >
                    {grouped.map(([type, texts]) => {
                      const meta = TYPE_META[type] || TYPE_META.new;
                      return (
                        <div className={`wn-group wn-group--${type}`} key={type}>
                          <div className={`wn-group__header ${meta.cls}`}>
                            {meta.icon}
                            <span>{meta.label}</span>
                            <span className="wn-group__count">{texts.length}</span>
                          </div>
                          <div className="wn-group__items">
                            {texts.map((text, j) => (
                              <motion.div className="wn-item" key={j} variants={itemVariants}>
                                <span className="wn-item__text">{text}</span>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default WhatsNewModal;

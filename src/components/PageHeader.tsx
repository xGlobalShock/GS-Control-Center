import React from 'react';
import { motion } from 'framer-motion';
import '../styles/PageHeader.css';

export interface PageHeaderProps {
  icon: React.ReactNode;
  title: string;
  /** Optional small stat element shown after the line (e.g. "3/7 Active") */
  stat?: React.ReactNode;
  /** Optional action buttons rendered on the far right */
  actions?: React.ReactNode;
  /** Optional element rendered INSIDE the header line — line pierces through it */
  lineContent?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ icon, title, stat, actions, lineContent }) => (
  <motion.div
    className="page-header"
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
  >
    <div className="hud-section-header">
      <div className="hud-section-icon">{icon}</div>
      <h3 className="hud-section-title">{title}</h3>
      {lineContent ? (
        <div className="hud-section-line-wrap">
          <div className="hud-section-line hud-section-line--approach" />
          {lineContent}
          <div className="hud-section-line hud-section-line--tail" />
        </div>
      ) : (
        <div className="hud-section-line" />
      )}
      {stat && <div className="page-header-stat">{stat}</div>}
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  </motion.div>
);

export default PageHeader;
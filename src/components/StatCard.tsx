
import React from 'react';
import { motion } from 'framer-motion';
import '../styles/StatCard.css';

interface StatCardProps {
  title: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  status: 'good' | 'warning' | 'critical';
  isUnavailable?: boolean;
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  icon,
  status,
  isUnavailable = false,
  subtitle,
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'good':
        return '#10b981';
      case 'warning':
        return '#f59e0b';
      case 'critical':
        return '#ef4444';
      default:
        return '#10b981';
    }
  };

  const normalizedValue = Math.min(value, 100);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (normalizedValue / 100) * circumference;

  return (
    <motion.div
      className={`stat-card stat-${status}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28 }}
    >
      <div className="stat-card-inner">
        <div className="stat-center">
          <div className="gauge-wrap">
            <div className="stat-gauge">
              <svg viewBox="0 0 120 120" className="gauge-svg" aria-hidden>
                <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
                <motion.circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={getStatusColor()}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 48}
                  strokeDashoffset={2 * Math.PI * 48}
                  animate={{ strokeDashoffset: 2 * Math.PI * 48 - (normalizedValue / 100) * 2 * Math.PI * 48 }}
                  transition={{ duration: 1.2, ease: 'easeInOut' }}
                  style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', filter: `drop-shadow(0 0 6px ${getStatusColor()}66)` }}
                />
              </svg>
              <div className="stat-value">
                <div className="stat-number">
                  {isUnavailable ? (
                    <>—<span className="stat-unit">N/A</span></>
                  ) : (
                    <>{normalizedValue.toFixed(0)}<span className="stat-unit">{unit}</span></>
                  )}
                </div>
                <div className="stat-title"><span className="stat-inline-icon">{icon}</span><span className="stat-title-text">{title}</span></div>
              </div>
            </div>
            <div className={`stat-badge stat-${isUnavailable ? 'unavailable' : status} stat-badge-below`}>{isUnavailable ? 'UNAVAILABLE' : status.toUpperCase()}</div>
            {subtitle && <div className="stat-subtitle" title={subtitle}>{subtitle}</div>}
          </div>
        </div>

        {/* Status moved inside the stat card value area */}
      </div>
    </motion.div>
  );
};

export default StatCard;

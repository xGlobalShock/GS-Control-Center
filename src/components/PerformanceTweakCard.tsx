import React from 'react';
import { Check, RotateCcw, Power } from 'lucide-react';
import '../styles/PerformanceTweakCard.css';

interface PerformanceTweakCardProps {
  id: string;
  title: string;
  icon: any;
  category: string;
  description: string;
  buttonText: string;
  color: string;
  onApply: (id: string) => Promise<void>;
  onReset?: (id: string) => Promise<void>;
  isLoading?: boolean;
  isEnabled?: boolean;
  isChecking?: boolean;
}

const PerformanceTweakCard: React.FC<PerformanceTweakCardProps> = ({
  id,
  title,
  icon,
  category,
  description,
  buttonText,
  color,
  onApply,
  onReset,
  isLoading = false,
  isEnabled = false,
  isChecking = false,
}) => {
  const handleClick = async () => {
    try {
      await onApply(id);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleReset = async () => {
    try {
      if (onReset) {
        await onReset(id);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const showApplyButton = !isEnabled;

  return (
    <div className={`tc ${isEnabled ? 'tc--active' : ''} ${isLoading ? 'tc--loading' : ''}`}>
      {/* Top accent bar */}
      <div className="tc-accent" />
      
      {/* Corner accents */}
      <div className="tc-corner tc-corner--tl" />
      <div className="tc-corner tc-corner--tr" />
      <div className="tc-corner tc-corner--bl" />
      <div className="tc-corner tc-corner--br" />

      {/* Scanline overlay */}
      <div className="tc-scanline" />

      {/* Content */}
      <div className="tc-inner">
        {/* Top row: status indicator + category */}
        <div className="tc-top-row">
          <div className={`tc-power-indicator ${isEnabled ? 'tc-power--on' : 'tc-power--off'}`}>
            <Power size={10} strokeWidth={3} />
          </div>
          <span className="tc-category">{category}</span>
        </div>

        {/* Title + Icon row */}
        <div className="tc-title-row">
          <div className="tc-icon-container">
            {typeof icon === 'string' ? (
              <img src={icon} alt={title} className="tc-icon-img" />
            ) : (
              React.createElement(icon, { size: 22, className: 'tc-icon-svg' })
            )}
          </div>
          <h3 className="tc-title">{title}</h3>
        </div>

        {/* Description */}
        <p className="tc-desc">{description}</p>

        {/* Divider line */}
        <div className="tc-divider" />

        {/* Bottom: action + status */}
        <div className="tc-bottom">
          {showApplyButton ? (
            <button
              className="tc-btn tc-btn--apply"
              onClick={handleClick}
              disabled={isLoading}
            >
              <Check size={14} strokeWidth={3} />
              <span>{isLoading ? 'Applying...' : 'Apply'}</span>
              <div className="tc-btn-shine" />
            </button>
          ) : (
            <button
              className="tc-btn tc-btn--revert"
              onClick={handleReset}
              disabled={isLoading}
            >
              <RotateCcw size={14} strokeWidth={3} />
              <span>{isLoading ? 'Reverting...' : 'Revert'}</span>
              <div className="tc-btn-shine" />
            </button>
          )}
          <div className={`tc-status ${isEnabled ? 'tc-status--on' : 'tc-status--off'}`}>
            <div className="tc-status-dot" />
            <span>{isEnabled ? 'TWEAK APPLIED' : 'NOT APPLIED'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceTweakCard;

import React from 'react';
import { Check } from 'phosphor-react';
import '../styles/CleanerCard.css';

interface CleanerCardProps {
  id: string;
  title: string;
  icon: any;
  cacheType: string;
  description: string;
  buttonText: string;
  color: string;
  onClean: (id: string) => Promise<void>;
  isLoading?: boolean;
}

const CleanerCard: React.FC<CleanerCardProps> = ({
  id,
  title,
  icon: Icon,
  cacheType,
  description,
  buttonText,
  color,
  onClean,
  isLoading = false,
}) => {
  const handleClick = async () => {
    try {
      await onClean(id);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const renderIcon = () => {
    if (typeof Icon === 'string') {
      return (
        <img
          src={Icon}
          alt={title + ' icon'}
          className="cc-icon-img"
        />
      );
    }
    if (Icon) {
      return <Icon size={22} className="cc-icon-svg" />;
    }
    return null;
  };

  return (
    <div className={`cc ${isLoading ? 'cc--busy' : ''}`}>
      {/* Top edge sweep */}
      <div className="cc-edge" />

      {/* Corner accents */}
      <div className="cc-corner cc-corner--tl" />
      <div className="cc-corner cc-corner--tr" />
      <div className="cc-corner cc-corner--bl" />
      <div className="cc-corner cc-corner--br" />

      {/* Loading sweep */}
      {isLoading && <div className="cc-sweep" />}

      <div className="cc-inner">
        {/* Top row: icon and title */}
        <div className="cc-top">
          <div className="cc-icon-box">
            {renderIcon()}
          </div>
          <h3 className="cc-title cc-title-inline">{title}</h3>
        </div>

        {/* Description */}
        <p className="cc-desc">{description}</p>

        {/* Divider */}
        <div className="cc-divider" />

        {/* Action button */}
        <button
          className="cc-btn"
          onClick={handleClick}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="cc-spinner" />
              <span>Cleaning...</span>
            </>
          ) : (
            <>
              <Check size={13} weight="bold" />
              <span>{buttonText}</span>
            </>
          )}
          <div className="cc-btn-shine" />
        </button>
      </div>
    </div>
  );
};

export default CleanerCard;

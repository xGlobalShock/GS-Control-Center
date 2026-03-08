import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Minus, Square, X, Copy, ArrowDownCircle, Download, RefreshCw, CheckCircle } from 'lucide-react';
import '../styles/Header.css';

declare global {
  interface Window {
    electron?: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        on: (channel: string, func: (...args: any[]) => void) => (() => void);
        once: (channel: string, func: (...args: any[]) => void) => void;
        removeAllListeners: (channel: string) => void;
      };
      windowControls?: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (callback: (isMaximized: boolean) => void) => (() => void);
      };
      updater?: {
        checkForUpdates: () => Promise<any>;
        downloadUpdate: () => Promise<any>;
        installUpdate: () => Promise<void>;
        getVersion: () => Promise<string>;
        onStatus: (callback: (data: any) => void) => (() => void);
      };
    };
  }
}

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

const Header: React.FC = React.memo(() => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [showUpdatePopup, setShowUpdatePopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controls = window.electron?.windowControls;
    if (!controls) return;

    controls.isMaximized().then(setIsMaximized);
    const unsub = controls.onMaximizedChange(setIsMaximized);
    return unsub;
  }, []);

  // Listen for auto-updater status events from main process
  useEffect(() => {
    const updater = window.electron?.updater;
    if (!updater) return;

    const unsub = updater.onStatus((data: any) => {
      switch (data.event) {
        case 'checking':
          setUpdateState('checking');
          break;
        case 'available':
          setUpdateState('available');
          setUpdateVersion(data.version || '');
          break;
        case 'not-available':
          setUpdateState('idle');
          break;
        case 'download-progress':
          setUpdateState('downloading');
          setDownloadPercent(data.percent || 0);
          break;
        case 'downloaded':
          setUpdateState('downloaded');
          setUpdateVersion(data.version || '');
          break;
        case 'error':
          setUpdateState('error');
          break;
      }
    });
    return unsub;
  }, []);

  // Close popup on outside click
  useEffect(() => {
    if (!showUpdatePopup) return;
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowUpdatePopup(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showUpdatePopup]);

  const handleDownload = useCallback(async () => {
    setUpdateState('downloading');
    setDownloadPercent(0);
    await window.electron?.updater?.downloadUpdate();
  }, []);

  const handleInstall = useCallback(() => {
    window.electron?.updater?.installUpdate();
  }, []);

  const handleMinimize = () => window.electron?.windowControls?.minimize();
  const handleMaximize = () => window.electron?.windowControls?.maximize();
  const handleClose = () => window.electron?.windowControls?.close();

  const showIndicator = updateState === 'available' || updateState === 'downloading' || updateState === 'downloaded';

  return (
    <header className="header">
      <div className="header-left header-drag-region">
        <h1 className="header-title">GS Control Center</h1>
        <p className="header-subtitle">System Performance Control Center</p>
      </div>

      <div className="window-controls">
        {/* Update indicator — visible only when update is available / downloading / ready */}
        {showIndicator && (
          <div className="update-indicator-wrapper" ref={popupRef}>
            <button
              className={`window-control-btn update-btn update-btn--${updateState}`}
              onClick={() => setShowUpdatePopup(prev => !prev)}
              aria-label="Update available"
              title="New version available"
            >
              {updateState === 'available' && <ArrowDownCircle size={16} />}
              {updateState === 'downloading' && <Download size={16} className="update-spin" />}
              {updateState === 'downloaded' && <CheckCircle size={16} />}
              <span className="update-dot" />
            </button>

            {showUpdatePopup && (
              <div className="update-popup">
                {updateState === 'available' && (
                  <>
                    <div className="update-popup-header">
                      <ArrowDownCircle size={18} className="update-popup-icon" />
                      <span>New Version Available</span>
                    </div>
                    <p className="update-popup-version">v{updateVersion}</p>
                    <button className="update-popup-btn" onClick={handleDownload}>
                      <Download size={14} /> Download Update
                    </button>
                  </>
                )}
                {updateState === 'downloading' && (
                  <>
                    <div className="update-popup-header">
                      <RefreshCw size={18} className="update-popup-icon update-spin" />
                      <span>Downloading...</span>
                    </div>
                    <div className="update-progress-bar">
                      <div className="update-progress-fill" style={{ width: `${downloadPercent}%` }} />
                    </div>
                    <p className="update-popup-percent">{downloadPercent}%</p>
                  </>
                )}
                {updateState === 'downloaded' && (
                  <>
                    <div className="update-popup-header">
                      <CheckCircle size={18} className="update-popup-icon update-popup-icon--ready" />
                      <span>Ready to Install</span>
                    </div>
                    <p className="update-popup-version">v{updateVersion} downloaded</p>
                    <button className="update-popup-btn update-popup-btn--install" onClick={handleInstall}>
                      <RefreshCw size={14} /> Restart &amp; Install
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <button className="window-control-btn minimize-btn" onClick={handleMinimize} aria-label="Minimize">
          <Minus size={16} />
        </button>
        <button className="window-control-btn maximize-btn" onClick={handleMaximize} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? <Copy size={14} /> : <Square size={14} />}
        </button>
        <button className="window-control-btn close-btn" onClick={handleClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

export default Header;

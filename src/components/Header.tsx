import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
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
    };
  }
}

const Header: React.FC = React.memo(() => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const controls = window.electron?.windowControls;
    if (!controls) return;

    controls.isMaximized().then(setIsMaximized);
    const unsub = controls.onMaximizedChange(setIsMaximized);
    return unsub;
  }, []);

  const handleMinimize = () => window.electron?.windowControls?.minimize();
  const handleMaximize = () => window.electron?.windowControls?.maximize();
  const handleClose = () => window.electron?.windowControls?.close();

  return (
    <header className="header">
      <div className="header-left header-drag-region">
        <h1 className="header-title">GS Optimizer</h1>
        <p className="header-subtitle">System Performance Control Center</p>
      </div>

      <div className="window-controls">
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

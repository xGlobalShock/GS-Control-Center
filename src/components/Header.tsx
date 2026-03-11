import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Minus, Square, X, Copy, ArrowDownCircle, Download, RefreshCw, CheckCircle, AlertTriangle, XCircle, Sparkles, Radio } from 'lucide-react';
import changelog from '../data/changelog';
import devUpdatesDefault from '../data/devUpdates';
import type { DevUpdate } from '../data/devUpdates';
import '../styles/Header.css';
import '../styles/WhatsNew.css';
import '../styles/DevUpdates.css';

// GitHub Releases API Configuration
const GITHUB_REPO = 'xSGCo/gs-control-center'; // Change to your repo: 'owner/repo'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const DEV_UPDATES_CACHE_KEY = 'devupdates-cache';
const DEV_UPDATES_CACHE_TTL = 3600000; // 1 hour in milliseconds

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

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
        cancelUpdate: () => Promise<any>;
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
  const [updateError, setUpdateError] = useState('');
  const [showUpdatePopup, setShowUpdatePopup] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [hasUnseenChanges, setHasUnseenChanges] = useState(false);
  const [showDevUpdates, setShowDevUpdates] = useState(false);
  const [hasUnseenDevUpdates, setHasUnseenDevUpdates] = useState(false);
  const [devUpdates, setDevUpdates] = useState<DevUpdate[]>(devUpdatesDefault);
  const popupRef = useRef<HTMLDivElement>(null);
  const whatsNewRef = useRef<HTMLDivElement>(null);
  const devUpdatesRef = useRef<HTMLDivElement>(null);

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
          setUpdateError('');
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
          // If we already know an update is available, stay in 'available' so user can retry
          setUpdateError(data.message || 'Download failed');
          setUpdateState(prev => prev === 'downloading' || prev === 'available' ? 'available' : 'error');
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

  // Check for unseen changelog on mount
  useEffect(() => {
    const latest = changelog[0]?.version;
    if (latest) {
      const seen = localStorage.getItem('whatsnew-seen-version');
      if (seen !== latest) setHasUnseenChanges(true);
    }
  }, []);

  // Fetch dev updates from GitHub Releases API
  useEffect(() => {
    const fetchDevUpdates = async () => {
      try {
        // Check cache first
        const cached = localStorage.getItem(DEV_UPDATES_CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < DEV_UPDATES_CACHE_TTL) {
            setDevUpdates(data);
            return;
          }
        }

        const response = await fetch(GITHUB_API_URL, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (!response.ok) throw new Error('Failed to fetch releases');

        const releases: GitHubRelease[] = await response.json();

        const updates: DevUpdate[] = releases
          .filter(r => !r.draft && !r.prerelease)
          .slice(0, 10)
          .map((release) => {
            const lines = release.body.trim().split('\n').filter(l => l.trim());
            const firstLine = lines[0] || release.name;
            const rest = lines.slice(1).join('\n').trim();

            let type: 'bug' | 'in-progress' | 'planned' | 'info' = 'info';
            const bodyLower = release.body.toLowerCase();
            if (bodyLower.includes('fixing') || bodyLower.includes('bug')) type = 'bug';
            else if (bodyLower.includes('working on') || bodyLower.includes('in progress')) type = 'in-progress';
            else if (bodyLower.includes('coming') || bodyLower.includes('planned')) type = 'planned';

            return {
              id: `du-gh-${release.id}`,
              date: release.published_at.split('T')[0],
              type,
              title: firstLine,
              description: rest || undefined,
            };
          });

        setDevUpdates(updates.length > 0 ? updates : devUpdatesDefault);
        localStorage.setItem(DEV_UPDATES_CACHE_KEY, JSON.stringify({
          data: updates.length > 0 ? updates : devUpdatesDefault,
          timestamp: Date.now(),
        }));
      } catch {
        setDevUpdates(devUpdatesDefault);
      }
    };

    fetchDevUpdates();
  }, []);

  // Check for unseen dev updates
  useEffect(() => {
    const latestId = devUpdates[0]?.id;
    if (latestId) {
      const seen = localStorage.getItem('devupdates-seen-id');
      if (seen !== latestId) setHasUnseenDevUpdates(true);
    }
  }, [devUpdates]);

  // Close Dev Updates panel on outside click
  useEffect(() => {
    if (!showDevUpdates) return;
    const handleClick = (e: MouseEvent) => {
      if (devUpdatesRef.current && !devUpdatesRef.current.contains(e.target as Node)) {
        setShowDevUpdates(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDevUpdates]);

  // Close What's New panel on outside click
  useEffect(() => {
    if (!showWhatsNew) return;
    const handleClick = (e: MouseEvent) => {
      if (whatsNewRef.current && !whatsNewRef.current.contains(e.target as Node)) {
        setShowWhatsNew(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showWhatsNew]);

  const handleOpenWhatsNew = useCallback(() => {
    setShowWhatsNew(prev => !prev);
    setShowDevUpdates(false);
    setHasUnseenChanges(false);
    const latest = changelog[0]?.version;
    if (latest) localStorage.setItem('whatsnew-seen-version', latest);
  }, []);

  const handleOpenDevUpdates = useCallback(() => {
    setShowDevUpdates(prev => !prev);
    setShowWhatsNew(false);
    setHasUnseenDevUpdates(false);
    const latestId = devUpdates[0]?.id;
    if (latestId) localStorage.setItem('devupdates-seen-id', latestId);
  }, [devUpdates]);

  const handleDownload = useCallback(async () => {
    setUpdateState('downloading');
    setDownloadPercent(0);
    await window.electron?.updater?.downloadUpdate();
  }, []);

  const handleCancel = useCallback(async () => {
    await window.electron?.updater?.cancelUpdate();
    setUpdateState('available');
    setDownloadPercent(0);
  }, []);

  const handleInstall = useCallback(() => {
    window.electron?.updater?.installUpdate();
  }, []);

  const handleMinimize = () => window.electron?.windowControls?.minimize();
  const handleMaximize = () => window.electron?.windowControls?.maximize();
  const handleClose = () => window.electron?.windowControls?.close();

  const showIndicator = updateState === 'available' || updateState === 'downloading' || updateState === 'downloaded' || updateState === 'error';

  return (
    <header className="header">
      <div className="header-left header-drag-region">
        <h1 className="header-title">GS Control Center</h1>
        <p className="header-subtitle">System Performance Control Center</p>
      </div>

      <div className="window-controls">
        {/* What's New button — always visible */}
        <div className="whatsnew-wrapper" ref={whatsNewRef}>
          <button
            className={`whatsnew-btn${showWhatsNew ? ' whatsnew-btn--active' : ''}`}
            onClick={handleOpenWhatsNew}
            aria-label="What's New"
            title="What's New?"
          >
            <Sparkles size={16} />
            {hasUnseenChanges && <span className="whatsnew-dot" />}
          </button>

          {showWhatsNew && (
            <div className="whatsnew-panel">
              <div className="whatsnew-panel-header">
                <span className="whatsnew-panel-title">
                  <Sparkles size={15} />
                  What's New
                </span>
                <button className="whatsnew-panel-close" onClick={() => setShowWhatsNew(false)} aria-label="Close">
                  <X size={14} />
                </button>
              </div>
              <div className="whatsnew-panel-body">
                {changelog.map((entry, i) => (
                  <div className="whatsnew-version-block" key={entry.version}>
                    <div className="whatsnew-version-header">
                      <span className="whatsnew-version-tag">v{entry.version}</span>
                      <span className="whatsnew-version-date">{entry.date}</span>
                      {i === 0 && <span className="whatsnew-version-latest">Latest</span>}
                    </div>
                    {entry.highlights && (
                      <p className="whatsnew-highlights">{entry.highlights}</p>
                    )}
                    <div className="whatsnew-changes">
                      {entry.changes.map((c, j) => (
                        <div className="whatsnew-change" key={j}>
                          <span className={`whatsnew-change-badge whatsnew-badge--${c.type}`}>{c.type}</span>
                          <span>{c.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Dev Updates button — hidden (issue resolved) */}

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
              {updateState === 'downloading' && <Download size={16} />}
              {updateState === 'downloaded' && <CheckCircle size={16} />}
              {updateState === 'error' && <AlertTriangle size={16} />}
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
                    {updateError && <p className="update-popup-error">{updateError}</p>}
                    <button className="update-popup-btn" onClick={handleDownload}>
                      <Download size={14} /> {updateError ? 'Retry Download' : 'Download Update'}
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
                    <p className="update-popup-percent">{Math.round(downloadPercent)}%</p>
                    <button className="update-popup-btn update-popup-btn--cancel" onClick={handleCancel}>
                      <XCircle size={14} /> Cancel
                    </button>
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

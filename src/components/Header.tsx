import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Minus, X, ArrowDownCircle, Download, RefreshCw, CheckCircle, AlertTriangle, XCircle, Sparkles, Radio } from 'lucide-react';
import ProfileDropdown from './ProfileDropdown';
import changelog from '../data/changelog';
import devUpdatesDefault from '../data/devUpdates';
import type { DevUpdate } from '../data/devUpdates';
import '../styles/Header.css';
import '../styles/WhatsNew.css';
import '../styles/DevUpdates.css';

// ─── Feature flags ───────────────────────────────────────────────────────────
const SHOW_WHATS_NEW = true; // Toggle What's New icon in header
// ─────────────────────────────────────────────────────────────────────────────

// Minimal markdown renderer for Dev Updates (supports GitHub-style formatting)
const escapeHtml = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const renderMarkdownToHtml = (markdown: string) => {
  if (!markdown) return '';

  // Basic escaping
  let html = escapeHtml(markdown);

  // Headers
  html = html.replace(/^###\s*(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^##\s*(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#\s*(.+)$/gm, '<h2>$1</h2>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr />');

  // Lists (unordered list support using *, -, +, including nesting)
  const lines = html.split('\n');
  const formatted: string[] = [];
  const listStack: number[] = []; // stores indentation levels for active <ul>

  const closeLists = (targetLevel = 0) => {
    while (listStack.length > targetLevel) {
      listStack.pop();
      formatted.push('</ul>');
    }
  };

  for (const line of lines) {
    const listMatch = line.match(/^(\s*)([*+-])\s+(.+)/);

    if (listMatch) {
      const indent = listMatch[1].length;
      const level = Math.floor(indent / 2);
      const content = listMatch[3];

      if (level > listStack.length) {
        // open nested lists
        for (let i = listStack.length; i < level; i += 1) {
          listStack.push(level);
          formatted.push('<ul>');
        }
      } else if (level < listStack.length) {
        closeLists(level);
      } else if (!listStack.length) {
        // start root list
        listStack.push(level);
        formatted.push('<ul>');
      }

      formatted.push(`<li>${content}</li>`);
      continue;
    }

    if (listStack.length) {
      closeLists(0);
    }

    formatted.push(line.trim());
  }

  if (listStack.length) {
    closeLists(0);
  }

  // Wrap any remaining lines in paragraphs
  let wrapped = formatted
    .map((line) => {
      if (!line) return '';
      const tagMatch = line.match(/^<\/?(h2|h3|h4|ul|li|p|blockquote|hr|code|pre|strong|em|a)/);
      if (tagMatch) return line;
      return `<p>${line}</p>`;
    })
    .join('');

  // Inline formatting (run last so list markers are not converted)
  wrapped = wrapped.replace(/\`([^`]+)\`/g, '<code>$1</code>');
  wrapped = wrapped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  wrapped = wrapped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  wrapped = wrapped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  return wrapped;
};

// GitHub Releases API Configuration
const GITHUB_REPO = 'xGlobalShock/GS-Control-Center'; // Change to your repo: 'owner/repo'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const DEV_UPDATES_CACHE_KEY = 'devupdates-cache';
const DEV_UPDATES_CACHE_TTL = 3600000; // 1 hour in milliseconds
const SESSION_START_KEY = 'devupdates-session-start';
const DEV_UPDATES_TAG = 'vDevUpdate'; // Set to specific tag, or leave empty for latest

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
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
  const [hasGitHubUpdates, setHasGitHubUpdates] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
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

  // Check for updates on mount (don't continuously poll to avoid flickering)
  useEffect(() => {
    const updater = window.electron?.updater;
    if (!updater) return;

    // Check once on mount
    updater.checkForUpdates().catch(() => {});
    
    // Fetch version
    updater.getVersion().then(setAppVersion).catch(() => {});
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
        // Check cache first (but will refresh every minute via interval below)
        const cached = localStorage.getItem(DEV_UPDATES_CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < DEV_UPDATES_CACHE_TTL) {
            setDevUpdates(data);
            setHasGitHubUpdates(data.some((u: DevUpdate) => u.id.startsWith('du-gh-')));
            return;
          }
        }

        const response = await fetch(GITHUB_API_URL, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (!response.ok) throw new Error('Failed to fetch releases');

        const releases: GitHubRelease[] = await response.json();

        let filtered = releases.filter(r => !r.draft && !r.prerelease);
        
        // If a specific tag is set, use only that release
        if (DEV_UPDATES_TAG) {
          filtered = filtered.filter(r => r.tag_name === DEV_UPDATES_TAG);
        } else {
          filtered = filtered.slice(0, 1); // Otherwise use latest
        }

        const updates: DevUpdate[] = filtered.map((release) => {
const description = release.body?.trim() || undefined;

            // Determine type from release name (check for [tag] prefix) or body keywords
            let type: 'bug' | 'in-progress' | 'planned' | 'info' = 'info';
            const nameAndBody = (release.name + ' ' + release.body).toLowerCase();
            
            if (nameAndBody.includes('[bug]') || nameAndBody.includes('fixing') || nameAndBody.includes('bug')) type = 'bug';
            else if (nameAndBody.includes('[in-progress]') || nameAndBody.includes('working on') || nameAndBody.includes('in progress')) type = 'in-progress';
            else if (nameAndBody.includes('[planned]') || nameAndBody.includes('coming') || nameAndBody.includes('planned')) type = 'planned';
            else if (nameAndBody.includes('[info]')) type = 'info';

            return {
              id: `du-gh-${release.id}`,
              date: release.published_at.split('T')[0],
              type,
              title: release.name, // Use actual release title
              description: description,
            };
          });

        setDevUpdates(updates.length > 0 ? updates : devUpdatesDefault);
        setHasGitHubUpdates(updates.length > 0);
        localStorage.setItem(DEV_UPDATES_CACHE_KEY, JSON.stringify({
          data: updates.length > 0 ? updates : devUpdatesDefault,
          timestamp: Date.now(),
        }));
      } catch (error) {
        setDevUpdates(devUpdatesDefault);
        setHasGitHubUpdates(false);
      }
    };

    // Fetch on mount and clear cache on new session
    const sessionStart = sessionStorage.getItem(SESSION_START_KEY);
    if (!sessionStart) {
      localStorage.removeItem(DEV_UPDATES_CACHE_KEY);
      sessionStorage.setItem(SESSION_START_KEY, Date.now().toString());
    }

    fetchDevUpdates();

    // Refresh every 5 minutes (was 10 s — hammered GitHub API and wasted CPU)
    const refreshInterval = setInterval(() => {
      localStorage.removeItem(DEV_UPDATES_CACHE_KEY);
      fetchDevUpdates();
    }, 300_000);

    return () => clearInterval(refreshInterval);
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
    <>
    <header className="header">
      <div className="header-left header-drag-region">
        <div className="header-title-row">
          <h1 className="header-title">
            <span className="header-title-gs">GS</span>
            <span className="header-title-word">Center</span>
          </h1>
          {appVersion && <span className="header-version">v{appVersion}</span>}
        </div>
        <p className="header-subtitle">System Performance Control Center</p>
      </div>

      <div className="window-controls">
        {/* What's New button */}
        {SHOW_WHATS_NEW && (
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
                        <React.Fragment key={j}>
                          {j > 0 && c.type !== entry.changes[j - 1].type && (
                            <div className="whatsnew-separator" aria-hidden="true" />
                          )}
                          <div className="whatsnew-change">
                            <span className={`whatsnew-change-badge whatsnew-badge--${c.type}`}>{c.type}</span>
                            <span>{c.text}</span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Dev Updates button */}
        {hasGitHubUpdates && (
          <div className="devupdates-wrapper" ref={devUpdatesRef}>
            <button
              className={`devupdates-btn ${showDevUpdates ? 'devupdates-btn--active' : ''}`}
              onClick={handleOpenDevUpdates}
              aria-label="Dev Updates"
              title="Developer updates"
            >
              <Radio size={16} />
              {hasUnseenDevUpdates && <span className="devupdates-dot" />}
            </button>

            {showDevUpdates && (
              <div className="devupdates-panel">
                <div className="devupdates-panel-header">
                  <h3 className="devupdates-panel-title">Announcements</h3>
                  <button className="devupdates-panel-close" onClick={() => setShowDevUpdates(false)}>
                    <X size={14} />
                  </button>
                </div>
                <div className="devupdates-panel-body">
                  {devUpdates.length > 0 ? (
                    devUpdates.map((update) => (
                      <div key={update.id} className="devupdates-item">
                        <div className={`devupdates-indicator devupdates-indicator--${update.type}`} />
                        <div className="devupdates-content">
                          <div className="devupdates-item-header">
                            <span className={`devupdates-type-badge devupdates-type-badge--${update.type}`}>
                              {update.type}
                            </span>
                            <span className="devupdates-item-date">{update.date}</span>
                          </div>
                          <h4 className="devupdates-item-title">{update.title}</h4>
                          {update.description && (
                            <div
                              className="devupdates-item-description"
                              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(update.description) }}
                            />
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="devupdates-empty">No updates available</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

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
                      <div className="update-progress-fill" style={{ transform: `scaleX(${downloadPercent / 100})` }} />
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

        {/* Profile / Auth */}
        <ProfileDropdown />

        <div className="window-controls-separator" />

        <button className="window-control-btn minimize-btn" onClick={handleMinimize} aria-label="Minimize">
          <Minus size={16} />
        </button>
        <button className="window-control-btn close-btn" onClick={handleClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
    </header>

    </>
  );
});

Header.displayName = 'Header';

export default Header;

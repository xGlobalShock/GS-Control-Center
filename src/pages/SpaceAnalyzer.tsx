import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HardDrive, Play, Square, Folder, File, ChevronRight,
  Search, Activity, ChevronLeft, Cpu, Radar, Orbit,
  AlertTriangle, Crosshair, Sparkles, Trash2, Copy, Zap, X
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import '../styles/SpaceAnalyzer.css';

const AnimatedDots: React.FC = () => (
  <span className="sa-animated-dots">
    <span>.</span><span>.</span><span>.</span>
  </span>
);

export interface SpaceChild {
  name: string;
  path: string;
  size: number;
  allocated: number;
  fileCount?: number;
  folderCount?: number;
  modified: string;
  isDir: boolean;
}

export interface SpaceResult {
  totalSize: number;
  children: SpaceChild[];
  scannedFiles: number;
  scannedDirs: number;
  driveCapacity: number;
  driveFree: number;
  isCached?: boolean;
  fromCache?: boolean;
}

interface SpaceProgress {
  dirPath: string;
  files: number;
  dirs: number;
  size: number;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function SpaceAnalyzer({ isActive }: { isActive: boolean }) {
  const [targetPath, setTargetPath] = useState('C:\\');
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<SpaceProgress | null>(null);
  const [result, setResult] = useState<SpaceResult | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: SpaceChild } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cacheRef = React.useRef<Map<string, SpaceResult>>(new Map());

  const normalizePath = (p: string) => {
    let v = p.trim();
    v = v.replace(/[\\/]+$/, '');
    if (/^[A-Za-z]:$/.test(v)) v += '\\';
    return v.toLowerCase();
  };

  // Close context menu on any global click or escape
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('space:progress', (data: SpaceProgress) => {
      // Only process updates for the current scanning target
      if (data.dirPath === targetPath) setProgress(data);
    });
    return () => unsub();
  }, [targetPath]);

  useEffect(() => {
    // If we leave the page while scanning, abort backend operation smoothly to save CPU
    if (!isActive && isScanning && window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('space:cancel', targetPath);
      setIsScanning(false);
    }
  }, [isActive, isScanning, targetPath]);

  // Inject preloaded analyzer data from splash screen, if available
  useEffect(() => {
    if (!result && !isScanning && window && (window as any).__SPACE_ANALYZER_PRELOADED__) {
      const preloaded = (window as any).__SPACE_ANALYZER_PRELOADED__ as SpaceResult;
      if (preloaded) {
        const initialPath = normalizePath('C:\\');
        cacheRef.current.set(initialPath, preloaded);
        setTargetPath('C:');
        setResult(preloaded);
      }
    }
  }, [result, isScanning]);

  // Intentionally do not auto-start scan on page activation.
  // Users must click on the "Start Scan" button to begin.

  const handleScan = async (pathOverride?: string, forceRescan = false, updateHistory = true) => {
    const p = pathOverride || targetPath;
    const normalizedPath = normalizePath(p);

    // Avoid redundant scan if path already displayed and not forcing refresh
    if (!forceRescan && p === targetPath && result) {
      return;
    }

    if (pathOverride && updateHistory) {
      setHistory((prev) => [...prev, targetPath]);
      setTargetPath(p);
    } else if (pathOverride) {
      setTargetPath(p);
    }

    if (isScanning) {
      await window.electron?.ipcRenderer?.invoke('space:cancel', targetPath);
    }

    // Use cached node from backend (e.g. root scanned during splash) before scanning.
    if (!forceRescan && window.electron?.ipcRenderer) {
      try {
        const cachedNode = await window.electron.ipcRenderer.invoke('space:get-node', p);
        if (cachedNode) {
          setResult(cachedNode);
          cacheRef.current.set(normalizedPath, cachedNode);
          setIsScanning(false);
          setProgress(null);
          return;
        }
      } catch (err) {
        console.error('space:get-node failed', err);
      }
    }

    // Try local cache first to avoid rerun scan in UI when available
    if (!forceRescan && cacheRef.current.has(normalizedPath)) {
      const cached = cacheRef.current.get(normalizedPath)!;
      setResult(cached);
      setIsScanning(false);
      setProgress(null);
      return;
    }

    setProgress(null);

    let showScanning = false;
    const scanDelayed = setTimeout(() => {
      showScanning = true;
      setIsScanning(true);
      setResult(null);
      setProgress({ dirPath: p, files: 0, dirs: 0, size: 0 });
    }, 420);

    try {
      const res = await window.electron?.ipcRenderer?.invoke('space:scan', p, forceRescan);
      if (res) {
        setResult(res);
        cacheRef.current.set(normalizedPath, res);
      }

      if (res?.fromCache) {
        clearTimeout(scanDelayed);
        setIsScanning(false);
        setProgress(null);
        return;
      }

      if (!showScanning) {
        clearTimeout(scanDelayed);
      }
    } catch (err) {
      console.error(err);
    } finally {
      clearTimeout(scanDelayed);
      if (showScanning) {
        setIsScanning(false);
      }
      setProgress(null);
    }
  };

  const handleCancel = async () => {
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('space:cancel', targetPath);
      setIsScanning(false);
    }
  };

  const handleBack = () => {
    if (history.length === 0 || isScanning) return;
    const newHistory = [...history];
    const prev = newHistory.pop()!;
    setHistory(newHistory);

    handleScan(prev, false, false);
  };

  const percentage = (childSize: number) => {
    if (!result || result.totalSize === 0) return 0;
    return (childSize / result.totalSize) * 100;
  };

  const currentDirs = isScanning ? (progress?.dirs ?? 0) : (result?.scannedDirs ?? 0);
  const currentFiles = isScanning ? (progress?.files ?? 0) : (result?.scannedFiles ?? 0);
  const currentSize = isScanning ? (progress?.size ?? 0) : (result?.totalSize ?? 0);
  
  // Create an arbitrary efficiency metric based on files scanned for flair
  const efficiency = currentFiles > 0 ? Math.min(100, (currentFiles / 100000) * 100 + 40) : 0;

  const topUsage = result
    ? [...result.children].sort((a, b) => b.size - a.size).slice(0, 5)
    : [];

  const handleRightClick = (e: React.MouseEvent, child: SpaceChild) => {
    e.preventDefault();
    setConfirmDelete(false);
    setContextMenu({ x: e.clientX, y: e.clientY, item: child });
  };

  const handleDelete = async () => {
    if (!contextMenu || !window.electron?.ipcRenderer) return;
    
    if (!confirmDelete) {
        setConfirmDelete(true);
        return;
    }

    setIsDeleting(true);
    try {
      const res = await window.electron.ipcRenderer.invoke('space:delete', contextMenu.item.path);
      if (res.success) {
        // Remove item from local UI list instantly
        setResult(prev => prev ? {
          ...prev,
          children: prev.children.filter(c => c.path !== contextMenu.item.path)
        } : null);
      } else {
        alert(res.error || 'Deletion failed');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
      setContextMenu(null);
      setConfirmDelete(false);
    }
  };

  const copyPath = () => {
    if (contextMenu) {
      navigator.clipboard.writeText(contextMenu.item.path);
      setContextMenu(null);
    }
  };

  return (
    <div className="sa-page" onContextMenu={(e) => e.preventDefault()}>
      <PageHeader icon={<HardDrive size={16} />} title="Disk Space Analyzer" />
      
      {/* ── CONTEXT MENU ── */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div 
            className="sa-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking menu itself
          >
            <div className="sa-menu-header">Fragment Analysis</div>
            
            <div className="sa-menu-item" onClick={() => { contextMenu.item.isDir ? handleScan(contextMenu.item.path) : copyPath(); }}>
               {contextMenu.item.isDir ? <Search size={14} /> : <Copy size={14} />}
               {contextMenu.item.isDir ? 'Analyze Sector' : 'Copy Path'}
            </div>

            <div className="sa-menu-item" onClick={copyPath}>
               <Copy size={14} /> Copy Path
            </div>

            <div className="sa-menu-divider" />

            <div 
              className={`sa-menu-item is-danger ${confirmDelete ? 'confirm-state' : ''}`} 
              onClick={handleDelete}
            >
               <Trash2 size={14} /> 
               {isDeleting ? 'Deleting...' : confirmDelete ? 'Delete this item?' : 'Delete'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── COMMAND DECK ── */}
      <motion.div 
        className="sa-command-deck"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {isScanning && (
           <motion.div 
             className="sa-scan-laser" 
             animate={{ x: ['-100%', '300%'] }}
             transition={{ duration: 2, ease: "linear", repeat: Infinity }}
           />
        )}
        <div className="sa-deck-left">
          <button className="sa-btn-cyber" onClick={handleBack} disabled={history.length === 0 || isScanning}>
            <ChevronLeft size={16} /> Back
          </button>

          <div className="sa-path-input-group">
            <HardDrive size={18} color="var(--sa-cyan)" />
            <input
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              disabled={isScanning}
              placeholder="e.g. C:\ or D:\Logs"
            />
          </div>
        </div>

        <button 
          className={`sa-btn-cyber ${isScanning ? 'sa-btn-danger' : ''}`} 
          onClick={() => (isScanning ? handleCancel() : handleScan(undefined, true))}
        >
          {isScanning ? (
            <><X size={16} /> Stop Scan</>
          ) : (
            <><Play size={16} /> Start Scan</>
          )}
        </button>
      </motion.div>

      {/* ── Core HUD Grid ── */}
      <div className="sa-hud-grid">
        
        {/* LEFT PANEL: CORE METRICS */}
        <motion.div 
          className="sa-metric-stack"
          initial={{ x: -30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="sa-metric-card">
            <div className="sa-metric-header"><Cpu size={14} /> Total Files</div>
            <div className="sa-metric-value">{!isScanning && !result ? '—' : currentFiles.toLocaleString()}</div>
            <div className="sa-metric-desc">Files Found</div>
          </div>

          <div className="sa-metric-card">
            <div className="sa-metric-header"><Radar size={14} /> Subdirectories</div>
            <div className="sa-metric-value">{!isScanning && !result ? '—' : currentDirs.toLocaleString()}</div>
            <div className="sa-metric-desc">Folders Found</div>
          </div>

          <div className="sa-metric-card">
            <div className="sa-metric-header"><Orbit size={14} /> Used Space</div>
            <div className="sa-metric-value" style={{color: "var(--sa-cyan)"}}>{result && result.driveCapacity > 0 ? formatBytes(result.driveCapacity - result.driveFree) : isScanning ? <><span>Scanning</span><AnimatedDots /></> : '—'}</div>
            <div className="sa-metric-desc">{result?.driveCapacity > 0 ? `of ${formatBytes(result.driveCapacity)}` : 'Disk Usage'}</div>
          </div>
          
          <div className="sa-metric-card">
            <div className="sa-metric-header"><Sparkles size={14} /> Free Space</div>
            <div className="sa-metric-value" style={{color: "var(--sa-purple)"}}>{result && result.driveFree >= 0 ? formatBytes(result.driveFree) : isScanning ? <><span>Scanning</span><AnimatedDots /></> : '—'}</div>
            <div className="sa-metric-desc">Available</div>
          </div>
        </motion.div>

        {/* CENTER PANEL: VECTOR MAP */}
        <motion.div 
          className="sa-panel sa-dir-panel"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <div className="sa-dir-header">
            <div style={{ flex: '2' }}>Name</div>
            <div style={{ flex: '1', textAlign: 'right' }}>Size</div>
            <div style={{ flex: '1', textAlign: 'right' }}>Allocated</div>
            <div style={{ flex: '0.8', textAlign: 'center' }}>Files</div>
            <div style={{ flex: '0.8', textAlign: 'center' }}>Folders</div>
            <div style={{ flex: '0.8', textAlign: 'right' }}>% Parent</div>
            <div style={{ flex: '1.2', textAlign: 'right' }}>Modified</div>
          </div>
          
          <div className="sa-dir-body">
            {!result && !isScanning && (
              <div className="sa-empty-state">
                <Crosshair size={64} strokeWidth={1} />
                <h3>Ready to Scan</h3>
                <p>Enter a folder path in the input above to begin the disk space analysis.</p>
              </div>
            )}

            {isScanning && !result && (
              <div className="sa-empty-state">
                <Activity size={64} className="sa-icon-glow" />
                <h3 style={{color: "var(--sa-cyan)"}}>Scanning Folders...</h3>
                <p>Analyzing files and folders in {targetPath}</p>
              </div>
            )}

            <AnimatePresence>
              {result?.children.map((child, idx) => {
                const pct = percentage(child.size);
                const lastMod = child.modified ? new Date(child.modified).toLocaleDateString('en-US', { year: '2-digit', month: '2-digit', day: '2-digit' }) : 'N/A';
                const files = child.isDir ? (child.fileCount || 0) : '';
                const folders = child.isDir ? (child.folderCount || 0) : '';
                return (
                  <motion.div
                    key={child.path}
                    className={`sa-row ${child.isDir ? 'is-dir' : ''}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx * 0.015, 0.4), type: 'spring' }}
                    onClick={() => child.isDir && handleScan(child.path, false)}
                    onContextMenu={(e) => handleRightClick(e, child)}
                  >
                    <div style={{ flex: '2', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      {child.isDir ? <Folder size={16} className="sa-icon-glow" /> : <File size={16} color="rgba(255,255,255,0.4)" />}
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={child.name}>{child.name}</span>
                    </div>
                    <div style={{ flex: '1', textAlign: 'right', color: 'var(--sa-cyan)' }}>{formatBytes(child.size)}</div>
                    <div style={{ flex: '1', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>{formatBytes(child.allocated || 0)}</div>
                    <div style={{ flex: '0.8', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>{files}</div>
                    <div style={{ flex: '0.8', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>{folders}</div>
                    <div style={{ flex: '0.8', position: 'relative', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: '100%', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '4px', border: '1px solid rgba(0, 204, 106, 0.15)' }} />
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                        style={{ 
                          position: 'absolute', 
                          left: 0, 
                          top: 0, 
                          height: '100%',
                          background: pct > 50 
                            ? 'linear-gradient(90deg, rgb(255, 0, 0), rgb(255, 0, 0))'
                            : pct > 25
                            ? 'linear-gradient(90deg, rgb(255, 217, 0), rgb(255, 217, 0))'
                            : 'linear-gradient(90deg, rgb(0, 255, 55), rgb(0, 255, 55))',
                          borderRadius: '4px',
                          boxShadow: pct > 50 ? '0 0 12px rgba(255, 45, 85, 0.5)' : pct > 25 ? '0 0 10px rgba(255, 214, 0, 0.4)' : '0 0 10px rgba(0, 255, 136, 0.4)'
                        }} 
                      />
                      <span style={{ position: 'relative', zIndex: 1, color: '#ffffff', fontSize: '11px', fontWeight: 700, textShadow: '0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)' }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ flex: '1.2', textAlign: 'right', color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>{lastMod}</div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* RIGHT PANEL: TELEMETRY ── */}
        <motion.div 
          className="sa-telemetry-panel"
          initial={{ x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="sa-radar-box">
            <div className="sa-radar-title"><AlertTriangle size={18} /> Largest Items</div>
            
            {topUsage.length === 0 ? (
               <div className="sa-empty-state" style={{minHeight: 150}}>
                 <p style={{fontSize: '0.8rem'}}>No items to display</p>
               </div>
            ) : (
              <div className="sa-hotspot-list">
                {topUsage.map((item, idx) => (
                  <div className="sa-hotspot-item" key={item.path}>
                    <div className="sa-hotspot-rank">0{idx + 1}</div>
                    <div className="sa-hotspot-details">
                      <h4 title={item.name}>{item.name}</h4>
                      <p>{formatBytes(item.size)} // {percentage(item.size).toFixed(1)}% of Disk</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sa-status-matrix">
            <div className="sa-matrix-cell">
              Folders Analyzed
              <strong>{(history.length + 1).toString().padStart(3, '0')}</strong>
            </div>
            <div className="sa-matrix-cell">
              Cache Status
              <strong>{isScanning ? 'Disabled' : 'Enabled'}</strong>
            </div>
            <div className="sa-matrix-cell">
              Scan Status
              <strong style={{color: isScanning ? 'var(--sa-pink)' : 'var(--sa-text)'}}>
                {isScanning ? 'Running...' : 'Ready'}
              </strong>
            </div>
            <div className="sa-matrix-cell">
              Items &gt; 25%
              <strong style={{color: 'var(--sa-text)'}}>{result ? topUsage.filter(x => percentage(x.size) > 25).length : 0}</strong>
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}

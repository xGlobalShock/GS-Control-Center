import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HardDrive, Play, Square, Folder, File, ChevronRight,
  Search, Activity, ChevronLeft, Cpu, Radar, Orbit,
  AlertTriangle, Crosshair, Sparkles
} from 'lucide-react';
import '../styles/SpaceAnalyzer.css';

export interface SpaceChild {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
}

export interface SpaceResult {
  totalSize: number;
  children: SpaceChild[];
  scannedFiles: number;
  scannedDirs: number;
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

  // Clean auto-load logic to fetch background scanned items automatically correctly!
  useEffect(() => {
    if (isActive && !result && !isScanning && targetPath === 'C:\\') {
      handleScan('C:\\', false);
    }
  }, [isActive]);

  const handleScan = async (pathOverride?: string, forceRescan = false) => {
    const p = pathOverride || targetPath;
    if (pathOverride) {
      setHistory((prev) => [...prev, targetPath]);
      setTargetPath(p);
    }

    if (isScanning) {
      await window.electron?.ipcRenderer?.invoke('space:cancel', targetPath);
    }

    setIsScanning(true);
    setProgress({ dirPath: p, files: 0, dirs: 0, size: 0 });
    setResult(null);

    try {
      const res = await window.electron?.ipcRenderer?.invoke('space:scan', p, forceRescan);
      if (res) setResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsScanning(false);
      setProgress(null); // Critical: clear progress so stats revert to result values!
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
    setTargetPath(prev);

    setIsScanning(true);
    setProgress({ dirPath: prev, files: 0, dirs: 0, size: 0 });
    setResult(null);

    window.electron?.ipcRenderer?.invoke('space:scan', prev, false)
      .then((res) => {
        if (res) setResult(res);
      }).catch(console.error).finally(() => {
        setIsScanning(false);
        setProgress(null);
      });
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

  return (
    <div className="sa-page">
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
            <ChevronLeft size={16} /> REVERT
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
            <><Square size={16} /> ABORT SCAN</>
          ) : (
            <><Play size={16} /> LAUNCH SCAN</>
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
            <div className="sa-metric-header"><Cpu size={14} /> CLUSTER INTEGRITY</div>
            <div className="sa-metric-value">{currentFiles.toLocaleString()}</div>
            <div className="sa-metric-desc">Discovered Data Fragments</div>
          </div>

          <div className="sa-metric-card">
            <div className="sa-metric-header"><Radar size={14} /> TOPOLOGY DEPTH</div>
            <div className="sa-metric-value">{currentDirs.toLocaleString()}</div>
            <div className="sa-metric-desc">Mapped Sub-Directories</div>
          </div>

          <div className="sa-metric-card">
            <div className="sa-metric-header"><Orbit size={14} /> MASS QUANTUM</div>
            <div className="sa-metric-value" style={{color: "var(--sa-cyan)"}}>{formatBytes(currentSize)}</div>
            <div className="sa-metric-desc">Accumulated Volume</div>
          </div>
          
          <div className="sa-metric-card">
            <div className="sa-metric-header"><Sparkles size={14} /> NEURAL EFFICIENCY</div>
            <div className="sa-metric-value" style={{color: "var(--sa-purple)"}}>{efficiency.toFixed(1)}%</div>
            <div className="sa-metric-desc">Analysis Processing Rate</div>
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
            <div>IDENTIFIER</div>
            <div style={{textAlign: 'right'}}>VOLUME</div>
            <div>ALLOCATION</div>
          </div>
          
          <div className="sa-dir-body">
            {!result && !isScanning && (
              <div className="sa-empty-state">
                <Crosshair size={64} strokeWidth={1} />
                <h3>AWAITING TARGET COORDINATES</h3>
                <p>Input a structural path or initialize scan to begin rendering the holographic volume map.</p>
              </div>
            )}

            {isScanning && !result && (
              <div className="sa-empty-state">
                <Activity size={64} className="sa-icon-glow" />
                <h3 style={{color: "var(--sa-cyan)"}}>SYSTEM SCAN IN PROGRESS</h3>
                <p>Establishing neural uplink to sector {targetPath}...</p>
              </div>
            )}

            <AnimatePresence>
              {result?.children.map((child, idx) => {
                const pct = percentage(child.size);
                const barType = pct > 40 ? 'sa-bar-danger' : pct > 15 ? 'sa-bar-warning' : 'sa-bar-normal';
                return (
                  <motion.div
                    key={child.path}
                    className={`sa-row ${child.isDir ? 'is-dir' : ''}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx * 0.015, 0.4), type: 'spring' }}
                    onClick={() => child.isDir && handleScan(child.path, false)}
                  >
                    <div className="sa-row-name">
                      {child.isDir ? <Folder size={18} className="sa-icon-glow" /> : <File size={18} color="rgba(255,255,255,0.4)" />}
                      <span className="sa-name-text" title={child.name}>{child.name}</span>
                    </div>
                    <div className="sa-row-size" style={{textAlign: 'right'}}>{formatBytes(child.size)}</div>
                    <div className="sa-row-usage">
                      <div className="sa-bar-track">
                        <motion.div 
                          className={`sa-bar-fill ${barType}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                        />
                      </div>
                      <span className="sa-usage-pct">{pct.toFixed(2)}%</span>
                      {child.isDir ? (
                        <ChevronRight size={16} color="var(--sa-cyan)" className="sa-row-arrow" />
                      ) : (
                        <div className="sa-row-arrow" style={{ width: 16 }} />
                      )}
                    </div>
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
            <div className="sa-radar-title"><AlertTriangle size={18} /> CRITICAL HOTSPOTS</div>
            
            {topUsage.length === 0 ? (
               <div className="sa-empty-state" style={{minHeight: 150}}>
                 <p style={{fontSize: '0.8rem'}}>NO HAZARDOUS ANOMALIES DETECTED</p>
               </div>
            ) : (
              <div className="sa-hotspot-list">
                {topUsage.map((item, idx) => (
                  <div className="sa-hotspot-item" key={item.path}>
                    <div className="sa-hotspot-rank">0{idx + 1}</div>
                    <div className="sa-hotspot-details">
                      <h4 title={item.name}>{item.name.toUpperCase()}</h4>
                      <p>{formatBytes(item.size)} // {percentage(item.size).toFixed(1)}% IMPACT</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sa-status-matrix">
            <div className="sa-matrix-cell">
              SECTORS SCANNED
              <strong>{(history.length + 1).toString().padStart(3, '0')}</strong>
            </div>
            <div className="sa-matrix-cell">
              CACHE ENGINE
              <strong>{isScanning ? 'BYPASSED' : 'ACTIVE'}</strong>
            </div>
            <div className="sa-matrix-cell">
              UPLINK STATUS
              <strong style={{color: isScanning ? 'var(--sa-pink)' : 'var(--sa-cyan)'}}>
                {isScanning ? 'SYNCING...' : 'LOCKED'}
              </strong>
            </div>
            <div className="sa-matrix-cell">
              ANOMALIES &gt; 25%
              <strong style={{color: 'var(--sa-pink)'}}>{result ? topUsage.filter(x => percentage(x.size) > 25).length : 0}</strong>
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}

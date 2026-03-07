import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, CheckCircle, Package, Loader2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import '../styles/SoftwareUpdates.css';

interface PackageUpdate {
  name: string;
  id: string;
  version: string;
  available: string;
  source: string;
}

interface UpdateProgress {
  packageId: string;
  phase: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  status: string;
  percent: number;
}

interface SoftwareUpdatesProps {
  isActive?: boolean;
}

const SoftwareUpdates: React.FC<SoftwareUpdatesProps> = ({ isActive = false }) => {
  const [packages, setPackages] = useState<PackageUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [packageSizes, setPackageSizes] = useState<Record<string, string>>({});
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelAllRef = useRef(false);
  const hasScanned = useRef(false);
  const { addToast } = useToast();

  // Listen for real-time progress events
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    const unsub = window.electron.ipcRenderer.on('software:update-progress', (data: UpdateProgress) => {
      setProgress(prev => {
        // Only update if it's for the same package or new
        if (!prev || prev.packageId === data.packageId) return data;
        return data;
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const checkUpdates = useCallback(async () => {
    if (!window.electron?.ipcRenderer) {
      addToast('Electron IPC not available', 'error');
      return;
    }
    setLoading(true);
    setUpdatedIds(new Set());
    try {
      const result = await window.electron.ipcRenderer.invoke('software:check-updates');
      if (result.success) {
        setPackages(result.packages);
        setPackageSizes({});
        setLastChecked(new Date().toLocaleTimeString());
        if (result.count === 0) {
          addToast('All software is up to date!', 'success');
        } else {
          addToast(`Found ${result.count} update${result.count > 1 ? 's' : ''} available`, 'info');
          // Fetch installer sizes sequentially (winget can't handle parallel queries)
          (async () => {
            for (const pkg of result.packages) {
              try {
                const res: { id: string; size: string } = await window.electron.ipcRenderer.invoke('software:get-package-size', pkg.id);
                if (res.size) {
                  setPackageSizes(prev => ({ ...prev, [res.id]: res.size }));
                }
              } catch {}
            }
          })();
        }
      } else {
        addToast(result.message || 'Failed to check updates', 'error');
      }
    } catch (err) {
      addToast('Failed to check for updates', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Silently load pre-warmed cached data when page becomes active (no loading spinner)
  useEffect(() => {
    if (isActive && !hasScanned.current) {
      hasScanned.current = true;
      (async () => {
        if (!window.electron?.ipcRenderer) return;
        try {
          const result = await window.electron.ipcRenderer.invoke('software:check-updates');
          if (result.success) {
            setPackages(result.packages);
            setLastChecked(new Date().toLocaleTimeString());
          }
        } catch {}
      })();
    }
  }, [isActive]);

  const handleCancelUpdate = async () => {
    if (!window.electron?.ipcRenderer) return;
    setCancelRequested(true);
    cancelAllRef.current = true;
    try {
      await window.electron.ipcRenderer.invoke('software:cancel-update');
    } catch {}
  };

  const handleUpdate = async (pkg: PackageUpdate) => {
    if (!window.electron?.ipcRenderer) return;
    setUpdatingId(pkg.id);
    setProgress(null);
    setCancelRequested(false);
    cancelAllRef.current = false;
    try {
      const result = await window.electron.ipcRenderer.invoke('software:update-app', pkg.id);
      if (result.success) {
        addToast(`${pkg.name} updated successfully`, 'success');
        setUpdatedIds(prev => new Set(prev).add(pkg.id));
        setTimeout(() => {
          setPackages(prev => prev.filter(p => p.id !== pkg.id));
        }, 2000);
        setTimeout(() => {
          hasScanned.current = false;
          checkUpdates();
        }, 4000);
      } else if (result.cancelled) {
        addToast(`Update of ${pkg.name} cancelled`, 'info');
      } else {
        addToast(result.message || `Failed to update ${pkg.name}`, 'error');
      }
    } catch (err) {
      addToast(`Error updating ${pkg.name}`, 'error');
    } finally {
      setTimeout(() => setProgress(null), 3000);
      setUpdatingId(null);
      setCancelRequested(false);
    }
  };

  const handleUpdateAll = async () => {
    if (!window.electron?.ipcRenderer) return;
    setUpdatingAll(true);
    setCancelRequested(false);
    cancelAllRef.current = false;
    let successCount = 0;
    let failCount = 0;
    for (const pkg of pendingPackages) {
      if (cancelAllRef.current) break;
      setUpdatingId(pkg.id);
      setProgress(null);
      try {
        const result = await window.electron.ipcRenderer.invoke('software:update-app', pkg.id);
        if (cancelAllRef.current || result.cancelled) break;
        if (result.success) {
          successCount++;
          setUpdatedIds(prev => new Set(prev).add(pkg.id));
          setPackages(prev => prev.filter(p => p.id !== pkg.id));
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }
    setUpdatingId(null);
    setTimeout(() => setProgress(null), 3000);
    const wasCancelled = cancelAllRef.current;
    setUpdatingAll(false);
    setCancelRequested(false);
    cancelAllRef.current = false;
    if (wasCancelled) {
      addToast(`Update cancelled — ${successCount} updated before cancel`, 'info');
    } else if (failCount === 0) {
      addToast(`All ${successCount} package${successCount !== 1 ? 's' : ''} updated successfully`, 'success');
    } else if (successCount > 0) {
      addToast(`${successCount} updated, ${failCount} failed`, 'info');
    } else {
      addToast('Failed to update packages', 'error');
    }
    // Re-scan for remaining updates
    setTimeout(() => {
      hasScanned.current = false;
      checkUpdates();
    }, 2000);
  };

  const pendingPackages = packages.filter(p => !updatedIds.has(p.id));

  return (
    <motion.div
      className="su"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <PageHeader
        icon={<Package size={16} />}
        title="Software Updates"
        stat={
          lastChecked ? (
            <span className="su-last-checked">Last checked: {lastChecked}</span>
          ) : null
        }
        actions={
          <div className="su-header-actions">
            <button
              className="su-btn su-btn--scan"
              onClick={checkUpdates}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'su-spin' : ''} />
              {loading ? 'Scanning…' : 'Check for Updates'}
            </button>
            {pendingPackages.length > 1 && !updatingAll && (
              <button
                className="su-btn su-btn--update-all"
                onClick={handleUpdateAll}
                disabled={updatingAll || updatingId !== null}
              >
                <Download size={14} />
                {`Update All (${pendingPackages.length})`}
              </button>
            )}
            {(updatingAll || updatingId !== null) && (
              <button
                className="su-btn su-btn--cancel"
                onClick={handleCancelUpdate}
                disabled={cancelRequested}
              >
                <X size={14} />
                {cancelRequested ? 'Cancelling…' : 'Cancel Update'}
              </button>
            )}
          </div>
        }
      />

      {/* Loading state */}
      {loading && packages.length === 0 && (
        <div className="su-loading">
          <Loader2 size={32} className="su-spin" />
          <p>Scanning installed packages…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && packages.length === 0 && (
        <motion.div
          className="su-empty"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <CheckCircle size={48} />
          <h3>All Up to Date</h3>
          <p>No pending software updates found.</p>
        </motion.div>
      )}

      {/* Update table */}
      {packages.length > 0 && (
        <motion.div
          className="su-table-wrap"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="su-table">
            {/* Header */}
            <div className="su-row su-row--header">
              <div className="su-cell su-cell--name">Package Name</div>
              <div className="su-cell su-cell--id">Package ID</div>
              <div className="su-cell su-cell--version">Current</div>
              <div className="su-cell su-cell--available">Available</div>
              <div className="su-cell su-cell--size">Size</div>
              <div className="su-cell su-cell--source">Source</div>
              <div className="su-cell su-cell--action">Action</div>
            </div>

            {/* Rows */}
            <AnimatePresence>
              {packages.map((pkg, i) => {
                const isUpdated = updatedIds.has(pkg.id);
                const isUpdating = updatingId === pkg.id;
                const isBatchUpdating = updatingAll && isUpdating;
                const pkgProgress = progress && progress.packageId === pkg.id ? progress : null;
                const showProgress = isUpdating || (pkgProgress && (pkgProgress.phase === 'done' || pkgProgress.phase === 'error'));

                return (
                  <motion.div
                    key={pkg.id}
                    className={`su-row ${isUpdated ? 'su-row--updated' : ''} ${showProgress ? 'su-row--has-progress' : ''}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <div className="su-cell su-cell--name">
                      <span className="su-pkg-name">{pkg.name}</span>
                    </div>
                    <div className="su-cell su-cell--id">
                      <span className="su-pkg-id">{pkg.id}</span>
                    </div>
                    <div className="su-cell su-cell--version">{pkg.version}</div>
                    <div className="su-cell su-cell--available">
                      <span className="su-new-version">{pkg.available}</span>
                    </div>
                    <div className="su-cell su-cell--size">
                      {packageSizes[pkg.id] ? (
                        <span className="su-pkg-size">{packageSizes[pkg.id]}</span>
                      ) : (
                        <span className="su-pkg-size su-pkg-size--loading">—</span>
                      )}
                    </div>
                    <div className="su-cell su-cell--source">{pkg.source}</div>
                    <div className="su-cell su-cell--action">
                      {isUpdated && !pkgProgress ? (
                        <span className="su-updated-badge">
                          <CheckCircle size={14} /> Updated
                        </span>
                      ) : (
                        <button
                          className="su-btn su-btn--row-update"
                          onClick={() => handleUpdate(pkg)}
                          disabled={isUpdating || updatingAll}
                        >
                          {isUpdating ? (
                            <><Loader2 size={14} className="su-spin" /> {isBatchUpdating ? 'Updating…' : 'Updating…'}</>
                          ) : (
                            <><Download size={14} /> Update</>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Progress bar overlay */}
                    {showProgress && pkgProgress && (
                      <div className="su-progress-row">
                        <div className="su-progress-bar-wrap">
                          <div
                            className={`su-progress-bar su-progress-bar--${pkgProgress.phase} ${pkgProgress.percent < 0 ? 'su-progress-bar--indeterminate' : ''}`}
                            style={{ width: pkgProgress.percent >= 0 ? `${Math.max(pkgProgress.percent, 2)}%` : '100%' }}
                          />
                        </div>
                        <div className="su-progress-info">
                          <span className={`su-progress-status su-progress-status--${pkgProgress.phase}`}>
                            {pkgProgress.status}
                          </span>
                          <span className="su-progress-details">
                            {pkgProgress.phase === 'verifying' && (
                              <span className="su-progress-installing">Hash verified</span>
                            )}
                            {pkgProgress.phase === 'installing' && (
                              <span className="su-progress-installing">Please wait…</span>
                            )}
                            {pkgProgress.phase === 'done' && (
                              <span className="su-progress-speed" style={{color: '#00FF88'}}>Complete</span>
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

    </motion.div>
  );
};

export default SoftwareUpdates;

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, HardDrive, FileSearch, Wrench, CheckCircle, XCircle, Loader2, AlertTriangle, X, Terminal } from 'lucide-react';
import '../styles/SystemRepairPanel.css';

type ToolStatus = 'idle' | 'running' | 'done' | 'error';

interface ToolState {
  status: ToolStatus;
  lines: string[];
  success?: boolean;
  verificationProgress: number | null;
}

const TOOLS = [
  {
    id: 'chkdsk',
    title: 'Disk Corruption Scan',
    subtitle: 'ChkDsk',
    icon: HardDrive,
    description: 'Scans the system disk (C:) for file system errors and bad sectors. A restart is required to complete the scan on the active system drive.',
    warning: 'A system restart is required to run the full scan.',
    color: '#f59e0b',
    channel: 'repair:run-chkdsk',
  },
  {
    id: 'sfc',
    title: 'System File Checker',
    subtitle: 'SFC /scannow',
    icon: FileSearch,
    description: 'Scans all protected Windows system files and replaces corrupted or missing files with a cached copy from a compressed folder.',
    color: '#00F2FF',
    channel: 'repair:run-sfc',
  },
  {
    id: 'dism',
    title: 'Windows Image Repair',
    subtitle: 'DISM /RestoreHealth',
    icon: Wrench,
    description: 'Repairs the Windows component store that SFC relies on. Run this first if SFC reports it cannot fix certain files — it may take 20-40 minutes.',
    color: '#a78bfa',
    channel: 'repair:run-dism',
  },
];

const SystemRepairPanel: React.FC = () => {
  const [toolStates, setToolStates] = useState<Record<string, ToolState>>({
    chkdsk: { status: 'idle', lines: [], verificationProgress: null },
    sfc:    { status: 'idle', lines: [], verificationProgress: null },
    dism:   { status: 'idle', lines: [], verificationProgress: null },
  });
  // which tool's modal is open
  const [openModal, setOpenModal] = useState<string | null>(null);
  const [showChkdskConfirm, setShowChkdskConfirm] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const activeRunRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = window.electron?.ipcRenderer.on(
      'repair:progress',
      (data: { tool: string; line: string }) => {
        const { tool, line } = data;
        if (!line || !line.trim()) return;
        const trimmed = line.trim();

        // SFC: "Verification X% complete." — update progress, don't append
        const sfcMatch = trimmed.match(/verification\s+(\d+)%\s+complete/i);
        // DISM: handles both "[ ====55.5%  ]" (% inside) and "[ ==  ] 55.5%" (% outside)
        const dismMatch = !sfcMatch && trimmed.match(
          /^\[.*?([\d.]+)%.*\]|^\[.*?\]\s*([\d.]+)%|^\s*([\d.]+)%\s*$/i
        );

        if (sfcMatch) {
          const pct = parseInt(sfcMatch[1], 10);
          setToolStates(prev => ({
            ...prev,
            [tool]: { ...prev[tool], verificationProgress: pct },
          }));
          return;
        }

        if (dismMatch) {
          const pct = parseFloat(dismMatch[1] ?? dismMatch[2] ?? dismMatch[3]);
          if (!isNaN(pct)) {
            setToolStates(prev => ({
              ...prev,
              [tool]: { ...prev[tool], verificationProgress: Math.round(pct) },
            }));
            return;
          }
        }

        // All other lines append normally
        setToolStates(prev => ({
          ...prev,
          [tool]: {
            ...prev[tool],
            lines: [...(prev[tool]?.lines ?? []), trimmed],
          },
        }));
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Auto-scroll the modal log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [toolStates, openModal]);

  const handleRun = useCallback(async (toolId: string, channel: string) => {
    if (activeRunRef.current.has(toolId)) return;
    activeRunRef.current.add(toolId);

    setToolStates(prev => ({ ...prev, [toolId]: { status: 'running', lines: [], verificationProgress: null } }));
    setOpenModal(toolId);

    try {
      const result: any = await window.electron!.ipcRenderer.invoke(channel);
      setToolStates(prev => ({
        ...prev,
        [toolId]: {
          status: result.success ? 'done' : 'error',
          success: result.success,
          verificationProgress: prev[toolId].verificationProgress,
          lines:
            prev[toolId].lines.length > 0
              ? prev[toolId].lines
              : [result.message || 'Operation complete.'],
        },
      }));
    } catch (err: any) {
      setToolStates(prev => ({
        ...prev,
        [toolId]: {
          status: 'error',
          success: false,
          verificationProgress: prev[toolId].verificationProgress,
          lines: [err?.message || 'An unexpected error occurred.'],
        },
      }));
    } finally {
      activeRunRef.current.delete(toolId);
    }
  }, []);

  const handleCloseModal = useCallback((toolId: string) => {
    // Only allow closing when not running
    if (activeRunRef.current.has(toolId)) return;
    setOpenModal(null);
  }, []);

  const handleOpenModal = useCallback((toolId: string) => {
    setOpenModal(toolId);
  }, []);

  const modalTool = TOOLS.find(t => t.id === openModal);
  const modalState = openModal ? toolStates[openModal] : null;

  return (
    <>
      <div className="repair-panel">
        <div className="repair-tools-grid">
          {TOOLS.map((tool, i) => {
            const state = toolStates[tool.id] ?? { status: 'idle', lines: [] };
            const Icon = tool.icon;
            const isRunning = state.status === 'running';
            const isDone = state.status === 'done';
            const isError = state.status === 'error';
            const hasResult = isDone || isError;

            return (
              <motion.div
                key={tool.id}
                className="repair-card"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.07, type: 'spring', stiffness: 220, damping: 22 }}
                style={{ '--repair-color': tool.color } as React.CSSProperties}
              >
                <div className="repair-card-header">
                  <div className="repair-card-icon-wrap">
                    <Icon size={16} />
                  </div>
                  <div className="repair-card-titles">
                    <span className="repair-card-title">{tool.title}</span>
                    <span className="repair-card-subtitle">{tool.subtitle}</span>
                  </div>
                  <div className={`repair-status-badge repair-status--${state.status}`}>
                    {isRunning && <Loader2 size={11} className="repair-spin" />}
                    {isDone && <CheckCircle size={11} />}
                    {isError && <XCircle size={11} />}
                    <span>
                      {isRunning ? 'Running' : isDone ? 'Done' : isError ? 'Failed' : 'Idle'}
                    </span>
                  </div>
                </div>

                <p className="repair-card-desc">{tool.description}</p>

                <div className="repair-card-admin-note">
                  <ShieldAlert size={11} />
                  <span>Requires <strong>administrator privileges</strong>. Do not close the app while running.</span>
                </div>

                <div className="repair-card-actions">
                  <button
                    className="repair-run-btn"
                    disabled={isRunning}
                    onClick={() => {
                      if (tool.id === 'chkdsk') {
                        setShowChkdskConfirm(true);
                      } else {
                        handleRun(tool.id, tool.channel);
                      }
                    }}
                  >
                    {isRunning ? <Loader2 size={13} className="repair-spin" /> : <Icon size={13} />}
                    <span>{isRunning ? 'Running...' : hasResult ? 'Run Again' : 'Run Scan'}</span>
                  </button>
                  {(isRunning || hasResult) && (
                    <button
                      className="repair-view-btn"
                      onClick={() => handleOpenModal(tool.id)}
                      title="View Output"
                    >
                      <Terminal size={13} />
                      <span>View Output</span>
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Output Modal — rendered in portal so it overlays everything */}
      {createPortal(
        <AnimatePresence>
          {showChkdskConfirm && (
            <>
              <motion.div
                className="repair-modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setShowChkdskConfirm(false)}
              />
              <div className="repair-modal-wrapper">
                <motion.div
                  className="repair-confirm-dialog"
                  initial={{ opacity: 0, scale: 0.95, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 16 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                  style={{ '--repair-color': '#f59e0b' } as React.CSSProperties}
                >
                  <div className="repair-confirm-icon">
                    <AlertTriangle size={22} />
                  </div>
                  <div className="repair-confirm-title">System Restart Required</div>
                  <div className="repair-confirm-body">
                    A system restart is required to run the full ChkDsk scan. The scan will be
                    scheduled and will run automatically on your next restart.
                  </div>
                  <div className="repair-confirm-actions">
                    <button
                      className="repair-confirm-btn repair-confirm-btn--dismiss"
                      onClick={() => setShowChkdskConfirm(false)}
                    >
                      Dismiss
                    </button>
                    <button
                      className="repair-confirm-btn repair-confirm-btn--confirm"
                      onClick={() => {
                        setShowChkdskConfirm(false);
                        const chkdsk = TOOLS.find(t => t.id === 'chkdsk')!;
                        handleRun(chkdsk.id, chkdsk.channel);
                      }}
                    >
                      <HardDrive size={13} /> Schedule Scan
                    </button>
                  </div>
                </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {openModal && modalTool && modalState && (
            <>
              {/* Backdrop */}
              <motion.div
                className="repair-modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => handleCloseModal(openModal)}
              />

              {/* Modal — flex wrapper handles centering, inner div is animated */}
              <div className="repair-modal-wrapper">
              <motion.div
                className="repair-modal"
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                style={{ '--repair-color': modalTool.color } as React.CSSProperties}
              >
                {/* Modal Header */}
                <div className="repair-modal-header">
                  <div className="repair-modal-title-row">
                    <div className="repair-modal-icon">
                      <modalTool.icon size={16} />
                    </div>
                    <div>
                      <div className="repair-modal-title">{modalTool.title}</div>
                      <div className="repair-modal-subtitle">{modalTool.subtitle}</div>
                    </div>
                    <div className={`repair-status-badge repair-status--${modalState.status} repair-modal-badge`}>
                      {modalState.status === 'running' && <Loader2 size={11} className="repair-spin" />}
                      {modalState.status === 'done' && <CheckCircle size={11} />}
                      {modalState.status === 'error' && <XCircle size={11} />}
                      <span>
                        {modalState.status === 'running' ? 'Running...' : modalState.status === 'done' ? 'Completed' : modalState.status === 'error' ? 'Failed' : 'Idle'}
                      </span>
                    </div>
                  </div>
                  <button
                    className="repair-modal-close"
                    onClick={() => handleCloseModal(openModal)}
                    disabled={activeRunRef.current.has(openModal)}
                    title={activeRunRef.current.has(openModal) ? 'Wait for the scan to finish' : 'Close'}
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Log Output */}
                <div className="repair-modal-log" ref={logRef}>
                  {modalState.lines.length === 0 && modalState.verificationProgress === null ? (
                    <div className="repair-modal-log-empty">
                      <Loader2 size={16} className="repair-spin" />
                      <span>Waiting for output...</span>
                    </div>
                  ) : (
                    <>
                      {modalState.lines.map((line, j) => {
                        // Insert a spacer after lines that end a logical section
                        const isSectionEnd = /initializing|this may take a moment/i.test(line)
                          || /beginning verification phase/i.test(line)
                          || /^image version:/i.test(line);   // DISM header end
                        // Highlight the final result line
                        const isResult = /windows resource protection/i.test(line)   // SFC
                          || /restore operation completed successfully/i.test(line)   // DISM success
                          || /component store corruption/i.test(line)                 // DISM no corruption
                          || /the operation completed successfully/i.test(line)       // ChkDsk
                          || /windows successfully scanned/i.test(line)              // ChkDsk variant
                          || /no further action is required/i.test(line);             // DISM/SFC
                        return (
                          <React.Fragment key={j}>
                            <div className={`repair-log-line${isResult ? ' repair-log-line--result' : ''}`}>{line}</div>
                            {isSectionEnd && <div className="repair-log-spacer" />}
                          </React.Fragment>
                        );
                      })}
                      {/* DISM — animated text fill-bar */}
                      {openModal === 'dism' && modalState.verificationProgress !== null && (() => {
                        const pct = modalState.verificationProgress ?? 0;
                        const total = 36;
                        const filled = Math.round((pct / 100) * total);
                        const fill = filled > 0 ? '═'.repeat(Math.max(0, filled - 1)) + '>' : '';
                        const empty = ' '.repeat(total - filled);
                        return (
                          <div className="repair-log-line repair-log-line--progress repair-log-line--progress-gap">
                            {`[ ${fill}${empty} ]  ${pct.toFixed(1)}%`}
                          </div>
                        );
                      })()}
                      {/* SFC / ChkDsk — text percentage */}
                      {openModal !== 'dism' && modalState.verificationProgress !== null && modalState.verificationProgress < 100 && (
                        <div className="repair-log-line repair-log-line--progress repair-log-line--progress-gap">
                          Verification [{modalState.verificationProgress}%] complete.
                        </div>
                      )}
                      {/* Spacer after progress indicator, before final result */}
                      {modalState.verificationProgress !== null && (
                        <div className="repair-log-spacer" />
                      )}
                    </>
                  )}
                  {modalState.status === 'running' && <div className="repair-log-cursor" />}
                </div>

                {/* Modal Footer */}
                <div className="repair-modal-footer">
                  {modalState.status !== 'running' && (
                    <button
                      className="repair-run-btn"
                      onClick={() => handleRun(openModal, modalTool.channel)}
                      style={{ flex: 1 }}
                    >
                      <modalTool.icon size={13} />
                      <span>Run Again</span>
                    </button>
                  )}
                  <button
                    className="repair-modal-close-btn"
                    onClick={() => handleCloseModal(openModal)}
                    disabled={activeRunRef.current.has(openModal)}
                  >
                    {activeRunRef.current.has(openModal) ? 'Running...' : 'Close'}
                  </button>
                </div>
              </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default React.memo(SystemRepairPanel);


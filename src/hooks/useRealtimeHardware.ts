import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

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

/** Shape of the unified payload pushed from main process */
export interface RealtimeHWPayload {
  // CPU
  cpu: number;
  perCoreCpu: number[];
  cpuClock: number;
  temperature: number;
  tempSource: string;
  lhmReady: boolean;

  // GPU (from LHM)
  gpuTemp: number;
  gpuUsage: number;
  gpuVramUsed: number;        // MiB
  gpuVramTotal: number;       // MiB

  // Memory
  ram: number;                // usage %
  ramUsedGB: number;
  ramTotalGB: number;
  ramAvailableGB: number;
  ramCachedGB: number;

  // Disk
  disk: number;               // usage %
  diskReadSpeed: number;      // bytes/sec
  diskWriteSpeed: number;     // bytes/sec

  // Network
  networkUp: number;          // bytes/sec
  networkDown: number;        // bytes/sec
  latencyMs: number;
  packetLoss: number;
  ssid?: string;
  wifiSignal: number;
  activeAdapterName?: string;
  activeLinkSpeed?: string;
  activeLocalIP?: string;
  activeMac?: string;
  activeGateway?: string;

  // System
  processCount: number;
  systemUptime: string;

  _ts: number;
}

/** Split view matching App.tsx's existing state shape */
export interface RealtimeSystemStats {
  cpu: number;
  ram: number;
  disk: number;
  temperature: number;
  tempSource?: string;
  lhmReady?: boolean;
  gpuTemp?: number;
  gpuUsage?: number;
  gpuVramUsed?: number;
  gpuVramTotal?: number;
}

export interface RealtimeExtendedStats {
  cpuClock: number;
  perCoreCpu: number[];
  gpuUsage: number;
  gpuTemp: number;
  gpuVramUsed: number;
  gpuVramTotal: number;
  networkUp: number;
  networkDown: number;
  ssid?: string;
  wifiSignal: number;
  activeAdapterName?: string;
  activeLinkSpeed?: string;
  activeLocalIP?: string;
  activeMac?: string;
  activeGateway?: string;
  latencyMs?: number;
  packetLoss?: number;
  ramUsedGB: number;
  ramTotalGB: number;
  ramAvailableGB: number;
  ramCachedGB: number;
  diskReadSpeed: number;
  diskWriteSpeed: number;
  processCount: number;
  systemUptime: string;
}

const EMPTY_STATS: RealtimeSystemStats = {
  cpu: 0, ram: 0, disk: 0, temperature: 0, tempSource: 'none',
};

const EMPTY_EXT: RealtimeExtendedStats = {
  cpuClock: 0, perCoreCpu: [], gpuUsage: -1, gpuTemp: -1,
  gpuVramUsed: -1, gpuVramTotal: -1, networkUp: 0, networkDown: 0,
  wifiSignal: -1, ramUsedGB: 0, ramTotalGB: 0, ramAvailableGB: 0, ramCachedGB: 0, diskReadSpeed: 0,
  diskWriteSpeed: 0, processCount: 0, systemUptime: '', latencyMs: 0, packetLoss: -1,
};

interface UseRealtimeHardwareOptions {
  /** Only subscribe when this is true (e.g. when on dashboard page) */
  enabled?: boolean;
}

/**
 * Hook that subscribes to real-time hardware metrics pushed from the Electron
 * main process. Returns split systemStats / extendedStats matching the existing
 * App.tsx state shape, plus a `connected` flag.
 *
 * Uses useRef internally to hold the latest payload without causing re-renders.
 * State is flushed once per animation frame for smooth, batched UI updates.
 */
export function useRealtimeHardware(options: UseRealtimeHardwareOptions = {}) {
  const { enabled = true } = options;

  // Latest raw payload (never triggers re-render)
  const latestRef = useRef<RealtimeHWPayload | null>(null);
  const rafRef = useRef<number | null>(null);

  // Rendered state — updated at most once per animation frame
  const [systemStats, setSystemStats] = useState<RealtimeSystemStats>(EMPTY_STATS);
  const [extendedStats, setExtendedStats] = useState<RealtimeExtendedStats>(EMPTY_EXT);
  const [connected, setConnected] = useState(false);

  // Flush latest ref → state (batched via rAF)
  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = latestRef.current;
      if (!p) return;

      setSystemStats({
        cpu: p.cpu,
        ram: p.ram,
        disk: p.disk,
        temperature: p.temperature,
        tempSource: p.tempSource,
        lhmReady: p.lhmReady,
        gpuTemp: p.gpuTemp,
        gpuUsage: p.gpuUsage,
        gpuVramUsed: p.gpuVramUsed,
        gpuVramTotal: p.gpuVramTotal,
      });

      setExtendedStats({
        cpuClock: p.cpuClock,
        perCoreCpu: p.perCoreCpu,
        gpuUsage: p.gpuUsage,
        gpuTemp: p.gpuTemp,
        gpuVramUsed: p.gpuVramUsed,
        gpuVramTotal: p.gpuVramTotal,
        networkUp: p.networkUp,
        networkDown: p.networkDown,
        ssid: p.ssid,
        wifiSignal: p.wifiSignal,
        activeAdapterName: p.activeAdapterName,
        activeLinkSpeed: p.activeLinkSpeed,
        activeLocalIP: p.activeLocalIP,
        activeMac: p.activeMac,
        activeGateway: p.activeGateway,
        latencyMs: p.latencyMs,
        packetLoss: p.packetLoss,
        ramUsedGB: p.ramUsedGB,
        ramTotalGB: p.ramTotalGB,
        ramAvailableGB: p.ramAvailableGB,
        ramCachedGB: p.ramCachedGB,
        diskReadSpeed: p.diskReadSpeed,
        diskWriteSpeed: p.diskWriteSpeed,
        processCount: p.processCount,
        systemUptime: p.systemUptime,
      });

      if (!connected) setConnected(true);
    });
  }, [connected]);

  useEffect(() => {
    if (!enabled || !window.electron?.ipcRenderer) return;

    // Subscribe to push events from main process
    const unsubscribe = window.electron.ipcRenderer.on(
      'realtime-hw-update',
      (payload: RealtimeHWPayload) => {
        latestRef.current = payload;
        scheduleFlush();
      }
    );

    // Also request the main process to ensure push is running
    window.electron.ipcRenderer.invoke('system:start-realtime').catch(() => {});

    return () => {
      // Clean up subscription
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        window.electron?.ipcRenderer?.removeAllListeners?.('realtime-hw-update');
      }
      // Cancel pending rAF
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, scheduleFlush]);

  // Memoize the return value to avoid unnecessary downstream re-renders
  return useMemo(() => ({
    systemStats,
    extendedStats,
    connected,
  }), [systemStats, extendedStats, connected]);
}

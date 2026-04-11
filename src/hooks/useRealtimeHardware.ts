import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

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
  gpuClock: number;           // MHz
  gpuFan: number;             // %
  gpuFanRpm: number;          // RPM
  gpuPower: number;           // W
  gpuMemClock: number;        // MHz
  gpuHotSpot: number;         // °C
  gpuMemTemp: number;         // °C
  gpuVoltage: number;         // V
  gpuFanControllable: boolean;

  // CPU extended
  cpuPower: number;           // W
  cpuVoltage: number;         // V

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
  diskTemp: number;           // °C
  diskLife: number;           // %

  // Network
  networkUp: number;          // bytes/sec
  networkDown: number;        // bytes/sec
  latencyMs: number;
  packetLoss: number;
  internetLoss: number;
  gatewayLoss: number;
  gatewayLatency: number;
  pingGateway: string;
  pingMin: number;
  pingMax: number;
  pingAvg: number;
  pingJitter: number;
  pingSent: number;
  pingRecv: number;
  nicErrors: number;
  nicDiscards: number;
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
  cpuPower: number;
  cpuVoltage: number;
  perCoreCpu: number[];
  gpuUsage: number;
  gpuTemp: number;
  gpuVramUsed: number;
  gpuVramTotal: number;
  gpuClock?: number;
  gpuFan?: number;
  gpuFanRpm?: number;
  gpuPower: number;
  gpuMemClock: number;
  gpuHotSpot: number;
  gpuMemTemp: number;
  gpuVoltage: number;
  gpuFanControllable: boolean;
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
  internetLoss?: number;
  gatewayLoss?: number;
  gatewayLatency?: number;
  pingGateway?: string;
  pingMin?: number;
  pingMax?: number;
  pingAvg?: number;
  pingJitter?: number;
  pingSent?: number;
  pingRecv?: number;
  nicErrors?: number;
  nicDiscards?: number;
  ramUsedGB: number;
  ramTotalGB: number;
  ramAvailableGB: number;
  ramCachedGB: number;
  diskReadSpeed: number;
  diskWriteSpeed: number;
  diskTemp: number;
  diskLife: number;
  processCount: number;
  systemUptime: string;
}

const EMPTY_STATS: RealtimeSystemStats = {
  cpu: 0, ram: 0, disk: 0, temperature: 0, tempSource: 'none',
};

const EMPTY_EXT: RealtimeExtendedStats = {
  cpuClock: 0, cpuPower: -1, cpuVoltage: -1, perCoreCpu: [],
  gpuUsage: -1, gpuTemp: -1, gpuVramUsed: -1, gpuVramTotal: -1,
  gpuPower: -1, gpuMemClock: -1, gpuHotSpot: -1, gpuMemTemp: -1, gpuVoltage: -1,
  gpuFanControllable: false,
  networkUp: 0, networkDown: 0,
  wifiSignal: -1, ramUsedGB: 0, ramTotalGB: 0, ramAvailableGB: 0, ramCachedGB: 0,
  diskReadSpeed: 0, diskWriteSpeed: 0, diskTemp: -1, diskLife: -1,
  processCount: 0, systemUptime: '', latencyMs: 0, packetLoss: -1,
  internetLoss: -1, gatewayLoss: -1, gatewayLatency: 0, pingGateway: '',
  pingMin: 0, pingMax: 0, pingAvg: 0, pingJitter: 0, pingSent: 0, pingRecv: 0,
  nicErrors: 0, nicDiscards: 0,
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
  // Combined into a SINGLE state object so only one setState + one re-render per flush
  const [state, setState] = useState<{
    systemStats: RealtimeSystemStats;
    extendedStats: RealtimeExtendedStats;
    connected: boolean;
  }>({ systemStats: EMPTY_STATS, extendedStats: EMPTY_EXT, connected: false });

  // Expose stable references (derived from combined state)
  const { systemStats, extendedStats, connected } = state;

  // Flush latest ref → state (batched via rAF)
  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = latestRef.current;
      if (!p) return;

      setState({
        systemStats: {
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
        },
        extendedStats: {
          cpuClock: p.cpuClock,
          cpuPower: p.cpuPower,
          cpuVoltage: p.cpuVoltage,
          perCoreCpu: p.perCoreCpu,
          gpuUsage: p.gpuUsage,
          gpuTemp: p.gpuTemp,
          gpuVramUsed: p.gpuVramUsed,
          gpuVramTotal: p.gpuVramTotal,
          gpuClock: p.gpuClock,
          gpuFan: p.gpuFan,
          gpuFanRpm: p.gpuFanRpm,
          gpuPower: p.gpuPower,
          gpuMemClock: p.gpuMemClock,
          gpuHotSpot: p.gpuHotSpot,
          gpuMemTemp: p.gpuMemTemp,
          gpuVoltage: p.gpuVoltage,
          gpuFanControllable: p.gpuFanControllable,
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
          internetLoss: p.internetLoss ?? -1,
          gatewayLoss: p.gatewayLoss ?? -1,
          gatewayLatency: p.gatewayLatency ?? 0,
          pingGateway: p.pingGateway ?? '',
          pingMin: p.pingMin ?? 0,
          pingMax: p.pingMax ?? 0,
          pingAvg: p.pingAvg ?? 0,
          pingJitter: p.pingJitter ?? 0,
          pingSent: p.pingSent ?? 0,
          pingRecv: p.pingRecv ?? 0,
          nicErrors: p.nicErrors ?? 0,
          nicDiscards: p.nicDiscards ?? 0,
          ramUsedGB: p.ramUsedGB,
          ramTotalGB: p.ramTotalGB,
          ramAvailableGB: p.ramAvailableGB,
          ramCachedGB: p.ramCachedGB,
          diskReadSpeed: p.diskReadSpeed,
          diskWriteSpeed: p.diskWriteSpeed,
          diskTemp: p.diskTemp,
          diskLife: p.diskLife,
          processCount: p.processCount,
          systemUptime: p.systemUptime,
        },
        connected: true,
      });
    });
  }, []);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;

    let unsubscribe: (() => void) | undefined;

    if (enabled) {
      // Subscribe to push events from main process
      unsubscribe = window.electron.ipcRenderer.on(
        'realtime-hw-update',
        (payload: RealtimeHWPayload) => {
          latestRef.current = payload;
          scheduleFlush();
        }
      );

      // Also request the main process to ensure push is running
      window.electron.ipcRenderer.invoke('system:start-realtime').catch(() => {});
      window.electron.ipcRenderer.invoke('system:set-realtime-active', true).catch(() => {});
    } else {
      // Disable push when not needed (e.g., different page)
      window.electron.ipcRenderer.invoke('system:set-realtime-active', false).catch(() => {});
      window.electron.ipcRenderer.invoke('system:stop-realtime').catch(() => {});
    }

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

      // Ensure polling is disabled after unmount
      if (enabled) {
        window.electron?.ipcRenderer?.invoke('system:stop-realtime').catch(() => {});
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

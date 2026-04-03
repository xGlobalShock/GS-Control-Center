import React, { useEffect, useRef, useState } from 'react';
import DashboardHero, { MetricPoint } from '../components/DashboardHero';
import PageHeader from '../components/PageHeader';
import HealthScore from '../components/HealthScore';
import AdvisorPanel from '../components/AdvisorPanel';
import { Monitor } from 'lucide-react';
import type { HardwareInfo, ExtendedStats } from '../App';

/* ── Props mirror what App.tsx already passes to Dashboard ── */
interface LiveMetricsProps {
  systemStats: {
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
  };
  hardwareInfo?: HardwareInfo;
  extendedStats?: ExtendedStats;
}

const MAX_HISTORY = 60;

const LiveMetrics: React.FC<LiveMetricsProps> = React.memo(({ systemStats, hardwareInfo, extendedStats }) => {
  const [openPanel, setOpenPanel] = useState<'health' | 'advisor' | null>(null);
  const [cpuHistory, setCpuHistory] = useState<MetricPoint[]>([]);
  const [gpuHistory, setGpuHistory] = useState<MetricPoint[]>([]);
  const [ramHistory, setRamHistory] = useState<MetricPoint[]>([]);
  const [netHistory, setNetHistory] = useState<MetricPoint[]>([]);
  const [lossHistory, setLossHistory] = useState<MetricPoint[]>([]);
  const [diskHistory, setDiskHistory] = useState<MetricPoint[]>([]);
  const [processHistory, setProcessHistory] = useState<MetricPoint[]>([]);
  const lastWriteRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < 750) return;
    lastWriteRef.current = now;

    const cpu = systemStats?.cpu ?? 0;
    const gpu = Math.max(extendedStats?.gpuUsage ?? 0, 0);
    const ram = systemStats?.ram ?? 0;
    const ping = Math.max(extendedStats?.latencyMs ?? 0, 0);
    const loss = Math.max(extendedStats?.packetLoss ?? 0, 0);

    const disk = systemStats?.disk ?? 0;
    setCpuHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: cpu }]);
    setGpuHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: gpu }]);
    setRamHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: ram }]);
    setNetHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: ping }]);
    setLossHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: loss }]);
    setDiskHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: disk }]);
    const proc = Math.min(extendedStats?.processCount ?? 0, 500);
    setProcessHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { v: proc }]);
  }, [systemStats, extendedStats]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        icon={<Monitor size={16} />}
        title="SYSTEM DETAILS"
        actions={
          <>
            <HealthScore
              systemStats={systemStats}
              extendedStats={extendedStats}
              hardwareInfo={hardwareInfo}
              compact
              isExpanded={openPanel === 'health'}
              onToggle={() => setOpenPanel(p => p === 'health' ? null : 'health')}
            />
            <AdvisorPanel
              systemStats={systemStats}
              extendedStats={extendedStats}
              hardwareInfo={hardwareInfo}
              compact
              isExpanded={openPanel === 'advisor'}
              onToggle={() => setOpenPanel(p => p === 'advisor' ? null : 'advisor')}
            />
          </>
        }
      />
      <DashboardHero
        systemStats={systemStats}
        hardwareInfo={hardwareInfo}
        extendedStats={extendedStats}
        cpuHistory={cpuHistory}
        gpuHistory={gpuHistory}
        ramHistory={ramHistory}
        netHistory={netHistory}
        lossHistory={lossHistory}
        diskHistory={diskHistory}
        processHistory={processHistory}
      />
    </div>
  );
});

LiveMetrics.displayName = 'LiveMetrics';
export default LiveMetrics;

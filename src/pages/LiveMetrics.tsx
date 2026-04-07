import React, { useEffect, useRef, useState } from 'react';
import DashboardHero, { MetricPoint } from '../components/DashboardHero';
import Loader from '../components/Loader';
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

const MAX_HISTORY = 40;

const LiveMetrics: React.FC<LiveMetricsProps> = React.memo(({ systemStats, hardwareInfo, extendedStats }) => {
  const [openPanel, setOpenPanel] = useState<'health' | 'advisor' | null>(null);
  const [histories, setHistories] = useState<{
    cpu: MetricPoint[]; gpu: MetricPoint[]; ram: MetricPoint[];
    net: MetricPoint[]; loss: MetricPoint[]; disk: MetricPoint[]; proc: MetricPoint[];
  }>({ cpu: [], gpu: [], ram: [], net: [], loss: [], disk: [], proc: [] });
  const lastWriteRef = useRef(0);

  // Detect whether we've received any meaningful hardware data
  const hasData = (systemStats?.cpu > 0 || systemStats?.ram > 0 || systemStats?.disk > 0) || !!hardwareInfo;

  useEffect(() => {
    // Only accumulate history once we have real data
    if (!hasData) return;

    const now = Date.now();
    if (now - lastWriteRef.current < 750) return;
    lastWriteRef.current = now;

    const cpu = systemStats?.cpu ?? 0;
    const gpu = Math.max(extendedStats?.gpuUsage ?? 0, 0);
    const ram = systemStats?.ram ?? 0;
    const ping = Math.max(extendedStats?.latencyMs ?? 0, 0);
    const loss = Math.max(extendedStats?.packetLoss ?? 0, 0);
    const disk = systemStats?.disk ?? 0;
    const proc = Math.min(extendedStats?.processCount ?? 0, 500);

    // Single state update instead of 7 — one re-render per cycle
    setHistories(h => ({
      cpu:  [...h.cpu.slice(-(MAX_HISTORY - 1)),    { v: cpu  }],
      gpu:  [...h.gpu.slice(-(MAX_HISTORY - 1)),    { v: gpu  }],
      ram:  [...h.ram.slice(-(MAX_HISTORY - 1)),    { v: ram  }],
      net:  [...h.net.slice(-(MAX_HISTORY - 1)),    { v: ping }],
      loss: [...h.loss.slice(-(MAX_HISTORY - 1)),        { v: loss }],
      disk: [...h.disk.slice(-(MAX_HISTORY - 1)),   { v: disk }],
      proc: [...h.proc.slice(-(MAX_HISTORY - 1)),   { v: proc }],
    }));
  }, [systemStats, extendedStats, hasData]);

  // Destructure for prop compatibility
  const { cpu: cpuHistory, gpu: gpuHistory, ram: ramHistory, net: netHistory, loss: lossHistory, disk: diskHistory, proc: processHistory } = histories;

  // Show skeleton loader while waiting for hardware monitors to connect
  if (!hasData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <PageHeader
          icon={<Monitor size={16} />}
          title="SYSTEM DETAILS"
        />
        <Loader />
      </div>
    );
  }

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

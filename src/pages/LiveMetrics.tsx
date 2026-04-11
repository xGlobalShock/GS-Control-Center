import React, { useEffect, useRef, useState, useMemo } from 'react';
import DashboardHero, { MetricPoint } from '../components/DashboardHero';
import Loader from '../components/Loader';
import PageHeader from '../components/PageHeader';
import HealthScore from '../components/HealthScore';
import AdvisorPanel from '../components/AdvisorPanel';
import AntiCheatChecker from '../components/AntiCheatChecker';
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

const MAX_HISTORY = 600; // 5 minutes @ 2 Hz (500 ms push interval)

/* ── O(1) ring buffer — zero allocation per push, avoids GC pressure ── */
class RingBuffer {
  private buf: MetricPoint[];
  private head = 0;
  private count = 0;
  private cap: number;

  constructor(capacity: number) {
    this.cap = capacity;
    this.buf = new Array(capacity);
  }

  push(v: number) {
    this.buf[this.head] = { v };
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  toArray(): MetricPoint[] {
    if (this.count === 0) return [];
    const start = (this.head - this.count + this.cap) % this.cap;
    const result = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.cap];
    }
    return result;
  }
}

const LiveMetrics: React.FC<LiveMetricsProps> = React.memo(({ systemStats, hardwareInfo, extendedStats }) => {
  const [openPanel, setOpenPanel] = useState<'health' | 'advisor' | 'anticheat' | null>(null);

  // Ring buffers — stable refs, never cause re-renders on their own
  const bufsRef = useRef({
    cpu: new RingBuffer(MAX_HISTORY),
    gpu: new RingBuffer(MAX_HISTORY),
    ram: new RingBuffer(MAX_HISTORY),
    net: new RingBuffer(MAX_HISTORY),
    loss: new RingBuffer(MAX_HISTORY),
    disk: new RingBuffer(MAX_HISTORY),
    proc: new RingBuffer(MAX_HISTORY),
  });
  // Counter to trigger re-render when new data is pushed
  const [tick, setTick] = useState(0);
  const lastWriteRef = useRef(0);

  // Wait for BOTH the realtime stats AND the deep hardware probe to finish 
  // before dropping the skeleton loader.
  const hasData = (systemStats?.ram > 0 || systemStats?.cpu > 0) && !!hardwareInfo;

  useEffect(() => {
    // Only accumulate history once we have real data
    if (!hasData) return;

    const now = Date.now();
    if (now - lastWriteRef.current < 750) return;
    lastWriteRef.current = now;

    const b = bufsRef.current;
    b.cpu.push(systemStats?.cpu ?? 0);
    b.gpu.push(Math.max(extendedStats?.gpuUsage ?? 0, 0));
    b.ram.push(systemStats?.ram ?? 0);
    b.net.push(Math.round(Math.max(extendedStats?.latencyMs ?? 0, 0)));
    b.loss.push(Math.round(Math.max(extendedStats?.packetLoss ?? 0, 0)));
    b.disk.push(systemStats?.disk ?? 0);
    b.proc.push(Math.min(extendedStats?.processCount ?? 0, 500));

    // Single tick bump → one re-render, arrays produced lazily below
    setTick(t => t + 1);
  }, [systemStats, extendedStats, hasData]);

  // Convert ring buffers to arrays only when tick changes (= on render)
  const b = bufsRef.current;
  const cpuHistory = useMemo(() => b.cpu.toArray(), [tick]);
  const gpuHistory = useMemo(() => b.gpu.toArray(), [tick]);
  const ramHistory = useMemo(() => b.ram.toArray(), [tick]);
  const netHistory = useMemo(() => b.net.toArray(), [tick]);
  const lossHistory = useMemo(() => b.loss.toArray(), [tick]);
  const diskHistory = useMemo(() => b.disk.toArray(), [tick]);
  const processHistory = useMemo(() => b.proc.toArray(), [tick]);

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
            <AntiCheatChecker
              compact
              isExpanded={openPanel === 'anticheat'}
              onToggle={() => setOpenPanel(p => p === 'anticheat' ? null : 'anticheat')}
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

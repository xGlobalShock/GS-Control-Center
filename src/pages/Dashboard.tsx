import React, { useState } from 'react';
import SystemDetails from '../components/SystemDetails';
import HealthScore from '../components/HealthScore';
import AdvisorPanel from '../components/AdvisorPanel';
import type { HardwareInfo, ExtendedStats } from '../App';
import '../styles/Dashboard.css';

interface DashboardProps {
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

const Dashboard: React.FC<DashboardProps> = React.memo(({ systemStats, hardwareInfo, extendedStats }) => {
  const [openPanel, setOpenPanel] = useState<'health' | 'advisor' | null>(null);

  return (
    <div className="dashboard-page">
      <SystemDetails
        systemStats={systemStats}
        hardwareInfo={hardwareInfo}
        extendedStats={extendedStats}
        headerActions={
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
    </div>
  );
});

Dashboard.displayName = 'Dashboard';
export default Dashboard;

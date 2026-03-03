import React from 'react';
import SystemDetails from '../components/SystemDetails';
import type { HardwareInfo, ExtendedStats } from '../App';
import '../styles/Dashboard.css';

interface DashboardProps {
  systemStats: {
    cpu: number;
    ram: number;
    disk: number;
    temperature: number;
  };
  hardwareInfo?: HardwareInfo;
  extendedStats?: ExtendedStats;
  statsLoaded?: boolean;
}

import { Home } from 'lucide-react';
import PageHeader from '../components/PageHeader';

const Dashboard: React.FC<DashboardProps> = React.memo(({ systemStats, hardwareInfo, extendedStats }) => {
  return (
    <div className="dashboard-page">
      <PageHeader icon={<Home size={16} />} title="System Details" />
      <SystemDetails systemStats={systemStats} hardwareInfo={hardwareInfo} extendedStats={extendedStats} hideHeader />
    </div>
  );
});

Dashboard.displayName = 'Dashboard';

export default Dashboard;

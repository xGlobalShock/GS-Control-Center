import React, { useState, useCallback } from 'react';
import AppInstaller from './AppInstaller';
import AppUninstaller from './AppUninstaller';
import '../styles/AppsPage.css';

interface AppsPageProps {
  isActive?: boolean;
}

type Tab = 'install' | 'uninstall';

const AppsPage: React.FC<AppsPageProps> = ({ isActive = false }) => {
  const [activeTab, setActiveTab] = useState<Tab>('install');
  const [installRefresh, setInstallRefresh] = useState(0);
  const [uninstallRefresh, setUninstallRefresh] = useState(0);

  const onAppInstalled = useCallback(() => setUninstallRefresh(n => n + 1), []);
  const onAppUninstalled = useCallback(() => setInstallRefresh(n => n + 1), []);

  return (
    <div className="apps-page">
      {/* Keep both mounted so state isn't reset on tab switch */}
      <div className={`apps-tab-content${activeTab === 'install' ? ' apps-tab-content--visible' : ''}`}>
        <AppInstaller isActive={isActive && activeTab === 'install'} activeTab={activeTab} onTabChange={setActiveTab} refreshSignal={installRefresh} onAppInstalled={onAppInstalled} />
      </div>
      <div className={`apps-tab-content${activeTab === 'uninstall' ? ' apps-tab-content--visible' : ''}`}>
        <AppUninstaller isActive={isActive && activeTab === 'uninstall'} activeTab={activeTab} onTabChange={setActiveTab} refreshSignal={uninstallRefresh} onAppUninstalled={onAppUninstalled} />
      </div>
    </div>
  );
};

export default AppsPage;

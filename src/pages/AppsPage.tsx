import React, { useState } from 'react';
import AppInstaller from './AppInstaller';
import AppUninstaller from './AppUninstaller';
import '../styles/AppsPage.css';

interface AppsPageProps {
  isActive?: boolean;
}

type Tab = 'install' | 'uninstall';

const AppsPage: React.FC<AppsPageProps> = ({ isActive = false }) => {
  const [activeTab, setActiveTab] = useState<Tab>('install');

  return (
    <div className="apps-page">
      {/* Keep both mounted so state isn't reset on tab switch */}
      <div className={`apps-tab-content${activeTab === 'install' ? ' apps-tab-content--visible' : ''}`}>
        <AppInstaller isActive={isActive && activeTab === 'install'} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
      <div className={`apps-tab-content${activeTab === 'uninstall' ? ' apps-tab-content--visible' : ''}`}>
        <AppUninstaller isActive={isActive && activeTab === 'uninstall'} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </div>
  );
};

export default AppsPage;

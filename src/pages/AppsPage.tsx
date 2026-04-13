import React, { useState, useCallback } from 'react';
import {
  Download,
  Trash2,
  PackageX,
  Zap,
  RefreshCw,
  LayoutGrid,
  Crown,
  PieChart,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ProPreviewBanner from '../components/ProPreviewBanner';
import ProLineBadge from '../components/ProLineBadge';
import AppInstaller from './AppInstaller';
import AppUninstaller from './AppUninstaller';
import WindowsDebloat from './WindowsDebloat';
import Startup from './Startup';
import SpaceAnalyzer from './SpaceAnalyzer';
import { useAuth } from '../contexts/AuthContext';
import '../styles/AppsPage.css';

interface AppsPageProps {
  isActive?: boolean;
}

type Tab = 'install' | 'uninstall' | 'debloat' | 'startup' | 'disk';

const NAV_ITEMS: { id: Tab; label: string; desc: string; icon: React.ReactNode; accent: string; premium?: true }[] = [
  { id: 'install',   label: 'Install Apps',    desc: 'Deploy software',     icon: <Download size={16} />,  accent: '#34d399' },
  { id: 'uninstall', label: 'Uninstall Apps',  desc: 'Remove & clean up',   icon: <Trash2 size={16} />,    accent: '#f87171' },
  { id: 'debloat',   label: 'Windows Debloat', desc: 'Remove bloatware',    icon: <PackageX size={16} />,  accent: '#38bdf8', premium: true },
  { id: 'startup',   label: 'Startup Manager', desc: 'Manage boot entries', icon: <Zap size={16} />,       accent: 'rgb(var(--accent))' },
  { id: 'disk',      label: 'Disk Analyzer',   desc: 'Storage breakdown',    icon: <PieChart size={16} />,  accent: '#a78bfa', premium: true },  
];

const AppsPage: React.FC<AppsPageProps> = ({ isActive = false }) => {
  const { isPro } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('install');
  const [installRefresh,   setInstallRefresh]   = useState(0);
  const [uninstallRefresh, setUninstallRefresh] = useState(0);
  const [debloatRefresh,   setDebloatRefresh]   = useState(0);
  const [startupRefresh,   setStartupRefresh]   = useState(0);

  // Cross-tab signals: installing an app refreshes uninstaller list and vice versa
  const onAppInstalled  = useCallback(() => setUninstallRefresh(n => n + 1), []);
  const onAppUninstalled = useCallback(() => setInstallRefresh(n => n + 1), []);

  const handleRefresh = useCallback(() => {
    if      (activeTab === 'install')   setInstallRefresh(n => n + 1);
    else if (activeTab === 'uninstall') setUninstallRefresh(n => n + 1);
    else if (activeTab === 'debloat')   setDebloatRefresh(n => n + 1);
    else if (activeTab === 'startup')   setStartupRefresh(n => n + 1);
  }, [activeTab]);

  return (
    <div className="apps-page">
      <PageHeader
        icon={<LayoutGrid size={16} />}
        title="Apps Manager"
        lineContent={(activeTab === 'debloat' || activeTab === 'disk') ? <ProLineBadge pageName={activeTab === 'debloat' ? 'Windows Debloat' : 'Disk Analyzer'} /> : undefined}
        actions={
          <button className="apps-page-header-btn" onClick={handleRefresh}>
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      />

      <div className="apps-split">
        {/* ── Left: vertical nav ── */}
        <nav className="apps-sidenav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`apps-navitem${activeTab === item.id ? ' apps-navitem--active' : ''}`}
              style={{ '--nav-accent': item.accent } as React.CSSProperties}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="apps-navitem-icon">{item.icon}</span>
              <span className="apps-navitem-body">
                <span className="apps-navitem-label">{item.label}</span>
                <span className="apps-navitem-desc">{item.desc}</span>
              </span>
              {item.premium && !isPro && (
                <span className="apps-navitem-right">
                  <Crown size={12} className="nav-pro-crown" />
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* ── Right: content (all mounted, visibility toggled) ── */}
        <div className="apps-content">
          <div className={`apps-tab-content${activeTab === 'install' ? ' apps-tab-content--visible' : ''}`}>
            <AppInstaller
              isActive={isActive && activeTab === 'install'}
              refreshSignal={installRefresh}
              onAppInstalled={onAppInstalled}
            />
          </div>
          <div className={`apps-tab-content${activeTab === 'uninstall' ? ' apps-tab-content--visible' : ''}`}>
            <AppUninstaller
              isActive={isActive && activeTab === 'uninstall'}
              refreshSignal={uninstallRefresh}
              onAppUninstalled={onAppUninstalled}
            />
          </div>
          <div className={`apps-tab-content${activeTab === 'debloat' ? ' apps-tab-content--visible' : ''}`}>
            <WindowsDebloat
              isActive={isActive && activeTab === 'debloat'}
              refreshSignal={debloatRefresh}
            />
          </div>
          <div className={`apps-tab-content${activeTab === 'startup' ? ' apps-tab-content--visible' : ''}`}>
            <Startup refreshSignal={startupRefresh} />
          </div>
          <div className={`apps-tab-content${activeTab === 'disk' ? ' apps-tab-content--visible' : ''}`}>
            <SpaceAnalyzer isActive={isActive && activeTab === 'disk'} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppsPage;


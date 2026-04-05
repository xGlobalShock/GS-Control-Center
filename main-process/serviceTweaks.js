const { ipcMain } = require('electron');
const { runPSScript } = require('./utils');
const windowManager = require('./windowManager');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let _isElevated = false;

function init({ isElevated }) {
  _isElevated = isElevated;
}

// Risk levels drive mode filtering
const RISK = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };

// Category labels for UI grouping
const CAT = {
  XBOX:       'Xbox & Gaming',
  TELEMETRY:  'Telemetry & Data Collection',
  REMOTE:     'Remote Access',
  MEDIA:      'Media & Printing',
  HYPERV:     'Hyper-V / Virtualisation',
  NETWORK:    'Networking',
  SECURITY:   'Security & Auth',
  SYSTEM:     'System Core',
  HARDWARE:   'Hardware & Sensors',
  MISC:       'Miscellaneous',
  EDGE:       'Microsoft Edge',
  ENTERPRISE: 'Enterprise',
};

const SERVICE_DEFINITIONS = [
  // ── Xbox & Gaming ────────────────────────────────────────────────────────
  { name: 'XblAuthManager',   target: 'Manual',   risk: RISK.LOW,    category: CAT.XBOX,       description: 'Xbox Live Auth Manager' },
  { name: 'XblGameSave',      target: 'Manual',   risk: RISK.LOW,    category: CAT.XBOX,       description: 'Xbox Live Game Save' },
  { name: 'XboxGipSvc',       target: 'Manual',   risk: RISK.LOW,    category: CAT.XBOX,       description: 'Xbox Accessory Management' },
  { name: 'XboxNetApiSvc',    target: 'Manual',   risk: RISK.LOW,    category: CAT.XBOX,       description: 'Xbox Live Networking' },

  // ── Telemetry & Data Collection ──────────────────────────────────────────
  { name: 'dmwappushservice',  target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'WAP Push Message Routing (telemetry)' },
  { name: 'diagsvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Diagnostic Execution Service' },
  { name: 'WerSvc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Windows Error Reporting' },
  { name: 'wercplsupport',    target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Error Reporting Control Panel' },
  { name: 'WdiServiceHost',   target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Diagnostic Service Host' },
  { name: 'WdiSystemHost',    target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Diagnostic System Host' },
  { name: 'DPS',              target: 'Automatic', risk: RISK.MEDIUM, category: CAT.TELEMETRY,  description: 'Diagnostic Policy Service' },
  { name: 'TroubleshootingSvc', target: 'Manual', risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Troubleshooting Service' },
  { name: 'pla',              target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Performance Logs & Alerts' },
  { name: 'PerfHost',         target: 'Manual',   risk: RISK.LOW,    category: CAT.TELEMETRY,  description: 'Performance Counter DLL Host' },
  { name: 'DialogBlockingService', target: 'Disabled', risk: RISK.LOW, category: CAT.TELEMETRY, description: 'Dialog Blocking Service' },

  // ── Remote Access ────────────────────────────────────────────────────────
  { name: 'RemoteAccess',     target: 'Disabled', risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Routing and Remote Access' },
  { name: 'RemoteRegistry',   target: 'Disabled', risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Remote Registry' },
  { name: 'WinRM',            target: 'Manual',   risk: RISK.MEDIUM, category: CAT.REMOTE,     description: 'Windows Remote Management' },
  { name: 'UmRdpService',     target: 'Manual',   risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Remote Desktop UserMode Port Redirector' },
  { name: 'SessionEnv',       target: 'Manual',   risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Remote Desktop Configuration' },
  { name: 'RasAuto',          target: 'Manual',   risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Remote Access Auto Connection' },
  { name: 'RasMan',           target: 'Manual',   risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Remote Access Connection Manager' },
  { name: 'Wecsvc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.REMOTE,     description: 'Windows Event Collector' },

  // ── Media & Printing ─────────────────────────────────────────────────────
  { name: 'Spooler',          target: 'Automatic', risk: RISK.MEDIUM, category: CAT.MEDIA,     description: 'Print Spooler' },
  { name: 'PrintNotify',      target: 'Manual',   risk: RISK.LOW,    category: CAT.MEDIA,      description: 'Printer Extensions & Notifications' },
  { name: 'WMPNetworkSvc',    target: 'Manual',   risk: RISK.LOW,    category: CAT.MEDIA,      description: 'Windows Media Player Network Sharing' },
  { name: 'FrameServer',      target: 'Manual',   risk: RISK.LOW,    category: CAT.MEDIA,      description: 'Windows Camera Frame Server' },
  { name: 'FrameServerMonitor', target: 'Manual', risk: RISK.LOW,    category: CAT.MEDIA,      description: 'Camera Frame Server Monitor' },
  { name: 'StiSvc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.MEDIA,      description: 'Windows Image Acquisition (scanner)' },
  { name: 'WiaRpc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.MEDIA,      description: 'Still Image RPC' },

  // ── Hyper-V / Virtualisation ─────────────────────────────────────────────
  { name: 'HvHost',           target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'HV Host Service' },
  { name: 'vmicguestinterface', target: 'Manual', risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Guest Service Interface' },
  { name: 'vmicheartbeat',    target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Heartbeat' },
  { name: 'vmickvpexchange',  target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Data Exchange' },
  { name: 'vmicrdv',          target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Remote Desktop Virtualisation' },
  { name: 'vmicshutdown',     target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Guest Shutdown' },
  { name: 'vmictimesync',     target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Time Synchronisation' },
  { name: 'vmicvmsession',    target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V PowerShell Direct' },
  { name: 'vmicvss',          target: 'Manual',   risk: RISK.LOW,    category: CAT.HYPERV,     description: 'Hyper-V Volume Shadow Copy Requestor' },
  { name: 'perceptionsimulation', target: 'Manual', risk: RISK.LOW,  category: CAT.HYPERV,     description: 'Windows Perception Simulation' },

  // ── Networking ───────────────────────────────────────────────────────────
  { name: 'Dhcp',             target: 'Automatic', risk: RISK.HIGH,  category: CAT.NETWORK,    description: 'DHCP Client (IP assignment)' },
  { name: 'NlaSvc',           target: 'Manual',   risk: RISK.MEDIUM, category: CAT.NETWORK,    description: 'Network Location Awareness' },
  { name: 'netprofm',         target: 'Manual',   risk: RISK.MEDIUM, category: CAT.NETWORK,    description: 'Network List Service' },
  { name: 'Wcmsvc',           target: 'Automatic', risk: RISK.HIGH,  category: CAT.NETWORK,    description: 'Windows Connection Manager' },
  { name: 'nsi',              target: 'Automatic', risk: RISK.HIGH,  category: CAT.NETWORK,    description: 'Network Store Interface' },
  { name: 'iphlpsvc',         target: 'Automatic', risk: RISK.HIGH,  category: CAT.NETWORK,    description: 'IP Helper' },
  { name: 'LanmanServer',     target: 'Automatic', risk: RISK.MEDIUM, category: CAT.NETWORK,   description: 'Server (SMB file sharing)' },
  { name: 'LanmanWorkstation', target: 'Automatic', risk: RISK.MEDIUM, category: CAT.NETWORK,  description: 'Workstation (SMB client)' },
  { name: 'Netman',           target: 'Manual',   risk: RISK.MEDIUM, category: CAT.NETWORK,    description: 'Network Connections' },
  { name: 'NcbService',       target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Network Connection Broker' },
  { name: 'NcdAutoSetup',     target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Network Connected Devices Auto-Setup' },
  { name: 'NetSetupSvc',      target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Network Setup Service' },
  { name: 'NetTcpPortSharing', target: 'Disabled', risk: RISK.LOW,   category: CAT.NETWORK,    description: 'Net.Tcp Port Sharing' },
  { name: 'NcaSvc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Network Connectivity Assistant' },
  { name: 'lmhosts',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'TCP/IP NetBIOS Helper' },
  { name: 'lltdsvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Link-Layer Topology Discovery Mapper' },
  { name: 'FDResPub',         target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Function Discovery Resource Publication' },
  { name: 'fdPHost',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Function Discovery Provider Host' },
  { name: 'SSDPSRV',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'SSDP Discovery (UPnP)' },
  { name: 'upnphost',         target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'UPnP Device Host' },
  { name: 'PeerDistSvc',      target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'BranchCache' },
  { name: 'dot3svc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Wired AutoConfig (802.1X)' },
  { name: 'QWAVE',            target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Quality Windows Audio Video Experience' },
  { name: 'wcncsvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Windows Connect Now' },
  { name: 'icssvc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Windows Mobile Hotspot' },
  { name: 'SharedAccess',     target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Internet Connection Sharing' },
  { name: 'PolicyAgent',      target: 'Manual',   risk: RISK.MEDIUM, category: CAT.NETWORK,    description: 'IPsec Policy Agent' },
  { name: 'SstpSvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.NETWORK,    description: 'Secure Socket Tunneling Protocol' },

  // ── Security & Auth ──────────────────────────────────────────────────────
  { name: 'CryptSvc',         target: 'Automatic', risk: RISK.HIGH,  category: CAT.SECURITY,   description: 'Cryptographic Services' },
  { name: 'EFS',              target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SECURITY,   description: 'Encrypting File System (EFS)' },
  { name: 'EapHost',          target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SECURITY,   description: 'Extensible Authentication Protocol' },
  { name: 'seclogon',         target: 'Manual',   risk: RISK.LOW,    category: CAT.SECURITY,   description: 'Secondary Logon' },
  { name: 'SCPolicySvc',      target: 'Manual',   risk: RISK.LOW,    category: CAT.SECURITY,   description: 'Smart Card Removal Policy' },
  { name: 'SCardSvr',         target: 'Manual',   risk: RISK.LOW,    category: CAT.SECURITY,   description: 'Smart Card' },
  { name: 'CertPropSvc',      target: 'Manual',   risk: RISK.LOW,    category: CAT.SECURITY,   description: 'Certificate Propagation' },
  { name: 'NaturalAuthentication', target: 'Manual', risk: RISK.LOW, category: CAT.SECURITY,   description: 'Natural Authentication' },
  { name: 'WbioSrvc',         target: 'Manual',   risk: RISK.LOW,    category: CAT.SECURITY,   description: 'Windows Biometric Service' },
  { name: 'webthreatdefsvc',  target: 'Manual',   risk: RISK.LOW,    category: CAT.SECURITY,   description: 'Web Threat Defense Service' },

  // ── System Core ──────────────────────────────────────────────────────────
  { name: 'EventLog',         target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Windows Event Log' },
  { name: 'EventSystem',      target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'COM+ Event System' },
  { name: 'Power',            target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Power Service' },
  { name: 'ProfSvc',          target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'User Profile Service' },
  { name: 'SamSs',            target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Security Accounts Manager' },
  { name: 'SENS',             target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'System Event Notification' },
  { name: 'UserManager',      target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'User Manager' },
  { name: 'Winmgmt',          target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Windows Management Instrumentation' },
  { name: 'Themes',           target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Themes' },
  { name: 'ShellHWDetection', target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Shell Hardware Detection' },
  { name: 'FontCache',        target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Windows Font Cache' },
  { name: 'DispBrokerDesktopSvc', target: 'Automatic', risk: RISK.HIGH, category: CAT.SYSTEM,  description: 'Display Policy Service' },
  { name: 'AudioEndpointBuilder', target: 'Automatic', risk: RISK.HIGH, category: CAT.SYSTEM,  description: 'Windows Audio Endpoint Builder' },
  { name: 'AudioSrv',         target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Windows Audio' },
  { name: 'Audiosrv',         target: 'Automatic', risk: RISK.HIGH,  category: CAT.SYSTEM,     description: 'Windows Audio (alt)' },
  { name: 'SysMain',          target: 'Automatic', risk: RISK.MEDIUM, category: CAT.SYSTEM,    description: 'SysMain (Superfetch)' },
  { name: 'TrkWks',           target: 'Automatic', risk: RISK.MEDIUM, category: CAT.SYSTEM,    description: 'Distributed Link Tracking Client' },
  { name: 'BITS',             target: 'AutomaticDelayedStart', risk: RISK.MEDIUM, category: CAT.SYSTEM, description: 'Background Intelligent Transfer' },
  { name: 'wuauserv',         target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SYSTEM,     description: 'Windows Update' },
  { name: 'WSearch',          target: 'AutomaticDelayedStart', risk: RISK.MEDIUM, category: CAT.SYSTEM, description: 'Windows Search' },
  { name: 'MapsBroker',       target: 'AutomaticDelayedStart', risk: RISK.LOW, category: CAT.SYSTEM, description: 'Downloaded Maps Manager' },
  { name: 'TrustedInstaller', target: 'Manual',   risk: RISK.HIGH,   category: CAT.SYSTEM,     description: 'Windows Modules Installer' },
  { name: 'Appinfo',          target: 'Manual',   risk: RISK.HIGH,   category: CAT.SYSTEM,     description: 'Application Information (UAC)' },
  { name: 'PlugPlay',         target: 'Manual',   risk: RISK.HIGH,   category: CAT.SYSTEM,     description: 'Plug and Play' },
  { name: 'VSS',              target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SYSTEM,     description: 'Volume Shadow Copy' },
  { name: 'SDRSVC',           target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SYSTEM,     description: 'Windows Backup' },
  { name: 'defragsvc',        target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Optimize drives (defrag/TRIM)' },
  { name: 'swprv',            target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Microsoft Software Shadow Copy Provider' },
  { name: 'wbengine',         target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Block Level Backup Engine' },
  { name: 'vds',              target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Virtual Disk' },
  { name: 'InstallService',   target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Microsoft Store Install Service' },
  { name: 'LicenseManager',   target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Windows License Manager' },
  { name: 'TokenBroker',      target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Web Account Manager' },
  { name: 'PushToInstall',    target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Push To Install Service' },
  { name: 'WalletService',    target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Wallet Service' },
  { name: 'W32Time',          target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SYSTEM,     description: 'Windows Time' },
  { name: 'RmSvc',            target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Radio Management Service' },
  { name: 'autotimesvc',      target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Cellular Time' },
  { name: 'DeviceInstall',    target: 'Manual',   risk: RISK.MEDIUM, category: CAT.SYSTEM,     description: 'Device Install Service' },
  { name: 'DevQueryBroker',   target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'DevQuery Background Discovery Broker' },
  { name: 'DeviceAssociationService', target: 'Manual', risk: RISK.LOW, category: CAT.SYSTEM,  description: 'Device Association Service' },
  { name: 'DisplayEnhancementService', target: 'Manual', risk: RISK.LOW, category: CAT.SYSTEM, description: 'Display Enhancement Service' },
  { name: 'GraphicsPerfSvc',  target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Graphics Performance Monitor' },
  { name: 'KtmRm',            target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'KtmRm for Distributed Transaction Coordinator' },
  { name: 'MSDTC',            target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Distributed Transaction Coordinator' },
  { name: 'COMSysApp',        target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'COM+ System Application' },
  { name: 'RpcLocator',       target: 'Manual',   risk: RISK.LOW,    category: CAT.SYSTEM,     description: 'Remote Procedure Call Locator' },

  // ── Hardware & Sensors ───────────────────────────────────────────────────
  { name: 'SensorDataService', target: 'Manual',  risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Sensor Data Service' },
  { name: 'SensorService',    target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Sensor Service' },
  { name: 'SensrSvc',         target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Sensor Monitoring Service' },
  { name: 'hidserv',          target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Human Interface Device Service' },
  { name: 'bthserv',          target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Bluetooth Support Service' },
  { name: 'BTAGService',      target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Bluetooth Audio Gateway' },
  { name: 'WPDBusEnum',       target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Portable Device Enumerator' },
  { name: 'ScDeviceEnum',     target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Smart Card Device Enumeration' },
  { name: 'PhoneSvc',         target: 'Manual',   risk: RISK.LOW,    category: CAT.HARDWARE,   description: 'Phone Service' },

  // ── Microsoft Edge ───────────────────────────────────────────────────────
  { name: 'MicrosoftEdgeElevationService', target: 'Manual', risk: RISK.LOW, category: CAT.EDGE, description: 'Edge Elevation Service' },
  { name: 'edgeupdate',       target: 'Manual',   risk: RISK.LOW,    category: CAT.EDGE,       description: 'Microsoft Edge Update' },
  { name: 'edgeupdatem',      target: 'Manual',   risk: RISK.LOW,    category: CAT.EDGE,       description: 'Microsoft Edge Update (Machine)' },

  // ── Enterprise ───────────────────────────────────────────────────────────
  { name: 'AppVClient',       target: 'Disabled', risk: RISK.LOW,    category: CAT.ENTERPRISE, description: 'App-V Client' },
  { name: 'UevAgentService',  target: 'Disabled', risk: RISK.LOW,    category: CAT.ENTERPRISE, description: 'User Experience Virtualisation' },
  { name: 'shpamsvc',         target: 'Disabled', risk: RISK.LOW,    category: CAT.ENTERPRISE, description: 'Shared PC Account Manager' },
  { name: 'tzautoupdate',     target: 'Disabled', risk: RISK.LOW,    category: CAT.ENTERPRISE, description: 'Auto Time Zone Updater' },
  { name: 'ssh-agent',        target: 'Disabled', risk: RISK.LOW,    category: CAT.ENTERPRISE, description: 'OpenSSH Authentication Agent' },

  // ── Miscellaneous ────────────────────────────────────────────────────────
  { name: 'ALG',              target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Application Layer Gateway' },
  { name: 'AppMgmt',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Application Management' },
  { name: 'AppReadiness',     target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'App Readiness' },
  { name: 'AxInstSV',         target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'ActiveX Installer' },
  { name: 'BDESVC',           target: 'Manual',   risk: RISK.MEDIUM, category: CAT.MISC,       description: 'BitLocker Drive Encryption' },
  { name: 'CscService',       target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Offline Files' },
  { name: 'IpxlatCfgSvc',     target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'IP Translation Configuration' },
  { name: 'LxpSvc',           target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Language Experience Service' },
  { name: 'MSiSCSI',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'iSCSI Initiator' },
  { name: 'McpManagementService', target: 'Manual', risk: RISK.LOW,  category: CAT.MISC,       description: 'MCP Management Service' },
  { name: 'RetailDemo',       target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Retail Demo Service' },
  { name: 'SEMgrSvc',         target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Payments and NFC/SE Manager' },
  { name: 'SNMPTRAP',         target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'SNMP Trap' },
  { name: 'SNMPTrap',         target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'SNMP Trap (alt)' },
  { name: 'SmsRouter',        target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Microsoft Windows SMS Router' },
  { name: 'TapiSrv',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Telephony' },
  { name: 'TieringEngineService', target: 'Manual', risk: RISK.LOW,  category: CAT.MISC,       description: 'Storage Tiers Management' },
  { name: 'WEPHOSTSVC',       target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Windows Encryption Provider Host' },
  { name: 'WFDSConMgrSvc',    target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Wi-Fi Direct Services Connection Manager' },
  { name: 'WManSvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Windows Management Service' },
  { name: 'WarpJITSvc',       target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Warp JIT Service' },
  { name: 'WebClient',        target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'WebClient (WebDAV)' },
  { name: 'WpcMonSvc',        target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Parental Controls' },
  { name: 'cloudidsvc',       target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Microsoft Cloud Identity Service' },
  { name: 'dcsvc',            target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Declared Configuration Service' },
  { name: 'fhsvc',            target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'File History Service' },
  { name: 'lfsvc',            target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Geolocation Service' },
  { name: 'smphost',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Microsoft Storage Spaces SMP' },
  { name: 'svsvc',            target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Spot Verifier' },
  { name: 'wisvc',            target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Windows Insider Service' },
  { name: 'wlidsvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Microsoft Account Sign-in Assistant' },
  { name: 'wlpasvc',          target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Local Profile Assistant' },
  { name: 'wmiApSrv',         target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'WMI Performance Adapter' },
  { name: 'workfolderssvc',   target: 'Manual',   risk: RISK.LOW,    category: CAT.MISC,       description: 'Work Folders' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   2. CRITICAL (NEVER-TOUCH) SERVICE LIST
   ═══════════════════════════════════════════════════════════════════════════ */

const CRITICAL_NEVER_TOUCH = new Set([
  'RpcSs',                    // Remote Procedure Call — OS won't function
  'RpcEptMapper',             // RPC Endpoint Mapper
  'DcomLaunch',               // DCOM Server Process Launcher
  'LSM',                      // Local Session Manager
  'lsass',                    // credential guard — NEVER touch
  'wininit',                  // Windows init
  'csrss',                    // Client/Server Runtime Subsystem
  'smss',                     // Session Manager Subsystem
  'services',                 // Service Control Manager
  'svchost',                  // Generic host
  'BrokerInfrastructure',     // Background Tasks Infrastructure
  'Schedule',                 // Task Scheduler
  'WlanSvc',                  // Wi-Fi — would break wireless
  'mpssvc',                   // Windows Defender Firewall
  'WinDefend',                // Windows Defender
  'SecurityHealthService',    // Windows Security
  'BFE',                      // Base Filtering Engine (firewall)
  'Dnscache',                 // DNS Client — would break name resolution
  'CoreMessagingRegistrar',
  'SystemEventsBroker',
  'TimeBrokerSvc',
]);

/* ═══════════════════════════════════════════════════════════════════════════
   3. MODE FILTERS
   ═══════════════════════════════════════════════════════════════════════════ */

function getServicesForMode(mode) {
  switch (mode) {
    case 'safe':
      // Only low-risk services whose target differs from Windows default (Automatic)
      return SERVICE_DEFINITIONS.filter(s => s.risk === RISK.LOW);
    case 'balanced':
      // Low + medium risk
      return SERVICE_DEFINITIONS.filter(s => s.risk === RISK.LOW || s.risk === RISK.MEDIUM);
    case 'aggressive':
      // Everything — full Chris Titus
      return SERVICE_DEFINITIONS;
    default:
      return SERVICE_DEFINITIONS.filter(s => s.risk === RISK.LOW);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. BACKUP / RESTORE
   ═══════════════════════════════════════════════════════════════════════════ */

function _getBackupDir() {
  return path.join(app.getPath('userData'), 'service-backups');
}

function _getBackupFile() {
  return path.join(_getBackupDir(), 'service-backup.json');
}

async function _backupCurrentStates(serviceNames) {
  // Query current startup type for each service via PowerShell
  const namesJSON = JSON.stringify(serviceNames);
  const script = `
$names = '${namesJSON.replace(/'/g, "''")}' | ConvertFrom-Json
$result = @()
foreach ($n in $names) {
  try {
    $svc = Get-Service -Name $n -ErrorAction SilentlyContinue
    if ($svc) {
      $startType = (Get-WmiObject Win32_Service -Filter "Name='$n'" -ErrorAction SilentlyContinue).StartMode
      $result += [PSCustomObject]@{
        Name = $n
        Status = $svc.Status.ToString()
        StartType = $startType
      }
    }
  } catch {}
}
$result | ConvertTo-Json -Compress
`;

  const raw = await runPSScript(script, 30000);
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
    // PowerShell returns single object (not array) if only 1 result
    if (!Array.isArray(parsed)) parsed = [parsed];
  } catch {
    return [];
  }

  // Save backup
  const backupDir = _getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const backup = {
    timestamp: new Date().toISOString(),
    services: parsed,
  };

  fs.writeFileSync(_getBackupFile(), JSON.stringify(backup, null, 2), 'utf8');
  return parsed;
}

async function _restoreFromBackup() {
  const backupFile = _getBackupFile();
  if (!fs.existsSync(backupFile)) {
    return { success: false, message: 'No backup found. Cannot restore.' };
  }

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  } catch {
    return { success: false, message: 'Backup file is corrupted.' };
  }

  if (!backup.services || !Array.isArray(backup.services) || backup.services.length === 0) {
    return { success: false, message: 'Backup contains no service data.' };
  }

  // Map WMI StartMode names to Set-Service StartupType names
  const modeMap = { Auto: 'Automatic', Manual: 'Manual', Disabled: 'Disabled' };

  const cmds = backup.services.map(s => {
    const mapped = modeMap[s.StartType] || s.StartType || 'Manual';
    const safeName = s.Name.replace(/'/g, "''");
    return `try { Set-Service -Name '${safeName}' -StartupType '${mapped}' -ErrorAction SilentlyContinue } catch {}`;
  }).join('\n');

  try {
    await runPSScript(cmds, 60000);
    return {
      success: true,
      message: `Restored ${backup.services.length} services to their original state (backup from ${backup.timestamp}).`,
      count: backup.services.length,
    };
  } catch (err) {
    return { success: false, message: `Restore failed: ${err.message}` };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. SCAN  — Query current state of all services in our list
   ═══════════════════════════════════════════════════════════════════════════ */

async function _scanServices() {
  const allNames = SERVICE_DEFINITIONS.map(s => s.name);
  const namesJSON = JSON.stringify(allNames);

  const script = `
$names = '${namesJSON.replace(/'/g, "''")}' | ConvertFrom-Json
$result = @{}
foreach ($n in $names) {
  try {
    $svc = Get-Service -Name $n -ErrorAction SilentlyContinue
    if ($svc) {
      $startMode = (Get-WmiObject Win32_Service -Filter "Name='$n'" -ErrorAction SilentlyContinue).StartMode
      $result[$n] = @{
        Exists = $true
        Status = $svc.Status.ToString()
        StartType = $startMode
      }
    } else {
      $result[$n] = @{ Exists = $false; Status = $null; StartType = $null }
    }
  } catch {
    $result[$n] = @{ Exists = $false; Status = $null; StartType = $null }
  }
}
$result | ConvertTo-Json -Compress
`;

  const raw = await runPSScript(script, 45000);
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. APPLY — Set services to their target startup types
   ═══════════════════════════════════════════════════════════════════════════ */

// Map Chris Titus target names to Set-Service -StartupType values
const _targetMap = {
  Manual: 'Manual',
  Automatic: 'Automatic',
  AutomaticDelayedStart: 'Automatic',   // Set-Service supports 'Automatic' only; delayed is via registry
  Disabled: 'Disabled',
};

/* ── Send progress event to renderer ── */
function _sendProgress(data) {
  const win = windowManager.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('svc:progress', data);
  }
}

async function _applyServices(serviceList) {
  const total = serviceList.length;
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const logEntries = [];

  _sendProgress({ phase: 'start', total, current: 0, log: [] });

  for (let i = 0; i < total; i++) {
    const svc = serviceList[i];
    if (CRITICAL_NEVER_TOUCH.has(svc.name)) {
      skippedCount++;
      const entry = { name: svc.name, status: 'skipped', reason: 'Critical (protected)', prev: null, target: svc.target };
      logEntries.push(entry);
      _sendProgress({ phase: 'working', total, current: i + 1, service: svc.name, entry });
      continue;
    }

    const safeName = svc.name.replace(/'/g, "''");
    const startType = _targetMap[svc.target] || 'Manual';

    _sendProgress({ phase: 'working', total, current: i + 1, service: svc.name, entry: null });

    // Query current state + apply in one script
    const script = [
      `$result = @{ prev = $null; applied = $false; error = $null; alreadyMatch = $false }`,
      `try {`,
      `  $svc = Get-Service -Name '${safeName}' -ErrorAction Stop`,
      `  $wmi = Get-WmiObject Win32_Service -Filter "Name='${safeName}'" -ErrorAction SilentlyContinue`,
      `  $result.prev = if($wmi) { $wmi.StartMode } else { 'Unknown' }`,
      // Check if already at target
      `  $current = $result.prev`,
      `  $target = '${svc.target}'`,
      `  $match = ($current -eq '${startType}')`,
      `  if ($target -eq 'AutomaticDelayedStart') { $match = ($current -eq 'Auto') }`,
      `  if ($match) { $result.alreadyMatch = $true }`,
      `  else {`,
      `    Set-Service -Name '${safeName}' -StartupType '${startType}' -ErrorAction Stop`,
      ...(svc.target === 'AutomaticDelayedStart' ? [
        `    Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${safeName}" -Name 'DelayedAutoStart' -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue`,
      ] : []),
      `    $result.applied = $true`,
      `  }`,
      `} catch {`,
      `  $result.error = $_.Exception.Message`,
      `}`,
      `$result | ConvertTo-Json -Compress`,
    ].join('\n');

    let entry;
    try {
      const raw = await runPSScript(script, 15000);
      const parsed = raw ? JSON.parse(raw) : {};

      if (parsed.error) {
        failedCount++;
        entry = { name: svc.name, status: 'failed', reason: parsed.error, prev: parsed.prev, target: svc.target };
      } else if (parsed.alreadyMatch) {
        skippedCount++;
        entry = { name: svc.name, status: 'skipped', reason: `Already ${svc.target}`, prev: parsed.prev, target: svc.target };
      } else {
        successCount++;
        entry = { name: svc.name, status: 'success', prev: parsed.prev, target: svc.target };
      }
    } catch (err) {
      failedCount++;
      entry = { name: svc.name, status: 'failed', reason: err.message || 'Unknown error', prev: null, target: svc.target };
    }

    logEntries.push(entry);
    _sendProgress({ phase: 'working', total, current: i + 1, service: svc.name, entry });

    // Small delay for UI readability (50ms)
    await new Promise(r => setTimeout(r, 50));
  }

  const summary = { total, success: successCount, skipped: skippedCount, failed: failedCount };
  _sendProgress({ phase: 'done', total, current: total, summary, log: logEntries });

  return {
    success: true,
    message: `Processed ${total} services: ${successCount} changed, ${skippedCount} skipped, ${failedCount} failed.`,
    applied: successCount,
    summary,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. IPC REGISTRATION
   ═══════════════════════════════════════════════════════════════════════════ */

function registerIPC() {

  // ── Get service definitions (filtered by mode) ─────────────────────────
  ipcMain.handle('svc:get-definitions', (_e, mode) => {
    const list = getServicesForMode(mode || 'safe');
    return list.map(s => ({
      name: s.name,
      target: s.target,
      risk: s.risk,
      category: s.category,
      description: s.description,
    }));
  });

  // ── Get ALL definitions (for the full list view) ───────────────────────
  ipcMain.handle('svc:get-all-definitions', () => {
    return SERVICE_DEFINITIONS.map(s => ({
      name: s.name,
      target: s.target,
      risk: s.risk,
      category: s.category,
      description: s.description,
    }));
  });

  // ── Scan current service states ────────────────────────────────────────
  ipcMain.handle('svc:scan', async () => {
    try {
      const states = await _scanServices();
      return { success: true, states };
    } catch (err) {
      return { success: false, message: err.message, states: {} };
    }
  });

  // ── Apply services (mode-based) ────────────────────────────────────────
  ipcMain.handle('svc:apply', async (_e, { mode, selectedNames }) => {
    if (!_isElevated) {
      return { success: false, message: 'Administrator privileges required. Please restart GS Center as admin.' };
    }

    try {
      // Determine which services to apply
      let toApply;
      if (selectedNames && Array.isArray(selectedNames) && selectedNames.length > 0) {
        // User selected specific services
        toApply = SERVICE_DEFINITIONS.filter(s => selectedNames.includes(s.name));
      } else {
        toApply = getServicesForMode(mode || 'safe');
      }

      // Filter out critical services
      toApply = toApply.filter(s => !CRITICAL_NEVER_TOUCH.has(s.name));

      if (toApply.length === 0) {
        return { success: true, message: 'No eligible services to modify.', applied: 0 };
      }

      // 1. Attempt a Windows System Restore Point FIRST — REQUIRED, not best-effort
      let restoreOk = false;
      let restoreError = null;
      try {
        const restoreDesc = `GS Center - Before Service Optimization (${mode || 'safe'} mode)`.replace(/'/g, "''");
        await runPSScript(
          `Enable-ComputerRestore -Drive "$env:SystemDrive" -ErrorAction SilentlyContinue\n` +
          `Checkpoint-Computer -Description '${restoreDesc}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop`,
          60000
        );
        restoreOk = true;
      } catch (rpErr) {
        restoreError = rpErr && rpErr.message ? rpErr.message : String(rpErr);
        console.error('[ServiceTweaks] Restore point creation failed:', restoreError);
      }

      // Safety: abort immediately if restore point failed
      if (!restoreOk) {
        _sendProgress({ phase: 'done', total: 0, current: 0, summary: { total: 0, success: 0, skipped: 0, failed: 0 }, log: [] });
        return {
          success: false,
          message: `Safety abort: Could not create Windows System Restore point. No changes were made. Error: ${restoreError || 'Unknown'}`,
          applied: 0,
        };
      }

      // 2. Backup current service states (JSON) — REQUIRED
      const backupNames = toApply.map(s => s.name);
      let backupOk = false;
      let backupData = null;
      let backupError = null;
      try {
        backupData = await _backupCurrentStates(backupNames);
        if (backupData && Array.isArray(backupData) && backupData.length > 0) backupOk = true;
        else backupError = 'Backup returned empty or no data';
      } catch (bErr) {
        backupError = bErr && bErr.message ? bErr.message : String(bErr);
        console.error('[ServiceTweaks] Backup of current service states failed:', backupError);
      }

      // Safety: abort if backup also failed (restore point succeeded, so system is safe, but we need the JSON too)
      if (!backupOk) {
        _sendProgress({ phase: 'done', total: 0, current: 0, summary: { total: 0, success: 0, skipped: 0, failed: 0 }, log: [] });
        return {
          success: false,
          message: `Safety abort: System Restore point was created, but JSON backup of current service states failed. No changes were made. Error: ${backupError || 'Unknown'}`,
          applied: 0,
        };
      }

      // 3. Both safety checks passed — apply changes
      const result = await _applyServices(toApply);
      return result;

    } catch (err) {
      return { success: false, message: `Apply failed: ${err.message}`, applied: 0 };
    }
  });

  // ── Restore from backup ────────────────────────────────────────────────
  ipcMain.handle('svc:restore', async () => {
    if (!_isElevated) {
      return { success: false, message: 'Administrator privileges required.' };
    }
    try {
      return await _restoreFromBackup();
    } catch (err) {
      return { success: false, message: `Restore failed: ${err.message}` };
    }
  });

  // ── Check if backup exists ─────────────────────────────────────────────
  ipcMain.handle('svc:has-backup', () => {
    const backupFile = _getBackupFile();
    if (!fs.existsSync(backupFile)) return { exists: false };
    try {
      const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      return { exists: true, timestamp: backup.timestamp, count: backup.services?.length || 0 };
    } catch {
      return { exists: false };
    }
  });

  // ── Check elevation status ─────────────────────────────────────────────
  ipcMain.handle('svc:is-elevated', () => {
    return { elevated: _isElevated };
  });

} // end registerIPC

module.exports = { init, registerIPC };
// ══════════════════════════════════════════════════════════════════════════
// APP CATALOG — Curated list of apps installable via winget
// ══════════════════════════════════════════════════════════════════════════

export interface CatalogApp {
  name: string;
  id: string; // winget package ID
  category: string;
}

export const APP_CATEGORIES = [
  'Browsers',
  'Communications',
  'Gaming',
  'Gaming Tools',
  'Streaming & Audio',
  'Development',
  'Utilities',
  'Media',
] as const;

export const APP_CATALOG: CatalogApp[] = [
  // Browsers
  { name: 'Brave', id: 'Brave.Brave', category: 'Browsers' },
  { name: 'Chrome', id: 'Google.Chrome', category: 'Browsers' },
  { name: 'Edge', id: 'Microsoft.Edge', category: 'Browsers' },
  { name: 'Firefox', id: 'Mozilla.Firefox', category: 'Browsers' },
  { name: 'Opera GX', id: 'Opera.OperaGX', category: 'Browsers' },
  { name: 'Tor Browser', id: 'TorProject.TorBrowser', category: 'Browsers' },
  // Communications
  { name: 'Discord', id: 'Discord.Discord', category: 'Communications' },
  { name: 'Teams', id: 'Microsoft.Teams', category: 'Communications' },
  { name: 'Telegram', id: 'Telegram.TelegramDesktop', category: 'Communications' },
  { name: 'Zoom', id: 'Zoom.Zoom', category: 'Communications' },
  // Gaming
  { name: 'Steam', id: 'Valve.Steam', category: 'Gaming' },
  { name: 'Epic Games Launcher', id: 'EpicGames.EpicGamesLauncher', category: 'Gaming' },
  { name: 'EA App', id: 'ElectronicArts.EADesktop', category: 'Gaming' },
  { name: 'Ubisoft Connect', id: 'Ubisoft.Connect', category: 'Gaming' },
  { name: 'Battle.net', id: 'Blizzard.BattleNet', category: 'Gaming' },
  { name: 'GeForce NOW', id: 'Nvidia.GeForceNow', category: 'Gaming' },
  // Gaming Tools
  { name: 'MSI Afterburner', id: 'Guru3D.Afterburner', category: 'Gaming Tools' },
  { name: 'HWiNFO', id: 'REALiX.HWiNFO', category: 'Gaming Tools' },
  { name: 'GPU-Z', id: 'TechPowerUp.GPU-Z', category: 'Gaming Tools' },
  { name: 'CPU-Z', id: 'CPUID.CPU-Z', category: 'Gaming Tools' },
  { name: 'AMD Software', id: 'AMD.RyzenMaster', category: 'Gaming Tools' },
  // Streaming & Audio
  { name: 'OBS Studio', id: 'OBSProject.OBSStudio', category: 'Streaming & Audio' },
  { name: 'Streamlabs', id: 'Streamlabs.Streamlabs', category: 'Streaming & Audio' },
  { name: 'EarTrumpet', id: 'File-New-Project.EarTrumpet', category: 'Streaming & Audio' },
  { name: 'SteelSeries Sonar', id: 'SteelSeries.GG', category: 'Streaming & Audio' },
  { name: 'VLC', id: 'VideoLAN.VLC', category: 'Streaming & Audio' },
  // Development
  { name: 'VS Code', id: 'Microsoft.VisualStudioCode', category: 'Development' },
  { name: 'Git', id: 'Git.Git', category: 'Development' },
  { name: 'GitHub Desktop', id: 'GitHub.GitHubDesktop', category: 'Development' },
  { name: 'NodeJS LTS', id: 'OpenJS.NodeJS.LTS', category: 'Development' },
  { name: 'Python 3', id: 'Python.Python.3.12', category: 'Development' },
  { name: 'Visual Studio 2022', id: 'Microsoft.VisualStudio.2022.Community', category: 'Development' },
  { name: 'Windows Terminal', id: 'Microsoft.WindowsTerminal', category: 'Development' },
  { name: 'Notepad++', id: 'Notepad++.Notepad++', category: 'Development' },
  // Utilities
  { name: '7-Zip', id: '7zip.7zip', category: 'Utilities' },
  { name: 'WinRAR', id: 'RARLab.WinRAR', category: 'Utilities' },
  { name: 'Revo Uninstaller', id: 'RevoUninstaller.RevoUninstaller', category: 'Utilities' },
  { name: 'Bitwarden', id: 'Bitwarden.Bitwarden', category: 'Utilities' },
  // Media
  { name: 'Spotify', id: 'Spotify.Spotify', category: 'Media' },
];

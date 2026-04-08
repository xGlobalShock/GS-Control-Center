// ══════════════════════════════════════════════════════════════════════════
// APP CATALOG — Curated list of apps installable via winget
// ══════════════════════════════════════════════════════════════════════════

export interface CatalogApp {
  name: string;
  id: string; // winget package ID
  category: string;
  domain?: string; // for favicon lookup
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
  { name: 'Brave',                        id: 'Brave.Brave',                               category: 'Browsers',          domain: 'brave.com' },
  { name: 'Chrome',                       id: 'Google.Chrome',                             category: 'Browsers',          domain: 'google.com' },
  { name: 'Edge',                         id: 'Microsoft.Edge',                            category: 'Browsers',          domain: 'microsoft.com' },
  { name: 'Firefox',                      id: 'Mozilla.Firefox',                           category: 'Browsers',          domain: 'firefox.com' },
  { name: 'Opera GX',                     id: 'Opera.OperaGX',                             category: 'Browsers',          domain: 'opera.com' },
  { name: 'Tor Browser',                  id: 'TorProject.TorBrowser',                     category: 'Browsers',          domain: 'torproject.org' },
  // Communications
  { name: 'Discord',                      id: 'Discord.Discord',                           category: 'Communications',    domain: 'discord.com' },
  { name: 'Teams',                        id: 'Microsoft.Teams',                           category: 'Communications',    domain: 'microsoft.com' },
  { name: 'Telegram',                     id: 'Telegram.TelegramDesktop',                  category: 'Communications',    domain: 'telegram.org' },
  { name: 'Zoom',                         id: 'Zoom.Zoom',                                 category: 'Communications',    domain: 'zoom.us' },
  { name: 'AnyDesk',                      id: 'AnyDesk.AnyDesk',                           category: 'Communications',    domain: 'anydesk.com' },
  { name: 'TeamSpeak 3',                  id: 'TeamSpeakSystems.TeamSpeakClient',          category: 'Communications',    domain: 'teamspeak.com' },
  { name: 'TeamViewer',                   id: 'TeamViewer.TeamViewer',                     category: 'Communications',    domain: 'teamviewer.com' },
  // Gaming
  { name: 'Steam',                        id: 'Valve.Steam',                               category: 'Gaming',            domain: 'store.steampowered.com' },
  { name: 'Epic Games Launcher',          id: 'EpicGames.EpicGamesLauncher',               category: 'Gaming',            domain: 'epicgames.com' },
  { name: 'EA App',                       id: 'ElectronicArts.EADesktop',                  category: 'Gaming',            domain: 'ea.com' },
  { name: 'Ubisoft Connect',              id: 'Ubisoft.Connect',                           category: 'Gaming',            domain: 'ubisoft.com' },
  { name: 'Battle.net',                   id: 'Blizzard.BattleNet',                        category: 'Gaming',            domain: 'battle.net' },
  { name: 'GeForce NOW',                  id: 'Nvidia.GeForceNow',                         category: 'Gaming',            domain: 'nvidia.com' },
  { name: 'Parsec',                       id: 'Parsec.Parsec',                             category: 'Gaming',            domain: 'parsec.app' },
  // Gaming Tools
  { name: 'MSI Afterburner',              id: 'Guru3D.Afterburner',                        category: 'Gaming Tools',      domain: 'msi.com' },
  { name: 'HWiNFO',                       id: 'REALiX.HWiNFO',                             category: 'Gaming Tools',      domain: 'hwinfo.com' },
  { name: 'GPU-Z',                        id: 'TechPowerUp.GPU-Z',                         category: 'Gaming Tools',      domain: 'techpowerup.com' },
  { name: 'CPU-Z',                        id: 'CPUID.CPU-Z',                               category: 'Gaming Tools',      domain: 'cpuid.com' },
  { name: 'Razer Synapse',                id: 'RazerInc.RazerInstaller.Synapse3',          category: 'Gaming Tools',      domain: 'razer.com' },
  { name: 'Logitech G HUB',               id: 'Logitech.GHUB',                             category: 'Gaming Tools',      domain: 'logitechg.com' },
  { name: 'Display Driver Uninstaller',   id: 'Wagnardsoft.DisplayDriverUninstaller',      category: 'Gaming Tools',      domain: 'wagnardsoft.com' },
  // Streaming & Audio
  { name: 'OBS Studio',                   id: 'OBSProject.OBSStudio',                      category: 'Streaming & Audio', domain: 'obsproject.com' },
  { name: 'Streamlabs',                   id: 'Streamlabs.Streamlabs',                     category: 'Streaming & Audio', domain: 'streamlabs.com' },
  { name: 'EarTrumpet',                   id: 'File-New-Project.EarTrumpet',               category: 'Streaming & Audio', domain: 'eartrumpet.app' },
  { name: 'SteelSeries Sonar',            id: 'SteelSeries.GG',                            category: 'Streaming & Audio', domain: 'steelseries.com' },
  { name: 'VLC',                          id: 'VideoLAN.VLC',                              category: 'Streaming & Audio', domain: 'videolan.org' },
  { name: 'VoiceMeeter Banana',           id: 'VB-Audio.Voicemeeter.Banana',               category: 'Streaming & Audio', domain: 'vb-audio.com' },
  { name: 'Elgato Camera Hub',            id: 'Elgato.CameraHub',                          category: 'Streaming & Audio', domain: 'elgato.com' },
  { name: 'Elgato Control Center',        id: 'Elgato.ControlCenter',                      category: 'Streaming & Audio', domain: 'elgato.com' },
  // Development
  { name: 'VS Code',                      id: 'Microsoft.VisualStudioCode',                category: 'Development',       domain: 'code.visualstudio.com' },
  { name: 'Git',                          id: 'Git.Git',                                   category: 'Development',       domain: 'git-scm.com' },
  { name: 'GitHub Desktop',               id: 'GitHub.GitHubDesktop',                      category: 'Development',       domain: 'github.com' },
  { name: 'NodeJS LTS',                   id: 'OpenJS.NodeJS.LTS',                         category: 'Development',       domain: 'nodejs.org' },
  { name: 'Python 3',                     id: 'Python.Python.3.12',                        category: 'Development',       domain: 'python.org' },
  { name: 'Visual Studio 2022',           id: 'Microsoft.VisualStudio.2022.Community',     category: 'Development',       domain: 'visualstudio.microsoft.com' },
  { name: 'Windows Terminal',             id: 'Microsoft.WindowsTerminal',                 category: 'Development',       domain: 'microsoft.com' },
  { name: 'Notepad++',                    id: 'Notepad++.Notepad++',                       category: 'Development',       domain: 'notepad-plus-plus.org' },
  // Utilities
  { name: '7-Zip',                        id: '7zip.7zip',                                 category: 'Utilities',         domain: '7-zip.org' },
  { name: 'WinRAR',                       id: 'RARLab.WinRAR',                             category: 'Utilities',         domain: 'win-rar.com' },
  { name: 'Revo Uninstaller',             id: 'RevoUninstaller.RevoUninstaller',           category: 'Utilities',         domain: 'revouninstaller.com' },
  { name: 'Bitwarden',                    id: 'Bitwarden.Bitwarden',                       category: 'Utilities',         domain: 'bitwarden.com' },
  { name: 'Antigravity',                  id: 'Google.Antigravity',                        category: 'Utilities',         domain: 'antigravity.google' },
  { name: 'Internet Download Manager',    id: 'Tonec.InternetDownloadManager',             category: 'Utilities',         domain: 'internetdownloadmanager.com' },
  { name: 'Winbox',                       id: 'Mikrotik.Winbox',                           category: 'Utilities',         domain: 'mikrotik.com' },
  { name: 'CCleaner',                     id: 'Piriform.CCleaner',                         category: 'Utilities',         domain: 'ccleaner.com' },
  { name: 'WizTree',                      id: 'AntibodySoftware.WizTree',                  category: 'Utilities',         domain: 'diskanalyzer.com' },
  // Media
  { name: 'Spotify', id: 'Spotify.Spotify', category: 'Media', domain: 'spotify.com' },
];

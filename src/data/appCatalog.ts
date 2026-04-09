// ══════════════════════════════════════════════════════════════════════════
// APP CATALOG — Curated list of apps installable via winget
// ══════════════════════════════════════════════════════════════════════════

export interface CatalogApp {
  name: string;
  id: string; // winget package ID
  category: string;
  domain?: string;
  iconUrl?: string; // curated, app-specific icon URL
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

const SI = (slug: string) => `https://cdn.simpleicons.org/${slug}/ffffff`;

export const APP_CATALOG: CatalogApp[] = [
  // Browsers
  { name: 'Brave',                        id: 'Brave.Brave',                               category: 'Browsers',          iconUrl: SI('brave') },
  { name: 'Chrome',                       id: 'Google.Chrome',                             category: 'Browsers',          iconUrl: SI('googlechrome') },
  { name: 'Edge',                         id: 'Microsoft.Edge',                            category: 'Browsers',          iconUrl: SI('microsoftedge') },
  { name: 'Firefox',                      id: 'Mozilla.Firefox',                           category: 'Browsers',          iconUrl: SI('firefoxbrowser') },
  { name: 'Opera GX',                     id: 'Opera.OperaGX',                             category: 'Browsers',          iconUrl: SI('opera') },
  { name: 'Tor Browser',                  id: 'TorProject.TorBrowser',                     category: 'Browsers',          iconUrl: SI('torbrowser') },
  // Communications
  { name: 'Discord',                      id: 'Discord.Discord',                           category: 'Communications',    iconUrl: SI('discord') },
  { name: 'Teams',                        id: 'Microsoft.Teams',                           category: 'Communications',    iconUrl: SI('microsoftteams') },
  { name: 'Telegram',                     id: 'Telegram.TelegramDesktop',                  category: 'Communications',    iconUrl: SI('telegram') },
  { name: 'Zoom',                         id: 'Zoom.Zoom',                                 category: 'Communications',    iconUrl: SI('zoom') },
  { name: 'AnyDesk',                      id: 'AnyDesk.AnyDesk',                           category: 'Communications',    iconUrl: SI('anydesk') },
  { name: 'TeamSpeak 3',                  id: 'TeamSpeakSystems.TeamSpeakClient',          category: 'Communications',    iconUrl: SI('teamspeak') },
  { name: 'TeamViewer',                   id: 'TeamViewer.TeamViewer',                     category: 'Communications',    iconUrl: SI('teamviewer') },
  // Gaming
  { name: 'Steam',                        id: 'Valve.Steam',                               category: 'Gaming',            iconUrl: SI('steam') },
  { name: 'Epic Games Launcher',          id: 'EpicGames.EpicGamesLauncher',               category: 'Gaming',            iconUrl: SI('epicgames') },
  { name: 'EA App',                       id: 'ElectronicArts.EADesktop',                  category: 'Gaming',            iconUrl: SI('ea') },
  { name: 'Ubisoft Connect',              id: 'Ubisoft.Connect',                           category: 'Gaming',            iconUrl: SI('ubisoft') },
  { name: 'Battle.net',                   id: 'Blizzard.BattleNet',                        category: 'Gaming',            iconUrl: SI('battledotnet') },
  { name: 'GeForce NOW',                  id: 'Nvidia.GeForceNow',                         category: 'Gaming',            iconUrl: SI('nvidia') },
  { name: 'Parsec',                       id: 'Parsec.Parsec',                             category: 'Gaming',            iconUrl: 'https://www.google.com/s2/favicons?domain=parsec.app&sz=64' },
  // Gaming Tools
  { name: 'MSI Afterburner',              id: 'Guru3D.Afterburner',                        category: 'Gaming Tools',      iconUrl: SI('msi') },
  { name: 'HWiNFO',                       id: 'REALiX.HWiNFO',                             category: 'Gaming Tools',      iconUrl: 'https://www.hwinfo.com/favicon.ico' },
  { name: 'GPU-Z',                        id: 'TechPowerUp.GPU-Z',                         category: 'Gaming Tools',      iconUrl: 'https://www.techpowerup.com/favicon.ico' },
  { name: 'CPU-Z',                        id: 'CPUID.CPU-Z',                               category: 'Gaming Tools',      iconUrl: 'https://www.google.com/s2/favicons?domain=cpuid.com&sz=64' },
  { name: 'Razer Synapse',                id: 'RazerInc.RazerInstaller.Synapse3',          category: 'Gaming Tools',      iconUrl: SI('razer') },
  { name: 'Logitech G HUB',               id: 'Logitech.GHUB',                             category: 'Gaming Tools',      iconUrl: SI('logitech') },
  { name: 'Display Driver Uninstaller',   id: 'Wagnardsoft.DisplayDriverUninstaller',      category: 'Gaming Tools',      iconUrl: 'https://www.google.com/s2/favicons?domain=wagnardsoft.com&sz=64' },
  // Streaming & Audio
  { name: 'OBS Studio',                   id: 'OBSProject.OBSStudio',                      category: 'Streaming & Audio', iconUrl: SI('obsstudio') },
  { name: 'Streamlabs',                   id: 'Streamlabs.Streamlabs',                     category: 'Streaming & Audio', iconUrl: SI('streamlabs') },
  { name: 'EarTrumpet',                   id: 'File-New-Project.EarTrumpet',               category: 'Streaming & Audio', iconUrl: 'https://www.google.com/s2/favicons?domain=eartrumpet.app&sz=64' },
  { name: 'SteelSeries Sonar',            id: 'SteelSeries.GG',                            category: 'Streaming & Audio', iconUrl: SI('steelseries') },
  { name: 'VLC',                          id: 'VideoLAN.VLC',                              category: 'Streaming & Audio', iconUrl: SI('vlcmediaplayer') },
  { name: 'VoiceMeeter Banana',           id: 'VB-Audio.Voicemeeter.Banana',               category: 'Streaming & Audio', iconUrl: 'https://vb-audio.com/favicon.ico' },
  { name: 'Elgato Camera Hub',            id: 'Elgato.CameraHub',                          category: 'Streaming & Audio', iconUrl: SI('elgato') },
  { name: 'Elgato Control Center',        id: 'Elgato.ControlCenter',                      category: 'Streaming & Audio', iconUrl: SI('elgato') },
  // Development
  { name: 'VS Code',                      id: 'Microsoft.VisualStudioCode',                category: 'Development',       iconUrl: SI('visualstudiocode') },
  { name: 'Git',                          id: 'Git.Git',                                   category: 'Development',       iconUrl: SI('git') },
  { name: 'GitHub Desktop',               id: 'GitHub.GitHubDesktop',                      category: 'Development',       iconUrl: SI('github') },
  { name: 'NodeJS LTS',                   id: 'OpenJS.NodeJS.LTS',                         category: 'Development',       iconUrl: SI('nodedotjs') },
  { name: 'Python 3',                     id: 'Python.Python.3.12',                        category: 'Development',       iconUrl: SI('python') },
  { name: 'Visual Studio 2022',           id: 'Microsoft.VisualStudio.2022.Community',     category: 'Development',       iconUrl: SI('visualstudio') },
  { name: 'Windows Terminal',             id: 'Microsoft.WindowsTerminal',                 category: 'Development',       iconUrl: SI('windowsterminal') },
  { name: 'Notepad++',                    id: 'Notepad++.Notepad++',                       category: 'Development',       iconUrl: SI('notepadplusplus') },
  // Utilities
  { name: '7-Zip',                        id: '7zip.7zip',                                 category: 'Utilities',         iconUrl: SI('7zip') },
  { name: 'WinRAR',                       id: 'RARLab.WinRAR',                             category: 'Utilities',         iconUrl: 'https://www.google.com/s2/favicons?domain=win-rar.com&sz=64' },
  { name: 'Revo Uninstaller',             id: 'RevoUninstaller.RevoUninstaller',           category: 'Utilities',         iconUrl: 'https://www.google.com/s2/favicons?domain=revouninstaller.com&sz=64' },
  { name: 'Bitwarden',                    id: 'Bitwarden.Bitwarden',                       category: 'Utilities',         iconUrl: SI('bitwarden') },
  { name: 'Antigravity',                  id: 'Google.Antigravity',                        category: 'Utilities',         iconUrl: SI('google') },
  { name: 'Internet Download Manager',    id: 'Tonec.InternetDownloadManager',             category: 'Utilities',         iconUrl: 'https://www.google.com/s2/favicons?domain=internetdownloadmanager.com&sz=64' },
  { name: 'Winbox',                       id: 'Mikrotik.Winbox',                           category: 'Utilities',         iconUrl: 'https://www.google.com/s2/favicons?domain=mikrotik.com&sz=64' },
  { name: 'CCleaner',                     id: 'Piriform.CCleaner',                         category: 'Utilities',         iconUrl: 'https://www.google.com/s2/favicons?domain=ccleaner.com&sz=64' },
  { name: 'WizTree',                      id: 'AntibodySoftware.WizTree',                  category: 'Utilities',         iconUrl: 'https://www.google.com/s2/favicons?domain=diskanalyzer.com&sz=64' },
  // Media
  { name: 'Spotify',                      id: 'Spotify.Spotify',                           category: 'Media',             iconUrl: SI('spotify') },
];

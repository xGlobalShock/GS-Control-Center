// lucide-react icons (used for cache utility cards)
import {
  Cpu,
  Trash2,
  FileText,
  Download,
  Globe,
  Folder,
  Image,
  ScrollText,
  Bug,
  DownloadCloud,
  RotateCcw,
} from 'lucide-react';

// bring back game & nvidia asset logos
import PrefetchLogo from '../assets/Prefetch.png';
import ForzaLogo from '../assets/Forza.png';
import ApexLogo from '../assets/Apex legends.png';
import NvidiaLogo from '../assets/nvidia.png';
import CODLogo from '../assets/COD Banner.jpg';
import CS2Logo from '../assets/CS2 Banner.jpg';
import FortniteLogo from '../assets/Fortnite Banner.jpg';
import LoLLogo from '../assets/LoL Banner.jpg';
import OverwatchLogo from '../assets/Overwatch Banner.jpg';
import R6Logo from '../assets/R6 Banner.jpg';
import RocketLeagueLogo from '../assets/Rocket League Banner.jpg';
import ValorantLogo from '../assets/Valorant.jpg';

export interface CleanerUtility {
  id: string;
  title: string;
  icon: any;
  cacheType: string;
  description: string;
  buttonText: string;
  color: string;
  buttonColor: string;
}

export const cleanerUtilities: CleanerUtility[] = [
    {
      id: 'forza-shaders',
      title: 'Clear Forza Horizon 5 Shaders',
      icon: ForzaLogo,
      cacheType: 'Forza Shader Cache',
      description: 'Deletes old Forza shader cache data so the game rebuilds fresh shaders, reducing stutters and load-time hitches.',
      buttonText: 'Clear Cache',
      color: '#0074D9',
      buttonColor: '#27ae60',
    },
  {
    id: 'nvidia-cache',
    title: 'Clear NVIDIA Cache',
    icon: NvidiaLogo,
    cacheType: 'DXCache/GLCache',
    description: 'Deletes NVIDIA driver shader caches so the GPU can regenerate optimized shaders and avoid stutters in games after driver or game updates.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#00FF00',
  },
  {
    id: 'apex-shaders',
    title: 'Clear Apex Shaders',
    icon: ApexLogo,
    cacheType: 'Shader Cache',
    description: 'Removes stale shader caches in Apex Legends to force a clean rebuild and reduce potential hitching and frame drops.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#FF6B35',
  },
  {
    id: 'cod-shaders',
    title: 'Clear Call of Duty Shaders',
    icon: CODLogo,
    cacheType: 'Shader Cache',
    description: 'Deletes Call of Duty shader caches that may become corrupted and cause microstutters or low FPS spikes.',
    buttonText: 'Clear Cache',
    color: '#000000',
    buttonColor: '#27ae60',
  },
  {
    id: 'cs2-shaders',
    title: 'Clear CS2 Shaders',
    icon: CS2Logo,
    cacheType: 'Shader Cache',
    description: 'Clears Counter-Strike 2 shader cache to avoid stutter spikes after updates or driver changes.',
    buttonText: 'Clear Cache',
    color: '#1B1B1B',
    buttonColor: '#27ae60',
  },
  {
    id: 'fortnite-shaders',
    title: 'Clear Fortnite Shaders',
    icon: FortniteLogo,
    cacheType: 'Shader Cache',
    description: 'Removes aged Fortnite shader files so the game regenerates new shaders and reduces texture hitching.',
    buttonText: 'Clear Cache',
    color: '#3B82F6',
    buttonColor: '#27ae60',
  },
  {
    id: 'lol-shaders',
    title: 'Clear LoL Shaders',
    icon: LoLLogo,
    cacheType: 'Shader Cache',
    description: 'Clears League of Legends shader and texture caches to prevent visual artifacts and reduce CPU/GPU spikes.',
    buttonText: 'Clear Cache',
    color: '#0A7EBB',
    buttonColor: '#27ae60',
  },
  {
    id: 'overwatch-shaders',
    title: 'Clear Overwatch 2 Shaders',
    icon: OverwatchLogo,
    cacheType: 'Shader Cache',
    description: 'Removes Overwatch 2 shader cache so the game can recompile shaders cleanly and reduce frame stutter.',
    buttonText: 'Clear Cache',
    color: '#F4A300',
    buttonColor: '#27ae60',
  },
  {
    id: 'r6-shaders',
    title: 'Clear Rainbow Six Siege Shaders',
    icon: R6Logo,
    cacheType: 'Shader Cache',
    description: 'Purges Rainbow Six Siege shader cache to address in-game lag and rendering pauses after updates.',
    buttonText: 'Clear Cache',
    color: '#FFA500',
    buttonColor: '#27ae60',
  },
  {
    id: 'rocket-league-shaders',
    title: 'Clear Rocket League Shaders',
    icon: RocketLeagueLogo,
    cacheType: 'Shader Cache',
    description: 'Removes stale Rocket League shader cache to prevent animation stutters and texture glitches.',
    buttonText: 'Clear Cache',
    color: '#4169E1',
    buttonColor: '#27ae60',
  },
  {
    id: 'valorant-shaders',
    title: 'Clear Valorant Shaders',
    icon: ValorantLogo,
    cacheType: 'Shader Cache',
    description: 'Clears Valorant shader caches, which can grow stale and trigger slowdowns or micro-stutters during matches.',
    buttonText: 'Clear Cache',
    color: '#FF4655',
    buttonColor: '#27ae60',
  },
  {
    id: 'thumbnail-cache',
    title: 'Clear Thumbnail Cache',
    icon: Image,
    cacheType: 'Explorer Thumbnails',
    description: 'Removes outdated thumbnail preview files so Windows Explorer rebuilds them and avoids slow folder loading.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#48BFE3',
  },
  {
    id: 'windows-logs',
    title: 'Clear Windows Logs',
    icon: ScrollText,
    cacheType: 'Log Files',
    description: 'Clears accumulated Windows event logs to reclaim disk space and reduce clutter, while keeping recent logs intact.',
    buttonText: 'Clear Logs',
    color: '#0074D9',
    buttonColor: '#56CFE1',
  },
  {
    id: 'crash-dumps',
    title: 'Clear Crash Dumps',
    icon: Bug,
    cacheType: 'Crash Reports',
    description: 'Removes old crash dump files to free disk space, keep this clean unless needed for troubleshooting.',
    buttonText: 'Clear Dumps',
    color: '#0074D9',
    buttonColor: '#FF6B6B',
  },
  {
    id: 'temp-files',
    title: 'Clear Temp Files',
    icon: FileText,
    cacheType: 'Temporary Files',
    description: 'Deletes Windows temporary files that can accumulate and consume disk space, improving performance and freeing up storage.',
    buttonText: 'Clear Files',
    color: '#0074D9',
    buttonColor: '#9D4EDD',
  },
  {
    id: 'update-cache',
    title: 'Clear Update Cache',
    icon: Download,
    cacheType: 'Windows Updates',
    description: 'Clears Windows Update download cache so future patches can start fresh and avoid update errors.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#00D4FF',
  },
  {
    id: 'dns-cache',
    title: 'Clear DNS Cache',
    icon: Globe,
    cacheType: 'Network Resolver',
    description: 'Flushes DNS cache so domain lookups are re-resolved and network name changes take effect quickly.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#00A3FF',
  },
  {
    id: 'ram-cache',
    title: 'Clear RAM Cache',
    icon: Cpu, // RAM Cache: CPU/memory icon
    cacheType: 'Memory Cache',
    description: 'Purges Windows standby memory list to free physical RAM for active apps and prevent slowdowns from memory pressure.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#FF00FF',
  },
  {
    id: 'recycle-bin',
    title: 'Empty Recycle Bin',
    icon: Trash2,
    cacheType: 'Recycle Bin',
    description: 'Permanently deletes recycled files to recover disk space, make sure you no longer need deleted items before running.',
    buttonText: 'Empty Bin',
    color: '#0074D9',
    buttonColor: '#E74C3C',
  },
  {
    id: 'windows-temp',
    title: 'Clear System Temp',
    icon: Folder,
    cacheType: 'System Temp Folder',
    description: 'Clears the Windows system-wide temp folder (C:\\Windows\\Temp), which accumulates files from system processes and installers.',
    buttonText: 'Clear Temp',
    color: '#0074D9',
    buttonColor: '#7B61FF',
  },
  {
    id: 'delivery-optimization',
    title: 'Clear Delivery Optimization',
    icon: DownloadCloud,
    cacheType: 'Delivery Optimization',
    description: 'Clears the Windows Update delivery optimization cache used for peer-to-peer update sharing, freeing up disk space without affecting future updates.',
    buttonText: 'Clear Cache',
    color: '#0074D9',
    buttonColor: '#0094D4',
  },
  {
    id: 'recent-files',
    title: 'Clear Quick Access History',
    icon: RotateCcw,
    cacheType: 'Quick Access History',
    description: 'Removes the Recent Files and Quick Access history from Windows Explorer, keeping your browsing activity private and the list clutter-free.',
    buttonText: 'Clear History',
    color: '#0074D9',
    buttonColor: '#F39C12',
  },
];

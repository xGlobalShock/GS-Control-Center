import { LucideIcon } from 'lucide-react';
import regeditIcon from '../assets/Regedit.png';

export interface PerformanceTweak {
  id: string;
  title: string;
  icon: LucideIcon | string;
  category: string;
  description: string;
  buttonText: string;
  color: string;
  registryPath: string;
  registryKey: string;
  registryValue: number;
  toggleableKey?: string;
}

export const performanceTweaks: PerformanceTweak[] = [
  {
    id: 'irq-priority',
    title: 'IRQ Priority',
    icon: regeditIcon,
    category: 'System Timer',
    description: 'Forces system timer to higher interrupt priority.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl',
    registryKey: 'IRQ8Priority',
    registryValue: 1,
  },
  {
    id: 'network-interrupts',
    title: 'Network Interrupts',
    icon: regeditIcon,
    category: 'Connectivity',
    description: 'Stabilizes network interrupts for lower ping.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters',
    registryKey: 'ProcessorThrottleMode',
    registryValue: 1,
  },
  {
    id: 'gpu-scheduling',
    title: 'GPU Scheduling',
    icon: regeditIcon,
    category: 'GPU Management',
    description: 'Reduces latency via GPU memory management.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    registryKey: 'HwSchMode',
    registryValue: 2,
  },
  {
    id: 'fullscreen-optimization',
    title: 'Fullscreen Opt.',
    icon: regeditIcon,
    category: 'Performance',
    description: 'Better fullscreen performance.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKCU:\\System\\GameConfigStore',
    registryKey: 'GameDVR_FSEBehaviorMonitorEnabled',
    registryValue: 0,
  },
  {
    id: 'usb-suspend',
    title: 'USB Suspend',
    icon: regeditIcon,
    category: 'Input Devices',
    description: 'Prevents USB power-saving mode.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USB',
    registryKey: 'DisableSelectiveSuspend',
    registryValue: 1,
  },
  {
    id: 'game-dvr',
    title: 'Game DVR',
    icon: regeditIcon,
    category: 'Recording',
    description: 'Frees up system resources.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKCU:\\System\\GameConfigStore',
    registryKey: 'GameDVR_Enabled',
    registryValue: 0,
  },
  {
    id: 'win32-priority',
    title: 'Win32 Priority',
    icon: regeditIcon,
    category: 'Prioritization',
    description: 'Prioritizes foreground applications.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl',
    registryKey: 'Win32PrioritySeparation',
    registryValue: 38,
  },
];

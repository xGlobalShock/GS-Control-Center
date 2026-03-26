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
    title: 'Reduce Input Latency',
    icon: regeditIcon,
    category: 'IRQ Priority',
    description: 'Increases IRQ8 priority so input devices are serviced faster in CPU-heavy workloads, improving smoothness and responsiveness for fast-paced gaming.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl',
    registryKey: 'IRQ8Priority',
    registryValue: 1,
  },
    {
    id: 'win32-priority',
    title: 'Boost Foreground App Priority',
    icon: regeditIcon,
    category: 'Win32 Priority',
    description: 'Increases foreground process scheduling share so your game gets CPU attention over background tasks, improving frame consistency during heavy multitasking.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl',
    registryKey: 'Win32PrioritySeparation',
    registryValue: 38,
  },
  {
    id: 'gpu-scheduling',
    title: 'Enable GPU Low-Latency Mode',
    icon: regeditIcon,
    category: 'GPU Scheduling',
    description: 'Turns on Hardware-accelerated GPU scheduling to reduce driver latency by allowing the GPU to manage its own scheduling, which can smooth stutters in graphically intense games.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    registryKey: 'HwSchMode',
    registryValue: 2,
  },
  {
    id: 'memory-compression',
    title: 'Use Full RAM (No Compression)',
    icon: regeditIcon,
    category: 'Disable Memory Compression',
    description: 'Disables logical RAM compression and forces more data to stay in physical RAM, benefiting memory-heavy games on systems with 16GB+ RAM at the cost of higher memory usage.',
    buttonText: 'Apply Tweak',
    color: '#FF851B',
    registryPath: 'MMAgent',
    registryKey: 'MemoryCompression',
    registryValue: 0,
  },
  {
    id: 'network-interrupts',
    title: 'Network Interrupts',
    icon: regeditIcon,
    category: 'Stabilize Ping',
    description: 'Adjusts network driver interrupt handling to prioritize fewer, larger packets for more consistent latency in online games, especially in congested networks.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NDIS\\Parameters',
    registryKey: 'ProcessorThrottleMode',
    registryValue: 1,
  },
  {
    id: 'fullscreen-optimization',
    title: 'Fullscreen Opt.',
    icon: regeditIcon,
    category: 'Disable Fullscreen Optimization',
    description: 'Disables Windows fullscreen optimization so native fullscreen apps run directly, reducing extra compositing layers and improving input and frame latency.',
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
    category: 'Disable USB Suspend',
    description: 'Disables selective suspend for USB devices to avoid sleep/wake latency on gaming peripherals, improving responsiveness for mouse and keyboard.',
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
    category: 'Disable Game DVR',
    description: 'Disables Game DVR and background recording to reduce performance impact and disk usage while focusing on gameplay performance.',
    buttonText: 'Apply Tweak',
    color: '#0074D9',
    registryPath: 'HKCU:\\System\\GameConfigStore',
    registryKey: 'GameDVR_Enabled',
    registryValue: 0,
  },
];

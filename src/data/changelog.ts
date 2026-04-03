export interface ChangelogEntry {
  version: string;
  date: string;
  highlights?: string;
  changes: {
    type: 'new' | 'improved' | 'fixed' | 'removed';
    text: string;
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: '1.7.0',
    date: '2026-04-03',
    highlights: 'Dashboard completely rebuilt with live charts, card flip hardware details, and app-wide visual unification',
    changes: [
      { type: 'new',      text: 'Dashboard: rebuilt as a 6-card live monitoring panel (CPU, GPU, RAM, Storage, Network, System) in a responsive 3×2 grid.' },
      { type: 'new',      text: 'Dashboard: each card has a real-time Recharts area sparkline with gradient fill and hover tooltip.' },
      { type: 'new',      text: 'Dashboard: Network card overlays Ping and Packet Loss on a dual-series sparkline.' },
      { type: 'new',      text: 'Dashboard: GPU, RAM, and System cards flip to a hardware detail back face via a "More Info" button.' },
      { type: 'new',      text: 'Dashboard: CPU per-core load strip with HyperThreading support; Storage per-volume segment strip.' },
      { type: 'new',      text: 'Dashboard: stat tiles per card — Temp, Cores, Clocks, VRAM, Fan Speed, RAM breakdown, etc.' },
      { type: 'new',      text: 'Dashboard: trend chip (Stable / +N% / −N%), animated clock/VRAM/GPU detail bars.' },
      { type: 'new',      text: 'Dashboard: Network quality tiles (Ping, Packet Loss, Link Speed) + Download/Upload split panel.' },
      { type: 'new',      text: 'Dashboard: Network back face shows IP, Gateway, DNS, MAC — double-click any field to privacy-blur.' },
      { type: 'new',      text: 'Dashboard: RAM back face shows stick config, page file, standby, and Top Processes sorted by RAM.' },
      { type: 'new',      text: 'Dashboard: System back face shows BIOS, Windows build, activation, Secure Boot, last update.' },
      { type: 'new',      text: 'Dashboard: Wi-Fi SSID + signal tile; battery tile for laptops; LIVE blinking badge.' },
      { type: 'new',      text: 'Dashboard: staggered Framer Motion entrance animations per card.' },
      { type: 'new',      text: 'Game Library: COMMANDS button with 3D gear design; Commands overlay with 3-column grid and search.' },
      { type: 'improved', text: 'Dashboard: glassmorphic cards with corner brackets, scanline overlay, and glowing accent bar.' },
      { type: 'improved', text: 'App-wide color migration from green (#00CC6A) to cyan (#00F2FF) across 15+ CSS files.' },
      { type: 'improved', text: 'Unified dark glassmorphic card style (background, border, shadow) across all pages.' },
      { type: 'improved', text: 'AdvisorPanel and HealthScore hover accents updated to cyan.' },
      { type: 'improved', text: 'Cache Flush overlay: single-column queue, width reduced to 540px, compact row padding.' },
      { type: 'fixed',    text: 'Fixed --border-color CSS variable still referencing cyan.' },
      { type: 'fixed',    text: 'Fixed Windows Debloat selected state and PerformanceTweakCard badges still using cyan/teal.' },
      { type: 'removed',  text: 'Game Library: Launch Options tab removed — replaced by the Commands overlay.' },
    ],
  },
];

export default changelog;


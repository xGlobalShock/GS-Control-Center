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
    version: '2.1.9',
    date: '2026-04-14',
    highlights: 'Global Accent Color theming, HUD card redesign, and stability fixes',
    changes: [
      {
        type: 'new',
        text: 'Added Accent Color picker in Settings > Appearance with 9 preset themes (Plasma Cyan, Ghost Green, Neon Violet, Electric Blue, Ember Orange, Hot Magenta, Crimson Red, Solar Gold, Platinum).',
      },
      {
        type: 'new',
        text: 'Global accent color system — all cards, charts, borders, glows, and dots across every page now follow the chosen accent color via CSS variable.',
      },
      {
        type: 'improved',
        text: 'Redesigned System Health, System Advisor, and Anti-Cheat header cards with futuristic HUD chip design featuring neon pulse lines, breathing glows, and animated status dots.',
      },
      {
        type: 'improved',
        text: 'Updated System Advisor icon to ScanLine and Anti-Cheat icon to AlertOctagon for better visual clarity.',
      },
      {
        type: 'improved',
        text: 'Dashboard hero cards, sparklines, stat tile dots, network quality dots, and flip card back panels all respect the global accent color.',
      },
      {
        type: 'improved',
        text: 'System Advisor and Anti-Cheat cards now show status-colored summary text (green = good, yellow = warning, red = critical) with white icons.',
      },
      {
        type: 'fixed',
        text: 'Fixed settings (accent color, rays, background) not persisting after app restart by flushing Chromium storage to disk on every save.',
      },
      {
        type: 'fixed',
        text: 'Fixed WebGL crash "Cannot set properties of null (setting renderer)" in Light Rays by preventing unnecessary context teardown on prop changes.',
      },
      {
        type: 'fixed',
        text: 'Fixed System Health compact card using hardcoded green instead of accent color for border, glow, and neon pulse.',
      },
      {
        type: 'fixed',
        text: 'Fixed Network flip card back labels using hardcoded cyan instead of accent color.',
      },
      {
        type: 'fixed',
        text: 'Fixed packet loss dot showing white instead of accent color when at 0%.',
      },
    ],
  },
];

export default changelog;


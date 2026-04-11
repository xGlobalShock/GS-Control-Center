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
    version: '2.1.5',
    date: '2026-04-11',
    highlights: 'Major update with new features, improvements, and fixes across the app.',
    changes: [
      {
        type: 'new',
        text: 'Added Trace Route diagnostics to the Network tools for improved connectivity troubleshooting.',
      },
      {
        type: 'new',
        text: 'Added a full Mouse / Polling Rate page with USB polling override, queue size control, and pointer configuration.',
      },
      {
        type: 'new',
        text: 'Added the Share Hardware Report workflow for sharing export-ready hardware reports.',
      },
      {
        type: 'new',
        text: 'Added the Dual PC guide section to support multi-machine setups and workflows.',
      },
      {
        type: 'new',
        text: 'Added AntiCheat compatibility status improvements, with safer wording and more accurate process reporting.',
      },
      {
        type: 'fixed',
        text: 'Fixed report image stretching and quality issues so shared images render at the correct native width and remain sharp.',
      },
      {
        type: 'fixed',
        text: 'Refined anti-cheat safe status text to avoid incorrect tweak claims and reflect actual compatibility checks.',
      },
    ],
  },
];

export default changelog;


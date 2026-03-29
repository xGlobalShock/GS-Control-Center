export interface ChangelogEntry {
  version: string;
  date: string;
  highlights?: string;
  changes: {
    type: 'new' | 'improved' | 'fixed';
    text: string;
  }[];
}

const changelog: ChangelogEntry[] = [
    {
    version: '1.5.3',
    date: '2026-03-29',
    highlights: 'Disk Analyzer & App Performance Improvement',
    changes: [
      { type: 'improved', text: 'Improved the performance of the Disk Analyzer for faster scanning and analysis.' },
      { type: 'fixed', text: 'Resolved an issue where the Disk Analyzer would occasionally freeze during large scans.' },
      { type: 'fixed', text: 'Addressed a bug that caused incorrect disk usage reporting in certain scenarios.' },
      { type: 'fixed', text: 'Fixed an issue with Electron updater, failing to update.' },
    ],
  },
  {
    version: '1.5.2',
    date: '2026-03-29',
    highlights: 'Network Diagnoser - Servers Bug Fix',
    changes: [
      { type: 'fixed', text: 'Fixed the issue where the Network Diagnoser was not able to ping the servers.' },
    ],
  },
  {
    version: '1.5.1',
    date: '2026-03-29',
    highlights: 'Network Diagnoser & Disk Analyzer updates',
    changes: [
      { type: 'improved', text: 'Enhanced Disk Analyzer with improved performance and user interface.' },
      { type: 'improved', text: 'Updated Network Diagnoser with more accurate diagnostics and a refreshed UI.' },
      { type: 'fixed', text: 'Resolved minor bugs in both tools for a smoother user experience.' },
      { type: 'new', text: 'Added new features to the Network Diagnoser for better network analysis.' },
      { type: 'new', text: 'Introduced new visualizations in the Disk Analyzer for easier data interpretation.' },
      { type: 'improved', text: 'Optimized resource usage in both tools for faster performance.' },
    ],
  },
];

export default changelog;

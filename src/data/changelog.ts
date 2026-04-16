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
    version: '2.2.7',
    date: '2026-04-16',
    highlights: 'Software Updates Overhaul: Real-time progress',
    changes: [
      {
        type: 'improved',
        text: 'Rebuilt Software Updates with full real-time download progress (MB downloaded/total, speed, percentage).',
      },
      {
        type: 'fixed',
        text: 'Fixed duplicate toast notifications during updates.',
      },
    ],
  },
];

export default changelog;


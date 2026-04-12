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
    version: '2.1.8',
    date: '2026-04-14',
    highlights: 'System Advisor improvements and bug fixes',
    changes: [
      {
        type: 'improved',
        text: 'Improved System Advisor functionality and fixed various bugs.',
      },
      {
        type: 'improved',
        text: 'Enhanced advisor checks for better accuracy and reliability.',
      },
      {
        type: 'improved',
        text: 'Scans user system for common misconfigurations and provides actionable recommendations.',
      },
    ],
  },
];

export default changelog;


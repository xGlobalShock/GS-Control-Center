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
    version: '2.2.8',
    date: '2026-04-16',
    highlights: 'Software Updates Redesign & New What\'s New Modal',
    changes: [
      {
        type: 'new',
        text: 'Real-time download progress tracking with speed, size, and percentage.',
      },
      {
        type: 'new',
        text: 'Cancel downloads mid-progress.',
      },
      {
        type: 'improved',
        text: 'Redesigned Software Updates page with a cleaner single-row layout.',
      },
      {
        type: 'improved',
        text: 'Redesigned What\'s New as a centered modal with version timeline sidebar.',
      },
      {
        type: 'fixed',
        text: 'Cancel status now shows the correct message.',
      },
      {
        type: 'fixed',
        text: 'Floating progress bar now displays actual status instead of always showing "Update failed".',
      },
      {
        type: 'removed',
        text: 'Removed redundant toast notifications from Software Updates.',
      },
    ],
  },
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


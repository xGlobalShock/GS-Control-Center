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
    highlights: 'Software Updates overhaul with full real-time download progress',
    changes: [
      {
        type: 'improved',
        text: 'Rebuilt Software Updates with full real-time download progress (MB downloaded/total, speed, percentage).',
      },
      {
        type: 'improved',
        text: 'Updates now work reliably in both dev and packaged builds.',
      },
      {
        type: 'improved',
        text: 'Smart installer handling — auto-detects installer type and applies correct silent install method.',
      },
      {
        type: 'fixed',
        text: 'Fixed certain apps (Spotify, Discord, etc.) failing to install in packaged build.',
      },
      {
        type: 'fixed',
        text: 'Fixed duplicate toast notifications during updates.',
      },
      {
        type: 'fixed',
        text: 'Silenced PowerShell timeout spam in startup logs.',
      },
      {
        type: 'removed',
        text: 'Removed native WinGet COM helper — no longer needed.',
      },
    ],
  },
];

export default changelog;


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
    version: '1.3.8',
    date: '2026-03-12',
    highlights: 'Dev Updates & Auto-Update System',
    changes: [
      { type: 'new', text: 'Real-time notification system for dev updates and app versions.' },
      { type: 'fixed', text: 'Dev Updates display and rendering optimizations.' },
      { type: 'improved', text: 'Auto-refresh mechanism for live content updates.' },
      { type: 'improved', text: 'Enhanced UI styling and content security policy.' },
    ],
  },
];

export default changelog;

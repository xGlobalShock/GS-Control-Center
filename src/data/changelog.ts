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
    version: '1.3.5',
    date: '2026-03-11',
    highlights: 'Rendering Stability & Resource Optimization',
    changes: [
      { type: 'new', text: 'Implemented a new rendering engine to prevent UI crashes during high-privilege operations.' },
      { type: 'new', text: 'Added a GPU Status indicator in Settings to monitor renderer health.' },
      { type: 'improved', text: 'Optimized background monitoring to pause when specific pages are not in view.' },
      { type: 'improved', text: 'Refined sensor polling intervals to significantly reduce idle CPU temperatures.' },
      { type: 'fixed', text: 'Resolved a critical issue causing intermittent GPU process crashes.' },
      { type: 'fixed', text: 'Addressed a bug causing elevated CPU temperatures during background monitoring.' },
    ],
  },
  {
    version: '1.3.4',
    date: '2026-03-10',
    highlights: 'Hardware Acceleration & Performance Overhaul',
    changes: [
      { type: 'new', text: 'Enabled GPU Hardware Acceleration for a smoother, more responsive UI experience.' },
      { type: 'new', text: 'Added "What\'s New?" panel for easy access to update notes.' },
      { type: 'improved', text: 'Massive reduction in app-wide CPU usage during active use.' },
      { type: 'improved', text: 'Optimized visual effects and animations for better rendering performance.' },
      { type: 'improved', text: 'Enhanced resource management and polling logic when the application is minimized.' },
      { type: 'fixed', text: 'Optimized UI animations to eliminate layout lag and stutter.' },
    ],
  },
];

export default changelog;

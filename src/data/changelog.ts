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
    version: '1.4.5',
    date: '2026-03-27',
    highlights: 'Cleanup toolkit and PC tweak support improvements',
    changes: [
      { type: 'new', text: 'Added PC tweak support for Disable-MMAgent memory compression toggle and full status checks.' },
      { type: 'new', text: 'Enhanced Cleanup Toolkit descriptions and card layout for clarity and usability.' },
      { type: 'new', text: 'Compact cleanup toolkit cards with tuned grid sizing and spacing.' },
      { type: 'fixed', text: 'Removed legacy automationItems registry from code path and resolved title/description alignment on cleaner cards.' },
      { type: 'fixed', text: 'Fixed Win32 priority registry check path and UI status detection that previously failed.' },
      { type: 'fixed', text: 'Resolved UI text layout issues in cleanup cards.' },
      { type: 'improved', text: 'Adjusted cleaner card grid sizing, spacing, and responsive behavior.' },
      { type: 'improved', text: 'Polished performance tweak wording, category mapping, and status indicator flows.' },
      { type: 'improved', text: 'Refined cleanup card descriptions and accent styling.' },
    ],
  },
];

export default changelog;

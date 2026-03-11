export interface DevUpdate {
  id: string;
  date: string;
  type: 'bug' | 'in-progress' | 'planned' | 'info';
  title: string;
  description?: string;
}

const devUpdates: DevUpdate[] = [
  {
    id: 'du-007',
    date: '2026-03-11',
    type: 'bug',
    title: 'Network stats not updating',
    description: 'Im aware of an issue where network stats (upload/download speeds) may not update in real-time for some users. I\'m investigating the root cause and will release a fix as soon as possible. In the meantime, restarting the app should temporarily resolve the issue.',
  },
];

export default devUpdates;

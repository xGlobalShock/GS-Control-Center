export interface ObsPreset {
  id: string;
  name: string;
  description: string;
  features: string[];
  iconName: string;
  color: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
}

export const OBS_PRESETS: ObsPreset[] = [
  {
    id: 'multiStreaming',
    name: 'Multi Streaming OBS',
    description: 'Integrated with StreamElements. Perfect for streaming to multiple platforms simultaneously.',
    features: [
      'StreamElements Integration',
      'Multi-Platform Setup',
      'Chat Overlay Ready',
      'Alert System',
      'Custom Overlays',
      'Scene Collection Setup',
    ],
    iconName: 'broadcast',
    color: '#FF00FF',
    difficulty: 'Intermediate',
  },
  {
    id: 'gaming',
    name: 'Gaming OBS',
    description: 'Optimized for game streaming with performance-focused settings and gaming overlays.',
    features: [
      'Game Capture Optimized',
      'Performance Profiles',
      'Organized Scene Collections',
      'Gaming Overlay',
      'Music Disabled in VODs',
      'Scenes for Gameplay, BRB, and Ending',
      'Best settings for Twitch',
    ],
    iconName: 'gamepad',
    color: '#00FF88',
    difficulty: 'Intermediate',
  },
];

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
    id: 'gaming',
    name: 'Gaming OBS',
    description: 'A complete OBS setup designed for game streaming. Automatically configures optimal video, output, and audio settings while providing ready-to-use scenes and overlays for a smooth streaming experience.',
    features: [
      'Pre-built Scenes (Gaming, Starting, BRB, Ending)',
      'Optimized Game Capture configuration',
      'Best Video settings (Resolution + 60 FPS)',
      'High-quality Output settings for streaming',
      'Audio setup with VOD-safe music routing',
      'Organized Scene Collections and Sources',
      'Performance-friendly settings for stable streams',
      'Twitch-optimized streaming configuration',
    ],
    iconName: 'gamepad',
    color: '#00F2FF',
    difficulty: 'Intermediate',
  },
];


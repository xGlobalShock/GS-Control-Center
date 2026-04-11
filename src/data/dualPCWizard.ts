/* ═══════════════════════════════════════════════════════════════
   Dual-PC Streaming Wizard — Steps, Checklist, Troubleshooting
═══════════════════════════════════════════════════════════════ */

// ── Types ──────────────────────────────────────────────────────

export type ConnectionMethod = 'ndi' | 'capture-card';

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  /** Detailed instructions per connection method */
  instructions: {
    ndi: string[];
    'capture-card': string[];
  };
  tips?: string[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  method: ConnectionMethod | 'both';
}

export interface TroubleshootItem {
  issue: string;
  solution: string;
  method: ConnectionMethod | 'both';
}

export interface NDISettings {
  label: string;
  resolution: string;
  bitrate: string;
  codec: string;
  linkSpeed: string;
}

// ── Wizard Steps ───────────────────────────────────────────────

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'connection',
    title: 'Connect the Two PCs',
    description: 'Establish VideoFeed link between your Gaming PC and Streaming PC.',
    instructions: {
      ndi: [
        'Connect both PCs to the same network (router or direct Ethernet crossover).',
        'Install NDI Tools on BOTH PCs from ndi.video/tools.',
        'On the Gaming PC, open NDI Screen Capture and select your primary monitor.',
        'Ensure both PCs are on the same subnet (e.g., 192.168.1.x).',
      ],
      'capture-card': [
        'Connect an HDMI cable from the Gaming PC GPU output to the capture card input.',
        'Install the capture card in the Streaming PC (USB or PCIe).',
        'Install capture card drivers (Elgato, AVerMedia, etc.).',
        'Ensure the Gaming PC is set to duplicate or extend display including the HDMI output.',
      ],
    },
    tips: [
      'A direct Ethernet cable between PCs gives the lowest latency for NDI.',
      'Use Cat6 or better cabling for reliable 1 Gbps connections.',
    ],
  },
  {
    id: 'obs-setup',
    title: 'Configure OBS on Streaming PC',
    description: 'Set up OBS Studio to receive the video feed from your Gaming PC.',
    instructions: {
      ndi: [
        'Install the OBS NDI plugin (obs-ndi) on the Streaming PC.',
        'In OBS, add a new Source → NDI™ Source.',
        'Select the Gaming PC\'s NDI source from the dropdown.',
        'Set bandwidth to "Highest" for best quality.',
        'Resize the NDI source to fill the canvas (right-click → Transform → Fit to Screen).',
      ],
      'capture-card': [
        'In OBS, add a new Source → Video Capture Device.',
        'Select your capture card from the device dropdown.',
        'Set resolution to match your Gaming PC output (e.g., 1920×1080).',
        'Set frame rate to 60 FPS if supported by your capture card.',
        'Use "Deactivate when not showing" to save resources.',
      ],
    },
  },
  {
    id: 'audio',
    title: 'Set Up Audio Routing',
    description: 'Route game audio and microphone correctly between machines.',
    instructions: {
      ndi: [
        'NDI carries audio embedded in the stream — enable audio on the NDI source in OBS.',
        'On the Gaming PC, set NDI Screen Capture audio source to your desktop audio.',
        'For mic: either plug the mic into the Streaming PC, or route it via NDI.',
        'In OBS Audio Mixer, mute desktop audio and use only the NDI feed to avoid echo.',
        'If using a separate mic on the Streaming PC, add it as a regular Audio Input Capture.',
      ],
      'capture-card': [
        'HDMI carries audio — your capture card will receive game sound automatically.',
        'In OBS, check that the Video Capture Device source has audio enabled.',
        'For mic: plug into the Streaming PC and add as Audio Input Capture in OBS.',
        'Alternatively, route mic audio from Gaming PC via HDMI (set as default device).',
        'Use Audio Monitoring (Edit → Advanced Audio → Monitor and Output) to preview.',
      ],
    },
    tips: [
      'Use VoiceMeeter on the Gaming PC for advanced audio routing.',
      'Always test for audio desync — NDI can add 1-2 frames of delay.',
    ],
  },
  {
    id: 'encoding',
    title: 'Optimize Encoding Settings',
    description: 'Configure the Streaming PC encoder for the best quality-to-performance ratio.',
    instructions: {
      ndi: [
        'Use x264 (CPU) encoding on the Streaming PC — the GPU is free since it\'s not gaming.',
        'Set Encoder Preset to "medium" or "slow" for best quality (the streaming PC has headroom).',
        'Rate Control: CBR at 6000–8000 Kbps for Twitch (or 10000–20000 for YouTube).',
        'Keyframe Interval: 2 seconds (required by most platforms).',
        'Profile: High, Tune: (none or zerolatency for low-delay).',
        'Output Resolution: 1920×1080 or 1280×720 depending on your upload speed.',
      ],
      'capture-card': [
        'Use x264 (CPU) encoding — streaming PC CPU is dedicated to this task.',
        'Set Encoder Preset to "medium" or "slow" for quality.',
        'Rate Control: CBR at 6000–8000 Kbps for Twitch.',
        'Keyframe Interval: 2 seconds.',
        'If the streaming PC has a dedicated GPU, you can use NVENC as an alternative.',
        'Output Resolution: Match your capture card input resolution for no rescaling overhead.',
      ],
    },
    tips: [
      'The streaming PC can use a slower x264 preset because it\'s not running a game.',
      'Test with a 15-minute stream recording and check for dropped frames.',
    ],
  },
];

// ── Verification Checklist ─────────────────────────────────────

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: 'ndi-visible',      label: 'Can you see the NDI source in OBS?',              method: 'ndi' },
  { id: 'ndi-low-latency',  label: 'NDI latency under 50 ms?',                        method: 'ndi' },
  { id: 'cap-detected',     label: 'Capture card detected in OBS Device list?',        method: 'capture-card' },
  { id: 'cap-signal',       label: 'Capture card showing video signal?',               method: 'capture-card' },
  { id: 'video-fullscreen', label: 'Video feed fills the OBS canvas correctly?',       method: 'both' },
  { id: 'audio-present',    label: 'Game audio is present in OBS Audio Mixer?',        method: 'both' },
  { id: 'audio-no-echo',    label: 'No audio echo or double-up?',                      method: 'both' },
  { id: 'mic-working',      label: 'Microphone audio detected in OBS?',                method: 'both' },
  { id: 'encoding-ok',      label: 'Encoder running without dropped frames?',          method: 'both' },
  { id: 'stream-test',      label: 'Test stream looks and sounds good on playback?',   method: 'both' },
];

// ── Troubleshooting ────────────────────────────────────────────

export const TROUBLESHOOT_ITEMS: TroubleshootItem[] = [
  {
    issue: 'NDI source not appearing in OBS',
    solution: 'Check that both PCs are on the same subnet. Disable Windows Firewall temporarily or add NDI exceptions for ports 5353 (mDNS) and 5960+ (NDI). Restart NDI Screen Capture.',
    method: 'ndi',
  },
  {
    issue: 'High NDI latency (>100 ms)',
    solution: 'Use a direct Ethernet cable instead of WiFi. Ensure the link speed is 1 Gbps — 100 Mbps is too slow for high-quality NDI. Reduce NDI resolution to 720p if needed.',
    method: 'ndi',
  },
  {
    issue: 'NDI video stuttering or dropping frames',
    solution: 'Lower NDI bandwidth in the source settings. Close other network-heavy applications. Check for network congestion with Task Manager → Performance → Ethernet.',
    method: 'ndi',
  },
  {
    issue: 'Capture card shows black screen',
    solution: 'Check HDMI cable is firmly connected. Try a different HDMI port on the GPU. Update capture card drivers. Disable HDCP in the Gaming PC display settings.',
    method: 'capture-card',
  },
  {
    issue: 'Capture card signal flickering or unstable',
    solution: 'Set the Gaming PC to a fixed refresh rate (60 Hz). Avoid using G-Sync/FreeSync on the HDMI output. Try a different HDMI cable (use HDMI 2.0 certified).',
    method: 'capture-card',
  },
  {
    issue: 'Audio desync between video and sound',
    solution: 'In OBS, go to Edit → Advanced Audio Properties and add a Sync Offset (try +50 to +150 ms on the audio source). For NDI, latency settings may need adjustment.',
    method: 'both',
  },
  {
    issue: 'No game audio coming through',
    solution: 'On the Gaming PC, check that the correct audio output is selected (HDMI for capture card, or desktop audio for NDI). In OBS, verify the audio source is not muted.',
    method: 'both',
  },
  {
    issue: 'OBS showing "Encoding overloaded" warning',
    solution: 'Switch the x264 preset from "slow" to "medium" or "fast". Reduce output resolution to 720p. If using NVENC, lower the Lookahead and B-frames settings.',
    method: 'both',
  },
];

// ── NDI Recommended Settings Based on Link Speed ───────────────

export const NDI_PRESETS: NDISettings[] = [
  {
    label: 'Best Quality (1 Gbps)',
    resolution: '1920×1080 @ 60 FPS',
    bitrate: '125–150 Mbps',
    codec: 'NDI|HX2 (H.264)',
    linkSpeed: '1 Gbps',
  },
  {
    label: 'Balanced (1 Gbps)',
    resolution: '1920×1080 @ 60 FPS',
    bitrate: '80–100 Mbps',
    codec: 'NDI|HX3 (H.265)',
    linkSpeed: '1 Gbps',
  },
  {
    label: 'Low Bandwidth (100 Mbps)',
    resolution: '1280×720 @ 60 FPS',
    bitrate: '30–50 Mbps',
    codec: 'NDI|HX3 (H.265)',
    linkSpeed: '100 Mbps',
  },
  {
    label: 'WiFi Fallback',
    resolution: '1280×720 @ 30 FPS',
    bitrate: '15–25 Mbps',
    codec: 'NDI|HX3 (H.265)',
    linkSpeed: 'WiFi (varies)',
  },
];

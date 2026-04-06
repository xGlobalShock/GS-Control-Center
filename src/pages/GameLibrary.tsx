import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Monitor, Cpu, ArrowLeft, Copy, Info, Gamepad2, HardDrive, CheckCircle, XCircle, Zap, Settings, RefreshCw, AlertTriangle, Lock, Unlock, Eye, User } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { HardwareInfo } from '../App';
import { GAME_REQUIREMENTS } from '../data/gameRequirements';
import { compareHardware, quickVerdict, predictFps, type ComparisonResult, type OverallVerdict } from '../utils/hardwareCompare';
import '../styles/GameLibrary.css';
import ProPreviewBanner from '../components/ProPreviewBanner';
import ProLockedWrapper from '../components/ProLockedWrapper';
import valorantImg from '../assets/Valorant.jpg';
import rocketLeagueImg from '../assets/Rocket League Banner.jpg';
import overwatchImg from '../assets/Overwatch Banner.jpg';
import lolImg from '../assets/LoL Banner.jpg';
import fortniteImg from '../assets/Fortnite Banner.jpg';
import cs2Img from '../assets/CS2 Banner.jpg';
import codImg from '../assets/COD Banner.jpg';
import apexImg from '../assets/Apex Banner.jpg';

interface OptimizationSettings {
  graphics: {
    title: string;
    settings: { name: string; value: string; description: string }[];
  };
  launch: {
    title: string;
    options: { flag: string; description: string; impact: string }[];
  };
  performance: {
    title: string;
    tweaks: { name: string; value: string; benefit: string }[];
  };
}

/* ── Game Profile: config file settings definitions ── */

interface ProfileSettingDef {
  key: string;           // Key in the config file
  label: string;
  type: 'toggle' | 'select' | 'resolution' | 'slider';
  options?: { label: string; value: string }[];
  description?: string;
  section: 'core' | 'additional';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/** Which games support the profile editor */
const SUPPORTED_PROFILE_GAMES = ['apex-legends'];

const APEX_PROFILE_SETTINGS: ProfileSettingDef[] = [
  // Core settings
  { key: 'setting.fullscreen', label: 'Display Mode', type: 'select', section: 'core' },
  { key: 'setting.nowindowborder', label: 'Display Mode (border)', type: 'select', section: 'core' },
  { key: 'setting.defaultres', label: 'Resolution Width', type: 'resolution', section: 'core' },
  { key: 'setting.defaultresheight', label: 'Resolution Height', type: 'resolution', section: 'core' },
  { key: 'setting.gamma', label: 'Brightness', type: 'slider', section: 'core', min: 0, max: 2.0, step: 0.01 },
  // Additional options
  { key: 'setting.fullscreen', label: 'Enable Fullscreen', type: 'toggle', section: 'additional' },
  { key: 'setting.mat_picmip', label: 'Low Map Detail', type: 'toggle', section: 'additional', description: 'Reduces texture mipmap quality for performance' },
  { key: 'setting.mat_forceaniso', label: 'Low Texture Filtering', type: 'toggle', section: 'additional', description: 'Sets anisotropic filtering to minimum' },
  { key: 'setting.mat_ambient_occlusion_enabled', label: 'Disable Ambient Occlusion', type: 'toggle', section: 'additional' },
  { key: 'setting.csm_coverage', label: 'Low Sun Shadow Coverage', type: 'toggle', section: 'additional' },
  { key: 'setting.stream_memory', label: 'Texture Streaming Budget (None)', type: 'toggle', section: 'additional', description: 'Sets streaming memory to minimum' },
  { key: 'setting.gpu_level', label: 'Low Texture Quality', type: 'toggle', section: 'additional' },
  { key: 'setting.shadow_enable', label: 'Disable Spot Shadows', type: 'toggle', section: 'additional' },
  { key: 'setting.volumetric_lighting', label: 'Disable Volumetric Lighting', type: 'toggle', section: 'additional' },
  { key: 'setting.r_lod_switch_scale', label: 'Low Model Detail', type: 'toggle', section: 'additional', description: 'Uses lowest LOD distance' },
  { key: 'setting.particle_effects', label: 'Low Effects Detail', type: 'toggle', section: 'additional' },
  { key: 'setting.impact_marks', label: 'Disable Impact Marks', type: 'toggle', section: 'additional' },
  { key: 'setting.ragdoll', label: 'Disable Ragdolls', type: 'toggle', section: 'additional' },
];

const GAME_PROFILE_SETTINGS: Record<string, ProfileSettingDef[]> = {
  'apex-legends': APEX_PROFILE_SETTINGS,
};

const coreKeys = new Set(APEX_PROFILE_SETTINGS.filter(s => s.section === 'core').map(s => s.key));

/* ── Resolution & Aspect Ratio data ── */
interface ResolutionEntry { w: number; h: number; label: string; native?: boolean; }
const ASPECT_RESOLUTIONS: Record<string, ResolutionEntry[]> = {
  '16:9': [
    { w: 1280, h: 720, label: '1280x720' },
    { w: 1360, h: 768, label: '1360x768' },
    { w: 1366, h: 768, label: '1366x768' },
    { w: 1600, h: 900, label: '1600x900' },
    { w: 1920, h: 1080, label: '1920x1080', native: true },
  ],
  '16:10': [
    { w: 1280, h: 768, label: '1280x768' },
    { w: 1280, h: 800, label: '1280x800' },
    { w: 1600, h: 1024, label: '1600x1024' },
    { w: 1680, h: 1050, label: '1680x1050' },
  ],
  '4:3 / 5:4': [
    { w: 1152, h: 864, label: '1152x864' },
    { w: 1280, h: 960, label: '1280x960' },
    { w: 1440, h: 1080, label: '1440x1080' },
  ],
};
const ASPECT_KEYS = Object.keys(ASPECT_RESOLUTIONS);

function classifyAspectRatio(w: number, h: number): string {
  const ratio = w / h;
  if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(ratio - 16 / 10) < 0.08) return '16:10';
  if (Math.abs(ratio - 4 / 3) < 0.1 || Math.abs(ratio - 5 / 4) < 0.1) return '4:3 / 5:4';
  return '16:10'; // most custom stretched resolutions fall here
}

function detectAspectRatio(w: number, h: number, mergedResolutions: Record<string, ResolutionEntry[]>): string {
  for (const [aspect, resolutions] of Object.entries(mergedResolutions)) {
    if (resolutions.some(r => r.w === w && r.h === h)) return aspect;
  }
  return classifyAspectRatio(w, h);
}

function getDisplayMode(fs: string, border: string): string {
  if (fs === '1') return 'fullscreen';
  if (border === '1') return 'borderless';
  return 'windowed';
}

const DISPLAY_MODES = [
  { value: 'fullscreen', label: 'Full Screen' },
  { value: 'borderless', label: 'Borderless Window' },
  { value: 'windowed', label: 'Windowed' },
];

/* ── Apex Video Controls: Proper in-game style controls for each setting ── */

interface VideoControlDef {
  key: string;
  label: string;
  control: 'select' | 'toggle' | 'slider';
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

const APEX_VIDEO_CONTROLS: VideoControlDef[] = [
  // Matches in-game ADVANCED order exactly
  {
    key: 'setting.mat_vsync_mode', label: 'V-Sync', control: 'select',
    options: [{ label: 'Disabled', value: '0' }, { label: 'Double Buffered', value: '1' }, { label: 'Triple Buffered', value: '2' }, { label: 'Adaptive', value: '3' }, { label: 'Adaptive (1/2 Rate)', value: '4' }]
  },
  {
    key: 'setting.mat_nvidia_reflex_enabled', label: 'Nvidia Reflex', control: 'select',
    options: [{ label: 'Disabled', value: '0' }, { label: 'Enabled', value: '1' }, { label: 'Enabled + Boost', value: '2' }]
  },
  {
    key: 'setting.mat_antialias_mode', label: 'Anti-aliasing', control: 'select',
    options: [{ label: 'None', value: '0' }, { label: 'TSAA', value: '12' }]
  },
  {
    key: 'setting.stream_memory', label: 'Texture Streaming Budget', control: 'select',
    options: [
      { label: 'None', value: '0' },
      { label: 'Very Low (2 GB)', value: '160000' },
      { label: 'Low (2-3 GB)', value: '300000' },
      { label: 'Medium (3 GB)', value: '600000' },
      { label: 'High (4 GB)', value: '1000000' },
      { label: 'Very High (6 GB)', value: '2000000' },
      { label: 'Ultra (8 GB)', value: '3000000' },
    ]
  },
  {
    key: 'setting.mat_forceaniso', label: 'Texture Filtering', control: 'select',
    options: [
      { label: 'Bilinear', value: '1' },
      { label: 'Trilinear', value: '2' },
      { label: 'Anisotropic 2x', value: '4' },
      { label: 'Anisotropic 4x', value: '8' },
      { label: 'Anisotropic 8x', value: '16' },
    ]
  },
  {
    key: 'setting.ssao_quality', label: 'Ambient Occlusion Quality', control: 'select',
    options: [
      { label: 'Disabled', value: '0' },
      { label: 'Low', value: '1' },
      { label: 'Medium', value: '2' },
      { label: 'High', value: '3' },
      { label: 'Very High', value: '4' },
    ]
  },
  {
    key: 'setting.csm_coverage', label: 'Sun Shadow Coverage', control: 'toggle',
    options: [{ label: 'Low', value: '1' }, { label: 'High', value: '2' }]
  },
  {
    key: 'setting.csm_cascade_res', label: 'Sun Shadow Detail', control: 'toggle',
    options: [
      { label: 'Low', value: '512' },
      { label: 'High', value: '1024' }
    ]
  },

  {
    key: 'setting.shadow_depth_upres_factor_max', label: 'Spot Shadow Detail', control: 'select',
    options: [
      { label: 'Disabled', value: '0' },
      { label: 'Low', value: '1' },
      { label: 'High', value: '2' },
      { label: 'Very High', value: '3' },
      { label: 'Ultra', value: '4' },
    ]
  },
  {
    key: 'setting.volumetric_lighting', label: 'Volumetric Lighting', control: 'toggle',
    options: [{ label: 'Disabled', value: '0' }, { label: 'Enabled', value: '1' }]
  },
  {
    key: 'setting.shadow_enable', label: 'Dynamic Spot Shadows', control: 'toggle',
    options: [{ label: 'Disabled', value: '0' }, { label: 'Enabled', value: '1' }]
  },
  {
    key: 'setting.r_lod_switch_scale', label: 'Model Detail', control: 'select',
    options: [
      { label: 'Low', value: '0.6' },
      { label: 'Medium', value: '0.8' },
      { label: 'High', value: '1' },
      { label: 'Very High', value: '2' },
    ]
  },
  {
    key: 'setting.mat_picmip', label: 'Map Detail', control: 'select',
    options: [
      { label: 'Very Low', value: '3' },
      { label: 'Low', value: '2' },
      { label: 'Medium', value: '1' },
      { label: 'High', value: '0' },
    ]
  },
  {
    key: 'setting.particle_cpu_level', label: 'Effects Detail', control: 'select',
    options: [
      { label: 'Low', value: '0' },
      { label: 'Medium', value: '1' },
      { label: 'High', value: '2' },
    ]
  },
  {
    key: 'setting.r_decals', label: 'Impact Marks', control: 'select',
    options: [
      { label: 'Disabled', value: '0' },
      { label: 'Low', value: '64' },
      { label: 'Medium', value: '128' },
      { label: 'High', value: '256' },
    ]
  },
  {
    key: 'setting.cl_ragdoll_maxcount', label: 'Ragdolls', control: 'select',
    options: [
      { label: 'Low', value: '0' },
      { label: 'Medium', value: '4' },
      { label: 'High', value: '8' },
    ]
  },
];

/* ── Pro Player Configs (loaded from V-Config folder) ── */
interface ProPlayerEntry {
  name: string;
  role: string;
}

/** Human-readable labels for all known Apex videoconfig keys */
const APEX_SETTING_LABELS: Record<string, string> = {
  'setting.cl_gib_allow': 'Allow Gibs',
  'setting.cl_particle_fallback_base': 'Particle Fallback Base',
  'setting.cl_particle_fallback_multiplier': 'Particle Fallback Multiplier',
  'setting.cl_ragdoll_maxcount': 'Max Ragdoll Count',
  'setting.cl_ragdoll_self_collision': 'Ragdoll Self Collision',
  'setting.mat_depthfeather_enable': 'Depth Feather',
  'setting.mat_forceaniso': 'Anisotropic Filtering',
  'setting.mat_mip_linear': 'Mip Linear Filtering',
  'setting.stream_memory': 'Texture Streaming Budget',
  'setting.mat_picmip': 'Texture Mipmap Level',
  'setting.particle_cpu_level': 'Particle CPU Level',
  'setting.r_createmodeldecals': 'Model Decals',
  'setting.r_decals': 'World Decals',
  'setting.r_lod_switch_scale': 'Model LOD Scale',
  'setting.shadow_enable': 'Shadows Enable',
  'setting.shadow_depth_dimen_min': 'Shadow Depth Min',
  'setting.shadow_depth_upres_factor_max': 'Shadow Upres Factor Max',
  'setting.shadow_maxdynamic': 'Max Dynamic Shadows',
  'setting.ssao_enabled': 'SSAO Enabled',
  'setting.ssao_downsample': 'SSAO Downsample',
  'setting.dvs_enable': 'Dynamic Resolution',
  'setting.dvs_gpuframetime_min': 'DVS GPU Frame Time Min',
  'setting.dvs_gpuframetime_max': 'DVS GPU Frame Time Max',
  'setting.defaultres': 'Resolution Width',
  'setting.defaultresheight': 'Resolution Height',
  'setting.fullscreen': 'Fullscreen',
  'setting.nowindowborder': 'Borderless Window',
  'setting.mat_vsync_mode': 'V-Sync',
  'setting.mat_backbuffer_count': 'Back Buffer Count',
  'setting.mat_antialias': 'Anti-Aliasing',
  'setting.mat_antialias_mode': 'Anti-Aliasing Mode',
  'setting.csm_enabled': 'Spot Shadows',
  'setting.csm_coverage': 'Sun Shadow Coverage',
  'setting.csm_cascade_res': 'Shadow Cascade Resolution',
  'setting.volumetric_lighting': 'Volumetric Lighting',
  'setting.mat_nvidia_reflex_enabled': 'NVIDIA Reflex',
  'setting.gpu_level': 'GPU Level',
  'setting.gpu_mem_level': 'GPU Memory Level',
  'setting.mat_ambient_occlusion_enabled': 'Ambient Occlusion',
  'setting.impact_marks': 'Impact Marks',
  'setting.ragdoll': 'Ragdolls',
  'setting.particle_effects': 'Particle Effects',
  'setting.mat_screen_blur_enabled': 'Screen Blur',
  'setting.r_shadows_on_terrain': 'Terrain Shadows',
  'setting.mat_bloom_scalefactor_scalar': 'Bloom Scale Factor',
  'setting.gamma': 'Brightness',
  'setting.sound_volume': 'Sound Volume',
  'setting.last_display_width': 'Last Display Width',
  'setting.last_display_height': 'Last Display Height',
  'setting.fadeDistScale': 'Fade Distance Scale',
  'setting.new_shadow_settings': 'New Shadow Settings',
  'setting.dynamic_streaming_budget': 'Dynamic Streaming Budget',
  'setting.configversion': 'Config Version',
  'setting.map_detail_level': 'Map Detail Level',
  'setting.ssao_quality': 'SSAO Quality',
  'setting.volumetric_fog': 'Volumetric Fog',
  'videoconfig_version': 'Config Version',
};

interface Game {
  id: string;
  title: string;
  description: string;
  category: string;
  image: string;
  platform: string[];
  recommended: OptimizationSettings;
}

// Comprehensive Apex Legends command list for "Show Commands" modal
const apexAllCommands = [
  { flag: '-novid', description: 'Disables EA/Apex intro videos for faster startup', impact: 'High' },
  { flag: '+fps_max 0', description: 'Uncaps FPS for unlimited frame rates (may stutter above 200 FPS)', impact: 'High' },
  { flag: '+fps_max 144', description: 'Caps FPS to 144 to reduce GPU load and prevent stuttering', impact: 'High' },
  { flag: '+fps_max 200', description: 'Caps FPS to 200 for optimal balance of performance and smoothness', impact: 'High' },
  { flag: '-high', description: 'Starts game with high CPU priority (may cause issues on some systems)', impact: 'High' },
  { flag: '+cl_showpos 1', description: 'Displays position and velocity in top-left corner', impact: 'Low' },
  { flag: '+cl_showfps 4', description: 'Shows FPS and frame timing/latency information', impact: 'Low' },
  { flag: '-fullscreen', description: 'Forces exclusive fullscreen mode for better performance', impact: 'Medium' },
  { flag: '-no_render_on_input_thread', description: 'Essential for high-polling mice (2K/4K/8K Hz) to prevent stuttering', impact: 'High' },
  { flag: '+exec autoexec', description: 'Executes custom autoexec.cfg file from cfg folder', impact: 'Medium' },
  { flag: '-dxlevel 95', description: 'Forces DirectX 9 rendering (better for older hardware)', impact: 'Medium' },
  { flag: '+mat_letterbox_aspect_goal 0', description: 'Prevents black bars with custom resolutions (use with threshold)', impact: 'Low' },
  { flag: '+mat_letterbox_aspect_threshold 0', description: 'Prevents black bars with custom/stretched resolutions', impact: 'Low' },
  { flag: '+mat_minimize_on_alt_tab 1', description: 'Allows game to minimize when Alt-Tabbing', impact: 'Low' },
  { flag: '+cl_is_softened_locale 1', description: 'Reduces visual clutter for cleaner gameplay', impact: 'Low' }
];

const gameOptimizations: { [key: string]: OptimizationSettings } = {
  'valorant': {
    graphics: {
      title: 'Optimal Graphics Settings',
      settings: [
        { name: 'Display Mode', value: 'Fullscreen', description: 'Reduces input lag and maximizes FPS' },
        { name: 'Resolution', value: 'Native (1920x1080)', description: 'Best clarity without performance loss' },
        { name: 'Texture Quality', value: 'High', description: 'Minimal FPS impact, better visuals' },
        { name: 'Material Quality', value: 'Medium', description: 'Balanced performance and quality' },
        { name: 'Detail Quality', value: 'Low', description: 'Maximizes FPS, reduces visual clutter' },
        { name: 'UI Quality', value: 'Low', description: 'No gameplay impact' },
        { name: 'Anisotropic Filtering', value: '2x', description: 'Slight quality boost, minimal cost' },
        { name: 'Anti-Aliasing', value: 'MSAA 2x', description: 'Smooth edges without heavy FPS drop' },
        { name: 'V-Sync', value: 'Off', description: 'Eliminates input lag' },
        { name: 'FPS Limit', value: 'Uncapped', description: 'Maximum responsiveness' }
      ]
    },
    launch: {
      title: 'Launch Options',
      options: [
        { flag: '-novid', description: 'Skip intro videos for faster startup', impact: 'High' },
        { flag: '-high', description: 'Set process priority to high', impact: 'Medium' },
        { flag: '-threads [CPU_CORES]', description: 'Optimize for multi-core CPUs', impact: 'Medium' }
      ]
    },
    performance: {
      title: 'System Optimizations',
      tweaks: [
        { name: 'Game Mode', value: 'Enabled', benefit: 'Windows prioritizes game resources' },
        { name: 'Hardware Acceleration', value: 'Disabled in Discord', benefit: 'Frees up GPU resources' },
        { name: 'Background Apps', value: 'Minimized', benefit: 'More CPU/RAM for game' },
        { name: 'NVIDIA Reflex', value: 'Enabled + Boost', benefit: 'Lowest possible input lag' }
      ]
    }
  },
  'cs2': {
    graphics: {
      title: 'Optimal Graphics Settings',
      settings: [
        { name: 'Display Mode', value: 'Fullscreen', description: 'Lowest input lag' },
        { name: 'Resolution', value: '1280x960 (4:3 Stretched)', description: 'Competitive advantage, bigger targets' },
        { name: 'Global Shadow Quality', value: 'Low', description: 'See enemies in shadows better' },
        { name: 'Model / Texture Detail', value: 'Low', description: 'Maximum FPS' },
        { name: 'Effect Detail', value: 'Low', description: 'Less visual clutter' },
        { name: 'Shader Detail', value: 'Low', description: 'Performance boost' },
        { name: 'Multisampling Anti-Aliasing', value: '2x MSAA', description: 'Balance between clarity and FPS' },
        { name: 'FXAA Anti-Aliasing', value: 'Disabled', description: 'Can blur visuals' },
        { name: 'Vertical Sync', value: 'Disabled', description: 'No input lag' },
        { name: 'FPS Max', value: '0 (Unlimited)', description: 'Maximum performance' }
      ]
    },
    launch: {
      title: 'Launch Options',
      options: [
        { flag: '-novid -nojoy', description: 'Skip intro, disable joystick support', impact: 'High' },
        { flag: '-high', description: 'CPU priority boost', impact: 'High' },
        { flag: '+fps_max 0', description: 'Uncapped framerate', impact: 'High' },
        { flag: '-freq 240', description: 'Force 240Hz refresh rate', impact: 'Medium' },
        { flag: '+cl_forcepreload 1', description: 'Preload map assets', impact: 'Medium' }
      ]
    },
    performance: {
      title: 'System Optimizations',
      tweaks: [
        { name: 'NVIDIA Low Latency', value: 'Ultra', benefit: 'Minimizes render lag' },
        { name: 'Shader Cache', value: 'Enabled', benefit: 'Faster asset loading' },
        { name: 'Power Plan', value: 'High Performance', benefit: 'No CPU throttling' },
        { name: 'GPU Scaling', value: 'Disabled', benefit: 'Lower latency' }
      ]
    }
  },
  'apex-legends': {
    graphics: {
      title: 'Optimal Graphics Settings',
      settings: [
        { name: 'Display Mode', value: 'Fullscreen', description: 'Best performance' },
        { name: 'Aspect Ratio', value: '16:10', description: 'Optimal visibility' },
        { name: 'Resolution', value: '1728x1080 (Stretched)', description: 'Custom Nvidia resolution' },
        { name: 'FOV', value: '110', description: 'Maximum field of view' },
        { name: 'V-Sync', value: 'Disabled', description: 'Eliminates input lag' },
        { name: 'Adaptive Resolution FPS Target', value: '0', description: 'Prevents dynamic resolution' },
        { name: 'Anti-Aliasing', value: 'None', description: 'Maximum FPS' },
        { name: 'Texture Streaming Budget', value: 'Low', description: 'Adjust based on VRAM' },
        { name: 'Texture Filtering', value: 'Bilinear', description: 'Performance optimization' },
        { name: 'Ambient Occlusion Quality', value: 'Disabled', description: 'FPS boost' },
        { name: 'Sun Shadow Coverage', value: 'Low', description: 'See enemies better' },
        { name: 'Sun Shadow Detail', value: 'Low', description: 'Performance gain' },
        { name: 'Spot Shadow Detail', value: 'Disabled', description: 'Significant FPS boost' },
        { name: 'Volumetric Lighting', value: 'Disabled', description: 'Heavy FPS cost' },
        { name: 'Dynamic Spot Shadows', value: 'Disabled', description: 'Performance gain' },
        { name: 'Model Detail', value: 'Low', description: 'Maximum performance' },
        { name: 'Map Detail', value: 'Low', description: 'Performance boost' },
        { name: 'Effects Detail', value: 'Low', description: 'Less distracting effects' },
        { name: 'Impact Marks', value: 'Disabled', description: 'Additional performance' }
      ]
    },
    launch: {
      title: 'Launch Options',
      options: [
        { flag: '+lobby_max_fps 0', description: 'Uncaps FPS in lobby for smoother experience', impact: 'High' },
        { flag: '+fps_max 0', description: 'Uncaps FPS for unlimited frame rates', impact: 'High' },
        { flag: '-dev', description: 'Skips intro videos and enables developer startup mode', impact: 'High' },
        { flag: '-no_render_on_input_thread', description: 'Essential for high-polling mice to prevent stuttering', impact: 'High' }
      ]
    },
    performance: {
      title: 'System Optimizations',
      tweaks: [
        { name: 'Adaptive Resolution FPS Target', value: '0 (Disabled)', benefit: 'Prevents dynamic resolution' },
        { name: 'NVIDIA Reflex', value: 'Enabled', benefit: 'Lower system latency' },
        { name: 'Spot Shadow Detail', value: 'Off', benefit: 'Significant FPS boost' },
        { name: 'Ragdolls', value: 'Low', benefit: 'Performance improvement' }
      ]
    }
  }
};

const games: Game[] = [
  {
    id: 'apex-legends',
    title: 'Apex Legends',
    description: 'Fast-paced battle royale',
    category: 'Shooter',
    image: apexImg,
    platform: ['Windows', 'Cross-platform'],
    recommended: gameOptimizations['apex-legends']
  },
  {
    id: 'valorant',
    title: 'Valorant',
    description: 'Tactical 5v5 character-based FPS',
    category: 'Shooter',
    image: valorantImg,
    platform: ['Windows'],
    recommended: gameOptimizations['valorant']
  },
  {
    id: 'rocket-league',
    title: 'Rocket League',
    description: 'Competitive vehicular soccer',
    category: 'Sports',
    image: rocketLeagueImg,
    platform: ['Windows', 'Cross-platform'],
    recommended: gameOptimizations['valorant'] // Placeholder
  },
  {
    id: 'overwatch',
    title: 'Overwatch 2',
    description: 'Team-based hero shooter',
    category: 'Shooter',
    image: overwatchImg,
    platform: ['Windows'],
    recommended: gameOptimizations['valorant'] // Placeholder
  },
  {
    id: 'league-of-legends',
    title: 'League of Legends',
    description: 'Competitive MOBA arena',
    category: 'MOBA',
    image: lolImg,
    platform: ['Windows'],
    recommended: gameOptimizations['valorant'] // Placeholder
  },
  {
    id: 'fortnite',
    title: 'Fortnite',
    description: 'Battle royale with building',
    category: 'Battle Royale',
    image: fortniteImg,
    platform: ['Windows', 'Cross-platform'],
    recommended: gameOptimizations['valorant'] // Placeholder
  },
  {
    id: 'cs2',
    title: 'Counter-Strike 2',
    description: 'Legendary tactical FPS',
    category: 'Shooter',
    image: cs2Img,
    platform: ['Windows'],
    recommended: gameOptimizations['cs2']
  },
  {
    id: 'cod',
    title: 'Call of Duty',
    description: 'Modern warfare action FPS',
    category: 'Shooter',
    image: codImg,
    platform: ['Windows'],
    recommended: gameOptimizations['valorant'] // Placeholder
  }
];

interface GameLibraryProps {
  hardwareInfo?: HardwareInfo;
  isActive?: boolean;
}

const GameLibrary: React.FC<GameLibraryProps> = ({ hardwareInfo, isActive }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [showCommandsModal, setShowCommandsModal] = useState(false);
  const [cmdFilter, setCmdFilter] = useState('');
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'launch' | 'profile'>('profile');

  const IS_VIDEO_COMING_SOON = true; // LOCK / UNLOCK VIDEO SETTINGS PAGE

  // Game Profile state
  const [profileSettings, setProfileSettings] = useState<Record<string, string>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileModified, setProfileModified] = useState<Record<string, string>>({});
  const [profileKeyOrder, setProfileKeyOrder] = useState<string[]>([]);
  const [profileIsReadOnly, setProfileIsReadOnly] = useState(false);
  const [profileInnerTab, setProfileInnerTab] = useState<'video' | 'config'>('config');
  const [profileLockBusy, setProfileLockBusy] = useState(false);
  const [roFlash, setRoFlash] = useState(false);
  const [systemResolutions, setSystemResolutions] = useState<{ w: number; h: number }[]>([]);
  const [activePlayerConfig, setActivePlayerConfig] = useState<string | null>(null);
  const [proPlayers, setProPlayers] = useState<ProPlayerEntry[]>([]);
  const [playerConfigLoading, setPlayerConfigLoading] = useState<string | null>(null);

  // Fetch system display resolutions (includes NVIDIA/AMD custom resolutions)
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    window.electron.ipcRenderer.invoke('system:get-display-resolutions').then((res: any) => {
      if (res?.success && res.resolutions) setSystemResolutions(res.resolutions);
    }).catch(() => { });
  }, []);

  // Load pro player list from V-Config folder
  useEffect(() => {
    if (!selectedGame || !window.electron?.ipcRenderer) { setProPlayers([]); return; }
    window.electron.ipcRenderer.invoke('vconfig:list-players', selectedGame.id).then((res: any) => {
      if (res?.success) setProPlayers(res.players);
      else setProPlayers([]);
    }).catch(() => setProPlayers([]));
  }, [selectedGame]);

  // Merge system resolutions into aspect ratio groups
  const mergedAspectResolutions = useMemo(() => {
    const merged: Record<string, ResolutionEntry[]> = {};
    for (const [aspect, list] of Object.entries(ASPECT_RESOLUTIONS)) {
      merged[aspect] = [...list];
    }
    for (const { w, h } of systemResolutions) {
      if (w < 800 || h < 600) continue;
      const alreadyKnown = Object.values(merged).some(list => list.some(r => r.w === w && r.h === h));
      if (alreadyKnown) continue;
      const aspect = classifyAspectRatio(w, h);
      if (!merged[aspect]) merged[aspect] = [];
      merged[aspect].push({ w, h, label: `${w}x${h}` });
    }
    // Sort each group by total pixels
    for (const list of Object.values(merged)) {
      list.sort((a, b) => (a.w * a.h) - (b.w * b.h));
    }
    return merged;
  }, [systemResolutions]);

  // Reset to grid view when navigating away from the page
  useEffect(() => {
    if (isActive === false) {
      setSelectedGame(null);
      setShowCommandsModal(false);
      setShowSpecsModal(false);
    }
  }, [isActive]);

  // Load game profile when switching to profile tab
  const loadProfile = useCallback(async (gameId: string) => {
    if (!window.electron?.ipcRenderer) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res: any = await window.electron.ipcRenderer.invoke('gameprofile:read-config', gameId);
      if (res?.success) {
        setProfileSettings(res.settings);
        setProfileModified({});
        setProfileDirty(false);
        setProfileKeyOrder(res.keyOrder || Object.keys(res.settings));
        setProfileIsReadOnly(res.isReadOnly ?? false);
        setActivePlayerConfig(null);
      } else {
        setProfileError(res?.message || 'Failed to read config.');
        setProfileSettings({});
      }
    } catch { setProfileError('Failed to communicate with the app.'); }
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    if (selectedGame && SUPPORTED_PROFILE_GAMES.includes(selectedGame.id)) {
      loadProfile(selectedGame.id);
    }
  }, [selectedGame, loadProfile]);

  const handleProfileChange = useCallback((key: string, value: string) => {
    setProfileModified(prev => ({ ...prev, [key]: value }));
    setProfileDirty(true);
  }, []);

  const handleProfileSave = useCallback(async () => {
    if (!selectedGame || !window.electron?.ipcRenderer) return;
    setProfileSaving(true);
    try {
      const res: any = await window.electron.ipcRenderer.invoke('gameprofile:write-config', selectedGame.id, profileModified);
      if (res?.success) {
        setProfileSettings(prev => ({ ...prev, ...profileModified }));
        setProfileModified({});
        setProfileDirty(false);
        setActivePlayerConfig(null);
      } else {
        setProfileError(res?.message || 'Failed to save.');
      }
    } catch { setProfileError('Failed to save settings.'); }
    setProfileSaving(false);
  }, [selectedGame, profileModified]);

  const handleProfileReset = useCallback(async () => {
    if (!selectedGame || !window.electron?.ipcRenderer) return;
    setProfileSaving(true);
    try {
      const res: any = await window.electron.ipcRenderer.invoke('gameprofile:restore-backup', selectedGame.id);
      if (res?.success) {
        await loadProfile(selectedGame.id);
      } else {
        setProfileError(res?.message || 'No backup available.');
      }
    } catch { setProfileError('Failed to restore backup.'); }
    setProfileSaving(false);
  }, [selectedGame, loadProfile]);

  const getEffectiveValue = useCallback((key: string) => {
    return profileModified[key] ?? profileSettings[key] ?? '';
  }, [profileModified, profileSettings]);

  const handleToggleReadOnly = useCallback(async (lock: boolean) => {
    if (!selectedGame || !window.electron?.ipcRenderer) return;
    setProfileLockBusy(true);
    try {
      const res: any = await window.electron.ipcRenderer.invoke('gameprofile:set-readonly', selectedGame.id, lock);
      if (res?.success) {
        setProfileIsReadOnly(res.isReadOnly);
        setRoFlash(true);
        setTimeout(() => setRoFlash(false), 800);
      } else {
        setProfileError(res?.message || 'Failed to change file attribute.');
      }
    } catch { setProfileError('Failed to change file attribute.'); }
    setProfileLockBusy(false);
  }, [selectedGame]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(games.map(game => game.category)))], []);

  const filteredGames = useMemo(() => {
    return games.filter(game => {
      const matchesSearch = game.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        game.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || game.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory]);

  const handleGameClick = useCallback((game: Game) => {
    setSelectedGame(game);
  }, []);

  const handleCopySettings = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  // Hardware comparison for selected game
  const comparisonResult: ComparisonResult | null = useMemo(() => {
    if (!selectedGame || !hardwareInfo) return null;
    const req = GAME_REQUIREMENTS[selectedGame.id];
    if (!req) return null;
    return compareHardware(hardwareInfo, req);
  }, [selectedGame, hardwareInfo]);

  // Pre-compute benchmark modal data so the IIFE doesn't run on every render
  const benchData = useMemo(() => {
    if (!comparisonResult || !selectedGame) return null;
    const req = GAME_REQUIREMENTS[selectedGame.id];
    if (!req) return null;
    const rows: { label: string; iconName: 'cpu' | 'monitor' | 'hdd'; result: import('../utils/hardwareCompare').ComponentResult; minSpec: string; recSpec: string }[] = [
      { label: 'CPU', iconName: 'cpu', result: comparisonResult.cpu, minSpec: req.minimum.cpu, recSpec: req.recommended.cpu },
      { label: 'GPU', iconName: 'monitor', result: comparisonResult.gpu, minSpec: req.minimum.gpu, recSpec: req.recommended.gpu },
      { label: 'RAM', iconName: 'hdd', result: comparisonResult.ram, minSpec: `${req.minimum.ramGB} GB`, recSpec: `${req.recommended.ramGB} GB` },
      { label: 'Storage', iconName: 'hdd', result: comparisonResult.storage, minSpec: `${req.minimum.storageGB} GB`, recSpec: `${req.recommended.storageGB} GB` },
    ];
    if (comparisonResult.vram) {
      rows.splice(2, 0, {
        label: 'VRAM', iconName: 'monitor', result: comparisonResult.vram!,
        minSpec: `${req.minimum.vramGB || 0} GB`, recSpec: `${req.recommended.vramGB || 0} GB`,
      });
    }
    const fps = predictFps(comparisonResult, req);
    const verdict = comparisonResult.overall;
    const cap = Math.max(fps.yours.low, 300);
    const verdictLabel = verdict === 'exceeds' ? 'Exceeds' : verdict === 'meets-recommended' ? 'Recommended' : verdict === 'meets-minimum' ? 'Minimum' : 'Below';
    const verdictSub = verdict === 'exceeds' ? 'Your PC exceeds all recommended specs.' : verdict === 'meets-recommended' ? 'Meets recommended requirements.' : verdict === 'meets-minimum' ? 'Meets minimum specs only.' : 'Does not meet minimum specs.';
    const passCount = rows.filter(r => r.result.verdict === 'exceeds' || r.result.verdict === 'meets').length;
    const ringPct = Math.round((passCount / rows.length) * 100);
    return { rows, fps, verdict, cap, verdictLabel, verdictSub, ringPct };
  }, [comparisonResult, selectedGame]);

  // Quick verdicts for all games (card rings)
  const gameVerdicts = useMemo(() => {
    const map: Record<string, OverallVerdict | 'unknown'> = {};
    for (const g of games) {
      map[g.id] = quickVerdict(hardwareInfo, GAME_REQUIREMENTS[g.id]);
    }
    return map;
  }, [hardwareInfo]);

  return (
    <div className="gl-container">
      <PageHeader icon={<Gamepad2 size={16} />} title="Game Presets" />
      <ProPreviewBanner pageName="Game Presets" />
      <ProLockedWrapper featureName="Game Presets" message="PRO Feature">
      <AnimatePresence mode="wait">
        {!selectedGame ? (
          <motion.div
            key="library"
            className="gl-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* ── Controls ── */}
            <div className="gl-controls">
              <div className="gl-search">
                <Search className="gl-search__icon" size={16} />
                <input
                  type="text"
                  className="gl-search__input"
                  placeholder="Search games..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button className="gl-search__clear" onClick={() => setSearchTerm('')}>
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="gl-filters">
                {categories.map(cat => (
                  <button
                    key={cat}
                    className={`gl-filter ${selectedCategory === cat ? 'gl-filter--active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Game Grid ── */}
            <div className="gl-grid">
              {filteredGames.map((game, index) => {
                const isLocked = game.id !== 'apex-legends';
                return (
                  <div
                    key={game.id}
                    className={`gl-card ${isLocked ? 'gl-card--locked' : ''}`}
                    style={{ '--card-i': index } as React.CSSProperties}
                    onClick={() => !isLocked && handleGameClick(game)}
                  >
                    {/* Top accent bar */}
                    <div className="gl-card-accent" />
                    <div className="gl-card__img-wrap">
                      <img src={game.image} alt={game.title} className="gl-card__img" loading="lazy" />
                      <div className="gl-card__hover-overlay" />
                      <div className="gl-card__corner gl-card__corner--tl" />
                      <div className="gl-card__corner gl-card__corner--tr" />
                      <div className="gl-card__corner gl-card__corner--bl" />
                      <div className="gl-card__corner gl-card__corner--br" />
                      {isLocked && (
                        <div className="gl-card__lock-overlay">
                          <Lock size={22} />
                          <span>Coming Soon</span>
                        </div>
                      )}
                      {/* Compatibility ring */}
                      {!isLocked && gameVerdicts[game.id] !== 'unknown' && (
                        <span className={`gl-card__compat gl-card__compat--${gameVerdicts[game.id]}`} title={
                          gameVerdicts[game.id] === 'exceeds' ? 'Exceeds recommended specs' :
                            gameVerdicts[game.id] === 'meets-recommended' ? 'Meets recommended specs' :
                              gameVerdicts[game.id] === 'meets-minimum' ? 'Meets minimum specs' :
                                'Below minimum specs'
                        } />
                      )}
                    </div>

                    <div className="gl-card__body">
                      <h3 className="gl-card__title">{game.title}</h3>
                      <p className="gl-card__desc">{game.description}</p>
                      <div className="gl-card__meta">
                        <span className="gl-card__badge">{game.category}</span>
                        {!isLocked && <span className="gl-card__count">{game.recommended.graphics.settings.length} tweaks</span>}
                      </div>
                    </div>
                    <div className="gl-card__glow" />
                  </div>
                );
              })}
            </div>

            {filteredGames.length === 0 && (
              <div className="gl-empty">
                <Search size={40} />
                <p>No games matched your search</p>
              </div>
            )}
          </motion.div>
        ) : (
          /* ── Game Detail Dashboard ── */
          <motion.div
            key="dashboard"
            className="gl-dash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Hero Banner Header */}
            <div className="gl-dash__header">
              <div className="gl-dash__header-bg">
                <img src={selectedGame.image} alt="" className="gl-dash__header-bg-img" />
                <div className="gl-dash__header-gradient" />
              </div>

              {/* Main header row */}
              <div className="gl-dash__main-row">
                {/* Left: accent + info */}
                <div className="gl-dash__left">
                  <button className="gl-dash__back" onClick={() => setSelectedGame(null)}>
                    <ArrowLeft size={14} />
                    <span>Library</span>
                  </button>
                  <div className="gl-dash__identity">
                    <div className="gl-dash__accent" />
                    <div className="gl-dash__meta">
                      <div className="gl-dash__title-line">
                        <h2 className="gl-dash__title">{selectedGame.title}</h2>
                        <span className="gl-dash__category">{selectedGame.category}</span>
                      </div>
                      <p className="gl-dash__desc">{selectedGame.description}</p>
                    </div>
                  </div>
                </div>

                {/* Right: benchmark */}
                <div className="gl-dash__right">
                  <div className="gl-dash__right-btns">
                    {selectedGame.id === 'apex-legends' && (
                      <button className="gl-test-specs-btn gl-test-specs-btn--commands" onClick={() => setShowCommandsModal(true)}>
                        <div className="gl-btn__wrap">
                          <div className="gl-btn__reflex"></div>
                          <div className="gl-btn__content">
                            <span className="gl-btn__text">
                              {'COMMANDS'.split('').map((ch, i) => (
                                <span key={i} style={{ '--i': i + 1 } as React.CSSProperties} data-label={ch}>
                                  {ch}
                                </span>
                              ))}
                            </span>
                          </div>
                        </div>
                        <div className="gl-btn__gears-clip">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 635 523">
                            <defs>
                              <filter id="gearFilterCmd">
                                <feGaussianBlur result="blur" stdDeviation="5" in="SourceGraphic" />
                                <feColorMatrix result="goo" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" type="matrix" in="blur" />
                                <feBlend in2="goo" in="SourceGraphic" />
                              </filter>
                            </defs>
                            <g filter="url(#gearFilterCmd)">
                              <path className="gl-gear-lg gl-gear-shadow" d="M635 192V171L606 167C605 157 603 148 600 139L625 125L617 106L589 113C584 105 579 97 573 89L592 66L577 51L554 68C547 62 539 57 530 52L537 24L518 16L504 41C495 38 486 36 476 35L472 8H451L447 37C437 38 428 40 419 43L405 18L386 26L393 54C385 59 377 64 369 70L346 53L331 66L348 89C342 96 337 104 332 113L304 106L296 125L321 139C318 148 316 157 315 167L286 171V192L315 196C316 206 318 215 321 224L296 238L304 257L332 250C337 258 342 266 348 274L331 297L346 312L369 295C376 301 384 306 393 311L386 339L405 347L419 322C428 325 437 327 447 328L451 357H472L476 328C486 327 495 325 504 322L518 347L537 339L530 311C538 306 546 301 554 295L577 312L592 297L575 274C581 267 586 259 591 250L619 257L627 238L602 224C605 215 607 206 608 196L635 192ZM461 292C400 292 351 243 351 182C351 121 401 72 461 72C521 72 571 121 571 182C571 243 522 292 461 292Z" />
                              <path className="gl-gear-md gl-gear-shadow" d="M392 398V377L364 373C363 363 360 354 357 345L380 328L369 310L342 321C336 313 329 307 322 301L333 275L315 264L298 287C289 283 280 281 270 280L266 252H245L241 280C231 281 222 284 213 287L196 264L178 275L189 301C181 307 175 314 169 321L143 310L132 328L155 345C151 354 149 363 148 373L120 377V398L148 402C149 412 152 421 155 430L132 447L143 465L169 454C175 462 182 468 189 474L178 500L196 511L213 488C222 492 231 494 241 495L245 523H266L270 495C280 494 289 491 298 488L315 511L333 500L322 474C330 468 336 461 342 454L368 465L379 447L356 430C360 421 362 412 363 402L392 398ZM255 461C214 461 181 428 181 387C181 346 214 313 255 313C296 313 329 346 329 387C328 428 295 461 255 461Z" />
                              <path className="gl-gear-sm gl-gear-shadow" d="M200 244V223L171 219C169 209 165 201 160 193L178 170L163 155L140 173C132 168 123 164 114 162L110 133H90L86 162C76 164 68 168 60 173L37 155L22 170L40 193C35 201 31 210 29 219L0 223V244L29 248C31 258 35 266 40 274L22 297L37 312L60 294C68 299 77 303 86 305L90 334H111L115 305C125 303 133 299 141 294L164 312L179 297L161 274C166 266 170 257 172 248L200 244ZM100 270C80 270 63 253 63 233C63 213 80 196 100 196C120 196 137 213 137 233C137 253 121 270 100 270Z" />
                              <path className="gl-gear-lg" d="M635 184V163L606 159C605 149 603 140 600 131L625 117L617 98L589 105C584 97 579 89 573 81L592 58L577 43L554 60C547 54 539 49 530 44L537 16L518 8L504 33C495 30 486 28 476 27L472 0H451L447 29C437 30 428 32 419 35L405 9L386 17L393 45C385 50 377 55 369 61L346 44L331 58L348 81C342 88 337 96 332 105L304 98L296 117L321 131C318 140 316 149 315 159L286 163V184L315 188C316 198 318 207 321 216L296 230L304 249L332 242C337 250 342 258 348 266L331 289L346 304L369 287C376 293 384 298 393 303L386 331L405 339L419 314C428 317 437 319 447 320L451 349H472L476 320C486 319 495 317 504 314L518 339L537 331L530 303C538 298 546 293 554 287L577 304L592 289L575 266C581 259 586 251 591 242L619 249L627 230L602 216C605 207 607 198 608 188L635 184ZM461 284C400 284 351 235 351 174C351 113 401 64 461 64C521 64 571 113 571 174C571 235 522 284 461 284Z" />
                              <path className="gl-gear-md" d="M392 390V369L364 365C363 355 360 346 357 337L380 320L369 302L342 313C336 305 329 299 322 293L333 267L315 256L298 279C289 275 280 273 270 272L266 244H245L241 272C231 273 222 276 213 279L196 256L178 267L189 293C181 299 175 306 169 313L143 302L132 320L155 337C151 346 149 355 148 365L120 369V390L148 394C149 404 152 413 155 422L132 439L143 457L169 446C175 454 182 460 189 466L178 492L196 503L213 480C222 484 231 486 241 487L245 515H266L270 487C280 486 289 483 298 480L315 503L333 492L322 466C330 460 336 453 342 446L368 457L379 439L356 422C360 413 362 404 363 394L392 390ZM255 453C214 453 181 420 181 379C181 338 214 305 255 305C296 305 329 338 329 379C328 420 295 453 255 453Z" />
                              <path className="gl-gear-sm" d="M200 236V215L171 211C169 201 165 193 160 185L178 162L163 147L140 165C132 160 123 156 114 154L110 125H90L86 154C76 156 68 160 60 165L37 147L22 162L40 185C35 193 31 202 29 211L0 215V236L29 240C31 250 35 258 40 266L22 289L37 304L60 286C68 291 77 295 86 297L90 326H111L115 297C125 295 133 291 141 286L164 304L179 289L161 266C166 258 170 249 172 240L200 236ZM100 262C80 262 63 245 63 225C63 205 80 188 100 188C120 188 137 205 137 225C137 245 121 262 100 262Z" />
                            </g>
                          </svg>
                        </div>
                      </button>
                    )}
                  <button className="gl-test-specs-btn" onClick={() => setShowSpecsModal(true)}>
                    <div className="gl-btn__wrap">
                      <div className="gl-btn__reflex"></div>
                      <div className="gl-btn__content">
                        <span className="gl-btn__text">
                          {'GAME BENCHMARK'.split('').map((ch, i) => (
                            <span key={i} style={{ '--i': i + 1 } as React.CSSProperties} data-label={ch === ' ' ? '\u00A0' : ch}>
                              {ch === ' ' ? '\u00A0' : ch}
                            </span>
                          ))}
                        </span>
                      </div>
                    </div>
                    <div className="gl-btn__gears-clip">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 635 523">
                        <defs>
                          <filter id="gearFilter">
                            <feGaussianBlur result="blur" stdDeviation="5" in="SourceGraphic" />
                            <feColorMatrix result="goo" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" type="matrix" in="blur" />
                            <feBlend in2="goo" in="SourceGraphic" />
                          </filter>
                        </defs>
                        <g filter="url(#gearFilter)">
                          <path className="gl-gear-lg gl-gear-shadow" d="M635 192V171L606 167C605 157 603 148 600 139L625 125L617 106L589 113C584 105 579 97 573 89L592 66L577 51L554 68C547 62 539 57 530 52L537 24L518 16L504 41C495 38 486 36 476 35L472 8H451L447 37C437 38 428 40 419 43L405 18L386 26L393 54C385 59 377 64 369 70L346 53L331 66L348 89C342 96 337 104 332 113L304 106L296 125L321 139C318 148 316 157 315 167L286 171V192L315 196C316 206 318 215 321 224L296 238L304 257L332 250C337 258 342 266 348 274L331 297L346 312L369 295C376 301 384 306 393 311L386 339L405 347L419 322C428 325 437 327 447 328L451 357H472L476 328C486 327 495 325 504 322L518 347L537 339L530 311C538 306 546 301 554 295L577 312L592 297L575 274C581 267 586 259 591 250L619 257L627 238L602 224C605 215 607 206 608 196L635 192ZM461 292C400 292 351 243 351 182C351 121 401 72 461 72C521 72 571 121 571 182C571 243 522 292 461 292Z" />
                          <path className="gl-gear-md gl-gear-shadow" d="M392 398V377L364 373C363 363 360 354 357 345L380 328L369 310L342 321C336 313 329 307 322 301L333 275L315 264L298 287C289 283 280 281 270 280L266 252H245L241 280C231 281 222 284 213 287L196 264L178 275L189 301C181 307 175 314 169 321L143 310L132 328L155 345C151 354 149 363 148 373L120 377V398L148 402C149 412 152 421 155 430L132 447L143 465L169 454C175 462 182 468 189 474L178 500L196 511L213 488C222 492 231 494 241 495L245 523H266L270 495C280 494 289 491 298 488L315 511L333 500L322 474C330 468 336 461 342 454L368 465L379 447L356 430C360 421 362 412 363 402L392 398ZM255 461C214 461 181 428 181 387C181 346 214 313 255 313C296 313 329 346 329 387C328 428 295 461 255 461Z" />
                          <path className="gl-gear-sm gl-gear-shadow" d="M200 244V223L171 219C169 209 165 201 160 193L178 170L163 155L140 173C132 168 123 164 114 162L110 133H90L86 162C76 164 68 168 60 173L37 155L22 170L40 193C35 201 31 210 29 219L0 223V244L29 248C31 258 35 266 40 274L22 297L37 312L60 294C68 299 77 303 86 305L90 334H111L115 305C125 303 133 299 141 294L164 312L179 297L161 274C166 266 170 257 172 248L200 244ZM100 270C80 270 63 253 63 233C63 213 80 196 100 196C120 196 137 213 137 233C137 253 121 270 100 270Z" />
                          <path className="gl-gear-lg" d="M635 184V163L606 159C605 149 603 140 600 131L625 117L617 98L589 105C584 97 579 89 573 81L592 58L577 43L554 60C547 54 539 49 530 44L537 16L518 8L504 33C495 30 486 28 476 27L472 0H451L447 29C437 30 428 32 419 35L405 9L386 17L393 45C385 50 377 55 369 61L346 44L331 58L348 81C342 88 337 96 332 105L304 98L296 117L321 131C318 140 316 149 315 159L286 163V184L315 188C316 198 318 207 321 216L296 230L304 249L332 242C337 250 342 258 348 266L331 289L346 304L369 287C376 293 384 298 393 303L386 331L405 339L419 314C428 317 437 319 447 320L451 349H472L476 320C486 319 495 317 504 314L518 339L537 331L530 303C538 298 546 293 554 287L577 304L592 289L575 266C581 259 586 251 591 242L619 249L627 230L602 216C605 207 607 198 608 188L635 184ZM461 284C400 284 351 235 351 174C351 113 401 64 461 64C521 64 571 113 571 174C571 235 522 284 461 284Z" />
                          <path className="gl-gear-md" d="M392 390V369L364 365C363 355 360 346 357 337L380 320L369 302L342 313C336 305 329 299 322 293L333 267L315 256L298 279C289 275 280 273 270 272L266 244H245L241 272C231 273 222 276 213 279L196 256L178 267L189 293C181 299 175 306 169 313L143 302L132 320L155 337C151 346 149 355 148 365L120 369V390L148 394C149 404 152 413 155 422L132 439L143 457L169 446C175 454 182 460 189 466L178 492L196 503L213 480C222 484 231 486 241 487L245 515H266L270 487C280 486 289 483 298 480L315 503L333 492L322 466C330 460 336 453 342 446L368 457L379 439L356 422C360 413 362 404 363 394L392 390ZM255 453C214 453 181 420 181 379C181 338 214 305 255 305C296 305 329 338 329 379C328 420 295 453 255 453Z" />
                          <path className="gl-gear-sm" d="M200 236V215L171 211C169 201 165 193 160 185L178 162L163 147L140 165C132 160 123 156 114 154L110 125H90L86 154C76 156 68 160 60 165L37 147L22 162L40 185C35 193 31 202 29 211L0 215V236L29 240C31 250 35 258 40 266L22 289L37 304L60 286C68 291 77 295 86 297L90 326H111L115 297C125 295 133 291 141 286L164 304L179 289L161 266C166 258 170 249 172 240L200 236ZM100 262C80 262 63 245 63 225C63 205 80 188 100 188C120 188 137 205 137 225C137 245 121 262 100 262Z" />
                        </g>
                      </svg>
                    </div>
                  </button>
                  </div>
                </div>
              </div>

            </div>

            {/* Tab Content */}
            <div className="gl-tab-content">
              <AnimatePresence mode="wait">
                {selectedGame && (() => {
                  const knownKeys = new Set((GAME_PROFILE_SETTINGS[selectedGame.id] || []).map(d => d.key));
                  const labelMap = selectedGame.id === 'apex-legends' ? APEX_SETTING_LABELS : {};
                  return (
                    <motion.div key="profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                      {profileLoading ? (
                        <div className="gl-empty gl-empty--sm">
                          <RefreshCw size={28} className="gl-spin" />
                          <p>Reading game settings...</p>
                        </div>
                      ) : profileError && Object.keys(profileSettings).length === 0 ? (
                        <div className="gl-empty gl-empty--sm">
                          <AlertTriangle size={28} />
                          <p>{profileError}</p>
                          <button className="gl-cmd-btn gl-cmd-btn--copy" onClick={() => loadProfile(selectedGame.id)}>
                            <RefreshCw size={14} /> Retry
                          </button>
                        </div>
                      ) : (
                        <div className="gl-profile">
                          {profileError && (
                            <div className="gl-profile__error">
                              <AlertTriangle size={14} /> {profileError}
                            </div>
                          )}

                          {/* 2-column layout: settings left, presets right */}
                          <div className="gl-profile__columns">
                            {/* Left column: Video Settings + Videoconfig */}
                            <div className="gl-profile__col-left">
                              <div className={`gl-profile__section ${profileInnerTab === 'video' && IS_VIDEO_COMING_SOON ? 'gl-profile__section--locked' : ''}`}>
                                {profileInnerTab === 'video' && IS_VIDEO_COMING_SOON && (
                                  <div className="gl-profile__lock-overlay">
                                    <Lock size={22} />
                                    <span>Coming Soon</span>
                                  </div>
                                )}
                                <div className="gl-profile__inner-tabs">
                                  <button className={`gl-profile__inner-tab ${profileInnerTab === 'video' ? 'gl-profile__inner-tab--active' : ''}`} onClick={(e) => { setProfileInnerTab('video'); const section = (e.target as HTMLElement).closest('.gl-profile__section'); if (section) section.scrollTop = 0; }}><Monitor size={13} /> Video Settings</button>
                                  <button className={`gl-profile__inner-tab ${profileInnerTab === 'config' ? 'gl-profile__inner-tab--active' : ''}`} onClick={(e) => { setProfileInnerTab('config'); const section = (e.target as HTMLElement).closest('.gl-profile__section'); if (section) section.scrollTop = 0; }}><Eye size={13} /> Videoconfig Settings</button>
                                  <div className={`gl-profile__tab-meta ${roFlash ? 'gl-profile__tab-meta--flash' : ''}`}>
                                    <span className="gl-profile__ro-hint">
                                      {profileIsReadOnly ? 'VideoConfig is set to:' : 'VideoConfig is set to:'}
                                    </span>
                                    <div className={`gl-profile__ro-badge ${profileIsReadOnly ? 'gl-profile__ro-badge--locked' : 'gl-profile__ro-badge--unlocked'}`}>
                                      {profileIsReadOnly ? <Lock size={10} /> : <Unlock size={10} />}
                                      {profileIsReadOnly ? 'Read Only' : 'Writable'}
                                    </div>
                                  </div>
                                </div>
                                {profileInnerTab === 'video' && (
                                  <div className="gl-profile__apex-settings">
                                    {/* Display Mode */}
                                    {(() => {
                                      const fs = getEffectiveValue('setting.fullscreen');
                                      const border = getEffectiveValue('setting.nowindowborder');
                                      const mode = getDisplayMode(fs, border);
                                      const modeIdx = DISPLAY_MODES.findIndex(m => m.value === mode);
                                      const modeLabel = DISPLAY_MODES.find(m => m.value === mode)?.label || mode;
                                      return (
                                        <div className="gl-profile__apex-row">
                                          <span className="gl-profile__apex-label">Display Mode</span>
                                          <div className="gl-profile__apex-control">
                                            <div className="gl-profile__apex-selector">
                                              <button className="gl-profile__apex-nav" onClick={() => {
                                                const prev = DISPLAY_MODES[Math.max(0, modeIdx - 1)];
                                                if (prev.value === 'fullscreen') { handleProfileChange('setting.fullscreen', '1'); handleProfileChange('setting.nowindowborder', '0'); }
                                                else if (prev.value === 'borderless') { handleProfileChange('setting.fullscreen', '0'); handleProfileChange('setting.nowindowborder', '1'); }
                                                else { handleProfileChange('setting.fullscreen', '0'); handleProfileChange('setting.nowindowborder', '0'); }
                                              }}>‹</button>
                                              <div className="gl-profile__apex-selector-center">
                                                <span className="gl-profile__apex-selector-value">{modeLabel}</span>
                                                <div className="gl-profile__apex-selector-track">
                                                  {DISPLAY_MODES.map((_, i) => (
                                                    <span key={i} className={`gl-profile__apex-selector-seg ${i <= modeIdx ? 'gl-profile__apex-selector-seg--filled' : ''}`} />
                                                  ))}
                                                </div>
                                              </div>
                                              <button className="gl-profile__apex-nav" onClick={() => {
                                                const next = DISPLAY_MODES[Math.min(DISPLAY_MODES.length - 1, modeIdx + 1)];
                                                if (next.value === 'fullscreen') { handleProfileChange('setting.fullscreen', '1'); handleProfileChange('setting.nowindowborder', '0'); }
                                                else if (next.value === 'borderless') { handleProfileChange('setting.fullscreen', '0'); handleProfileChange('setting.nowindowborder', '1'); }
                                                else { handleProfileChange('setting.fullscreen', '0'); handleProfileChange('setting.nowindowborder', '0'); }
                                              }}>›</button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {/* Aspect Ratio + Resolution */}
                                    {(() => {
                                      const curW = parseInt(getEffectiveValue('setting.defaultres') || '0', 10);
                                      const curH = parseInt(getEffectiveValue('setting.defaultresheight') || '0', 10);
                                      const detectedAspect = detectAspectRatio(curW, curH, mergedAspectResolutions);
                                      const resolutions = mergedAspectResolutions[detectedAspect] || [];
                                      const isKnown = resolutions.some(r => r.w === curW && r.h === curH);
                                      const displayResolutions = isKnown ? resolutions : [...resolutions, { w: curW, h: curH, label: `${curW}x${curH} (Custom)` }];
                                      const aspectIdx = ASPECT_KEYS.indexOf(detectedAspect);
                                      const resIdx = displayResolutions.findIndex(r => r.w === curW && r.h === curH);
                                      const resLabel = displayResolutions.find(r => r.w === curW && r.h === curH);
                                      return (
                                        <>
                                          <div className="gl-profile__apex-row">
                                            <span className="gl-profile__apex-label">Aspect Ratio</span>
                                            <div className="gl-profile__apex-control">
                                              <div className="gl-profile__apex-selector">
                                                <button className="gl-profile__apex-nav" onClick={() => {
                                                  const newIdx = Math.max(0, aspectIdx - 1);
                                                  const newAspect = ASPECT_KEYS[newIdx];
                                                  const newRes = mergedAspectResolutions[newAspect] || [];
                                                  const last = newRes[newRes.length - 1];
                                                  if (last) { handleProfileChange('setting.defaultres', String(last.w)); handleProfileChange('setting.defaultresheight', String(last.h)); }
                                                }}>‹</button>
                                                <div className="gl-profile__apex-selector-center">
                                                  <span className="gl-profile__apex-selector-value">{detectedAspect}</span>
                                                  <div className="gl-profile__apex-selector-track">
                                                    {ASPECT_KEYS.map((_, i) => (
                                                      <span key={i} className={`gl-profile__apex-selector-seg ${i <= aspectIdx ? 'gl-profile__apex-selector-seg--filled' : ''}`} />
                                                    ))}
                                                  </div>
                                                </div>
                                                <button className="gl-profile__apex-nav" onClick={() => {
                                                  const newIdx = Math.min(ASPECT_KEYS.length - 1, aspectIdx + 1);
                                                  const newAspect = ASPECT_KEYS[newIdx];
                                                  const newRes = mergedAspectResolutions[newAspect] || [];
                                                  const last = newRes[newRes.length - 1];
                                                  if (last) { handleProfileChange('setting.defaultres', String(last.w)); handleProfileChange('setting.defaultresheight', String(last.h)); }
                                                }}>›</button>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="gl-profile__apex-row">
                                            <span className="gl-profile__apex-label">Resolution</span>
                                            <div className="gl-profile__apex-control">
                                              <div className="gl-profile__apex-selector">
                                                <button className="gl-profile__apex-nav" onClick={() => {
                                                  const newIdx = Math.max(0, resIdx - 1);
                                                  const r = displayResolutions[newIdx];
                                                  handleProfileChange('setting.defaultres', String(r.w));
                                                  handleProfileChange('setting.defaultresheight', String(r.h));
                                                }}>‹</button>
                                                <div className="gl-profile__apex-selector-center">
                                                  <span className="gl-profile__apex-selector-value">
                                                    {resLabel ? `${resLabel.label}${resLabel.native ? ' (Native)' : ''}` : `${curW}x${curH}`}
                                                  </span>
                                                  <div className="gl-profile__apex-selector-track">
                                                    {displayResolutions.map((_, i) => (
                                                      <span key={i} className={`gl-profile__apex-selector-seg ${i <= resIdx ? 'gl-profile__apex-selector-seg--filled' : ''}`} />
                                                    ))}
                                                  </div>
                                                </div>
                                                <button className="gl-profile__apex-nav" onClick={() => {
                                                  const newIdx = Math.min(displayResolutions.length - 1, resIdx + 1);
                                                  const r = displayResolutions[newIdx];
                                                  handleProfileChange('setting.defaultres', String(r.w));
                                                  handleProfileChange('setting.defaultresheight', String(r.h));
                                                }}>›</button>
                                              </div>
                                            </div>
                                          </div>
                                        </>
                                      );
                                    })()}

                                    {/* Remaining core settings (Anti-Aliasing, V-Sync, Brightness) */}
                                    {(GAME_PROFILE_SETTINGS[selectedGame.id] || []).filter(s => s.section === 'core' && s.type !== 'resolution' && s.key !== 'setting.fullscreen' && s.key !== 'setting.nowindowborder').map(def => {
                                      const effective = getEffectiveValue(def.key) || (def.options?.length ? def.options[0].value : '');
                                      const current = profileSettings[def.key] ?? '';
                                      const changed = profileModified[def.key] !== undefined && profileModified[def.key] !== current;
                                      return (
                                        <div key={def.key} className={`gl-profile__apex-row ${changed ? 'gl-profile__apex-row--changed' : ''}`}>
                                          <span className="gl-profile__apex-label">{def.label}</span>
                                          <div className="gl-profile__apex-control">
                                            {def.type === 'select' && def.options && (() => {
                                              const idx = def.options.findIndex(o => o.value === effective);
                                              const displayLabel = def.options.find(o => o.value === effective)?.label || effective;
                                              return (
                                                <div className="gl-profile__apex-selector">
                                                  <button className="gl-profile__apex-nav" onClick={() => {
                                                    if (idx > 0) handleProfileChange(def.key, def.options![idx - 1].value);
                                                    else if (idx === -1 && def.options!.length > 0) handleProfileChange(def.key, def.options![0].value);
                                                  }}>‹</button>
                                                  <div className="gl-profile__apex-selector-center">
                                                    <span className="gl-profile__apex-selector-value">{displayLabel}</span>
                                                    <div className="gl-profile__apex-selector-track">
                                                      {def.options!.map((_, i) => (
                                                        <span key={i} className={`gl-profile__apex-selector-seg ${i <= idx ? 'gl-profile__apex-selector-seg--filled' : ''}`} />
                                                      ))}
                                                    </div>
                                                  </div>
                                                  <button className="gl-profile__apex-nav" onClick={() => {
                                                    if (idx < def.options!.length - 1) handleProfileChange(def.key, def.options![idx + 1].value);
                                                    else if (idx === -1 && def.options!.length > 0) handleProfileChange(def.key, def.options![0].value);
                                                  }}>›</button>
                                                </div>
                                              );
                                            })()}
                                            {def.type === 'slider' && (() => {
                                              const rawVal = parseFloat(getEffectiveValue(def.key) || String(def.min || 0));
                                              const isBrightness = def.key === 'setting.gamma';
                                              let sliderMin: number, sliderMax: number, sliderStep: number, sliderVal: number, displayVal: number | string, displayUnit: string, fillPct: number;
                                              if (isBrightness) {
                                                // Gamma is inverted: lower gamma = higher brightness
                                                // gamma 1.75 → 0%, gamma 1.0 → 50%, gamma 0.25 → 100%
                                                sliderMin = 0; sliderMax = 100; sliderStep = 1;
                                                sliderVal = Math.round(Math.max(0, Math.min(100, (1.75 - rawVal) / 1.5 * 100)));
                                                displayVal = sliderVal; displayUnit = '%'; fillPct = sliderVal;
                                              } else {
                                                sliderMin = def.min ?? 0; sliderMax = def.max ?? 100; sliderStep = def.step ?? 1;
                                                sliderVal = rawVal; displayVal = rawVal; displayUnit = def.unit || '';
                                                fillPct = ((rawVal - sliderMin) / (sliderMax - sliderMin)) * 100;
                                              }
                                              return (
                                                <div className="gl-profile__slider-wrap">
                                                  <input type="range" className="gl-profile__slider" min={sliderMin} max={sliderMax} step={sliderStep} value={sliderVal} onChange={e => {
                                                    if (isBrightness) {
                                                      const pct = parseFloat(e.target.value);
                                                      const gamma = 1.75 - (pct / 100) * 1.5;
                                                      handleProfileChange(def.key, gamma.toFixed(6));
                                                    } else {
                                                      handleProfileChange(def.key, e.target.value);
                                                    }
                                                  }} style={{ background: `linear-gradient(to right, rgba(255,255,255,.18) ${fillPct}%, rgba(255,255,255,.06) ${fillPct}%)` }} />
                                                  <span className="gl-profile__slider-value">{displayVal}{displayUnit}</span>
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        </div>
                                      );
                                    })}

                                    {/* Divider */}
                                    <div className="gl-profile__apex-divider">
                                      <span className="gl-profile__apex-divider-label">Advanced</span>
                                    </div>

                                    {/* Advanced video settings */}
                                    {APEX_VIDEO_CONTROLS
                                      .filter(ctrl => !coreKeys.has(ctrl.key) && profileSettings[ctrl.key] !== undefined)
                                      .map(ctrl => {
                                        const effective = getEffectiveValue(ctrl.key);
                                        const current = profileSettings[ctrl.key] ?? '';
                                        const changed = profileModified[ctrl.key] !== undefined && profileModified[ctrl.key] !== current;

                                        return (
                                          <div key={ctrl.key} className={`gl-profile__apex-row ${changed ? 'gl-profile__apex-row--changed' : ''}`}>
                                            <span className="gl-profile__apex-label">{ctrl.label}</span>
                                            <div className="gl-profile__apex-control">
                                              {(ctrl.control === 'toggle' || ctrl.control === 'select') && ctrl.options && (() => {
                                                const matchOpt = (o: { value: string }) => o.value === effective || (effective && !isNaN(Number(o.value)) && !isNaN(Number(effective)) && Number(o.value) === Number(effective));
                                                const idx = ctrl.options.findIndex(matchOpt);
                                                const displayLabel = ctrl.options.find(matchOpt)?.label || effective;
                                                return (
                                                  <div className="gl-profile__apex-selector">
                                                    <button
                                                      className="gl-profile__apex-nav"
                                                      onClick={() => {
                                                        if (idx > 0) handleProfileChange(ctrl.key, ctrl.options![idx - 1].value);
                                                        else if (idx === -1 && ctrl.options!.length > 0) handleProfileChange(ctrl.key, ctrl.options![0].value);
                                                      }}
                                                    >‹</button>
                                                    <div className="gl-profile__apex-selector-center">
                                                      <span className="gl-profile__apex-selector-value">{displayLabel}</span>
                                                      <div className="gl-profile__apex-selector-track">
                                                        {ctrl.options!.map((_, i) => (
                                                          <span key={i} className={`gl-profile__apex-selector-seg ${i <= idx ? 'gl-profile__apex-selector-seg--filled' : ''}`} />
                                                        ))}
                                                      </div>
                                                    </div>
                                                    <button
                                                      className="gl-profile__apex-nav"
                                                      onClick={() => {
                                                        if (idx < ctrl.options!.length - 1) handleProfileChange(ctrl.key, ctrl.options![idx + 1].value);
                                                        else if (idx === -1 && ctrl.options!.length > 0) handleProfileChange(ctrl.key, ctrl.options![0].value);
                                                      }}
                                                    >›</button>
                                                  </div>
                                                );
                                              })()}
                                              {ctrl.control === 'slider' && (() => {
                                                const sMin = ctrl.min ?? 0;
                                                const sMax = ctrl.max ?? 100;
                                                const sVal = parseFloat(effective || String(sMin));
                                                const sFill = ((sVal - sMin) / (sMax - sMin)) * 100;
                                                return (
                                                  <div className="gl-profile__slider-wrap">
                                                    <input
                                                      type="range"
                                                      className="gl-profile__slider"
                                                      min={sMin}
                                                      max={sMax}
                                                      step={ctrl.step ?? 1}
                                                      value={sVal}
                                                      onChange={e => handleProfileChange(ctrl.key, e.target.value)}
                                                      style={{ background: `linear-gradient(to right, rgba(255,255,255,.18) ${sFill}%, rgba(255,255,255,.06) ${sFill}%)` }}
                                                    />
                                                    <span className="gl-profile__slider-value">
                                                      {sVal}{ctrl.unit || ''}
                                                    </span>
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                )}
                                {profileInnerTab === 'config' && (
                                  <div className="gl-profile__all-settings">
                                    <table className="gl-profile__table">
                                      <thead>
                                        <tr>
                                          <th>Setting</th>
                                          <th>Current Value</th>
                                          <th>New Value</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {profileKeyOrder.map(key => {
                                          const friendly = labelMap[key] || (knownKeys.has(key)
                                            ? (GAME_PROFILE_SETTINGS[selectedGame.id] || []).find(d => d.key === key)?.label
                                            : undefined);
                                          const current = profileSettings[key] ?? '';
                                          const modified = profileModified[key];
                                          const effective = modified ?? current;
                                          const changed = modified !== undefined && modified !== current;
                                          return (
                                            <tr key={key} className={changed ? 'gl-profile__row--changed' : ''}>
                                              <td className="gl-profile__td-key">
                                                <span className="gl-profile__key-name">{key}</span>
                                                {friendly && <span className="gl-profile__key-friendly">{friendly}</span>}
                                              </td>
                                              <td className="gl-profile__td-current">{current}</td>
                                              <td className="gl-profile__td-edit">
                                                <input
                                                  type="text"
                                                  className={`gl-profile__table-input ${changed ? 'gl-profile__table-input--changed' : ''}`}
                                                  value={effective}
                                                  onChange={e => handleProfileChange(key, e.target.value)}
                                                />
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right column: Pro Player Configs */}
                            <div className="gl-profile__col-right">
                              <div className="gl-profile__section gl-profile__section--locked">
                                <div className="gl-profile__lock-overlay">
                                  <Lock size={18} />
                                  <span>Coming Soon</span>
                                </div>
                                <div className="gl-profile__section-head">
                                  <User size={13} />
                                  <span>Pro Player Configs</span>
                                </div>
                                <div className="gl-profile__presets-list">
                                  {proPlayers.map(player => {
                                    const isActive = activePlayerConfig === player.name;
                                    const isLoading = playerConfigLoading === player.name;
                                    return (
                                      <div key={player.name} className={`gl-profile__preset-row ${isActive ? 'gl-profile__preset-row--changed' : ''}`}>
                                        <div className="gl-profile__preset-info">
                                          <span className="gl-profile__preset-label">{player.name}</span>
                                          <span className="gl-profile__preset-desc">{player.role}</span>
                                        </div>
                                        <button
                                          className={`gl-profile__preset-toggle ${isActive ? 'gl-profile__preset-toggle--on' : ''}`}
                                          disabled={isLoading}
                                          onClick={async () => {
                                            if (isActive) {
                                              setProfileModified({});
                                              setProfileDirty(false);
                                              setActivePlayerConfig(null);
                                            } else {
                                              if (!selectedGame || !window.electron?.ipcRenderer) return;
                                              setPlayerConfigLoading(player.name);
                                              try {
                                                const res: any = await window.electron.ipcRenderer.invoke('vconfig:read-player-config', selectedGame.id, player.name);
                                                if (res?.success) {
                                                  const newMods: Record<string, string> = {};
                                                  for (const [k, v] of Object.entries(res.settings as Record<string, string>)) {
                                                    if (profileSettings[k] !== undefined) {
                                                      newMods[k] = v;
                                                    }
                                                  }
                                                  setProfileModified(newMods);
                                                  setProfileDirty(true);
                                                  setActivePlayerConfig(player.name);
                                                }
                                              } catch { /* ignore */ }
                                              setPlayerConfigLoading(null);
                                            }
                                          }}
                                        >
                                          <span className="gl-profile__preset-toggle-track">
                                            <span className="gl-profile__preset-toggle-thumb" />
                                          </span>
                                          <span className="gl-profile__preset-toggle-label">{isLoading ? '...' : isActive ? 'Loaded' : 'Load'}</span>
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* Action bar below Pro Player Configs */}
                              <div className="gl-profile__action-bar">
                                <button className="gl-profile__action gl-profile__action--reset" onClick={handleProfileReset} disabled={profileSaving}>
                                  Reset
                                </button>
                                <button
                                  className={`gl-profile__action gl-profile__action--lock ${profileIsReadOnly ? 'gl-profile__action--locked' : ''}`}
                                  onClick={() => handleToggleReadOnly(!profileIsReadOnly)}
                                  disabled={profileLockBusy}
                                >
                                  {profileLockBusy ? '...' : profileIsReadOnly ? 'Unlock' : 'Read Only'}
                                </button>
                                <button className="gl-profile__action gl-profile__action--apply" onClick={handleProfileSave} disabled={!profileDirty || profileSaving}>
                                  {profileSaving ? '...' : 'Apply'}
                                </button>
                              </div>
                            </div>
                          </div>

                        </div>
                      )}
                    </motion.div>
                  );
                })()}

              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Specs Modal */}
      <AnimatePresence>
        {showSpecsModal && selectedGame && (
          <motion.div
            className="gl-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setShowSpecsModal(false)}
          >
            <motion.div
              className="gl-modal gl-modal--bench"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Header bar ── */}
              <div className="gl-bench__topbar">
                <div className="gl-bench__topbar-left">
                  <Zap size={16} />
                  <span className="gl-bench__topbar-title">Game Benchmark</span>
                  <span className="gl-bench__topbar-sep">—</span>
                  <span className="gl-bench__topbar-game">{selectedGame.title}</span>
                </div>
                <button className="gl-modal__close" onClick={() => setShowSpecsModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="gl-bench__body">
                {benchData ? (() => {
                  const { rows, fps, verdict, cap, verdictLabel, verdictSub, ringPct } = benchData;
                  const iconMap = { cpu: <Cpu size={14} />, monitor: <Monitor size={14} />, hdd: <HardDrive size={14} /> };

                  return (
                    <>
                      {/* ── Score + FPS row ── */}
                      <div className="gl-bench__hero">
                        {/* Circular score */}
                        <div className={`gl-bench__ring gl-bench__ring--${verdict}`}>
                          <svg viewBox="0 0 120 120" className="gl-bench__ring-svg">
                            <circle cx="60" cy="60" r="52" className="gl-bench__ring-track" />
                            <circle cx="60" cy="60" r="52" className="gl-bench__ring-fill"
                              strokeDasharray={`${(ringPct / 100) * 327} 327`}
                              strokeDashoffset="0"
                            />
                          </svg>
                          <div className="gl-bench__ring-inner">
                            <span className="gl-bench__ring-pct">{ringPct}%</span>
                            <span className="gl-bench__ring-label">{verdictLabel}</span>
                          </div>
                        </div>

                        {/* FPS tiers */}
                        <div className="gl-bench__fps-col">
                          <span className="gl-bench__fps-heading">Estimated FPS <span className="gl-bench__fps-res">1080p</span></span>
                          <div className="gl-fps-tiers">
                            {(['low', 'medium', 'high'] as const).map((q) => {
                              const yours = fps.yours[q];
                              const pct = Math.min(100, Math.max(0, (yours / cap) * 100));
                              return (
                                <div key={q} className={`gl-fps-tier gl-fps-tier--${verdict}`}>
                                  <span className="gl-fps-tier__quality">{q}</span>
                                  <div className="gl-fps-tier__hero">
                                    <span className="gl-fps-tier__tilde">~</span>
                                    <span className="gl-fps-tier__value">{yours}</span>
                                  </div>
                                  <span className="gl-fps-tier__unit">FPS</span>
                                  <div className="gl-fps-tier__bar">
                                    <div className="gl-fps-tier__fill" style={{ transform: `scaleX(${pct / 100})` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <span className="gl-bench__verdict-sub">{verdictSub}</span>
                        </div>
                      </div>

                      {/* ── Hardware rows ── */}
                      <div className="gl-bench__hw">
                        {rows.map(row => {
                          const passed = row.result.verdict === 'exceeds' || row.result.verdict === 'meets';
                          return (
                            <div key={row.label} className={`gl-bench__hw-row gl-bench__hw-row--${row.result.verdict}`}>
                              <div className="gl-bench__hw-header">
                                <div className="gl-bench__hw-label">
                                  {iconMap[row.iconName]}
                                  <span>{row.label}</span>
                                </div>
                                <span className={`gl-bench__hw-badge gl-bench__hw-badge--${passed ? 'pass' : 'fail'}`}>
                                  {passed ? <><CheckCircle size={11} /> Pass</> : <><XCircle size={11} /> Fail</>}
                                </span>
                              </div>
                              <span className="gl-bench__hw-val" title={row.result.userValue}>{row.result.userValue}</span>
                              <div className="gl-bench__hw-bar-wrap">
                                <div className={`gl-bench__hw-bar gl-bench__hw-bar--${row.result.verdict}`} style={{ transform: `scaleX(${row.result.percent / 100})` }} />
                              </div>
                              <div className="gl-bench__hw-specs">
                                <span title={row.minSpec}><em>Minimum:</em> {row.minSpec}</span>
                                <span title={row.recSpec}><em>Recommended:</em> {row.recSpec}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <span className="gl-fps-disclaimer">* FPS estimates are approximate at 1080p. Actual performance may vary.</span>
                    </>
                  );
                })() : (
                  <div className="gl-empty gl-empty--sm">
                    <HardDrive size={32} />
                    <p>{!hardwareInfo ? 'Detecting hardware…' : 'No requirement data available for this game.'}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Commands Modal */}
      <AnimatePresence>
        {showCommandsModal && selectedGame?.id === 'apex-legends' && (() => {
          const filtered = cmdFilter.trim()
            ? apexAllCommands.filter(o =>
                o.flag.toLowerCase().includes(cmdFilter.toLowerCase()) ||
                o.description.toLowerCase().includes(cmdFilter.toLowerCase())
              )
            : apexAllCommands;
          const hiCount  = apexAllCommands.filter(o => o.impact.toLowerCase() === 'high').length;
          const medCount = apexAllCommands.filter(o => o.impact.toLowerCase() === 'medium').length;
          const loCount  = apexAllCommands.filter(o => o.impact.toLowerCase() === 'low').length;
          return (
            <motion.div
              className="gcm-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => { setShowCommandsModal(false); setCmdFilter(''); }}
            >
              <motion.div
                className="gcm-panel"
                initial={{ opacity: 0, scale: 0.97, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 20 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="gcm-header">
                  <div className="gcm-header-left">
                    <Zap size={14} className="gcm-header-icon" />
                    <span className="gcm-header-eyebrow">LAUNCH OPTIONS</span>
                    <span className="gcm-header-sep">–</span>
                    <span className="gcm-header-game">Apex Legends</span>
                  </div>
                  <button className="gcm-close" onClick={() => { setShowCommandsModal(false); setCmdFilter(''); }}>
                    <X size={16} />
                  </button>
                </div>

                {/* Search */}
                <div className="gcm-search-wrap">
                  <Search size={13} className="gcm-search-icon" />
                  <input
                    className="gcm-search"
                    placeholder="Filter commands…"
                    value={cmdFilter}
                    onChange={e => setCmdFilter(e.target.value)}
                  />
                  {cmdFilter && (
                    <button className="gcm-search-clear" onClick={() => setCmdFilter('')}><X size={11} /></button>
                  )}
                </div>

                {/* Card grid */}
                <div className="gcm-grid">
                  {filtered.length === 0 ? (
                    <div className="gcm-empty">No commands match "{cmdFilter}"</div>
                  ) : filtered.map((opt, i) => (
                    <div key={`${opt.flag}-${i}`} className={`gcm-card gcm-card--${opt.impact.toLowerCase()}`}>
                      <div className="gcm-card-bar" />
                      <div className="gcm-card-head">
                        <code className="gcm-card-flag">{opt.flag}</code>
                        <button className="gcm-card-copy" onClick={() => handleCopySettings(opt.flag)} title="Copy">
                          <Copy size={11} />
                        </button>
                      </div>
                      <p className="gcm-card-desc">{opt.description}</p>
                      <div className="gcm-card-foot">
                        <span className={`gcm-badge gcm-badge--${opt.impact.toLowerCase()}`}>{opt.impact}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer stats + copy */}
                <div className="gcm-footer">
                  <div className="gcm-stats">
                    <span className="gcm-stat">{apexAllCommands.length} <em>total</em></span>
                    <span className="gcm-stat gcm-stat--hi">{hiCount} <em>high</em></span>
                    <span className="gcm-stat gcm-stat--med">{medCount} <em>medium</em></span>
                    <span className="gcm-stat gcm-stat--lo">{loCount} <em>low</em></span>
                  </div>
                  <button
                    className="gcm-copy-all"
                    onClick={() => { handleCopySettings(apexAllCommands.map(o => o.flag).join(' ')); setShowCommandsModal(false); setCmdFilter(''); }}
                  >
                    <Copy size={14} /> Copy All
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
      </ProLockedWrapper>
    </div>
  );
};

export default React.memo(GameLibrary);
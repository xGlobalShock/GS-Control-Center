// ──────────────────────────────────────────────────────────────────────────────
// Hardware Comparison Engine — "Can You Run It"
// Compares user's detected hardware against per-game requirements.
// ──────────────────────────────────────────────────────────────────────────────

import {
  CPU_BENCHMARKS,
  GPU_BENCHMARKS,
  type GameRequirements,
  type HardwareSpec,
} from '../data/gameRequirements';
import type { HardwareInfo } from '../App';

// ── Types ───────────────────────────────────────────────────────────────────

export type Verdict = 'exceeds' | 'meets' | 'below';
export type OverallVerdict = 'exceeds' | 'meets-recommended' | 'meets-minimum' | 'below';

export interface ComponentResult {
  verdict: Verdict;
  userValue: string;      // Human-readable label for the user's hardware
  userScore: number;      // Numeric benchmark score (0 if unknown)
  recScore: number;       // Recommended score
  minScore: number;       // Minimum score
  /** 0-100 — how close to recommended (clamped) */
  percent: number;
}

export interface ComparisonResult {
  cpu: ComponentResult;
  gpu: ComponentResult;
  ram: ComponentResult;
  storage: ComponentResult;
  vram: ComponentResult | null;
  overall: OverallVerdict;
}

// ── Benchmark Lookup ────────────────────────────────────────────────────────

/** Normalise a hardware name for substring matching (lowercase, trim whitespace). */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Look up a benchmark score from a tier list by finding the first entry
 * whose key appears as a substring of `name` (case-insensitive).
 */
function lookupScore(name: string, tierList: [string, number][]): number {
  const n = normalise(name);
  for (const [key, score] of tierList) {
    if (n.includes(normalise(key))) return score;
  }
  return 0; // unknown
}

export function lookupCpuScore(cpuName: string): number {
  return lookupScore(cpuName, CPU_BENCHMARKS);
}

export function lookupGpuScore(gpuName: string): number {
  return lookupScore(gpuName, GPU_BENCHMARKS);
}

// ── Component Comparison ────────────────────────────────────────────────────

function judgeComponent(
  userScore: number,
  minScore: number,
  recScore: number,
  userLabel: string,
): ComponentResult {
  let verdict: Verdict;
  if (userScore >= recScore) verdict = 'exceeds';
  else if (userScore >= minScore) verdict = 'meets';
  else verdict = 'below';

  // Percentage relative to recommended (0→100+)
  const pct = recScore > 0 ? Math.round((userScore / recScore) * 100) : 0;

  return {
    verdict,
    userValue: userLabel,
    userScore,
    recScore,
    minScore,
    percent: Math.min(pct, 100),
  };
}

// ── Main Comparison ─────────────────────────────────────────────────────────

export function compareHardware(
  hw: HardwareInfo,
  req: GameRequirements,
): ComparisonResult {
  // CPU
  const cpuScore = lookupCpuScore(hw.cpuName);
  const cpu = judgeComponent(cpuScore, req.minimum.cpuBenchmark, req.recommended.cpuBenchmark, hw.cpuName);

  // GPU
  const gpuScore = lookupGpuScore(hw.gpuName);
  const gpu = judgeComponent(gpuScore, req.minimum.gpuBenchmark, req.recommended.gpuBenchmark, hw.gpuName);

  // RAM (score = GB)
  const ramGB = hw.ramTotalGB || 0;
  const ram = judgeComponent(ramGB, req.minimum.ramGB, req.recommended.ramGB, `${ramGB} GB`);

  // Storage (score = free GB)
  const freeGB = hw.diskFreeGB || 0;
  const storage = judgeComponent(freeGB, req.minimum.storageGB, req.recommended.storageGB, `${freeGB} GB free`);

  // VRAM (only if game specifies it)
  let vram: ComponentResult | null = null;
  if (req.recommended.vramGB) {
    const vramStr = hw.gpuVramTotal || '0';
    const userVram = parseFloat(vramStr) || 0;
    vram = judgeComponent(
      userVram,
      req.minimum.vramGB || 0,
      req.recommended.vramGB,
      `${userVram} GB`,
    );
  }

  // Overall verdict — weakest link determines result
  const components = [cpu, gpu, ram, storage];
  if (vram) components.push(vram);

  const allExceed = components.every(c => c.verdict === 'exceeds');
  const anyBelow = components.some(c => c.verdict === 'below');

  let overall: OverallVerdict;
  if (allExceed) overall = 'exceeds';
  else if (anyBelow) overall = 'below';
  else if (cpu.verdict === 'exceeds' && gpu.verdict === 'exceeds') overall = 'meets-recommended';
  else overall = 'meets-minimum';

  return { cpu, gpu, ram, storage, vram, overall };
}

// ── Quick verdict for card ring (without full result) ───────────────────────

export function quickVerdict(
  hw: HardwareInfo | undefined,
  req: GameRequirements | undefined,
): OverallVerdict | 'unknown' {
  if (!hw || !req) return 'unknown';
  return compareHardware(hw, req).overall;
}

// ── FPS Prediction ──────────────────────────────────────────────────────────

export interface QualityFps {
  low: number;
  medium: number;
  high: number;
}

export interface FpsPrediction {
  yours: QualityFps;
  minimum: QualityFps;
  recommended: QualityFps;
}

/** Quality multipliers relative to High (base). Lower settings = higher FPS. */
const QUALITY_MULT = { high: 1.0, medium: 1.35, low: 1.7 };

/**
 * Predict FPS for minimum specs, recommended specs, and the user's hardware
 * at Low, Medium, and High quality settings.
 * Uses GPU benchmark as the primary factor (70%) and CPU as secondary (30%),
 * linearly interpolating from the game's known FPS at min/rec tiers.
 */
export function predictFps(
  result: ComparisonResult,
  req: GameRequirements,
): FpsPrediction {
  const minFps = req.fpsMinimum;
  const recFps = req.fpsRecommended;

  // Weighted blend: GPU matters more than CPU for frame rate
  const gpuMin = result.gpu.minScore || 1;
  const gpuRec = result.gpu.recScore || 1;
  const cpuMin = result.cpu.minScore || 1;
  const cpuRec = result.cpu.recScore || 1;

  // How far user is between min and rec (0 = min, 1 = rec, >1 = above rec)
  const gpuRatio = gpuRec !== gpuMin
    ? (result.gpu.userScore - gpuMin) / (gpuRec - gpuMin)
    : result.gpu.userScore >= gpuRec ? 1.5 : 0;
  const cpuRatio = cpuRec !== cpuMin
    ? (result.cpu.userScore - cpuMin) / (cpuRec - cpuMin)
    : result.cpu.userScore >= cpuRec ? 1.5 : 0;

  const blendedRatio = gpuRatio * 0.7 + cpuRatio * 0.3;

  // Interpolate base (High quality) FPS
  let yourBase: number;
  if (blendedRatio <= 1) {
    yourBase = minFps + blendedRatio * (recFps - minFps);
  } else {
    const extra = blendedRatio - 1;
    yourBase = recFps + Math.sqrt(extra) * (recFps - minFps) * 0.4;
  }

  const clamp = (v: number) => Math.max(10, Math.round(v));

  return {
    yours: {
      high: clamp(yourBase * QUALITY_MULT.high),
      medium: clamp(yourBase * QUALITY_MULT.medium),
      low: clamp(yourBase * QUALITY_MULT.low),
    },
    minimum: {
      high: clamp(minFps * QUALITY_MULT.high),
      medium: clamp(minFps * QUALITY_MULT.medium),
      low: clamp(minFps * QUALITY_MULT.low),
    },
    recommended: {
      high: clamp(recFps * QUALITY_MULT.high),
      medium: clamp(recFps * QUALITY_MULT.medium),
      low: clamp(recFps * QUALITY_MULT.low),
    },
  };
}

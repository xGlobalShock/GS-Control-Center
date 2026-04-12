// ═══════════════════════════════════════════════════════════════
// SCORING SYSTEM — Weighted Multi-Dimensional Component Scoring
// ═══════════════════════════════════════════════════════════════
// Produces weighted scores for each component relative to the
// current workload, resolution, and refresh rate context.
// This replaces simple % threshold logic with workload-aware
// relational scoring.
// ═══════════════════════════════════════════════════════════════

'use strict';

const {
  RESOLUTION_PROFILES,
  REFRESH_RATE_PROFILES,
  WORKLOAD_PROFILES,
  TIER_ORDER,
} = require('../data/hardwareDatabase');

const { computeGenerationGap, getGenGapSeverity } = require('../utils/inference');
// getGenGapSeverity imported from hardwareDatabase
const { getGenGapSeverity: getGGS } = require('../data/hardwareDatabase');

// ─────────────────────────────────────────────────────────────
// MAIN SCORING FUNCTION
// ─────────────────────────────────────────────────────────────

/**
 * Compute weighted performance scores for the entire system.
 * Scores are context-dependent: they shift based on resolution,
 * refresh rate, and workload type.
 *
 * @param {Object} profile - Normalized system profile
 * @param {string} [workloadType='aaa-gaming'] - Workload scenario
 * @returns {Object} Scores and weights for each component
 */
function computeSystemScores(profile, workloadType = 'aaa-gaming') {
  if (!profile) return buildEmptyScores();

  const { cpu, gpu, ram, monitor } = profile;
  const workload = WORKLOAD_PROFILES[workloadType] || WORKLOAD_PROFILES['aaa-gaming'];
  const resProfile = RESOLUTION_PROFILES[monitor?.resolution] || RESOLUTION_PROFILES['1080p'];
  const rrProfile = getRefreshProfile(monitor?.refreshRate || 60);

  // ── Raw Component Scores ───────────────────────────────────
  const cpuRawSt = cpu?.stScore || 40;
  const cpuRawMt = cpu?.mtScore || 30;
  const gpuRaw = gpu?.rasterScore || 30;
  const ramRaw = ram?.score || 50;

  // ── Workload-Weighted CPU Score ────────────────────────────
  // Blend single-thread and multi-thread based on workload
  const cpuBlended = cpuRawSt * workload.stWeight + cpuRawMt * workload.mtWeight;

  // ── Resolution-Adjusted Weights ────────────────────────────
  // At 4K, GPU matters much more; at 1080p, CPU matters more
  const cpuWeight = resProfile.cpuWeight * workload.cpuBias;
  const gpuWeight = resProfile.gpuWeight * workload.gpuBias;
  const ramWeight = workload.ramBias;

  // ── Refresh Rate CPU Demand Scaling ────────────────────────
  // Higher refresh rates increase CPU demand non-linearly
  const cpuDemand = rrProfile.cpuDemandMultiplier;
  // CPU "effective score" drops when refresh rate demands more
  const cpuEffective = cpuBlended / cpuDemand;

  // ── GPU Resolution Load Scaling ────────────────────────────
  // Higher resolutions increase GPU load
  const gpuEffective = gpuRaw / resProfile.pixelLoad;

  // ── RAM Impact Score ───────────────────────────────────────
  // RAM speed matters more in CPU-bound scenarios
  const ramEffective = ramRaw * (1 + cpuWeight * 0.3);

  // ── Generation Gap Penalty ─────────────────────────────────
  const genGap = computeGenerationGap(cpu, gpu);
  const genGapInfo = getGGS(Math.abs(genGap));
  const genPenalty = genGapInfo.weight;

  // Apply generation penalty to the weaker component
  let cpuGenPenalty = 0;
  let gpuGenPenalty = 0;
  if (genGap < 0) {
    // GPU is newer — CPU is the outdated component
    cpuGenPenalty = genPenalty;
  } else if (genGap > 0) {
    // CPU is newer — GPU is the outdated component
    gpuGenPenalty = genPenalty;
  }

  // ── Final Weighted Scores ──────────────────────────────────
  const cpuFinal = cpuEffective * (1 - cpuGenPenalty);
  const gpuFinal = gpuEffective * (1 - gpuGenPenalty);
  const ramFinal = ramEffective;

  // ── System Balance Score ───────────────────────────────────
  // How well-balanced is the system? Perfect balance = cpuFinal ≈ gpuFinal
  const componentScores = [cpuFinal, gpuFinal];
  const maxScore = Math.max(...componentScores);
  const minScore = Math.min(...componentScores);
  const balanceRatio = maxScore > 0 ? minScore / maxScore : 1;

  // ── Overall System Score ───────────────────────────────────
  // Weighted average penalized by imbalance
  const totalWeight = cpuWeight + gpuWeight + ramWeight;
  const weightedAvg = totalWeight > 0
    ? (cpuFinal * cpuWeight + gpuFinal * gpuWeight + ramFinal * ramWeight) / totalWeight
    : (cpuFinal + gpuFinal + ramFinal) / 3;

  // The system is only as fast as its weakest link (harmonic mean influence)
  const harmonicInfluence = 0.3;
  const harmonicMean = componentScores.length > 0
    ? componentScores.length / componentScores.reduce((s, v) => s + (v > 0 ? 1 / v : 0), 0)
    : 0;
  const overallScore = weightedAvg * (1 - harmonicInfluence) + harmonicMean * harmonicInfluence;

  return {
    cpu: {
      raw: cpuBlended,
      effective: cpuEffective,
      final: cpuFinal,
      weight: cpuWeight,
      genPenalty: cpuGenPenalty,
      demandMultiplier: cpuDemand,
    },
    gpu: {
      raw: gpuRaw,
      effective: gpuEffective,
      final: gpuFinal,
      weight: gpuWeight,
      genPenalty: gpuGenPenalty,
      pixelLoadMultiplier: resProfile.pixelLoad,
    },
    ram: {
      raw: ramRaw,
      effective: ramEffective,
      final: ramFinal,
      weight: ramWeight,
    },
    generationGap: {
      value: genGap,
      severity: genGapInfo.severity,
      label: genGapInfo.label,
      penalty: genPenalty,
    },
    balance: {
      ratio: balanceRatio,
      label: balanceRatio > 0.85 ? 'Well Balanced' :
             balanceRatio > 0.65 ? 'Slightly Imbalanced' :
             balanceRatio > 0.45 ? 'Imbalanced' : 'Severely Imbalanced',
    },
    overall: Math.round(overallScore),
    context: {
      workload: workload.label,
      resolution: monitor?.resolution || '1080p',
      refreshRate: monitor?.refreshRate || 60,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// MULTI-WORKLOAD SCORING
// ─────────────────────────────────────────────────────────────

/**
 * Score the system across all workload profiles to identify
 * where it excels and where it struggles.
 */
function computeAllWorkloadScores(profile) {
  const results = {};
  for (const [key, workload] of Object.entries(WORKLOAD_PROFILES)) {
    results[key] = {
      ...computeSystemScores(profile, key),
      workloadLabel: workload.label,
      workloadDescription: workload.description,
    };
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// COMPONENT GAP ANALYSIS
// ─────────────────────────────────────────────────────────────

/**
 * Identify the weakest component relative to the system.
 * Returns components ranked from weakest to strongest.
 */
function rankComponents(scores) {
  if (!scores) return [];

  const components = [
    { name: 'CPU', final: scores.cpu.final, weight: scores.cpu.weight, raw: scores.cpu.raw },
    { name: 'GPU', final: scores.gpu.final, weight: scores.gpu.weight, raw: scores.gpu.raw },
    { name: 'RAM', final: scores.ram.final, weight: scores.ram.weight, raw: scores.ram.raw },
  ];

  return components.sort((a, b) => a.final - b.final);
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function getRefreshProfile(hz) {
  const rates = Object.keys(REFRESH_RATE_PROFILES).map(Number).sort((a, b) => a - b);
  // Find the closest matching profile
  for (let i = rates.length - 1; i >= 0; i--) {
    if (hz >= rates[i]) return REFRESH_RATE_PROFILES[rates[i]];
  }
  return REFRESH_RATE_PROFILES[60];
}

function buildEmptyScores() {
  return {
    cpu: { raw: 0, effective: 0, final: 0, weight: 0, genPenalty: 0, demandMultiplier: 1 },
    gpu: { raw: 0, effective: 0, final: 0, weight: 0, genPenalty: 0, pixelLoadMultiplier: 1 },
    ram: { raw: 0, effective: 0, final: 0, weight: 0 },
    generationGap: { value: 0, severity: 'none', label: 'N/A', penalty: 0 },
    balance: { ratio: 0, label: 'Unknown' },
    overall: 0,
    context: { workload: 'Unknown', resolution: '1080p', refreshRate: 60 },
  };
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  computeSystemScores,
  computeAllWorkloadScores,
  rankComponents,
};

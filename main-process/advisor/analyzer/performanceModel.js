// ═══════════════════════════════════════════════════════════════
// PERFORMANCE MODEL — Workload-Aware Performance Simulation
// ═══════════════════════════════════════════════════════════════
// Models real-world behavior instead of using static rules.
// Simulates how CPU, GPU, RAM, and resolution interact under
// different workload scenarios to produce FPS estimates and
// identify which component is the limiting factor.
// ═══════════════════════════════════════════════════════════════

'use strict';

const {
  RESOLUTION_PROFILES,
  REFRESH_RATE_PROFILES,
  WORKLOAD_PROFILES,
} = require('../data/hardwareDatabase');

const { computeSystemScores, rankComponents } = require('./scoringSystem');

// ─────────────────────────────────────────────────────────────
// PERFORMANCE MODEL
// ─────────────────────────────────────────────────────────────

/**
 * Model the system's performance characteristics for a given scenario.
 * Returns frame pipeline analysis, limiting factors, and capacity estimates.
 *
 * @param {Object} profile - Normalized system profile
 * @param {string} [workloadType='aaa-gaming'] - Workload to model
 * @returns {Object} Performance model results
 */
function modelPerformance(profile, workloadType = 'aaa-gaming') {
  if (!profile || !profile.cpu || !profile.gpu) {
    return buildEmptyModel();
  }

  const scores = computeSystemScores(profile, workloadType);
  const workload = WORKLOAD_PROFILES[workloadType] || WORKLOAD_PROFILES['aaa-gaming'];
  const resolution = profile.monitor?.resolution || '1080p';
  const refreshRate = profile.monitor?.refreshRate || 60;
  const resProfile = RESOLUTION_PROFILES[resolution] || RESOLUTION_PROFILES['1080p'];

  // ── Frame Pipeline Simulation ──────────────────────────────
  // In a real GPU pipeline, the CPU prepares draw calls and the
  // GPU renders them. The slower one determines the frame rate.
  //
  // CPU FPS capacity: how many frames the CPU can prepare per second
  // GPU FPS capacity: how many frames the GPU can render per second
  // Actual FPS: min(cpuFps, gpuFps)

  // Estimate FPS capacities from scores
  // Score of 100 = ~240 FPS at 1080p in AAA, scales with resolution
  const baseFpsCeiling = 240;

  // CPU frame preparation capacity
  const cpuFpsCapacity = Math.round(
    (scores.cpu.raw / 100) * baseFpsCeiling * (1 / scores.cpu.demandMultiplier)
  );

  // GPU frame rendering capacity
  const gpuFpsCapacity = Math.round(
    (scores.gpu.raw / 100) * baseFpsCeiling * (1 / resProfile.pixelLoad)
  );

  // Actual achievable FPS (limited by the slower component)
  const achievableFps = Math.min(cpuFpsCapacity, gpuFpsCapacity);

  // ── Limiting Factor Detection ──────────────────────────────
  let primaryLimiter;
  let gpuUtilization;
  let cpuUtilization;

  if (cpuFpsCapacity < gpuFpsCapacity) {
    primaryLimiter = 'CPU';
    gpuUtilization = (cpuFpsCapacity / gpuFpsCapacity) * 100;
    cpuUtilization = 100;
  } else if (gpuFpsCapacity < cpuFpsCapacity) {
    primaryLimiter = 'GPU';
    cpuUtilization = (gpuFpsCapacity / cpuFpsCapacity) * 100;
    gpuUtilization = 100;
  } else {
    primaryLimiter = 'Balanced';
    cpuUtilization = 100;
    gpuUtilization = 100;
  }

  // ── Refresh Rate Target Analysis ───────────────────────────
  const canHitRefreshRate = achievableFps >= refreshRate;
  const refreshRateHeadroom = achievableFps - refreshRate;
  const refreshRateSaturation = Math.min(100, (achievableFps / refreshRate) * 100);

  // ── RAM Impact Assessment ──────────────────────────────────
  // RAM speed matters most when CPU is the limiter
  const ramImpact = computeRamImpact(profile, scores, primaryLimiter);

  // ── PCIe Bandwidth Assessment ──────────────────────────────
  const pcieBandwidthImpact = computePcieBandwidthImpact(profile);

  // ── Efficiency Rating ──────────────────────────────────────
  // How efficiently is each component being utilized?
  const efficiency = {
    cpu: Math.round(cpuUtilization),
    gpu: Math.round(gpuUtilization),
    overall: Math.round((cpuUtilization + gpuUtilization) / 2),
    wastedPotential: primaryLimiter === 'Balanced' ? 0 :
      Math.round(100 - Math.min(cpuUtilization, gpuUtilization)),
  };

  return {
    framePipeline: {
      cpuFpsCapacity,
      gpuFpsCapacity,
      achievableFps,
      primaryLimiter,
    },
    targetAnalysis: {
      refreshRate,
      canHitTarget: canHitRefreshRate,
      headroom: refreshRateHeadroom,
      saturation: Math.round(refreshRateSaturation),
    },
    utilization: efficiency,
    ramImpact,
    pcieBandwidthImpact,
    scores,
    context: {
      workload: workload.label,
      resolution,
      refreshRate,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// MULTI-SCENARIO MODELING
// ─────────────────────────────────────────────────────────────

/**
 * Model performance across all standard workloads.
 * Useful for identifying the system's best and worst scenarios.
 */
function modelAllWorkloads(profile) {
  const results = {};
  for (const key of Object.keys(WORKLOAD_PROFILES)) {
    results[key] = modelPerformance(profile, key);
  }
  return results;
}

/**
 * Model how performance changes across resolutions.
 * Shows where the system transitions from CPU-bound to GPU-bound.
 */
function modelResolutionScaling(profile, workloadType = 'aaa-gaming') {
  const resolutions = ['720p', '1080p', '1440p', '4k'];
  const results = [];

  for (const res of resolutions) {
    // Temporarily override monitor resolution
    const modifiedProfile = {
      ...profile,
      monitor: { ...profile.monitor, resolution: res },
    };
    const model = modelPerformance(modifiedProfile, workloadType);
    results.push({
      resolution: res,
      fps: model.framePipeline.achievableFps,
      limiter: model.framePipeline.primaryLimiter,
      gpuUtilization: model.utilization.gpu,
      cpuUtilization: model.utilization.cpu,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// RAM IMPACT ASSESSMENT
// ─────────────────────────────────────────────────────────────

function computeRamImpact(profile, scores, primaryLimiter) {
  const { ram } = profile;
  if (!ram) return { severity: 'none', description: 'RAM data unavailable' };

  // RAM speed matters most when CPU-bound
  const isRelevant = primaryLimiter === 'CPU' || scores.cpu.weight > 0.4;

  if (!ram.isXmpEnabled && ram.speed > 0) {
    return {
      severity: 'high',
      fpsImpact: isRelevant ? '5-15% FPS loss' : '2-5% FPS loss',
      description: `RAM at ${ram.speed} MT/s (base clock). Enabling XMP/EXPO would provide free performance.`,
      actionable: true,
    };
  }

  if (ram.tier === 'base' || ram.tier === 'low') {
    return {
      severity: 'moderate',
      fpsImpact: isRelevant ? '3-8% below optimal' : '1-3% below optimal',
      description: `RAM speed (${ram.speed} MT/s) is on the slow end for ${ram.type}. Higher speed RAM would help in CPU-limited scenarios.`,
      actionable: true,
    };
  }

  if (ram.totalGB < 16) {
    return {
      severity: 'high',
      fpsImpact: 'Severe stuttering likely',
      description: `Only ${ram.totalGB} GB RAM — many modern games need 16 GB minimum. Active paging will cause frame drops.`,
      actionable: true,
    };
  }

  return {
    severity: 'none',
    fpsImpact: 'Negligible',
    description: 'RAM configuration is adequate for this workload.',
    actionable: false,
  };
}

// ─────────────────────────────────────────────────────────────
// PCIe BANDWIDTH IMPACT
// ─────────────────────────────────────────────────────────────

function computePcieBandwidthImpact(profile) {
  const { gpu, motherboard } = profile;
  if (!gpu || !motherboard || motherboard.fallback) {
    return { severity: 'none', description: 'Cannot assess PCIe bandwidth.' };
  }

  const gpuTier = gpu.rasterScore || 0;
  const pcieGen = motherboard.pcieGen || 3;

  // High-end GPUs on PCIe 3.0 can lose measurable performance
  if (gpuTier >= 70 && pcieGen <= 3) {
    return {
      severity: 'moderate',
      fpsImpact: '3-8% in GPU-heavy workloads',
      description: `Your ${gpu.model} is on PCIe Gen ${pcieGen}. Flagship GPUs benefit from Gen 4/5 bandwidth.`,
    };
  }

  if (gpuTier >= 50 && pcieGen <= 3) {
    return {
      severity: 'minor',
      fpsImpact: '1-3% in specific scenarios',
      description: `PCIe Gen ${pcieGen} is adequate but not optimal for your ${gpu.model}.`,
    };
  }

  return {
    severity: 'none',
    fpsImpact: 'None',
    description: 'PCIe bandwidth is sufficient.',
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function buildEmptyModel() {
  return {
    framePipeline: { cpuFpsCapacity: 0, gpuFpsCapacity: 0, achievableFps: 0, primaryLimiter: 'Unknown' },
    targetAnalysis: { refreshRate: 60, canHitTarget: false, headroom: 0, saturation: 0 },
    utilization: { cpu: 0, gpu: 0, overall: 0, wastedPotential: 0 },
    ramImpact: { severity: 'none', description: 'No data' },
    pcieBandwidthImpact: { severity: 'none', description: 'No data' },
    scores: null,
    context: { workload: 'Unknown', resolution: '1080p', refreshRate: 60 },
  };
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  modelPerformance,
  modelAllWorkloads,
  modelResolutionScaling,
};

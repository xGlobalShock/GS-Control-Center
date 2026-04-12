// ═══════════════════════════════════════════════════════════════
// BOTTLENECK ENGINE — Relationship-Aware Bottleneck Detection
// ═══════════════════════════════════════════════════════════════
// Detects real bottlenecks using cross-component dependency
// analysis, weighted scoring, and scenario-based evaluation.
// NOT simple threshold checks — this models component
// relationships and generational gaps as first-class signals.
// ═══════════════════════════════════════════════════════════════

'use strict';

const {
  RESOLUTION_PROFILES,
  WORKLOAD_PROFILES,
  TIER_ORDER,
} = require('../data/hardwareDatabase');

const { getGenGapSeverity } = require('../data/hardwareDatabase');
const { computeGenerationGap } = require('../utils/inference');
const { computeSystemScores, rankComponents } = require('./scoringSystem');
const { modelPerformance } = require('./performanceModel');

// ─────────────────────────────────────────────────────────────
// MAIN BOTTLENECK ANALYSIS
// ─────────────────────────────────────────────────────────────

/**
 * Comprehensive bottleneck analysis across all workload scenarios.
 * Returns primary bottleneck, secondary bottlenecks, hidden
 * inefficiencies, and workload-specific findings.
 *
 * @param {Object} profile - Normalized system profile
 * @param {Object} [liveStats] - Optional real-time monitoring stats
 * @returns {Object} Complete bottleneck analysis
 */
function analyzeBottlenecks(profile, liveStats) {
  if (!profile || !profile.cpu || !profile.gpu) {
    return { bottlenecks: [], summary: 'Insufficient hardware data for bottleneck analysis.' };
  }

  const bottlenecks = [];
  const workloads = ['competitive-gaming', 'aaa-gaming', 'productivity', 'streaming'];

  // ── Run analysis for each workload scenario ────────────────
  const scenarioResults = {};
  for (const wl of workloads) {
    scenarioResults[wl] = analyzeScenario(profile, wl);
  }

  // ── Aggregate findings across scenarios ────────────────────
  // A bottleneck that appears in multiple scenarios is more significant
  const componentAppearances = {};

  for (const [wl, result] of Object.entries(scenarioResults)) {
    for (const bn of result.bottlenecks) {
      if (!componentAppearances[bn.component]) {
        componentAppearances[bn.component] = { count: 0, maxSeverity: 0, scenarios: [], details: [] };
      }
      componentAppearances[bn.component].count++;
      componentAppearances[bn.component].maxSeverity = Math.max(
        componentAppearances[bn.component].maxSeverity, bn.severityScore
      );
      componentAppearances[bn.component].scenarios.push(wl);
      componentAppearances[bn.component].details.push(bn);
    }
  }

  // ── Build final bottleneck list ────────────────────────────
  for (const [component, data] of Object.entries(componentAppearances)) {
    // Find the worst-case scenario for this component
    const worst = data.details.sort((a, b) => b.severityScore - a.severityScore)[0];

    bottlenecks.push({
      component,
      severity: worst.severity,
      severityScore: data.maxSeverity,
      type: worst.type,
      title: worst.title,
      description: worst.description,
      affectedScenarios: data.scenarios.map(s => WORKLOAD_PROFILES[s]?.label || s),
      scenarioCount: data.count,
      totalScenarios: workloads.length,
      pervasiveness: data.count / workloads.length,
    });
  }

  // Sort: highest severity first, then by pervasiveness
  bottlenecks.sort((a, b) => {
    if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
    return b.pervasiveness - a.pervasiveness;
  });

  // ── Detect hidden inefficiencies ───────────────────────────
  const hiddenIssues = detectHiddenInefficiencies(profile, scenarioResults);

  // ── Live monitoring enhancement ────────────────────────────
  const liveBottlenecks = liveStats ? detectLiveBottlenecks(liveStats, profile) : [];

  // ── Build summary ──────────────────────────────────────────
  const primary = bottlenecks[0] || null;
  const secondary = bottlenecks.slice(1);

  return {
    primary,
    secondary,
    hiddenIssues,
    liveBottlenecks,
    scenarioResults,
    summary: buildSummary(primary, secondary, profile),
  };
}

// ─────────────────────────────────────────────────────────────
// SCENARIO-SPECIFIC BOTTLENECK ANALYSIS
// ─────────────────────────────────────────────────────────────

function analyzeScenario(profile, workloadType) {
  const perfModel = modelPerformance(profile, workloadType);
  const scores = perfModel.scores;
  const bottlenecks = [];

  if (!scores) return { bottlenecks };

  const { cpu, gpu, ram, monitor } = profile;
  const workload = WORKLOAD_PROFILES[workloadType];

  // ── CPU Bottleneck Analysis ────────────────────────────────
  if (perfModel.framePipeline.primaryLimiter === 'CPU') {
    const gpuWaste = perfModel.utilization.wastedPotential;

    // Only flag as bottleneck if waste is significant (>20%)
    // A CPU being slightly slower than the GPU is normal, not a bottleneck
    if (gpuWaste > 20) {
    let severity = 'moderate';
    let severityScore = 40;

    // Scale severity by GPU waste and generation gap
    if (gpuWaste > 30) { severity = 'critical'; severityScore = 85; }
    else if (gpuWaste > 15) { severity = 'high'; severityScore = 65; }

    // Generation gap amplifier
    const genGap = scores.generationGap;
    if (genGap.severity === 'severe' || genGap.severity === 'extreme') {
      severityScore = Math.min(100, severityScore + 20);
      severity = 'critical';
    } else if (genGap.severity === 'major' || genGap.severity === 'moderate') {
      severityScore = Math.min(100, severityScore + 10);
    }

    bottlenecks.push({
      component: 'CPU',
      type: 'frame-pipeline',
      severity,
      severityScore,
      title: 'CPU Bottleneck',
      description: buildCpuBottleneckDescription(profile, perfModel, workload),
      metrics: {
        cpuFps: perfModel.framePipeline.cpuFpsCapacity,
        gpuFps: perfModel.framePipeline.gpuFpsCapacity,
        gpuUtilization: perfModel.utilization.gpu,
        wastedGpuPotential: gpuWaste,
      },
    });
    } // end gpuWaste > 20
  }

  // ── GPU Bottleneck Analysis ────────────────────────────────
  if (perfModel.framePipeline.primaryLimiter === 'GPU') {
    const cpuWaste = perfModel.utilization.wastedPotential;

    // Only flag as bottleneck if waste is significant (>20%)
    // A GPU being slightly slower than the CPU is normal, not a bottleneck
    if (cpuWaste > 20) {
    let severity = 'moderate';
    let severityScore = 40;

    if (cpuWaste > 30) { severity = 'critical'; severityScore = 80; }
    else if (cpuWaste > 15) { severity = 'high'; severityScore = 60; }

    // GPU at resolution above its target = expected behavior, lower severity
    const resOrder = { '720p': 1, '1080p': 2, '1440p': 3, '4k': 4 };
    const targetRes = resOrder[gpu.targetRes] || 2;
    const actualRes = resOrder[monitor?.resolution] || 2;
    if (actualRes > targetRes) {
      severity = 'moderate';
      severityScore = Math.max(30, severityScore - 15);
    }

    bottlenecks.push({
      component: 'GPU',
      type: 'frame-pipeline',
      severity,
      severityScore,
      title: 'GPU Bottleneck',
      description: buildGpuBottleneckDescription(profile, perfModel, workload),
      metrics: {
        cpuFps: perfModel.framePipeline.cpuFpsCapacity,
        gpuFps: perfModel.framePipeline.gpuFpsCapacity,
        cpuUtilization: perfModel.utilization.cpu,
        wastedCpuPotential: cpuWaste,
      },
    });
    } // end cpuWaste > 20
  }

  // ── RAM Bottleneck ─────────────────────────────────────────
  if (perfModel.ramImpact.severity === 'high') {
    bottlenecks.push({
      component: 'RAM',
      type: 'capacity-or-speed',
      severity: 'high',
      severityScore: 70,
      title: 'RAM Limitation',
      description: perfModel.ramImpact.description,
      metrics: { fpsImpact: perfModel.ramImpact.fpsImpact },
    });
  } else if (perfModel.ramImpact.severity === 'moderate') {
    bottlenecks.push({
      component: 'RAM',
      type: 'speed',
      severity: 'moderate',
      severityScore: 35,
      title: 'RAM Speed Suboptimal',
      description: perfModel.ramImpact.description,
      metrics: { fpsImpact: perfModel.ramImpact.fpsImpact },
    });
  }

  // Monitor is a display preference, not a bottleneck — skip monitor checks

  // ── Refresh Rate ↔ FPS Mismatch ───────────────────────────
  if (!perfModel.targetAnalysis.canHitTarget && monitor?.refreshRate > 60) {
    const deficit = monitor.refreshRate - perfModel.framePipeline.achievableFps;
    if (deficit > 30) {
      bottlenecks.push({
        component: perfModel.framePipeline.primaryLimiter,
        type: 'refresh-rate-target',
        severity: 'high',
        severityScore: 55,
        title: `Cannot Hit ${monitor.refreshRate}Hz Target`,
        description: `Estimated achievable FPS (~${perfModel.framePipeline.achievableFps}) falls well short of ` +
          `your ${monitor.refreshRate}Hz display. The ${perfModel.framePipeline.primaryLimiter} is the limiting factor.`,
        metrics: { targetHz: monitor.refreshRate, estimatedFps: perfModel.framePipeline.achievableFps },
      });
    }
  }

  return { bottlenecks, perfModel };
}

// ─────────────────────────────────────────────────────────────
// HIDDEN INEFFICIENCY DETECTION
// ─────────────────────────────────────────────────────────────

function detectHiddenInefficiencies(profile, scenarioResults) {
  const issues = [];
  const { cpu, gpu, ram, motherboard, monitor } = profile;

  // ── Generation Gap Warning ─────────────────────────────────
  const genGap = computeGenerationGap(cpu, gpu);
  const genInfo = getGenGapSeverity(Math.abs(genGap));

  if (genInfo.weight >= 0.30) {
    const olderComponent = genGap < 0 ? 'CPU' : 'GPU';
    const newerComponent = genGap < 0 ? 'GPU' : 'CPU';
    issues.push({
      type: 'generation-gap',
      severity: genInfo.severity,
      title: `${genInfo.label} — ${olderComponent} Holding Back ${newerComponent}`,
      description: `Your ${olderComponent === 'CPU' ? cpu.model : gpu.model} is ${genInfo.label.toLowerCase()} from ` +
        `your ${newerComponent === 'CPU' ? cpu.model : gpu.model}. This generational mismatch means the newer ` +
        `component's capabilities aren't fully utilized.`,
    });
  }

  // ── Single-Channel RAM ─────────────────────────────────────
  if (ram?.channels === 'single' && ram.slotsUsed === 1 && ram.slotsTotal >= 2) {
    issues.push({
      type: 'single-channel-ram',
      severity: 'moderate',
      title: 'Single-Channel RAM Detected',
      description: `Running a single RAM stick loses ~10-15% memory bandwidth vs dual-channel. ` +
        `Adding a matching stick would provide a free performance boost, especially in CPU-bound scenarios.`,
    });
  }

  // ── PCIe Bandwidth ─────────────────────────────────────────
  if (motherboard && !motherboard.fallback && motherboard.pcieGen < 4 && gpu?.rasterScore > 50) {
    issues.push({
      type: 'pcie-limitation',
      severity: 'minor',
      title: 'PCIe Gen 3 Bandwidth Constraint',
      description: `Your ${motherboard.chipset} provides PCIe Gen ${motherboard.pcieGen}. ` +
        `Your ${gpu.model} would benefit from Gen 4+ bandwidth, particularly in asset-streaming-heavy games.`,
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────
// LIVE MONITORING BOTTLENECK DETECTION
// ─────────────────────────────────────────────────────────────

/**
 * Enhanced real-time bottleneck detection using live stats
 * combined with hardware profile context.
 */
function detectLiveBottlenecks(stats, profile) {
  const bottlenecks = [];
  if (!stats) return bottlenecks;

  const {
    cpu: cpuUsage = 0,
    gpuUsage = -1,
    temperature = 0,
    gpuTemp = 0,
  } = stats;

  // ── CPU-GPU Utilization Imbalance ──────────────────────────
  // Unlike the old system, we factor in the hardware profile
  if (cpuUsage > 80 && gpuUsage >= 0 && gpuUsage < 60) {
    const gpuTierLabel = profile?.gpu?.model || 'GPU';
    const cpuTierLabel = profile?.cpu?.model || 'CPU';

    bottlenecks.push({
      id: 'live-cpu-bottleneck',
      severity: 'critical',
      icon: 'cpu',
      title: 'Active CPU Bottleneck',
      description: `${cpuTierLabel} at ${Math.round(cpuUsage)}% while ${gpuTierLabel} is only at ${Math.round(gpuUsage)}%. ` +
        `The CPU cannot prepare frames fast enough, leaving GPU power unused.`,
      suggestions: [
        'Lower CPU-bound settings: view distance, physics, NPC count',
        'Enable frame cap to reduce CPU overhead',
        profile?.cpu?.stScore < 70 ? 'Consider a CPU upgrade for better frame delivery' : null,
      ].filter(Boolean),
    });
  }

  // ── GPU Bottleneck (Live) ──────────────────────────────────
  if (gpuUsage >= 95 && cpuUsage < 60) {
    bottlenecks.push({
      id: 'live-gpu-bottleneck',
      severity: 'warning',
      icon: 'gpu',
      title: 'Active GPU Bottleneck',
      description: `GPU at ${Math.round(gpuUsage)}% while CPU has headroom at ${Math.round(cpuUsage)}%. ` +
        `Frame rate is limited by GPU rendering speed.`,
      suggestions: [
        'Lower resolution or render scale',
        'Reduce graphical quality (shadows, reflections, anti-aliasing)',
        'Enable DLSS/FSR/XeSS if supported',
      ],
    });
  }

  // ── Thermal Throttling Detection ───────────────────────────
  if (temperature >= 90 && cpuUsage < 70) {
    bottlenecks.push({
      id: 'live-thermal-throttle',
      severity: 'critical',
      icon: 'thermometer',
      title: 'CPU Thermal Throttling Active',
      description: `CPU temperature at ${Math.round(temperature)}°C with only ${Math.round(cpuUsage)}% utilization suggests active thermal throttling. ` +
        `The CPU is reducing clock speed to prevent damage, severely limiting performance.`,
      suggestions: [
        'Clean dust from heatsink and fans immediately',
        'Reapply thermal paste',
        'Check CPU cooler mounting pressure',
        'Improve case airflow',
      ],
    });
  }

  if (gpuTemp >= 90 && gpuUsage < 70) {
    bottlenecks.push({
      id: 'live-gpu-thermal-throttle',
      severity: 'critical',
      icon: 'thermometer',
      title: 'GPU Thermal Throttling Active',
      description: `GPU temperature at ${Math.round(gpuTemp)}°C with only ${Math.round(gpuUsage)}% utilization suggests thermal throttling. ` +
        `GPU clocks are being reduced to protect the chip.`,
      suggestions: [
        'Set a more aggressive GPU fan curve',
        'Improve case airflow',
        'Repaste the GPU if it\'s older than 3 years',
      ],
    });
  }

  return bottlenecks;
}

// ─────────────────────────────────────────────────────────────
// DESCRIPTION BUILDERS
// ─────────────────────────────────────────────────────────────

function buildCpuBottleneckDescription(profile, perfModel, workload) {
  const { cpu, gpu, monitor } = profile;
  const pipe = perfModel.framePipeline;

  let desc = `Your ${gpu.model} is being CPU-limited by the ${cpu.model}`;

  if (monitor?.resolution) {
    desc += ` at ${monitor.resolution}`;
  }
  if (monitor?.refreshRate > 60) {
    desc += ` ${monitor.refreshRate}Hz`;
  }
  desc += '. ';

  desc += `The CPU can deliver ~${pipe.cpuFpsCapacity} FPS but the GPU could handle ~${pipe.gpuFpsCapacity} FPS. `;

  if (perfModel.utilization.wastedPotential > 20) {
    desc += `This means ~${perfModel.utilization.wastedPotential}% of your GPU's potential is wasted. `;
  }

  if (monitor?.refreshRate > pipe.cpuFpsCapacity) {
    desc += `You cannot hit your ${monitor.refreshRate}Hz refresh rate target due to CPU limitation.`;
  }

  return desc;
}

function buildGpuBottleneckDescription(profile, perfModel, workload) {
  const { cpu, gpu, monitor } = profile;
  const pipe = perfModel.framePipeline;

  let desc = `Your ${gpu.model} is the limiting factor`;

  if (monitor?.resolution) {
    desc += ` at ${monitor.resolution}`;
  }
  desc += `. The GPU can render ~${pipe.gpuFpsCapacity} FPS while the CPU can prepare ~${pipe.cpuFpsCapacity} FPS. `;

  const resProfile = RESOLUTION_PROFILES[monitor?.resolution] || RESOLUTION_PROFILES['1080p'];
  if (resProfile.pixelLoad >= 1.78) {
    desc += `At ${monitor.resolution}, the GPU bears the majority of the workload — this is expected behavior for high resolutions. `;
  }

  desc += 'Consider lowering graphical settings or enabling upscaling (DLSS/FSR) to improve frame rates.';

  return desc;
}

function buildSummary(primary, secondary, profile) {
  if (!primary) {
    return 'Your system is well-balanced with no significant bottlenecks detected across all workload scenarios.';
  }

  let summary = `Primary bottleneck: ${primary.component} (${primary.severity}). ${primary.title}. `;

  if (primary.pervasiveness >= 0.75) {
    summary += `This affects ${primary.affectedScenarios.join(', ')}. `;
  }

  if (secondary.length > 0) {
    const secComponents = secondary.map(b => b.component).join(', ');
    summary += `Secondary concerns: ${secComponents}.`;
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  analyzeBottlenecks,
  detectLiveBottlenecks,
};

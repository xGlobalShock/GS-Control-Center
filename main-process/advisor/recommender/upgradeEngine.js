// ═══════════════════════════════════════════════════════════════
// UPGRADE ENGINE — Intelligent Upgrade Recommendations
// ═══════════════════════════════════════════════════════════════
// Generates precise, platform-aware upgrade paths based on
// bottleneck analysis. Respects socket constraints, DDR gen,
// and identifies when full platform upgrade is required.
// ═══════════════════════════════════════════════════════════════

'use strict';

const {
  CPU_DATABASE,
  UPGRADE_CATALOG,
  TIER_ORDER,
  CHIPSET_DATABASE,
} = require('../data/hardwareDatabase');

const { normalizeRamTotal, detectFormFactor } = require('../analyzer/normalization');

// ─────────────────────────────────────────────────────────────
// MAIN UPGRADE RECOMMENDATION ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * Generate upgrade recommendations based on bottleneck analysis
 * and system profile.
 *
 * @param {Object} profile - Normalized system profile
 * @param {Object} bottleneckAnalysis - Output from bottleneckEngine
 * @returns {Array} Prioritized upgrade recommendations
 */
function generateUpgradeRecommendations(profile, bottleneckAnalysis) {
  if (!profile) return [];

  const recs = [];
  const isLaptop = profile.formFactor === 'laptop';

  // ── Bottleneck-Driven Recommendations ──────────────────────
  if (bottleneckAnalysis?.primary) {
    const primaryBn = bottleneckAnalysis.primary;

    if (primaryBn.component === 'CPU') {
      recs.push(...generateCpuUpgrades(profile, primaryBn));
    }
    if (primaryBn.component === 'GPU') {
      recs.push(...generateGpuUpgrades(profile, primaryBn));
    }
    // Monitor is a display preference — no upgrade suggestions
  }

  // ── RAM Upgrades ───────────────────────────────────────────
  recs.push(...generateRamUpgrades(profile, isLaptop));

  // ── Storage Upgrades ───────────────────────────────────────
  recs.push(...generateStorageUpgrades(profile));

  // ── Hidden Inefficiency Fixes ──────────────────────────────
  if (bottleneckAnalysis?.hiddenIssues) {
    for (const issue of bottleneckAnalysis.hiddenIssues) {
      if (issue.type === 'generation-gap' && issue.severity !== 'minor') {
        // Already handled by CPU/GPU upgrade above
        continue;
      }
      if (issue.type === 'single-channel-ram') {
        recs.push({
          component: 'RAM',
          impact: 'Moderate',
          reason: issue.description,
          suggestions: [{
            model: `Matching ${profile.ram?.type || 'DDR4'} ${profile.ram?.speed || 3200} MT/s stick`,
            price: '$30-$60',
            expectedGain: '10-15% memory bandwidth improvement',
          }],
          priority: 3,
        });
      }
    }
  }

  // Monitor is a display preference — no upgrade suggestions

  // De-duplicate and sort by priority
  const seen = new Set();
  const deduped = recs.filter(r => {
    const key = `${r.component}-${r.suggestions?.[0]?.model || r.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.sort((a, b) => a.priority - b.priority);
}

// ─────────────────────────────────────────────────────────────
// CPU UPGRADE GENERATION
// ─────────────────────────────────────────────────────────────

function generateCpuUpgrades(profile, bottleneck) {
  const recs = [];
  const { cpu, motherboard } = profile;
  if (!cpu) return recs;

  const currentSocket = cpu.socket;
  const currentStScore = cpu.stScore || 40;
  const isLaptop = profile.formFactor === 'laptop';

  if (isLaptop) {
    recs.push({
      component: 'CPU',
      impact: 'Critical',
      reason: `CPU bottleneck detected, but laptop CPUs cannot be upgraded. ` +
        `Consider optimizing settings or upgrading to a new laptop.`,
      suggestions: [],
      priority: 1,
      platformNote: 'Laptop — CPU is soldered',
    });
    return recs;
  }

  // ── Drop-in Upgrade (Same Socket) ─────────────────────────
  const dropInOptions = findDropInCpuUpgrades(currentSocket, currentStScore, motherboard);

  if (dropInOptions.length > 0) {
    recs.push({
      component: 'CPU',
      impact: 'High',
      reason: `Your ${cpu.model} is the primary bottleneck. Drop-in upgrades available for ${currentSocket}.`,
      suggestions: dropInOptions,
      priority: 1,
      platformNote: `Compatible with your current ${motherboard?.chipset || currentSocket} motherboard`,
    });
  }

  // ── Platform Upgrade (New Socket + Mobo + possibly RAM) ───
  const platformUpgrades = findPlatformUpgrades(cpu, currentStScore);

  if (platformUpgrades.length > 0) {
    const needsNewRam = platformUpgrades.some(p => p.requiresDDR5) && profile.ram?.type === 'DDR4';

    recs.push({
      component: 'Platform (CPU + Motherboard' + (needsNewRam ? ' + RAM)' : ')'),
      impact: 'Critical',
      reason: dropInOptions.length > 0
        ? `For maximum performance, a full platform upgrade would provide the biggest leap.`
        : `No significant drop-in upgrades exist for ${currentSocket}. A platform change is recommended.`,
      suggestions: platformUpgrades,
      priority: dropInOptions.length > 0 ? 3 : 1,
      platformNote: needsNewRam
        ? 'Requires new motherboard and DDR5 RAM'
        : 'Requires new motherboard',
    });
  }

  return recs;
}

function findDropInCpuUpgrades(socket, currentScore, motherboard) {
  const options = [];
  const supportedGens = motherboard?.supportedGens || [];

  // Find all CPUs for this socket that are better than current
  for (const [key, cpu] of Object.entries(CPU_DATABASE)) {
    if (cpu.socket !== socket) continue;
    if (cpu.stScore <= currentScore + 5) continue; // Need meaningful improvement
    if (supportedGens.length > 0 && !supportedGens.includes(cpu.gen)) continue;

    // Find matching catalog entry
    const catalogSuggestion = findCatalogMatch('cpu', cpu.stScore);

    options.push({
      model: formatCpuModel(key, cpu),
      price: catalogSuggestion?.price || estimatePrice('cpu', cpu.tier),
      expectedGain: `~${Math.round(((cpu.stScore / currentScore) - 1) * 100)}% single-thread improvement`,
      socket,
      tier: cpu.tier,
      stScore: cpu.stScore,
    });
  }

  // Sort by value (score gain per tier) and take top 3
  return options
    .sort((a, b) => b.stScore - a.stScore)
    .slice(0, 3);
}

function findPlatformUpgrades(currentCpu, currentScore) {
  const options = [];
  const targetTiers = ['mid', 'high-end', 'flagship'];

  for (const tier of targetTiers) {
    const catalogOptions = UPGRADE_CATALOG.cpu[tier] || [];
    for (const opt of catalogOptions) {
      if (opt.socket === currentCpu.socket) continue; // Skip same platform
      if (opt.stScore <= currentScore + 10) continue; // Need a real improvement

      options.push({
        model: opt.model,
        price: opt.price,
        expectedGain: `~${Math.round(((opt.stScore / currentScore) - 1) * 100)}% single-thread improvement`,
        socket: opt.socket,
        tier: opt.tier,
        requiresDDR5: opt.socket === 'AM5' || opt.socket === 'LGA1851',
      });
    }
  }

  return options.slice(0, 3);
}

// ─────────────────────────────────────────────────────────────
// GPU UPGRADE GENERATION
// ─────────────────────────────────────────────────────────────

function generateGpuUpgrades(profile, bottleneck) {
  const recs = [];
  const { gpu, monitor, cpu } = profile;
  if (!gpu) return recs;

  const currentScore = gpu.rasterScore || 30;
  const isLaptop = profile.formFactor === 'laptop';

  if (isLaptop) {
    recs.push({
      component: 'GPU',
      impact: 'Critical',
      reason: `GPU bottleneck detected, but laptop GPUs cannot be upgraded. Consider an external GPU dock or a new laptop.`,
      suggestions: [],
      priority: 1,
    });
    return recs;
  }

  // Determine target tier based on monitor
  const targetTier = monitor?.resolution === '4k' ? 'flagship' :
                     monitor?.resolution === '1440p' ? 'high-end' : 'mid';

  const options = [];
  const allTiers = ['budget', 'mid', 'high-end', 'flagship'];
  const startIdx = allTiers.indexOf(targetTier) - 1;

  for (let i = Math.max(0, startIdx); i < allTiers.length; i++) {
    const tier = allTiers[i];
    const catalogOptions = UPGRADE_CATALOG.gpu[tier] || [];
    for (const opt of catalogOptions) {
      if (opt.rasterScore <= currentScore + 10) continue;

      // Check if CPU would bottleneck新 GPU
      const cpuScore = cpu?.stScore || 50;
      const wouldBottleneck = opt.rasterScore > cpuScore * 1.5;

      options.push({
        model: opt.model,
        price: opt.price,
        expectedGain: `~${Math.round(((opt.rasterScore / currentScore) - 1) * 100)}% rasterization improvement`,
        tier: opt.tier,
        warning: wouldBottleneck ? `May be CPU-limited by ${cpu?.model || 'your CPU'} at lower resolutions` : null,
      });
    }
  }

  if (options.length > 0) {
    recs.push({
      component: 'GPU',
      impact: 'High',
      reason: `Your ${gpu.model} is the frame rate limiter at ${monitor?.resolution || '1080p'}. ` +
        `A GPU upgrade would directly increase FPS.`,
      suggestions: options.slice(0, 4),
      priority: 1,
    });
  }

  return recs;
}

// ─────────────────────────────────────────────────────────────
// RAM UPGRADES
// ─────────────────────────────────────────────────────────────

function generateRamUpgrades(profile, isLaptop) {
  const recs = [];
  const { ram } = profile;
  if (!ram) return recs;

  const memType = isLaptop ? 'SODIMM' : 'DIMM';

  // Insufficient capacity
  if (ram.totalGB > 0 && ram.totalGB < 16) {
    const hasEmptySlots = ram.slotsUsed < ram.slotsTotal;
    recs.push({
      component: 'RAM',
      impact: 'Critical',
      reason: hasEmptySlots
        ? `Only ${ram.totalGB} GB with empty slots — cheap and impactful upgrade`
        : `Only ${ram.totalGB} GB (all slots full) — replacement required`,
      suggestions: [{
        model: `${ram.type} ${memType} — upgrade to 16 GB (2×8 GB)`,
        price: ram.type === 'DDR5' ? '$50-$80' : '$35-$55',
        expectedGain: 'Eliminates page file stuttering in modern games',
      }],
      priority: 1,
    });
  } else if (ram.totalGB === 16) {
    recs.push({
      component: 'RAM',
      impact: 'Moderate',
      reason: '16 GB meets minimum — heavy multitasking or streaming will pressure it',
      suggestions: [{
        model: `${ram.type} ${memType} — upgrade to 32 GB`,
        price: ram.type === 'DDR5' ? '$70-$120' : '$50-$80',
        expectedGain: 'Headroom for multitasking, streaming, and future games',
      }],
      priority: 4,
    });
  }

  // XMP not enabled
  if (!ram.isXmpEnabled && ram.speed > 0) {
    recs.push({
      component: 'RAM (BIOS Setting)',
      impact: 'Moderate',
      reason: `RAM at base speed (${ram.speed} MT/s). XMP/DOCP/EXPO is likely not enabled.`,
      suggestions: [{
        model: 'Enable XMP/DOCP/EXPO in BIOS',
        price: 'Free',
        expectedGain: '5-15% memory bandwidth improvement',
      }],
      priority: 2,
    });
  }

  return recs;
}

// ─────────────────────────────────────────────────────────────
// STORAGE UPGRADES
// ─────────────────────────────────────────────────────────────

function generateStorageUpgrades(profile) {
  const recs = [];
  const { storage } = profile;
  if (!storage?.isHDD) return recs;

  const ctrl = storage.controller || {};
  const freeM2 = (ctrl.m2Slots || 0) - storage.disks.filter(d => d.interface === 'NVMe').length;
  const freeSata = (ctrl.sataPorts || 0) - storage.disks.filter(d => d.interface === 'SATA').length;

  let suggestion;
  if (freeM2 > 0) {
    suggestion = { model: 'NVMe M.2 SSD (1 TB)', price: '$60-$90', expectedGain: 'Free M.2 slot — 30-50x faster than HDD' };
  } else if (freeSata > 0) {
    suggestion = { model: '2.5" SATA SSD (1 TB)', price: '$50-$70', expectedGain: 'Free SATA port — 5-10x faster than HDD' };
  } else {
    suggestion = { model: 'SATA or NVMe SSD (1 TB)', price: '$50-$90', expectedGain: 'Replace HDD — eliminates storage bottleneck' };
  }

  recs.push({
    component: 'Storage',
    impact: 'Critical',
    reason: `System drive is an HDD — massive bottleneck for boot, load times, and texture streaming`,
    suggestions: [suggestion],
    priority: 1,
  });

  return recs;
}

// ─────────────────────────────────────────────────────────────
// MONITOR REFRESH RATE UPGRADES (FPS-first — never push resolution)
// ─────────────────────────────────────────────────────────────

function generateMonitorRefreshUpgrades(profile) {
  const recs = [];
  const { gpu, monitor } = profile;
  if (!gpu || !monitor) return recs;

  const refreshRate = monitor.refreshRate || 60;

  // Only recommend if current refresh rate is low and GPU has headroom
  if (refreshRate < 144) {
    const catalogKey = `refresh-upgrade-${monitor.resolution}`;
    const suggestions = (UPGRADE_CATALOG.monitor[catalogKey] || UPGRADE_CATALOG.monitor['refresh-upgrade-1080p'] || []).map(s => ({
      model: s.model,
      price: s.price,
      expectedGain: `${s.refreshRate}Hz = much smoother gameplay than ${refreshRate}Hz`,
    }));

    recs.push({
      component: 'Monitor',
      impact: 'High',
      reason: `Your GPU can push far more than ${refreshRate} FPS at ${monitor.resolution}, ` +
        `but your ${refreshRate}Hz display caps what you actually see. A higher refresh rate monitor delivers noticeably smoother gameplay.`,
      suggestions,
      priority: 2,
    });
  }

  return recs;
}

function checkMonitorRefreshUpgrade(profile) {
  if (!profile.gpu || !profile.monitor) return null;

  const refreshRate = profile.monitor.refreshRate || 60;

  // Only suggest if refresh rate is below 144Hz
  if (refreshRate >= 144) return null;

  const catalogKey = `refresh-upgrade-${profile.monitor.resolution}`;
  const suggestions = (UPGRADE_CATALOG.monitor[catalogKey] || UPGRADE_CATALOG.monitor['refresh-upgrade-1080p'] || []).map(s => ({
    model: s.model,
    price: s.price,
    expectedGain: `${s.refreshRate}Hz for smoother frames at ${profile.monitor.resolution}`,
  }));

  return {
    component: 'Monitor',
    impact: 'Moderate',
    reason: `Your ${refreshRate}Hz display is capping the frame rate your GPU can deliver. ` +
      `A higher refresh rate monitor at ${profile.monitor.resolution} means smoother, more responsive gameplay.`,
    suggestions,
    priority: 3,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function formatCpuModel(key, data) {
  return key.split('-').map((p, i) =>
    i === 0 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)
  ).join('-').replace(/^(I)/, 'i');
}

function findCatalogMatch(type, score) {
  const catalog = UPGRADE_CATALOG[type];
  if (!catalog) return null;

  for (const [, options] of Object.entries(catalog)) {
    for (const opt of options) {
      const optScore = type === 'cpu' ? opt.stScore : opt.rasterScore;
      if (Math.abs(optScore - score) <= 5) return opt;
    }
  }
  return null;
}

function estimatePrice(type, tier) {
  const priceRanges = {
    cpu: { budget: '$80-$130', entry: '$120-$180', mid: '$200-$350', 'high-end': '$350-$500', flagship: '$500-$700' },
    gpu: { budget: '$150-$250', entry: '$250-$350', mid: '$350-$550', 'high-end': '$550-$900', flagship: '$900-$2000' },
  };
  return priceRanges[type]?.[tier] || '$100-$500';
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = { generateUpgradeRecommendations };

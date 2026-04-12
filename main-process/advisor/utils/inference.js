// ═══════════════════════════════════════════════════════════════
// INFERENCE — Resolve Unknown Hardware via Pattern Matching
// ═══════════════════════════════════════════════════════════════
// When a component isn't in the database, this module infers
// its properties from naming patterns, generation heuristics,
// and tier relationships. This allows the system to handle
// future hardware gracefully.
// ═══════════════════════════════════════════════════════════════

'use strict';

const {
  CPU_DATABASE,
  GPU_DATABASE,
  CHIPSET_DATABASE,
  RAM_TIERS,
  TIER_ORDER,
} = require('../data/hardwareDatabase');

// ─────────────────────────────────────────────────────────────
// CPU INFERENCE
// ─────────────────────────────────────────────────────────────

/**
 * Infer CPU properties when not in the database.
 * Uses generation, family, and naming patterns to estimate
 * performance scores and socket.
 */
function inferCpuProperties(parsed) {
  if (!parsed) return null;

  const { brand, generation, suffix, tier, modelNumber } = parsed;

  // Find the closest known CPU in the same generation/brand for baseline
  const candidates = Object.values(CPU_DATABASE)
    .filter(c => c.brand === brand && c.gen === generation);

  if (candidates.length > 0) {
    // Find the closest tier match
    const tierOrd = TIER_ORDER[tier] || 3;
    candidates.sort((a, b) => {
      const da = Math.abs((TIER_ORDER[a.tier] || 3) - tierOrd);
      const db = Math.abs((TIER_ORDER[b.tier] || 3) - tierOrd);
      return da - db;
    });
    const base = candidates[0];

    // Estimate scores with suffix adjustments
    let stAdj = 0;
    let mtAdj = 0;
    if (suffix === 'k' || suffix === 'kf' || suffix === 'ks') stAdj += 3;
    if (suffix === 'ks') stAdj += 2;
    if (suffix === 'x' || suffix === 'xt') stAdj += 2;
    if (suffix === 'x3d') { stAdj -= 2; mtAdj -= 2; } // 3D cache trades clockspeed

    return {
      brand,
      model: parsed.model,
      gen: generation,
      arch: base.arch,
      socket: base.socket,
      cores: base.cores,
      threads: base.threads,
      tier: tier !== 'unknown' ? tier : base.tier,
      stScore: Math.min(100, Math.max(1, base.stScore + stAdj)),
      mtScore: Math.min(100, Math.max(1, base.mtScore + mtAdj)),
      tdp: base.tdp,
      inferred: true,
    };
  }

  // No generation match — extrapolate from trend lines
  return inferCpuFromTrend(parsed);
}

/**
 * Estimate scores for a completely unknown CPU generation
 * using linear extrapolation from known generational trends.
 */
function inferCpuFromTrend(parsed) {
  const { brand, generation, tier } = parsed;

  // Gather all known generations for this brand
  const genScores = {};
  for (const cpu of Object.values(CPU_DATABASE)) {
    if (cpu.brand !== brand) continue;
    if (!genScores[cpu.gen]) genScores[cpu.gen] = [];
    genScores[cpu.gen].push(cpu);
  }

  const gens = Object.keys(genScores).map(Number).sort((a, b) => a - b);
  if (gens.length < 2) return buildFallbackCpu(parsed);

  // Linear extrapolation using last two known generations
  const prevGen = gens[gens.length - 2];
  const lastGen = gens[gens.length - 1];
  const prevAvgSt = avg(genScores[prevGen].map(c => c.stScore));
  const lastAvgSt = avg(genScores[lastGen].map(c => c.stScore));
  const prevAvgMt = avg(genScores[prevGen].map(c => c.mtScore));
  const lastAvgMt = avg(genScores[lastGen].map(c => c.mtScore));

  const genDiff = generation - lastGen;
  const stPerGen = (lastAvgSt - prevAvgSt) / (lastGen - prevGen);
  const mtPerGen = (lastAvgMt - prevAvgMt) / (lastGen - prevGen);

  const socket = brand === 'Intel'
    ? (generation >= 15 ? 'LGA1851' : 'LGA1700')
    : (generation >= 7 ? 'AM5' : 'AM4');

  return {
    brand,
    model: parsed.model,
    gen: generation,
    arch: `${brand} Gen ${generation} (inferred)`,
    socket,
    cores: 8,
    threads: 16,
    tier: tier !== 'unknown' ? tier : 'mid',
    stScore: clamp(lastAvgSt + stPerGen * genDiff, 1, 100),
    mtScore: clamp(lastAvgMt + mtPerGen * genDiff, 1, 100),
    tdp: 125,
    inferred: true,
  };
}

// ─────────────────────────────────────────────────────────────
// GPU INFERENCE
// ─────────────────────────────────────────────────────────────

/**
 * Infer GPU properties when not in the database.
 * Uses model number patterns and vendor trends.
 */
function inferGpuProperties(parsed) {
  if (!parsed) return null;

  const { vendor, normalized } = parsed;

  // Extract the base model number for NVIDIA RTX/GTX
  const numMatch = normalized.match(/\d{4}/);
  if (!numMatch) return buildFallbackGpu(parsed);

  const modelNum = parseInt(numMatch[0]);
  const isSuper = normalized.includes('super');
  const isTi = normalized.includes('ti');

  // Find the closest known GPU from same vendor
  const candidates = Object.entries(GPU_DATABASE)
    .filter(([, g]) => g.vendor === vendor)
    .map(([key, g]) => {
      const kNum = parseInt((key.match(/\d{4}/) || ['0'])[0]);
      return { key, data: g, num: kNum, dist: Math.abs(kNum - modelNum) };
    })
    .sort((a, b) => a.dist - b.dist);

  if (candidates.length > 0) {
    const closest = candidates[0].data;
    const numDiff = modelNum - candidates[0].num;
    // Each model number tier (~10 units) is roughly 5-8% performance
    const scoreAdj = Math.round(numDiff / 10 * 3);
    const tiAdj = isTi ? 8 : 0;
    const superAdj = isSuper ? 4 : 0;

    return {
      vendor,
      model: parsed.model,
      gen: closest.gen,
      arch: `${closest.gen} (inferred)`,
      vram: closest.vram,
      tier: closest.tier,
      rasterScore: clamp(closest.rasterScore + scoreAdj + tiAdj + superAdj, 1, 100),
      rtScore: clamp(closest.rtScore + scoreAdj + tiAdj + superAdj, 1, 100),
      targetRes: closest.targetRes,
      tdp: closest.tdp,
      inferred: true,
    };
  }

  return buildFallbackGpu(parsed);
}

// ─────────────────────────────────────────────────────────────
// CHIPSET INFERENCE
// ─────────────────────────────────────────────────────────────

/**
 * Infer chipset properties when not in the database.
 * Uses chipset naming conventions (Z/B/H/X prefix + number).
 */
function inferChipsetProperties(chipsetId) {
  if (!chipsetId) return null;

  const s = chipsetId.toLowerCase();
  const letter = s.charAt(0);
  const numStr = s.match(/\d+/);
  if (!numStr) return null;
  const num = parseInt(numStr[0]);

  let brand, socket, pcieGen, ramSupport, tier;

  // Intel chipsets: Z/B/H + 3-digit number
  if (['z', 'b', 'h', 'w'].includes(letter) && num >= 100 && num < 999) {
    brand = 'Intel';
    if (num >= 800) { socket = 'LGA1851'; pcieGen = 5; ramSupport = ['DDR5']; }
    else if (num >= 600) { socket = 'LGA1700'; pcieGen = num >= 790 ? 5 : 4; ramSupport = ['DDR4', 'DDR5']; }
    else if (num >= 400) { socket = 'LGA1200'; pcieGen = num >= 590 ? 4 : 3; ramSupport = ['DDR4']; }
    else { socket = 'LGA1151'; pcieGen = 3; ramSupport = ['DDR4']; }
    tier = letter === 'z' || letter === 'w' ? 'enthusiast' : 'mainstream';
  }
  // AMD chipsets: A/B/X + 3-digit number
  else if (['a', 'b', 'x'].includes(letter)) {
    brand = 'AMD';
    if (num >= 600) { socket = 'AM5'; pcieGen = letter === 'a' ? 4 : 5; ramSupport = ['DDR5']; }
    else if (num >= 500) { socket = 'AM4'; pcieGen = 4; ramSupport = ['DDR4']; }
    else { socket = 'AM4'; pcieGen = 3; ramSupport = ['DDR4']; }
    tier = letter === 'x' ? 'enthusiast' : letter === 'b' ? 'mainstream' : 'budget';
  }
  else {
    return null;
  }

  return {
    brand,
    socket,
    supportedGens: [], // can't confidently infer
    pcieGen,
    ramSupport,
    tier,
    inferred: true,
  };
}

// ─────────────────────────────────────────────────────────────
// RAM INFERENCE
// ─────────────────────────────────────────────────────────────

/**
 * Classify RAM speed into a performance tier.
 * Returns the matching tier object from RAM_TIERS.
 */
function classifyRamSpeed(speed, ddrGen) {
  const gen = (ddrGen || 'DDR4').toUpperCase();
  const tiers = RAM_TIERS[gen] || RAM_TIERS.DDR4;
  for (const t of tiers) {
    if (speed >= t.min && speed <= t.max) return t;
  }
  // Above all known tiers — return the highest
  return tiers[tiers.length - 1];
}

// ─────────────────────────────────────────────────────────────
// GENERATION ORDERING — Unified CPU+GPU Generation Comparison
// ─────────────────────────────────────────────────────────────

/**
 * Map GPU generation names to ordinal numbers for comparison.
 * Higher = newer.
 */
const GPU_GEN_ORDER = {
  'Pascal':        1,
  'Turing':        2,
  'Ampere':        3,
  'Ada Lovelace':  4,
  'Blackwell':     5,
  'RDNA 1':        1,
  'RDNA 2':        2,
  'RDNA 3':        3,
  'RDNA 4':        4,
  'Alchemist':     1,
  'Battlemage':    2,
};

/**
 * Compute generation gap between CPU and GPU.
 * Returns a number where negative = CPU is older, positive = GPU is older.
 * The magnitude represents how many "equivalent generations" apart they are.
 */
function computeGenerationGap(cpuData, gpuData) {
  if (!cpuData || !gpuData) return 0;

  // Map CPU gen to a normalized timeline (Intel gens 10-15, AMD gens 3-9 → 0-5 range)
  let cpuGenNorm;
  if (cpuData.brand === 'Intel') {
    cpuGenNorm = (cpuData.gen - 10); // Gen 10 = 0, Gen 15 = 5
  } else {
    // AMD: gen 3=0, 5=1, 7=2, 9=3
    const amdMap = { 1: -2, 2: -1, 3: 0, 5: 1, 7: 2, 9: 3 };
    cpuGenNorm = amdMap[cpuData.gen] ?? 0;
  }

  const gpuGenOrd = GPU_GEN_ORDER[gpuData.gen] || 0;
  // GPU gen 1 (Pascal/RDNA1) ≈ CPU gen 10, so normalize similarly
  const gpuGenNorm = gpuGenOrd - 1;

  return cpuGenNorm - gpuGenNorm; // positive = CPU newer, negative = GPU newer
}

// ─────────────────────────────────────────────────────────────
// FALLBACKS
// ─────────────────────────────────────────────────────────────

function buildFallbackCpu(parsed) {
  return {
    brand: parsed?.brand || 'Unknown',
    model: parsed?.model || 'Unknown CPU',
    gen: parsed?.generation || 0,
    arch: 'Unknown',
    socket: 'Unknown',
    cores: 4,
    threads: 8,
    tier: 'entry',
    stScore: 40,
    mtScore: 30,
    tdp: 65,
    inferred: true,
    fallback: true,
  };
}

function buildFallbackGpu(parsed) {
  return {
    vendor: parsed?.vendor || 'Unknown',
    model: parsed?.model || 'Unknown GPU',
    gen: 'Unknown',
    arch: 'Unknown',
    vram: 8,
    tier: 'entry',
    rasterScore: 30,
    rtScore: 10,
    targetRes: '1080p',
    tdp: 150,
    inferred: true,
    fallback: true,
  };
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

function clamp(val, min, max) { return Math.max(min, Math.min(max, Math.round(val))); }
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  inferCpuProperties,
  inferGpuProperties,
  inferChipsetProperties,
  classifyRamSpeed,
  computeGenerationGap,
  GPU_GEN_ORDER,
};

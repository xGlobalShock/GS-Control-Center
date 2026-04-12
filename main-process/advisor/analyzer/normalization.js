// ═══════════════════════════════════════════════════════════════
// NORMALIZATION — Raw Hardware Data → Structured System Profile
// ═══════════════════════════════════════════════════════════════
// The single entry point that converts raw hardware info (from
// hardwareInfo.js / hardwareMonitor.js) into a fully normalized
// system profile used by all downstream engines.
// ═══════════════════════════════════════════════════════════════

'use strict';

const {
  CPU_DATABASE,
  GPU_DATABASE,
  CHIPSET_DATABASE,
  TIER_ORDER,
} = require('../data/hardwareDatabase');

const {
  parseCpuString,
  parseGpuString,
  parseChipsetFromBoard,
  parseResolution,
  parseRefreshRate,
  inferDdrGeneration,
} = require('../utils/parser');

const {
  inferCpuProperties,
  inferGpuProperties,
  inferChipsetProperties,
  classifyRamSpeed,
} = require('../utils/inference');

// ─────────────────────────────────────────────────────────────
// MAIN NORMALIZER
// ─────────────────────────────────────────────────────────────

/**
 * Normalize raw hardware info into a structured system profile.
 *
 * @param {Object} hw - Raw hardware info object from hardwareInfo.js
 * @returns {Object} Normalized system profile
 */
function normalizeSystemProfile(hw) {
  if (!hw) return buildEmptyProfile();

  const cpu = normalizeCpu(hw);
  const gpu = normalizeGpu(hw);
  const ram = normalizeRam(hw);
  const motherboard = normalizeMotherboard(hw);
  const monitor = normalizeMonitor(hw);
  const psu = normalizePsu(hw);
  const storage = normalizeStorage(hw);
  const formFactor = detectFormFactor(hw);

  return {
    cpu,
    gpu,
    ram,
    motherboard,
    monitor,
    psu,
    storage,
    formFactor,
    // Pre-compute tier alignment for quick access
    tierAlignment: computeTierAlignment(cpu, gpu),
  };
}

// ─────────────────────────────────────────────────────────────
// CPU NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizeCpu(hw) {
  const raw = hw.cpuName || '';
  const parsed = parseCpuString(raw);

  if (parsed) {
    // Try exact database lookup first
    const dbKey = parsed.normalized;
    const dbEntry = CPU_DATABASE[dbKey];

    if (dbEntry) {
      return {
        raw,
        ...dbEntry,
        model: parsed.model,
        suffix: parsed.suffix,
        family: parsed.family,
        cores: hw.cpuCores || dbEntry.cores,
        threads: hw.cpuThreads || dbEntry.threads,
        inferred: false,
      };
    }

    // Not in DB — infer from patterns
    const inferred = inferCpuProperties(parsed);
    if (inferred) {
      return {
        raw,
        ...inferred,
        suffix: parsed.suffix,
        family: parsed.family,
        cores: hw.cpuCores || inferred.cores,
        threads: hw.cpuThreads || inferred.threads,
      };
    }
  }

  // Couldn't parse at all — build minimal profile from available data
  return {
    raw,
    brand: detectCpuBrand(raw),
    model: raw || 'Unknown CPU',
    gen: 0,
    arch: 'Unknown',
    socket: 'Unknown',
    cores: hw.cpuCores || 4,
    threads: hw.cpuThreads || 8,
    tier: 'entry',
    stScore: 40,
    mtScore: 30,
    tdp: 65,
    inferred: true,
    fallback: true,
  };
}

// ─────────────────────────────────────────────────────────────
// GPU NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizeGpu(hw) {
  const raw = hw.gpuName || '';
  const parsed = parseGpuString(raw);

  if (parsed) {
    const dbKey = parsed.normalized;
    const dbEntry = GPU_DATABASE[dbKey];

    if (dbEntry) {
      return {
        raw,
        ...dbEntry,
        model: parsed.model,
        vram: hw.gpuVramTotal ? parseFloat(hw.gpuVramTotal) / 1024 || dbEntry.vram : dbEntry.vram,
        inferred: false,
      };
    }

    const inferred = inferGpuProperties(parsed);
    if (inferred) {
      return {
        raw,
        ...inferred,
        vram: hw.gpuVramTotal ? parseFloat(hw.gpuVramTotal) / 1024 || inferred.vram : inferred.vram,
      };
    }
  }

  return {
    raw,
    vendor: detectGpuVendor(raw),
    model: raw || 'Unknown GPU',
    gen: 'Unknown',
    arch: 'Unknown',
    vram: hw.gpuVramTotal ? parseFloat(hw.gpuVramTotal) / 1024 || 0 : 0,
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
// RAM NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizeRam(hw) {
  const speed = parseInt(hw.ramSpeed) || 0;
  const ddrGen = inferDdrGeneration(speed, hw.ramType);
  const tier = classifyRamSpeed(speed, ddrGen);
  const totalGB = normalizeRamTotal(hw.ramTotalGB);

  return {
    totalGB,
    speed,
    type: ddrGen,
    channels: hw.ramChannels || (hw.ramSlotsUsed >= 2 ? 'dual' : 'single'),
    slotsUsed: hw.ramSlotsUsed || 0,
    slotsTotal: hw.ramSlotsTotal || 0,
    tier: tier.tier,
    score: tier.score,
    label: tier.label,
    isXmpEnabled: speed > 0 && speed > (ddrGen === 'DDR5' ? 4800 : 2400),
  };
}

/**
 * Normalize reported RAM to nearest standard size.
 * OS reports slightly less than physical (e.g., 15.8 GB for 16 GB).
 */
function normalizeRamTotal(reportedGB) {
  if (!reportedGB || reportedGB <= 0) return 0;
  const standardSizes = [2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
  for (const size of standardSizes) {
    const tolerance = size * 0.05;
    if (reportedGB >= size - tolerance && reportedGB <= size + 0.1) return size;
  }
  return Math.round(reportedGB);
}

// ─────────────────────────────────────────────────────────────
// MOTHERBOARD NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizeMotherboard(hw) {
  const boardName = hw.motherboardName || hw.baseBoardProduct || '';
  const chipsetId = parseChipsetFromBoard(boardName);

  if (chipsetId) {
    const dbEntry = CHIPSET_DATABASE[chipsetId];
    if (dbEntry) {
      return {
        raw: boardName,
        chipset: chipsetId.toUpperCase(),
        ...dbEntry,
        inferred: false,
      };
    }

    const inferred = inferChipsetProperties(chipsetId);
    if (inferred) {
      return { raw: boardName, chipset: chipsetId.toUpperCase(), ...inferred };
    }
  }

  return {
    raw: boardName,
    chipset: 'Unknown',
    brand: 'Unknown',
    socket: 'Unknown',
    supportedGens: [],
    pcieGen: 3,
    ramSupport: ['DDR4'],
    tier: 'mainstream',
    inferred: true,
    fallback: true,
  };
}

// ─────────────────────────────────────────────────────────────
// MONITOR NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizeMonitor(hw) {
  const resolution = parseResolution(hw.monitorResolution || hw.resolution);
  const refreshRate = parseRefreshRate(hw.monitorRefreshRate || hw.refreshRate);

  return {
    resolution,
    refreshRate,
    raw: hw.monitorResolution || hw.resolution || '',
  };
}

// ─────────────────────────────────────────────────────────────
// PSU NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizePsu(hw) {
  const wattage = parseInt(hw.psuWattage) || 0;
  return {
    wattage,
    known: wattage > 0,
  };
}

// ─────────────────────────────────────────────────────────────
// STORAGE NORMALIZATION
// ─────────────────────────────────────────────────────────────

function normalizeStorage(hw) {
  const diskType = (hw.diskType || '').toUpperCase();
  const isHDD = diskType.includes('HDD') || diskType === '3' || diskType.includes('UNSPECIFIED');
  const isNVMe = diskType.includes('NVME');

  return {
    raw: hw.diskName || '',
    type: isHDD ? 'HDD' : isNVMe ? 'NVMe' : 'SATA SSD',
    isHDD,
    isNVMe,
    disks: hw.disks || [],
    controller: hw.storageController || {},
  };
}

// ─────────────────────────────────────────────────────────────
// FORM FACTOR DETECTION
// ─────────────────────────────────────────────────────────────

function detectFormFactor(hw) {
  if (hw?.isLaptop || hw?.hasBattery) return 'laptop';
  const cpu = (hw?.cpuName || '').toUpperCase();
  if (/(?:\d{4}(U|H|HS|HX|G\d))/.test(cpu)) return 'laptop';
  if (cpu.includes('APPLE M')) return 'laptop';
  return 'desktop';
}

// ─────────────────────────────────────────────────────────────
// TIER ALIGNMENT
// ─────────────────────────────────────────────────────────────

/**
 * Compute how well-matched CPU and GPU tiers are.
 * Returns a score from 0 (terrible mismatch) to 1 (perfect match).
 */
function computeTierAlignment(cpu, gpu) {
  if (!cpu || !gpu) return 0.5;

  const cpuOrd = TIER_ORDER[cpu.tier] || 3;
  const gpuOrd = TIER_ORDER[gpu.tier] || 3;
  const gap = Math.abs(cpuOrd - gpuOrd);

  // Also factor in performance scores
  const cpuScore = cpu.stScore || 50;
  const gpuScore = gpu.rasterScore || 50;
  const scoreDiff = Math.abs(cpuScore - gpuScore);

  // Weight both tier gap and score gap
  const tierPenalty = gap * 0.15;           // 0.15 per tier gap
  const scorePenalty = (scoreDiff / 100) * 0.3; // up to 0.3 for max score gap
  return Math.max(0, 1 - tierPenalty - scorePenalty);
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function detectCpuBrand(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('intel') || s.includes('core')) return 'Intel';
  if (s.includes('amd') || s.includes('ryzen')) return 'AMD';
  return 'Unknown';
}

function detectGpuVendor(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('nvidia') || s.includes('geforce') || s.includes('rtx') || s.includes('gtx')) return 'NVIDIA';
  if (s.includes('amd') || s.includes('radeon') || s.includes('rx')) return 'AMD';
  if (s.includes('intel') || s.includes('arc')) return 'Intel';
  return 'Unknown';
}

function buildEmptyProfile() {
  return {
    cpu: null,
    gpu: null,
    ram: null,
    motherboard: null,
    monitor: { resolution: '1080p', refreshRate: 60, raw: '' },
    psu: { wattage: 0, known: false },
    storage: { raw: '', type: 'Unknown', isHDD: false, isNVMe: false, disks: [], controller: {} },
    formFactor: 'desktop',
    tierAlignment: 0.5,
  };
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  normalizeSystemProfile,
  normalizeRamTotal,
  detectFormFactor,
};

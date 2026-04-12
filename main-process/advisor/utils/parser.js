// ═══════════════════════════════════════════════════════════════
// PARSER — Raw Hardware String → Structured Tokens
// ═══════════════════════════════════════════════════════════════
// Extracts brand, model number, generation, and variant from
// messy real-world hardware strings reported by system APIs.
// ═══════════════════════════════════════════════════════════════

'use strict';

// ─────────────────────────────────────────────────────────────
// CPU PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Parse a raw CPU string into structured tokens.
 * Handles formats like:
 *   "Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz"
 *   "AMD Ryzen 7 5800X 8-Core Processor"
 *   "i7 14700K"
 *   "10900K"
 *   "Core Ultra 9 285K"
 */
function parseCpuString(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const s = raw
    .replace(/\(R\)|\(TM\)|CPU|Processor|@.*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // ── Intel Core Ultra (15th gen+) ───────────────────────────
  const ultraMatch = s.match(/(?:intel\s+)?core\s+ultra\s+(\d)\s+(\d{3})(k|kf|ks|f|t|s)?/i);
  if (ultraMatch) {
    const tierNum = parseInt(ultraMatch[1]);
    const model = parseInt(ultraMatch[2]);
    const suffix = (ultraMatch[3] || '').toLowerCase();
    const tierMap = { 5: 'mid', 7: 'high-end', 9: 'flagship' };
    return {
      brand: 'Intel',
      family: `Core Ultra ${tierNum}`,
      model: `Core Ultra ${tierNum} ${model}${suffix.toUpperCase()}`,
      modelNumber: model,
      generation: 15,
      suffix,
      tier: tierMap[tierNum] || 'mid',
      normalized: `core ultra ${tierNum} ${model}${suffix}`,
    };
  }

  // ── Intel Core iX ──────────────────────────────────────────
  // Matches: i9-10900K, i7 14700KF, i5-12400F, i3 10100, etc.
  const intelMatch = s.match(/(?:intel\s+)?(?:core\s+)?i([3579])[\s-]?(\d{4,5})(k|kf|ks|f|t|te|s)?/i);
  if (intelMatch) {
    const tierNum = parseInt(intelMatch[1]);
    const model = parseInt(intelMatch[2]);
    const suffix = (intelMatch[3] || '').toLowerCase();
    const generation = deriveIntelGeneration(model);
    const tierMap = { 3: 'budget', 5: 'mid', 7: 'high-end', 9: 'flagship' };

    // Adjust tier based on suffix — K/KF are typically one notch higher
    let tier = tierMap[tierNum] || 'mid';
    if (suffix.includes('k') && tier !== 'flagship') {
      const tiers = ['budget', 'entry', 'mid', 'high-end', 'flagship'];
      const idx = tiers.indexOf(tier);
      if (idx >= 0 && idx < tiers.length - 1) tier = tiers[idx + 1];
    }

    return {
      brand: 'Intel',
      family: `Core i${tierNum}`,
      model: `i${tierNum}-${model}${suffix.toUpperCase()}`,
      modelNumber: model,
      generation,
      suffix,
      tier,
      normalized: `i${tierNum}-${model}${suffix}`,
    };
  }

  // ── Bare Intel model number (e.g., "10900K") ──────────────
  const bareIntelMatch = s.match(/^(\d{4,5})(k|kf|ks|f|t)?$/i);
  if (bareIntelMatch) {
    const model = parseInt(bareIntelMatch[1]);
    const suffix = (bareIntelMatch[2] || '').toLowerCase();
    const generation = deriveIntelGeneration(model);
    return {
      brand: 'Intel',
      family: 'Core (inferred)',
      model: `${model}${suffix.toUpperCase()}`,
      modelNumber: model,
      generation,
      suffix,
      tier: 'unknown',
      normalized: `${model}${suffix}`,
    };
  }

  // ── AMD Ryzen ──────────────────────────────────────────────
  // Matches: Ryzen 9 5950X, Ryzen 7 7800X3D, Ryzen 5 3600, etc.
  const amdMatch = s.match(/(?:amd\s+)?ryzen\s+([3579])\s+(\d{4})(x|xt|x3d|g|ge)?/i);
  if (amdMatch) {
    const tierNum = parseInt(amdMatch[1]);
    const model = parseInt(amdMatch[2]);
    const suffix = (amdMatch[3] || '').toLowerCase();
    const generation = deriveAmdGeneration(model);
    const tierMap = { 3: 'budget', 5: 'mid', 7: 'high-end', 9: 'flagship' };

    let tier = tierMap[tierNum] || 'mid';
    if ((suffix === 'x' || suffix === 'xt' || suffix === 'x3d') && tier !== 'flagship') {
      const tiers = ['budget', 'entry', 'mid', 'high-end', 'flagship'];
      const idx = tiers.indexOf(tier);
      if (idx >= 0 && idx < tiers.length - 1) tier = tiers[idx + 1];
    }

    return {
      brand: 'AMD',
      family: `Ryzen ${tierNum}`,
      model: `Ryzen ${tierNum} ${model}${suffix.toUpperCase()}`,
      modelNumber: model,
      generation,
      suffix,
      tier,
      normalized: `ryzen ${tierNum} ${model}${suffix}`,
    };
  }

  return null;
}

/**
 * Derive Intel desktop generation from model number.
 * 10th gen: 10xxx, 11th gen: 11xxx, 12th gen: 12xxx, etc.
 */
function deriveIntelGeneration(modelNumber) {
  if (modelNumber >= 15000) return 15;
  if (modelNumber >= 14000) return 14;
  if (modelNumber >= 13000) return 13;
  if (modelNumber >= 12000) return 12;
  if (modelNumber >= 11000) return 11;
  if (modelNumber >= 10000) return 10;
  if (modelNumber >= 9000)  return 9;
  if (modelNumber >= 8000)  return 8;
  if (modelNumber >= 7000)  return 7;
  return 6;
}

/**
 * Derive AMD Ryzen generation from model number.
 * 1xxx=Zen1, 2xxx=Zen+, 3xxx=Zen2, 5xxx=Zen3, 7xxx=Zen4, 9xxx=Zen5
 */
function deriveAmdGeneration(modelNumber) {
  if (modelNumber >= 9000) return 9;
  if (modelNumber >= 7000) return 7;
  if (modelNumber >= 5000) return 5;
  if (modelNumber >= 3000) return 3;
  if (modelNumber >= 2000) return 2;
  return 1;
}

// ─────────────────────────────────────────────────────────────
// GPU PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Parse a raw GPU string into structured tokens.
 * Handles:
 *   "NVIDIA GeForce RTX 4090"
 *   "AMD Radeon RX 7900 XTX"
 *   "RTX 5080"
 *   "5080"
 *   "Intel(R) Arc(TM) A770"
 */
function parseGpuString(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const s = raw
    .replace(/\(R\)|\(TM\)/gi, '')
    .replace(/NVIDIA\s+GeForce\s*/i, '')
    .replace(/AMD\s+Radeon\s*/i, '')
    .replace(/Intel\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // ── NVIDIA RTX/GTX ─────────────────────────────────────────
  const nvidiaMatch = s.match(/((?:rtx|gtx)\s*\d{4})\s*(ti|super|ti\s+super)?/i);
  if (nvidiaMatch) {
    const base = nvidiaMatch[1].replace(/\s+/g, ' ').trim();
    const variant = (nvidiaMatch[2] || '').replace(/\s+/g, ' ').trim();
    const full = variant ? `${base} ${variant}` : base;
    return {
      vendor: 'NVIDIA',
      model: full,
      normalized: full,
    };
  }

  // ── AMD Radeon RX ──────────────────────────────────────────
  const amdMatch = s.match(/(rx\s*\d{4})\s*(xt|xtx|gre)?/i);
  if (amdMatch) {
    const base = amdMatch[1].replace(/\s+/g, ' ').trim();
    const variant = (amdMatch[2] || '').trim();
    const full = variant ? `${base} ${variant}` : base;
    return {
      vendor: 'AMD',
      model: full,
      normalized: full,
    };
  }

  // ── Intel Arc ──────────────────────────────────────────────
  const arcMatch = s.match(/arc\s+(a|b)(\d{3})/i);
  if (arcMatch) {
    const series = arcMatch[1].toLowerCase();
    const model = arcMatch[2];
    const full = `arc ${series}${model}`;
    return {
      vendor: 'Intel',
      model: full,
      normalized: full,
    };
  }

  // ── Bare model number (e.g., "5080", "4090") ──────────────
  const bareMatch = s.match(/^(\d{4})\s*(ti|super|ti\s+super)?$/i);
  if (bareMatch) {
    const num = parseInt(bareMatch[1]);
    const variant = (bareMatch[2] || '').replace(/\s+/g, ' ').trim();
    // Infer vendor from number range
    let prefix;
    if (num >= 1000 && num <= 1999) prefix = 'gtx';
    else if (num >= 2000 && num <= 5999) prefix = 'rtx';
    else if (num >= 6000 && num <= 9999) prefix = 'rx';
    else prefix = 'rtx'; // default guess

    const full = variant ? `${prefix} ${num} ${variant}` : `${prefix} ${num}`;
    return {
      vendor: prefix === 'rx' ? 'AMD' : 'NVIDIA',
      model: full,
      normalized: full,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// CHIPSET PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Extract chipset identifier from motherboard name.
 * Input: "ASUS ROG STRIX Z790-E GAMING WIFI"
 * Output: "z790"
 */
function parseChipsetFromBoard(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const s = raw.toLowerCase();

  // Intel chipsets
  const intelMatch = s.match(/\b(z|b|h|w)\s*(\d{3})\b/i);
  if (intelMatch) {
    return `${intelMatch[1].toLowerCase()}${intelMatch[2]}`;
  }

  // AMD chipsets
  const amdMatch = s.match(/\b(a|b|x)\s*(\d{3})(e)?\b/i);
  if (amdMatch) {
    const suffix = (amdMatch[3] || '').toLowerCase();
    return `${amdMatch[1].toLowerCase()}${amdMatch[2]}${suffix}`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// RESOLUTION PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Normalize resolution from various formats:
 *   "1920x1080" → "1080p"
 *   "2560x1440" → "1440p"
 *   "3840x2160" → "4k"
 *   "1080p" → "1080p"
 */
function parseResolution(raw) {
  if (!raw || typeof raw !== 'string') return '1080p';

  const s = raw.toLowerCase().trim();

  // Already-normalized
  if (['720p', '1080p', '1440p', '4k', '1080p ultrawide', '1440p ultrawide'].includes(s)) return s;

  // Pixel dimensions
  const dimMatch = s.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (dimMatch) {
    const w = parseInt(dimMatch[1]);
    const h = parseInt(dimMatch[2]);

    if (w >= 3840) return '4k';
    if (w >= 3440 && h <= 1440) return '1440p ultrawide';
    if (w >= 2560 && h >= 1440) return '1440p';
    if (w >= 2560 && h <= 1080) return '1080p ultrawide';
    if (w >= 1920) return '1080p';
    return '720p';
  }

  // Partial matches
  if (s.includes('4k') || s.includes('2160')) return '4k';
  if (s.includes('1440')) return '1440p';
  if (s.includes('1080')) return '1080p';
  if (s.includes('720')) return '720p';

  return '1080p'; // safe default
}

/**
 * Parse refresh rate from string or number.
 * Returns integer Hz value.
 */
function parseRefreshRate(raw) {
  if (typeof raw === 'number' && raw > 0) return Math.round(raw);
  if (!raw || typeof raw !== 'string') return 60;

  const match = raw.match(/(\d{2,3})\s*(?:hz)?/i);
  return match ? parseInt(match[1]) : 60;
}

// ─────────────────────────────────────────────────────────────
// RAM PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Infer DDR generation from speed.
 * DDR4 maxes out around 5000 MT/s; DDR5 starts at 4800 but
 * we use the explicit type when available.
 */
function inferDdrGeneration(speed, explicitType) {
  if (explicitType) {
    const t = explicitType.toUpperCase();
    if (t.includes('DDR5')) return 'DDR5';
    if (t.includes('DDR4')) return 'DDR4';
    if (t.includes('DDR3')) return 'DDR3';
  }
  if (!speed || speed <= 0) return 'DDR4'; // safe default
  if (speed >= 4800) return 'DDR5';
  return 'DDR4';
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  parseCpuString,
  parseGpuString,
  parseChipsetFromBoard,
  parseResolution,
  parseRefreshRate,
  inferDdrGeneration,
  deriveIntelGeneration,
  deriveAmdGeneration,
};

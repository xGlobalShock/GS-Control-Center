// ═══════════════════════════════════════════════════════════════
// COMPATIBILITY ENGINE — Cross-Component Validation
// ═══════════════════════════════════════════════════════════════
// Validates hardware combinations and detects incompatibilities,
// dead-end platforms, and sub-optimal configurations.
// ═══════════════════════════════════════════════════════════════

'use strict';

const { CHIPSET_DATABASE, TIER_ORDER } = require('../data/hardwareDatabase');

// ─────────────────────────────────────────────────────────────
// MAIN COMPATIBILITY CHECK
// ─────────────────────────────────────────────────────────────

/**
 * Run all compatibility checks against a normalized system profile.
 * Returns an array of issues, each with severity and details.
 *
 * @param {Object} profile - Normalized system profile from normalization.js
 * @returns {Array} Compatibility issues
 */
function checkCompatibility(profile) {
  if (!profile) return [];

  const issues = [];

  checkCpuMotherboard(profile, issues);
  checkRamMotherboard(profile, issues);
  checkRamCpu(profile, issues);
  checkPcieGeneration(profile, issues);
  checkPlatformUpgradePath(profile, issues);
  checkPsuHeadroom(profile, issues);

  return issues;
}

// ─────────────────────────────────────────────────────────────
// CPU ↔ MOTHERBOARD SOCKET COMPATIBILITY
// ─────────────────────────────────────────────────────────────

function checkCpuMotherboard(profile, issues) {
  const { cpu, motherboard } = profile;
  if (!cpu || !motherboard) return;
  if (cpu.fallback || motherboard.fallback) return;

  // Socket mismatch
  if (cpu.socket !== 'Unknown' && motherboard.socket !== 'Unknown' &&
      cpu.socket !== motherboard.socket) {
    issues.push({
      id: 'socket-mismatch',
      severity: 'critical',
      category: 'compatibility',
      title: 'CPU/Motherboard Socket Mismatch',
      description: `Your ${cpu.model} requires ${cpu.socket}, but your ${motherboard.chipset} motherboard uses ${motherboard.socket}. These are physically incompatible.`,
      components: ['cpu', 'motherboard'],
    });
    return; // No point checking further if socket is wrong
  }

  // CPU generation not supported by chipset
  if (cpu.gen > 0 && motherboard.supportedGens?.length > 0) {
    if (!motherboard.supportedGens.includes(cpu.gen)) {
      issues.push({
        id: 'gen-unsupported',
        severity: 'critical',
        category: 'compatibility',
        title: 'CPU Generation Not Supported',
        description: `Your ${cpu.model} (Gen ${cpu.gen}) is not supported by the ${motherboard.chipset} chipset. ` +
          `Supported generations: ${motherboard.supportedGens.join(', ')}.`,
        components: ['cpu', 'motherboard'],
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// RAM ↔ MOTHERBOARD COMPATIBILITY
// ─────────────────────────────────────────────────────────────

function checkRamMotherboard(profile, issues) {
  const { ram, motherboard } = profile;
  if (!ram || !motherboard) return;
  if (motherboard.fallback) return;

  // DDR generation mismatch
  if (ram.type && motherboard.ramSupport?.length > 0) {
    if (!motherboard.ramSupport.includes(ram.type)) {
      issues.push({
        id: 'ram-type-mismatch',
        severity: 'critical',
        category: 'compatibility',
        title: 'RAM Type Incompatible',
        description: `Your ${ram.type} RAM is not supported by your ${motherboard.chipset} motherboard. ` +
          `Supported: ${motherboard.ramSupport.join(', ')}.`,
        components: ['ram', 'motherboard'],
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// RAM ↔ CPU PLATFORM COMPATIBILITY
// ─────────────────────────────────────────────────────────────

function checkRamCpu(profile, issues) {
  const { cpu, ram } = profile;
  if (!cpu || !ram) return;

  // DDR5 CPU with DDR4 RAM (or vice versa) — platform-level issue
  if (cpu.socket === 'AM5' && ram.type === 'DDR4') {
    issues.push({
      id: 'ram-cpu-gen-mismatch',
      severity: 'critical',
      category: 'compatibility',
      title: 'DDR4 on DDR5 Platform',
      description: `AM5 processors (${cpu.model}) require DDR5 memory. Your DDR4 RAM is not compatible.`,
      components: ['ram', 'cpu'],
    });
  }
  if (cpu.socket === 'LGA1851' && ram.type === 'DDR4') {
    issues.push({
      id: 'ram-cpu-gen-mismatch',
      severity: 'critical',
      category: 'compatibility',
      title: 'DDR4 on DDR5 Platform',
      description: `LGA1851 processors (${cpu.model}) require DDR5 memory. Your DDR4 RAM is not compatible.`,
      components: ['ram', 'cpu'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// PCIe GENERATION LIMITATIONS
// ─────────────────────────────────────────────────────────────

function checkPcieGeneration(profile, issues) {
  const { gpu, motherboard } = profile;
  if (!gpu || !motherboard) return;
  if (motherboard.fallback) return;

  // Newer GPUs on old PCIe platforms lose bandwidth
  const gpuNeedsPcie4 = gpu.rasterScore > 50; // Mid-range+ GPUs need PCIe 4.0
  if (gpuNeedsPcie4 && motherboard.pcieGen < 4) {
    issues.push({
      id: 'pcie-bottleneck',
      severity: 'warning',
      category: 'compatibility',
      title: 'PCIe Generation Limitation',
      description: `Your ${motherboard.chipset} only supports PCIe Gen ${motherboard.pcieGen}. ` +
        `Your ${gpu.model} may lose 5-10% performance due to bandwidth limitations.`,
      components: ['gpu', 'motherboard'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// PLATFORM UPGRADE PATH ANALYSIS
// ─────────────────────────────────────────────────────────────

function checkPlatformUpgradePath(profile, issues) {
  const { cpu, motherboard } = profile;
  if (!cpu || !motherboard) return;
  if (motherboard.fallback) return;

  // Check if the platform is a dead end (no newer CPUs available)
  const socket = motherboard.socket;
  const deadEndSockets = ['LGA1200', 'LGA1151', 'AM4']; // No new CPUs being made

  if (deadEndSockets.includes(socket)) {
    // Find the best CPU available for this socket
    const { CPU_DATABASE } = require('../data/hardwareDatabase');
    const bestOnPlatform = Object.values(CPU_DATABASE)
      .filter(c => c.socket === socket)
      .sort((a, b) => b.stScore - a.stScore)[0];

    const currentScore = cpu.stScore || 0;
    const headroom = bestOnPlatform ? bestOnPlatform.stScore - currentScore : 0;

    if (headroom <= 5) {
      issues.push({
        id: 'platform-dead-end',
        severity: 'info',
        category: 'upgrade-path',
        title: 'Platform at End of Life',
        description: `Your ${socket} platform (${motherboard.chipset}) has no further CPU upgrades available. ` +
          `You already have near-top performance for this socket. A meaningful CPU upgrade requires a new motherboard and potentially new RAM.`,
        components: ['cpu', 'motherboard'],
      });
    } else if (headroom > 5) {
      issues.push({
        id: 'platform-upgrade-available',
        severity: 'info',
        category: 'upgrade-path',
        title: 'Drop-in CPU Upgrade Available',
        description: `Your ${socket} platform still has room to upgrade. ` +
          `You can improve single-thread performance by ~${Math.round(((bestOnPlatform.stScore / currentScore) - 1) * 100)}% ` +
          `without changing your motherboard.`,
        components: ['cpu'],
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PSU HEADROOM CHECK
// ─────────────────────────────────────────────────────────────

function checkPsuHeadroom(profile, issues) {
  const { cpu, gpu, psu } = profile;
  if (!psu?.known || !cpu || !gpu) return;

  const estimatedDraw = (cpu.tdp || 125) + (gpu.tdp || 200) + 100; // +100W for rest of system
  const headroomPct = ((psu.wattage - estimatedDraw) / psu.wattage) * 100;

  if (headroomPct < 0) {
    issues.push({
      id: 'psu-insufficient',
      severity: 'critical',
      category: 'compatibility',
      title: 'PSU Wattage Insufficient',
      description: `Estimated system draw (~${estimatedDraw}W) exceeds your ${psu.wattage}W PSU. ` +
        `This can cause crashes, shutdowns, and component damage under load.`,
      components: ['psu'],
    });
  } else if (headroomPct < 15) {
    issues.push({
      id: 'psu-tight',
      severity: 'warning',
      category: 'compatibility',
      title: 'PSU Headroom Tight',
      description: `Estimated system draw (~${estimatedDraw}W) leaves only ${Math.round(headroomPct)}% headroom ` +
        `on your ${psu.wattage}W PSU. Transient power spikes may cause instability.`,
      components: ['psu'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// MONITOR ↔ GPU MATCH
// ─────────────────────────────────────────────────────────────

function checkMonitorGpuMatch(profile, issues) {
  const { gpu, monitor } = profile;
  if (!gpu || !monitor) return;

  const resOrder = { '720p': 1, '1080p': 2, '1080p ultrawide': 3, '1440p': 4, '1440p ultrawide': 5, '4k': 6 };
  const targetOrder = resOrder[gpu.targetRes] || 2;
  const monitorOrder = resOrder[monitor.resolution] || 2;
  const refreshRate = monitor.refreshRate || 60;

  // FPS-first: lower resolution is GOOD — it means more frames.
  // Only flag if the refresh rate is low (≤75Hz), because then the
  // GPU headroom isn't being used for frames either.
  // The fix is always: higher refresh rate (never higher resolution).
  if (targetOrder - monitorOrder >= 2 && refreshRate <= 75) {
    issues.push({
      id: 'monitor-low-refresh',
      severity: 'info',
      category: 'optimization',
      title: 'Low Refresh Rate Limiting FPS',
      description: `Your ${gpu.model} can push far more than ${refreshRate} FPS at ${monitor.resolution}, but your monitor caps at ${refreshRate}Hz. ` +
        `You're leaving significant frame rate on the table. A higher refresh rate monitor (144Hz+) at ${monitor.resolution} would make gameplay noticeably smoother.`,
      components: ['gpu', 'monitor'],
      suggestions: [
        `Upgrade to a ${monitor.resolution} 144Hz or 240Hz monitor for much smoother gameplay`,
        'Your GPU has plenty of headroom — a higher refresh rate display will use it for smoother frames',
      ],
    });
  }

  // Monitor resolution too high for GPU
  if (monitorOrder - targetOrder >= 2) {
    issues.push({
      id: 'gpu-underpowered-for-monitor',
      severity: 'warning',
      category: 'optimization',
      title: 'GPU Underpowered for Monitor',
      description: `Your ${gpu.model} targets ${gpu.targetRes}, but your monitor runs at ${monitor.resolution}. ` +
        `Expect significantly reduced frame rates. Consider DLSS/FSR upscaling or lowering render resolution.`,
      components: ['gpu', 'monitor'],
    });
  }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = { checkCompatibility };

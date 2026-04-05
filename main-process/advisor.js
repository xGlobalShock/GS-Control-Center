const { ipcMain, shell } = require('electron');

/**
 * System Advisor — Topology-Aware Hardware Intelligence Engine
 * Fully constraint-aware, confidence-driven upgrade & diagnostics system
 */

// ─────────────────────────────────────────────────────────────
// 🧰 UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

function normalizeRamTotal(reportedGB) {
  if (!reportedGB || reportedGB <= 0) return 0;
  const standardSizes = [2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
  for (const size of standardSizes) {
    const tolerance = size * 0.05;
    if (reportedGB >= size - tolerance && reportedGB <= size + 0.1) return size;
  }
  return Math.round(reportedGB);
}

function classifyCpuTemp(temp, cpuName) {
  if (!temp || temp <= 0) return { status: 'unknown', threshold: 0 };
  const isAMD = (cpuName || '').toLowerCase().includes('amd');
  const warn = isAMD ? 80 : 82;
  const crit = isAMD ? 90 : 92;
  if (temp >= crit) return { status: 'critical', threshold: crit };
  if (temp >= warn) return { status: 'warning', threshold: warn };
  return { status: 'normal', threshold: warn };
}

function classifyGpuTemp(temp) {
  if (!temp || temp <= 0) return 'unknown';
  if (temp >= 90) return 'critical';
  if (temp >= 80) return 'warning';
  return 'normal';
}

function detectIsLaptop(hw) {
  if (hw?.isLaptop || hw?.hasBattery) return true;
  const cpu = (hw?.cpuName || '').toUpperCase();
  if (/(?:\d{4}(U|H|HS|HX|G\d))/.test(cpu)) return true;
  if (cpu.includes('APPLE M')) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// 🔥 INSIGHT ANALYSIS — runs every 8 s with live stats
// ─────────────────────────────────────────────────────────────

function analyzeSystem(stats, hw) {
  const insights = [];
  if (!stats) return [{ id: 'no-data', severity: 'warning', icon: 'activity', title: 'Waiting for Data', description: 'System metrics are not available yet. Monitoring will start shortly.', suggestions: [] }];

  const {
    cpu = 0,
    gpuUsage = -1,
    gpuTemp = 0,
    gpuVramUsed = 0,
    gpuVramTotal = 0,
    temperature = 0,
    disk = 0,
    ramTotalGB = 0,
    ramUsedGB = 0,
    ramAvailableGB = 0,
    latencyMs = -1,
    packetLoss = -1,
    processCount = 0,
  } = stats;

  const ramPct = ramTotalGB > 0 ? (ramUsedGB / ramTotalGB) * 100 : 0;
  const vramPct = gpuVramTotal > 0 ? (gpuVramUsed / gpuVramTotal) * 100 : 0;

  // ── CPU Usage ──
  if (cpu >= 90) {
    insights.push({
      id: 'cpu-high',
      severity: 'critical',
      icon: 'cpu',
      title: 'CPU Usage Critical',
      description: `CPU is at ${Math.round(cpu)}% — the processor is under heavy sustained load. This will cause stutters, slowdowns, and thermal throttling.`,
      suggestions: [
        'Close background applications from Task Manager',
        'Check for runaway processes (antivirus scans, updates)',
        'Lower in-game CPU-heavy settings (physics, draw distance, AI)',
        'Consider upgrading to a CPU with more cores/threads',
      ],
    });
  } else if (cpu >= 75) {
    insights.push({
      id: 'cpu-elevated',
      severity: 'warning',
      icon: 'cpu',
      title: 'CPU Usage Elevated',
      description: `CPU is at ${Math.round(cpu)}% — approaching headroom limit. Spikes could cause frame drops.`,
      suggestions: [
        'Close unnecessary background apps',
        'Disable startup programs you don\'t need',
      ],
    });
  }

  // ── CPU Bottleneck (CPU high + GPU underutilized) ──
  if (cpu > 80 && gpuUsage >= 0 && gpuUsage < 60) {
    insights.push({
      id: 'cpu-bottleneck',
      severity: 'critical',
      icon: 'cpu',
      title: 'CPU Bottleneck Detected',
      description: `CPU at ${Math.round(cpu)}% while GPU is only at ${Math.round(gpuUsage)}%. The CPU is limiting GPU performance — the GPU could do more work but is starved for data.`,
      suggestions: [
        'Lower CPU-bound settings: view distance, physics, NPC count',
        'Increase resolution or GPU-heavy settings to balance the load',
        'Enable frame cap to reduce CPU overhead',
      ],
    });
  }

  // ── CPU Temperature ──
  const cpuThermal = classifyCpuTemp(temperature, hw?.cpuName);
  if (cpuThermal.status === 'critical') {
    insights.push({
      id: 'cpu-thermal',
      severity: 'critical',
      icon: 'thermometer',
      title: 'CPU Overheating',
      description: `CPU is at ${Math.round(temperature)}°C — exceeding safe limits. Thermal throttling is active, severely reducing performance.`,
      suggestions: [
        'Clean dust from heatsink and fans immediately',
        'Reapply thermal paste if temperatures remain high',
        'Improve case airflow (open side panel as emergency measure)',
        'Ensure CPU cooler is properly mounted',
      ],
    });
  } else if (cpuThermal.status === 'warning') {
    insights.push({
      id: 'cpu-warm',
      severity: 'warning',
      icon: 'thermometer',
      title: 'CPU Running Warm',
      description: `CPU is at ${Math.round(temperature)}°C — safe but approaching thermal limits under sustained load.`,
      suggestions: [
        'Check that fans are spinning correctly',
        'Clean dust buildup from heatsink',
        'Consider improving case ventilation',
      ],
    });
  }

  // ── GPU Usage ──
  if (gpuUsage >= 95) {
    insights.push({
      id: 'gpu-maxed',
      severity: 'warning',
      icon: 'gpu',
      title: 'GPU Fully Loaded',
      description: `GPU is running at ${Math.round(gpuUsage)}% — maxed out. Frame rates are GPU-limited.`,
      suggestions: [
        'Lower resolution or render scale',
        'Reduce graphical quality (shadows, reflections, anti-aliasing)',
        'Enable DLSS/FSR/XeSS if supported',
      ],
    });
  }

  // ── GPU Temperature ──
  const gpuThermalStatus = classifyGpuTemp(gpuTemp);
  if (gpuThermalStatus === 'critical') {
    insights.push({
      id: 'gpu-thermal',
      severity: 'critical',
      icon: 'thermometer',
      title: 'GPU Overheating',
      description: `GPU is at ${Math.round(gpuTemp)}°C — dangerously hot. Thermal throttling will cap clocks and reduce FPS significantly.`,
      suggestions: [
        'Improve case airflow — ensure exhaust fans are working',
        'Set a more aggressive GPU fan curve in MSI Afterburner',
        'Reduce GPU load by lowering graphics settings',
        'Repaste the GPU if it\'s an older card',
      ],
    });
  } else if (gpuThermalStatus === 'warning') {
    insights.push({
      id: 'gpu-warm',
      severity: 'warning',
      icon: 'thermometer',
      title: 'GPU Running Warm',
      description: `GPU is at ${Math.round(gpuTemp)}°C — hot but within spec. Sustained loads may push into throttle territory.`,
      suggestions: [
        'Check GPU fan speed — increase if set to "quiet" profile',
        'Ensure no cables are blocking GPU fans',
      ],
    });
  }

  // ── VRAM Pressure ──
  if (vramPct > 95) {
    insights.push({
      id: 'vram-full',
      severity: 'critical',
      icon: 'gpu',
      title: 'VRAM Full',
      description: `GPU memory is at ${Math.round(vramPct)}% (${gpuVramUsed}/${gpuVramTotal} MB). Textures are being offloaded to system RAM, causing severe stuttering.`,
      suggestions: [
        'Lower texture quality to Medium or Low',
        'Reduce resolution or render scale',
        'Close other GPU-intensive applications',
      ],
    });
  } else if (vramPct > 80) {
    insights.push({
      id: 'vram-high',
      severity: 'warning',
      icon: 'gpu',
      title: 'VRAM Usage High',
      description: `GPU memory is at ${Math.round(vramPct)}% (${gpuVramUsed}/${gpuVramTotal} MB). Room for overhead is thin — texture streaming may hitch.`,
      suggestions: [
        'Avoid Ultra textures if VRAM is under 8 GB',
        'Close browser tabs with hardware acceleration',
      ],
    });
  }

  // ── RAM Pressure ──
  if (ramPct >= 90) {
    insights.push({
      id: 'ram-critical',
      severity: 'critical',
      icon: 'memory',
      title: 'Memory Almost Full',
      description: `RAM is at ${Math.round(ramPct)}% (${ramUsedGB.toFixed(1)} / ${ramTotalGB} GB). Windows is actively paging to disk — massive performance penalty.`,
      suggestions: [
        'Close memory-heavy apps (browsers, Electron apps, IDEs)',
        'Reduce browser tab count',
        'Restart the app/game to clear memory leaks',
        `Consider upgrading to ${normalizeRamTotal(ramTotalGB) <= 8 ? '16' : '32'} GB RAM`,
      ],
    });
  } else if (ramPct >= 75) {
    insights.push({
      id: 'ram-elevated',
      severity: 'warning',
      icon: 'memory',
      title: 'Memory Usage Elevated',
      description: `RAM is at ${Math.round(ramPct)}% (${ramUsedGB.toFixed(1)} / ${ramTotalGB} GB). Headroom is limited — launching more apps may trigger paging.`,
      suggestions: [
        'Close apps you\'re not actively using',
        'Disable browser hardware acceleration if not gaming',
      ],
    });
  }

  // ── Disk Space ──
  if (disk >= 90) {
    insights.push({
      id: 'disk-critical',
      severity: 'critical',
      icon: 'disk',
      title: 'Storage Almost Full',
      description: `Disk is ${Math.round(disk)}% full. System stability is at risk — Windows needs free space for page file, temp files, and updates.`,
      suggestions: [
        'Run Disk Cleanup or use the GS Center Cleaner',
        'Uninstall unused programs and games',
        'Move large files to an external or secondary drive',
      ],
    });
  } else if (disk >= 80) {
    insights.push({
      id: 'disk-high',
      severity: 'warning',
      icon: 'disk',
      title: 'Storage Getting Full',
      description: `Disk is ${Math.round(disk)}% full. Consider freeing space soon to maintain performance.`,
      suggestions: [
        'Clear temp files and browser cache',
        'Use GS Center Cleaner for automated cleanup',
      ],
    });
  }

  // ── Network Latency ──
  if (latencyMs > 0) {
    if (latencyMs >= 180) {
      insights.push({
        id: 'latency-high',
        severity: 'critical',
        icon: 'network',
        title: 'High Network Latency',
        description: `Ping is ${Math.round(latencyMs)} ms — online games will feel sluggish with delayed inputs and rubber-banding.`,
        suggestions: [
          'Switch to a wired Ethernet connection',
          'Close bandwidth-heavy apps (streaming, downloads, cloud sync)',
          'Move closer to your router or use 5 GHz Wi-Fi',
          'Try a different DNS provider (1.1.1.1 or 8.8.8.8)',
        ],
      });
    } else if (latencyMs >= 95) {
      insights.push({
        id: 'latency-moderate',
        severity: 'warning',
        icon: 'network',
        title: 'Elevated Network Latency',
        description: `Ping is ${Math.round(latencyMs)} ms — noticeable input delay in online and competitive games.`,
        suggestions: [
          'Use Ethernet cable for lower, more stable ping',
          'Close background downloads or streaming',
        ],
      });
    }
  }

  // ── Packet Loss ──
  if (packetLoss > 0) {
    if (packetLoss >= 3) {
      insights.push({
        id: 'packet-loss',
        severity: 'critical',
        icon: 'network',
        title: 'Packet Loss Detected',
        description: `${packetLoss.toFixed(1)}% packet loss — significant data drops causing lag spikes and disconnects in online games.`,
        suggestions: [
          'Check Ethernet cable connections for damage',
          'Restart your router/modem',
          'Contact ISP if persistent — may be line quality issue',
        ],
      });
    } else if (packetLoss >= 0.5) {
      insights.push({
        id: 'packet-loss-minor',
        severity: 'warning',
        icon: 'network',
        title: 'Minor Packet Loss',
        description: `${packetLoss.toFixed(1)}% packet loss — occasional micro-stutters in online games.`,
        suggestions: [
          'Prefer wired connection over Wi-Fi',
          'Reduce network congestion from other devices',
        ],
      });
    }
  }

  // ── Process Count ──
  if (processCount >= 300) {
    insights.push({
      id: 'too-many-processes',
      severity: 'warning',
      icon: 'activity',
      title: 'High Process Count',
      description: `${processCount} processes running — bloated startup programs or background services are eating CPU time and memory.`,
      suggestions: [
        'Use GS Center Startup manager to disable unneeded autostart apps',
        'Check Task Manager for resource-heavy background processes',
        'Disable unnecessary Windows services',
      ],
    });
  }

  // ── RAM Configuration (Hardware Info) ──
  if (hw) {
    const ramSpeed = parseInt(hw.ramSpeed) || 0;
    const isDDR5 = (hw.ramType || '').includes('DDR5') || ramSpeed > 4000;
    const baseline = isDDR5 ? 4800 : 2400;

    if (ramSpeed > 0 && ramSpeed <= baseline) {
      insights.push({
        id: 'ram-xmp-disabled',
        severity: 'warning',
        icon: 'zap',
        title: 'RAM Running at Base Speed',
        description: `RAM is clocked at ${ramSpeed} MHz — well below its rated speed. XMP/DOCP/EXPO is likely not enabled in BIOS.`,
        suggestions: [
          'Enter BIOS (Del or F2 at boot) and enable XMP/DOCP/EXPO profile',
          'This is a free 10-20% memory bandwidth improvement',
        ],
      });
    }

    // ── Disk type detection ──
    const diskType = (hw.diskType || '').toUpperCase();
    if (diskType.includes('HDD') || diskType === '3' || diskType.includes('UNSPECIFIED')) {
      const diskName = hw.diskName || 'primary drive';
      insights.push({
        id: 'hdd-detected',
        severity: 'warning',
        icon: 'disk',
        title: 'HDD Detected as System Drive',
        description: `"${diskName}" appears to be a mechanical hard drive. Boot times, app loading, and game load screens will be significantly slower than SSD.`,
        suggestions: [
          'Upgrade to a SATA SSD (5-10x faster) or NVMe SSD (30-50x faster)',
          'Clone your existing drive to SSD using free tools like Macrium Reflect',
        ],
      });
    }

    // ── Low total RAM ──
    const totalRam = normalizeRamTotal(hw.ramTotalGB);
    if (totalRam > 0 && totalRam < 16) {
      insights.push({
        id: 'ram-insufficient',
        severity: 'warning',
        icon: 'memory',
        title: `Only ${totalRam} GB RAM Installed`,
        description: `${totalRam} GB is below the modern minimum for gaming and multitasking. Many games now require 16 GB, and running a browser alongside will cause paging.`,
        suggestions: [
          `Upgrade to at least 16 GB (${(hw.ramType || 'DDR4')} ${detectIsLaptop(hw) ? 'SODIMM' : 'DIMM'})`,
          'Check if you have empty RAM slots for easy expansion',
        ],
      });
    }
  }

  // ── All Good fallback ──
  if (insights.length === 0) {
    insights.push({
      id: 'all-good',
      severity: 'good',
      icon: 'check',
      title: 'System Running Optimally',
      description: 'No issues detected. CPU, GPU, RAM, thermals, storage, and network are all within healthy ranges.',
      suggestions: [],
    });
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────
// 💾 STORAGE TOPOLOGY ENGINE
// ─────────────────────────────────────────────────────────────

function getStorageTopology(hw) {
  const disks = hw?.disks || [];
  const ctrl = hw?.storageController || {};
  const totalM2 = ctrl.m2Slots ?? 0;
  const totalSata = ctrl.sataPorts ?? 0;
  const totalPCIe = ctrl.pcieSlots ?? 0;
  const usedM2 = disks.filter(d => d.interface === 'NVMe').length;
  const usedSata = disks.filter(d => d.interface === 'SATA').length;
  return {
    disks,
    freeM2: Math.max(0, totalM2 - usedM2),
    freeSata: Math.max(0, totalSata - usedSata),
    freePCIe: Math.max(0, totalPCIe - (hw?.pcieUsed ?? 0)),
  };
}

// ─────────────────────────────────────────────────────────────
// 🧠 UPGRADE ENGINE
// ─────────────────────────────────────────────────────────────

function generateUpgradeRecommendations(hw) {
  const recs = [];
  if (!hw) return recs;

  const isLaptop = detectIsLaptop(hw);
  const ramGB = normalizeRamTotal(hw.ramTotalGB);
  const { ramType = 'DDR4', ramSlotsTotal = 2, ramSlotsUsed = 2, cpuCores = 4 } = hw;

  // ── RAM ──
  if (ramGB > 0 && ramGB < 16) {
    const empty = ramSlotsUsed < ramSlotsTotal;
    recs.push({
      component: 'RAM',
      impact: 'Critical',
      reason: empty
        ? `Only ${ramGB} GB installed with empty slots — cheap upgrade available`
        : `Only ${ramGB} GB installed — all slots full, requires replacement`,
      specifics: `${ramType} ${isLaptop ? 'SODIMM' : 'DIMM'} — upgrade to 16 GB+`,
      priority: 1,
    });
  } else if (ramGB === 16) {
    recs.push({
      component: 'RAM',
      impact: 'Moderate',
      reason: '16 GB is the current minimum for modern games — headroom for multitasking is limited',
      specifics: `${ramType} ${isLaptop ? 'SODIMM' : 'DIMM'} — consider 32 GB for heavy workloads`,
      priority: 3,
    });
  }

  // ── STORAGE ──
  const diskType = (hw.diskType || '').toUpperCase();
  if (diskType.includes('HDD') || diskType === '3' || diskType.includes('UNSPECIFIED')) {
    const topology = getStorageTopology(hw);
    let reason = 'System drive is a mechanical HDD — massive bottleneck for everything';
    let specifics = 'Replace with SATA SSD or NVMe SSD';

    if (topology.freeM2 > 0) {
      specifics = 'Install NVMe M.2 SSD (free slot available) — fastest option';
    } else if (topology.freeSata > 0) {
      specifics = 'Install 2.5" SATA SSD (free SATA port available)';
    }

    recs.push({ component: 'Storage', impact: 'Critical', reason, specifics, priority: 1 });
  }

  // ── CPU ──
  if (!isLaptop && cpuCores > 0 && cpuCores <= 4) {
    recs.push({
      component: 'CPU',
      impact: 'High',
      reason: `Only ${cpuCores} cores — modern games and apps expect 6-8 cores minimum`,
      specifics: 'Upgrade to a 6-8 core CPU (may require motherboard upgrade)',
      priority: 2,
    });
  }

  // ── GPU VRAM ──
  const gpuVram = hw.gpuVramTotal;
  if (gpuVram) {
    const vramGB = parseFloat(gpuVram);
    if (vramGB > 0 && vramGB <= 4) {
      recs.push({
        component: 'GPU',
        impact: 'High',
        reason: `Only ${vramGB} GB VRAM — cannot run modern games at medium+ textures without stuttering`,
        specifics: 'Upgrade to a GPU with 8+ GB VRAM',
        priority: 2,
      });
    }
  }

  return recs.sort((a, b) => a.priority - b.priority);
}

// ─────────────────────────────────────────────────────────────
// 🔌 IPC
// ─────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.handle('advisor:analyze', async (_e, stats, hw) => {
    return {
      insights: analyzeSystem(stats, hw),
      upgrades: generateUpgradeRecommendations(hw),
    };
  });

  ipcMain.on('advisor:open-power-settings', () => {
    shell.openExternal('ms-settings:powersleep');
  });
}

module.exports = { registerIPC };
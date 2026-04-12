// ═══════════════════════════════════════════════════════════════
// EXPLANATION ENGINE — Human-Readable Expert Insights
// ═══════════════════════════════════════════════════════════════
// Transforms raw analysis data into clear, actionable insights
// written in the tone of an expert PC advisor. Generates both
// real-time monitoring advisories and deep hardware analysis
// explanations.
// ═══════════════════════════════════════════════════════════════

'use strict';

const { normalizeRamTotal } = require('./analyzer/normalization');

// ─────────────────────────────────────────────────────────────
// REAL-TIME MONITORING INSIGHTS
// ─────────────────────────────────────────────────────────────

/**
 * Generate insights from real-time system statistics.
 * This replaces the old threshold-based analyzeSystem() but
 * produces the same output format for backward compatibility.
 *
 * @param {Object} stats - Live monitoring stats
 * @param {Object} hw - Raw hardware info
 * @param {Object} profile - Normalized system profile (optional)
 * @param {Object} [bottleneckCtx] - Bottleneck analysis context (optional)
 * @returns {Array} Array of insight objects
 */
function generateLiveInsights(stats, hw, profile, bottleneckCtx) {
  const insights = [];

  if (!stats) {
    return [{
      id: 'no-data', severity: 'warning', icon: 'activity',
      title: 'Waiting for Data',
      description: 'System metrics are not available yet. Monitoring will start shortly.',
      suggestions: [],
    }];
  }

  const {
    cpu = 0, gpuUsage = -1, gpuTemp = 0, gpuVramUsed = 0, gpuVramTotal = 0,
    temperature = 0, disk = 0, ramTotalGB = 0, ramUsedGB = 0,
    latencyMs = -1, packetLoss = -1, processCount = 0,
  } = stats;

  const ramPct = ramTotalGB > 0 ? (ramUsedGB / ramTotalGB) * 100 : 0;
  const vramPct = gpuVramTotal > 0 ? (gpuVramUsed / gpuVramTotal) * 100 : 0;
  const cpuModel = profile?.cpu?.model || hw?.cpuName || 'CPU';
  const gpuModel = profile?.gpu?.model || hw?.gpuName || 'GPU';

  // ── CPU Usage ──────────────────────────────────────────────
  if (cpu >= 90) {
    insights.push({
      id: 'cpu-high', severity: 'critical', icon: 'cpu',
      title: 'CPU Usage Critical',
      description: `${cpuModel} is at ${Math.round(cpu)}% — under heavy sustained load. ` +
        `This causes stutters, slowdowns, and potential thermal throttling.`,
      suggestions: [
        'Close background applications from Task Manager',
        'Check for runaway processes (antivirus scans, updates)',
        'Lower in-game CPU-heavy settings (physics, draw distance, AI)',
        profile?.cpu?.stScore < 65 ? 'Your CPU is aging — consider an upgrade for this workload' : null,
      ].filter(Boolean),
    });
  } else if (cpu >= 75) {
    insights.push({
      id: 'cpu-elevated', severity: 'warning', icon: 'cpu',
      title: 'CPU Usage Elevated',
      description: `${cpuModel} at ${Math.round(cpu)}% — approaching headroom limit. Spikes could cause frame drops.`,
      suggestions: [
        'Close unnecessary background apps',
        'Disable startup programs you don\'t need',
      ],
    });
  }

  // ── CPU ↔ GPU Imbalance (Enhanced with profile context) ───
  if (cpu > 80 && gpuUsage >= 0 && gpuUsage < 60) {
    const hasGenGap = profile?.cpu && profile?.gpu &&
      (profile.cpu.stScore || 0) < (profile.gpu.rasterScore || 0) * 0.7;

    insights.push({
      id: 'cpu-bottleneck', severity: 'critical', icon: 'cpu',
      title: 'CPU Bottleneck Detected',
      description: `${cpuModel} at ${Math.round(cpu)}% while ${gpuModel} is only at ${Math.round(gpuUsage)}%. ` +
        `The CPU cannot prepare frames fast enough — the GPU is starved for work.` +
        (hasGenGap ? ` This is likely due to a significant generation gap between your CPU and GPU.` : ''),
      suggestions: [
        'Lower CPU-bound settings: view distance, physics, NPC count',
        'Enable frame cap to reduce CPU overhead',
        hasGenGap ? 'Consider a CPU upgrade to match your GPU\'s capability' : null,
      ].filter(Boolean),
    });
  }

  // ── CPU Temperature ────────────────────────────────────────
  const cpuThermal = classifyCpuTemp(temperature, hw?.cpuName);
  if (cpuThermal.status === 'critical') {
    insights.push({
      id: 'cpu-thermal', severity: 'critical', icon: 'thermometer',
      title: 'CPU Overheating',
      description: `${cpuModel} at ${Math.round(temperature)}°C — exceeding safe limits. ` +
        `Thermal throttling is active, severely reducing performance.`,
      suggestions: [
        'Clean dust from heatsink and fans immediately',
        'Reapply thermal paste if temperatures remain high',
        'Improve case airflow (open side panel as emergency measure)',
        'Ensure CPU cooler is properly mounted',
      ],
    });
  } else if (cpuThermal.status === 'warning') {
    insights.push({
      id: 'cpu-warm', severity: 'warning', icon: 'thermometer',
      title: 'CPU Running Warm',
      description: `${cpuModel} at ${Math.round(temperature)}°C — safe but approaching thermal limits under sustained load.`,
      suggestions: [
        'Check that fans are spinning correctly',
        'Clean dust buildup from heatsink',
        'Consider improving case ventilation',
      ],
    });
  }

  // ── GPU Usage ──────────────────────────────────────────────
  if (gpuUsage >= 95) {
    insights.push({
      id: 'gpu-maxed', severity: 'warning', icon: 'gpu',
      title: 'GPU Fully Loaded',
      description: `${gpuModel} at ${Math.round(gpuUsage)}% — maxed out. Frame rates are GPU-limited.`,
      suggestions: [
        'Lower resolution or render scale',
        'Reduce graphical quality (shadows, reflections, anti-aliasing)',
        'Enable DLSS/FSR/XeSS if supported',
      ],
    });
  }

  // ── GPU Temperature ────────────────────────────────────────
  if (gpuTemp >= 90) {
    insights.push({
      id: 'gpu-thermal', severity: 'critical', icon: 'thermometer',
      title: 'GPU Overheating',
      description: `${gpuModel} at ${Math.round(gpuTemp)}°C — dangerously hot. Thermal throttling will cap clocks and reduce FPS.`,
      suggestions: [
        'Improve case airflow — ensure exhaust fans are working',
        'Set a more aggressive GPU fan curve in MSI Afterburner',
        'Reduce GPU load by lowering graphics settings',
        'Repaste the GPU if it\'s an older card',
      ],
    });
  } else if (gpuTemp >= 80) {
    insights.push({
      id: 'gpu-warm', severity: 'warning', icon: 'thermometer',
      title: 'GPU Running Warm',
      description: `${gpuModel} at ${Math.round(gpuTemp)}°C — hot but within spec. Sustained loads may push into throttle territory.`,
      suggestions: [
        'Check GPU fan speed — increase if set to "quiet" profile',
        'Ensure no cables are blocking GPU fans',
      ],
    });
  }

  // ── VRAM Pressure ──────────────────────────────────────────
  if (vramPct > 95) {
    insights.push({
      id: 'vram-full', severity: 'critical', icon: 'gpu',
      title: 'VRAM Full',
      description: `GPU memory at ${Math.round(vramPct)}% (${gpuVramUsed}/${gpuVramTotal} MB). ` +
        `Textures offloaded to system RAM — severe stuttering expected.`,
      suggestions: [
        'Lower texture quality to Medium or Low',
        'Reduce resolution or render scale',
        'Close other GPU-intensive applications',
      ],
    });
  } else if (vramPct > 80) {
    insights.push({
      id: 'vram-high', severity: 'warning', icon: 'gpu',
      title: 'VRAM Usage High',
      description: `GPU memory at ${Math.round(vramPct)}% (${gpuVramUsed}/${gpuVramTotal} MB). Low overhead — texture streaming may hitch.`,
      suggestions: [
        'Avoid Ultra textures if VRAM is under 8 GB',
        'Close browser tabs with hardware acceleration',
      ],
    });
  }

  // ── RAM Pressure ───────────────────────────────────────────
  if (ramPct >= 90) {
    insights.push({
      id: 'ram-critical', severity: 'critical', icon: 'memory',
      title: 'Memory Almost Full',
      description: `RAM at ${Math.round(ramPct)}% (${ramUsedGB.toFixed(1)}/${ramTotalGB} GB). ` +
        `Windows is actively paging to disk — massive performance penalty.`,
      suggestions: [
        'Close memory-heavy apps (browsers, Electron apps, IDEs)',
        'Reduce browser tab count',
        'Restart the app/game to clear memory leaks',
        `Consider upgrading to ${normalizeRamTotal(ramTotalGB) <= 8 ? '16' : '32'} GB RAM`,
      ],
    });
  } else if (ramPct >= 75) {
    insights.push({
      id: 'ram-elevated', severity: 'warning', icon: 'memory',
      title: 'Memory Usage Elevated',
      description: `RAM at ${Math.round(ramPct)}% (${ramUsedGB.toFixed(1)}/${ramTotalGB} GB). ` +
        `Headroom is limited — launching more apps may trigger paging.`,
      suggestions: [
        'Close apps you\'re not actively using',
        'Disable browser hardware acceleration if not gaming',
      ],
    });
  }

  // ── Disk Space ─────────────────────────────────────────────
  if (disk >= 90) {
    insights.push({
      id: 'disk-critical', severity: 'critical', icon: 'disk',
      title: 'Storage Almost Full',
      description: `Disk ${Math.round(disk)}% full. System stability at risk — Windows needs free space for page file and updates.`,
      suggestions: [
        'Run Disk Cleanup or use the GS Center Cleaner',
        'Uninstall unused programs and games',
        'Move large files to an external or secondary drive',
      ],
    });
  } else if (disk >= 80) {
    insights.push({
      id: 'disk-high', severity: 'warning', icon: 'disk',
      title: 'Storage Getting Full',
      description: `Disk ${Math.round(disk)}% full. Consider freeing space soon to maintain performance.`,
      suggestions: [
        'Clear temp files and browser cache',
        'Use GS Center Cleaner for automated cleanup',
      ],
    });
  }

  // ── Network ────────────────────────────────────────────────
  if (latencyMs > 0) {
    if (latencyMs >= 180) {
      insights.push({
        id: 'latency-high', severity: 'critical', icon: 'network',
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
        id: 'latency-moderate', severity: 'warning', icon: 'network',
        title: 'Elevated Network Latency',
        description: `Ping is ${Math.round(latencyMs)} ms — noticeable input delay in competitive games.`,
        suggestions: [
          'Use Ethernet cable for lower, more stable ping',
          'Close background downloads or streaming',
        ],
      });
    }
  }

  if (packetLoss > 0) {
    if (packetLoss >= 3) {
      insights.push({
        id: 'packet-loss', severity: 'critical', icon: 'network',
        title: 'Packet Loss Detected',
        description: `${Math.round(packetLoss)}% packet loss — significant data drops causing lag spikes and disconnects.`,
        suggestions: [
          'Check Ethernet cable connections for damage',
          'Restart your router/modem',
          'Contact ISP if persistent — may be line quality issue',
        ],
      });
    } else if (packetLoss >= 0.5) {
      insights.push({
        id: 'packet-loss-minor', severity: 'warning', icon: 'network',
        title: 'Minor Packet Loss',
        description: `${Math.round(packetLoss)}% packet loss — occasional micro-stutters in online games.`,
        suggestions: [
          'Prefer wired connection over Wi-Fi',
          'Reduce network congestion from other devices',
        ],
      });
    }
  }

  // ── Process Count ──────────────────────────────────────────
  if (processCount >= 300) {
    insights.push({
      id: 'too-many-processes', severity: 'warning', icon: 'activity',
      title: 'High Process Count',
      description: `${processCount} processes running — bloated startup programs or background services eating resources.`,
      suggestions: [
        'Use GS Center Startup manager to disable unneeded autostart apps',
        'Check Task Manager for resource-heavy background processes',
        'Disable unnecessary Windows services',
      ],
    });
  }

  // ── Hardware Configuration Checks ──────────────────────────
  if (hw) {
    const ramSpeed = parseInt(hw.ramSpeed) || 0;
    const isDDR5 = (hw.ramType || '').includes('DDR5') || ramSpeed > 4000;
    const baseline = isDDR5 ? 4800 : 2400;

    if (ramSpeed > 0 && ramSpeed <= baseline) {
      insights.push({
        id: 'ram-xmp-disabled', severity: 'warning', icon: 'zap',
        title: 'RAM Running at Base Speed',
        description: `RAM at ${ramSpeed} MHz — below rated speed. XMP/DOCP/EXPO is likely not enabled in BIOS.`,
        suggestions: [
          'Enter BIOS (Del or F2 at boot) and enable XMP/DOCP/EXPO profile',
          'This is a free 10-20% memory bandwidth improvement',
        ],
      });
    }

    const diskType = (hw.diskType || '').toUpperCase();
    if (diskType.includes('HDD') || diskType === '3' || diskType.includes('UNSPECIFIED')) {
      insights.push({
        id: 'hdd-detected', severity: 'warning', icon: 'disk',
        title: 'HDD Detected as System Drive',
        description: `"${hw.diskName || 'Primary drive'}" appears to be a mechanical hard drive. ` +
          `Boot times, app loading, and game load screens are significantly slower than SSD.`,
        suggestions: [
          'Upgrade to a SATA SSD (5-10x faster) or NVMe SSD (30-50x faster)',
          'Clone your existing drive to SSD using free tools like Macrium Reflect',
        ],
      });
    }

    const totalRam = normalizeRamTotal(hw.ramTotalGB);
    if (totalRam > 0 && totalRam < 16) {
      const isLaptop = profile?.formFactor === 'laptop';
      insights.push({
        id: 'ram-insufficient', severity: 'warning', icon: 'memory',
        title: `Only ${totalRam} GB RAM Installed`,
        description: `${totalRam} GB is below the modern minimum for gaming. Many games require 16 GB, and running a browser alongside triggers paging.`,
        suggestions: [
          `Upgrade to at least 16 GB (${hw.ramType || 'DDR4'} ${isLaptop ? 'SODIMM' : 'DIMM'})`,
          'Check if you have empty RAM slots for easy expansion',
        ],
      });
    }
  }

  // ── All Good Fallback ──────────────────────────────────────
  if (insights.length === 0) {
    insights.push({
      id: 'all-good', severity: 'good', icon: 'check',
      title: 'System Running Optimally',
      description: 'No issues detected. CPU, GPU, RAM, thermals, storage, and network are all within healthy ranges.',
      suggestions: [],
    });
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────
// DEEP ANALYSIS EXPLANATION
// ─────────────────────────────────────────────────────────────

/**
 * Generate a comprehensive system analysis explanation.
 * This is the "expert advisor" output that explains the
 * hardware profile, bottlenecks, and upgrade path in plain language.
 *
 * @param {Object} profile - Normalized system profile
 * @param {Object} bottleneckAnalysis - Bottleneck analysis results
 * @param {Array} upgrades - Upgrade recommendations
 * @returns {Object} Structured explanation with sections
 */
function generateDeepAnalysis(profile, bottleneckAnalysis, upgrades) {
  if (!profile) return { sections: [], summary: 'No hardware data available.' };

  const sections = [];

  // ── System Overview ────────────────────────────────────────
  sections.push({
    title: 'System Overview',
    content: buildSystemOverview(profile),
  });

  // ── Balance Assessment ─────────────────────────────────────
  sections.push({
    title: 'Balance Assessment',
    content: buildBalanceAssessment(profile, bottleneckAnalysis),
  });

  // ── Bottleneck Explanation ─────────────────────────────────
  if (bottleneckAnalysis?.primary) {
    sections.push({
      title: 'Bottleneck Analysis',
      content: buildBottleneckExplanation(profile, bottleneckAnalysis),
    });
  }

  // ── Upgrade Path ───────────────────────────────────────────
  if (upgrades?.length > 0) {
    sections.push({
      title: 'Recommended Upgrades',
      content: buildUpgradeExplanation(upgrades, profile),
    });
  }

  return {
    sections,
    summary: bottleneckAnalysis?.summary || 'System analysis complete.',
  };
}

// ─────────────────────────────────────────────────────────────
// SECTION BUILDERS
// ─────────────────────────────────────────────────────────────

function buildSystemOverview(profile) {
  const { cpu, gpu, ram, motherboard, monitor } = profile;
  const lines = [];

  if (cpu) lines.push(`**CPU:** ${cpu.model} (${cpu.brand} Gen ${cpu.gen}, ${cpu.cores}C/${cpu.threads}T, ${cpu.socket})`);
  if (gpu) lines.push(`**GPU:** ${gpu.model} (${gpu.vendor}, ${gpu.vram} GB VRAM)`);
  if (ram) lines.push(`**RAM:** ${ram.totalGB} GB ${ram.type} @ ${ram.speed} MT/s (${ram.label})`);
  if (motherboard && !motherboard.fallback) lines.push(`**Motherboard:** ${motherboard.chipset} (${motherboard.socket}, PCIe Gen ${motherboard.pcieGen})`);
  if (monitor) lines.push(`**Monitor:** ${monitor.resolution} @ ${monitor.refreshRate}Hz`);

  return lines.join('\n');
}

function buildBalanceAssessment(profile, bottleneckAnalysis) {
  const { tierAlignment } = profile;
  const scores = bottleneckAnalysis?.scenarioResults?.['aaa-gaming']?.perfModel?.scores;

  if (!scores) return 'Insufficient data for balance assessment.';

  let text = `System balance: **${scores.balance.label}** `;
  text += `(${Math.round(scores.balance.ratio * 100)}% alignment).\n\n`;

  if (scores.generationGap.severity !== 'none') {
    text += `⚠️ ${scores.generationGap.label}. `;
    text += `Generation gap penalty: ${Math.round(scores.generationGap.penalty * 100)}%.\n`;
  }

  if (tierAlignment > 0.85) {
    text += 'Your components are well-matched — the system is efficiently utilizing all parts.';
  } else if (tierAlignment > 0.65) {
    text += 'There is a slight imbalance between components. One component is working harder than needed while another has unused potential.';
  } else {
    text += 'There is a significant mismatch between component tiers. A large portion of performance is being wasted due to imbalance.';
  }

  return text;
}

function buildBottleneckExplanation(profile, analysis) {
  const { primary, secondary, hiddenIssues } = analysis;
  let text = '';

  if (primary) {
    text += `**Primary Bottleneck: ${primary.component}** (${primary.severity})\n`;
    text += `${primary.description}\n\n`;

    if (primary.pervasiveness >= 0.75) {
      text += `This bottleneck affects ${primary.affectedScenarios.join(', ')} — it's consistent across most use cases.\n\n`;
    }
  }

  if (secondary?.length > 0) {
    text += '**Secondary Concerns:**\n';
    for (const bn of secondary) {
      text += `- ${bn.component}: ${bn.title} (${bn.severity})\n`;
    }
    text += '\n';
  }

  if (hiddenIssues?.length > 0) {
    text += '**Hidden Inefficiencies:**\n';
    for (const issue of hiddenIssues) {
      text += `- ${issue.title}: ${issue.description}\n`;
    }
  }

  return text;
}

function buildUpgradeExplanation(upgrades, profile) {
  let text = '';

  for (const rec of upgrades) {
    text += `**${rec.component}** — ${rec.impact} Impact\n`;
    text += `Reason: ${rec.reason}\n`;

    if (rec.platformNote) {
      text += `Platform: ${rec.platformNote}\n`;
    }

    if (rec.suggestions?.length > 0) {
      text += 'Options:\n';
      for (const s of rec.suggestions) {
        text += `  • ${s.model} — ${s.price}`;
        if (s.expectedGain) text += ` (${s.expectedGain})`;
        if (s.warning) text += ` ⚠️ ${s.warning}`;
        text += '\n';
      }
    }
    text += '\n';
  }

  return text;
}

// ─────────────────────────────────────────────────────────────
// TEMPERATURE CLASSIFIERS (preserved from original)
// ─────────────────────────────────────────────────────────────

function classifyCpuTemp(temp, cpuName) {
  if (!temp || temp <= 0) return { status: 'unknown', threshold: 0 };
  const isAMD = (cpuName || '').toLowerCase().includes('amd');
  const warn = isAMD ? 80 : 82;
  const crit = isAMD ? 90 : 92;
  if (temp >= crit) return { status: 'critical', threshold: crit };
  if (temp >= warn) return { status: 'warning', threshold: warn };
  return { status: 'normal', threshold: warn };
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  generateLiveInsights,
  generateDeepAnalysis,
};

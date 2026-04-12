'use strict';

const { ipcMain, shell } = require('electron');

// ── Module imports ───────────────────────────────────────────
const { normalizeSystemProfile }          = require('./analyzer/normalization');
const { checkCompatibility }              = require('./analyzer/compatibility');
const { computeAllWorkloadScores }        = require('./analyzer/scoringSystem');
const { modelAllWorkloads }               = require('./analyzer/performanceModel');
const { analyzeBottlenecks }              = require('./analyzer/bottleneckEngine');
const { generateUpgradeRecommendations }  = require('./recommender/upgradeEngine');
const { generateLiveInsights }            = require('./explanationEngine');

// ── Cached profile (avoid re-parsing identical hw every 8 s poll) ──
let _cachedHwHash = '';
let _cachedProfile = null;
let _cachedDeepAnalysis = null;

function hashHw(hw) {
  if (!hw) return '';
  return `${hw.cpuName}|${hw.gpuName}|${hw.ramTotalGB}|${hw.ramSpeed}|${hw.ramType}|${hw.diskType}|${hw.moboName || ''}`;
}

// ─────────────────────────────────────────────────────────────
// DEEP ANALYSIS PIPELINE (runs once per hw config change)
// ─────────────────────────────────────────────────────────────

function runDeepAnalysis(hw) {
  const hwHash = hashHw(hw);
  if (hwHash === _cachedHwHash && _cachedProfile) {
    return { profile: _cachedProfile, deep: _cachedDeepAnalysis };
  }

  try {
    const profile = normalizeSystemProfile(hw);
    const compatibility = checkCompatibility(profile);
    const scores = computeAllWorkloadScores(profile);
    const perfModels = modelAllWorkloads(profile);
    const bottlenecks = analyzeBottlenecks(profile, null);
    const upgrades = generateUpgradeRecommendations(profile, bottlenecks);

    const deep = { profile, compatibility, scores, perfModels, bottlenecks, upgrades };

    _cachedHwHash = hwHash;
    _cachedProfile = profile;
    _cachedDeepAnalysis = deep;

    return { profile, deep };
  } catch (err) {
    console.error('[Advisor] Deep analysis failed:', err);
    return { profile: null, deep: null };
  }
}

// ─────────────────────────────────────────────────────────────
// MERGE PIPELINE → Frontend-compatible output
// ─────────────────────────────────────────────────────────────

/**
 * Primary analysis entry point.
 * Returns { insights: Insight[], upgrades: Upgrade[] }
 * matching the exact interface expected by AdvisorPanel.tsx.
 */
function analyzeSystem(stats, hw) {
  const { profile, deep } = hw ? runDeepAnalysis(hw) : { profile: null, deep: null };

  // 1. Real-time monitoring insights (always present)
  const insights = generateLiveInsights(stats, hw, profile, deep?.bottlenecks);

  // 2. Deep hardware insights (only when hw data available)
  //    Track covered components to prevent duplicates across engines.
  if (deep) {
    const coveredComponents = new Set();

    // Compatibility warnings as insights
    if (deep.compatibility?.length > 0) {
      for (const issue of deep.compatibility) {
        const key = (issue.components || []).sort().join('+') || issue.category;
        coveredComponents.add(key);
        insights.push({
          id: `compat-${issue.category}`,
          severity: issue.severity === 'error' ? 'critical' : 'warning',
          icon: 'zap',
          title: issue.title,
          description: issue.description,
          suggestions: issue.suggestions || [],
        });
      }
    }

    // Primary bottleneck as insight (skip if component already covered by compat or live)
    const bn = deep.bottlenecks;
    if (bn?.primary && !insights.some(i => i.id === 'cpu-bottleneck')) {
      const bnKey = (bn.primary.components || [bn.primary.component?.toLowerCase()]).sort().join('+');
      if (!coveredComponents.has(bnKey)) {
        insights.push({
          id: `bottleneck-${bn.primary.component.toLowerCase()}`,
          severity: bn.primary.severity === 'critical' ? 'critical' : 'warning',
          icon: bn.primary.component === 'CPU' ? 'cpu' : bn.primary.component === 'Monitor' ? 'monitor' : 'gpu',
          title: bn.primary.title,
          description: bn.primary.description,
          suggestions: bn.primary.suggestions || [],
        });
      }
    }

    // Hidden inefficiencies (gen gap, single-channel RAM, PCIe mismatch)
    if (bn?.hiddenIssues?.length > 0) {
      for (const issue of bn.hiddenIssues) {
        insights.push({
          id: `hidden-${issue.id || issue.title.toLowerCase().replace(/\s+/g, '-')}`,
          severity: 'warning',
          icon: 'zap',
          title: issue.title,
          description: issue.description,
          suggestions: issue.suggestions || [],
        });
      }
    }
  }

  // Remove duplicate "all-good" if we added deep insights
  if (insights.length > 1) {
    const idx = insights.findIndex(i => i.id === 'all-good');
    if (idx !== -1) insights.splice(idx, 1);
  }

  return insights;
}

/**
 * Generate upgrade recommendations in the exact format
 * expected by AdvisorPanel.tsx:
 *   { component, impact, reason, specifics, priority }
 */
function getUpgrades(hw) {
  if (!hw) return [];

  const { deep } = runDeepAnalysis(hw);
  if (!deep?.upgrades?.length) return [];

  return deep.upgrades.map((rec, idx) => ({
    component: rec.component || 'Unknown',
    impact: rec.impact || 'Moderate',
    reason: rec.reason || '',
    specifics: formatSpecifics(rec),
    priority: rec.priority ?? (idx + 1),
  }));
}

/**
 * Flatten the rich suggestion objects from upgradeEngine
 * into a single human-readable specifics string.
 */
function formatSpecifics(rec) {
  if (rec.specifics) return rec.specifics;

  const parts = [];
  if (rec.platformNote) parts.push(rec.platformNote);

  if (rec.suggestions?.length > 0) {
    for (const s of rec.suggestions.slice(0, 3)) {
      let line = s.model || s.label || '';
      if (s.price) line += ` (${s.price})`;
      if (s.expectedGain) line += ` — ${s.expectedGain}`;
      if (s.warning) line += ` ⚠️ ${s.warning}`;
      if (line) parts.push(line);
    }
  }

  return parts.join(' | ') || 'See detailed analysis for options';
}

// ─────────────────────────────────────────────────────────────
// IPC REGISTRATION (interface unchanged)
// ─────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.handle('advisor:analyze', async (_e, stats, hw) => {
    return {
      insights: analyzeSystem(stats, hw),
      upgrades: getUpgrades(hw),
    };
  });

  ipcMain.on('advisor:open-power-settings', () => {
    shell.openExternal('ms-settings:powersleep');
  });
}

module.exports = { registerIPC };

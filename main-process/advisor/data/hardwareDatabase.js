// ═══════════════════════════════════════════════════════════════
// HARDWARE DATABASE — Structured Knowledge Base
// ═══════════════════════════════════════════════════════════════
// This module contains the authoritative hardware reference data
// used by all downstream analysis engines. Every CPU, GPU,
// chipset, and RAM tier is modeled with relational metadata.
// ═══════════════════════════════════════════════════════════════

'use strict';

// ─────────────────────────────────────────────────────────────
// CPU DATABASE
// ─────────────────────────────────────────────────────────────
// Performance scores are normalized 0–100, representing
// relative single-thread and multi-thread capability.
// These drive the performance model and bottleneck engine.

const CPU_DATABASE = {
  // ── Intel Desktop ──────────────────────────────────────────
  // 10th Gen (Comet Lake) — LGA1200
  'i9-10900k':  { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 10, threads: 20, tier: 'flagship',  stScore: 58, mtScore: 62, tdp: 125 },
  'i9-10900kf': { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 10, threads: 20, tier: 'flagship',  stScore: 58, mtScore: 62, tdp: 125 },
  'i9-10900':   { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 10, threads: 20, tier: 'high-end',  stScore: 55, mtScore: 59, tdp: 65  },
  'i9-10850k':  { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 10, threads: 20, tier: 'high-end',  stScore: 57, mtScore: 61, tdp: 125 },
  'i7-10700k':  { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 8,  threads: 16, tier: 'high-end',  stScore: 55, mtScore: 52, tdp: 125 },
  'i7-10700kf': { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 8,  threads: 16, tier: 'high-end',  stScore: 55, mtScore: 52, tdp: 125 },
  'i7-10700':   { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 8,  threads: 16, tier: 'mid',       stScore: 52, mtScore: 49, tdp: 65  },
  'i5-10600k':  { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 6,  threads: 12, tier: 'mid',       stScore: 52, mtScore: 40, tdp: 125 },
  'i5-10600kf': { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 6,  threads: 12, tier: 'mid',       stScore: 52, mtScore: 40, tdp: 125 },
  'i5-10400':   { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 6,  threads: 12, tier: 'entry',     stScore: 47, mtScore: 36, tdp: 65  },
  'i5-10400f':  { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 6,  threads: 12, tier: 'entry',     stScore: 47, mtScore: 36, tdp: 65  },
  'i3-10100':   { brand: 'Intel', gen: 10, arch: 'Comet Lake',   socket: 'LGA1200', cores: 4,  threads: 8,  tier: 'budget',    stScore: 42, mtScore: 24, tdp: 65  },

  // 11th Gen (Rocket Lake) — LGA1200
  'i9-11900k':  { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 8,  threads: 16, tier: 'flagship',  stScore: 63, mtScore: 56, tdp: 125 },
  'i9-11900kf': { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 8,  threads: 16, tier: 'flagship',  stScore: 63, mtScore: 56, tdp: 125 },
  'i7-11700k':  { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 8,  threads: 16, tier: 'high-end',  stScore: 61, mtScore: 53, tdp: 125 },
  'i7-11700kf': { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 8,  threads: 16, tier: 'high-end',  stScore: 61, mtScore: 53, tdp: 125 },
  'i5-11600k':  { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 6,  threads: 12, tier: 'mid',       stScore: 58, mtScore: 42, tdp: 125 },
  'i5-11600kf': { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 6,  threads: 12, tier: 'mid',       stScore: 58, mtScore: 42, tdp: 125 },
  'i5-11400':   { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 6,  threads: 12, tier: 'entry',     stScore: 53, mtScore: 38, tdp: 65  },
  'i5-11400f':  { brand: 'Intel', gen: 11, arch: 'Rocket Lake',  socket: 'LGA1200', cores: 6,  threads: 12, tier: 'entry',     stScore: 53, mtScore: 38, tdp: 65  },

  // 12th Gen (Alder Lake) — LGA1700
  'i9-12900k':  { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 16, threads: 24, tier: 'flagship',  stScore: 78, mtScore: 82, tdp: 125 },
  'i9-12900ks': { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 16, threads: 24, tier: 'flagship',  stScore: 80, mtScore: 83, tdp: 150 },
  'i9-12900kf': { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 16, threads: 24, tier: 'flagship',  stScore: 78, mtScore: 82, tdp: 125 },
  'i7-12700k':  { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 12, threads: 20, tier: 'high-end',  stScore: 76, mtScore: 74, tdp: 125 },
  'i7-12700kf': { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 12, threads: 20, tier: 'high-end',  stScore: 76, mtScore: 74, tdp: 125 },
  'i7-12700':   { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 12, threads: 20, tier: 'mid',       stScore: 73, mtScore: 71, tdp: 65  },
  'i5-12600k':  { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 10, threads: 16, tier: 'mid',       stScore: 73, mtScore: 64, tdp: 125 },
  'i5-12600kf': { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 10, threads: 16, tier: 'mid',       stScore: 73, mtScore: 64, tdp: 125 },
  'i5-12400':   { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 6,  threads: 12, tier: 'entry',     stScore: 67, mtScore: 48, tdp: 65  },
  'i5-12400f':  { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 6,  threads: 12, tier: 'entry',     stScore: 67, mtScore: 48, tdp: 65  },
  'i3-12100':   { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 4,  threads: 8,  tier: 'budget',    stScore: 62, mtScore: 32, tdp: 60  },
  'i3-12100f':  { brand: 'Intel', gen: 12, arch: 'Alder Lake',   socket: 'LGA1700', cores: 4,  threads: 8,  tier: 'budget',    stScore: 62, mtScore: 32, tdp: 60  },

  // 13th Gen (Raptor Lake) — LGA1700
  'i9-13900k':  { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 24, threads: 32, tier: 'flagship',  stScore: 84, mtScore: 92, tdp: 125 },
  'i9-13900ks': { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 24, threads: 32, tier: 'flagship',  stScore: 86, mtScore: 94, tdp: 150 },
  'i9-13900kf': { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 24, threads: 32, tier: 'flagship',  stScore: 84, mtScore: 92, tdp: 125 },
  'i7-13700k':  { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 16, threads: 24, tier: 'high-end',  stScore: 82, mtScore: 82, tdp: 125 },
  'i7-13700kf': { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 16, threads: 24, tier: 'high-end',  stScore: 82, mtScore: 82, tdp: 125 },
  'i7-13700':   { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 16, threads: 24, tier: 'mid',       stScore: 79, mtScore: 78, tdp: 65  },
  'i5-13600k':  { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 14, threads: 20, tier: 'mid',       stScore: 80, mtScore: 72, tdp: 125 },
  'i5-13600kf': { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 14, threads: 20, tier: 'mid',       stScore: 80, mtScore: 72, tdp: 125 },
  'i5-13400':   { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 10, threads: 16, tier: 'entry',     stScore: 72, mtScore: 56, tdp: 65  },
  'i5-13400f':  { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 10, threads: 16, tier: 'entry',     stScore: 72, mtScore: 56, tdp: 65  },
  'i3-13100':   { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 4,  threads: 8,  tier: 'budget',    stScore: 65, mtScore: 34, tdp: 60  },
  'i3-13100f':  { brand: 'Intel', gen: 13, arch: 'Raptor Lake',  socket: 'LGA1700', cores: 4,  threads: 8,  tier: 'budget',    stScore: 65, mtScore: 34, tdp: 60  },

  // 14th Gen (Raptor Lake Refresh) — LGA1700
  'i9-14900k':  { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 24, threads: 32, tier: 'flagship',  stScore: 87, mtScore: 95, tdp: 125 },
  'i9-14900ks': { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 24, threads: 32, tier: 'flagship',  stScore: 89, mtScore: 96, tdp: 150 },
  'i9-14900kf': { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 24, threads: 32, tier: 'flagship',  stScore: 87, mtScore: 95, tdp: 125 },
  'i7-14700k':  { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 20, threads: 28, tier: 'high-end',  stScore: 85, mtScore: 88, tdp: 125 },
  'i7-14700kf': { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 20, threads: 28, tier: 'high-end',  stScore: 85, mtScore: 88, tdp: 125 },
  'i7-14700':   { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 20, threads: 28, tier: 'mid',       stScore: 82, mtScore: 85, tdp: 65  },
  'i5-14600k':  { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 14, threads: 20, tier: 'mid',       stScore: 82, mtScore: 74, tdp: 125 },
  'i5-14600kf': { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 14, threads: 20, tier: 'mid',       stScore: 82, mtScore: 74, tdp: 125 },
  'i5-14400':   { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 10, threads: 16, tier: 'entry',     stScore: 74, mtScore: 58, tdp: 65  },
  'i5-14400f':  { brand: 'Intel', gen: 14, arch: 'Raptor Lake Refresh', socket: 'LGA1700', cores: 10, threads: 16, tier: 'entry',     stScore: 74, mtScore: 58, tdp: 65  },

  // 15th Gen (Arrow Lake) — LGA1851
  'core ultra 9 285k':  { brand: 'Intel', gen: 15, arch: 'Arrow Lake', socket: 'LGA1851', cores: 24, threads: 24, tier: 'flagship',  stScore: 90, mtScore: 88, tdp: 125 },
  'core ultra 7 265k':  { brand: 'Intel', gen: 15, arch: 'Arrow Lake', socket: 'LGA1851', cores: 20, threads: 20, tier: 'high-end',  stScore: 88, mtScore: 82, tdp: 125 },
  'core ultra 5 245k':  { brand: 'Intel', gen: 15, arch: 'Arrow Lake', socket: 'LGA1851', cores: 14, threads: 14, tier: 'mid',       stScore: 84, mtScore: 70, tdp: 125 },

  // ── AMD Desktop ────────────────────────────────────────────
  // Ryzen 3000 (Zen 2) — AM4
  'ryzen 9 3950x': { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 16, threads: 32, tier: 'flagship',  stScore: 52, mtScore: 72, tdp: 105 },
  'ryzen 9 3900x': { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 12, threads: 24, tier: 'flagship',  stScore: 51, mtScore: 64, tdp: 105 },
  'ryzen 9 3900xt':{ brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 12, threads: 24, tier: 'flagship',  stScore: 52, mtScore: 65, tdp: 105 },
  'ryzen 7 3800x': { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 8,  threads: 16, tier: 'high-end',  stScore: 50, mtScore: 52, tdp: 105 },
  'ryzen 7 3800xt':{ brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 8,  threads: 16, tier: 'high-end',  stScore: 51, mtScore: 53, tdp: 105 },
  'ryzen 7 3700x': { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 8,  threads: 16, tier: 'mid',       stScore: 49, mtScore: 50, tdp: 65  },
  'ryzen 5 3600x': { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 6,  threads: 12, tier: 'mid',       stScore: 48, mtScore: 38, tdp: 95  },
  'ryzen 5 3600':  { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 6,  threads: 12, tier: 'entry',     stScore: 47, mtScore: 37, tdp: 65  },
  'ryzen 3 3300x': { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 4,  threads: 8,  tier: 'budget',    stScore: 46, mtScore: 26, tdp: 65  },
  'ryzen 3 3100':  { brand: 'AMD', gen: 3, arch: 'Zen 2', socket: 'AM4', cores: 4,  threads: 8,  tier: 'budget',    stScore: 44, mtScore: 24, tdp: 65  },

  // Ryzen 5000 (Zen 3) — AM4
  'ryzen 9 5950x': { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 16, threads: 32, tier: 'flagship',  stScore: 68, mtScore: 86, tdp: 105 },
  'ryzen 9 5900x': { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 12, threads: 24, tier: 'flagship',  stScore: 67, mtScore: 78, tdp: 105 },
  'ryzen 7 5800x': { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 8,  threads: 16, tier: 'high-end',  stScore: 65, mtScore: 60, tdp: 105 },
  'ryzen 7 5800x3d':{ brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 8,  threads: 16, tier: 'high-end',  stScore: 64, mtScore: 58, tdp: 105 },
  'ryzen 7 5700x': { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 8,  threads: 16, tier: 'mid',       stScore: 62, mtScore: 56, tdp: 65  },
  'ryzen 7 5700x3d':{ brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 8,  threads: 16, tier: 'mid',       stScore: 63, mtScore: 56, tdp: 65  },
  'ryzen 5 5600x': { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 6,  threads: 12, tier: 'mid',       stScore: 63, mtScore: 44, tdp: 65  },
  'ryzen 5 5600':  { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 6,  threads: 12, tier: 'entry',     stScore: 61, mtScore: 42, tdp: 65  },
  'ryzen 5 5500':  { brand: 'AMD', gen: 5, arch: 'Zen 3', socket: 'AM4', cores: 6,  threads: 12, tier: 'entry',     stScore: 56, mtScore: 40, tdp: 65  },

  // Ryzen 7000 (Zen 4) — AM5
  'ryzen 9 7950x':  { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 16, threads: 32, tier: 'flagship',  stScore: 85, mtScore: 96, tdp: 170 },
  'ryzen 9 7950x3d':{ brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 16, threads: 32, tier: 'flagship',  stScore: 84, mtScore: 95, tdp: 120 },
  'ryzen 9 7900x':  { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 12, threads: 24, tier: 'flagship',  stScore: 83, mtScore: 84, tdp: 170 },
  'ryzen 9 7900x3d':{ brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 12, threads: 24, tier: 'flagship',  stScore: 83, mtScore: 84, tdp: 120 },
  'ryzen 9 7900':   { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 12, threads: 24, tier: 'high-end',  stScore: 80, mtScore: 80, tdp: 65  },
  'ryzen 7 7800x3d':{ brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 8,  threads: 16, tier: 'high-end',  stScore: 79, mtScore: 62, tdp: 120 },
  'ryzen 7 7700x':  { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 8,  threads: 16, tier: 'mid',       stScore: 80, mtScore: 60, tdp: 105 },
  'ryzen 7 7700':   { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 8,  threads: 16, tier: 'mid',       stScore: 77, mtScore: 58, tdp: 65  },
  'ryzen 5 7600x':  { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 6,  threads: 12, tier: 'mid',       stScore: 78, mtScore: 46, tdp: 105 },
  'ryzen 5 7600':   { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 6,  threads: 12, tier: 'entry',     stScore: 76, mtScore: 44, tdp: 65  },
  'ryzen 5 7500f':  { brand: 'AMD', gen: 7, arch: 'Zen 4', socket: 'AM5', cores: 6,  threads: 12, tier: 'entry',     stScore: 74, mtScore: 43, tdp: 65  },

  // Ryzen 9000 (Zen 5) — AM5
  'ryzen 9 9950x':  { brand: 'AMD', gen: 9, arch: 'Zen 5', socket: 'AM5', cores: 16, threads: 32, tier: 'flagship',  stScore: 92, mtScore: 98, tdp: 170 },
  'ryzen 9 9900x':  { brand: 'AMD', gen: 9, arch: 'Zen 5', socket: 'AM5', cores: 12, threads: 24, tier: 'flagship',  stScore: 90, mtScore: 88, tdp: 120 },
  'ryzen 7 9800x3d':{ brand: 'AMD', gen: 9, arch: 'Zen 5', socket: 'AM5', cores: 8,  threads: 16, tier: 'high-end',  stScore: 92, mtScore: 68, tdp: 120 },
  'ryzen 7 9700x':  { brand: 'AMD', gen: 9, arch: 'Zen 5', socket: 'AM5', cores: 8,  threads: 16, tier: 'mid',       stScore: 86, mtScore: 64, tdp: 65  },
  'ryzen 5 9600x':  { brand: 'AMD', gen: 9, arch: 'Zen 5', socket: 'AM5', cores: 6,  threads: 12, tier: 'mid',       stScore: 84, mtScore: 50, tdp: 65  },
};

// ─────────────────────────────────────────────────────────────
// GPU DATABASE
// ─────────────────────────────────────────────────────────────
// rasterScore = relative rasterization performance (0–100)
// rtScore = ray-tracing performance (0–100)
// targetRes = ideal native resolution

const GPU_DATABASE = {
  // ── NVIDIA GeForce 10 Series (Pascal) ──────────────────────
  'gtx 1050':     { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP107', vram: 2,  tier: 'budget',    rasterScore: 12, rtScore: 0,  targetRes: '720p',  tdp: 75  },
  'gtx 1050 ti':  { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP107', vram: 4,  tier: 'budget',    rasterScore: 15, rtScore: 0,  targetRes: '720p',  tdp: 75  },
  'gtx 1060':     { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP106', vram: 6,  tier: 'entry',     rasterScore: 22, rtScore: 0,  targetRes: '1080p', tdp: 120 },
  'gtx 1070':     { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP104', vram: 8,  tier: 'mid',       rasterScore: 28, rtScore: 0,  targetRes: '1080p', tdp: 150 },
  'gtx 1070 ti':  { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP104', vram: 8,  tier: 'mid',       rasterScore: 31, rtScore: 0,  targetRes: '1080p', tdp: 180 },
  'gtx 1080':     { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP104', vram: 8,  tier: 'high-end',  rasterScore: 35, rtScore: 0,  targetRes: '1440p', tdp: 180 },
  'gtx 1080 ti':  { vendor: 'NVIDIA', gen: 'Pascal',    arch: 'GP102', vram: 11, tier: 'flagship',  rasterScore: 40, rtScore: 0,  targetRes: '1440p', tdp: 250 },

  // ── NVIDIA GeForce 16 Series (Turing, no RT) ──────────────
  'gtx 1650':     { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU117', vram: 4,  tier: 'budget',    rasterScore: 16, rtScore: 0,  targetRes: '720p',  tdp: 75  },
  'gtx 1650 super':{ vendor: 'NVIDIA', gen: 'Turing',   arch: 'TU116', vram: 4,  tier: 'budget',    rasterScore: 20, rtScore: 0,  targetRes: '1080p', tdp: 100 },
  'gtx 1660':     { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU116', vram: 6,  tier: 'entry',     rasterScore: 24, rtScore: 0,  targetRes: '1080p', tdp: 120 },
  'gtx 1660 super':{ vendor: 'NVIDIA', gen: 'Turing',   arch: 'TU116', vram: 6,  tier: 'entry',     rasterScore: 26, rtScore: 0,  targetRes: '1080p', tdp: 125 },
  'gtx 1660 ti':  { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU116', vram: 6,  tier: 'entry',     rasterScore: 27, rtScore: 0,  targetRes: '1080p', tdp: 120 },

  // ── NVIDIA GeForce 20 Series (Turing RTX) ─────────────────
  'rtx 2060':     { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU106', vram: 6,  tier: 'entry',     rasterScore: 32, rtScore: 18, targetRes: '1080p', tdp: 160 },
  'rtx 2060 super':{ vendor: 'NVIDIA', gen: 'Turing',   arch: 'TU106', vram: 8,  tier: 'mid',       rasterScore: 36, rtScore: 22, targetRes: '1080p', tdp: 175 },
  'rtx 2070':     { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU106', vram: 8,  tier: 'mid',       rasterScore: 38, rtScore: 24, targetRes: '1440p', tdp: 175 },
  'rtx 2070 super':{ vendor: 'NVIDIA', gen: 'Turing',   arch: 'TU104', vram: 8,  tier: 'high-end',  rasterScore: 42, rtScore: 28, targetRes: '1440p', tdp: 215 },
  'rtx 2080':     { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU104', vram: 8,  tier: 'high-end',  rasterScore: 44, rtScore: 30, targetRes: '1440p', tdp: 215 },
  'rtx 2080 super':{ vendor: 'NVIDIA', gen: 'Turing',   arch: 'TU104', vram: 8,  tier: 'high-end',  rasterScore: 47, rtScore: 33, targetRes: '1440p', tdp: 250 },
  'rtx 2080 ti':  { vendor: 'NVIDIA', gen: 'Turing',    arch: 'TU102', vram: 11, tier: 'flagship',  rasterScore: 52, rtScore: 38, targetRes: '1440p', tdp: 250 },

  // ── NVIDIA GeForce 30 Series (Ampere) ─────────────────────
  'rtx 3050':     { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA106', vram: 8,  tier: 'budget',    rasterScore: 28, rtScore: 18, targetRes: '1080p', tdp: 130 },
  'rtx 3060':     { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA106', vram: 12, tier: 'entry',     rasterScore: 38, rtScore: 24, targetRes: '1080p', tdp: 170 },
  'rtx 3060 ti':  { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA104', vram: 8,  tier: 'mid',       rasterScore: 46, rtScore: 32, targetRes: '1440p', tdp: 200 },
  'rtx 3070':     { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA104', vram: 8,  tier: 'mid',       rasterScore: 52, rtScore: 36, targetRes: '1440p', tdp: 220 },
  'rtx 3070 ti':  { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA104', vram: 8,  tier: 'high-end',  rasterScore: 55, rtScore: 40, targetRes: '1440p', tdp: 290 },
  'rtx 3080':     { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA102', vram: 10, tier: 'high-end',  rasterScore: 64, rtScore: 50, targetRes: '4k',    tdp: 320 },
  'rtx 3080 ti':  { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA102', vram: 12, tier: 'flagship',  rasterScore: 68, rtScore: 54, targetRes: '4k',    tdp: 350 },
  'rtx 3090':     { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA102', vram: 24, tier: 'flagship',  rasterScore: 70, rtScore: 56, targetRes: '4k',    tdp: 350 },
  'rtx 3090 ti':  { vendor: 'NVIDIA', gen: 'Ampere',    arch: 'GA102', vram: 24, tier: 'flagship',  rasterScore: 73, rtScore: 58, targetRes: '4k',    tdp: 450 },

  // ── NVIDIA GeForce 40 Series (Ada Lovelace) ───────────────
  'rtx 4060':     { vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD107', vram: 8,  tier: 'entry',     rasterScore: 46, rtScore: 38, targetRes: '1080p', tdp: 115 },
  'rtx 4060 ti':  { vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD106', vram: 8,  tier: 'mid',       rasterScore: 54, rtScore: 46, targetRes: '1440p', tdp: 160 },
  'rtx 4070':     { vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD104', vram: 12, tier: 'mid',       rasterScore: 62, rtScore: 54, targetRes: '1440p', tdp: 200 },
  'rtx 4070 super':{ vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD103', vram: 12, tier: 'high-end', rasterScore: 68, rtScore: 60, targetRes: '1440p', tdp: 220 },
  'rtx 4070 ti':  { vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD104', vram: 12, tier: 'high-end',  rasterScore: 70, rtScore: 62, targetRes: '1440p', tdp: 285 },
  'rtx 4070 ti super':{ vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD103', vram: 16, tier: 'high-end', rasterScore: 74, rtScore: 66, targetRes: '1440p', tdp: 285 },
  'rtx 4080':     { vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD103', vram: 16, tier: 'flagship',  rasterScore: 80, rtScore: 74, targetRes: '4k',    tdp: 320 },
  'rtx 4080 super':{ vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD103', vram: 16, tier: 'flagship', rasterScore: 82, rtScore: 76, targetRes: '4k',    tdp: 320 },
  'rtx 4090':     { vendor: 'NVIDIA', gen: 'Ada Lovelace', arch: 'AD102', vram: 24, tier: 'flagship',  rasterScore: 100,rtScore: 100,targetRes: '4k',    tdp: 450 },

  // ── NVIDIA GeForce 50 Series (Blackwell) ──────────────────
  'rtx 5060':     { vendor: 'NVIDIA', gen: 'Blackwell',  arch: 'GB206', vram: 8,  tier: 'entry',     rasterScore: 54, rtScore: 48, targetRes: '1080p', tdp: 150 },
  'rtx 5060 ti':  { vendor: 'NVIDIA', gen: 'Blackwell',  arch: 'GB205', vram: 16, tier: 'mid',       rasterScore: 62, rtScore: 56, targetRes: '1440p', tdp: 180 },
  'rtx 5070':     { vendor: 'NVIDIA', gen: 'Blackwell',  arch: 'GB205', vram: 12, tier: 'mid',       rasterScore: 74, rtScore: 68, targetRes: '1440p', tdp: 250 },
  'rtx 5070 ti':  { vendor: 'NVIDIA', gen: 'Blackwell',  arch: 'GB203', vram: 16, tier: 'high-end',  rasterScore: 82, rtScore: 76, targetRes: '1440p', tdp: 300 },
  'rtx 5080':     { vendor: 'NVIDIA', gen: 'Blackwell',  arch: 'GB203', vram: 16, tier: 'flagship',  rasterScore: 90, rtScore: 86, targetRes: '4k',    tdp: 360 },
  'rtx 5090':     { vendor: 'NVIDIA', gen: 'Blackwell',  arch: 'GB202', vram: 32, tier: 'flagship',  rasterScore: 100,rtScore: 100,targetRes: '4k',    tdp: 575 },

  // ── AMD Radeon RX 5000 (RDNA 1) ──────────────────────────
  'rx 5500 xt':   { vendor: 'AMD', gen: 'RDNA 1', arch: 'Navi 14', vram: 8,  tier: 'budget',    rasterScore: 18, rtScore: 0,  targetRes: '1080p', tdp: 130 },
  'rx 5600 xt':   { vendor: 'AMD', gen: 'RDNA 1', arch: 'Navi 10', vram: 6,  tier: 'entry',     rasterScore: 28, rtScore: 0,  targetRes: '1080p', tdp: 150 },
  'rx 5700':      { vendor: 'AMD', gen: 'RDNA 1', arch: 'Navi 10', vram: 8,  tier: 'mid',       rasterScore: 32, rtScore: 0,  targetRes: '1080p', tdp: 180 },
  'rx 5700 xt':   { vendor: 'AMD', gen: 'RDNA 1', arch: 'Navi 10', vram: 8,  tier: 'mid',       rasterScore: 36, rtScore: 0,  targetRes: '1440p', tdp: 225 },

  // ── AMD Radeon RX 6000 (RDNA 2) ──────────────────────────
  'rx 6400':      { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 24', vram: 4,  tier: 'budget',    rasterScore: 12, rtScore: 6,   targetRes: '720p',  tdp: 53  },
  'rx 6500 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 24', vram: 4,  tier: 'budget',    rasterScore: 14, rtScore: 8,   targetRes: '1080p', tdp: 107 },
  'rx 6600':      { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 23', vram: 8,  tier: 'entry',     rasterScore: 30, rtScore: 14,  targetRes: '1080p', tdp: 132 },
  'rx 6600 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 23', vram: 8,  tier: 'entry',     rasterScore: 34, rtScore: 16,  targetRes: '1080p', tdp: 160 },
  'rx 6650 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 23', vram: 8,  tier: 'entry',     rasterScore: 36, rtScore: 17,  targetRes: '1080p', tdp: 176 },
  'rx 6700 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 22', vram: 12, tier: 'mid',       rasterScore: 42, rtScore: 22,  targetRes: '1440p', tdp: 230 },
  'rx 6750 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 22', vram: 12, tier: 'mid',       rasterScore: 44, rtScore: 24,  targetRes: '1440p', tdp: 250 },
  'rx 6800':      { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 21', vram: 16, tier: 'high-end',  rasterScore: 52, rtScore: 30,  targetRes: '1440p', tdp: 250 },
  'rx 6800 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 21', vram: 16, tier: 'high-end',  rasterScore: 58, rtScore: 34,  targetRes: '4k',    tdp: 300 },
  'rx 6900 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 21', vram: 16, tier: 'flagship',  rasterScore: 62, rtScore: 36,  targetRes: '4k',    tdp: 300 },
  'rx 6950 xt':   { vendor: 'AMD', gen: 'RDNA 2', arch: 'Navi 21', vram: 16, tier: 'flagship',  rasterScore: 66, rtScore: 38,  targetRes: '4k',    tdp: 335 },

  // ── AMD Radeon RX 7000 (RDNA 3) ──────────────────────────
  'rx 7600':      { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 33', vram: 8,  tier: 'entry',     rasterScore: 36, rtScore: 22,  targetRes: '1080p', tdp: 165 },
  'rx 7600 xt':   { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 33', vram: 16, tier: 'entry',     rasterScore: 40, rtScore: 26,  targetRes: '1080p', tdp: 150 },
  'rx 7700 xt':   { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 32', vram: 12, tier: 'mid',       rasterScore: 52, rtScore: 34,  targetRes: '1440p', tdp: 245 },
  'rx 7800 xt':   { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 32', vram: 16, tier: 'mid',       rasterScore: 58, rtScore: 38,  targetRes: '1440p', tdp: 263 },
  'rx 7900 gre':  { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 31', vram: 16, tier: 'high-end',  rasterScore: 64, rtScore: 42,  targetRes: '4k',    tdp: 260 },
  'rx 7900 xt':   { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 31', vram: 20, tier: 'high-end',  rasterScore: 72, rtScore: 48,  targetRes: '4k',    tdp: 300 },
  'rx 7900 xtx':  { vendor: 'AMD', gen: 'RDNA 3', arch: 'Navi 31', vram: 24, tier: 'flagship',  rasterScore: 78, rtScore: 52,  targetRes: '4k',    tdp: 355 },

  // ── AMD Radeon RX 9000 (RDNA 4) ──────────────────────────
  'rx 9070':      { vendor: 'AMD', gen: 'RDNA 4', arch: 'Navi 48', vram: 16, tier: 'mid',       rasterScore: 60, rtScore: 52,  targetRes: '1440p', tdp: 200 },
  'rx 9070 xt':   { vendor: 'AMD', gen: 'RDNA 4', arch: 'Navi 48', vram: 16, tier: 'high-end',  rasterScore: 68, rtScore: 58,  targetRes: '1440p', tdp: 250 },

  // ── Intel Arc (Alchemist / Battlemage) ────────────────────
  'arc a580':     { vendor: 'Intel', gen: 'Alchemist',   arch: 'ACM-G10', vram: 8,  tier: 'budget',   rasterScore: 24, rtScore: 16, targetRes: '1080p', tdp: 175 },
  'arc a750':     { vendor: 'Intel', gen: 'Alchemist',   arch: 'ACM-G10', vram: 8,  tier: 'entry',    rasterScore: 30, rtScore: 22, targetRes: '1080p', tdp: 225 },
  'arc a770':     { vendor: 'Intel', gen: 'Alchemist',   arch: 'ACM-G10', vram: 16, tier: 'entry',    rasterScore: 34, rtScore: 26, targetRes: '1080p', tdp: 225 },
  'arc b580':     { vendor: 'Intel', gen: 'Battlemage',  arch: 'BMG-G21', vram: 12, tier: 'entry',    rasterScore: 38, rtScore: 30, targetRes: '1080p', tdp: 150 },
  'arc b570':     { vendor: 'Intel', gen: 'Battlemage',  arch: 'BMG-G21', vram: 10, tier: 'budget',   rasterScore: 32, rtScore: 24, targetRes: '1080p', tdp: 150 },
};

// ─────────────────────────────────────────────────────────────
// CHIPSET / MOTHERBOARD DATABASE
// ─────────────────────────────────────────────────────────────

const CHIPSET_DATABASE = {
  // ── Intel ──────────────────────────────────────────────────
  'z490':  { brand: 'Intel', socket: 'LGA1200', supportedGens: [10, 11],    pcieGen: 3, ramSupport: ['DDR4'], tier: 'enthusiast' },
  'b460':  { brand: 'Intel', socket: 'LGA1200', supportedGens: [10],       pcieGen: 3, ramSupport: ['DDR4'], tier: 'mainstream'  },
  'h470':  { brand: 'Intel', socket: 'LGA1200', supportedGens: [10, 11],    pcieGen: 3, ramSupport: ['DDR4'], tier: 'mainstream'  },
  'z590':  { brand: 'Intel', socket: 'LGA1200', supportedGens: [10, 11],    pcieGen: 4, ramSupport: ['DDR4'], tier: 'enthusiast' },
  'b560':  { brand: 'Intel', socket: 'LGA1200', supportedGens: [10, 11],    pcieGen: 4, ramSupport: ['DDR4'], tier: 'mainstream'  },

  'z690':  { brand: 'Intel', socket: 'LGA1700', supportedGens: [12, 13, 14], pcieGen: 5, ramSupport: ['DDR4', 'DDR5'], tier: 'enthusiast' },
  'b660':  { brand: 'Intel', socket: 'LGA1700', supportedGens: [12, 13, 14], pcieGen: 4, ramSupport: ['DDR4', 'DDR5'], tier: 'mainstream'  },
  'h670':  { brand: 'Intel', socket: 'LGA1700', supportedGens: [12, 13, 14], pcieGen: 4, ramSupport: ['DDR4', 'DDR5'], tier: 'mainstream'  },
  'z790':  { brand: 'Intel', socket: 'LGA1700', supportedGens: [12, 13, 14], pcieGen: 5, ramSupport: ['DDR4', 'DDR5'], tier: 'enthusiast' },
  'b760':  { brand: 'Intel', socket: 'LGA1700', supportedGens: [12, 13, 14], pcieGen: 4, ramSupport: ['DDR4', 'DDR5'], tier: 'mainstream'  },

  'z890':  { brand: 'Intel', socket: 'LGA1851', supportedGens: [15],        pcieGen: 5, ramSupport: ['DDR5'], tier: 'enthusiast' },
  'b860':  { brand: 'Intel', socket: 'LGA1851', supportedGens: [15],        pcieGen: 5, ramSupport: ['DDR5'], tier: 'mainstream'  },

  // ── AMD ────────────────────────────────────────────────────
  'a320':  { brand: 'AMD', socket: 'AM4', supportedGens: [1, 2, 3],        pcieGen: 3, ramSupport: ['DDR4'], tier: 'budget'     },
  'b350':  { brand: 'AMD', socket: 'AM4', supportedGens: [1, 2, 3],        pcieGen: 3, ramSupport: ['DDR4'], tier: 'mainstream'  },
  'x370':  { brand: 'AMD', socket: 'AM4', supportedGens: [1, 2, 3],        pcieGen: 3, ramSupport: ['DDR4'], tier: 'enthusiast' },
  'b450':  { brand: 'AMD', socket: 'AM4', supportedGens: [1, 2, 3, 5],     pcieGen: 3, ramSupport: ['DDR4'], tier: 'mainstream'  },
  'x470':  { brand: 'AMD', socket: 'AM4', supportedGens: [1, 2, 3, 5],     pcieGen: 3, ramSupport: ['DDR4'], tier: 'enthusiast' },
  'b550':  { brand: 'AMD', socket: 'AM4', supportedGens: [3, 5],           pcieGen: 4, ramSupport: ['DDR4'], tier: 'mainstream'  },
  'x570':  { brand: 'AMD', socket: 'AM4', supportedGens: [3, 5],           pcieGen: 4, ramSupport: ['DDR4'], tier: 'enthusiast' },

  'a620':  { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 4, ramSupport: ['DDR5'], tier: 'budget'     },
  'b650':  { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 4, ramSupport: ['DDR5'], tier: 'mainstream'  },
  'b650e': { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 5, ramSupport: ['DDR5'], tier: 'mainstream'  },
  'x670':  { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 5, ramSupport: ['DDR5'], tier: 'enthusiast' },
  'x670e': { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 5, ramSupport: ['DDR5'], tier: 'enthusiast' },
  'x870':  { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 5, ramSupport: ['DDR5'], tier: 'enthusiast' },
  'x870e': { brand: 'AMD', socket: 'AM5', supportedGens: [7, 9],           pcieGen: 5, ramSupport: ['DDR5'], tier: 'enthusiast' },
};

// ─────────────────────────────────────────────────────────────
// RAM SPEED TIERS
// ─────────────────────────────────────────────────────────────
// Speed boundaries for classification. Values are in MT/s.

const RAM_TIERS = {
  DDR4: [
    { min: 0,    max: 2400, tier: 'base',       score: 30, label: 'DDR4 JEDEC Base'       },
    { min: 2401, max: 2666, tier: 'low',        score: 40, label: 'DDR4 Low'              },
    { min: 2667, max: 3000, tier: 'standard',   score: 50, label: 'DDR4 Standard'         },
    { min: 3001, max: 3200, tier: 'mainstream',  score: 60, label: 'DDR4 Mainstream'       },
    { min: 3201, max: 3600, tier: 'performance', score: 72, label: 'DDR4 Performance'      },
    { min: 3601, max: 4000, tier: 'high-end',   score: 80, label: 'DDR4 High-End'         },
    { min: 4001, max: 4400, tier: 'extreme',    score: 85, label: 'DDR4 Extreme'          },
    { min: 4401, max: 9999, tier: 'enthusiast', score: 88, label: 'DDR4 Enthusiast OC'    },
  ],
  DDR5: [
    { min: 0,    max: 4800, tier: 'base',       score: 50, label: 'DDR5 JEDEC Base'       },
    { min: 4801, max: 5200, tier: 'low',        score: 58, label: 'DDR5 Low'              },
    { min: 5201, max: 5600, tier: 'standard',   score: 65, label: 'DDR5 Standard'         },
    { min: 5601, max: 6000, tier: 'mainstream',  score: 75, label: 'DDR5 Mainstream'       },
    { min: 6001, max: 6400, tier: 'performance', score: 82, label: 'DDR5 Performance'      },
    { min: 6401, max: 7200, tier: 'high-end',   score: 88, label: 'DDR5 High-End'         },
    { min: 7201, max: 8000, tier: 'extreme',    score: 92, label: 'DDR5 Extreme'          },
    { min: 8001, max: 99999,tier: 'enthusiast', score: 95, label: 'DDR5 Enthusiast OC'    },
  ],
};

// ─────────────────────────────────────────────────────────────
// TIER ORDINALS — numeric ranking for comparison
// ─────────────────────────────────────────────────────────────

const TIER_ORDER = { budget: 1, entry: 2, mid: 3, 'high-end': 4, flagship: 5 };

// ─────────────────────────────────────────────────────────────
// RESOLUTION PROFILES
// ─────────────────────────────────────────────────────────────
// Models how resolution + refresh rate shift the CPU/GPU demand.
// cpuWeight: how CPU-bound the scenario is (0–1)
// gpuWeight: how GPU-bound the scenario is (0–1)
// pixelLoad: relative pixel throughput multiplier vs 1080p

const RESOLUTION_PROFILES = {
  '720p':   { pixels: 921600,   pixelLoad: 0.44, cpuWeight: 0.80, gpuWeight: 0.20 },
  '1080p':  { pixels: 2073600,  pixelLoad: 1.00, cpuWeight: 0.60, gpuWeight: 0.40 },
  '1440p':  { pixels: 3686400,  pixelLoad: 1.78, cpuWeight: 0.35, gpuWeight: 0.65 },
  '4k':     { pixels: 8294400,  pixelLoad: 4.00, cpuWeight: 0.15, gpuWeight: 0.85 },
  '1080p ultrawide': { pixels: 2764800, pixelLoad: 1.33, cpuWeight: 0.50, gpuWeight: 0.50 },
  '1440p ultrawide': { pixels: 4915200, pixelLoad: 2.37, cpuWeight: 0.28, gpuWeight: 0.72 },
};

// ─────────────────────────────────────────────────────────────
// REFRESH RATE PROFILES
// ─────────────────────────────────────────────────────────────
// Higher refresh rates increase CPU demand non-linearly.

const REFRESH_RATE_PROFILES = {
  60:  { cpuDemandMultiplier: 1.00, label: 'Standard',     tier: 'standard'    },
  75:  { cpuDemandMultiplier: 1.08, label: 'Slightly elevated', tier: 'standard' },
  100: { cpuDemandMultiplier: 1.20, label: 'Moderate HFR', tier: 'high'        },
  120: { cpuDemandMultiplier: 1.30, label: 'High',         tier: 'high'        },
  144: { cpuDemandMultiplier: 1.40, label: 'Gaming',       tier: 'high'        },
  165: { cpuDemandMultiplier: 1.50, label: 'Competitive',  tier: 'very-high'   },
  240: { cpuDemandMultiplier: 1.80, label: 'Competitive+', tier: 'extreme'     },
  360: { cpuDemandMultiplier: 2.10, label: 'Esports',      tier: 'extreme'     },
};

// ─────────────────────────────────────────────────────────────
// WORKLOAD PROFILES
// ─────────────────────────────────────────────────────────────

const WORKLOAD_PROFILES = {
  'competitive-gaming': {
    label: 'Competitive Gaming',
    description: 'High FPS esports titles (CS2, Valorant, Apex)',
    cpuBias: 0.75,      // CPU matters most for high FPS
    gpuBias: 0.25,
    ramBias: 0.15,      // RAM speed matters here
    targetFps: 240,
    stWeight: 0.85,     // single-thread performance dominates
    mtWeight: 0.15,
  },
  'aaa-gaming': {
    label: 'AAA Gaming',
    description: 'Modern AAA titles (Cyberpunk, Hogwarts Legacy)',
    cpuBias: 0.35,
    gpuBias: 0.65,
    ramBias: 0.08,
    targetFps: 60,
    stWeight: 0.60,
    mtWeight: 0.40,
  },
  'productivity': {
    label: 'Productivity',
    description: 'Video editing, 3D rendering, compilation',
    cpuBias: 0.55,
    gpuBias: 0.30,
    ramBias: 0.20,
    targetFps: null,
    stWeight: 0.30,
    mtWeight: 0.70,
  },
  'streaming': {
    label: 'Gaming + Streaming',
    description: 'Gaming while encoding OBS stream',
    cpuBias: 0.60,
    gpuBias: 0.35,
    ramBias: 0.12,
    targetFps: 144,
    stWeight: 0.50,
    mtWeight: 0.50,
  },
};

// ─────────────────────────────────────────────────────────────
// UPGRADE SUGGESTIONS DATABASE
// ─────────────────────────────────────────────────────────────

const UPGRADE_CATALOG = {
  cpu: {
    budget:    [
      { model: 'Intel i5-12400F',    price: '$100-$130',  socket: 'LGA1700', tier: 'entry',    stScore: 67 },
      { model: 'AMD Ryzen 5 5600',   price: '$100-$130',  socket: 'AM4',     tier: 'entry',    stScore: 61 },
    ],
    mid:       [
      { model: 'Intel i5-14600KF',   price: '$240-$290',  socket: 'LGA1700', tier: 'mid',      stScore: 82 },
      { model: 'AMD Ryzen 5 7600X',  price: '$200-$250',  socket: 'AM5',     tier: 'mid',      stScore: 78 },
      { model: 'AMD Ryzen 7 7800X3D',price: '$340-$400',  socket: 'AM5',     tier: 'high-end', stScore: 79 },
    ],
    'high-end': [
      { model: 'Intel i7-14700KF',   price: '$350-$420',  socket: 'LGA1700', tier: 'high-end', stScore: 85 },
      { model: 'AMD Ryzen 7 9800X3D',price: '$420-$480',  socket: 'AM5',     tier: 'high-end', stScore: 92 },
    ],
    flagship:  [
      { model: 'Intel i9-14900KS',   price: '$550-$650',  socket: 'LGA1700', tier: 'flagship', stScore: 89 },
      { model: 'AMD Ryzen 9 9950X',  price: '$550-$650',  socket: 'AM5',     tier: 'flagship', stScore: 92 },
    ],
  },
  gpu: {
    budget:    [
      { model: 'RTX 4060',           price: '$280-$330',  tier: 'entry',    rasterScore: 46 },
      { model: 'RX 7600 XT',         price: '$260-$310',  tier: 'entry',    rasterScore: 40 },
      { model: 'Intel Arc B580',     price: '$220-$260',  tier: 'entry',    rasterScore: 38 },
    ],
    mid:       [
      { model: 'RTX 4070',           price: '$500-$560',  tier: 'mid',      rasterScore: 62 },
      { model: 'RTX 5070',           price: '$550-$600',  tier: 'mid',      rasterScore: 74 },
      { model: 'RX 7800 XT',         price: '$450-$520',  tier: 'mid',      rasterScore: 58 },
    ],
    'high-end': [
      { model: 'RTX 5070 Ti',        price: '$750-$850',  tier: 'high-end', rasterScore: 82 },
      { model: 'RTX 4080 Super',     price: '$900-$1000', tier: 'flagship', rasterScore: 82 },
      { model: 'RX 9070 XT',         price: '$550-$650',  tier: 'high-end', rasterScore: 68 },
    ],
    flagship:  [
      { model: 'RTX 5080',           price: '$950-$1100', tier: 'flagship', rasterScore: 90 },
      { model: 'RTX 5090',           price: '$1900-$2200',tier: 'flagship', rasterScore: 100},
    ],
  },
  monitor: {
    // FPS-first philosophy: only recommend higher refresh rate, never higher resolution.
    // Lower resolution = more FPS. Higher refresh rate = smoother gameplay.
    'refresh-upgrade-1080p': [
      { model: '1080p 240Hz Monitor', price: '$200-$300', resolution: '1080p', refreshRate: 240 },
      { model: '1080p 360Hz Monitor', price: '$350-$500', resolution: '1080p', refreshRate: 360 },
    ],
    'refresh-upgrade-1440p': [
      { model: '1440p 240Hz Monitor', price: '$400-$600', resolution: '1440p', refreshRate: 240 },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// GENERATION GAP SEVERITY TABLE
// ─────────────────────────────────────────────────────────────
// Maps generation gaps between components to severity ratings.
// Used by the bottleneck engine to weigh generational mismatch.

const GEN_GAP_SEVERITY = [
  { gap: 0, severity: 'none',     weight: 0.00, label: 'Same generation'          },
  { gap: 1, severity: 'minimal',  weight: 0.05, label: '1 generation apart'       },
  { gap: 2, severity: 'minor',    weight: 0.15, label: '2 generations apart'      },
  { gap: 3, severity: 'moderate', weight: 0.30, label: '3 generations apart'      },
  { gap: 4, severity: 'major',    weight: 0.50, label: '4+ generations apart'     },
  { gap: 5, severity: 'severe',   weight: 0.70, label: '5+ generations apart'     },
  { gap: 6, severity: 'extreme',  weight: 0.85, label: '6+ generations — extreme' },
];

function getGenGapSeverity(gap) {
  const absGap = Math.abs(gap);
  return GEN_GAP_SEVERITY.find(g => absGap <= g.gap) || GEN_GAP_SEVERITY[GEN_GAP_SEVERITY.length - 1];
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  CPU_DATABASE,
  GPU_DATABASE,
  CHIPSET_DATABASE,
  RAM_TIERS,
  TIER_ORDER,
  RESOLUTION_PROFILES,
  REFRESH_RATE_PROFILES,
  WORKLOAD_PROFILES,
  UPGRADE_CATALOG,
  GEN_GAP_SEVERITY,
  getGenGapSeverity,
};

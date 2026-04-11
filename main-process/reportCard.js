/* ── PC Report Card — Image Generator ──────────────────────────────────────
 *  Renders a styled HTML report in a hidden BrowserWindow then captures
 *  it as a PNG via webContents.capturePage().
 *
 *  IPC channels:
 *    report:generate   → { imageBase64, imagePath }
 *    report:copy       → copies PNG to clipboard
 * ────────────────────────────────────────────────────────────────────────── */

const { ipcMain, BrowserWindow, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function _escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _statusClass(status) {
  if (status === 'good' || status === 'exceeds' || status === 'meets-recommended') return 'good';
  if (status === 'warning' || status === 'meets-minimum') return 'warn';
  return 'bad';
}

function _healthGrade(score) {
  if (score >= 90) return { letter: 'A+', cls: 'grade-a' };
  if (score >= 80) return { letter: 'A',  cls: 'grade-a' };
  if (score >= 70) return { letter: 'B',  cls: 'grade-b' };
  if (score >= 60) return { letter: 'C',  cls: 'grade-c' };
  if (score >= 50) return { letter: 'D',  cls: 'grade-d' };
  return { letter: 'F', cls: 'grade-f' };
}

/* ── Build the report HTML ───────────────────────────────────────────────── */

function _buildReportHtml(data) {
  const hw = data.hardware || {};
  const health = data.health || {};
  const advisor = data.advisor || {};
  const tweaks = data.tweaks || {};
  const games = data.games || [];

  const score = Math.round(health.score || 0);
  const grade = _healthGrade(score);
  const _r = (v) => typeof v === 'number' ? Math.round(v) : v;

  const timestamp = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  // SVG arc for the score ring
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;
  const gradeColors = { 'grade-a': '#00ffaa', 'grade-b': '#88CC00', 'grade-c': '#FFD600', 'grade-d': '#FF8800', 'grade-f': '#ff4466' };
  const gc = gradeColors[grade.cls] || '#00ffaa';

  /* ── SVG Icons (Lucide-style, 14px) ────────────────────── */
  const IC = {
    cpu:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/></svg>',
    gpu:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/></svg>',
    ram:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5H9"/><path d="M2 9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/><path d="M6 13V9"/><path d="M10 13V9"/><path d="M14 13V9"/><path d="M18 13V9"/></svg>',
    disk:    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>',
    board:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M6 8h.01"/><path d="M6 12h.01"/><path d="M6 16h.01"/><path d="M10 8h8"/><path d="M10 12h8"/><path d="M10 16h8"/></svg>',
    os:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    net:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  };

  /* ── Specs ─────────────────────────────────────────────── */
  const specs = [
    { icon: IC.cpu, label: 'CPU', value: hw.cpuName, sub: `${hw.cpuCores || '?'}C / ${hw.cpuThreads || '?'}T · ${hw.cpuMaxClock || '?'}` },
    { icon: IC.gpu, label: 'GPU', value: hw.gpuName, sub: `${hw.gpuVramTotal || '?'} VRAM · Driver ${hw.gpuDriverVersion || '?'}` },
    { icon: IC.ram, label: 'RAM', value: `${_r(hw.ramTotalGB) || '?'} GB @ ${hw.ramSpeed || '?'}`, sub: `${hw.ramSticks || '?'} · ${hw.ramBrand || ''}` },
    { icon: IC.disk, label: 'Storage', value: hw.diskName, sub: `${hw.diskType || '?'} · ${_r(hw.diskTotalGB) || '?'} GB · ${_r(hw.diskFreeGB) || '?'} GB free` },
    { icon: IC.board, label: 'Board', value: `${hw.motherboardManufacturer || ''} ${hw.motherboardProduct || ''}`.trim() || 'Unknown' },
    { icon: IC.os, label: 'OS', value: `Windows ${hw.windowsVersion || '?'} (${hw.windowsBuild || '?'})`, sub: `Power: ${hw.powerPlan || '?'}` },
    { icon: IC.net, label: 'Network', value: hw.networkAdapter, sub: hw.networkLinkSpeed || '' },
  ].filter(s => s.value);

  const specsHtml = specs.map(s => `
    <div class="sp">
      <div class="sp-ic">${s.icon}</div>
      <div class="sp-body">
        <div class="sp-val">${_escapeHtml(s.value)}</div>
        ${s.sub ? `<div class="sp-sub">${_escapeHtml(s.sub)}</div>` : ''}
      </div>
    </div>`).join('');

  /* ── Health factors ────────────────────────────────────── */
  const factors = (health.factors || []);
  const factorsHtml = factors.map(f => {
    const s = Math.round(f.score);
    const cls = _statusClass(f.status);
    return `
    <div class="hf">
      <div class="hf-head">
        <span class="hf-lbl">${_escapeHtml(f.label)}</span>
        <span class="hf-num hf-num--${cls}">${s}</span>
      </div>
      <div class="hf-bar"><div class="hf-fill hf-fill--${cls}" style="width:${Math.min(s,100)}%"></div></div>
    </div>`;
  }).join('');

  /* ── Tweaks ────────────────────────────────────────────── */
  const applied = Object.entries(tweaks).filter(([, v]) => v);
  const total = Object.keys(tweaks).length;
  const tweakPct = Math.round((applied.length / (total || 1)) * 100);
  const tweakTags = applied.map(([n]) =>
    `<span class="tw">${_escapeHtml(n)}</span>`
  ).join('');

  /* ── Games ─────────────────────────────────────────────── */
  const gameCards = games.map(g => {
    const cls = _statusClass(g.overall);
    return `
    <div class="gc">
      <div class="gc-name">${_escapeHtml(g.name)}</div>
      <div class="gc-rows">
        <div class="gc-row"><span class="gc-q">Low</span><span class="gc-v">${g.fpsLow || '—'} FPS</span></div>
        <div class="gc-row"><span class="gc-q">Medium</span><span class="gc-v">${g.fpsMedium || '—'} FPS</span></div>
        <div class="gc-row"><span class="gc-q">High</span><span class="gc-v">${g.fpsHigh || '—'} FPS</span></div>
      </div>
      <div class="gc-badge gc-badge--${cls}">${_escapeHtml(g.verdict)}</div>
    </div>`;
  }).join('');

  /* ── Advisor ───────────────────────────────────────────── */
  const insights = (advisor.insights || []).slice(0, 4);
  const upgrades = (advisor.upgrades || []).slice(0, 3);
  const advHtml = insights.map(i => {
    const cls = i.severity === 'critical' ? 'bad' : i.severity === 'warning' ? 'warn' : 'good';
    return `<div class="ins ins--${cls}"><span class="ins-t">${_escapeHtml(i.title)}</span><span class="ins-d">${_escapeHtml(i.description)}</span></div>`;
  }).join('');
  const upgHtml = upgrades.map(u =>
    `<div class="upg"><span class="upg-c">${_escapeHtml(u.component)}</span>${_escapeHtml(u.reason)}</div>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:700px;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#06080f;color:#c8cad0;-webkit-font-smoothing:antialiased;overflow:hidden}

/* ── Hero header ──────────────── */
.hero{position:relative;padding:14px 24px;background:linear-gradient(165deg,#080c18 0%,#0d1424 40%,#0a1030 100%);overflow:hidden}
.hero::before{content:'';position:absolute;top:-40px;right:-20px;width:160px;height:160px;background:radial-gradient(circle,${gc}11 0%,transparent 70%);pointer-events:none}
.hero::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,${gc}30,transparent)}
.hero-row{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.brand{display:flex;flex-direction:column;gap:2px}
.brand-name{font-size:14px;font-weight:800;color:#fff;letter-spacing:.3px}
.brand-sub{font-size:9px;font-weight:500;color:rgba(200,202,208,.3);letter-spacing:.4px}

/* ── SVG Score ring ───────────── */
.ring-wrap{position:relative;width:64px;height:64px;flex-shrink:0}
.ring-svg{transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:rgba(255,255,255,.04);stroke-width:5}
.ring-fg{fill:none;stroke:${gc};stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 5px ${gc}66)}
.ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-letter{font-size:20px;font-weight:900;color:${gc};line-height:1;text-shadow:0 0 14px ${gc}44}
.ring-score{font-size:8px;font-weight:600;color:rgba(200,202,208,.35);margin-top:1px}

/* ── Content ──────────────────── */
.content{padding:20px 28px 16px}

/* ── Glass panels ─────────────── */
.panel{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:10px;padding:14px 16px;margin-bottom:14px}
.panel-t{font-size:9px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:rgba(200,202,208,.25);margin-bottom:10px;display:flex;align-items:center;gap:8px}
.panel-t .dot{width:4px;height:4px;border-radius:50%;background:${gc};box-shadow:0 0 6px ${gc}88}

/* ── Two-col layout ───────────── */
.duo{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}

/* ── Spec rows ────────────────── */
.sp{display:flex;align-items:flex-start;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.sp:last-child{border-bottom:none}
.sp-ic{flex-shrink:0;width:16px;height:16px;color:${gc};opacity:.5;padding-top:1px}
.ic{width:14px;height:14px}
.sp-body{min-width:0;flex:1}
.sp-val{font-size:11px;font-weight:600;color:rgba(235,235,240,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-sub{font-size:9px;color:rgba(200,202,208,.25);margin-top:1px}

/* ── Health bars ──────────────── */
.hf{margin-bottom:8px}.hf:last-child{margin-bottom:0}
.hf-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.hf-lbl{font-size:10px;font-weight:500;color:rgba(200,202,208,.45)}
.hf-num{font-size:10px;font-weight:800;font-variant-numeric:tabular-nums}
.hf-num--good{color:#00ffaa}.hf-num--warn{color:#ffd000}.hf-num--bad{color:#ff4466}
.hf-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.04);overflow:hidden}
.hf-fill{height:100%;border-radius:4px}
.hf-fill--good{background:linear-gradient(90deg,#00ffaa,#00d4ff);box-shadow:0 0 8px #00ffaa33}
.hf-fill--warn{background:linear-gradient(90deg,#ffd000,#ff8800);box-shadow:0 0 8px #ffd00033}
.hf-fill--bad{background:linear-gradient(90deg,#ff4466,#ff6b6b);box-shadow:0 0 8px #ff446633}

/* ── Tweaks ───────────────────── */
.tw-info{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.tw-stat{font-size:11px;color:rgba(200,202,208,.4)}
.tw-stat b{color:${gc};font-weight:700}
.tw-pct{font-size:10px;font-weight:800;color:${gc};background:${gc}14;padding:2px 8px;border-radius:4px;border:1px solid ${gc}22}
.tw-grid{display:flex;flex-wrap:wrap;gap:4px}
.tw{font-size:7.5px;font-weight:600;padding:3px 7px;border-radius:4px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);color:rgba(200,202,208,.5);text-transform:uppercase;letter-spacing:.4px}

/* ── Game cards ───────────────── */
.gc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.gc{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:7px}
.gc-name{font-size:11px;font-weight:700;color:rgba(235,235,240,.85)}
.gc-rows{display:flex;flex-direction:column;gap:3px}
.gc-row{display:flex;justify-content:space-between;font-size:10px}
.gc-q{color:rgba(200,202,208,.35);font-weight:500}
.gc-v{color:rgba(200,202,208,.7);font-weight:600;font-variant-numeric:tabular-nums}
.gc-badge{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:4px 0;border-radius:5px;text-align:center;margin-top:2px}
.gc-badge--good{background:#00ffaa12;color:#00ffaa;border:1px solid #00ffaa22}
.gc-badge--warn{background:#ffd00012;color:#ffd000;border:1px solid #ffd00022}
.gc-badge--bad{background:#ff446612;color:#ff4466;border:1px solid #ff446622}

/* ── Advisor ──────────────────── */
.ins{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:6px;margin-bottom:5px;border-left:3px solid;background:rgba(255,255,255,.015)}
.ins-t{font-size:10px;font-weight:700;color:rgba(235,235,240,.7)}
.ins-d{font-size:9px;color:rgba(200,202,208,.4);line-height:1.4}
.ins--good{border-color:#00ffaa}.ins--warn{border-color:#ffd000}.ins--bad{border-color:#ff4466}
.upg{font-size:10px;color:rgba(200,202,208,.35);padding:3px 0}
.upg-c{font-weight:700;color:#00d4ff;margin-right:8px}

/* ── Footer ───────────────────── */
.foot{padding:12px 28px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,.03)}
.foot-l{font-size:8px;color:rgba(200,202,208,.15);letter-spacing:.3px}
.foot-r{font-size:8px;color:${gc}44;font-weight:600;letter-spacing:.3px}
</style></head><body>

<!-- ═══ HERO ═══ -->
<div class="hero">
  <div class="hero-row">
    <div class="brand">
      <div class="brand-name">GS Center</div>
      <div class="brand-sub">PC Report Card &middot; ${_escapeHtml(timestamp)}</div>
    </div>
    <div class="ring-wrap">
      <svg class="ring-svg" width="64" height="64" viewBox="0 0 96 96">
        <circle class="ring-bg" cx="48" cy="48" r="${radius}"/>
        <circle class="ring-fg" cx="48" cy="48" r="${radius}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${dashOffset}"/>
      </svg>
      <div class="ring-center">
        <span class="ring-letter">${grade.letter}</span>
        <span class="ring-score">${score} / 100</span>
      </div>
    </div>
  </div>
</div>

<div class="content">

  <!-- ═══ SPECS + HEALTH (side by side) ═══ -->
  <div class="duo">
    <div class="panel" style="margin-bottom:0">
      <div class="panel-t"><span class="dot"></span>Hardware</div>
      ${specsHtml}
    </div>
    <div class="panel" style="margin-bottom:0">
      <div class="panel-t"><span class="dot"></span>System Health</div>
      ${factorsHtml}
    </div>
  </div>

  <!-- ═══ TWEAKS ═══ -->
  ${total > 0 ? `
  <div class="panel">
    <div class="panel-t"><span class="dot"></span>Optimizations</div>
    <div class="tw-info">
      <span class="tw-stat"><b>${applied.length}</b> / ${total} active</span>
      <span class="tw-pct">${tweakPct}%</span>
    </div>
    <div class="tw-grid">${tweakTags}</div>
  </div>` : ''}

  <!-- ═══ GAMES ═══ -->
  ${games.length ? `
  <div class="panel">
    <div class="panel-t"><span class="dot"></span>Game Performance</div>
    <div class="gc-grid">${gameCards}</div>
  </div>` : ''}

  <!-- ═══ ADVISOR ═══ -->
  ${insights.length || upgrades.length ? `
  <div class="panel">
    <div class="panel-t"><span class="dot"></span>Recommendations</div>
    ${advHtml}${upgHtml}
  </div>` : ''}

</div>

<div class="foot">
  <span class="foot-l">Generated by GS Center</span>
  <span class="foot-r">gs-center.gg</span>
</div>

</body></html>`;
}

/* ── Render to image via hidden BrowserWindow ────────────────────────────── */

async function _renderToImage(html) {
  const SCALE = 2;              // 2× for crisp output
  const WIDTH = 700;            // must match body { width } in the template

  const win = new BrowserWindow({
    width: WIDTH * SCALE,
    height: 400,
    show: false,
    frame: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Zoom the content 2× so everything renders at double resolution
    win.webContents.setZoomFactor(SCALE);

    // Wait for Google Fonts to load
    await win.webContents.executeJavaScript(
      'document.fonts ? document.fonts.ready : Promise.resolve()'
    );

    // Get the CSS height (pre-zoom) then multiply for the zoomed window
    const cssHeight = await win.webContents.executeJavaScript(
      'document.body.scrollHeight'
    );
    win.setSize(WIDTH * SCALE, Math.min(cssHeight * SCALE + 20, 12000));

    await new Promise(r => setTimeout(r, 400));

    const image = await win.webContents.capturePage();
    return image;
  } finally {
    win.destroy();
  }
}

/* ── Public API ───────────────────────────────────────────────────────────── */

function registerIPC() {
  ipcMain.handle('report:generate', async (_event, data) => {
    try {
      const html = _buildReportHtml(data);
      const image = await _renderToImage(html);
      const pngBuffer = image.toPNG();

      // Save to temp file for sharing
      const tmpDir = path.join(os.tmpdir(), 'gs-center');
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const filePath = path.join(tmpDir, `pc-report-${Date.now()}.png`);
      await fs.promises.writeFile(filePath, pngBuffer);

      return {
        imageBase64: pngBuffer.toString('base64'),
        imagePath: filePath,
      };
    } catch (err) {
      console.error('[ReportCard] Generation failed:', err);
      throw err;
    }
  });

  ipcMain.handle('report:copy-image', async (_event, base64) => {
    try {
      const img = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
      clipboard.writeImage(img);
      return { ok: true };
    } catch (err) {
      console.error('[ReportCard] Copy failed:', err);
      throw err;
    }
  });

  ipcMain.handle('report:save-image', async (_event, base64) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save PC Report Card',
        defaultPath: path.join(os.homedir(), 'Desktop', `pc-report-${Date.now()}.png`),
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });
      if (canceled || !filePath) return { ok: false };
      await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
      return { ok: true, filePath };
    } catch (err) {
      console.error('[ReportCard] Save failed:', err);
      throw err;
    }
  });
}

module.exports = { registerIPC };

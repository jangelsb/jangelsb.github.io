import * as THREE from 'three';
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource } from 'mediabunny';
import { CONFIG } from './config.js';
import { renderer, camera } from './scene.js';
import { getEstimatedRollDurationMs, roll, rollState } from './animation.js';
import { modifierAnim, getOverlayCanvas, drawCardsToCanvas, setModifiers } from './modifiers.js';
import { renderModifierCards } from './ui.js';
import { activeDieState, buildDie, rebuildTextures } from './geometry.js';
import { applyTheme, getThemeByKey } from './themes.js';

export const exportNumbers = new Set(Array.from({ length: 20 }, (_, i) => i + 1));

let exportCancelled = false;
let exportDirHandle = null;
const EXPORT_FRAME_RATE = 60;
const EXPORT_FRAME_DURATION = 1 / EXPORT_FRAME_RATE;
const MIN_FRAME_DURATION = 1 / 240;
const MAX_QUEUED_EXPORT_FRAMES = EXPORT_FRAME_RATE * 20;

// Draws the #result text onto the composite canvas, mirroring its CSS style.
function drawResultToCanvas(ctx, canvasW, canvasH) {
  const el = document.getElementById('result');
  if (!el || !el.classList.contains('show') || !el.textContent.trim()) return;
  const scale    = canvasW / window.innerWidth;
  const fontSize = Math.round(30 * scale);
  const topY     = Math.round(36 * scale) + fontSize / 2;
  ctx.save();
  ctx.font         = `${fontSize}px Georgia, serif`;
  ctx.fillStyle    = CONFIG.numberColor  || '#f5e8c0';
  ctx.shadowColor  = CONFIG.glowColor    || '#c8a84a';
  ctx.shadowBlur   = 16 * scale;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(el.textContent, canvasW / 2, topY);
  ctx.restore();
}

function waitForDoneState(timeoutMs = getEstimatedRollDurationMs()) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    (function check() {
      if (rollState.current === 'done' || exportCancelled || Date.now() > deadline) return resolve();
      requestAnimationFrame(check);
    })();
  });
}

async function saveBlob(blob, filename) {
  if (exportDirHandle) {
    const fh = await exportDirHandle.getFileHandle(filename, { create: true });
    const w  = await fh.createWritable();
    await w.write(blob);
    await w.close();
  } else {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
}

function getExportSettings() {
  const resMul  = parseInt(document.getElementById('exp-res').value, 10);
  const bgKey   = document.getElementById('exp-bg').value;
  const bitrate = parseInt(document.getElementById('exp-bitrate').value, 10);
  const bgColor = { chroma: '#00FF00', magenta: '#FF00FF', black: '#000000', current: CONFIG.bgColor }[bgKey];
  const leadInMs = Math.round(parseFloat(document.getElementById('exp-leadin').value) * 1000);
  const holdMs   = Math.round(parseFloat(document.getElementById('exp-hold').value) * 1000);
  return { resMul, bgColor, bitrate, leadInMs, holdMs };
}

function getExportVisibility() {
  return {
    showModifierAnim: document.getElementById('exp-show-modfx')?.checked  ?? true,
    showCards:        document.getElementById('exp-show-cards')?.checked  ?? false,
    showResult:       document.getElementById('exp-show-result')?.checked ?? false,
  };
}

function getErrorMessage(err) {
  return err?.message ?? String(err);
}

function getActiveDieMaxRoll() {
  const labels = activeDieState.labels || [];
  return labels.includes(0) ? 10 : labels.length;
}

function normalizeRollNumber(n) {
  const rollNumber = Math.round(Number(n));
  const maxRoll = getActiveDieMaxRoll();
  if (!Number.isFinite(rollNumber) || rollNumber < 1 || rollNumber > maxRoll) {
    throw new Error(`Roll ${n} is invalid for ${CONFIG.dieType.toUpperCase()} (expected 1-${maxRoll}).`);
  }
  return rollNumber;
}

async function recordSingleRoll(n, settings, filename) {
  const rollNumber = normalizeRollNumber(n);
  const { resMul, bgColor, bitrate, leadInMs, holdMs } = settings;
  const vis = getExportVisibility();

  const origW = window.innerWidth;
  const origH = window.innerHeight;
  renderer.setSize(origW * resMul, origH * resMul);
  renderer.setPixelRatio(1);
  camera.aspect = origW / origH;
  camera.updateProjectionMatrix();
  renderer.setClearColor(new THREE.Color(bgColor), 1);
  document.body.style.background = bgColor;

  modifierAnim.skip = !vis.showModifierAnim;
  if (!vis.showCards)  document.body.classList.add('export-no-cards');
  document.body.classList.add('export-no-result');

  rollState.current = 'idle';
  await new Promise(r => setTimeout(r, 350));

  const restore = () => {
    renderer.setClearColor(0x000000, 0);
    document.body.style.background = CONFIG.bgColor;
    renderer.setSize(origW, origH);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.aspect = origW / origH;
    camera.updateProjectionMatrix();
    document.body.classList.remove('export-no-cards', 'export-no-result');
    modifierAnim.skip = false;
  };

  if (exportCancelled) { restore(); return false; }

  const compCanvas  = document.createElement('canvas');
  compCanvas.width  = origW * resMul;
  compCanvas.height = origH * resMul;
  const compCtx     = compCanvas.getContext('2d');
  const overlay     = getOverlayCanvas();

  // Mediabunny: progressive MP4 with moov at the front (Fast Start).
  // Produces a standard MP4 DaVinci Resolve / Premiere / FCP can import directly,
  // unlike the fragmented fMP4 that MediaRecorder outputs.
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });
  const canvasSource = new CanvasSource(compCanvas, {
    codec: 'avc',
    bitrate,
    transform: { frameRate: EXPORT_FRAME_RATE },
  });
  output.addVideoTrack(canvasSource, { frameRate: EXPORT_FRAME_RATE });

  let outputStarted = false;
  let outputSettled = false;
  let sourceClosed = false;
  let captureActive = false;
  let capturePromise = null;
  let captureError = null;
  const pendingFrameAdds = [];
  let queuedFrameAdds = 0;

  try {
    await output.start();
    outputStarted = true;
  } catch (err) {
    try { canvasSource.close(); } catch {}
    restore();
    throw new Error(`H.264 encoding is not supported in this browser. ${getErrorMessage(err)}`);
  }

  // Capture loop: composite WebGL + overlay + UI onto compCanvas each rAF tick,
  // then hand the snapshot to Mediabunny. Three.js's animation loop is registered
  // first, so renderer.domElement always holds the freshest rendered frame.
  let frameTimestamp = 0;
  let lastCaptureTimeMs = null;
  const runCapture = async () => {
    while (captureActive && !exportCancelled) {
      const captureTimeMs = await new Promise(r => requestAnimationFrame(r));
      if (!captureActive || exportCancelled) break;
      const frameDuration = lastCaptureTimeMs === null
        ? EXPORT_FRAME_DURATION
        : Math.max((captureTimeMs - lastCaptureTimeMs) / 1000, MIN_FRAME_DURATION);
      lastCaptureTimeMs = captureTimeMs;
      compCtx.clearRect(0, 0, compCanvas.width, compCanvas.height);
      compCtx.drawImage(renderer.domElement, 0, 0);
      if (vis.showModifierAnim && overlay && overlay.width > 0) {
        compCtx.drawImage(overlay, 0, 0, compCanvas.width, compCanvas.height);
      }
      if (vis.showCards)  drawCardsToCanvas(compCtx, compCanvas.width, compCanvas.height);
      if (vis.showResult) drawResultToCanvas(compCtx, compCanvas.width, compCanvas.height);
      try {
        queuedFrameAdds++;
        const addPromise = canvasSource.add(frameTimestamp, frameDuration)
          .catch(err => {
            captureError = captureError || err;
            exportCancelled = true;
          })
          .finally(() => { queuedFrameAdds--; });
        pendingFrameAdds.push(addPromise);
        if (queuedFrameAdds > MAX_QUEUED_EXPORT_FRAMES) {
          captureError = new Error('Video encoder fell too far behind while exporting. Try 1x resolution or a lower bitrate.');
          exportCancelled = true;
        }
      } catch (err) {
        queuedFrameAdds = Math.max(0, queuedFrameAdds - 1);
        captureError = err;
        exportCancelled = true;
      }
      frameTimestamp += frameDuration;
    }
  };

  const stopCapture = async () => {
    captureActive = false;
    if (capturePromise) await capturePromise;
    await Promise.all(pendingFrameAdds);
    if (!sourceClosed) {
      canvasSource.close();
      sourceClosed = true;
    }
    if (captureError) throw captureError;
  };

  try {
    captureActive = true;
    capturePromise = runCapture().catch(err => {
      captureError = err;
      exportCancelled = true;
    });

    await new Promise(r => setTimeout(r, leadInMs));
    if (!exportCancelled) roll(rollNumber);

    await waitForDoneState();
    if (!exportCancelled) await new Promise(r => setTimeout(r, holdMs));

    await stopCapture();

    if (exportCancelled) {
      await output.cancel();
      outputSettled = true;
      return false;
    }

    await output.finalize();
    outputSettled = true;
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    await saveBlob(blob, filename || `d20_roll_${String(rollNumber).padStart(2, '0')}.mp4`);
    return true;
  } finally {
    captureActive = false;
    if (capturePromise) {
      try { await capturePromise; } catch {}
    }
    if (!sourceClosed) {
      try { canvasSource.close(); } catch {}
    }
    if (outputStarted && !outputSettled) {
      try { await output.cancel(); } catch {}
    }
    restore();
  }
}

export async function generateAllWebMs() {
  exportCancelled = false;
  exportDirHandle = null;

  if (window.showDirectoryPicker) {
    try {
      exportDirHandle = await window.showDirectoryPicker({ id: 'd20-export', mode: 'readwrite', startIn: 'downloads' });
    } catch (e) {
      if (e.name === 'AbortError') return;
      exportDirHandle = null;
    }
  }

  const overlay    = document.getElementById('exportOverlay');
  const progressEl = document.getElementById('exportProgress');
  const barFill    = document.getElementById('exportBarFill');
  const cancelBtn  = document.getElementById('exportCancelBtn');

  barFill.style.width   = '0%';
  cancelBtn.disabled    = false;
  cancelBtn.textContent = 'Cancel';
  overlay.classList.add('show');

  const settings        = getExportSettings();
  const numbersToExport = [...exportNumbers].sort((a, b) => a - b);
  const total           = numbersToExport.length;

  if (!total) {
    overlay.classList.remove('show');
    alert('Select at least one number to export.');
    return;
  }

  let failed = false;
  let statusText = '';

  try {
    for (let i = 0; i < total; i++) {
      if (exportCancelled) break;
      const n = numbersToExport[i];
      progressEl.textContent = `Recording roll ${n}  (${i + 1} / ${total})\u2026`;
      barFill.style.width    = `${(i / total) * 100}%`;
      await recordSingleRoll(n, settings, `${CONFIG.dieType}_roll_${String(n).padStart(2, '0')}.mp4`);
      if (!exportCancelled) await new Promise(r => setTimeout(r, 150));
    }

    statusText = exportCancelled ? 'Cancelled.' : `Done! ${total} roll${total !== 1 ? 's' : ''} saved.`;
  } catch (err) {
    failed = true;
    exportCancelled = true;
    statusText = `Export failed: ${getErrorMessage(err)}`;
    console.error('Video export failed', err);
    alert(statusText);
  } finally {
    if (!failed) barFill.style.width = '100%';
    progressEl.textContent = statusText;
    cancelBtn.disabled = true;

    await new Promise(r => setTimeout(r, failed ? 4000 : 2000));
    overlay.classList.remove('show');
    rollState.current = 'idle';
  }
}

export function initExportCancelBtn() {
  document.getElementById('exportCancelBtn').addEventListener('click', () => {
    exportCancelled = true;
    document.getElementById('exportCancelBtn').textContent = 'Cancelling\u2026';
  });
}

// ── Timeline export ───────────────────────────────────────────────────────────
// Records each timeline item as a separate MP4 video.
// items: TimelineItem[] — each has { label, dieType, themeName, modifiers, number }
export async function exportTimelineItems(items, settings) {
  exportCancelled = false;
  exportDirHandle = null;

  if (window.showDirectoryPicker) {
    try {
      exportDirHandle = await window.showDirectoryPicker({ id: 'd20-export', mode: 'readwrite', startIn: 'downloads' });
    } catch (e) {
      if (e.name === 'AbortError') return;
      exportDirHandle = null;
    }
  }

  const overlay    = document.getElementById('exportOverlay');
  const progressEl = document.getElementById('exportProgress');
  const barFill    = document.getElementById('exportBarFill');
  const cancelBtn  = document.getElementById('exportCancelBtn');

  barFill.style.width   = '0%';
  cancelBtn.disabled    = false;
  cancelBtn.textContent = 'Cancel';
  overlay.classList.add('show');

  const total = items.length;

  let failed = false;
  let statusText = '';

  try {
    for (let i = 0; i < total; i++) {
      if (exportCancelled) break;
      const item = items[i];
      progressEl.textContent = `Recording item ${i + 1} / ${total}: \u201c${item.label || item.dieType}\u201d\u2026`;
      barFill.style.width = `${(i / total) * 100}%`;

      // Apply theme
      const theme = getThemeByKey(item.themeName);
      if (theme) {
        applyTheme(theme);
        await new Promise(r => setTimeout(r, 100));
      }

      // Apply die type
      CONFIG.dieType = item.dieType;
      buildDie(item.dieType);
      rebuildTextures();
      await new Promise(r => setTimeout(r, 250));

      // Apply modifiers (without persisting to localStorage)
      setModifiers(item.modifiers || []);
      renderModifierCards();

      const safeName = (item.label || item.dieType)
        .replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '_') || item.dieType;
      const filename = `${String(i + 1).padStart(2, '0')}_${safeName}_${item.dieType}_roll${String(item.number).padStart(2, '0')}.mp4`;

      await recordSingleRoll(item.number, settings, filename);

      if (!exportCancelled) await new Promise(r => setTimeout(r, 150));
    }

    statusText = exportCancelled ? 'Cancelled.' : `Done! ${total} item${total !== 1 ? 's' : ''} exported.`;
  } catch (err) {
    failed = true;
    exportCancelled = true;
    statusText = `Export failed: ${getErrorMessage(err)}`;
    console.error('Timeline export failed', err);
    alert(statusText);
  } finally {
    if (!failed) barFill.style.width = '100%';
    progressEl.textContent = statusText;
    cancelBtn.disabled = true;

    await new Promise(r => setTimeout(r, failed ? 4000 : 2000));
    overlay.classList.remove('show');
    rollState.current = 'idle';
  }
}

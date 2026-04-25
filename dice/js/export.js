import * as THREE from 'three';
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource } from 'mediabunny';
import { CONFIG } from './config.js';
import { renderer, camera } from './scene.js';
import { roll, rollState } from './animation.js';
import { modifierAnim, getOverlayCanvas, drawCardsToCanvas } from './modifiers.js';

export const exportNumbers = new Set(Array.from({ length: 20 }, (_, i) => i + 1));

let exportCancelled = false;
let exportDirHandle = null;

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

function waitForDoneState(timeoutMs = 25000) {
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

async function recordSingleRoll(n, settings) {
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

  if (exportCancelled) { restore(); return; }

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
  const canvasSource = new CanvasSource(compCanvas, { codec: 'avc', bitrate });
  output.addVideoTrack(canvasSource, { frameRate: 60 });

  try {
    await output.start();
  } catch (err) {
    restore();
    alert(`H.264 encoding is not supported in this browser.\n${err.message ?? err}`);
    return;
  }

  // Capture loop: composite WebGL + overlay + UI onto compCanvas each rAF tick,
  // then hand the snapshot to Mediabunny. Three.js's animation loop is registered
  // first, so renderer.domElement always holds the freshest rendered frame.
  let captureActive = true;
  let frameTimestamp = 0;
  const runCapture = async () => {
    while (captureActive && !exportCancelled) {
      await new Promise(r => requestAnimationFrame(r));
      if (!captureActive || exportCancelled) break;
      compCtx.clearRect(0, 0, compCanvas.width, compCanvas.height);
      compCtx.drawImage(renderer.domElement, 0, 0);
      if (vis.showModifierAnim && overlay && overlay.width > 0) {
        compCtx.drawImage(overlay, 0, 0, compCanvas.width, compCanvas.height);
      }
      if (vis.showCards)  drawCardsToCanvas(compCtx, compCanvas.width, compCanvas.height);
      if (vis.showResult) drawResultToCanvas(compCtx, compCanvas.width, compCanvas.height);
      await canvasSource.add(frameTimestamp, 1 / 60);
      frameTimestamp += 1 / 60;
    }
  };

  const capturePromise = runCapture();

  await new Promise(r => setTimeout(r, leadInMs));
  if (!exportCancelled) roll(n);

  await waitForDoneState();
  if (!exportCancelled) await new Promise(r => setTimeout(r, holdMs));

  captureActive = false;
  await capturePromise;
  canvasSource.close();
  restore();

  if (!exportCancelled) {
    await output.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    await saveBlob(blob, `d20_roll_${String(n).padStart(2, '0')}.mp4`);
  } else {
    await output.cancel();
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

  for (let i = 0; i < total; i++) {
    if (exportCancelled) break;
    const n = numbersToExport[i];
    progressEl.textContent = `Recording roll ${n}  (${i + 1} / ${total})\u2026`;
    barFill.style.width    = `${(i / total) * 100}%`;
    await recordSingleRoll(n, settings);
    if (!exportCancelled) await new Promise(r => setTimeout(r, 150));
  }

  barFill.style.width    = '100%';
  progressEl.textContent = exportCancelled ? 'Cancelled.' : `Done! ${total} roll${total !== 1 ? 's' : ''} saved.`;
  cancelBtn.disabled     = true;

  await new Promise(r => setTimeout(r, 2000));
  overlay.classList.remove('show');
  rollState.current = 'idle';
}

export function initExportCancelBtn() {
  document.getElementById('exportCancelBtn').addEventListener('click', () => {
    exportCancelled = true;
    document.getElementById('exportCancelBtn').textContent = 'Cancelling\u2026';
  });
}

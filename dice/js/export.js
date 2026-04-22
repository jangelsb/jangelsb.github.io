import * as THREE from 'three';
import { CONFIG } from './config.js';
import { renderer, camera } from './scene.js';
import { roll, rollState } from './animation.js';

export const exportNumbers = new Set(Array.from({ length: 20 }, (_, i) => i + 1));

let exportCancelled = false;
let exportDirHandle = null;

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
  const fmtRaw  = document.getElementById('exp-format').value;
  const { mime, ext } = fmtRaw ? JSON.parse(fmtRaw) : { mime: 'video/webm;codecs=vp9', ext: 'webm' };
  const leadInMs = Math.round(parseFloat(document.getElementById('exp-leadin').value) * 1000);
  const holdMs   = Math.round(parseFloat(document.getElementById('exp-hold').value) * 1000);
  return { resMul, bgColor, bitrate, mime, ext, leadInMs, holdMs };
}

async function recordSingleRoll(n, settings) {
  const { resMul, bgColor, bitrate, mime, ext, leadInMs, holdMs } = settings;

  const origW = window.innerWidth;
  const origH = window.innerHeight;
  renderer.setSize(origW * resMul, origH * resMul);
  renderer.setPixelRatio(1);
  camera.aspect = origW / origH;
  camera.updateProjectionMatrix();
  renderer.setClearColor(new THREE.Color(bgColor), 1);
  document.body.style.background = bgColor;

  rollState.current = 'idle';
  await new Promise(r => setTimeout(r, 350));

  const restore = () => {
    renderer.setClearColor(0x000000, 0);
    document.body.style.background = CONFIG.bgColor;
    renderer.setSize(origW, origH);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.aspect = origW / origH;
    camera.updateProjectionMatrix();
  };

  if (exportCancelled) { restore(); return; }

  const stream = renderer.domElement.captureStream(60);

  return new Promise(resolve => {
    const chunks   = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      restore();
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      await saveBlob(blob, `d20_roll_${String(n).padStart(2, '0')}.${ext}`);
      resolve();
    };

    recorder.start(50);
    const rollTimer = setTimeout(() => { if (!exportCancelled) roll(n); }, leadInMs);

    waitForDoneState().then(() => {
      clearTimeout(rollTimer);
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
        else { restore(); resolve(); }
      }, exportCancelled ? 0 : holdMs);
    });
  });
}

export async function generateAllWebMs() {
  if (!window.MediaRecorder) {
    alert('MediaRecorder is not supported in this browser. Try Chrome.');
    return;
  }

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

import * as THREE from 'three';
import { CONFIG } from './config.js';

// ── Shape helpers ─────────────────────────────────────────────────────────────

function drawPolygon(ctx, verts) {
  ctx.beginPath();
  ctx.moveTo(...verts[0]);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(...verts[i]);
  ctx.closePath();
}

// ── Per-die-type face drawing ─────────────────────────────────────────────────

function drawTriangle(ctx, S, number, apexDown) {
  // 0.03 = UV inset baked into computeFaceData; faceGap is the additional border inside the geometry edge
  const M = Math.round((CONFIG.faceGap + 0.03) * S);
  const triVerts = apexDown
    ? [[S / 2, S - M - 6], [S - M, M], [M, M]]
    : [[S / 2, M + 6],     [S - M, S - M], [M, S - M]];
  drawPolygon(ctx, triVerts);
  const grad = ctx.createLinearGradient(0, M, S, S);
  grad.addColorStop(0, CONFIG.faceColorTop);
  grad.addColorStop(1, CONFIG.faceColorBottom);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = CONFIG.borderColor; ctx.lineWidth = 5; ctx.stroke();
  const cx = (triVerts[0][0] + triVerts[1][0] + triVerts[2][0]) / 3;
  const cy = (triVerts[0][1] + triVerts[1][1] + triVerts[2][1]) / 3;
  drawNumber(ctx, number, cx, cy);
}

// For faces that use flat UV projection across the real face polygon (D6, D10, D12).
// We draw the polygon centered in the canvas based on faceHint.shapeVerts (normalized 0–1).
function drawPolyFace(ctx, S, number, shapeVerts) {
  // UV goes edge-to-edge (padding=0 in geometry), so faceGap alone controls the border
  const M = Math.round(CONFIG.faceGap * S);
  // Scale verts to canvas with a small margin
  const scaled = shapeVerts.map(([u, v]) => [M + u * (S - 2 * M), M + (1 - v) * (S - 2 * M)]);

  drawPolygon(ctx, scaled);
  const grad = ctx.createLinearGradient(0, M, 0, S - M);
  grad.addColorStop(0, CONFIG.faceColorTop);
  grad.addColorStop(1, CONFIG.faceColorBottom);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = CONFIG.borderColor; ctx.lineWidth = 5; ctx.stroke();

  // Center of the polygon in canvas space
  const cx = scaled.reduce((s, p) => s + p[0], 0) / scaled.length;
  const cy = scaled.reduce((s, p) => s + p[1], 0) / scaled.length;
  drawNumber(ctx, number, cx, cy);
}

// For faces that use projection-based UVs (D6, D10, D12): fill the whole canvas.
// The geometry polygon shape is defined by the mesh itself; the texture just
// needs a solid fill + centered number.
function drawFlatFace(ctx, S, number) {
  const M = 20;
  ctx.beginPath();
  ctx.rect(M, M, S - M * 2, S - M * 2);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, M, 0, S - M);
  grad.addColorStop(0, CONFIG.faceColorTop);
  grad.addColorStop(1, CONFIG.faceColorBottom);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = CONFIG.borderColor; ctx.lineWidth = 5; ctx.stroke();
  drawNumber(ctx, number, S / 2, S / 2);
}

function drawNumber(ctx, number, cx, cy) {
  const label = typeof number === 'string' ? number : String(number);
  ctx.shadowColor = CONFIG.glowColor + '99';
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = CONFIG.numberColor;
  const weight = CONFIG.fontBold ? 'bold' : 'normal';
  const big = label.length >= 2 ? 150 : 172;
  ctx.font = `${weight} ${big}px ${CONFIG.fontFamily}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 4);
  ctx.shadowBlur = 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

// faceHint is a die-type-specific hint object passed from geometry.js
// For d4/d8/d20 it's { apexDown: bool }
// For d10 it's { faceIndex: number }
// For d6/d12 it's unused
export function drawFaceOnCanvas(canvas, number, faceHint = {}) {
  const S   = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  if (faceHint.shapeVerts) {
    drawPolyFace(ctx, S, number, faceHint.shapeVerts);
  } else {
    // Triangle face (D4, D8, D20)
    drawTriangle(ctx, S, number, faceHint.apexDown ?? false);
  }
}

// Creates a new canvas, draws a face on it, and wraps it in a THREE.CanvasTexture.
export function makeTexture(number, faceHint = {}) {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 512;
  drawFaceOnCanvas(cvs, number, faceHint);
  return new THREE.CanvasTexture(cvs);
}

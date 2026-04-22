import * as THREE from 'three';
import { CONFIG } from './config.js';

// Draws a triangular face texture onto a canvas and returns a THREE.CanvasTexture.
// apexDown = true for ▽ faces (apex at bottom), false for Δ faces (apex at top).
export function makeTexture(number, apexDown = false) {
  const S = 512;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#00000000';
  ctx.fillRect(0, 0, S, S);

  const M = 28;
  const triVerts = apexDown
    ? [[S / 2, S - M - 6], [S - M, M], [M, M]]
    : [[S / 2, M + 6],     [S - M, S - M], [M, S - M]];

  ctx.beginPath();
  ctx.moveTo(...triVerts[0]);
  ctx.lineTo(...triVerts[1]);
  ctx.lineTo(...triVerts[2]);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, M, S, S);
  grad.addColorStop(0, CONFIG.faceColorTop);
  grad.addColorStop(1, CONFIG.faceColorBottom);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = CONFIG.borderColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  const cx = (triVerts[0][0] + triVerts[1][0] + triVerts[2][0]) / 3;
  const cy = (triVerts[0][1] + triVerts[1][1] + triVerts[2][1]) / 3;

  ctx.shadowColor = CONFIG.glowColor + '99';
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = CONFIG.numberColor;
  const weight = CONFIG.fontBold ? 'bold' : 'normal';
  ctx.font = `${weight} ${number >= 10 ? 150 : 172}px ${CONFIG.fontFamily}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), cx, cy + 4);
  ctx.shadowBlur = 0;

  return new THREE.CanvasTexture(cvs);
}

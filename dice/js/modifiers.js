/**
 * modifiers.js
 * Manages the modifier list (data) and the fly-in animation sequence.
 *
 * After the die settles, call runModifiers(dieRoll) to kick off the sequence.
 * Each modifier's text + pixie dust flies from its card toward the die center.
 * On impact the die shakes and the displayed total ticks up/down.
 *
 * All animations draw to the persistent #mod-overlay-canvas so they are
 * captured by the export composite recorder.
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { projectToScreen, worldUnitsToScreenPixels } from './scene.js';
import { dice, FACE_INRADIUS, FACE_EDGE } from './geometry.js';

// ── Persistent overlay canvas ─────────────────────────────────────────────────
const overlayCanvas = document.getElementById('mod-overlay-canvas');
overlayCanvas.width  = window.innerWidth;
overlayCanvas.height = window.innerHeight;
window.addEventListener('resize', () => {
  overlayCanvas.width  = window.innerWidth;
  overlayCanvas.height = window.innerHeight;
});
export function getOverlayCanvas() { return overlayCanvas; }

// Flag to skip visual fly-in (set by export.js when animations are off)
export const modifierAnim = { skip: false };

// Generation counter: bumped every time a new fly-in starts.
// Each animation loop captures its own generation at creation time and stops
// clearing/drawing the shared canvas once a newer animation has taken over.
let animGeneration = 0;

// ── Modifier data store ───────────────────────────────────────────────────────
// Each entry: { id, label, value }  (value is a signed integer)
const STORAGE_KEY = 'd20-modifiers';

function loadFromStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(modifiers));
}

let modifiers = loadFromStorage();
let nextId = modifiers.length ? Math.max(...modifiers.map(m => m.id)) + 1 : 1;

export function getModifiers() { return modifiers; }

export function addModifier(label, value) {
  modifiers.push({ id: nextId++, label, value });
  saveToStorage();
}

export function removeModifier(id) {
  modifiers = modifiers.filter(m => m.id !== id);
  saveToStorage();
}

export function clearModifiers() { modifiers = []; saveToStorage(); }

// Temporarily override modifiers without persisting to localStorage (used by timeline export).
export function setModifiers(mods) {
  modifiers = mods.map((m, i) => ({ label: m.label, value: m.value, id: i + 1 }));
  nextId = modifiers.length + 1;
}

// ── Canvas card renderer (used by export composite) ───────────────────────────
// Draws modifier cards directly onto a 2D canvas context so they appear in
// the exported video even though the DOM elements can't be captured by captureStream().
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawCardsToCanvas(ctx, canvasW, canvasH) {
  if (!modifiers.length) return;

  const pixelScale  = canvasW / window.innerWidth;
  const cardScale   = CONFIG.modCardScale  ?? 1.0;
  const bottomPx    = (CONFIG.modCardsBottom ?? 108) * pixelScale;

  const cardW  = 90  * cardScale * pixelScale;
  const cardH  = 62  * cardScale * pixelScale;
  const gap    = 10  * cardScale * pixelScale;
  const radius = 10  * cardScale * pixelScale;

  const totalW = modifiers.length * cardW + (modifiers.length - 1) * gap;
  const startX = (canvasW - totalW) / 2;
  const cardY  = canvasH - bottomPx - cardH;

  modifiers.forEach((mod, i) => {
    const x = startX + i * (cardW + gap);

    ctx.save();

    // Background gradient
    const grad = ctx.createLinearGradient(x, cardY, x, cardY + cardH);
    grad.addColorStop(0, (CONFIG.modCardBg1 || '#1a1830') + 'ee');
    grad.addColorStop(1, (CONFIG.modCardBg2 || '#0c0c1e') + 'ee');
    roundedRect(ctx, x, cardY, cardW, cardH, radius);
    ctx.fillStyle = grad;
    ctx.fill();

    // Border
    ctx.strokeStyle = CONFIG.modCardBorder || '#c8a84a';
    ctx.lineWidth   = 1.5 * pixelScale;
    roundedRect(ctx, x, cardY, cardW, cardH, radius);
    ctx.stroke();

    // Top shimmer line
    const shimmerGrad = ctx.createLinearGradient(x + cardW * 0.1, cardY, x + cardW * 0.9, cardY);
    shimmerGrad.addColorStop(0, 'transparent');
    shimmerGrad.addColorStop(0.5, (CONFIG.modCardBorder || '#c8a84a') + '88');
    shimmerGrad.addColorStop(1, 'transparent');
    ctx.strokeStyle = shimmerGrad;
    ctx.lineWidth   = 1 * pixelScale;
    ctx.beginPath();
    ctx.moveTo(x + cardW * 0.1, cardY);
    ctx.lineTo(x + cardW * 0.9, cardY);
    ctx.stroke();

    // Label
    const labelSize = Math.round(10 * cardScale * pixelScale);
    ctx.font         = `${labelSize}px Georgia, serif`;
    ctx.fillStyle    = CONFIG.modCardLabelColor || '#c8a84a';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = `${1.5 * pixelScale}px`;
    const labelText = mod.label.toUpperCase();
    ctx.fillText(labelText, x + cardW / 2, cardY + 9 * cardScale * pixelScale, cardW - 8 * cardScale * pixelScale);

    // Value
    const isPos     = mod.value >= 0;
    const valueStr  = (isPos ? '+' : '') + mod.value;
    const valueSize = Math.round(22 * cardScale * pixelScale);
    const valueColor = isPos
      ? (CONFIG.modifierPositiveColor || '#f0c040')
      : (CONFIG.modifierNegativeColor || '#e05050');
    ctx.font         = `bold ${valueSize}px Georgia, serif`;
    ctx.fillStyle    = valueColor;
    ctx.shadowColor  = valueColor;
    ctx.shadowBlur   = 10 * cardScale * pixelScale;
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${1 * pixelScale}px`;
    ctx.fillText(valueStr, x + cardW / 2, cardY + cardH * 0.65);
    ctx.shadowBlur = 0;

    ctx.restore();
  });
}

// ── Animation sequence ────────────────────────────────────────────────────────
// Call this once the die has settled. Returns a Promise that resolves when all
// modifiers have been applied (so the caller can update final state).
export function runModifiers(baseRoll, onTick) {
  return new Promise(resolve => {
    const queue = [...modifiers];
    let total = baseRoll;

    function next() {
      if (!queue.length) { resolve(total); return; }
      const mod = queue.shift();
      total += mod.value;

      if (modifierAnim.skip) {
        // Skip visual, just apply value and move on quickly
        if (onTick) onTick(total, mod);
        setTimeout(next, 50);
      } else {
        const cardEl = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
        flyModifier(mod, cardEl, () => {
          if (onTick) onTick(total, mod);
          setTimeout(next, 300);
        });
      }
    }

    next();
  });
}

// ── Single modifier fly-in ────────────────────────────────────────────────────
// All drawing happens on the persistent overlayCanvas so it's captured by export.
function flyModifier(mod, cardEl, onImpact) {
  const faceCenterWorld = dice.position.clone().addScaledVector(
    new THREE.Vector3(0, 0, 1), FACE_INRADIUS * dice.scale.x
  );
  const dieCenter = projectToScreen(faceCenterWorld);

  let startX = dieCenter.x;
  let startY = window.innerHeight - 80;
  if (cardEl) {
    const r = cardEl.getBoundingClientRect();
    startX = r.left + r.width  / 2;
    startY = r.top  + r.height / 2;
  }

  const isPositive = mod.value >= 0;
  const textColor  = isPositive ? CONFIG.modifierPositiveColor : CONFIG.modifierNegativeColor;
  const label      = (mod.value >= 0 ? '+' : '') + mod.value;
  const fontFamily = CONFIG.fontFamily || 'Georgia, serif';

  const faceWorldZ  = FACE_INRADIUS * dice.scale.x;
  const faceScreenH = worldUnitsToScreenPixels(FACE_EDGE * dice.scale.x * Math.sqrt(3) / 2, faceWorldZ);
  const fontSize    = Math.round(faceScreenH * 0.27);

  const pcv  = overlayCanvas;
  const pctx = pcv.getContext('2d');

  // Each fly-in owns a generation. If a newer animation starts before this
  // one's cleanup loop finishes, the cleanup silently stops painting.
  const myGen = ++animGeneration;

  const TRAVEL_MS = 600;
  const startTime = performance.now();
  const dx        = dieCenter.x - startX;
  const dy        = dieCenter.y - startY;
  const particles = [];
  let impactFired = false;

  function spawnParticle(px, py) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    const life  = 0.4 + Math.random() * 0.5;
    particles.push({
      x: px, y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life, maxLife: life,
      size: 2 + Math.random() * 3,
    });
  }

  function frame(now) {
    const elapsed = now - startTime;
    const t  = Math.min(elapsed / TRAVEL_MS, 1.0);
    const et = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

    const curX  = startX + dx * et;
    const curY  = startY + dy * et;
    const scale = 1 + et * 0.5;

    pctx.clearRect(0, 0, pcv.width, pcv.height);

    // Draw flying text on overlay canvas
    pctx.save();
    pctx.font         = `bold ${Math.round(fontSize * scale)}px ${fontFamily}`;
    pctx.fillStyle    = textColor;
    pctx.shadowColor  = textColor;
    pctx.shadowBlur   = 24 * scale;
    pctx.textAlign    = 'center';
    pctx.textBaseline = 'middle';
    pctx.fillText(label, curX, curY);
    pctx.restore();

    // Spawn + draw particles
    if (t < 1.0 && Math.random() < 0.6) spawnParticle(curX, curY);
    const particleColor = CONFIG.modifierParticleColor;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.08;
      p.life -= 0.016;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const alpha = p.life / p.maxLife;
      pctx.globalAlpha = alpha;
      pctx.fillStyle   = particleColor;
      pctx.beginPath();
      pctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      pctx.fill();
    }
    pctx.globalAlpha = 1;

    if (t >= 1.0 && !impactFired) {
      impactFired = true;
      triggerImpact(myGen, pctx, pcv, particles, label, curX, curY, fontSize, textColor, fontFamily, cardEl, onImpact);
      return;
    }
    if (!impactFired) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// ── Impact effect ─────────────────────────────────────────────────────────────
function triggerImpact(myGen, pctx, pcv, particles, textLabel, textX, textY, fontSize, textColor, fontFamily, cardEl, onImpact) {
  const { x: cx, y: cy } = projectToScreen(dice.position);

  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.6 + Math.random() * 0.4,
      maxLife: 1.0,
      size: 2 + Math.random() * 4,
    });
  }

  document.dispatchEvent(new CustomEvent('modifierimpact'));

  // Flash the source card
  if (cardEl) {
    cardEl.classList.remove('shake', 'impact-flash');
    void cardEl.offsetWidth;
    cardEl.classList.add('shake', 'impact-flash');
    setTimeout(() => cardEl.classList.remove('shake', 'impact-flash'), 500);
  }

  // Fade the text out on canvas, keep particles alive a moment
  const cleanStart   = performance.now();
  const CLEAN_MS     = 900;
  const TEXT_FADE_MS = 300;

  function cleanFrame(now) {
    // If a newer fly-in has started, stop this cleanup loop immediately
    if (animGeneration !== myGen) return;

    const elapsed = now - cleanStart;
    const done    = elapsed > CLEAN_MS;
    pctx.clearRect(0, 0, pcv.width, pcv.height);

    const textAlpha = Math.max(0, 1 - elapsed / TEXT_FADE_MS);
    if (textAlpha > 0) {
      const ts = 1.5 + (elapsed / TEXT_FADE_MS) * 0.5;
      pctx.save();
      pctx.globalAlpha  = textAlpha;
      pctx.font         = `bold ${Math.round(fontSize * ts)}px ${fontFamily}`;
      pctx.fillStyle    = textColor;
      pctx.shadowColor  = textColor;
      pctx.shadowBlur   = 24 * ts;
      pctx.textAlign    = 'center';
      pctx.textBaseline = 'middle';
      pctx.fillText(textLabel, textX, textY);
      pctx.restore();
    }

    const particleColor = CONFIG.modifierParticleColor;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.1;
      p.vx *= 0.95;
      p.life -= 0.02;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const alpha = p.life / p.maxLife;
      pctx.globalAlpha = alpha;
      pctx.fillStyle   = particleColor;
      pctx.beginPath();
      pctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      pctx.fill();
    }
    pctx.globalAlpha = 1;

    if (!done || particles.length > 0 || textAlpha > 0) {
      requestAnimationFrame(cleanFrame);
    } else {
      pctx.clearRect(0, 0, pcv.width, pcv.height);
    }
  }

  requestAnimationFrame(cleanFrame);
  setTimeout(onImpact, 150);
}

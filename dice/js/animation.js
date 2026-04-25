import * as THREE from 'three';
import { CONFIG } from './config.js';
import { renderer, scene, camera, clock } from './scene.js';
import { activeDieState, dice, numToFace, faceTowardCamera, updateFaceNumber, resetFaceNumbers, DIE_RESTING_Y } from './geometry.js';
import { getModifiers, runModifiers } from './modifiers.js';

// ── Shared state ──────────────────────────────────────────────────────────────
// Use rollState.current (not a bare variable) so other modules (export.js) can
// read and write it without coupling to this module's internal scope.
export const rollState = { current: 'idle' };

// ── Internal roll vars ────────────────────────────────────────────────────────
let tumbleStart   = 0;
let settleStart   = 0;
let settleFrom    = new THREE.Quaternion();
let settleTo      = new THREE.Quaternion();
let rollAxis      = new THREE.Vector3();
let rollAngVelMag = 0;
let chaoAxis      = new THREE.Vector3();
let chaoMag       = 0;
let pendingResult = 0;
let idleT         = 0;

function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

// ── roll(n) ───────────────────────────────────────────────────────────────────
// Backwards-plans the starting quaternion so that integrating the decaying
// spin forward in time lands exactly on the target face orientation.
export function roll(n) {
  const currentDie = activeDieState.mesh;
  const currentNumToFace = activeDieState.numToFace;
  const currentLabels = activeDieState.labels;
  const maxVal = currentLabels.includes(0) ? 10 : currentLabels.length; // D10: max is 10 (shown as 0)

  n = Math.round(n);
  if (n < 1 || n > maxVal) return;

  // For D10, face label 0 represents 10
  const faceLabel = (CONFIG.dieType === 'd10' && n === 10) ? 0 : n;

  resetFaceNumbers();
  currentDie.position.set(0, DIE_RESTING_Y, 0);

  pendingResult = n;
  settleTo = faceTowardCamera(currentNumToFace[faceLabel]);

  // Primary axis: mostly horizontal so it reads like a throw
  rollAxis.set(
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 0.3,
    (Math.random() - 0.5) * 2
  ).normalize();

  // Secondary chaos axis (perpendicular-ish to primary)
  chaoAxis.set(
    rollAxis.z + (Math.random() - 0.5) * 0.4,
    -(Math.random() * 0.5 + 0.2),
    -rollAxis.x + (Math.random() - 0.5) * 0.4
  ).normalize();

  // ∫₀¹ exp(-k·s) ds = (1−exp(−k))/k  →  back-calculate required angular velocity
  const numSpins   = CONFIG.spinMin + Math.random() * 1.5;
  const totalAngle = numSpins * Math.PI * 2;
  const k          = CONFIG.decayRate;
  const integral   = (1 - Math.exp(-k)) / k;
  rollAngVelMag    = totalAngle / (integral * CONFIG.tumbleDur);
  chaoMag          = rollAngVelMag * CONFIG.chaosMag * (0.8 + Math.random() * 0.4);

  // Chaos decays 3× faster; compute its total angle analytically
  const kChaos          = k * 3.0;
  const integralChaos   = (1 - Math.exp(-kChaos)) / kChaos;
  const totalChaosAngle = chaoMag * CONFIG.tumbleDur * integralChaos;

  // Q_start = Q_target × Q_chaos⁻¹ × Q_primary⁻¹
  const qPrimaryInv = new THREE.Quaternion().setFromAxisAngle(rollAxis,  -totalAngle);
  const qChaosInv   = new THREE.Quaternion().setFromAxisAngle(chaoAxis,  -totalChaosAngle);
  currentDie.quaternion.copy(settleTo).multiply(qChaosInv).multiply(qPrimaryInv);

  rollState.current = 'tumbling';
  tumbleStart = performance.now() / 1000;
  document.getElementById('result').classList.remove('show');
}

window.roll = roll; // expose for console / URL params

// ── Render loop ───────────────────────────────────────────────────────────────
renderer.setAnimationLoop(() => {
  const dt  = clock.getDelta();
  const now = performance.now() / 1000;

  if (rollState.current === 'idle') {
    idleT += dt * 0.35;
    const m = activeDieState.mesh;
    if (m) m.quaternion.setFromEuler(new THREE.Euler(
      Math.sin(idleT * 0.7) * 0.45,
      idleT,
      Math.sin(idleT * 0.5) * 0.25
    ));

  } else if (rollState.current === 'tumbling') {
    const s = (now - tumbleStart) / CONFIG.tumbleDur;
    const m = activeDieState.mesh;

    if (s >= 1.0) {
      settleFrom.copy(m.quaternion);
      settleStart = now;
      rollState.current = 'settling';
    } else {
      const speed = Math.exp(-CONFIG.decayRate * s);
      const primaryDQ = new THREE.Quaternion()
        .setFromAxisAngle(rollAxis, rollAngVelMag * speed * dt);

      const chaoSpeed = Math.exp(-CONFIG.decayRate * 3.0 * s);
      const chaoDQ = new THREE.Quaternion()
        .setFromAxisAngle(chaoAxis, chaoMag * chaoSpeed * dt);

      m.quaternion.multiply(primaryDQ).multiply(chaoDQ).normalize();
    }

  } else if (rollState.current === 'settling') {
    const t = Math.min((now - settleStart) / CONFIG.settleDur, 1.0);
    const m = activeDieState.mesh;
    m.quaternion.slerpQuaternions(settleFrom, settleTo, easeOutQuint(t));

    if (t >= 1.0) {
      m.quaternion.copy(settleTo);
      rollState.current = 'done';

      const el = document.getElementById('result');

      const mods = getModifiers();
      if (mods.length === 0) {
        el.textContent = `Rolled: ${pendingResult}`;
        el.classList.add('show');
      } else {
        rollState.current = 'modifiers';

        const faceLabel = (CONFIG.dieType === 'd10' && pendingResult === 10) ? 0 : pendingResult;
        const frontFace = activeDieState.numToFace[faceLabel];
        runModifiers(pendingResult, (runningTotal, _mod) => {
          updateFaceNumber(frontFace, runningTotal);
        }).then(finalTotal => {
          el.textContent = `Rolled: ${finalTotal}`;
          el.classList.add('show');
          rollState.current = 'done';
        });
      }
    }

  } else if (rollState.current === 'done' || rollState.current === 'modifiers') {
    const now2 = performance.now() / 1000;
    const m = activeDieState.mesh;
    if (m) {
      if (now2 < shakeEnd) {
        const remaining = shakeEnd - now2;
        const decay     = remaining / 0.35;
        const offset    = Math.sin(now2 * 60) * shakeMag * decay;
        m.position.set(offset, DIE_RESTING_Y + offset * 0.5, 0);
      } else {
        m.position.set(0, DIE_RESTING_Y, 0);
      }
    }
  }

  renderer.render(scene, camera);
});

// ── Die shake on modifier impact ──────────────────────────────────────────────
let shakeEnd = 0;
let shakeMag = 0;

document.addEventListener('modifierimpact', () => {
  shakeEnd = performance.now() / 1000 + 0.35;
  shakeMag = 0.12;
});

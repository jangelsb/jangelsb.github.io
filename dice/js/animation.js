import * as THREE from 'three';
import { CONFIG } from './config.js';
import { renderer, scene, camera, clock } from './scene.js';
import { activeDieState, faceTowardCamera, updateFaceNumber, resetFaceNumbers, DIE_RESTING_Y } from './geometry.js';
import { cancelModifierAnimations, getModifiers, runModifiers } from './modifiers.js';
import { createWallMotion, getWallArena, updateWallMotion } from './roll-motion.js';

// ── Shared state ──────────────────────────────────────────────────────────────
// Other modules use this mutable object to wait for and reset the roll lifecycle.
export const rollState = { current: 'idle', wallBounces: 0 };

// ── Internal roll state ───────────────────────────────────────────────────────
let activeRoll = null;
let rollGeneration = 0;
let idleT = 0;
let shakeEnd = 0;
let shakeMag = 0;

function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function snapshotSettings() {
  const baseTumbleDur = positiveNumber(CONFIG.tumbleDur, 1.9);
  const wallBounceEnabled = Boolean(CONFIG.wallBounceEnabled);
  const wallExtraDur = wallBounceEnabled ? Math.max(Number(CONFIG.wallExtraDur) || 0, 0) : 0;

  return {
    dieType: CONFIG.dieType,
    baseTumbleDur,
    tumbleDur: baseTumbleDur + wallExtraDur,
    settleDur: positiveNumber(CONFIG.settleDur, 0.4),
    spinMin: positiveNumber(CONFIG.spinMin, 2),
    chaosMag: Math.max(Number(CONFIG.chaosMag) || 0, 0),
    decayRate: positiveNumber(CONFIG.decayRate, 3.8),
    wallBounceEnabled,
    wallAreaScale: Number(CONFIG.wallAreaScale) || 0.9,
  };
}

function isCurrentRoll(roll) {
  return activeRoll === roll && activeDieState.mesh === roll.mesh;
}

function dispatchRollComplete(roll) {
  document.dispatchEvent(new CustomEvent('rollcomplete', {
    detail: { result: roll.result, wallBounces: roll.wallMotion?.bounceCount || 0 },
  }));
}

function finishRoll(roll) {
  if (!isCurrentRoll(roll)) return;

  roll.mesh.quaternion.copy(roll.settleTo);
  roll.mesh.position.copy(roll.finalPosition);

  const el = document.getElementById('result');
  if (roll.modifiers.length === 0) {
    rollState.current = 'done';
    el.textContent = `Rolled: ${roll.result}`;
    el.classList.add('show');
    dispatchRollComplete(roll);
    return;
  }

  rollState.current = 'modifiers';
  const faceLabel = (roll.settings.dieType === 'd10' && roll.result === 10) ? 0 : roll.result;
  const frontFace = roll.numToFace[faceLabel];

  runModifiers(roll.result, runningTotal => {
    if (isCurrentRoll(roll) && rollState.current === 'modifiers') {
      updateFaceNumber(frontFace, runningTotal);
    }
  }, {
    modifiers: roll.modifiers,
    shouldContinue: () => isCurrentRoll(roll) && rollState.current === 'modifiers',
  }).then(finalTotal => {
    if (finalTotal === null || !isCurrentRoll(roll) || rollState.current !== 'modifiers') return;
    el.textContent = `Rolled: ${finalTotal}`;
    el.classList.add('show');
    rollState.current = 'done';
    dispatchRollComplete(roll);
  });
}

// ── roll(n) ───────────────────────────────────────────────────────────────────
// Backwards-plans the starting quaternion so that integrating the decaying
// spin forward in time lands close to the target before the final settle.
export function roll(n) {
  const mesh = activeDieState.mesh;
  const labels = activeDieState.labels;
  const maxVal = labels.includes(0) ? 10 : labels.length; // D10: max is 10 (shown as 0)

  n = Math.round(n);
  if (!mesh || n < 1 || n > maxVal) return;

  cancelModifierAnimations();
  shakeEnd = 0;
  resetFaceNumbers();

  const settings = snapshotSettings();
  const faceLabel = (settings.dieType === 'd10' && n === 10) ? 0 : n;
  const settleTo = faceTowardCamera(activeDieState.numToFace[faceLabel]);
  const finalPosition = new THREE.Vector3(0, settings.wallBounceEnabled ? 0 : DIE_RESTING_Y, 0);

  const rollAxis = new THREE.Vector3(
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 0.3,
    (Math.random() - 0.5) * 2
  ).normalize();

  const chaosAxis = new THREE.Vector3(
    rollAxis.z + (Math.random() - 0.5) * 0.4,
    -(Math.random() * 0.5 + 0.2),
    -rollAxis.x + (Math.random() - 0.5) * 0.4
  ).normalize();

  // Keep approximately the same angular pace when wall motion adds roll time.
  const durationRatio = settings.tumbleDur / settings.baseTumbleDur;
  const numSpins = (settings.spinMin + Math.random() * 1.5) * durationRatio;
  const totalAngle = numSpins * Math.PI * 2;
  const primaryIntegral = (1 - Math.exp(-settings.decayRate)) / settings.decayRate;
  const rollAngVelMag = totalAngle / (primaryIntegral * settings.tumbleDur);
  const chaosMag = rollAngVelMag * settings.chaosMag * (0.8 + Math.random() * 0.4);

  const chaosDecay = settings.decayRate * 3;
  const chaosIntegral = (1 - Math.exp(-chaosDecay)) / chaosDecay;
  const totalChaosAngle = chaosMag * settings.tumbleDur * chaosIntegral;
  const qPrimaryInv = new THREE.Quaternion().setFromAxisAngle(rollAxis, -totalAngle);
  const qChaosInv = new THREE.Quaternion().setFromAxisAngle(chaosAxis, -totalChaosAngle);
  mesh.quaternion.copy(settleTo).multiply(qChaosInv).multiply(qPrimaryInv);

  let wallMotion = null;
  if (settings.wallBounceEnabled) {
    const arena = getWallArena(camera, mesh, settings.wallAreaScale);
    wallMotion = createWallMotion({ position: mesh.position, arena, duration: settings.tumbleDur });
    mesh.position.set(wallMotion.position.x, wallMotion.position.y, 0);
  } else {
    mesh.position.copy(finalPosition);
  }

  activeRoll = {
    id: ++rollGeneration,
    mesh,
    result: n,
    numToFace: { ...activeDieState.numToFace },
    modifiers: getModifiers().map(mod => ({ ...mod })),
    settings,
    finalPosition,
    wallMotion,
    settleFrom: new THREE.Quaternion(),
    settleTo,
    rollAxis,
    rollAngVelMag,
    chaosAxis,
    chaosMag,
    tumbleStart: performance.now() / 1000,
    settleStart: 0,
  };

  rollState.current = 'tumbling';
  rollState.wallBounces = 0;
  document.getElementById('result').classList.remove('show');
}

export function getEstimatedRollDurationMs() {
  const settings = activeRoll?.settings || snapshotSettings();
  const modifierCount = activeRoll?.modifiers.length ?? getModifiers().length;
  return Math.ceil((settings.tumbleDur + settings.settleDur) * 1000 + modifierCount * 1800 + 5000);
}

window.roll = roll; // expose for console / URL params

// ── Render loop ───────────────────────────────────────────────────────────────
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;

  if (rollState.current === 'idle') {
    idleT += dt * 0.35;
    const mesh = activeDieState.mesh;
    if (mesh) mesh.quaternion.setFromEuler(new THREE.Euler(
      Math.sin(idleT * 0.7) * 0.45,
      idleT,
      Math.sin(idleT * 0.5) * 0.25
    ));

  } else if (rollState.current === 'tumbling') {
    const roll = activeRoll;
    if (!roll || !isCurrentRoll(roll)) {
      rollState.current = 'idle';
    } else {
      const elapsed = now - roll.tumbleStart;
      const s = elapsed / roll.settings.tumbleDur;

      if (roll.wallMotion) {
        updateWallMotion(roll.wallMotion, elapsed, dt);
        roll.mesh.position.set(roll.wallMotion.position.x, roll.wallMotion.position.y, 0);
        rollState.wallBounces = roll.wallMotion.bounceCount;
      }

      if (s >= 1) {
        roll.mesh.position.copy(roll.finalPosition);
        roll.settleFrom.copy(roll.mesh.quaternion);
        roll.settleStart = now;
        rollState.current = 'settling';
      } else {
        const speed = Math.exp(-roll.settings.decayRate * s);
        const primaryDQ = new THREE.Quaternion()
          .setFromAxisAngle(roll.rollAxis, roll.rollAngVelMag * speed * dt);

        const chaosSpeed = Math.exp(-roll.settings.decayRate * 3 * s);
        const chaosDQ = new THREE.Quaternion()
          .setFromAxisAngle(roll.chaosAxis, roll.chaosMag * chaosSpeed * dt);

        roll.mesh.quaternion.multiply(primaryDQ).multiply(chaosDQ).normalize();
      }
    }

  } else if (rollState.current === 'settling') {
    const roll = activeRoll;
    if (!roll || !isCurrentRoll(roll)) {
      rollState.current = 'idle';
    } else {
      const t = Math.min((now - roll.settleStart) / roll.settings.settleDur, 1);
      roll.mesh.position.copy(roll.finalPosition);
      roll.mesh.quaternion.slerpQuaternions(roll.settleFrom, roll.settleTo, easeOutQuint(t));
      if (t >= 1) finishRoll(roll);
    }

  } else if (rollState.current === 'done' || rollState.current === 'modifiers') {
    const mesh = activeDieState.mesh;
    const rest = activeRoll && activeRoll.mesh === mesh
      ? activeRoll.finalPosition
      : new THREE.Vector3(0, DIE_RESTING_Y, 0);

    if (mesh) {
      if (now < shakeEnd) {
        const remaining = shakeEnd - now;
        const decay = remaining / 0.35;
        const offset = Math.sin(now * 60) * shakeMag * decay;
        mesh.position.set(rest.x + offset, rest.y + offset * 0.5, rest.z);
      } else {
        mesh.position.copy(rest);
      }
    }
  }

  renderer.render(scene, camera);
});

// ── Die shake on modifier impact ──────────────────────────────────────────────
document.addEventListener('modifierimpact', () => {
  shakeEnd = performance.now() / 1000 + 0.35;
  shakeMag = 0.12;
});

import * as THREE from 'three';

const MIN_HALF_EXTENT = 0.05;
const MAX_FRAME_STEP = 1 / 30;
const SIMULATION_STEP = 1 / 120;
const CAPTURE_START = 0.76;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function getWallArena(camera, mesh, areaScale) {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();

  const distance = Math.max(camera.position.z - mesh.position.z, 0.1);
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const radius = mesh.geometry.boundingSphere.radius * Math.max(
    Math.abs(mesh.scale.x),
    Math.abs(mesh.scale.y),
    Math.abs(mesh.scale.z)
  );
  const scale = clamp(Number(areaScale) || 0.9, 0.1, 1);
  const squareHalfExtent = Math.min(halfWidth, halfHeight) * scale;

  const maxX = Math.max(squareHalfExtent - radius, MIN_HALF_EXTENT);
  const maxY = Math.max(squareHalfExtent - radius, MIN_HALF_EXTENT);
  return { minX: -maxX, maxX, minY: -maxY, maxY };
}

function makeLaunchVelocity(arena, bounceDuration, random) {
  let angle = random() * Math.PI * 2;
  for (let i = 0; i < 8; i++) {
    const x = Math.abs(Math.cos(angle));
    const y = Math.abs(Math.sin(angle));
    if (x > 0.28 && y > 0.28) break;
    angle = random() * Math.PI * 2;
  }

  const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const impactRatePerSpeed =
    Math.abs(direction.x) / Math.max(arena.maxX * 2, MIN_HALF_EXTENT) +
    Math.abs(direction.y) / Math.max(arena.maxY * 2, MIN_HALF_EXTENT);
  const targetImpacts = 4 + random() * 2;
  const speed = clamp(
    targetImpacts / Math.max(bounceDuration * impactRatePerSpeed, 0.01),
    1.5,
    12
  );
  return direction.multiplyScalar(speed);
}

export function createWallMotion({ position, arena, duration, random = Math.random }) {
  const bounceDuration = Math.max(duration * CAPTURE_START, 0.1);
  const start = new THREE.Vector2(
    clamp(position.x, arena.minX, arena.maxX),
    clamp(position.y, arena.minY, arena.maxY)
  );

  return {
    arena,
    duration,
    captureStart: duration * CAPTURE_START,
    position: start,
    velocity: makeLaunchVelocity(arena, bounceDuration, random),
    captureFrom: new THREE.Vector2(),
    captureTangent: new THREE.Vector2(),
    capturing: false,
    bounceCount: 0,
  };
}

function reflectAxis(motion, axis, min, max) {
  let impacts = 0;
  while (motion.position[axis] < min || motion.position[axis] > max) {
    if (motion.position[axis] > max) {
      motion.position[axis] = max - (motion.position[axis] - max);
      motion.velocity[axis] = -Math.abs(motion.velocity[axis]) * 0.96;
    } else {
      motion.position[axis] = min + (min - motion.position[axis]);
      motion.velocity[axis] = Math.abs(motion.velocity[axis]) * 0.96;
    }
    impacts++;
  }
  return impacts;
}

function beginCapture(motion) {
  motion.capturing = true;
  motion.captureFrom.copy(motion.position);

  const captureDuration = Math.max(motion.duration - motion.captureStart, 0.01);
  motion.captureTangent.copy(motion.velocity).multiplyScalar(captureDuration);

  // Avoid a final outward lunge when center capture starts close to a wall.
  if (motion.captureFrom.x * motion.captureTangent.x > 0) motion.captureTangent.x *= 0.25;
  if (motion.captureFrom.y * motion.captureTangent.y > 0) motion.captureTangent.y *= 0.25;

  const maxTangent = Math.max(Math.min(motion.arena.maxX, motion.arena.maxY) * 1.25, 0.1);
  motion.captureTangent.clampLength(0, maxTangent);
}

function updateCapture(motion, elapsed) {
  if (!motion.capturing) beginCapture(motion);

  const captureDuration = Math.max(motion.duration - motion.captureStart, 0.01);
  const t = clamp((elapsed - motion.captureStart) / captureDuration, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;

  motion.position.copy(motion.captureFrom).multiplyScalar(h00)
    .addScaledVector(motion.captureTangent, h10);

  if (t >= 1) {
    motion.position.set(0, 0);
    motion.velocity.set(0, 0);
  }
}

export function updateWallMotion(motion, elapsed, dt) {
  if (elapsed >= motion.captureStart) {
    updateCapture(motion, elapsed);
    return 0;
  }

  let remaining = Math.min(Math.max(dt, 0), MAX_FRAME_STEP);
  let impacts = 0;
  while (remaining > 0) {
    const step = Math.min(remaining, SIMULATION_STEP);
    motion.position.addScaledVector(motion.velocity, step);
    impacts += reflectAxis(motion, 'x', motion.arena.minX, motion.arena.maxX);
    impacts += reflectAxis(motion, 'y', motion.arena.minY, motion.arena.maxY);
    remaining -= step;
  }

  motion.bounceCount += impacts;
  return impacts;
}

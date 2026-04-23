import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeTexture, drawFaceOnCanvas } from './texture.js';
import { scene } from './scene.js';

// Resting Y position of the die in world space — shifts it up so it sits
// visually centered between the modifier cards and the top of the screen.
export const DIE_RESTING_Y = 0.8;

// ── Icosahedron geometry (D20) ────────────────────────────────────────────────
const geo = new THREE.IcosahedronGeometry(2.0, 0).toNonIndexed();
geo.computeVertexNormals();

const posAttr = geo.attributes.position;
const FACES   = posAttr.count / 3; // always 20

// Distance from die centre to the centre of a face (local units, before scale).
// Used to project the front face centre—rather than the mesh centre—to screen
// so that modifier text flies precisely to the visible number.
export const FACE_INRADIUS = new THREE.Vector3()
  .fromBufferAttribute(posAttr, 0)
  .clone()
  .add(new THREE.Vector3().fromBufferAttribute(posAttr, 1))
  .add(new THREE.Vector3().fromBufferAttribute(posAttr, 2))
  .divideScalar(3)
  .length();

// Edge length of the icosahedron face (local units, before scale).
// Vertices 0 & 1 are adjacent on face 0 of the non-indexed geometry.
export const FACE_EDGE = new THREE.Vector3()
  .fromBufferAttribute(posAttr, 0)
  .distanceTo(new THREE.Vector3().fromBufferAttribute(posAttr, 1));

// ── UV assignment ─────────────────────────────────────────────────────────────
// Faces come in two types:
//   Δ (apex up)   – single vertex at top, two at bottom
//   ▽ (apex down) – two vertices at top, single vertex at bottom
//
// For each face we detect which type it is by comparing the y-gaps between
// sorted vertices, then assign UVs so the number texture is correctly oriented.
// faceUps stores the 3D "up" direction for each face so faceTowardCamera can
// lock the number perfectly upright when the die settles.

const wUp = new THREE.Vector3(0, 1, 0);
const uvFlat = new Float32Array(FACES * 3 * 2);

export const faceNormals = [];
export const faceUps     = [];
export const faceIsDown  = []; // true = ▽ face

for (let f = 0; f < FACES; f++) {
  const vA    = new THREE.Vector3().fromBufferAttribute(posAttr, f * 3);
  const vB    = new THREE.Vector3().fromBufferAttribute(posAttr, f * 3 + 1);
  const vC    = new THREE.Vector3().fromBufferAttribute(posAttr, f * 3 + 2);
  const verts = [vA, vB, vC];

  const centroid = vA.clone().add(vB).add(vC).divideScalar(3);
  const normal   = centroid.clone().normalize();
  faceNormals.push(normal.clone());

  let approxUp = wUp.clone().addScaledVector(normal, -wUp.dot(normal));
  if (approxUp.lengthSq() < 1e-6) {
    const fwd = new THREE.Vector3(0, 0, 1);
    approxUp  = fwd.clone().addScaledVector(normal, -fwd.dot(normal));
  }
  approxUp.normalize();
  const approxRight = new THREE.Vector3().crossVectors(approxUp, normal).normalize();

  const proj = verts.map(v => ({
    x: v.clone().sub(centroid).dot(approxRight),
    y: v.clone().sub(centroid).dot(approxUp),
  }));

  const byY     = [0, 1, 2].sort((a, b) => proj[b].y - proj[a].y);
  const yGapTop = proj[byY[0]].y - proj[byY[1]].y;
  const yGapBot = proj[byY[1]].y - proj[byY[2]].y;
  const isDown  = yGapBot > yGapTop; // ▽ when lone apex is at bottom
  faceIsDown.push(isDown);

  const uvAssign = new Array(3);
  let faceUpActual;

  if (!isDown) {
    // Δ face: apex at top
    const apexIdx  = byY[0];
    const baseIdxs = [byY[1], byY[2]];
    const rIdx = proj[baseIdxs[0]].x >= proj[baseIdxs[1]].x ? baseIdxs[0] : baseIdxs[1];
    const lIdx = baseIdxs.find(i => i !== rIdx);
    uvAssign[apexIdx] = [0.5,  0.97];
    uvAssign[rIdx]    = [0.97, 0.03];
    uvAssign[lIdx]    = [0.03, 0.03];
    faceUpActual = verts[apexIdx].clone().sub(centroid).normalize();
  } else {
    // ▽ face: apex at bottom
    const apexIdx   = byY[2];
    const upperIdxs = [byY[0], byY[1]];
    const rIdx = proj[upperIdxs[0]].x >= proj[upperIdxs[1]].x ? upperIdxs[0] : upperIdxs[1];
    const lIdx = upperIdxs.find(i => i !== rIdx);
    uvAssign[apexIdx] = [0.5,  0.03];
    uvAssign[rIdx]    = [0.97, 0.97];
    uvAssign[lIdx]    = [0.03, 0.97];
    // Use midpoint of top edge (not a vertex) to avoid tilting the number
    const topMid = verts[upperIdxs[0]].clone().add(verts[upperIdxs[1]]).multiplyScalar(0.5);
    faceUpActual = topMid.sub(centroid).normalize();
  }

  faceUps.push(faceUpActual);
  for (let v = 0; v < 3; v++) {
    uvFlat[(f * 3 + v) * 2]     = uvAssign[v][0];
    uvFlat[(f * 3 + v) * 2 + 1] = uvAssign[v][1];
  }
}

geo.setAttribute('uv', new THREE.BufferAttribute(uvFlat, 2));
for (let f = 0; f < FACES; f++) geo.addGroup(f * 3, 3, f);

// ── Mesh ──────────────────────────────────────────────────────────────────────
export const LABELS = Array.from({ length: 20 }, (_, i) => i + 1);

export const materials = LABELS.map((n, f) =>
  new THREE.MeshPhongMaterial({
    map:       makeTexture(n, faceIsDown[f]),
    shininess: CONFIG.shininess,
    specular:  new THREE.Color(CONFIG.borderColor).multiplyScalar(0.35),
    side:      THREE.FrontSide,
  })
);

export const dice = new THREE.Mesh(geo, materials);
dice.position.y = DIE_RESTING_Y;
scene.add(dice);

// number → face index lookup
export const numToFace = Object.fromEntries(LABELS.map((n, i) => [n, i]));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns a quaternion that rotates the die so the given face points at the camera
// with its number upright: faceNormal → +Z, faceUp → +Y.
export function faceTowardCamera(faceIdx) {
  const fNormal = faceNormals[faceIdx];
  const fUp     = faceUps[faceIdx];
  const fRight  = new THREE.Vector3().crossVectors(fUp, fNormal);
  const m = new THREE.Matrix4().set(
    fRight.x,  fRight.y,  fRight.z,  0,
    fUp.x,     fUp.y,     fUp.z,     0,
    fNormal.x, fNormal.y, fNormal.z, 0,
    0,         0,         0,         1
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// Regenerates all face textures and syncs material properties from CONFIG.
export function rebuildTextures() {
  LABELS.forEach((n, f) => {
    drawFaceOnCanvas(materials[f].map.image, n, faceIsDown[f]);
    materials[f].map.needsUpdate = true;
    materials[f].shininess = CONFIG.shininess;
    materials[f].specular  = new THREE.Color(CONFIG.borderColor).multiplyScalar(0.35);
    materials[f].needsUpdate = true;
  });
  document.body.style.background = CONFIG.bgColor;
  dice.scale.setScalar(CONFIG.dieScale);
}

// Updates the front-facing face's number in-place by redrawing on the existing
// canvas (avoids dispose/recreate). Three.js re-uploads on the next frame.
export function updateFaceNumber(faceIdx, newNumber) {
  drawFaceOnCanvas(materials[faceIdx].map.image, newNumber, faceIsDown[faceIdx]);
  materials[faceIdx].map.needsUpdate = true;
}

// Resets all 20 face textures to their original numbers (call before a new roll).
export function resetFaceNumbers() {
  LABELS.forEach((n, f) => {
    drawFaceOnCanvas(materials[f].map.image, n, faceIsDown[f]);
    materials[f].map.needsUpdate = true;
  });
}

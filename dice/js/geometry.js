import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeTexture, drawFaceOnCanvas } from './texture.js';
import { scene } from './scene.js';

// Resting Y position of the die in world space.
export const DIE_RESTING_Y = 0.8;

// ── Active die state ──────────────────────────────────────────────────────────
// Mutable object so all modules that import from here always see the current die.
export const activeDieState = {
  mesh:        null,
  labels:      [],
  faceNormals: [],
  faceUps:     [],
  faceHints:   [],  // per-face hint objects passed to texture drawing
  numToFace:   {},
};

// Convenience mutable re-exports (updated by syncExports after each buildDie)
export let dice        = null;
export let numToFace   = {};
export let faceNormals = [];
export let faceUps     = [];
export let LABELS      = [];
export let materials   = [];

// Legacy compat — FACE_INRADIUS / FACE_EDGE still referenced by modifiers/export
export let FACE_INRADIUS = 1;
export let FACE_EDGE     = 1;

function syncExports() {
  dice        = activeDieState.mesh;
  numToFace   = activeDieState.numToFace;
  faceNormals = activeDieState.faceNormals;
  faceUps     = activeDieState.faceUps;
  LABELS      = activeDieState.labels;
  materials   = activeDieState.mesh ? activeDieState.mesh.material : [];
}

// ── Face data for multi-triangle-per-face geometries (D6, D10, D12) ──────────
// Each logical face has multiple triangles sharing one material slot.
// We compute per-face normals/ups/hints and flat-project UVs across the whole face.
function computeFaceDataMultiTri(geo, trisPerFace) {
  const posAttr   = geo.attributes.position;
  const triCount  = posAttr.count / 3;
  const faceCount = triCount / trisPerFace;
  const wUp = new THREE.Vector3(0, 1, 0);
  const uvFlat = new Float32Array(posAttr.count * 2);

  const outNormals = [], outUps = [], outHints = [];

  for (let f = 0; f < faceCount; f++) {
    // Gather all verts for this logical face
    const allVerts = [];
    for (let t = 0; t < trisPerFace; t++) {
      const base = (f * trisPerFace + t) * 3;
      for (let v = 0; v < 3; v++) {
        allVerts.push(new THREE.Vector3().fromBufferAttribute(posAttr, base + v));
      }
    }

    // Deduplicate verts by position to find the true polygon ring
    const unique = [];
    for (const v of allVerts) {
      if (!unique.some(u => u.distanceToSquared(v) < 1e-8)) unique.push(v);
    }

    // Face centroid and normal
    const centroid = new THREE.Vector3();
    unique.forEach(v => centroid.add(v));
    centroid.divideScalar(unique.length);
    const normal = centroid.clone().normalize();
    outNormals.push(normal.clone());

    // Local frame
    let faceUp = wUp.clone().addScaledVector(normal, -wUp.dot(normal));
    if (faceUp.lengthSq() < 1e-6) faceUp.set(0, 0, 1).addScaledVector(normal, -normal.z);
    faceUp.normalize();
    const faceRight = new THREE.Vector3().crossVectors(faceUp, normal).normalize();
    outUps.push(faceUp.clone());

    // Project unique polygon verts to face-local 2D and sort them by angle for a clean polygon
    const uniqueProj = unique.map(v => {
      const d = v.clone().sub(centroid);
      return { x: d.dot(faceRight), y: d.dot(faceUp) };
    });
    // Sort by angle to get polygon ring
    uniqueProj.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));

    // Project all verts (including dups) to face-local 2D and compute UV bounds
    const proj2d = allVerts.map(v => {
      const d = v.clone().sub(centroid);
      return { x: d.dot(faceRight), y: d.dot(faceUp) };
    });
    const xs = proj2d.map(p => p.x), ys = proj2d.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
    // Use uniform scale so the face's true aspect ratio is preserved in UV space.
    // Without this, each axis is normalised independently → kite faces get squashed.
    const scale = Math.max(rangeX, rangeY);
    const offX  = (scale - rangeX) / 2 / scale; // centre horizontally
    const offY  = (scale - rangeY) / 2 / scale; // centre vertically

    const toUV = (p) => ([
      offX + (p.x - minX) / scale,
      offY + (p.y - minY) / scale,
    ]);

    const padding = 0; // UV fills edge-to-edge; drawPolyFace applies faceGap margin in canvas space

    // Normalize polygon verts to 0–1 UV space (for texture drawing)
    const shapeVerts = uniqueProj.map(toUV);

    outHints.push({ apexDown: false, faceIndex: f, shapeVerts });

    for (let t = 0; t < trisPerFace; t++) {
      for (let v = 0; v < 3; v++) {
        const vi  = f * trisPerFace * 3 + t * 3 + v;
        const uv  = toUV(proj2d[t * 3 + v]);
        uvFlat[vi * 2]     = uv[0];
        uvFlat[vi * 2 + 1] = uv[1];
      }
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvFlat, 2));
  for (let f = 0; f < faceCount; f++) {
    geo.addGroup(f * trisPerFace * 3, trisPerFace * 3, f);
  }

  const p0 = new THREE.Vector3().fromBufferAttribute(posAttr, 0);
  const p1 = new THREE.Vector3().fromBufferAttribute(posAttr, 1);
  const inradius = p0.clone().add(p1).multiplyScalar(0.5).length();
  const edge     = p0.distanceTo(p1);

  return { faceNormals: outNormals, faceUps: outUps, faceHints: outHints, inradius, edge };
}

// ── Generic face data computation for triangulated geometry ──────────────────
// Always 1 triangle per logical face — the pipeline that works perfectly for D4/D8/D20.
function computeFaceData(geo) {
  const posAttr  = geo.attributes.position;
  const faceCount = posAttr.count / 3;
  const wUp = new THREE.Vector3(0, 1, 0);
  const uvFlat = new Float32Array(faceCount * 3 * 2);

  const outNormals = [], outUps = [], outHints = [];

  for (let f = 0; f < faceCount; f++) {
    const vA = new THREE.Vector3().fromBufferAttribute(posAttr, f * 3);
    const vB = new THREE.Vector3().fromBufferAttribute(posAttr, f * 3 + 1);
    const vC = new THREE.Vector3().fromBufferAttribute(posAttr, f * 3 + 2);
    const verts = [vA, vB, vC];

    const centroid = vA.clone().add(vB).add(vC).divideScalar(3);
    const normal   = centroid.clone().normalize();
    outNormals.push(normal.clone());

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
    const isDown  = yGapBot > yGapTop;
    outHints.push({ apexDown: isDown, faceIndex: f });

    const uvAssign = new Array(3);
    let faceUpActual;

    if (!isDown) {
      const apexIdx  = byY[0];
      const baseIdxs = [byY[1], byY[2]];
      const rIdx = proj[baseIdxs[0]].x >= proj[baseIdxs[1]].x ? baseIdxs[0] : baseIdxs[1];
      const lIdx = baseIdxs.find(i => i !== rIdx);
      uvAssign[apexIdx] = [0.5, 0.97];
      uvAssign[rIdx]    = [0.97, 0.03];
      uvAssign[lIdx]    = [0.03, 0.03];
      faceUpActual = verts[apexIdx].clone().sub(centroid).normalize();
    } else {
      const apexIdx   = byY[2];
      const upperIdxs = [byY[0], byY[1]];
      const rIdx = proj[upperIdxs[0]].x >= proj[upperIdxs[1]].x ? upperIdxs[0] : upperIdxs[1];
      const lIdx = upperIdxs.find(i => i !== rIdx);
      uvAssign[apexIdx] = [0.5,  0.03];
      uvAssign[rIdx]    = [0.97, 0.97];
      uvAssign[lIdx]    = [0.03, 0.97];
      const topMid = verts[upperIdxs[0]].clone().add(verts[upperIdxs[1]]).multiplyScalar(0.5);
      faceUpActual = topMid.sub(centroid).normalize();
    }

    outUps.push(faceUpActual);
    for (let v = 0; v < 3; v++) {
      uvFlat[(f * 3 + v) * 2]     = uvAssign[v][0];
      uvFlat[(f * 3 + v) * 2 + 1] = uvAssign[v][1];
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvFlat, 2));
  for (let f = 0; f < faceCount; f++) geo.addGroup(f * 3, 3, f);

  // Compute inradius + edge for compat exports
  const p0 = new THREE.Vector3().fromBufferAttribute(posAttr, 0);
  const p1 = new THREE.Vector3().fromBufferAttribute(posAttr, 1);
  const p2 = new THREE.Vector3().fromBufferAttribute(posAttr, 2);
  const inradius = p0.clone().add(p1).add(p2).divideScalar(3).length();
  const edge     = p0.distanceTo(p1);

  return { faceNormals: outNormals, faceUps: outUps, faceHints: outHints, inradius, edge };
}

// ── Convert a multi-tri-per-face geometry into one-triangle-per-logical-face ─
// For D6/D10/D12: collapses each logical face into one representative triangle
// inscribed on the face plane, so the existing triangle UV pipeline works perfectly.
function collapseToTriangles(geo, trisPerFace) {
  const posAttr  = geo.attributes.position;
  const triCount = posAttr.count / 3;
  const faceCount = triCount / trisPerFace;

  const newPos = new Float32Array(faceCount * 3 * 3);

  for (let f = 0; f < faceCount; f++) {
    // Gather all verts of this logical face
    const allVerts = [];
    for (let t = 0; t < trisPerFace; t++) {
      const base = (f * trisPerFace + t) * 3;
      for (let v = 0; v < 3; v++) {
        allVerts.push(new THREE.Vector3().fromBufferAttribute(posAttr, base + v));
      }
    }

    // Face centroid and normal
    const centroid = new THREE.Vector3();
    allVerts.forEach(v => centroid.add(v));
    centroid.divideScalar(allVerts.length);
    const normal   = centroid.clone().normalize();

    // Build a local coordinate frame on the face plane
    const wUp = new THREE.Vector3(0, 1, 0);
    let faceUp = wUp.clone().addScaledVector(normal, -wUp.dot(normal));
    if (faceUp.lengthSq() < 1e-6) faceUp.set(0, 0, 1).addScaledVector(normal, -normal.z);
    faceUp.normalize();
    const faceRight = new THREE.Vector3().crossVectors(faceUp, normal).normalize();

    // Find the inradius of the face (distance from centroid to nearest edge midpoint)
    // Use the average distance from centroid to all verts as the face radius
    const avgDist = allVerts.reduce((sum, v) => sum + centroid.distanceTo(v), 0) / allVerts.length;
    // Inscribe an equilateral triangle with inradius = avgDist * 0.55
    const r = avgDist * 0.85;

    // Place an apex-up equilateral triangle on the face plane
    const angles = [-Math.PI / 2, -Math.PI / 2 + (2 * Math.PI / 3), -Math.PI / 2 + (4 * Math.PI / 3)];
    const triVerts = angles.map(a =>
      centroid.clone()
        .addScaledVector(faceRight, r * Math.cos(a))
        .addScaledVector(faceUp,    r * Math.sin(a))
    );

    for (let v = 0; v < 3; v++) {
      newPos[(f * 3 + v) * 3]     = triVerts[v].x;
      newPos[(f * 3 + v) * 3 + 1] = triVerts[v].y;
      newPos[(f * 3 + v) * 3 + 2] = triVerts[v].z;
    }
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  newGeo.computeVertexNormals();
  return newGeo;
}

// ── Geometry builders ─────────────────────────────────────────────────────────

function buildD10Geo() {
  const vertices = [];
  const indices  = [];

  const upperR = 1.78, upperY = 0.22;
  const lowerR = 1.78, lowerY = -0.22;

  const upper = [], lower = [];
  for (let i = 0; i < 5; i++) {
    const a  = (Math.PI * 2 * i / 5) - Math.PI / 2;
    const aL = a + Math.PI / 5;
    upper.push([upperR * Math.cos(a),  upperY, upperR * Math.sin(a)]);
    lower.push([lowerR * Math.cos(aL), lowerY, lowerR * Math.sin(aL)]);
  }

  const allVerts = [[0, 1.82, 0], ...upper, ...lower, [0, -1.82, 0]];
  allVerts.forEach(v => vertices.push(...v));

  for (let i = 0; i < 5; i++) {
    const u0 = 1 + i, u1 = 1 + (i + 1) % 5;
    const l0 = 6 + i, l1 = 6 + (i + 1) % 5;
    indices.push(0, u1, u0,   u0, u1, l0);  // upper kite as 2 tris (outward winding)
    indices.push(11, l0, l1,  l0, u1, l1);  // lower kite as 2 tris (outward winding)
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geo.setIndex(indices);
  const nonIdx = geo.toNonIndexed();

  // D10 kite faces are non-planar quads: their two triangles lie in slightly different planes,
  // so computeVertexNormals() gives them different normals → visible crease.
  // Fix: assign the same outward-pointing normal to all 6 verts of each kite face.
  const posAttr   = nonIdx.attributes.position;
  const tpf       = 2; // triangles per face
  const faceCount = posAttr.count / (tpf * 3);
  const normals   = new Float32Array(posAttr.count * 3);
  for (let f = 0; f < faceCount; f++) {
    const base = f * tpf * 3;
    const c = new THREE.Vector3();
    for (let v = 0; v < tpf * 3; v++) {
      c.x += posAttr.getX(base + v);
      c.y += posAttr.getY(base + v);
      c.z += posAttr.getZ(base + v);
    }
    c.divideScalar(tpf * 3).normalize();
    for (let v = 0; v < tpf * 3; v++) {
      normals[(base + v) * 3]     = c.x;
      normals[(base + v) * 3 + 1] = c.y;
      normals[(base + v) * 3 + 2] = c.z;
    }
  }
  nonIdx.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return nonIdx;
}

// Returns { geo, trisPerFace } — trisPerFace=1 for native triangle dice
function buildDieGeometry(dieType) {
  switch (dieType) {
    case 'd4':  return { geo: new THREE.TetrahedronGeometry(2.0, 0).toNonIndexed(), trisPerFace: 1 };
    case 'd6':  {
      const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
      g.computeVertexNormals();
      return { geo: g, trisPerFace: 2 };
    }
    case 'd8':  return { geo: new THREE.OctahedronGeometry(2.0, 0).toNonIndexed(), trisPerFace: 1 };
    case 'd10': {
      const g = buildD10Geo(); // normals already set flat-per-face inside
      return { geo: g, trisPerFace: 2, hasNormals: true };
    }
    case 'd12': {
      const g = new THREE.DodecahedronGeometry(2.0, 0).toNonIndexed();
      return { geo: g, trisPerFace: 3 };
    }
    default:    return { geo: new THREE.IcosahedronGeometry(2.0, 0).toNonIndexed(), trisPerFace: 1 };
  }
}

function labelsFor(dieType, faceCount) {
  switch (dieType) {
    case 'd4':  return [1, 2, 3, 4];
    case 'd6':  return [1, 2, 3, 4, 5, 6];
    case 'd8':  return [1, 2, 3, 4, 5, 6, 7, 8];
    case 'd10': return [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
    case 'd12': return Array.from({ length: 12 }, (_, i) => i + 1);
    default:    return Array.from({ length: faceCount }, (_, i) => i + 1);
  }
}

// ── buildDie — swap to a new die type at runtime ─────────────────────────────
export function buildDie(dieType) {
  if (activeDieState.mesh) {
    scene.remove(activeDieState.mesh);
    activeDieState.mesh.geometry.dispose();
    if (Array.isArray(activeDieState.mesh.material)) {
      activeDieState.mesh.material.forEach(m => { m.map?.dispose(); m.dispose(); });
    }
  }

  const { geo, trisPerFace, hasNormals } = buildDieGeometry(dieType);
  if (!hasNormals) geo.computeVertexNormals();

  let faceData;
  if (trisPerFace === 1) {
    faceData = computeFaceData(geo);
  } else {
    faceData = computeFaceDataMultiTri(geo, trisPerFace);
  }
  const { faceNormals: fN, faceUps: fU, faceHints: fH, inradius, edge } = faceData;
  FACE_INRADIUS = inradius;
  FACE_EDGE     = edge;

  const faceCount = geo.attributes.position.count / 3 / trisPerFace;
  const lbls = labelsFor(dieType, faceCount);

  const mats = lbls.map((n, f) =>
    new THREE.MeshPhongMaterial({
      map:       makeTexture(n, fH[f]),
      shininess: CONFIG.shininess,
      specular:  new THREE.Color(CONFIG.borderColor).multiplyScalar(0.35),
      side:      THREE.FrontSide,
    })
  );

  const mesh = new THREE.Mesh(geo, mats);
  mesh.position.y = DIE_RESTING_Y;
  mesh.scale.setScalar(CONFIG.dieScale);
  scene.add(mesh);

  activeDieState.mesh        = mesh;
  activeDieState.labels      = lbls;
  activeDieState.faceNormals = fN;
  activeDieState.faceUps     = fU;
  activeDieState.faceHints   = fH;
  activeDieState.numToFace   = Object.fromEntries(lbls.map((n, i) => [n, i]));

  syncExports();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function faceTowardCamera(faceIdx) {
  const fNormal = activeDieState.faceNormals[faceIdx];
  const fUp     = activeDieState.faceUps[faceIdx];
  const fRight  = new THREE.Vector3().crossVectors(fUp, fNormal);
  const m = new THREE.Matrix4().set(
    fRight.x,  fRight.y,  fRight.z,  0,
    fUp.x,     fUp.y,     fUp.z,     0,
    fNormal.x, fNormal.y, fNormal.z, 0,
    0,         0,         0,         1
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function rebuildTextures() {
  const { labels, faceHints, mesh } = activeDieState;
  labels.forEach((n, f) => {
    const mat = mesh.material[f];
    drawFaceOnCanvas(mat.map.image, n, faceHints[f]);
    mat.map.needsUpdate = true;
    mat.shininess = CONFIG.shininess;
    mat.specular  = new THREE.Color(CONFIG.borderColor).multiplyScalar(0.35);
    mat.needsUpdate = true;
  });
  document.body.style.background = CONFIG.bgColor;
  mesh.scale.setScalar(CONFIG.dieScale);
}

export function updateFaceNumber(faceIdx, newNumber) {
  const mat = activeDieState.mesh.material[faceIdx];
  drawFaceOnCanvas(mat.map.image, newNumber, activeDieState.faceHints[faceIdx]);
  mat.map.needsUpdate = true;
}

export function resetFaceNumbers() {
  const { labels, faceHints, mesh } = activeDieState;
  labels.forEach((n, f) => {
    const mat = mesh.material[f];
    drawFaceOnCanvas(mat.map.image, n, faceHints[f]);
    mat.map.needsUpdate = true;
  });
}

// ── Initial build ─────────────────────────────────────────────────────────────
buildDie(CONFIG.dieType || 'd20');

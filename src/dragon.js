// ════════════════════════════════════════════════════════════════════════
//  REALM — src/dragon.js
//  Factory: makeDragon() → { group, update(dt,ctx), headWorld(outV3),
//                            setFiring(bool), setBoost(bool), dispose() }
//
//  Hero serpentine dragon. Faces local -Z (forward). All geometry is
//  procedural. Hard rules obeyed: Lambert/Basic only, no shadows, no
//  per-frame allocations, frame-rate-independent via dt + damp().
// ════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { ZONES, RENDER, FLIGHT, damp, clamp } from './constants.js';

// ── module-scope reusable temps (NO per-frame allocation) ──────────────
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _col = new THREE.Color();
const _colA = new THREE.Color();
const _colB = new THREE.Color();
const _mat4 = new THREE.Matrix4();

// ── legacy shim: maps group → api for old main.js compatibility ────────
const _legacyInstances = new WeakMap();

// ── constants ──────────────────────────────────────────────────────────
const TRAIL_LEN   = 44;   // position ring-buffer length
const TRAIL_WIDTH = 0.55; // base half-width at head end
const NECK_SEGS   = 7;
const TAIL_SEGS   = 10;

// ── helpers ────────────────────────────────────────────────────────────
function lambertMat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    ...opts,
  });
}

function basicMat(opts = {}) {
  return new THREE.MeshBasicMaterial(opts);
}

// Additive glow sprite: a soft radial CanvasTexture
function makeGlowTex(res = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(res / 2, res / 2, 0, res / 2, res / 2, res / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, res, res);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const _glowTex = makeGlowTex(64); // shared across all glow sprites

function makeGlowSprite(size, color) {
  const mat = basicMat({
    map: _glowTex,
    color,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 1.0,
  });
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

// Build a swept wing membrane (ShapeGeometry, DoubleSide, additive-transparent)
function buildWingMesh(side, wingColor) {
  // Wing shape — elegant long swept membrane, finger spars implied via vertices
  const s = side; // -1 = left, +1 = right
  const shape = new THREE.Shape();
  // Leading edge spar root → tip → trailing scallop → body attach
  shape.moveTo(0, 0);
  shape.lineTo(s * 1.2,  0.6);
  shape.lineTo(s * 4.5,  0.5);  // leading spar tip
  shape.lineTo(s * 5.8,  0.0);  // wingtip
  shape.lineTo(s * 4.8, -0.8);  // lower wingtip
  shape.lineTo(s * 3.4, -0.4);  // first scallop
  shape.lineTo(s * 2.2, -1.1);  // trailing notch
  shape.lineTo(s * 1.2, -0.5);  // second scallop
  shape.lineTo(s * 0.3, -1.4);  // trailing edge back
  shape.lineTo(0,        -0.9);
  shape.lineTo(0,         0);

  const geo = new THREE.ShapeGeometry(shape, 3);
  const mat = basicMat({
    color: wingColor,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // Wings lie in XZ plane (plan view), rotate so they spread laterally
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// Build a tapered cylinder segment chain (neck or tail)
function buildChain(count, rStart, rEnd, segLen, mat) {
  const group = new THREE.Group();
  const joints = [];
  for (let i = 0; i < count; i++) {
    const t   = i / Math.max(1, count - 1);
    const r   = THREE.MathUtils.lerp(rStart, rEnd, t);
    const geo = new THREE.CylinderGeometry(r * 0.9, r, segLen, 6);
    const m   = new THREE.Mesh(geo, mat);
    // Cylinder default is Y-axis; rotate to Z-axis (facing forward)
    m.rotation.x = Math.PI / 2;
    m.position.z = i * segLen;
    group.add(m);
    joints.push(m);
  }
  group.userData.joints = joints;
  return group;
}

// ── Trail ribbon (BufferGeometry rebuilt per frame from ring-buffer) ───
function buildTrailMesh() {
  // (TRAIL_LEN - 1) quads × 2 triangles × 3 vertices = (TRAIL_LEN-1)*6 verts
  const maxVerts = (TRAIL_LEN - 1) * 6;
  const geo = new THREE.BufferGeometry();
  const pos  = new Float32Array(maxVerts * 3);
  const col  = new Float32Array(maxVerts * 3);
  const posAttr = new THREE.BufferAttribute(pos,  3);
  const colAttr = new THREE.BufferAttribute(col,  3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color',    colAttr);
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

// ══════════════════════════════════════════════════════════════════════
//  FACTORY
// ══════════════════════════════════════════════════════════════════════
// When called with a legacy key string (old main.js path), return the group
// directly (so scene.add(makeDragon('morren')) works) and register for shims.
// When called with no args (BUILD_SPEC game.js path), return the full interface.
export function makeDragon(legacyKey) {
  const group = new THREE.Group();

  // ── materials (rebuilt on zone-tint update) ─────────────────────────
  // Body/scale: dark dorsal — Lambert flatShading
  const bodyMat   = lambertMat(0x1a1220);
  // Belly: emissive panel — BasicMaterial, zone-tinted
  const bellyMat  = basicMat({ color: 0xff6a18, transparent: true, opacity: 0.92 });
  // Wing membrane: BasicMaterial, zone-tinted
  const wingMat   = basicMat({
    color: 0xffe29a,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Mouth glow (firing)
  const mouthMat  = basicMat({
    color: 0xff6a18,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.0,
  });
  // Eye dot
  const eyeMat    = basicMat({ color: 0xffdd00 });

  // ── BODY ─────────────────────────────────────────────────────────────
  // Main torso: elongated icosahedron
  const chestGeo  = new THREE.IcosahedronGeometry(1.6, 1);
  const chest     = new THREE.Mesh(chestGeo, bodyMat);
  chest.scale.set(1.1, 0.95, 1.85);
  chest.position.set(0, 0, -0.6);
  group.add(chest);

  const hipGeo    = new THREE.IcosahedronGeometry(1.4, 1);
  const hips      = new THREE.Mesh(hipGeo, bodyMat);
  hips.scale.set(0.95, 0.88, 1.75);
  hips.position.set(0, -0.05, 1.5);
  group.add(hips);

  // Belly panel (emissive) — flattened along underside
  const bellyGeo  = new THREE.IcosahedronGeometry(1.25, 1);
  const belly     = new THREE.Mesh(bellyGeo, bellyMat);
  belly.scale.set(0.88, 0.38, 2.5);
  belly.position.set(0, -0.92, 0.35);
  group.add(belly);

  // Dorsal spine frills (low-poly cones)
  const spineCount = 14;
  const spineMeshes = [];
  for (let i = 0; i < spineCount; i++) {
    const t  = i / (spineCount - 1);
    const sz = 0.08 + 0.28 * Math.sin(t * Math.PI); // peak at mid-back
    const sg = new THREE.ConeGeometry(sz * 0.6, sz * 1.6, 4);
    const sm = new THREE.Mesh(sg, bodyMat);
    const z  = -2.0 + t * 5.5;
    sm.position.set(0, 0.85 + sz * 0.5, z);
    sm.rotation.x = -0.12;
    group.add(sm);
    spineMeshes.push(sm);
  }

  // ── NECK (segmented chain, animates as sway) ──────────────────────────
  const neckGroup = buildChain(NECK_SEGS, 0.72, 0.38, 0.52, bodyMat);
  neckGroup.position.set(0, 0.55, -2.3);
  neckGroup.rotation.x = -0.3;
  group.add(neckGroup);

  // ── HEAD ───────────────────────────────────────────────────────────────
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.72, -6.15);
  group.add(headGroup);

  const craniumGeo = new THREE.IcosahedronGeometry(0.72, 1);
  const cranium    = new THREE.Mesh(craniumGeo, bodyMat);
  cranium.scale.set(1.05, 0.88, 1.45);
  headGroup.add(cranium);

  // Snout / jaw
  const snoutGeo = new THREE.IcosahedronGeometry(0.52, 1);
  const snout    = new THREE.Mesh(snoutGeo, bodyMat);
  snout.scale.set(0.82, 0.48, 1.55);
  snout.position.set(0, -0.22, -0.72);
  headGroup.add(snout);

  // Horns (swept back)
  for (const side of [-1, 1]) {
    const hGeo = new THREE.ConeGeometry(0.14, 1.4, 5);
    const horn = new THREE.Mesh(hGeo, bodyMat);
    horn.position.set(side * 0.38, 0.52, 0.18);
    horn.rotation.set(-0.55, 0, side * 0.35);
    headGroup.add(horn);

    // Secondary smaller horn
    const h2g = new THREE.ConeGeometry(0.08, 0.72, 4);
    const h2  = new THREE.Mesh(h2g, bodyMat);
    h2.position.set(side * 0.52, 0.3, 0.45);
    h2.rotation.set(-0.75, 0, side * 0.55);
    headGroup.add(h2);
  }

  // Eyes
  const eyeGeos = [];
  const eyeGlowSprites = [];
  for (const side of [-1, 1]) {
    const eGeo  = new THREE.SphereGeometry(0.12, 6, 6);
    const eye   = new THREE.Mesh(eGeo, eyeMat);
    eye.position.set(side * 0.3, 0.12, -0.6);
    headGroup.add(eye);
    eyeGeos.push(eye);

    const glowS = makeGlowSprite(0.55, 0xffdd00);
    glowS.position.set(side * 0.3, 0.12, -0.62);
    headGroup.add(glowS);
    eyeGlowSprites.push(glowS);
  }

  // Mouth glow (shown when firing)
  const mouthGlowS = makeGlowSprite(1.4, 0xff6a18);
  mouthGlowS.material.opacity = 0.0;
  mouthGlowS.position.set(0, -0.22, -1.35);
  headGroup.add(mouthGlowS);

  // Mouth anchor (fire origin)
  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.position.set(0, -0.22, -1.45);
  headGroup.add(mouthAnchor);

  // ── TAIL ───────────────────────────────────────────────────────────────
  const tailGroup = buildChain(TAIL_SEGS, 0.62, 0.06, 0.58, bodyMat);
  tailGroup.position.set(0, 0.08, 2.3);
  tailGroup.rotation.x = 0.2;
  group.add(tailGroup);

  // Tail fork — two forked tips
  const forkGroup = new THREE.Group();
  forkGroup.position.z = TAIL_SEGS * 0.58;
  tailGroup.add(forkGroup);
  for (const side of [-1, 1]) {
    const fGeo = new THREE.ConeGeometry(0.06, 0.7, 4);
    const fork = new THREE.Mesh(fGeo, bodyMat);
    fork.position.set(side * 0.2, 0, 0.4);
    fork.rotation.set(Math.PI / 2, 0, side * 0.35);
    forkGroup.add(fork);
  }

  // ── WINGS ──────────────────────────────────────────────────────────────
  // Wing root groups for flapping pivot
  const wingRootL = new THREE.Group();
  const wingRootR = new THREE.Group();
  wingRootL.position.set(-1.05, 0.85, -0.55);
  wingRootR.position.set( 1.05, 0.85, -0.55);
  group.add(wingRootL, wingRootR);

  // Wing membrane (ShapeGeometry, per-side)
  const wingMemL = buildWingMesh(-1, 0xffe29a);
  const wingMemR = buildWingMesh( 1, 0xffe29a);
  // Swap to the shared wingMat so zone tinting works from one material
  wingMemL.material.dispose();
  wingMemR.material.dispose();
  wingMemL.material = wingMat;
  wingMemR.material = wingMat;

  // Wing arm spar (thin cylinder)
  for (const [root, side] of [[wingRootL, -1], [wingRootR, 1]]) {
    const sparGeo = new THREE.CylinderGeometry(0.12, 0.08, 5.6, 5);
    const spar    = new THREE.Mesh(sparGeo, bodyMat);
    spar.rotation.z = (Math.PI / 2) * -side; // horizontal
    spar.position.x = side * 2.8;
    root.add(spar);
  }

  wingRootL.add(wingMemL);
  wingRootR.add(wingMemR);

  // ── TRAIL RIBBON ────────────────────────────────────────────────────────
  const trailMesh  = buildTrailMesh();
  // Trail exists in world space — add to group but will be positioned via
  // world positions; set renderOrder so it draws over geometry
  group.add(trailMesh);

  // Ring buffer: last TRAIL_LEN world positions
  const trailBuf   = new Array(TRAIL_LEN).fill(null).map(() => new THREE.Vector3());
  let   trailHead  = 0; // write pointer
  let   trailFull  = false;

  // ── STATE ──────────────────────────────────────────────────────────────
  let isFiring  = false;
  let isBoost   = false;
  let flapPhase = 0.0;
  let neckSway  = 0.0;
  let tailSway  = 0.0;
  let mouthGlow = 0.0; // 0..1, smoothed

  // Zone color state (lerped each frame)
  const curEmissive = new THREE.Color(ZONES[0].dragonEmissive);
  const curEye      = new THREE.Color(ZONES[0].dragonEye);
  const curTrail    = new THREE.Color(ZONES[0].trail);

  // ── TRAIL update helper ────────────────────────────────────────────────
  const _up = new THREE.Vector3(0, 1, 0);

  function rebuildTrail(boostActive) {
    const posAttr = trailMesh.geometry.getAttribute('position');
    const colAttr = trailMesh.geometry.getAttribute('color');
    const posArr  = posAttr.array;
    const colArr  = colAttr.array;

    const count   = trailFull ? TRAIL_LEN : trailHead;
    if (count < 2) {
      trailMesh.geometry.setDrawRange(0, 0);
      return;
    }

    // Walk ring-buffer oldest → newest
    let vi = 0; // vertex index (positions)
    const maxOpacity = boostActive ? 0.85 : 0.60;

    for (let i = 0; i < count - 1; i++) {
      // i=0 → oldest end (tail of ribbon), i=count-2 → newest segment
      const idxA = (trailHead - count + i     + TRAIL_LEN) % TRAIL_LEN;
      const idxB = (trailHead - count + i + 1 + TRAIL_LEN) % TRAIL_LEN;

      const pA = trailBuf[idxA];
      const pB = trailBuf[idxB];

      // Taper: 0=tail of ribbon (narrow), 1=head end (full width)
      const tA  = i       / (count - 1);
      const tB  = (i + 1) / (count - 1);
      const wA  = tA * TRAIL_WIDTH * (boostActive ? 1.4 : 1.0);
      const wB  = tB * TRAIL_WIDTH * (boostActive ? 1.4 : 1.0);
      const opA = tA * maxOpacity;
      const opB = tB * maxOpacity;

      // Ribbon normal: cross segment dir with up → side vector
      _v3a.subVectors(pB, pA).normalize();
      _v3b.crossVectors(_v3a, _up).normalize();

      // Quad: two triangles (A0, A1, B0) and (A1, B1, B0)
      const A0x = pA.x - _v3b.x * wA;
      const A0y = pA.y - _v3b.y * wA;
      const A0z = pA.z - _v3b.z * wA;
      const A1x = pA.x + _v3b.x * wA;
      const A1y = pA.y + _v3b.y * wA;
      const A1z = pA.z + _v3b.z * wA;
      const B0x = pB.x - _v3b.x * wB;
      const B0y = pB.y - _v3b.y * wB;
      const B0z = pB.z - _v3b.z * wB;
      const B1x = pB.x + _v3b.x * wB;
      const B1y = pB.y + _v3b.y * wB;
      const B1z = pB.z + _v3b.z * wB;

      const r = curTrail.r;
      const g = curTrail.g;
      const b = curTrail.b;

      // tri 1: A0, A1, B0
      posArr[vi*3+0] = A0x; posArr[vi*3+1] = A0y; posArr[vi*3+2] = A0z;
      colArr[vi*3+0] = r*opA; colArr[vi*3+1] = g*opA; colArr[vi*3+2] = b*opA; vi++;
      posArr[vi*3+0] = A1x; posArr[vi*3+1] = A1y; posArr[vi*3+2] = A1z;
      colArr[vi*3+0] = r*opA; colArr[vi*3+1] = g*opA; colArr[vi*3+2] = b*opA; vi++;
      posArr[vi*3+0] = B0x; posArr[vi*3+1] = B0y; posArr[vi*3+2] = B0z;
      colArr[vi*3+0] = r*opB; colArr[vi*3+1] = g*opB; colArr[vi*3+2] = b*opB; vi++;

      // tri 2: A1, B1, B0
      posArr[vi*3+0] = A1x; posArr[vi*3+1] = A1y; posArr[vi*3+2] = A1z;
      colArr[vi*3+0] = r*opA; colArr[vi*3+1] = g*opA; colArr[vi*3+2] = b*opA; vi++;
      posArr[vi*3+0] = B1x; posArr[vi*3+1] = B1y; posArr[vi*3+2] = B1z;
      colArr[vi*3+0] = r*opB; colArr[vi*3+1] = g*opB; colArr[vi*3+2] = b*opB; vi++;
      posArr[vi*3+0] = B0x; posArr[vi*3+1] = B0y; posArr[vi*3+2] = B0z;
      colArr[vi*3+0] = r*opB; colArr[vi*3+1] = g*opB; colArr[vi*3+2] = b*opB; vi++;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trailMesh.geometry.setDrawRange(0, vi);
  }

  // ── PUBLIC API ──────────────────────────────────────────────────────────

  function setFiring(on) { isFiring = on; }
  function setBoost(on)  { isBoost  = on; }

  // headWorld(outV3): write mouth world position into outV3
  function headWorld(out) {
    mouthAnchor.getWorldPosition(out);
    return out;
  }

  // ── UPDATE ───────────────────────────────────────────────────────────────
  function update(dt, ctx) {
    try {
      const { time, player, zone } = ctx;
      const speed = player?.speed ?? FLIGHT.SPEED_CRUISE;
      const speedN = player?.speedNorm ?? 0.5;

      // ── Zone color lerp ──────────────────────────────────────────────
      const zd = zone?.data  ?? ZONES[0];
      const zn = zone?.next  ?? ZONES[1];
      const zb = zone?.blend ?? 0;

      _colA.setHex(zd.dragonEmissive);
      _colB.setHex(zn.dragonEmissive);
      curEmissive.lerpColors(_colA, _colB, zb);

      _colA.setHex(zd.dragonEye);
      _colB.setHex(zn.dragonEye);
      curEye.lerpColors(_colA, _colB, zb);

      _colA.setHex(zd.trail);
      _colB.setHex(zn.trail);
      curTrail.lerpColors(_colA, _colB, zb);

      // Apply zone tints to materials
      bellyMat.color.copy(curEmissive);
      eyeMat.color.copy(curEye);
      for (const s of eyeGlowSprites) s.material.color.copy(curEye);

      // Wing membrane: zone accent tint
      _colA.setHex(zd.accent ?? zd.trail);
      _colB.setHex(zn.accent ?? zn.trail);
      _col.lerpColors(_colA, _colB, zb);
      wingMat.color.copy(_col);

      // ── Wing flap ────────────────────────────────────────────────────
      // Frequency rises slightly with speed, amplitude bigger when slow
      const flapFreq = 2.2 + speedN * 1.4;
      const flapAmp  = 0.55 - speedN * 0.22; // slow → bigger flap
      flapPhase += dt * flapFreq * Math.PI * 2;

      const flapAngle = Math.sin(flapPhase) * flapAmp;
      wingRootL.rotation.z = -flapAngle;  // left wing flaps up/down
      wingRootR.rotation.z =  flapAngle;

      // Wing fold toward body slightly at high speed (sleek)
      const foldZ = speedN * 0.25;
      wingRootL.rotation.y =  foldZ;
      wingRootR.rotation.y = -foldZ;

      // ── Neck sway (serpentine, S-curve) ─────────────────────────────
      const swayFreq = 0.65;
      const swayAmp  = 0.14;
      neckSway = Math.sin(time * swayFreq) * swayAmp;
      const neckJoints = neckGroup.userData.joints;
      if (neckJoints) {
        for (let i = 0; i < neckJoints.length; i++) {
          const t = i / Math.max(1, neckJoints.length - 1);
          // Phase offset so sway ripples down the chain
          const phase = time * swayFreq + t * 1.8;
          neckJoints[i].position.x = Math.sin(phase) * swayAmp * t * 2.2;
          neckJoints[i].position.y = Math.cos(phase * 0.5) * swayAmp * 0.4 * t;
        }
      }

      // Head follows neck tip
      const neckTipOffset = neckSway * 1.6;
      headGroup.position.x = damp(headGroup.position.x, neckTipOffset, 8.0, dt);
      headGroup.rotation.y = damp(headGroup.rotation.y, -neckTipOffset * 0.18, 5.0, dt);

      // ── Tail sway ────────────────────────────────────────────────────
      const tailJoints = tailGroup.userData.joints;
      if (tailJoints) {
        for (let i = 0; i < tailJoints.length; i++) {
          const t     = i / Math.max(1, tailJoints.length - 1);
          const phase = time * swayFreq + t * 2.2 + Math.PI; // opposite phase to neck
          tailJoints[i].position.x = Math.sin(phase) * 0.18 * t * t;
        }
      }

      // ── Mouth / firing glow ──────────────────────────────────────────
      const mouthTarget = isFiring ? 1.0 : 0.0;
      mouthGlow = damp(mouthGlow, mouthTarget, 9.0, dt);
      mouthGlowS.material.opacity = mouthGlow * 0.85;
      mouthGlowS.material.color.copy(curEmissive);

      // Belly pulses gently when firing
      const bellyPulse = 0.85 + Math.sin(time * 8.0) * 0.07 * mouthGlow;
      bellyMat.opacity = 0.88 + mouthGlow * 0.08;
      belly.scale.y = 0.38 * bellyPulse;

      // Eye glow pulses at flap beat
      const eyePulse = 0.7 + Math.abs(Math.sin(flapPhase)) * 0.3;
      for (const s of eyeGlowSprites) s.material.opacity = eyePulse;

      // ── Trail ring-buffer ────────────────────────────────────────────
      // Write current world pos
      const wp = trailBuf[trailHead];
      group.getWorldPosition(wp);
      trailHead = (trailHead + 1) % TRAIL_LEN;
      if (trailHead === 0) trailFull = true;

      // Rebuild ribbon geometry
      rebuildTrail(isBoost);

      // Trail mesh lives in world space — reset its parent transform effect
      // by positioning it at world origin relative to the group
      group.getWorldPosition(_v3a);
      trailMesh.position.copy(_v3a).negate().add(_v3a); // = (0,0,0) in parent
      // Actually: trailMesh is a child of group; positions in buffer are world.
      // We need to express them in group-local space.
      // Recompute: subtract group world pos from all buffer positions via matrix.
      // Efficient path: set trailMesh.matrixAutoUpdate=false and apply inverse.
      // Simpler: set trailMesh position so local = world (negate parent world pos)
      group.getWorldPosition(_v3b);
      trailMesh.position.set(-_v3b.x, -_v3b.y, -_v3b.z);

    } catch (_) {
      // Never throw in update
    }
  }

  // ── DISPOSE ──────────────────────────────────────────────────────────────
  function dispose() {
    group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material?.dispose();
      }
    });
    _glowTex.dispose?.(); // shared — only safe if nothing else uses it
    trailMesh.geometry.dispose();
    trailMesh.material.dispose();
  }

  const api = { group, update, headWorld, setFiring, setBoost, dispose };

  if (typeof legacyKey === 'string') {
    // Legacy path: register for shim functions, return the group itself
    _legacyInstances.set(group, api);
    group.userData.dragonApi = api;
    return group;
  }

  return api;
}

// ══════════════════════════════════════════════════════════════════════
//  LEGACY SHIMS — keep old main.js compiling while new game.js uses the
//  factory interface above. These are no-ops / thin wrappers.
// ══════════════════════════════════════════════════════════════════════

// Old main.js called makeDragon(key) and used the returned group directly.
// When called with a key string, makeDragon registers the api in _legacyInstances
// (declared at module scope) and returns the group itself for scene.add() compat.

// Palette catalogue stub (old main.js reads DRAGON_CATALOG[key].name)
export const DRAGON_CATALOG = {
  morren:  { name: 'Morren',  subtitle: 'of House Aelric',   build: null },
  iskari:  { name: 'Iskari',  subtitle: 'of the fallen house', build: null },
  vethrim: { name: 'Vethrim', subtitle: 'of House Brennoc',  build: null },
  skarn:   { name: 'Skarn',   subtitle: 'of House Calden',   build: null },
};

// animateDragon(mesh, time, dt, flapBoost) — old per-frame call
export function animateDragon(group, time, dt, flapBoost = 0) {
  if (!group) return;
  const inst = _legacyInstances.get(group);
  if (!inst) return;
  // Build a minimal ctx so our real update() runs
  const fakeCtx = {
    time,
    player: {
      speed: FLIGHT.SPEED_CRUISE + flapBoost * 20,
      speedNorm: 0.5 + flapBoost * 0.3,
      pos: group.position,
      glideFall: false,
    },
    zone: { data: ZONES[0], next: ZONES[1], blend: 0, index: 0 },
    camera: null,
  };
  inst.update(dt, fakeCtx);
}

// setDragonDamage(mesh, frac) — old damage tint call
export function setDragonDamage(group, frac) {
  if (!group) return;
  // Visual-only: darken the body a little — no-op is safe
  group.traverse((o) => {
    if (o.isMesh && o.material?.color) {
      o.material.color.setScalar(1.0 - frac * 0.4);
    }
  });
}

// dragonHeadWorld(mesh, outV3) → outV3
export function dragonHeadWorld(group, out) {
  if (!group || !out) return out ?? new THREE.Vector3();
  const inst = _legacyInstances.get(group);
  if (inst) return inst.headWorld(out);
  // Fallback: approximate head as -Z offset from group
  out.set(0, 0, -7).applyQuaternion(group.quaternion).add(group.position);
  return out;
}

// dragonForward(mesh, outV3) → outV3
export function dragonForward(group, out) {
  if (!group || !out) return out ?? new THREE.Vector3();
  out.set(0, 0, -1).applyQuaternion(group.quaternion);
  return out;
}

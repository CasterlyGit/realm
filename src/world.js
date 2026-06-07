// ════════════════════════════════════════════════════════════════════════
//  REALM — src/world.js
//  Floating-island scenery: InstancedMesh islands, waterfalls-of-light,
//  distant sky-creatures (billboards), ambient pollen Points.
//  Decorative only — NO collision. Zone-tinted terrain palettes.
//
//  Legacy shim exports at bottom keep old main.js / populate.js compiling.
// ════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import {
  RENDER, ZONES,
  damp, clamp,
} from './constants.js';

// ── module-scope temp objects (zero per-frame alloc) ──────────────────
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _col = new THREE.Color();
const _col2 = new THREE.Color();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scaleV = new THREE.Vector3();

// ── constants ─────────────────────────────────────────────────────────
const ISLAND_COUNT = 100;         // InstancedMesh instances
const CORRIDOR_RADIUS = 42;       // keep clear tube along player path
const ISLAND_BAND_NEAR = 30;      // min distance island can spawn from player
const ISLAND_BAND_FAR = RENDER.FAR * 0.82;
const RECYCLE_DIST = RENDER.FAR * 0.85;

const POLLEN_COUNT = 300;         // hard ceiling for Points cloud
const WATERFALL_COUNT = 8;        // vertical additive planes
const CREATURE_COUNT = 7;         // billboard sky-creatures

// ── helpers ────────────────────────────────────────────────────────────
function seededRand(seed) {
  // deterministic, fast — avoids Math.random() calls storing arrays
  let s = seed | 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) | 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) | 0;
  s = s ^ (s >>> 16);
  return ((s >>> 0) / 0xffffffff);
}

function lerpColor(a, b, t, out) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
}

// ── procedural textures ───────────────────────────────────────────────

/** Soft radial gradient, centre → transparent edge (waterfall column). */
function makeWaterfallTexture() {
  const W = 64, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(200,240,255,0.6)');
  grad.addColorStop(1, 'rgba(180,220,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Procedural bird/manta silhouette (simple wing-spread shape). */
function makeCreatureTexture(seed) {
  const N = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, N, N);
  ctx.fillStyle = 'rgba(180,200,255,0.85)';

  const useManta = seededRand(seed) > 0.5;
  ctx.beginPath();
  if (useManta) {
    // manta / stingray silhouette — swept diamond wings
    ctx.moveTo(N * 0.5, N * 0.35);
    ctx.bezierCurveTo(N * 0.05, N * 0.45, N * 0.0, N * 0.6, N * 0.12, N * 0.65);
    ctx.bezierCurveTo(N * 0.3, N * 0.68, N * 0.44, N * 0.56, N * 0.5, N * 0.52);
    ctx.bezierCurveTo(N * 0.56, N * 0.56, N * 0.7, N * 0.68, N * 0.88, N * 0.65);
    ctx.bezierCurveTo(N * 1.0, N * 0.6, N * 0.95, N * 0.45, N * 0.5, N * 0.35);
    // tail
    ctx.moveTo(N * 0.5, N * 0.52);
    ctx.lineTo(N * 0.52, N * 0.78);
  } else {
    // bird silhouette — swept-back wings
    ctx.moveTo(N * 0.5, N * 0.42);
    ctx.bezierCurveTo(N * 0.38, N * 0.38, N * 0.1, N * 0.32, N * 0.02, N * 0.48);
    ctx.bezierCurveTo(N * 0.18, N * 0.52, N * 0.38, N * 0.52, N * 0.5, N * 0.5);
    ctx.bezierCurveTo(N * 0.62, N * 0.52, N * 0.82, N * 0.52, N * 0.98, N * 0.48);
    ctx.bezierCurveTo(N * 0.9, N * 0.32, N * 0.62, N * 0.38, N * 0.5, N * 0.42);
    // head
    ctx.ellipse(N * 0.5, N * 0.39, N * 0.04, N * 0.05, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/** Soft circular pollen sprite. */
function makePollenSprite() {
  const N = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grad.addColorStop(0, 'rgba(255,255,200,1.0)');
  grad.addColorStop(0.4, 'rgba(255,240,180,0.6)');
  grad.addColorStop(1, 'rgba(255,220,100,0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// ── island geometry ───────────────────────────────────────────────────
function makeIslandGeo() {
  // Icosahedron base, scale non-uniformly for chunky slab feel
  const base = new THREE.IcosahedronGeometry(1, 1);
  // flatten along Y so it reads as a floating slab
  const pos = base.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setY(i, y * 0.38 + (y < 0 ? -0.15 : 0));
  }
  base.computeVertexNormals();
  return base;
}

// ── per-island state array ─────────────────────────────────────────────
function makeIslandState(i) {
  const r = seededRand(i * 137 + 7);
  const r2 = seededRand(i * 137 + 13);
  const r3 = seededRand(i * 137 + 19);
  return {
    // lateral offsets (baked at recycle)
    lateralX: (r - 0.5) * 2,   // -1..1 direction (sign + scale applied at recycle)
    lateralY: r2,               // 0..1
    lateralZ: r3,               // 0..1
    scale: 0,
    colorSeed: r,
    waterfallIdx: -1,           // which waterfall this island owns (-1 = none)
    needsMatrix: true,
  };
}

// ── main factory ──────────────────────────────────────────────────────
export function makeWorld(scene) {

  // ── zone color caches ──
  const terrainColA = [new THREE.Color(), new THREE.Color(),
                       new THREE.Color(), new THREE.Color()];
  const terrainColB = [new THREE.Color(), new THREE.Color(),
                       new THREE.Color(), new THREE.Color()];

  function updateZoneColors(zoneData, zoneNext) {
    for (let i = 0; i < 4; i++) {
      terrainColA[i].setHex(zoneData.terrain[i]);
      terrainColB[i].setHex(zoneNext.terrain[i]);
    }
  }

  // ── islands ──
  const islandGeo = makeIslandGeo();
  const islandMat = new THREE.MeshLambertMaterial({
    flatShading: true,
    vertexColors: false,
    color: 0xc8956c,
  });
  const islandMesh = new THREE.InstancedMesh(islandGeo, islandMat, ISLAND_COUNT);
  islandMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  islandMesh.frustumCulled = false; // we manage visibility manually
  scene.add(islandMesh);

  // per-island color for InstancedMesh
  const instanceColors = new Float32Array(ISLAND_COUNT * 3);
  islandMesh.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3);

  const islandStates = Array.from({ length: ISLAND_COUNT }, (_, i) => makeIslandState(i));

  // place islands in a wide band around origin initially
  function placeIsland(idx, playerPos, forwardHint) {
    const s = islandStates[idx];
    const seed = idx * 137 + (Math.floor(playerPos.z * 0.01) | 0);
    const r1 = seededRand(seed);
    const r2 = seededRand(seed + 1);
    const r3 = seededRand(seed + 2);
    const r4 = seededRand(seed + 3);
    const r5 = seededRand(seed + 4);

    // distance ahead of player
    const dist = ISLAND_BAND_NEAR + r1 * (RECYCLE_DIST * 0.7);

    // spread laterally, staying outside corridor tube
    const angle = r2 * Math.PI * 2;
    // lateral offset — at least CORRIDOR_RADIUS out
    const lateral = CORRIDOR_RADIUS + 18 + r3 * 120;
    const lx = Math.cos(angle) * lateral;
    const ly = -20 - r4 * 80;     // mostly below the flight path
    const lz = Math.sin(angle) * lateral * 0.4; // shallower Z spread

    const fwd = forwardHint || _v3b.set(0, 0, -1);
    _v3a.copy(fwd).multiplyScalar(dist).add(playerPos);
    _v3a.x += lx;
    _v3a.y += ly;
    _v3a.z += lz;

    const sc = 8 + r5 * 28;
    s.scale = sc;

    _scaleV.set(sc, sc * (0.35 + r4 * 0.2), sc);
    _euler.set(0, r2 * Math.PI * 2, r3 * 0.15);
    _quat.setFromEuler(_euler);
    _mat4.compose(_v3a, _quat, _scaleV);
    islandMesh.setMatrixAt(idx, _mat4);

    // pick terrain color from zone blend
    const ti = Math.floor(r5 * 4) & 3;
    s.colorSeed = r1;
    lerpColor(terrainColA[ti], terrainColB[ti], 0, _col);
    instanceColors[idx * 3 + 0] = _col.r;
    instanceColors[idx * 3 + 1] = _col.g;
    instanceColors[idx * 3 + 2] = _col.b;

    s.needsMatrix = false;
    s.worldPos = _v3a.clone(); // cached for waterfall placement
  }

  // ── waterfalls-of-light ──
  const waterfallTex = makeWaterfallTexture();
  const waterfallMat = new THREE.MeshBasicMaterial({
    map: waterfallTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    color: 0xaaddff,
  });
  // each waterfall: a simple plane hanging below an island
  const waterfalls = [];
  for (let i = 0; i < WATERFALL_COUNT; i++) {
    const h = 30 + seededRand(i * 31) * 50;
    const geo = new THREE.PlaneGeometry(4 + seededRand(i * 17) * 6, h);
    const mesh = new THREE.Mesh(geo, waterfallMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    waterfalls.push({ mesh, uvOffset: 0, speed: 0.6 + seededRand(i * 41) * 0.8 });
  }
  // assign waterfalls to every ~12th island
  for (let i = 0; i < ISLAND_COUNT; i++) {
    if (i % 13 === 0) {
      const wIdx = Math.floor(i / 13) % WATERFALL_COUNT;
      islandStates[i].waterfallIdx = wIdx;
    }
  }

  // ── distant sky-creatures ──
  const creatures = [];
  for (let i = 0; i < CREATURE_COUNT; i++) {
    const tex = makeCreatureTexture(i * 53);
    const geo = new THREE.PlaneGeometry(22 + seededRand(i * 17) * 18, 12 + seededRand(i * 37) * 8);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      color: 0x99bbff,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    const arcRadius = 180 + seededRand(i * 71) * 220;
    const arcSpeed = (0.04 + seededRand(i * 83) * 0.07) * (seededRand(i * 97) > 0.5 ? 1 : -1);
    const arcPhase = seededRand(i * 113) * Math.PI * 2;
    const arcY = 10 + seededRand(i * 59) * 60;
    const arcTilt = (seededRand(i * 47) - 0.5) * 0.4;
    creatures.push({ mesh, arcRadius, arcSpeed, arcPhase, arcY, arcTilt, phase: arcPhase });
  }

  // ── pollen / ambient debris ──
  const pollenPositions = new Float32Array(POLLEN_COUNT * 3);
  const pollenVelocities = new Float32Array(POLLEN_COUNT * 3);
  const pollenPhases = new Float32Array(POLLEN_COUNT);
  // initialize with placeholder positions (updated on first frame)
  for (let i = 0; i < POLLEN_COUNT; i++) {
    pollenPositions[i * 3 + 0] = (seededRand(i * 7) - 0.5) * 120;
    pollenPositions[i * 3 + 1] = (seededRand(i * 11) - 0.5) * 60;
    pollenPositions[i * 3 + 2] = (seededRand(i * 13) - 0.5) * 120;
    pollenVelocities[i * 3 + 0] = (seededRand(i * 17) - 0.5) * 2;
    pollenVelocities[i * 3 + 1] = (seededRand(i * 19) - 0.5) * 0.5;
    pollenVelocities[i * 3 + 2] = (seededRand(i * 23) - 0.5) * 2;
    pollenPhases[i] = seededRand(i * 29) * Math.PI * 2;
  }
  const pollenGeo = new THREE.BufferGeometry();
  const pollenPosAttr = new THREE.BufferAttribute(pollenPositions, 3);
  pollenPosAttr.setUsage(THREE.DynamicDrawUsage);
  pollenGeo.setAttribute('position', pollenPosAttr);
  const pollenSpriteTex = makePollenSprite();
  const pollenMat = new THREE.PointsMaterial({
    map: pollenSpriteTex,
    size: 1.2,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xffe29a,
    opacity: 0.7,
  });
  const pollenPoints = new THREE.Points(pollenGeo, pollenMat);
  pollenPoints.frustumCulled = false;
  scene.add(pollenPoints);

  // ── zone color blending state ──
  let _curZoneIdx = -1;
  let _initialized = false;

  // temp color objects for zone lerp
  const _terrainBlend = new THREE.Color();
  const _accentA = new THREE.Color();
  const _accentB = new THREE.Color();

  // ─────────────────────────────────────────────────────────────────────
  function update(dt, ctx) {
    try {
      const { time, player, zone } = ctx;
      const { pos: playerPos, forward } = player;
      const zoneData = zone.data;
      const zoneNext = zone.next;
      const blend = zone.blend;

      // ── zone palette init / update ──
      if (_curZoneIdx !== zone.index) {
        _curZoneIdx = zone.index;
        updateZoneColors(zoneData, zoneNext);
        _initialized = false;
      }

      // accent color for pollen / waterfalls
      _accentA.setHex(zoneData.accent);
      _accentB.setHex(zoneNext.accent);
      lerpColor(_accentA, _accentB, blend, _terrainBlend);
      pollenMat.color.copy(_terrainBlend);

      // ── islands: recycle + color update ──
      let islandDirty = false;
      let colorDirty = false;

      for (let i = 0; i < ISLAND_COUNT; i++) {
        const s = islandStates[i];

        if (!_initialized || s.needsMatrix) {
          placeIsland(i, playerPos, forward);
          islandDirty = true;
          colorDirty = true;
        } else {
          // read cached world pos
          islandMesh.getMatrixAt(i, _mat4);
          _v3a.setFromMatrixPosition(_mat4);

          const dx = _v3a.x - playerPos.x;
          const dy = _v3a.y - playerPos.y;
          const dz = _v3a.z - playerPos.z;
          const dist2 = dx * dx + dy * dy + dz * dz;

          if (dist2 > RECYCLE_DIST * RECYCLE_DIST) {
            placeIsland(i, playerPos, forward);
            islandDirty = true;
            colorDirty = true;
          } else {
            // re-tint to blend zone every ~2s (cheap: only if blend changed noticeably)
            const ti = Math.floor(s.colorSeed * 4) & 3;
            lerpColor(terrainColA[ti], terrainColB[ti], blend, _col);
            instanceColors[i * 3 + 0] = _col.r;
            instanceColors[i * 3 + 1] = _col.g;
            instanceColors[i * 3 + 2] = _col.b;
            colorDirty = true;
          }
        }
      }

      if (!_initialized) _initialized = true;

      if (islandDirty) islandMesh.instanceMatrix.needsUpdate = true;
      if (colorDirty) {
        islandMesh.instanceColor.needsUpdate = true;
        islandMesh.material.vertexColors = true;
      }

      // ── waterfalls: track island positions, UV scroll ──
      for (let wi = 0; wi < WATERFALL_COUNT; wi++) {
        const wf = waterfalls[wi];
        // find the island that owns this waterfall
        let found = false;
        for (let i = 0; i < ISLAND_COUNT; i++) {
          if (islandStates[i].waterfallIdx !== wi) continue;
          islandMesh.getMatrixAt(i, _mat4);
          _v3a.setFromMatrixPosition(_mat4);

          // check visibility distance
          _v3b.copy(_v3a).sub(playerPos);
          if (_v3b.lengthSq() > (RECYCLE_DIST * 0.6) * (RECYCLE_DIST * 0.6)) {
            wf.mesh.visible = false;
            found = true;
            break;
          }

          // hang waterfall below island
          const scale = islandStates[i].scale || 10;
          _v3a.y -= scale * 0.18 + 8;
          wf.mesh.position.copy(_v3a);

          // billboard toward camera (just X rotation isn't needed — it's vertical)
          wf.mesh.lookAt(ctx.camera.position.x, wf.mesh.position.y, ctx.camera.position.z);

          wf.mesh.visible = true;
          // UV scroll downward
          wf.uvOffset = (wf.uvOffset + dt * wf.speed) % 1.0;
          wf.mesh.material.map.offset.set(0, -wf.uvOffset);
          wf.mesh.material.map.needsUpdate = false; // CanvasTexture doesn't auto-update

          // tint waterfall to zone accent
          wf.mesh.material.color.copy(_terrainBlend).lerp(new THREE.Color(0xffffff), 0.5);

          found = true;
          break;
        }
        if (!found) wf.mesh.visible = false;
      }

      // ── sky-creatures: arc orbits, billboard toward camera ──
      for (let ci = 0; ci < CREATURE_COUNT; ci++) {
        const c = creatures[ci];
        c.phase += c.arcSpeed * dt;

        const cx = playerPos.x + Math.cos(c.phase) * c.arcRadius;
        const cz = playerPos.z + Math.sin(c.phase) * c.arcRadius;
        const cy = playerPos.y + c.arcY + Math.sin(c.phase * 0.37 + c.arcTilt) * 15;

        c.mesh.position.set(cx, cy, cz);
        c.mesh.lookAt(ctx.camera.position);

        // gentle bob opacity
        const obase = 0.3 + zone.index * 0.12;
        c.mesh.material.opacity = obase + Math.sin(time * 0.8 + ci) * 0.08;

        // tint creatures by zone (cool blues / teals)
        _accentA.setHex(zoneData.glow);
        c.mesh.material.color.copy(_accentA).lerp(new THREE.Color(0xaabbff), 0.5);
      }

      // ── pollen: drift near player, wrap when far ──
      const POLLEN_SPREAD = 80;
      const POLLEN_HALF = POLLEN_SPREAD * 0.5;

      for (let i = 0; i < POLLEN_COUNT; i++) {
        const pi = i * 3;

        // drift
        pollenPositions[pi + 0] += pollenVelocities[pi + 0] * dt;
        pollenPositions[pi + 1] += pollenVelocities[pi + 1] * dt
          + Math.sin(time * 0.7 + pollenPhases[i]) * 0.4 * dt;
        pollenPositions[pi + 2] += pollenVelocities[pi + 2] * dt;

        // wrap around player box
        let wx = playerPos.x + pollenPositions[pi + 0];
        let wy = playerPos.y + pollenPositions[pi + 1];
        let wz = playerPos.z + pollenPositions[pi + 2];

        let localX = pollenPositions[pi + 0];
        let localY = pollenPositions[pi + 1];
        let localZ = pollenPositions[pi + 2];

        if (localX > POLLEN_HALF) localX -= POLLEN_SPREAD;
        else if (localX < -POLLEN_HALF) localX += POLLEN_SPREAD;
        if (localY > POLLEN_HALF * 0.6) localY -= POLLEN_SPREAD * 0.6;
        else if (localY < -POLLEN_HALF * 0.6) localY += POLLEN_SPREAD * 0.6;
        if (localZ > POLLEN_HALF) localZ -= POLLEN_SPREAD;
        else if (localZ < -POLLEN_HALF) localZ += POLLEN_SPREAD;

        pollenPositions[pi + 0] = localX;
        pollenPositions[pi + 1] = localY;
        pollenPositions[pi + 2] = localZ;
      }

      // position the Points group at the player
      pollenPoints.position.copy(playerPos);
      pollenPosAttr.needsUpdate = true;

    } catch (_) {
      // never throw in update
    }
  }

  // ── initial placement ──
  // called lazily on first update; no-op here
  // (updateZoneColors will be called once zone.index is known)

  function dispose() {
    islandGeo.dispose();
    islandMat.dispose();
    islandMesh.dispose();
    scene.remove(islandMesh);

    waterfallTex.dispose();
    for (const wf of waterfalls) {
      wf.mesh.geometry.dispose();
      wf.mesh.material.map?.dispose();
      wf.mesh.material.dispose();
      scene.remove(wf.mesh);
    }

    for (const c of creatures) {
      c.mesh.geometry.dispose();
      c.mesh.material.map?.dispose();
      c.mesh.material.dispose();
      scene.remove(c.mesh);
    }

    pollenGeo.dispose();
    pollenMat.dispose();
    pollenSpriteTex.dispose();
    scene.remove(pollenPoints);
  }

  return { update, dispose };
}

// ═══════════════════════════════════════════════════════════════════════
//  Legacy shim — old main.js and populate.js import these by name.
//  They are no-ops / stubs so the build stays green while the new
//  game.js / engine.js wires up makeWorld() instead.
// ═══════════════════════════════════════════════════════════════════════

export const CASTLE_POS  = new THREE.Vector3(900,  0, -1200);
export const VILLAGE_POS = new THREE.Vector3(-700, 0,   600);
export const STONES_POS  = new THREE.Vector3(1400, 0,  1500);

/** Stub buildWorld — returns an empty shell the old main.js can destructure. */
export function buildWorld(scene) {
  // Return a shape compatible with old callers (world.terrain.heightAt etc.)
  const noop = () => 0;
  const terrain = { heightAt: noop, SIZE: 8000 };
  const clouds   = { layers: [] };
  const landmarks = { group: new THREE.Group() };
  scene.add(landmarks.group);
  return { terrain, clouds, landmarks };
}

/** Stub updateWorld — called per-frame by old main.js; safe no-op. */
export function updateWorld(_world, _dt, _t, _camera) {
  // no-op
}

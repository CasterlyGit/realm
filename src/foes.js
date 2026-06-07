// ════════════════════════════════════════════════════════════════════════
//  REALM — src/foes.js
//  Shadow crystals + drifting wisps — visual targets to clear, not threats.
//  Factory: makeFoes(scene) → { list, update(dt,ctx), onShatter(foe), reset(), dispose() }
// ════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  PLAY, RENDER, SCORE, ZONES,
  clamp, damp,
} from './constants.js';

// ── module-scope reusables (zero per-frame allocation) ──────────────────
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _col = new THREE.Color();
const _colB = new THREE.Color();

// Pool size — how many foe slots we keep alive at once.
const POOL = 48;

// Wisp drift params
const WISP_DRIFT_SPEED  = 2.8;   // m/s max toward player
const WISP_WANDER_FREQ  = 0.22;  // Hz of figure-8 wander
const WISP_WANDER_AMP   = 6.0;   // m lateral amplitude

// Crystal pulse
const CRYSTAL_PULSE_FREQ = 1.1;  // Hz
const CRYSTAL_PULSE_AMP  = 0.18; // emissive intensity swing

// Formation size
const FORMATION_SHARDS   = 5;    // shards per formation mesh group

// Recycle distance — foe at least this far behind player is recycled
const RECYCLE_BEHIND     = 80;

// Spawn ahead distance band [near, far] from frontier
const SPAWN_AHEAD_MIN    = 30;
const SPAWN_AHEAD_MAX    = 80;

// Lateral spread — crystals/wisps avoid the ring corridor center
const LATERAL_MIN        = 14;
const LATERAL_MAX        = 46;

// ── geometry / material cache (built once) ──────────────────────────────

/** Build a flat-shaded shard from OctahedronGeometry */
function buildCrystalGeo() {
  const g = new THREE.OctahedronGeometry(1.0, 0);
  // Slightly non-uniform scale for visual variety (applied at instance level)
  return g;
}

/** Build a low-poly icosphere for wisps */
function buildWispGeo() {
  return new THREE.IcosahedronGeometry(1.0, 0);
}

/** Additive halo sprite texture (radial soft glow) */
function buildHaloTexture() {
  const sz = 64;
  const canvas = document.createElement('canvas');
  canvas.width = sz; canvas.height = sz;
  const ctx = canvas.getContext('2d');
  const r = sz / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// ── helpers ────────────────────────────────────────────────────────────

function randomSign() { return Math.random() < 0.5 ? -1 : 1; }

function lerpColor(out, hexA, hexB, t) {
  _col.setHex(hexA);
  _colB.setHex(hexB);
  _col.lerp(_colB, t);
  out.copy(_col);
}

/** Resolve the zone-blended foeColor */
function zoneFoeColor(zone) {
  const a = zone.data.foeColor;
  const b = zone.next.foeColor;
  lerpColor(_col, a, b, zone.blend);
  return _col.getHex();
}

/** Resolve the zone-blended glow color (accent) */
function zoneGlowColor(zone) {
  const a = zone.data.glow;
  const b = zone.next.glow;
  lerpColor(_col, a, b, zone.blend);
  return _col.getHex();
}

// ── Foe mesh builders ──────────────────────────────────────────────────

function makeCrystalMesh(crystalGeo, haloTex, foeColor) {
  const group = new THREE.Group();

  // Dark semi-emissive body (Lambert flat shaded)
  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0x1a0d2e,
    emissive: new THREE.Color(foeColor),
    emissiveIntensity: 0.55,
    flatShading: true,
  });
  const body = new THREE.Mesh(crystalGeo, bodyMat);
  // Give each crystal a slightly randomized, elongated shape
  const sx = 0.7 + Math.random() * 0.6;
  const sy = 1.2 + Math.random() * 1.2;
  const sz = 0.7 + Math.random() * 0.6;
  body.scale.set(sx, sy, sz);
  body.rotation.y = Math.random() * Math.PI * 2;
  body.rotation.x = (Math.random() - 0.5) * 0.4;
  group.add(body);

  // Additive glow halo sprite
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: foeColor,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.55,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(6.0);
  group.add(halo);

  return { group, bodyMat, haloMat, body };
}

function makeWispMesh(wispGeo, haloTex, foeColor) {
  const group = new THREE.Group();

  // Core orb — unlit emissive
  const coreMat = new THREE.MeshBasicMaterial({
    color: foeColor,
    transparent: true,
    opacity: 0.82,
  });
  const core = new THREE.Mesh(wispGeo, coreMat);
  core.scale.setScalar(0.9 + Math.random() * 0.4);
  group.add(core);

  // Inner glow ring (slightly larger, additive)
  const innerMat = new THREE.MeshBasicMaterial({
    color: foeColor,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.3,
  });
  const inner = new THREE.Mesh(wispGeo, innerMat);
  inner.scale.setScalar(1.5);
  group.add(inner);

  // Outer halo sprite
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: foeColor,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.45,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(8.5);
  group.add(halo);

  return { group, coreMat, innerMat, haloMat, core };
}

/** Formation: a cluster of FORMATION_SHARDS crystal shards, arranged in a tight star */
function makeFormationMesh(crystalGeo, haloTex, foeColor) {
  const group = new THREE.Group();
  const bodyMats = [];
  const bodies = [];

  for (let i = 0; i < FORMATION_SHARDS; i++) {
    const angle = (i / FORMATION_SHARDS) * Math.PI * 2;
    const rad = 2.5 + Math.random() * 1.5;
    const bodyMat = new THREE.MeshLambertMaterial({
      color: 0x120822,
      emissive: new THREE.Color(foeColor),
      emissiveIntensity: 0.7,
      flatShading: true,
    });
    const body = new THREE.Mesh(crystalGeo, bodyMat);
    body.position.set(Math.cos(angle) * rad, (Math.random() - 0.5) * 3, Math.sin(angle) * rad);
    body.scale.set(0.6 + Math.random() * 0.5, 1.0 + Math.random() * 1.5, 0.6 + Math.random() * 0.5);
    body.rotation.y = Math.random() * Math.PI * 2;
    group.add(body);
    bodyMats.push(bodyMat);
    bodies.push(body);
  }

  // Central large halo
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: foeColor,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.65,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(14.0);
  group.add(halo);

  return { group, bodyMats, bodies, haloMat };
}

// ── main factory ────────────────────────────────────────────────────────

export function makeFoes(scene) {
  const crystalGeo = buildCrystalGeo();
  const wispGeo    = buildWispGeo();
  const haloTex    = buildHaloTexture();

  // Reusable pool of foe descriptors
  // list is the public face; game.js reads pos/radius/hp/hpMax/type/active/mesh
  const list = [];

  // Internal per-foe state (parallel to list)
  const _state = [];

  // Build the pool
  function initPool(foeColor) {
    for (let i = 0; i < POOL; i++) {
      const type = 'crystal'; // initial type; reassigned on spawn
      const crystalMeshData = makeCrystalMesh(crystalGeo, haloTex, foeColor);
      const wispMeshData    = makeWispMesh(wispGeo, haloTex, foeColor);
      const formationData   = makeFormationMesh(crystalGeo, haloTex, foeColor);

      // All three mesh groups are pre-built; only one is shown at a time
      crystalMeshData.group.visible = false;
      wispMeshData.group.visible    = false;
      formationData.group.visible   = false;

      scene.add(crystalMeshData.group);
      scene.add(wispMeshData.group);
      scene.add(formationData.group);

      const foe = {
        pos:    new THREE.Vector3(),
        radius: 3.5,
        hp:     PLAY.CRYSTAL_HP,
        hpMax:  PLAY.CRYSTAL_HP,
        type:   'crystal',
        active: false,
        mesh:   crystalMeshData.group, // whichever group is active
        _id:    i,
      };
      list.push(foe);

      _state.push({
        // mesh variants (kept in scene, visibility-toggled)
        crystalMesh: crystalMeshData,
        wispMesh:    wispMeshData,
        formMesh:    formationData,
        // wisp motion
        wispOffset:  Math.random() * Math.PI * 2,
        wispPhaseX:  Math.random() * Math.PI * 2,
        wispPhaseZ:  Math.random() * Math.PI * 2,
        // formation slow spin
        spinSpeed:   (Math.random() - 0.5) * 0.3,
        // spawn-time random tilt for crystal
        tiltPhase:   Math.random() * Math.PI * 2,
      });
    }
  }

  // Initial foe color from zone 0
  initPool(ZONES[0].foeColor);

  // ── spawn frontier tracking ────────────────────────────────────────
  let _frontier = 0;   // world Z (forward axis) of furthest placed foe
  let _initialized = false;

  function getSpacingForZone(zoneIndex) {
    return PLAY.FOE_SPACING[Math.min(zoneIndex, 2)];
  }

  /** Return a dormant slot index, or -1 if pool full */
  function getFreeSlot() {
    for (let i = 0; i < POOL; i++) {
      if (!list[i].active) return i;
    }
    return -1;
  }

  /** Pick type for a new spawn */
  function pickType(zoneIndex) {
    if (zoneIndex >= 2 && Math.random() < 0.12) return 'formation';
    if (Math.random() < 0.3) return 'wisp';
    return 'crystal';
  }

  /** Activate a slot with a given type + position */
  function activateFoe(slot, type, pos, zone) {
    const foe   = list[slot];
    const state = _state[slot];
    const foeColor = zoneFoeColor(zone);

    // Hide all mesh variants
    state.crystalMesh.group.visible = false;
    state.wispMesh.group.visible    = false;
    state.formMesh.group.visible    = false;

    foe.type = type;
    foe.pos.copy(pos);
    foe.active = true;

    if (type === 'crystal') {
      foe.hp = PLAY.CRYSTAL_HP;
      foe.hpMax = PLAY.CRYSTAL_HP;
      foe.radius = 3.5;
      foe.mesh = state.crystalMesh.group;
      state.crystalMesh.group.visible = true;
      state.crystalMesh.group.position.copy(pos);
      // Tint to current zone
      state.crystalMesh.bodyMat.emissive.setHex(foeColor);
      state.crystalMesh.haloMat.color.setHex(foeColor);

    } else if (type === 'wisp') {
      foe.hp = PLAY.WISP_HP;
      foe.hpMax = PLAY.WISP_HP;
      foe.radius = 4.0;
      foe.mesh = state.wispMesh.group;
      state.wispMesh.group.visible = true;
      state.wispMesh.group.position.copy(pos);
      state.wispMesh.coreMat.color.setHex(foeColor);
      state.wispMesh.innerMat.color.setHex(foeColor);
      state.wispMesh.haloMat.color.setHex(foeColor);

    } else { // formation
      foe.hp = PLAY.FORMATION_HP;
      foe.hpMax = PLAY.FORMATION_HP;
      foe.radius = 8.0;
      foe.mesh = state.formMesh.group;
      state.formMesh.group.visible = true;
      state.formMesh.group.position.copy(pos);
      for (const mat of state.formMesh.bodyMats) {
        mat.emissive.setHex(foeColor);
      }
      state.formMesh.haloMat.color.setHex(foeColor);
    }
  }

  /** Deactivate + hide a slot */
  function deactivateFoe(slot) {
    const foe   = list[slot];
    const state = _state[slot];
    foe.active = false;
    state.crystalMesh.group.visible = false;
    state.wispMesh.group.visible    = false;
    state.formMesh.group.visible    = false;
  }

  /** Spawn a new foe ahead of the player */
  function spawnAhead(playerPos, playerForward, zone) {
    const slot = getFreeSlot();
    if (slot < 0) return;

    // Distance ahead: frontier or player-based
    const ahead = SPAWN_AHEAD_MIN + Math.random() * (SPAWN_AHEAD_MAX - SPAWN_AHEAD_MIN);
    const lateral = (LATERAL_MIN + Math.random() * (LATERAL_MAX - LATERAL_MIN)) * randomSign();
    const vertical = (Math.random() - 0.5) * 24;

    // Place relative to player forward direction
    _v3a.copy(playerForward).multiplyScalar(ahead);
    // right vector: cross forward with world up
    _v3b.set(playerForward.z, 0, -playerForward.x).normalize();
    _v3a.addScaledVector(_v3b, lateral);
    _v3a.y += vertical;
    _v3a.add(playerPos);

    const type = pickType(zone.index);
    activateFoe(slot, type, _v3a, zone);
  }

  // ── update helpers ─────────────────────────────────────────────────

  /** Update crystal: pulse emissive + gentle slow spin */
  function updateCrystal(foe, state, t, dt, zone) {
    const mesh = state.crystalMesh;
    const pulse = 0.55 + CRYSTAL_PULSE_AMP * Math.sin(t * CRYSTAL_PULSE_FREQ * Math.PI * 2 + state.tiltPhase);
    mesh.bodyMat.emissiveIntensity = pulse;
    // HP damage dims it
    const hpFrac = foe.hp / foe.hpMax;
    mesh.haloMat.opacity = 0.25 + 0.3 * hpFrac;

    // Very slow rotation
    mesh.body.rotation.y += dt * 0.25;
    mesh.group.position.copy(foe.pos);
  }

  /** Update wisp: figure-8 wander + gentle drift toward player */
  function updateWisp(foe, state, t, dt, playerPos, zone) {
    const mesh = state.wispMesh;
    const age  = t * WISP_WANDER_FREQ * Math.PI * 2;

    // Wander offset (sine-driven, not toward player)
    const wx = Math.sin(age + state.wispPhaseX) * WISP_WANDER_AMP;
    const wz = Math.cos(age * 0.73 + state.wispPhaseZ) * WISP_WANDER_AMP * 0.6;

    // Very gentle drift toward player — never aggressive
    _v3a.copy(playerPos).sub(foe.pos);
    const dist = _v3a.length();
    // Only activate drift if within 60m, scale by 1/dist so far ones barely move
    let driftScale = 0;
    if (dist < 60) driftScale = clamp((60 - dist) / 60, 0, 1) * 0.25;

    foe.pos.x = damp(foe.pos.x, foe.pos.x + wx * 0.01 + _v3a.x * driftScale, 1.5, dt);
    foe.pos.y = damp(foe.pos.y, foe.pos.y + _v3a.y * driftScale * 0.3, 1.5, dt);
    foe.pos.z = damp(foe.pos.z, foe.pos.z + wz * 0.01 + _v3a.z * driftScale, 1.5, dt);

    mesh.group.position.copy(foe.pos);

    // Pulsing bob
    const bob = Math.sin(t * 1.7 + state.wispOffset) * 0.6;
    mesh.group.position.y += bob;

    // Inner glow breathe
    const breathe = 0.5 + 0.35 * Math.sin(t * 2.3 + state.wispOffset);
    mesh.innerMat.opacity = breathe * 0.4;
    mesh.haloMat.opacity  = 0.3 + 0.15 * breathe;

    // Slow spin of core
    mesh.core.rotation.y += dt * 0.6;
    mesh.core.rotation.x += dt * 0.35;
  }

  /** Update formation: slow group spin + shard pulse */
  function updateFormation(foe, state, t, dt, zone) {
    const mesh = state.formMesh;
    mesh.group.position.copy(foe.pos);
    mesh.group.rotation.y += dt * state.spinSpeed;

    const pulse = 0.5 + 0.2 * Math.sin(t * CRYSTAL_PULSE_FREQ * 1.4 * Math.PI * 2);
    for (const mat of mesh.bodyMats) {
      mat.emissiveIntensity = pulse;
    }
    const hpFrac = foe.hp / foe.hpMax;
    mesh.haloMat.opacity = 0.4 + 0.25 * hpFrac * Math.sin(t * 3.1);
  }

  /** Retint all active foes to new zone blend */
  function retintAll(zone) {
    const foeColor = zoneFoeColor(zone);
    for (let i = 0; i < POOL; i++) {
      if (!list[i].active) continue;
      const state = _state[i];
      const foe = list[i];
      if (foe.type === 'crystal') {
        state.crystalMesh.bodyMat.emissive.setHex(foeColor);
        state.crystalMesh.haloMat.color.setHex(foeColor);
      } else if (foe.type === 'wisp') {
        state.wispMesh.coreMat.color.setHex(foeColor);
        state.wispMesh.innerMat.color.setHex(foeColor);
        state.wispMesh.haloMat.color.setHex(foeColor);
      } else {
        for (const mat of state.formMesh.bodyMats) {
          mat.emissive.setHex(foeColor);
        }
        state.formMesh.haloMat.color.setHex(foeColor);
      }
    }
  }

  // ── public API ─────────────────────────────────────────────────────

  function reset() {
    for (let i = 0; i < POOL; i++) {
      deactivateFoe(i);
    }
    _frontier = 0;
    _initialized = false;
  }

  function onShatter(foe) {
    // game.js calls this when hp ≤ 0; we just hide + deactivate
    const slot = foe._id;
    if (slot < 0 || slot >= POOL) return;
    deactivateFoe(slot);
  }

  function update(dt, ctx) {
    try {
      const { time, player, zone } = ctx;

      // First frame: seed the frontier well ahead
      if (!_initialized) {
        _frontier = player.pos.z - getSpacingForZone(zone.index) * 2;
        _initialized = true;
      }

      // ── Recycle foes behind the player ──────────────────────────────
      for (let i = 0; i < POOL; i++) {
        if (!list[i].active) continue;
        _v3a.copy(list[i].pos).sub(player.pos);
        // "Behind" = dot with forward < 0 and distance > recycle threshold
        if (_v3a.dot(player.forward) < -RECYCLE_BEHIND) {
          deactivateFoe(i);
        }
      }

      // ── Spawn new foes ahead of frontier ───────────────────────────
      const spacing = getSpacingForZone(zone.index);
      // Move frontier forward with player
      const newFrontier = player.pos.z - spacing;
      if (_frontier > newFrontier || !_initialized) {
        _frontier = newFrontier;
      }
      // Spawn if frontier is less than spacing ahead of player
      const targetFrontier = player.pos.z - spacing * 4;
      while (_frontier > targetFrontier) {
        spawnAhead(player.pos, player.forward, zone);
        _frontier -= spacing;
      }

      // ── Re-tint each frame (cheap — color obj assignment, no alloc) ──
      retintAll(zone);

      // ── Animate active foes ─────────────────────────────────────────
      for (let i = 0; i < POOL; i++) {
        if (!list[i].active) continue;
        const foe   = list[i];
        const state = _state[i];
        if (foe.type === 'crystal') {
          updateCrystal(foe, state, time, dt, zone);
        } else if (foe.type === 'wisp') {
          updateWisp(foe, state, time, dt, player.pos, zone);
        } else {
          updateFormation(foe, state, time, dt, zone);
        }
      }
    } catch (_) {
      // Never throw in update
    }
  }

  function dispose() {
    crystalGeo.dispose();
    wispGeo.dispose();
    haloTex.dispose();
    for (let i = 0; i < POOL; i++) {
      const state = _state[i];
      state.crystalMesh.bodyMat.dispose();
      state.crystalMesh.haloMat.dispose();
      scene.remove(state.crystalMesh.group);
      state.wispMesh.coreMat.dispose();
      state.wispMesh.innerMat.dispose();
      state.wispMesh.haloMat.dispose();
      scene.remove(state.wispMesh.group);
      for (const mat of state.formMesh.bodyMats) mat.dispose();
      state.formMesh.haloMat.dispose();
      scene.remove(state.formMesh.group);
    }
    list.length = 0;
    _state.length = 0;
  }

  return { list, update, onShatter, reset, dispose };
}

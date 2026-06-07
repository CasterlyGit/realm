// ════════════════════════════════════════════════════════════════════════
//  motes.js — Floating light-motes: ambient drift + magnetism + spawnAt
//  Factory: makeMotes(scene) → { list, update, spawnAt, onCollect, reset, dispose }
// ════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import {
  PLAY, RENDER, SCORE, ZONES, FLIGHT,
  clamp, damp,
} from './constants.js';

// ── Constants ────────────────────────────────────────────────────────────
const POOL_SIZE     = 120;          // hard ceiling
const AMBIENT_COUNT = 72;           // motes kept alive as ambient drifters
const CORRIDOR_R    = 28;           // lateral scatter radius around forward path
const SPAWN_AHEAD   = 90;           // meters ahead of player to place ambient motes
const SPAWN_SPREAD  = 60;           // longitudinal spread of ambient band
const RECYCLE_DIST  = 80;           // meters behind player to recycle

// Sphere radius per type (visual only)
const SPHERE_R = { small: 0.28, pulse: 0.42, crystal: 0.60, aurora: 0.80 };

// Halo scale relative to sphere
const HALO_SCALE = { small: 3.4, pulse: 4.2, crystal: 5.6, aurora: 7.2 };

// Drift speed per type (m/s base)
const DRIFT_SPEED = { small: 1.4, pulse: 2.1, crystal: 1.8, aurora: 2.6 };

// Bob amplitude (m) and freq (rad/s) per type
const BOB_AMP  = { small: 0.55, pulse: 0.80, crystal: 0.65, aurora: 1.10 };
const BOB_FREQ = { small: 1.1,  pulse: 0.85, crystal: 0.70, aurora: 0.60 };

// Magnetism stiffness (k) — tuned so motes "rush in" satisfyingly
const K_MAGNET      = 5.5;
const K_SPAWN_SETTLE = 3.2;  // settle stiffness for freshly-burst motes

// ── Procedural CanvasTexture for soft additive halo ──────────────────────
function makeHaloTexture() {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const cx = SIZE / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0,  'rgba(255,255,255,0.92)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.60, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1.0,  'rgba(255,255,255,0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ── Shared geometry + material stubs — created once ──────────────────────
//  We make one geometry per type so InstancedMesh reuse is easy,
//  but here we use individual meshes (pool size ~120 — well within budget)
//  to allow per-mote colour/scale without instanced-colour overhead.
//  Each mote = 1 SphereGeometry (8 seg) + 1 PlaneGeometry halo → ≤2 draw calls recycled.

// ── Zone colour helpers ───────────────────────────────────────────────────
const _colA = new THREE.Color();
const _colB = new THREE.Color();

function zoneGlow(zone) {
  _colA.setHex(zone.data.glow);
  _colB.setHex(zone.next.glow);
  _colA.lerp(_colB, zone.blend);
  return _colA.clone();
}

function zoneAccent(zone) {
  _colA.setHex(zone.data.accent);
  _colB.setHex(zone.next.accent);
  _colA.lerp(_colB, zone.blend);
  return _colA.clone();
}

// Per-type hue shift: aurora gets the zone glow, smaller types shift toward accent
function moteColor(type, zone) {
  const g = zoneGlow(zone);
  const a = zoneAccent(zone);
  const t = { small: 0.0, pulse: 0.25, crystal: 0.55, aurora: 1.0 }[type] ?? 0;
  g.lerp(a, t);
  return g;
}

// ── Module-scope temp vectors (ZERO per-frame allocation) ─────────────────
const _v  = new THREE.Vector3();
const _d  = new THREE.Vector3();

// ── Factory ──────────────────────────────────────────────────────────────
export function makeMotes(scene) {
  // Shared assets
  const haloTex = makeHaloTexture();

  // Geometry pool — keyed by type
  const _sphereGeo = {};
  const _haloGeo   = new THREE.PlaneGeometry(1, 1); // scaled at runtime

  for (const type of ['small','pulse','crystal','aurora']) {
    const r = SPHERE_R[type];
    _sphereGeo[type] = new THREE.SphereGeometry(r, 8, 6);
  }

  // Mote internal state slots (we build POOL_SIZE slots up-front)
  const list = [];          // exposed — game.js iterates this
  const _freeSlots = [];    // indices of currently inactive motes

  // Per-mote runtime state (parallel arrays to list for GC-free hot path)
  const _driftDir = [];     // THREE.Vector3 — ambient drift direction
  const _phase    = [];     // Number — sin phase offset
  const _baseY    = [];     // Number — bob baseline Y
  const _settling = [];     // Boolean — true while spawnAt burst is settling
  const _target   = [];     // THREE.Vector3 — magnetism / settle target

  // Build the pool
  for (let i = 0; i < POOL_SIZE; i++) {
    // Sphere
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const sphereMesh = new THREE.Mesh(_sphereGeo['small'], sphereMat);
    sphereMesh.visible = false;

    // Halo sprite (PlaneGeometry, always faces camera → billboarded in update)
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0xffffff,
      opacity: 0.78,
    });
    const haloMesh = new THREE.Mesh(_haloGeo, haloMat);
    haloMesh.visible = false;

    // Group the two so we move one transform
    const group = new THREE.Group();
    group.add(sphereMesh);
    group.add(haloMesh);
    scene.add(group);

    const mote = {
      pos:    new THREE.Vector3(),
      value:  'small',
      active: false,
      mesh:   group,     // game.js can reference this
      _id:    i,
      _sphere: sphereMesh,
      _halo:   haloMesh,
      _sphereMat: sphereMat,
      _haloMat:   haloMat,
    };

    list.push(mote);
    _freeSlots.push(i);
    _driftDir.push(new THREE.Vector3());
    _phase.push(Math.random() * Math.PI * 2);
    _baseY.push(0);
    _settling.push(false);
    _target.push(new THREE.Vector3());
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function _acquire(type, pos) {
    if (_freeSlots.length === 0) return null; // pool exhausted — skip gracefully
    const idx = _freeSlots.pop();
    const mote = list[idx];

    mote.value  = type;
    mote.active = true;
    mote.pos.copy(pos);

    // Swap geometry on sphere
    mote._sphere.geometry = _sphereGeo[type];

    // Reset visual scale
    const hs = SPHERE_R[type] * HALO_SCALE[type];
    mote._halo.scale.setScalar(hs);

    // Show
    mote.mesh.position.copy(pos);
    mote._sphere.visible = true;
    mote._halo.visible   = true;

    // Runtime state
    _phase[idx]    = Math.random() * Math.PI * 2;
    _baseY[idx]    = pos.y;
    _settling[idx] = false;

    // Random ambient drift direction (mostly horizontal)
    _driftDir[idx].set(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 2,
    ).normalize();

    return mote;
  }

  function _release(mote) {
    if (!mote.active) return;
    mote.active = false;
    mote._sphere.visible = false;
    mote._halo.visible   = false;
    _freeSlots.push(mote._id);
  }

  // Ambient spawn target: random point in the band ahead of the player
  function _ambientPos(playerPos, forward) {
    // Pick a random Z offset along corridor, then scatter radially
    const along  = SPAWN_AHEAD + Math.random() * SPAWN_SPREAD;
    const angle  = Math.random() * Math.PI * 2;
    const radial = Math.random() * CORRIDOR_R;
    _v.set(
      playerPos.x + forward.x * along + Math.cos(angle) * radial,
      playerPos.y + (Math.random() - 0.3) * CORRIDOR_R * 0.55,
      playerPos.z + forward.z * along + Math.sin(angle) * radial,
    );
    return _v.clone();
  }

  // ── Colour tinting pass (called when zone changes or on acquire) ────────
  function _tintMote(mote, zone) {
    const col = moteColor(mote.value, zone);
    mote._sphereMat.color.copy(col);
    mote._haloMat.color.copy(col);
  }

  // ── spawnAt (called by game.js after foe shatter) ──────────────────────
  function spawnAt(pos, value, count) {
    const n = clamp(count, 1, 8); // never spawn more than 8 at once
    for (let i = 0; i < n; i++) {
      const mote = _acquire(value, pos);
      if (!mote) break;

      // Burst outward, then settle — small random displacement
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const r     = 3 + Math.random() * 4;
      mote.pos.set(
        pos.x + Math.cos(angle) * r,
        pos.y + 2 + Math.random() * 3,
        pos.z + Math.sin(angle) * r,
      );
      mote.mesh.position.copy(mote.pos);
      _baseY[mote._id]    = mote.pos.y;
      _settling[mote._id] = true;
      // Settling target = the original pos so they cluster back
      _target[mote._id].copy(pos).setY(pos.y + 1.2);
    }
  }

  // ── onCollect (called by game.js) ──────────────────────────────────────
  function onCollect(mote) {
    _release(mote);
  }

  // ── reset ──────────────────────────────────────────────────────────────
  function reset() {
    for (let i = 0; i < POOL_SIZE; i++) {
      _release(list[i]);
    }
  }

  // ── update ─────────────────────────────────────────────────────────────
  let _lastAmbientSpawn = 0; // time-gate ambient spawns

  function update(dt, ctx) {
    // Safety guard — don't crash if ctx is incomplete
    if (!ctx || !ctx.player) return;

    const { time, player, zone, camera } = ctx;

    // Determine magnet radius (doubled during glideFall)
    const magnetR = player.glideFall
      ? PLAY.MOTE_MAGNET_R_GLIDE
      : PLAY.MOTE_MAGNET_R;
    const magnetR2 = magnetR * magnetR; // squared for fast compare

    // ── 1. Maintain ambient population ─────────────────────────────────
    // Count active ambient motes (non-settling)
    let activeAmbient = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const m = list[i];
      if (m.active && !_settling[i]) activeAmbient++;
    }

    // Spawn up to AMBIENT_COUNT (throttled to ~4/frame max)
    if (activeAmbient < AMBIENT_COUNT && time - _lastAmbientSpawn > 0.04) {
      const need = Math.min(AMBIENT_COUNT - activeAmbient, 4);
      for (let s = 0; s < need; s++) {
        // Weight type by zone index
        const roll = Math.random();
        let type;
        if (zone.index === 2) {
          type = roll < 0.15 ? 'aurora' : roll < 0.45 ? 'crystal' : roll < 0.70 ? 'pulse' : 'small';
        } else if (zone.index === 1) {
          type = roll < 0.04 ? 'aurora' : roll < 0.22 ? 'crystal' : roll < 0.52 ? 'pulse' : 'small';
        } else {
          type = roll < 0.02 ? 'crystal' : roll < 0.25 ? 'pulse' : 'small';
        }
        const p = _ambientPos(player.pos, player.forward);
        _acquire(type, p);
      }
      _lastAmbientSpawn = time;
    }

    // ── 2. Per-mote tick ────────────────────────────────────────────────
    for (let i = 0; i < POOL_SIZE; i++) {
      const m = list[i];
      if (!m.active) continue;

      const type    = m.value;
      const phase   = _phase[i];
      const baseY   = _baseY[i];
      const bobAmp  = BOB_AMP[type];
      const bobFreq = BOB_FREQ[type];

      // ── Recycle if too far behind player ──────────────────────────────
      _d.subVectors(m.pos, player.pos);
      // Behind = negative dot with forward; also too far away laterally
      const dotFwd = _d.dot(player.forward);
      if (dotFwd < -RECYCLE_DIST || _d.length() > RENDER.FAR * 0.6) {
        if (!_settling[i]) {
          _release(m);
          continue;
        }
      }

      // ── Magnetism ─────────────────────────────────────────────────────
      const dist2 = m.pos.distanceToSquared(player.pos);

      if (dist2 < magnetR2) {
        // Rush toward player using damp (frame-rate independent)
        m.pos.x = damp(m.pos.x, player.pos.x, K_MAGNET, dt);
        m.pos.y = damp(m.pos.y, player.pos.y, K_MAGNET, dt);
        m.pos.z = damp(m.pos.z, player.pos.z, K_MAGNET, dt);
        // Raise bob baseline with it so bob doesn't fight magnetism
        _baseY[i] = m.pos.y;
      } else if (_settling[i]) {
        // Settling phase: damp toward target (post-burst)
        m.pos.x = damp(m.pos.x, _target[i].x, K_SPAWN_SETTLE, dt);
        m.pos.y = damp(m.pos.y, _target[i].y, K_SPAWN_SETTLE, dt);
        m.pos.z = damp(m.pos.z, _target[i].z, K_SPAWN_SETTLE, dt);
        _baseY[i] = m.pos.y;

        // Stop settling once close enough
        if (m.pos.distanceToSquared(_target[i]) < 0.5 * 0.5) {
          _settling[i] = false;
          _baseY[i] = m.pos.y;
        }
      } else {
        // Ambient drift + bob
        const speed = DRIFT_SPEED[type];
        m.pos.x += _driftDir[i].x * speed * dt;
        m.pos.z += _driftDir[i].z * speed * dt;
        m.pos.y  = baseY + Math.sin(time * bobFreq + phase) * bobAmp;
      }

      // ── Update mesh transform ─────────────────────────────────────────
      m.mesh.position.copy(m.pos);

      // Billboard halo toward camera
      m._halo.lookAt(camera.position);

      // ── Zone tint (cheap: only recompute color if blend moved) ─────────
      const col = moteColor(type, zone);
      m._sphereMat.color.copy(col);
      m._haloMat.color.copy(col);

      // ── Pulse brightness (emissive-style: brighten with sin) ───────────
      const pulse = 0.75 + 0.25 * Math.sin(time * bobFreq * 2.1 + phase);
      m._sphereMat.opacity = clamp(pulse * 0.92, 0.5, 1.0);
      m._haloMat.opacity   = clamp(pulse * 0.72, 0.3, 0.85);

      // ── Halo scale breathes with pulse ────────────────────────────────
      const haloS = SPHERE_R[type] * HALO_SCALE[type] * (0.9 + 0.2 * pulse);
      m._halo.scale.setScalar(haloS);
    }
  }

  // ── dispose ────────────────────────────────────────────────────────────
  function dispose() {
    for (const m of list) {
      scene.remove(m.mesh);
    }
    for (const geo of Object.values(_sphereGeo)) geo.dispose();
    _haloGeo.dispose();
    haloTex.dispose();
    for (const m of list) {
      m._sphereMat.dispose();
      m._haloMat.dispose();
    }
  }

  // ── Seed initial ambient motes away from origin ────────────────────────
  // (game.js calls reset() before first update; we populate lazily in update)

  return { list, update, spawnAt, onCollect, reset, dispose };
}

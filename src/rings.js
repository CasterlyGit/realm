// ════════════════════════════════════════════════════════════════════════
//  REALM — src/rings.js
//  Glowing gate corridor with meandering spawn frontier.
//  game.js detects passes (reads list[]). We handle visuals, pulse, onPass.
// ════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  PLAY, RENDER, ZONES,
  clamp, damp,
} from './constants.js';

// ── Constants ─────────────────────────────────────────────────────────
const RING_TUBE_RADIUS   = 0.55;   // torus tube thickness
const TORUS_SEG_R        = 22;     // radial segments (keep < 24 for budget)
const TORUS_SEG_T        = 8;      // tubular segments
const POOL_SIZE          = 24;     // ring object pool
const TARGET_ACTIVE      = 16;     // try to keep this many active rings
const SPAWN_LEAD_MIN     = 180;    // spawn when frontier is within this range
const FIRST_SPAWN_DIST   = 140;    // first cluster distance from player start
const CLUSTER_COUNT_MIN  = 4;
const CLUSTER_COUNT_MAX  = 8;
const RING_SPACING       = 38;     // meters between rings in a cluster
const WANDER_FREQ        = 0.07;   // guide path oscillation frequency (1/m)
const WANDER_AMP_H       = 18;     // horizontal wander amplitude (m)
const WANDER_AMP_V       = 9;      // vertical wander amplitude (m)
const HALO_SCALE         = 3.2;    // halo sprite scale factor relative to ring radius
const PULSE_FREQ         = 1.1;    // ring pulse frequency (Hz)
const PULSE_AMP          = 0.08;   // emissive pulse amplitude
const PASS_FLASH_DUR     = 0.45;   // seconds for onPass flash

// motif types
const MOTIFS = ['line', 'arc', 'spiral'];

// ── Module-scope temp objects (NO per-frame allocation) ───────────────
const _v3a  = new THREE.Vector3();
const _v3b  = new THREE.Vector3();
const _v3c  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up   = new THREE.Vector3(0, 1, 0);
const _col  = new THREE.Color();
const _col2 = new THREE.Color();

// ── Procedural halo CanvasTexture (built once) ────────────────────────
let _haloTexture = null;
function getHaloTexture() {
  if (_haloTexture) return _haloTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0,    'rgba(255,255,255,0.92)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.50, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _haloTexture = new THREE.CanvasTexture(canvas);
  return _haloTexture;
}

// ── Shared geometry / materials (built once, all rings share) ─────────
let _torusGeo  = null;
let _haloGeo   = null;
let _torusMat  = null;
let _haloMat   = null;
let _builtOnce = false;

function buildShared() {
  if (_builtOnce) return;
  _builtOnce = true;

  _torusGeo = new THREE.TorusGeometry(
    PLAY.RING_RADIUS, RING_TUBE_RADIUS, TORUS_SEG_T, TORUS_SEG_R
  );

  // Flat quad sprite for halo
  _haloGeo = new THREE.PlaneGeometry(1, 1);

  _torusMat = new THREE.MeshBasicMaterial({
    color:       0xffd27a,
    side:        THREE.DoubleSide,
    transparent: false,
  });

  _haloMat = new THREE.SpriteMaterial({
    map:          getHaloTexture(),
    blending:     THREE.AdditiveBlending,
    depthWrite:   false,
    transparent:  true,
    opacity:      0.55,
    color:        0xffd27a,
  });
}

// ── Guide path: smooth meander in world space ─────────────────────────
// Returns world position at cumulative distance `d` from origin.
function guidePt(d, baseDir, basePos, outV3) {
  // Project forward along baseDir, then add slow lateral + vertical sine wander.
  // We bake the oscillation into the spawn frontier so clusters feel organic.
  _v3a.copy(baseDir).multiplyScalar(d);
  const h = Math.sin(d * WANDER_FREQ)             * WANDER_AMP_H;
  const v = Math.sin(d * WANDER_FREQ * 0.67 + 1.4) * WANDER_AMP_V;
  // perp horizontal (world right approximation from baseDir)
  _v3b.set(baseDir.z, 0, -baseDir.x).normalize();
  outV3.copy(basePos)
       .addScaledVector(baseDir, d)
       .addScaledVector(_v3b, h)
       .add(_v3c.set(0, v, 0));
}

// Guide tangent (central diff, small step) for ring orientation
function guideTangent(d, baseDir, basePos, outV3, step = 2.0) {
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  guidePt(d - step, baseDir, basePos, p1);
  guidePt(d + step, baseDir, basePos, p2);
  outV3.subVectors(p2, p1).normalize();
}

// ── Factory ───────────────────────────────────────────────────────────
export function makeRings(scene) {
  buildShared();

  // Pool of ring objects
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const mesh  = new THREE.Mesh(_torusGeo, _torusMat.clone());
    const halo  = new THREE.Sprite(_haloMat.clone());
    halo.scale.setScalar(PLAY.RING_RADIUS * HALO_SCALE);
    halo.renderOrder = 1;
    mesh.add(halo);
    mesh.visible = false;
    scene.add(mesh);

    pool.push({
      pos:     new THREE.Vector3(),
      quat:    new THREE.Quaternion(),
      normal:  new THREE.Vector3(0, 0, -1),
      radius:  PLAY.RING_RADIUS,
      active:  false,
      passed:  false,
      perfect: false,
      mesh,
      _halo:   halo,
      _id:     i,
      // internal
      _flashTimer: 0,
      _dist: 0,   // distance along guide path when spawned
    });
  }

  // Exposed list (game.js reads this)
  const list = pool;

  // Spawn frontier state
  let _frontierDist = 0;   // cumulative path distance of next ring to place
  let _guideDir     = new THREE.Vector3(0, 0, -1);  // forward at reset
  let _guideOrigin  = new THREE.Vector3();
  let _motifIdx     = 0;
  let _zoneIndex    = 0;

  // ── helpers ────────────────────────────────────────────────────────
  function freePool() {
    return pool.filter(r => !r.active);
  }

  function activeCount() {
    return pool.filter(r => r.active).length;
  }

  function getZoneColor(ctx) {
    const z  = ctx.zone.data;
    const nz = ctx.zone.next;
    const t  = ctx.zone.blend;
    _col.set(z.ringColor);
    _col2.set(nz.ringColor);
    _col.lerp(_col2, t);
    return _col;
  }

  function placeRing(ring, pos, tangent, dist) {
    ring.pos.copy(pos);
    ring._dist = dist;

    // Orient torus so its face is perpendicular to tangent (ring.normal = tangent)
    ring.normal.copy(tangent);
    // Build quaternion: torus default face is XY plane (normal = Z+)
    // We want normal = tangent, so rotate from Z+ to tangent
    _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    ring.quat.copy(_quat);

    ring.active  = true;
    ring.passed  = false;
    ring.perfect = false;
    ring._flashTimer = 0;

    ring.mesh.position.copy(pos);
    ring.mesh.quaternion.copy(_quat);
    ring.mesh.visible = true;
    ring.mesh.scale.setScalar(1);
  }

  // Spawn one cluster of rings along the guide path
  function spawnCluster(ctx) {
    const motif = MOTIFS[_motifIdx % MOTIFS.length];
    _motifIdx++;
    const count = CLUSTER_COUNT_MIN +
      Math.floor(Math.random() * (CLUSTER_COUNT_MAX - CLUSTER_COUNT_MIN + 1));

    for (let i = 0; i < count; i++) {
      const free = freePool();
      if (free.length === 0) break;

      const ring = free[0];
      const d    = _frontierDist + i * ringSpacingForMotif(motif, i);

      const pt  = new THREE.Vector3();
      const tan = new THREE.Vector3();
      guidePt(d, _guideDir, _guideOrigin, pt);
      guideTangent(d, _guideDir, _guideOrigin, tan);

      // Motif offsets in ring's local plane (perp to tangent)
      if (motif === 'arc') {
        const angle = (i / (count - 1) - 0.5) * Math.PI * 0.6;
        const r = 28;
        // compute local right/up for the ring plane
        _v3b.set(tan.z, 0, -tan.x).normalize(); // right in XZ plane
        _v3c.set(0, 1, 0);
        pt.addScaledVector(_v3b, Math.sin(angle) * r)
          .addScaledVector(_v3c, (1 - Math.cos(angle)) * r * 0.45);
      } else if (motif === 'spiral') {
        const angle = i * (Math.PI * 0.45);
        const rr    = 10 + i * 3.5;
        _v3b.set(tan.z, 0, -tan.x).normalize();
        _v3c.set(0, 1, 0);
        pt.addScaledVector(_v3b, Math.cos(angle) * rr)
          .addScaledVector(_v3c, Math.sin(angle) * rr * 0.6);
      }
      // 'line' → no extra offset, guide path itself creates the curve

      placeRing(ring, pt, tan, d);
    }

    _frontierDist += count * RING_SPACING + 60; // gap after cluster
  }

  function ringSpacingForMotif(motif, i) {
    if (motif === 'arc')    return RING_SPACING * 0.9;
    if (motif === 'spiral') return RING_SPACING * 0.7;
    return RING_SPACING;
  }

  // Furthest active ring distance from player
  function frontierDistFromPlayer(ctx) {
    let maxD = -Infinity;
    for (const r of pool) {
      if (!r.active || r.passed) continue;
      const dd = ctx.player.forward.dot(
        _v3a.subVectors(r.pos, ctx.player.pos)
      );
      if (dd > maxD) maxD = dd;
    }
    return maxD === -Infinity ? 0 : maxD;
  }

  // ── zone color update ─────────────────────────────────────────────
  function updateColors(ctx) {
    const col = getZoneColor(ctx);
    for (const r of pool) {
      if (!r.active) continue;
      r.mesh.material.color.copy(col);
      r._halo.material.color.copy(col);
    }
  }

  // ── public API ────────────────────────────────────────────────────
  function update(dt, ctx) {
    try {
      const t     = ctx.time;
      const zIdx  = ctx.zone.index;

      // Update guide dir to lazily track player forward (very slow, feels anchored)
      _guideDir.lerp(ctx.player.forward, dt * 0.08).normalize();

      // Recycle rings that are well behind the player
      const recycleDist = -60;
      for (const r of pool) {
        if (!r.active) continue;
        const dot = _v3a.subVectors(r.pos, ctx.player.pos)
                        .dot(ctx.player.forward);
        if (dot < recycleDist) {
          r.active     = false;
          r.mesh.visible = false;
        }
      }

      // Spawn more clusters if frontier is close or count is low
      const leadDist  = frontierDistFromPlayer(ctx);
      const threshold = PLAY.RING_CLUSTER_GAP[zIdx] || 280;
      if (leadDist < threshold || activeCount() < TARGET_ACTIVE - 4) {
        if (freePool().length >= CLUSTER_COUNT_MIN) {
          spawnCluster(ctx);
        }
      }

      // Color update (every frame, cheap lerp)
      const col = getZoneColor(ctx);
      const pulse = 1 + PULSE_AMP * Math.sin(t * PULSE_FREQ * Math.PI * 2);

      for (const r of pool) {
        if (!r.active) continue;

        // Pulse emissive brightness via color brightness scale
        r.mesh.material.color.copy(col).multiplyScalar(pulse);
        r._halo.material.color.copy(col);
        r._halo.material.opacity = clamp(0.38 + 0.18 * Math.sin(t * PULSE_FREQ * Math.PI * 2 + r._id), 0.2, 0.65);

        // Very slow roll animation (aesthetic)
        _v3b.copy(r.normal);
        const rotAmt = dt * 0.08 * (((r._id % 3) - 1) * 0.5 + 1.0);
        _quat.setFromAxisAngle(_v3b, rotAmt);
        r.mesh.quaternion.premultiply(_quat);
        r.quat.copy(r.mesh.quaternion);

        // Flash timer (from onPass)
        if (r._flashTimer > 0) {
          r._flashTimer -= dt;
          const frac = clamp(r._flashTimer / PASS_FLASH_DUR, 0, 1);
          const sc   = 1 + 0.35 * frac;
          r.mesh.scale.setScalar(sc);
          r.mesh.material.color.copy(col).multiplyScalar(pulse + frac * 2.5);
          r._halo.material.opacity = clamp(0.55 + frac * 0.45, 0, 1);
        } else {
          r.mesh.scale.setScalar(1);
        }
      }
    } catch (_) {
      // Never throw in update
    }
  }

  function onPass(ring) {
    if (!ring || !ring.mesh) return;
    ring._flashTimer = PASS_FLASH_DUR;
  }

  function reset() {
    // Hide all rings
    for (const r of pool) {
      r.active      = false;
      r.passed      = false;
      r.perfect     = false;
      r._flashTimer = 0;
      r.mesh.visible = false;
      r.mesh.scale.setScalar(1);
    }
    _frontierDist = 0;
    _motifIdx     = 0;
    // Reset guide to world -Z (player forward at start)
    _guideDir.set(0, 0, -1);
    _guideOrigin.set(0, 0, 0);
  }

  function dispose() {
    for (const r of pool) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      r._halo.material.dispose();
    }
    if (_haloTexture) { _haloTexture.dispose(); _haloTexture = null; }
    _torusMat.dispose();
    // geometry shared; dispose only if sole user (game lifetime = until page unload)
  }

  // ── Init: seed the guide origin at player start + spawn first cluster ─
  // We can't call ctx here (no ctx at construction time), so we defer to
  // first update. Use a flag.
  let _initialized = false;

  // Wrap update to handle first-frame init
  const _updateInner = update;
  function updateWrapper(dt, ctx) {
    if (!_initialized) {
      _initialized   = true;
      _guideDir.copy(ctx.player.forward).normalize();
      _guideOrigin.copy(ctx.player.pos);
      _frontierDist  = FIRST_SPAWN_DIST;
      // Spawn two initial clusters so the player always has rings from the start
      spawnCluster(ctx);
      spawnCluster(ctx);
    }
    _updateInner(dt, ctx);
  }

  return { list, update: updateWrapper, onPass, reset, dispose };
}

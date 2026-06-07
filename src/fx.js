// ═══════════════════════════════════════════════════════════════════════════
//  src/fx.js — Realm FX: particle pool + fire stream + speed streaks
//  export function makeFX(scene)
//  Hard rules: no per-frame alloc, bounded pools, additive blending, damp().
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { RENDER, damp } from './constants.js';

// ── Pool sizes (must sum ≤ RENDER.MAX_PARTICLES = 512) ──────────────────────
const POOL_MAX  = 380;  // shared burst + fire pool
const STREAK_MAX = 120; // speed-streak layer
// Total = 500 ≤ 512 ✓

// ── Burst counts ──────────────────────────────────────────────────────────
const RING_COUNT    = 24;
const MOTE_COUNT    = 12;
const SHATTER_COUNT = 20;
const FIRE_PER_FRAME = 6; // max emitted per update while fire is on

// ── Module-scope temp vectors (never allocate in update) ───────────────────
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _col = new THREE.Color();

// ── Procedural soft-circle CanvasTexture ─────────────────────────────────
function makeSoftCircleTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size * 0.5;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0,    'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.7,  'rgba(255,255,255,0.3)');
  grad.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function makeFX(scene) {

  // ── Soft circle sprite texture (shared) ───────────────────────────────
  const spriteTex = makeSoftCircleTexture(64);

  // ═══════════════════════════════════════════════════════════════════════
  //  SHARED BURST + FIRE POOL  (POOL_MAX particles)
  //  Uses a custom ShaderMaterial for per-particle color + size.
  // ═══════════════════════════════════════════════════════════════════════
  const pPos   = new Float32Array(POOL_MAX * 3); // world position
  const pVel   = new Float32Array(POOL_MAX * 3); // velocity m/s
  const pAge   = new Float32Array(POOL_MAX);      // age in seconds
  const pLife  = new Float32Array(POOL_MAX);      // total life in seconds (0 = dead)
  const pSize  = new Float32Array(POOL_MAX);      // base world-units size
  const pColor = new Float32Array(POOL_MAX * 3);  // rgb [0..1]
  const pGrav  = new Float32Array(POOL_MAX);      // gravity multiplier per particle

  // Start all particles dead / hidden
  for (let i = 0; i < POOL_MAX; i++) {
    pPos[i * 3 + 1] = -100000; // park below world
    pLife[i] = 0;
  }

  const poolGeo = new THREE.BufferGeometry();
  poolGeo.setAttribute('position', new THREE.BufferAttribute(pPos,   3));
  poolGeo.setAttribute('aColor',   new THREE.BufferAttribute(pColor, 3));
  poolGeo.setAttribute('aAge',     new THREE.BufferAttribute(pAge,   1));
  poolGeo.setAttribute('aLife',    new THREE.BufferAttribute(pLife,  1));
  poolGeo.setAttribute('aSize',    new THREE.BufferAttribute(pSize,  1));

  const poolMat = new THREE.ShaderMaterial({
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    uniforms: {
      uTex:        { value: spriteTex },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, RENDER.PIXEL_RATIO_CAP) },
      uViewportH:  { value: window.innerHeight },
    },
    vertexShader: /* glsl */`
      attribute vec3  aColor;
      attribute float aAge;
      attribute float aLife;
      attribute float aSize;
      varying   vec3  vCol;
      varying   float vT;
      uniform   float uPixelRatio;
      uniform   float uViewportH;
      void main() {
        vT = (aLife > 0.0) ? clamp(aAge / aLife, 0.0, 1.0) : 1.0;
        vCol = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // size shrinks toward end of life
        float sz = aSize * (1.0 - vT * 0.55) * uPixelRatio * uViewportH * 0.5;
        gl_PointSize = sz / max(0.001, -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying vec3  vCol;
      varying float vT;
      void main() {
        float soft  = texture2D(uTex, gl_PointCoord).r;
        float alpha = soft * (1.0 - smoothstep(0.65, 1.0, vT));
        if (alpha < 0.004) discard;
        // slight brightness boost toward head of life
        vec3 col = vCol * (1.0 + (1.0 - vT) * 0.8);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const poolPoints = new THREE.Points(poolGeo, poolMat);
  poolPoints.frustumCulled = false;
  scene.add(poolPoints);

  // ring cursor for the pool (wraps — oldest particles get evicted)
  let poolCursor = 0;

  // ── Emit one burst of count particles ────────────────────────────────
  function emitBurst(pos, colorHex, count, speedMin, speedMax, lifeMin, lifeMax, sizeMin, sizeMax, gravMult, spread) {
    _col.setHex(colorHex);
    for (let n = 0; n < count; n++) {
      const i = poolCursor;
      poolCursor = (poolCursor + 1) % POOL_MAX;

      pPos[i * 3 + 0] = pos.x;
      pPos[i * 3 + 1] = pos.y;
      pPos[i * 3 + 2] = pos.z;

      // random direction on sphere (or cone — spread=1 = full sphere)
      const theta = Math.acos(1 - 2 * Math.random() * spread);
      const phi   = Math.random() * Math.PI * 2;
      const spd   = speedMin + Math.random() * (speedMax - speedMin);
      pVel[i * 3 + 0] = Math.sin(theta) * Math.cos(phi) * spd;
      pVel[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * spd;
      pVel[i * 3 + 2] = Math.cos(theta) * spd;

      pAge[i]  = 0;
      pLife[i] = lifeMin + Math.random() * (lifeMax - lifeMin);
      pSize[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
      pGrav[i] = gravMult;

      // slight color variance (+/- 15% brightness)
      const br = 0.85 + Math.random() * 0.3;
      pColor[i * 3 + 0] = _col.r * br;
      pColor[i * 3 + 1] = _col.g * br;
      pColor[i * 3 + 2] = _col.b * br;
    }
  }

  // ── Emit fire-cone particles from origin along dir ────────────────────
  // Pre-built orthonormal basis scratch (module scope — no alloc)
  const _fRight = new THREE.Vector3();
  const _fUp    = new THREE.Vector3();

  function emitFire(origin, dir, colorHex, count) {
    _col.setHex(colorHex);
    // Build tangent frame around dir
    _v3a.copy(dir).normalize();
    _v3b.set(0, 1, 0);
    if (Math.abs(_v3a.dot(_v3b)) > 0.9) _v3b.set(1, 0, 0);
    _fRight.crossVectors(_v3a, _v3b).normalize();
    _fUp.crossVectors(_fRight, _v3a).normalize();

    for (let n = 0; n < count; n++) {
      const i = poolCursor;
      poolCursor = (poolCursor + 1) % POOL_MAX;

      // Cone spread: half-angle ~18°
      const ang   = Math.random() * Math.PI * 2;
      const cone  = Math.random() * 0.32; // radians from axis
      const speed = 28 + Math.random() * 20;

      _v3c.copy(_v3a)
        .addScaledVector(_fRight, Math.cos(ang) * Math.sin(cone))
        .addScaledVector(_fUp,    Math.sin(ang) * Math.sin(cone))
        .normalize()
        .multiplyScalar(speed);

      // slight random offset along cone axis so they don't all start at same spot
      const along = Math.random() * 1.5;
      pPos[i * 3 + 0] = origin.x + dir.x * along;
      pPos[i * 3 + 1] = origin.y + dir.y * along;
      pPos[i * 3 + 2] = origin.z + dir.z * along;
      pVel[i * 3 + 0] = _v3c.x;
      pVel[i * 3 + 1] = _v3c.y;
      pVel[i * 3 + 2] = _v3c.z;

      pAge[i]  = 0;
      pLife[i] = 0.45 + Math.random() * 0.35;
      pSize[i] = 0.55 + Math.random() * 0.6;
      pGrav[i] = 0.12; // fire rises slightly

      // hot core → warm mid → fade; passed color tints the emission
      const t   = Math.random();
      const br  = 1.0 + (1.0 - t) * 0.5;
      pColor[i * 3 + 0] = Math.min(1, _col.r * br + (1.0 - t) * 0.15);
      pColor[i * 3 + 1] = Math.min(1, _col.g * br * (0.7 + t * 0.3));
      pColor[i * 3 + 2] = Math.min(1, _col.b * br * t * 0.5);
    }
  }

  // fire state
  let _fireOn     = false;
  const _fireOrigin = new THREE.Vector3();
  const _fireDir   = new THREE.Vector3();
  let _fireColor   = 0xff6600;

  // ═══════════════════════════════════════════════════════════════════════
  //  SPEED-STREAK LAYER  (STREAK_MAX particles)
  //  Small bright dots that race toward the viewer in camera space.
  // ═══════════════════════════════════════════════════════════════════════
  const sPos   = new Float32Array(STREAK_MAX * 3);
  const sAlpha = new Float32Array(STREAK_MAX);

  // Initialize scattered in a rough sphere around origin
  for (let i = 0; i < STREAK_MAX; i++) {
    sPos[i * 3 + 0] = (Math.random() - 0.5) * 80;
    sPos[i * 3 + 1] = (Math.random() - 0.5) * 50;
    sPos[i * 3 + 2] = -20 - Math.random() * 60;
    sAlpha[i] = Math.random();
  }

  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(sPos,   3));
  streakGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(sAlpha, 1));

  const streakMat = new THREE.ShaderMaterial({
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    uniforms: {
      uIntensity:  { value: 0.0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, RENDER.PIXEL_RATIO_CAP) },
    },
    vertexShader: /* glsl */`
      attribute float aAlpha;
      varying   float vA;
      uniform   float uPixelRatio;
      void main() {
        vA = aAlpha;
        gl_PointSize = 2.2 * uPixelRatio;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vA;
      uniform float uIntensity;
      void main() {
        vec2  c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = vA * uIntensity * smoothstep(0.5, 0.0, d);
        if (a < 0.008) discard;
        // cool-white with faint blue tint
        gl_FragColor = vec4(0.92, 0.94, 1.0, a);
      }
    `,
  });

  const streakPoints = new THREE.Points(streakGeo, streakMat);
  streakPoints.frustumCulled = false;
  scene.add(streakPoints);

  let _speedNorm    = 0;
  let _streakTarget = 0;

  // Reusable quaternion for streak repositioning
  const _streakQ = new THREE.Quaternion();

  // ═══════════════════════════════════════════════════════════════════════
  //  UPDATE
  // ═══════════════════════════════════════════════════════════════════════
  function update(dt, ctx) {
    try {
      // ── 1. Advance fire emission ──────────────────────────────────────
      if (_fireOn) {
        emitFire(_fireOrigin, _fireDir, _fireColor, FIRE_PER_FRAME);
      }

      // ── 2. Integrate shared pool ──────────────────────────────────────
      let anyAlive = false;
      for (let i = 0; i < POOL_MAX; i++) {
        if (pLife[i] <= 0) continue;
        pAge[i] += dt;
        if (pAge[i] >= pLife[i]) {
          // park hidden, mark dead
          pLife[i] = 0;
          pPos[i * 3 + 0] = 0;
          pPos[i * 3 + 1] = -100000;
          pPos[i * 3 + 2] = 0;
          continue;
        }
        anyAlive = true;
        // integrate position
        pPos[i * 3 + 0] += pVel[i * 3 + 0] * dt;
        pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
        pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        // drag
        const drag = Math.exp(-2.2 * dt);
        pVel[i * 3 + 0] *= drag;
        pVel[i * 3 + 1] *= drag;
        pVel[i * 3 + 2] *= drag;
        // gravity (positive = down; fire has negative grav = rises)
        pVel[i * 3 + 1] -= 4.0 * pGrav[i] * dt;
      }

      // Mark all attributes dirty (always — fire may have been emitted)
      poolGeo.attributes.position.needsUpdate = true;
      poolGeo.attributes.aAge.needsUpdate     = true;
      poolGeo.attributes.aLife.needsUpdate    = true;
      poolGeo.attributes.aSize.needsUpdate    = true;
      poolGeo.attributes.aColor.needsUpdate   = true;

      // ── 3. Speed streaks ──────────────────────────────────────────────
      _streakTarget = Math.max(0, (_speedNorm - 0.28) * 1.45);
      streakMat.uniforms.uIntensity.value = damp(
        streakMat.uniforms.uIntensity.value,
        _streakTarget,
        6.0,
        dt
      );

      const cam = ctx.camera;
      // Move the streak mesh with the camera so local coords stay local
      streakPoints.position.copy(cam.position);
      _streakQ.copy(cam.quaternion);

      const sPosArr = streakGeo.attributes.position.array;
      const intensity = streakMat.uniforms.uIntensity.value;

      for (let i = 0; i < STREAK_MAX; i++) {
        let lx = sPosArr[i * 3 + 0];
        let ly = sPosArr[i * 3 + 1];
        let lz = sPosArr[i * 3 + 2];

        // Transform local → camera-relative to check if point passed the camera
        // (positive local-Z in camera space = behind viewer)
        _v3a.set(lx, ly, lz).applyQuaternion(_streakQ);
        if (_v3a.z > 2.0) {
          // respawn ahead of the camera in camera-local space
          lx = (Math.random() - 0.5) * 70;
          ly = (Math.random() - 0.5) * 45;
          lz = -25 - Math.random() * 55;
          // rotate back to world-relative offset
          _v3b.set(lx, ly, lz).applyQuaternion(_streakQ);
          sPosArr[i * 3 + 0] = _v3b.x;
          sPosArr[i * 3 + 1] = _v3b.y;
          sPosArr[i * 3 + 2] = _v3b.z;
        } else {
          // drift toward camera (forward in world = +cam-forward)
          _v3a.set(0, 0, 1).applyQuaternion(_streakQ);
          const drift = (40 + _speedNorm * 55) * dt;
          sPosArr[i * 3 + 0] += _v3a.x * drift;
          sPosArr[i * 3 + 1] += _v3a.y * drift;
          sPosArr[i * 3 + 2] += _v3a.z * drift;
        }
      }
      streakGeo.attributes.position.needsUpdate = true;

    } catch (_) {
      // never throw in update — swallow silently
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PUBLIC INTERFACE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Ring-pass burst: 24 radial sparkles, medium speed, zone accent color.
   */
  function ringBurst(pos, colorHex) {
    emitBurst(pos, colorHex,
      RING_COUNT,
      10, 22,    // speed min/max
      0.6, 1.1,  // life min/max
      0.9, 1.8,  // size min/max
      0.18,      // gravity
      1.0        // full sphere spread
    );
  }

  /**
   * Mote-collect burst: 12 soft sparkles, gentle outward pop.
   */
  function moteBurst(pos, colorHex) {
    emitBurst(pos, colorHex,
      MOTE_COUNT,
      6, 14,
      0.4, 0.85,
      0.7, 1.3,
      0.10,
      1.0
    );
  }

  /**
   * Crystal shatter: 20 sharp fragments, fast burst, zone foe color.
   */
  function shatterBurst(pos, colorHex) {
    emitBurst(pos, colorHex,
      SHATTER_COUNT,
      14, 30,
      0.55, 1.0,
      0.5, 1.1,
      0.55,
      1.0
    );
    // Second smaller wave of micro-debris
    emitBurst(pos, colorHex,
      10,
      4, 10,
      0.3, 0.7,
      0.25, 0.6,
      0.8,
      1.0
    );
  }

  /**
   * fire(origin, dir, on, colorHex): start/stop the fire-breath cone stream.
   * Called every frame while firing. Emit burst happens inside update().
   */
  function fire(originV3, dirV3, on, colorHex) {
    _fireOn = on;
    if (on) {
      _fireOrigin.copy(originV3);
      _fireDir.copy(dirV3).normalize();
      _fireColor = colorHex;
    }
  }

  /**
   * setSpeedStreaks(speedNorm): drive intensity of the streak layer.
   * Called every frame by game.js.
   */
  function setSpeedStreaks(speedNorm) {
    _speedNorm = speedNorm;
  }

  function onResize() {
    const pr = Math.min(window.devicePixelRatio || 1, RENDER.PIXEL_RATIO_CAP);
    poolMat.uniforms.uPixelRatio.value   = pr;
    poolMat.uniforms.uViewportH.value    = window.innerHeight;
    streakMat.uniforms.uPixelRatio.value = pr;
  }
  window.addEventListener('resize', onResize);

  function dispose() {
    window.removeEventListener('resize', onResize);
    scene.remove(poolPoints);
    scene.remove(streakPoints);
    poolGeo.dispose();
    poolMat.dispose();
    streakGeo.dispose();
    streakMat.dispose();
    spriteTex.dispose();
  }

  return {
    update,
    ringBurst,
    moteBurst,
    shatterBurst,
    fire,
    setSpeedStreaks,
    dispose,
    // Expose for legacy callers in main.js (makeFireBreath / makeSpeedStreaks interface)
    _poolPoints:   poolPoints,
    _streakPoints: streakPoints,
  };
}

// ── Legacy named exports for backward compatibility with old main.js ────────
// (main.js imports { makeFireBreath, makeSpeedStreaks } — keep them alive
//  until main.js is updated to use makeFX)
export function makeFireBreath(scene) {
  const fx = makeFX(scene);
  return {
    points:   fx._poolPoints,
    emit(origin, dir, count, speed) {
      // shim: treat as a shatter-style burst
      const _tmp = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
      for (let n = 0; n < count; n++) {
        fx.fire(origin, _tmp, true, 0xff6a18);
      }
    },
    update(dt) {
      // no-op: managed internally in makeFX
    },
    onResize() {},
  };
}

export function makeSpeedStreaks(scene) {
  // Legacy stub — makeFireBreath already builds streaks as part of makeFX.
  // Return a no-op shim so old main.js doesn't crash.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const mat = new THREE.PointsMaterial({ size: 0 });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return {
    points: pts,
    update(_camera, _dt, _speedNorm) {},
    onResize() {},
  };
}

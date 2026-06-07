// ════════════════════════════════════════════════════════════════════════
//  sky.js — Full atmosphere: dome, fog, sun, stars, aurora, god-rays, clouds
//  Factory: makeSky(scene) → { update(dt, ctx), dispose() }
//  Hard rules: no postprocessing, no extra lights, no per-frame allocs,
//  only 'three' + './constants.js' deps.  All textures are CanvasTexture.
// ════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { ZONES, RENDER, damp, lerp, clamp } from './constants.js';

// ── Module-scope temp objects (never allocate inside update) ─────────────
const _tmpColor   = new THREE.Color();
const _tmpColorB  = new THREE.Color();
const _tmpVec3    = new THREE.Vector3();
const _tmpVec3B   = new THREE.Vector3();

// ── Helpers ──────────────────────────────────────────────────────────────
function hexToColor(hex) { return new THREE.Color(hex); }

function lerpColor(a, b, t, out) {
  out.setRGB(
    lerp(a.r, b.r, t),
    lerp(a.g, b.g, t),
    lerp(a.b, b.b, t),
  );
  return out;
}

// Build a radial soft-glow CanvasTexture (white centre, transparent edge)
function makeRadialSprite(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5,  'rgba(255,255,255,0.25)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// Build a soft cloud patch CanvasTexture
function makeCloudTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Layered elliptical soft blobs
  function blob(x, y, rx, ry, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0,   `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.4})`);
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.save();
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width * (Math.max(rx, ry) / rx), c.height * (Math.max(rx, ry) / ry));
    ctx.restore();
  }
  // Simple: just do radial from centre with some noisy bias
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0,    'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.7,  'rgba(255,255,255,0.06)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.ellipse(size/2, size/2, size*0.48, size*0.28, 0, 0, Math.PI*2);
  ctx.fill();
  // second lobe
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(size*0.38, size*0.52, size*0.32, size*0.2, -0.3, 0, Math.PI*2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

// ── Sky dome shader ──────────────────────────────────────────────────────
// Vertical gradient: zenith (top) → horizon. Driven by uniforms updated each frame.
const SKY_VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform float uRadius;
  varying vec3 vWorldPos;

  void main() {
    // Normalize y from -1..1. We want 0 at equator, 1 at zenith, -1 nadir.
    float t = clamp(vWorldPos.y / uRadius, -1.0, 1.0);
    // Bias: pull gradient so horizon colour is rich even at slight angles
    float g = pow(clamp(t * 0.5 + 0.5, 0.0, 1.0), 0.55);
    vec3 col = mix(uHorizon, uTop, g);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── Aurora curtain shader ────────────────────────────────────────────────
const AURORA_VERT = /* glsl */`
  uniform float uTime;
  uniform float uAmp;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    // Wave undulation — cheap sin stack, no per-frame alloc
    float wave = sin(pos.y * 0.018 + uTime * 0.7) * uAmp
               + sin(pos.y * 0.034 + uTime * 1.1 + 1.57) * uAmp * 0.4;
    pos.x += wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const AURORA_FRAG = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    // Vertical fade: bright in middle, fade at top/bottom
    float fade = sin(vUv.y * 3.14159);
    // Horizontal shimmer
    float shimmer = 0.7 + 0.3 * sin(vUv.x * 6.28 + uTime * 1.3);
    // Three-colour band: blend A→B→C across x
    vec3 col;
    if (vUv.x < 0.5) {
      col = mix(uColorA, uColorB, vUv.x * 2.0);
    } else {
      col = mix(uColorB, uColorC, (vUv.x - 0.5) * 2.0);
    }
    float alpha = fade * shimmer * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ── God-ray cone shader ──────────────────────────────────────────────────
const GODRAY_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GODRAY_FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    // Fade along shaft length (v=0 at apex, v=1 at base) and across width
    float axial = 1.0 - vUv.y;           // brightest at origin
    float radial = 1.0 - abs(vUv.x - 0.5) * 2.0; // bright at centre line
    float a = axial * radial * radial * uOpacity;
    gl_FragColor = vec4(1.0, 1.0, 0.9, a);
  }
`;

// ════════════════════════════════════════════════════════════════════════
export function makeSky(scene) {

  // ── Zone color caches (avoid per-frame object creation) ──────────────
  const zoneTopColors      = ZONES.map(z => hexToColor(z.skyTop));
  const zoneHorizonColors  = ZONES.map(z => hexToColor(z.skyHorizon));
  const zoneFogColors      = ZONES.map(z => hexToColor(z.fog));
  const zoneSunColors      = ZONES.map(z => hexToColor(z.sun));

  // Pre-parsed sunDir vectors
  const zoneSunDirs = ZONES.map(z => new THREE.Vector3(...z.sunDir).normalize());

  // Working color objects updated each frame
  const curTop     = new THREE.Color();
  const curHorizon = new THREE.Color();
  const curFog     = new THREE.Color();
  const curSun     = new THREE.Color();
  const curSunDir  = new THREE.Vector3();

  // ── Sky dome ─────────────────────────────────────────────────────────
  const DOME_RADIUS = RENDER.FAR * 0.92;
  const domeMat = new THREE.ShaderMaterial({
    vertexShader:   SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTop:     { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uRadius:  { value: DOME_RADIUS },
    },
    side:        THREE.BackSide,
    depthWrite:  false,
    depthTest:   false,
  });
  const domeGeo  = new THREE.SphereGeometry(DOME_RADIUS, 24, 14);
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.renderOrder = -100;
  scene.add(domeMesh);

  // No background colour needed — dome covers everything
  scene.background = null;

  // ── Fog ──────────────────────────────────────────────────────────────
  scene.fog = new THREE.Fog(ZONES[0].fog, ZONES[0].fogNear, ZONES[0].fogFar);

  // ── Sun sprite ───────────────────────────────────────────────────────
  const sunTex  = makeRadialSprite(256);
  const sunMat  = new THREE.SpriteMaterial({
    map:              sunTex,
    color:            new THREE.Color(ZONES[0].sun),
    blending:         THREE.AdditiveBlending,
    depthWrite:       false,
    transparent:      true,
    opacity:          1.0,
    sizeAttenuation:  false,
  });
  // Second wider halo layer
  const sunHaloMat = new THREE.SpriteMaterial({
    map:              sunTex,
    color:            new THREE.Color(ZONES[0].sun),
    blending:         THREE.AdditiveBlending,
    depthWrite:       false,
    transparent:      true,
    opacity:          0.35,
    sizeAttenuation:  false,
  });
  const sunSprite  = new THREE.Sprite(sunMat);
  const sunHalo    = new THREE.Sprite(sunHaloMat);
  sunSprite.scale.set(0.09, 0.09, 1);
  sunHalo.scale.set(0.22, 0.22, 1);
  scene.add(sunSprite);
  scene.add(sunHalo);

  // ── Starfield ────────────────────────────────────────────────────────
  const STAR_COUNT = 600;
  const starPositions = new Float32Array(STAR_COUNT * 3);
  // Distribute on a sphere (upper hemisphere + some below)
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = DOME_RADIUS * 0.88;
    starPositions[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i*3+1] = r * Math.cos(phi);
    starPositions[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color:       0xffffff,
    size:        2.8,
    sizeAttenuation: false,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    transparent: true,
    opacity:     0.0,
  });
  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.renderOrder = -99;
  scene.add(starPoints);

  // ── Aurora curtains (zone 2 only) ────────────────────────────────────
  const AURORA_COLORS_DEFAULT = [0x00ffe0, 0xff6eb4, 0x7b2fff];
  const NUM_CURTAINS = 4;
  const auroraMeshes   = [];
  const auroraMats     = [];
  const auroraOffsets  = [];  // static x-offset and angle around dome

  for (let ci = 0; ci < NUM_CURTAINS; ci++) {
    // Tall plane: width ~300, height ~600
    const aGeo = new THREE.PlaneGeometry(280, 580, 8, 24);
    // Pick aurora colors — may come from zone data
    const colsHex  = ZONES[2].auroraColors || AURORA_COLORS_DEFAULT;
    const aMat = new THREE.ShaderMaterial({
      vertexShader:   AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      uniforms: {
        uTime:    { value: 0 },
        uAmp:     { value: 12 + Math.random() * 8 },
        uColorA:  { value: hexToColor(colsHex[0]) },
        uColorB:  { value: hexToColor(colsHex[1]) },
        uColorC:  { value: hexToColor(colsHex[2 % colsHex.length]) },
        uOpacity: { value: 0.0 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });
    const aMesh = new THREE.Mesh(aGeo, aMat);
    // Spread curtains around the ring, slightly varied altitudes
    const angle = (ci / NUM_CURTAINS) * Math.PI * 2;
    const dist  = DOME_RADIUS * 0.65;
    aMesh.position.set(
      Math.sin(angle) * dist,
      100 + ci * 30,
      Math.cos(angle) * dist,
    );
    aMesh.rotation.y = -angle;
    aMesh.renderOrder = -50;
    auroraMeshes.push(aMesh);
    auroraMats.push(aMat);
    auroraOffsets.push({ angle, dist, phaseOffset: ci * 1.3 });
    scene.add(aMesh);
  }

  // ── God-ray shafts (zones 0/1) ───────────────────────────────────────
  const NUM_GODRAYS = 4;
  const godrayMeshes = [];
  const godrayMats   = [];

  for (let gi = 0; gi < NUM_GODRAYS; gi++) {
    // Thin elongated plane as a shaft
    const gGeo = new THREE.PlaneGeometry(10, 380, 1, 1);
    const gMat = new THREE.ShaderMaterial({
      vertexShader:   GODRAY_VERT,
      fragmentShader: GODRAY_FRAG,
      uniforms: {
        uOpacity: { value: 0.06 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });
    const gMesh = new THREE.Mesh(gGeo, gMat);
    gMesh.renderOrder = -60;
    godrayMeshes.push(gMesh);
    godrayMats.push(gMat);
    scene.add(gMesh);
  }

  // ── Drifting cloud planes ─────────────────────────────────────────────
  const NUM_CLOUDS = 6;
  const cloudTex  = makeCloudTexture(256);
  const cloudMeshes = [];
  // Cloud state: position offset from camera + drift phase
  const cloudState  = [];

  for (let k = 0; k < NUM_CLOUDS; k++) {
    const cGeo = new THREE.PlaneGeometry(280, 140, 1, 1);
    const cMat = new THREE.MeshBasicMaterial({
      map:         cloudTex,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      transparent: true,
      opacity:     0.0,          // set per frame based on zone
      color:       new THREE.Color(0xffffff),
      side:        THREE.DoubleSide,
    });
    const cMesh = new THREE.Mesh(cGeo, cMat);
    cMesh.renderOrder = -70;
    cloudMeshes.push(cMesh);
    // Spread them around + stagger altitude
    cloudState.push({
      offsetX:    (Math.random() - 0.5) * 600,
      offsetY:    -20 + Math.random() * 120,
      offsetZ:    -100 - Math.random() * 400,
      driftSpeed: 2 + Math.random() * 4,   // m/s lateral drift
      driftPhase: Math.random() * Math.PI * 2,
      mat:        cMat,
    });
    scene.add(cMesh);
  }

  // ── Internal smoothed state ──────────────────────────────────────────
  let _starOpacity   = 0;
  let _auroraOpacity = 0;
  let _godrayOpacity = 0.06;
  let _cloudOpacity  = 0.28;
  let _time          = 0;

  // Pre-parsed aurora colors per zone index (zone 2 owns the real values)
  const auroraColsHex = ZONES[2].auroraColors || AURORA_COLORS_DEFAULT;

  // ── update ────────────────────────────────────────────────────────────
  function update(dt, ctx) {
    _time += dt;
    const t   = ctx.time;
    const zi  = ctx.zone.index;
    const zb  = ctx.zone.blend;        // 0..1 progress within zone → next zone
    const zd  = ctx.zone.data;
    const zn  = ctx.zone.next;
    const cam = ctx.camera;

    // Clamp zi so array lookups are always safe
    const iA = clamp(zi, 0, ZONES.length - 1);
    const iB = clamp(zi + 1, 0, ZONES.length - 1);

    // ── Zone-lerped colors ────────────────────────────────────────────
    lerpColor(zoneTopColors[iA],     zoneTopColors[iB],     zb, curTop);
    lerpColor(zoneHorizonColors[iA], zoneHorizonColors[iB], zb, curHorizon);
    lerpColor(zoneFogColors[iA],     zoneFogColors[iB],     zb, curFog);
    lerpColor(zoneSunColors[iA],     zoneSunColors[iB],     zb, curSun);
    _tmpVec3.lerpVectors(zoneSunDirs[iA], zoneSunDirs[iB], zb).normalize();
    curSunDir.copy(_tmpVec3);

    const fogNear = lerp(zd.fogNear, zn.fogNear, zb);
    const fogFar  = lerp(zd.fogFar,  zn.fogFar,  zb);

    // ── Dome ──────────────────────────────────────────────────────────
    domeMat.uniforms.uTop.value.copy(curTop);
    domeMat.uniforms.uHorizon.value.copy(curHorizon);
    domeMesh.position.copy(cam.position);

    // ── Fog ───────────────────────────────────────────────────────────
    scene.fog.color.copy(curFog);
    scene.fog.near = fogNear;
    scene.fog.far  = fogFar;

    // ── Sun ───────────────────────────────────────────────────────────
    // Zone 2 (aurora) fades sun; zones 0/1 keep it bright
    const sunVisible = zi < 2 ? 1.0 : clamp(1.0 - zb * 2.0, 0, 1);
    // Place sun far away along sun direction from camera
    _tmpVec3B.copy(curSunDir).multiplyScalar(DOME_RADIUS * 0.82).add(cam.position);
    sunSprite.position.copy(_tmpVec3B);
    sunHalo.position.copy(_tmpVec3B);
    sunMat.color.copy(curSun);
    sunMat.opacity = sunVisible;
    sunHaloMat.color.copy(curSun);
    sunHaloMat.opacity = sunVisible * 0.35;

    // Subtle pulse on sun halo
    const pulse = 0.96 + 0.04 * Math.sin(t * 1.4);
    sunSprite.scale.set(0.09 * pulse, 0.09 * pulse, 1);
    sunHalo.scale.set(0.22 * pulse, 0.22 * pulse, 1);

    // ── Starfield ─────────────────────────────────────────────────────
    // Fade stars in during zone 2 approach (zone blend when zi=1 → 2, or zi=2)
    let targetStarOpacity = 0;
    if (zi === 1) targetStarOpacity = zb * 0.7;
    else if (zi === 2) targetStarOpacity = 0.7 + zb * 0.3;
    _starOpacity = damp(_starOpacity, targetStarOpacity, 3.0, dt);
    starMat.opacity = _starOpacity;
    // Stars follow camera (they're on the dome sphere — just translate with cam)
    starPoints.position.copy(cam.position);

    // ── Aurora curtains ───────────────────────────────────────────────
    const targetAurora = zi === 2 ? 0.3 : (zi === 1 ? zb * 0.15 : 0.0);
    _auroraOpacity = damp(_auroraOpacity, targetAurora, 2.5, dt);

    for (let ci = 0; ci < NUM_CURTAINS; ci++) {
      const aMat  = auroraMats[ci];
      const ao    = auroraOffsets[ci];
      const aMesh = auroraMeshes[ci];

      aMat.uniforms.uTime.value    = t + ao.phaseOffset;
      aMat.uniforms.uOpacity.value = _auroraOpacity;

      // Reposition curtains to always surround the camera
      const angle = ao.angle;
      const dist  = ao.dist;
      aMesh.position.set(
        cam.position.x + Math.sin(angle) * dist,
        cam.position.y + 80 + ci * 25,
        cam.position.z + Math.cos(angle) * dist,
      );
      aMesh.rotation.y = -angle;
    }

    // ── God-rays ──────────────────────────────────────────────────────
    // Visible in zones 0 and 1; fade out in zone 2
    const targetGodray = zi < 2 ? 0.06 : clamp(0.06 * (1.0 - zb * 2.0), 0, 0.06);
    _godrayOpacity = damp(_godrayOpacity, targetGodray, 3.0, dt);

    for (let gi = 0; gi < NUM_GODRAYS; gi++) {
      const gMat  = godrayMats[gi];
      const gMesh = godrayMeshes[gi];

      gMat.uniforms.uOpacity.value = _godrayOpacity;

      // Fan out from sun direction with slight angular spread
      const spreadAngle = (gi / NUM_GODRAYS) * Math.PI * 0.18 - 0.09;
      _tmpVec3.copy(curSunDir);
      // Rotate spread around camera up
      const cosA = Math.cos(spreadAngle + gi * 0.12);
      const sinA = Math.sin(spreadAngle + gi * 0.12);
      const tx = _tmpVec3.x * cosA - _tmpVec3.z * sinA;
      const tz = _tmpVec3.x * sinA + _tmpVec3.z * cosA;
      _tmpVec3.set(tx, _tmpVec3.y, tz);

      // Shaft midpoint: halfway between camera and far point along spread dir
      _tmpVec3B.copy(_tmpVec3).multiplyScalar(200).add(cam.position);
      gMesh.position.copy(_tmpVec3B);
      // Orient shaft: look along sun dir, then tilt
      gMesh.lookAt(
        cam.position.x + _tmpVec3.x * 400,
        cam.position.y + _tmpVec3.y * 400,
        cam.position.z + _tmpVec3.z * 400,
      );
    }

    // ── Cloud planes ─────────────────────────────────────────────────
    // Clouds are visible zones 0/1; subtle in zone 2
    let targetCloudOpacity = 0.28;
    if (zi === 2) targetCloudOpacity = 0.28 * clamp(1.0 - zb * 1.5, 0, 1);
    _cloudOpacity = damp(_cloudOpacity, targetCloudOpacity, 2.0, dt);

    for (let k = 0; k < NUM_CLOUDS; k++) {
      const cs    = cloudState[k];
      const cMesh = cloudMeshes[k];

      // Drift: slowly move offsetX over time
      cs.offsetX += Math.sin(cs.driftPhase + t * 0.08) * cs.driftSpeed * dt;

      // Reposition relative to camera so they never run out
      const wx = cam.position.x + cs.offsetX;
      const wy = cam.position.y + cs.offsetY;
      const wz = cam.position.z + cs.offsetZ;
      cMesh.position.set(wx, wy, wz);

      // Wrap horizontally: if too far left/right, wrap around
      if (Math.abs(cs.offsetX) > 650) cs.offsetX *= -0.5;

      // Tint clouds by zone horizon colour (warm / cool / dark)
      cs.mat.color.copy(curHorizon).lerp(_tmpColor.setRGB(1, 1, 1), 0.35);
      cs.mat.opacity = _cloudOpacity;

      // Face camera: billboard rotation (flat horizontal rotation only)
      cMesh.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  // ── dispose ───────────────────────────────────────────────────────────
  function dispose() {
    scene.remove(domeMesh);
    scene.remove(sunSprite);
    scene.remove(sunHalo);
    scene.remove(starPoints);
    domeGeo.dispose();
    domeMat.dispose();
    sunTex.dispose();
    sunMat.dispose();
    sunHaloMat.dispose();
    starGeo.dispose();
    starMat.dispose();
    cloudTex.dispose();
    for (const m of cloudMeshes) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    for (let ci = 0; ci < NUM_CURTAINS; ci++) {
      scene.remove(auroraMeshes[ci]);
      auroraMeshes[ci].geometry.dispose();
      auroraMats[ci].dispose();
    }
    for (let gi = 0; gi < NUM_GODRAYS; gi++) {
      scene.remove(godrayMeshes[gi]);
      godrayMeshes[gi].geometry.dispose();
      godrayMats[gi].dispose();
    }
    scene.fog = null;
  }

  return { update, dispose };
}

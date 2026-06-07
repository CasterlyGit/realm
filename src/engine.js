// ════════════════════════════════════════════════════════════════════════
//  engine.js — renderer + scene + camera + the thermal-safe render loop.
//  Caps FPS with a rAF accumulator, stops the loop when hidden/paused (zero
//  GPU when idle), holds the only two lights, manages quality / cool mode.
// ════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { RENDER } from './constants.js';

export function makeEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // MSAA is pure fill-rate cost; skip it
    powerPreference: 'default',// don't force the discrete GPU on dual-GPU Macs
    stencil: false,
    alpha: false,
    depth: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.PIXEL_RATIO_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;                 // biggest single GPU save
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // in-shader grade, no post pass
  renderer.toneMappingExposure = RENDER.EXPOSURE_BASE;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    RENDER.FOV_BASE,
    window.innerWidth / window.innerHeight,
    0.5,
    RENDER.FAR
  );
  camera.position.set(0, 124, 18);

  // The ONLY two lights in the whole game (per thermal budget).
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(0.4, 0.8, 0.5);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.6);
  scene.add(hemi);

  // ── quality / cool mode ──
  const QUALITY = {
    cinematic: { pr: RENDER.PIXEL_RATIO_CAP, fps: RENDER.FPS_DEFAULT },
    balanced:  { pr: 1.25,                   fps: RENDER.FPS_DEFAULT },
    cool:      { pr: 1.0,                     fps: RENDER.FPS_COOL    },
  };
  let quality = 'balanced';
  let forceCool = false;
  let targetFps = QUALITY.balanced.fps;

  function applyQuality() {
    const q = QUALITY[quality] || QUALITY.balanced;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pr));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    targetFps = forceCool ? RENDER.FPS_COOL : q.fps;
  }
  function setQuality(q) { if (QUALITY[q]) { quality = q; applyQuality(); } return quality; }
  function cycleQuality() {
    const order = ['cinematic', 'balanced', 'cool'];
    quality = order[(order.indexOf(quality) + 1) % order.length];
    applyQuality();
    return quality;
  }
  function setCool(on) { forceCool = !!on; applyQuality(); return forceCool; }

  // ── loop with FPS cap + pause ──
  const frameCbs = [];
  function onFrame(cb) { frameCbs.push(cb); }

  let running = false;
  let hidden = false;
  let menu = false;
  let last = 0;
  let acc = 0;
  let elapsed = 0;
  const visCbs = [];
  function onVisibility(cb) { visCbs.push(cb); }

  function paused() { return hidden || menu; }
  function targetDelta() { return 1000 / targetFps; }

  function loop(now) {
    if (!running || paused()) return;
    requestAnimationFrame(loop);
    const td = targetDelta();
    const el = now - last;
    last = now;
    acc += Math.min(el, td * 4);          // clamp to avoid spiral-of-death
    if (acc < td) return;                 // skip this rAF tick; browser idles
    acc -= td;
    if (acc > td * 4) acc = 0;
    const dt = td / 1000;                 // constant logical tick
    elapsed += dt;
    for (let i = 0; i < frameCbs.length; i++) frameCbs[i](dt, elapsed);
    renderer.render(scene, camera);
  }

  function kick() {                       // (re)start the rAF chain cleanly
    if (!running || paused()) return;
    last = performance.now();
    acc = 0;
    requestAnimationFrame(loop);
  }
  function start() { if (running) return; running = true; kick(); }
  function stop() { running = false; }

  function setMenuPaused(on) {
    const was = paused();
    menu = !!on;
    if (was && !paused()) kick();
  }

  // visibility / focus — stop the loop entirely when not visible
  document.addEventListener('visibilitychange', () => {
    const was = paused();
    hidden = document.hidden;
    for (const cb of visCbs) cb(!paused());
    if (was && !paused()) kick();
  });
  window.addEventListener('blur', () => {
    const was = paused();
    hidden = true;
    for (const cb of visCbs) cb(false);
    // loop self-stops next tick
    void was;
  });
  window.addEventListener('focus', () => {
    const was = paused();
    hidden = false;
    for (const cb of visCbs) cb(!paused());
    if (was && !paused()) kick();
  });

  // resize
  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  window.addEventListener('resize', resize);

  applyQuality();

  return {
    renderer, scene, camera, sun, hemi,
    onFrame, onVisibility,
    start, stop, setMenuPaused,
    setQuality, cycleQuality, setCool,
    getQuality: () => quality, isCool: () => forceCool,
    resize,
  };
}

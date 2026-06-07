// ════════════════════════════════════════════════════════════════════════
//  game.js — the brain. State machine, energy, scoring/combo, ring-pass &
//  mote-collect detection, fire vs foes, zone morph + lighting, the finale,
//  the Radiant Pulse skill, and all HUD wiring. Owns cross-entity rules;
//  the content modules own only their own visuals/motion.
// ════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { ZONES, FINALE_DIST, ENERGY, SCORE, PLAY, FLIGHT, CAM, clamp, lerp } from './constants.js';

const BEST_KEY = 'realm_best_v2';

export function makeGame(sys) {
  const { engine, sky, world, dragon, flight, fx, rings, foes, motes, audio, input, hud } = sys;
  const { camera, sun, hemi, renderer } = { camera: engine.camera, sun: engine.sun, hemi: engine.hemi, renderer: engine.renderer };

  let state = 'title';     // title | playing | paused | finale | end
  let prevState = 'title';
  let time = 0;

  // run vars
  let energy = ENERGY.START;
  let score = 0;
  let combo = 1;
  let comboTimer = 0;
  let ringsCount = 0;
  let motesCount = 0;
  let lastZone = 0;
  let skillCd = 0;
  let wasFiring = false;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);

  // finale
  let finaleT = 0;
  let finaleGate = null;

  // reusable scratch
  const ctx = {
    time: 0,
    player: flight.player,
    zone: { index: 0, blend: 0, data: ZONES[0], next: ZONES[0] },
    camera,
  };
  const _ctrl = { pitch: 0, yaw: 0, roll: 0, boost: false, fire: false, flap: false };
  const _ca = new THREE.Color();
  const _cb = new THREE.Color();
  const _d = new THREE.Vector3();
  const _radial = new THREE.Vector3();
  const _origin = new THREE.Vector3();
  const _toFoe = new THREE.Vector3();
  const _proj = new THREE.Vector3();

  function blend(out, hexA, hexB, t) { _ca.setHex(hexA); _cb.setHex(hexB); return out.copy(_ca).lerp(_cb, t); }

  function computeZone() {
    const dist = flight.player.dist;
    let zi = 0;
    if (dist >= ZONES[1].distEnd) zi = 2;
    else if (dist >= ZONES[0].distEnd) zi = 1;
    const start = zi === 0 ? 0 : ZONES[zi - 1].distEnd;
    const t = clamp((dist - start) / (ZONES[zi].distEnd - start), 0, 1);
    ctx.zone.index = zi;
    ctx.zone.blend = t;
    ctx.zone.data = ZONES[zi];
    ctx.zone.next = ZONES[Math.min(zi + 1, 2)];
    return ctx.zone;
  }

  function applyLighting() {
    const z = ctx.zone.data, n = ctx.zone.next, t = ctx.zone.blend;
    sun.color.copy(blend(_ca, z.sun, n.sun, t));
    sun.intensity = lerp(z.sunIntensity, n.sunIntensity, t);
    sun.position.set(
      lerp(z.sunDir[0], n.sunDir[0], t),
      lerp(z.sunDir[1], n.sunDir[1], t),
      lerp(z.sunDir[2], n.sunDir[2], t)
    ).normalize();
    blend(hemi.color, z.hemiSky, n.hemiSky, t);
    blend(hemi.groundColor, z.hemiGround, n.hemiGround, t);
    hemi.intensity = lerp(z.hemiIntensity, n.hemiIntensity, t);
    renderer.toneMappingExposure = lerp(z.exposure, n.exposure, t);
  }

  function worldToScreen(v) {
    _proj.copy(v).project(camera);
    return {
      x: (_proj.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_proj.y * 0.5 + 0.5) * window.innerHeight,
      vis: _proj.z < 1,
    };
  }

  // ── transitions ─────────────────────────────────────────────────────
  function toTitle() {
    state = 'title';
    flight.reset({ snapCamera: true });
    rings.reset(); foes.reset(); motes.reset();
    clearFinale();
    lastZone = 0;
    hud.hideEnd(); hud.hidePause();
    hud.showTitle();
    hud.setHandStatus('');
  }

  function startRun() {
    energy = ENERGY.START; score = 0; combo = 1; comboTimer = 0;
    ringsCount = 0; motesCount = 0; lastZone = 0; skillCd = 0;
    finaleT = 0; clearFinale();
    flight.reset({ snapCamera: true });
    rings.reset(); foes.reset(); motes.reset();
    state = 'playing';
    audio.start();
    hud.hideTitle(); hud.hideEnd(); hud.hidePause();
    hud.showHud?.();
    hud.showZoneBanner(ZONES[0].name, ZONES[0].sub);
    hud.setScore(0); hud.setCombo(1);
  }

  function endRun() {
    state = 'end';
    audio.fireOff();
    if (score > best) { best = Math.round(score); localStorage.setItem(BEST_KEY, String(best)); }
    hud.showEnd({
      score: Math.round(score), best: Math.round(best),
      rings: ringsCount, motes: motesCount,
      zone: ZONES[ctx.zone.index].name,
    });
  }

  function togglePause() {
    if (state === 'playing' || state === 'finale') pause();
    else if (state === 'paused') resume();
  }
  function pause() {
    if (state !== 'playing' && state !== 'finale') return;
    prevState = state; state = 'paused';
    engine.setMenuPaused(true);
    hud.showPause();
    audio.suspend();
  }
  function resume() {
    if (state !== 'paused') return;
    state = prevState;
    hud.hidePause();
    engine.setMenuPaused(false);
    audio.resume();
  }

  // ── finale ──────────────────────────────────────────────────────────
  function enterFinale() {
    state = 'finale';
    finaleT = 0;
    audio.finale();
    hud.showZoneBanner('THE AURORA GATE', 'ascend into the light');
    const geo = new THREE.TorusGeometry(120, 6, 10, 48);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ffe0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    finaleGate = new THREE.Mesh(geo, mat);
    engine.scene.add(finaleGate);
  }
  function clearFinale() {
    if (finaleGate) { engine.scene.remove(finaleGate); finaleGate.geometry.dispose(); finaleGate.material.dispose(); finaleGate = null; }
  }
  function updateFinale(dt) {
    finaleT += dt;
    if (finaleGate) {
      // keep the gate looming ahead, growing as the climax nears
      _d.copy(flight.player.pos).addScaledVector(flight.player.forward, 420);
      finaleGate.position.lerp(_d, 1 - Math.exp(-2 * dt));
      finaleGate.lookAt(flight.player.pos);
      const pulse = 1 + Math.sin(time * 3) * 0.04 + Math.min(finaleT / 18, 1) * 0.5;
      finaleGate.scale.setScalar(pulse);
      finaleGate.material.opacity = 0.6 + Math.sin(time * 4) * 0.1;
    }
    // money shot: auto-fire the last stretch
    if (finaleT > 14) {
      dragon.headWorld(_origin);
      fx.fire(_origin, flight.player.forward, true, 0xfff0c0);
      dragon.setFiring(true);
    }
    if (finaleT > 17.5 && finaleGate) {
      // climax flash
      hud.flash(0xffffff, 0.95);
      flight.addTrauma(0.7);
      fx.shatterBurst(finaleGate.position, 0x00ffe0);
      audio.shatter();
    }
    if (finaleT > 19) { fx.fire(_origin, flight.player.forward, false); dragon.setFiring(false); endRun(); }
  }

  // ── skill: Radiant Pulse ────────────────────────────────────────────
  function trySkill() {
    if (skillCd > 0 || energy < 20) return;
    energy -= 20; skillCd = 8;
    flight.addTrauma(CAM.TRAUMA_SHATTER);
    hud.flash(ctx.zone.data.glow, 0.4);
    fx.shatterBurst(flight.player.pos, ctx.zone.data.glow);
    audio.shatter();
    const R2 = 72 * 72;
    for (const f of foes.list) {
      if (!f.active) continue;
      if (f.pos.distanceToSquared(flight.player.pos) < R2) {
        score += (f.type === 'wisp' ? SCORE.WISP : f.type === 'formation' ? SCORE.FORMATION : SCORE.CRYSTAL) * combo;
        f.active = false; foes.onShatter(f);
        fx.shatterBurst(f.pos, ctx.zone.data.foeColor);
        motes.spawnAt(f.pos, f.type === 'crystal' ? 'crystal' : 'pulse', f.type === 'formation' ? 5 : 2);
      }
    }
    bumpCombo(1.0);
  }

  function bumpCombo(amt) { combo = Math.min(SCORE.COMBO_MAX, combo + amt); comboTimer = SCORE.COMBO_HOLD; }

  // ── ring passes ─────────────────────────────────────────────────────
  function checkRings() {
    const p = flight.player;
    for (const r of rings.list) {
      if (!r.active || r.passed) continue;
      _d.copy(p.prevPos).sub(r.pos); const prevSide = _d.dot(r.normal);
      _d.copy(p.pos).sub(r.pos); const curSide = _d.dot(r.normal);
      if (prevSide === curSide || (prevSide > 0) === (curSide > 0)) continue; // no plane cross
      // radial distance at crossing (use current pos projected to plane)
      const along = _d.dot(r.normal);
      _radial.copy(_d).addScaledVector(r.normal, -along);
      const rd = _radial.length();
      if (rd > r.radius) continue;
      r.passed = true;
      const perfect = rd < r.radius * PLAY.RING_PERFECT_FRAC;
      rings.onPass(r, perfect);
      ringsCount++;
      bumpCombo(SCORE.COMBO_STEP);
      let pts = perfect ? SCORE.RING_PERFECT : SCORE.RING_BASE;
      if (p.speed >= FLIGHT.SPEED_SPRINT) pts += SCORE.RING_SPEED_BONUS;
      pts = Math.round(pts * combo);
      score += pts;
      energy += perfect ? ENERGY.RING_PERFECT_REFILL : ENERGY.RING_REFILL;
      if (p.glideFall) energy += 20; // the world helps you recover
      fx.ringBurst(r.pos, ctx.zone.data.ringColor);
      audio.ring(perfect);
      flight.addTrauma(CAM.TRAUMA_RING);
      flight.addFovKick(CAM.FOV_RING_KICK);
      hud.flash(ctx.zone.data.ringColor, 0.16);
      const s = worldToScreen(r.pos);
      if (s.vis) hud.popScore(s.x, s.y, '+' + pts, ctx.zone.data.ringColor);
    }
  }

  // ── motes ───────────────────────────────────────────────────────────
  const PITCH = { small: 1.0, pulse: 1.25, crystal: 1.5, aurora: 2.0 };
  function checkMotes() {
    const p = flight.player;
    const r2 = PLAY.MOTE_COLLECT_R * PLAY.MOTE_COLLECT_R;
    for (const m of motes.list) {
      if (!m.active) continue;
      if (m.pos.distanceToSquared(p.pos) < r2) {
        m.active = false; motes.onCollect(m); motesCount++;
        score += Math.round((SCORE.MOTE[m.value] || 25) * combo);
        energy += SCORE.MOTE_ENERGY[m.value] || 4;
        combo = Math.min(SCORE.COMBO_MAX, combo + SCORE.COMBO_MOTE_STEP);
        fx.moteBurst(m.pos, ctx.zone.data.glow);
        audio.mote(PITCH[m.value] || 1);
      }
    }
  }

  // ── fire vs foes ────────────────────────────────────────────────────
  function doFire(dt, firing) {
    if (firing) {
      dragon.headWorld(_origin);
      const dir = flight.player.forward;
      fx.fire(_origin, dir, true, ctx.zone.data.dragonEmissive);
      dragon.setFiring(true);
      if (!wasFiring) { audio.fireOn(); wasFiring = true; }
      const range2 = PLAY.FIRE_RANGE * PLAY.FIRE_RANGE;
      for (const f of foes.list) {
        if (!f.active) continue;
        _toFoe.copy(f.pos).sub(_origin);
        const d2 = _toFoe.lengthSq();
        if (d2 > range2) continue;
        _toFoe.normalize();
        if (_toFoe.dot(dir) < PLAY.FIRE_CONE_COS) continue;
        f.hp -= PLAY.FIRE_DPS * dt;
        if (f.hp <= 0) {
          f.active = false; foes.onShatter(f);
          const pts = Math.round((f.type === 'wisp' ? SCORE.WISP : f.type === 'formation' ? SCORE.FORMATION : SCORE.CRYSTAL) * combo);
          score += pts;
          bumpCombo(SCORE.COMBO_STEP * 0.5);
          fx.shatterBurst(f.pos, ctx.zone.data.foeColor);
          audio.shatter();
          flight.addTrauma(CAM.TRAUMA_SHATTER);
          motes.spawnAt(f.pos, f.type === 'crystal' ? 'crystal' : 'pulse', f.type === 'formation' ? 5 : 2);
          const s = worldToScreen(f.pos);
          if (s.vis) hud.popScore(s.x, s.y, '+' + pts, ctx.zone.data.foeColor);
        }
      }
    } else if (wasFiring) {
      fx.fire(_origin, flight.player.forward, false);
      dragon.setFiring(false);
      audio.fireOff();
      wasFiring = false;
    }
  }

  // ── main per-frame ──────────────────────────────────────────────────
  function update(dt, t) {
    time = t; ctx.time = t;

    if (state === 'title') {
      flight.update(dt, _ctrl, { idle: true, boost: false, canFlap: false });
      computeZone(); applyLighting();
      dragon.update(dt, ctx); sky.update(dt, ctx); world.update(dt, ctx);
      fx.setSpeedStreaks(0.0); fx.update(dt, ctx);
      audio.setSpeed(0.2);
      return;
    }

    if (state !== 'playing' && state !== 'finale') return; // paused/end: loop stopped or frozen

    // input + energy gating
    const ctrl = input.sample(true);
    if (input.takeSkill()) trySkill();
    skillCd = Math.max(0, skillCd - dt);

    const critical = energy <= ENERGY.CRITICAL;
    flight.setGlideFall(energy <= 0);
    const boosting = ctrl.boost && !critical && energy > 0 && state === 'playing';
    const firing = ctrl.fire && !critical && state === 'playing';

    // finale takes over steering-light but keeps physics
    const useCtrl = state === 'finale' ? _ctrl : ctrl;
    if (state === 'finale') { _ctrl.pitch = 0; _ctrl.yaw = 0; _ctrl.roll = 0; }
    const ev = flight.update(dt, useCtrl, { boost: boosting, canFlap: energy > 0, idle: false });
    if (ev.flapped) energy -= FLIGHT.FLAP_COST;
    dragon.setBoost(boosting);

    // energy bookkeeping
    if (!flight.player.glideFall) {
      energy -= ENERGY.DRAIN_PASSIVE * dt;
      if (firing) energy -= ENERGY.DRAIN_FIRE * dt;
      if (boosting) energy -= ENERGY.DRAIN_BOOST * dt;
      const clean = !firing && !boosting && Math.abs(ctrl.pitch) < 0.2;
      if (clean) energy += ENERGY.GLIDE_RECOVER * dt;
    }
    energy = clamp(energy, 0, ENERGY.MAX);

    // zone morph + lighting
    computeZone(); applyLighting();
    if (ctx.zone.index > lastZone) {
      lastZone = ctx.zone.index;
      hud.showZoneBanner(ZONES[ctx.zone.index].name, ZONES[ctx.zone.index].sub);
      audio.setZone(ctx.zone.index);
    }

    // scenery + content
    dragon.update(dt, ctx); sky.update(dt, ctx); world.update(dt, ctx);
    rings.update(dt, ctx); foes.update(dt, ctx); motes.update(dt, ctx);

    // gameplay rules
    checkRings(); checkMotes(); doFire(dt, firing);

    // combo decay
    comboTimer = Math.max(0, comboTimer - dt);
    if (comboTimer <= 0 && combo > 1) combo = Math.max(1, combo - SCORE.COMBO_DECAY * dt);

    // fx + audio
    fx.setSpeedStreaks(flight.player.speedNorm);
    fx.update(dt, ctx);
    audio.setSpeed(flight.player.speedNorm);
    audio.setMuffle(critical);

    // finale logic / trigger
    if (state === 'finale') updateFinale(dt);
    else if (flight.player.dist >= FINALE_DIST) enterFinale();

    // HUD
    const estate = energy <= ENERGY.CRITICAL ? 'critical' : energy <= ENERGY.LOW ? 'low' : 'normal';
    hud.setScore(Math.round(score));
    hud.setCombo(combo);
    hud.setEnergy(energy / ENERGY.MAX, estate);
    hud.setSpeed(flight.player.speedNorm);
    hud.setZone(ctx.zone.index, ZONES[ctx.zone.index].name, ZONES[ctx.zone.index].sub);
    hud.setDistanceProgress(clamp(flight.player.dist / FINALE_DIST, 0, 1));
    hud.setGlideFall(flight.player.glideFall);
  }

  return { update, toTitle, startRun, togglePause, pause, resume, getState: () => state, getBest: () => best };
}

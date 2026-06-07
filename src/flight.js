// ════════════════════════════════════════════════════════════════════════
//  flight.js — dragon flight physics + the follow camera. Owns player state.
//  Heading is scalar yaw+pitch (no drift, clampable); bank is a separate
//  visual roll. Energy-conservation speed model gives the roller-coaster feel.
//  Order each frame: flight.update -> sets dragon.group + camera -> others.
// ════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { FLIGHT, CAM, RENDER, clamp, damp } from './constants.js';

const FLOOR = 34;
const CEIL = 560;

export function makeFlight(camera, dragon) {
  const player = {
    pos: new THREE.Vector3(0, 130, 0),
    prevPos: new THREE.Vector3(0, 130, 0),
    quat: new THREE.Quaternion(),
    forward: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    speed: FLIGHT.SPEED_CRUISE,
    speedNorm: 0,
    dist: 0,
    glideFall: false,
    bank: 0,
  };

  let yaw = 0, pitch = 0;
  let sPitch = 0, sYaw = 0, sRoll = 0;
  let flapCd = 0;
  let camRoll = 0, fov = RENDER.FOV_BASE, fovKick = 0, trauma = 0;
  let smoothLook = null;

  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _q = new THREE.Quaternion();
  const _roll = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _desired = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _wup = new THREE.Vector3(0, 1, 0);

  function addTrauma(a) { trauma = Math.min(1, trauma + a); }
  function addFovKick(v) { fovKick += v; }

  function reset(opts = {}) {
    player.pos.set(0, 130, 0); player.prevPos.copy(player.pos);
    yaw = 0; pitch = 0; sPitch = sYaw = sRoll = 0;
    player.speed = FLIGHT.SPEED_CRUISE; player.bank = 0; player.dist = 0;
    player.glideFall = false; flapCd = 0; trauma = 0; fovKick = 0;
    fov = RENDER.FOV_BASE; camRoll = 0; smoothLook = null;
    player.quat.identity();
    if (opts.snapCamera) {
      player.forward.set(0, 0, -1);
      camera.position.copy(player.pos).addScaledVector(player.forward, -CAM.OFFSET_BACK).y += 0;
      camera.position.y = player.pos.y + CAM.OFFSET_UP;
    }
  }

  // ctrl: {pitch,yaw,roll,boost,fire,flap}; flags: {boost, canFlap, idle}
  function update(dt, ctrl, flags) {
    const idle = flags && flags.idle;
    const cp = idle ? 0 : ctrl.pitch;
    const cy = idle ? 0 : ctrl.yaw;
    const cr = idle ? 0 : ctrl.roll;

    // smoothed inputs (extra return-to-center pull when released)
    const kP = Math.abs(cp) < 0.01 ? FLIGHT.K_INPUT + FLIGHT.K_RETURN : FLIGHT.K_INPUT;
    const kY = Math.abs(cy) < 0.01 ? FLIGHT.K_INPUT + FLIGHT.K_RETURN : FLIGHT.K_INPUT;
    const kR = Math.abs(cr) < 0.01 ? FLIGHT.K_ROLL + FLIGHT.K_RETURN : FLIGHT.K_ROLL;
    sPitch = damp(sPitch, cp, kP, dt);
    sYaw = damp(sYaw, cy, kY, dt);
    sRoll = damp(sRoll, cr, kR, dt);

    // integrate heading (yaw about world Y, pitch in world then yawed)
    yaw -= sYaw * FLIGHT.YAW_RATE * dt;       // +input (D / right) -> turn right
    pitch += sPitch * FLIGHT.PITCH_RATE * dt; // +input (W) -> nose up

    let events = { flapped: false };

    if (player.glideFall) {
      // soft fail: gentle, recoverable descent
      pitch = damp(pitch, FLIGHT.GLIDEFALL_PITCH, 2.4, dt);
      player.speed = damp(player.speed, FLIGHT.GLIDEFALL_SPEED, 2.2, dt);
    } else {
      pitch = clamp(pitch, -1.32, 1.32);
      // energy-conservation: dive accelerates, climb bleeds speed
      const sinP = Math.sin(pitch);
      let accel = -FLIGHT.GRAVITY * sinP - FLIGHT.DRAG * player.speed * player.speed + FLIGHT.THRUST;
      if (flags && flags.boost) accel += FLIGHT.BOOST_ACCEL;
      player.speed += accel * dt;
      // flap impulse (held -> repeats at cooldown)
      flapCd -= dt;
      if (ctrl.flap && flapCd <= 0 && flags && flags.canFlap) {
        player.speed += FLIGHT.FLAP_IMPULSE;
        flapCd = FLIGHT.FLAP_CD;
        events.flapped = true;
      }
      player.speed = clamp(player.speed, 12, FLIGHT.SPEED_MAX);
    }

    // orientation from scalar yaw/pitch (no roll -> no drift)
    _e.set(pitch, yaw, 0, 'YXZ');
    player.quat.setFromEuler(_e);
    player.forward.set(0, 0, -1).applyQuaternion(player.quat);
    player.right.set(1, 0, 0).applyQuaternion(player.quat);
    player.up.set(0, 1, 0).applyQuaternion(player.quat);

    // integrate position
    player.prevPos.copy(player.pos);
    player.pos.addScaledVector(player.forward, player.speed * dt);
    player.dist += player.speed * dt;

    // soft floor / ceiling
    if (player.pos.y < FLOOR) {
      player.pos.y = damp(player.pos.y, FLOOR + 2, 6, dt);
      if (pitch < 0 && !player.glideFall) pitch = damp(pitch, 0.08, 6, dt);
    } else if (player.pos.y > CEIL) {
      player.pos.y = damp(player.pos.y, CEIL, 6, dt);
    }

    player.speedNorm = clamp(
      (player.speed - FLIGHT.SPEED_MIN) / (FLIGHT.SPEED_MAX - FLIGHT.SPEED_MIN), 0, 1
    );

    // visual bank (turn + manual roll), never affects heading
    const bankTarget = -sYaw * FLIGHT.BANK_MAX + sRoll * FLIGHT.BANK_MAX * 0.8;
    player.bank = damp(player.bank, bankTarget, CAM.K_BANK, dt);

    // place the dragon: heading * roll(bank)
    dragon.group.position.copy(player.pos);
    _roll.setFromAxisAngle(_zAxis, player.bank);
    dragon.group.quaternion.copy(player.quat).multiply(_roll);

    // ── follow camera ──
    _desired.copy(player.pos)
      .addScaledVector(player.forward, -CAM.OFFSET_BACK)
      .addScaledVector(_wup, CAM.OFFSET_UP);
    camera.position.x = damp(camera.position.x, _desired.x, CAM.K_POS, dt);
    camera.position.y = damp(camera.position.y, _desired.y, CAM.K_POS_Y, dt);
    camera.position.z = damp(camera.position.z, _desired.z, CAM.K_POS, dt);

    _look.copy(player.pos).addScaledVector(player.forward, CAM.LOOK_AHEAD);
    if (!smoothLook) smoothLook = _look.clone();
    smoothLook.x = damp(smoothLook.x, _look.x, CAM.K_LOOK, dt);
    smoothLook.y = damp(smoothLook.y, _look.y, CAM.K_LOOK, dt);
    smoothLook.z = damp(smoothLook.z, _look.z, CAM.K_LOOK, dt);
    camera.lookAt(smoothLook);

    camRoll = damp(camRoll, player.bank * CAM.BANK_FRACTION, CAM.K_BANK, dt);
    camera.rotateZ(camRoll);

    // FOV: base + speed + decaying ring kick
    fovKick = damp(fovKick, 0, CAM.K_FOV, dt);
    const targetFov = RENDER.FOV_BASE + RENDER.FOV_BOOST * player.speedNorm + fovKick;
    fov = damp(fov, targetFov, CAM.K_FOV, dt);
    camera.fov = fov;
    camera.updateProjectionMatrix();

    // trauma shake (after settle)
    trauma = Math.max(0, trauma - CAM.TRAUMA_DECAY * dt);
    if (trauma > 0.001) {
      const s = trauma * trauma;
      const t = performance.now() * 0.001;
      camera.position.x += Math.sin(t * 47.3) * s * CAM.SHAKE_POS;
      camera.position.y += Math.sin(t * 31.1) * s * CAM.SHAKE_POS;
      camera.rotateZ(Math.sin(t * 23.7) * s * CAM.SHAKE_ROT);
    }

    return events;
  }

  function setGlideFall(on) { player.glideFall = on; }

  return { player, update, addTrauma, addFovKick, setGlideFall, reset };
}

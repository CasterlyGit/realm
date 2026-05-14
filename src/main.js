import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildWorld, updateWorld } from './world.js';
import {
  makeDragon,
  animateDragon,
  setDragonDamage,
  dragonHeadWorld,
  dragonForward,
  DRAGON_CATALOG,
} from './dragon.js';
import { makeFireBreath, makeSpeedStreaks } from './fx.js';
import { populateWorld, updatePopulation } from './populate.js';

const CRUISE = 40;
const MAX_SPEED = 90;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  1,
  5000
);

const world = buildWorld(scene, renderer);
const population = populateWorld(scene, world);

const player = {
  mesh: makeDragon('pyrothar'),
  pos: new THREE.Vector3(-200, 560, 700),
  vel: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  bank: 0,
  hp: 1.0,
  heat: 0,
  flapBoost: 0,
  alive: true,
};
scene.add(player.mesh);
const initialForward = new THREE.Vector3(0.55, -0.05, -0.83).normalize();
player.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), initialForward);
player.vel.copy(initialForward).multiplyScalar(CRUISE);
player.mesh.position.copy(player.pos);
player.mesh.quaternion.copy(player.quat);
camera.position.copy(player.pos).add(new THREE.Vector3(0, 3.0, 9).applyQuaternion(player.quat));
camera.quaternion.copy(player.quat);

function makeEnemy(archetype, pos, fireT) {
  const e = {
    mesh: makeDragon(archetype),
    pos: pos.clone(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    hp: 1.0,
    state: 'APPROACH',
    stateT: 0,
    fireWindup: 0,
    firing: 0,
    fireOffset: new THREE.Vector3(),
    nextFireT: fireT,
    alive: true,
    archetype,
    name: DRAGON_CATALOG[archetype].name,
  };
  scene.add(e.mesh);
  return e;
}
let enemies = [];
function spawnEnemiesFor(playerArchetype) {
  const others = Object.keys(DRAGON_CATALOG).filter(k => k !== playerArchetype);
  enemies.forEach(e => scene.remove(e.mesh));
  enemies = [
    makeEnemy(others[0], new THREE.Vector3(600, 720, -400), 4.0),
    makeEnemy(others[1], new THREE.Vector3(-400, 680, -800), 7.0),
  ];
}
spawnEnemiesFor('pyrothar');

const TOTAL_WAVES = 3;
let wave = 0;
let waveState = 'idle';
let waveTransitionT = 0;
let score = 0;
let combo = 0;
let comboTimer = 0;
const orbs = [];

function startWave(n) {
  const others = Object.keys(DRAGON_CATALOG)
    .filter(k => k !== player.archetype)
    .sort(() => Math.random() - 0.5);
  enemies.forEach(e => scene.remove(e.mesh));
  enemies = [];
  if (n === 3) {
    const e = makeEnemy(others[0], new THREE.Vector3(0, 760, -200), elapsed + 3.0);
    e.mesh.scale.setScalar(1.6);
    e.hpMax = 2.5; e.hp = 2.5; e.isBoss = true; e.fireMult = 1.5;
    e.name = e.name + ' ASCENDANT';
    enemies.push(e);
  } else {
    const positions = [
      new THREE.Vector3(600, 720, -400),
      new THREE.Vector3(-400, 680, -800),
    ];
    for (let i = 0; i < 2; i++) {
      const e = makeEnemy(others[i], positions[i], elapsed + 3.0 + i * 1.5);
      const buff = n === 2 ? 1.2 : 1.0;
      e.hpMax = buff; e.hp = buff;
      e.fireMult = n === 2 ? 1.15 : 1.0;
      enemies.push(e);
    }
  }
  showWaveBanner(n);
}

function spawnOrbs(count) {
  const baseColor = new THREE.Color(0xffe066);
  const geo = new THREE.SphereGeometry(2.5, 12, 10);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: baseColor.clone(),
      transparent: true,
      opacity: 0.92,
    });
    const orb = new THREE.Mesh(geo, mat);
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const r = 200 + Math.random() * 250;
    orb.position.set(
      player.pos.x + Math.cos(ang) * r,
      player.pos.y + (Math.random() - 0.5) * 120,
      player.pos.z + Math.sin(ang) * r
    );
    const halo = new THREE.PointLight(0xffe066, 5, 90, 1.5);
    orb.add(halo);
    orb.userData.phase = Math.random() * Math.PI * 2;
    orb.userData.basePos = orb.position.clone();
    scene.add(orb);
    orbs.push(orb);
  }
}

function updateOrbs(dt, t) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const orb = orbs[i];
    orb.position.y = orb.userData.basePos.y + Math.sin(t * 1.5 + orb.userData.phase) * 6;
    orb.rotation.y += dt * 1.5;
    orb.material.opacity = 0.85 + Math.sin(t * 3 + orb.userData.phase) * 0.1;
    if (player.pos.distanceTo(orb.position) < 14) {
      player.hp = Math.min(1, player.hp + 0.18);
      player.skillCD = Math.max(0, player.skillCD - 4);
      addScore(50);
      scene.remove(orb);
      orbs.splice(i, 1);
    }
  }
}

function clearOrbs() {
  for (const o of orbs) scene.remove(o);
  orbs.length = 0;
}

function addScore(amount) {
  const mult = combo > 0 ? (1 + combo * 0.4) : 1;
  score += Math.floor(amount * mult);
  combo++;
  comboTimer = 10;
  scoreEl.textContent = score.toLocaleString();
  if (combo > 1) {
    comboEl.textContent = '×' + mult.toFixed(1);
    comboEl.classList.add('active');
  }
}

function showWaveBanner(n) {
  const label = n === 3 ? 'FINAL · BOSS' : `WAVE ${n} / ${TOTAL_WAVES}`;
  waveBannerEl.textContent = label;
  waveBannerEl.classList.remove('show');
  void waveBannerEl.offsetWidth;
  waveBannerEl.classList.add('show');
  waveIndicatorEl.textContent = label;
}

const SKILLS = {
  pyrothar:  { name: 'INFERNO',    cooldown: 12, color: 0xff5500 },
  ryujin:    { name: 'TEMPEST',    cooldown: 10, color: 0x00ffff },
  verdantis: { name: 'BLOOM',      cooldown: 15, color: 0xff66cc },
  cryos:     { name: 'FROST NOVA', cooldown: 12, color: 0x88ddff },
};
player.archetype = 'pyrothar';
player.skillCD = 0;
player.healingT = 0;

function activateSkill() {
  if (!player.alive || player.skillCD > 0) return;
  const arche = player.archetype;
  const skill = SKILLS[arche];
  const head = dragonHeadWorld(player.mesh, new THREE.Vector3());
  const fwd  = dragonForward(player.mesh, new THREE.Vector3());

  if (arche === 'pyrothar') {
    for (let i = 0; i < 320; i++) {
      const d = new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
      ).normalize();
      fire.emit(player.pos.clone(), d, 1, 70);
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      if (player.pos.distanceTo(e.pos) < 80) {
        e.hp = Math.max(0, e.hp - 0.6);
        if (e.hp <= 0) killEnemy(e);
      }
    }
  } else if (arche === 'ryujin') {
    for (let i = 0; i < 180; i++) {
      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4,
        0
      );
      const dir = fwd.clone().add(jitter).normalize();
      fire.emit(head, dir, 1, 95);
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      const toE = new THREE.Vector3().subVectors(e.pos, head);
      const d = toE.length();
      toE.normalize();
      if (toE.dot(fwd) > 0.6 && d < 220) {
        e.hp = Math.max(0, e.hp - 0.45);
        e.stunUntil = elapsed + 2.0;
        if (e.hp <= 0) killEnemy(e);
      }
    }
  } else if (arche === 'verdantis') {
    player.healingT = 3.0;
    for (let i = 0; i < 240; i++) {
      const ang = Math.random() * Math.PI * 2;
      const yJit = (Math.random() - 0.5) * 0.4;
      const d = new THREE.Vector3(Math.cos(ang), yJit, Math.sin(ang)).normalize();
      fire.emit(player.pos.clone(), d, 1, 30);
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      if (player.pos.distanceTo(e.pos) < 65) {
        e.hp = Math.max(0, e.hp - 0.35);
        if (e.hp <= 0) killEnemy(e);
      }
    }
  } else if (arche === 'cryos') {
    for (let i = 0; i < 320; i++) {
      const d = new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
      ).normalize();
      fire.emit(player.pos.clone(), d, 1, 55);
    }
    let nearest = null, nd = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = player.pos.distanceTo(e.pos);
      if (d < 120) {
        e.hp = Math.max(0, e.hp - 0.5);
        if (d < nd) { nd = d; nearest = e; }
        if (e.hp <= 0) killEnemy(e);
      }
    }
    if (nearest && nearest.alive) nearest.frozenUntil = elapsed + 3.0;
  }

  player.skillCD = skill.cooldown;
  damageFlashT = 0.15;
}

const fire = makeFireBreath(scene);
const streaks = makeSpeedStreaks(scene);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42,
  0.55,
  0.92
);
renderer.toneMappingExposure = 0.78;
composer.addPass(bloom);
composer.addPass(new OutputPass());

const input = {
  pitchUp: false, pitchDown: false,
  yawLeft: false, yawRight: false,
  rollLeft: false, rollRight: false,
  flap: false, sprint: false,
  fire: false,
  pointerLocked: false,
};

const hint = document.getElementById('hint');
const titleEl = document.getElementById('title');
const endEl = document.getElementById('endcard');
const hpFill = document.getElementById('hp-fill');
const heatFill = document.getElementById('heat-fill');
const enemyHpFill = document.getElementById('enemy-hp-fill');
const enemyHpWrap = document.getElementById('enemy-hp');
const damageFlash = document.getElementById('damage-flash');
const skillIndicator = document.getElementById('skill-indicator');
const skillNameEl = document.getElementById('skill-name');
const skillCDFill = document.getElementById('skill-cd-fill');
const waveBannerEl = document.getElementById('wave-banner');
const waveIndicatorEl = document.getElementById('wave-indicator');
const scoreEl = document.getElementById('score');
const comboEl = document.getElementById('combo');

let selected = false;
const selectScreen = document.getElementById('select-screen');
const cardsEl = document.getElementById('select-cards');
const SILHOUETTES = {
  pyrothar: `<svg viewBox="0 0 100 60"><path fill="currentColor" d="M10 40 Q15 25 30 28 L45 22 Q55 18 65 24 L80 22 Q92 25 90 38 L72 42 Q60 48 50 44 L38 48 Q20 52 10 40 Z"/></svg>`,
  ryujin:   `<svg viewBox="0 0 100 60"><path fill="currentColor" d="M5 35 Q15 20 30 28 Q45 36 55 22 Q65 12 80 22 Q92 32 95 25 L92 30 Q85 40 70 32 Q55 24 45 36 Q30 48 15 42 Q8 40 5 35 Z"/></svg>`,
  verdantis:`<svg viewBox="0 0 100 60"><path fill="currentColor" d="M12 38 Q18 22 35 26 L48 18 L55 24 L62 16 L68 25 L78 18 Q92 22 88 38 L72 42 Q60 48 50 44 L38 48 Q22 52 12 38 Z"/></svg>`,
  cryos:    `<svg viewBox="0 0 100 60"><path fill="currentColor" d="M10 40 L20 22 L32 32 L42 18 L50 28 L60 16 L68 28 L80 22 L92 38 L72 42 Q60 48 50 44 L38 48 Q20 52 10 40 Z"/></svg>`,
};
function renderCards() {
  cardsEl.innerHTML = '';
  for (const [key, def] of Object.entries(DRAGON_CATALOG)) {
    const p = def.palette;
    const card = document.createElement('div');
    card.className = 'dragon-card';
    card.style.setProperty('--card-gradient', `linear-gradient(135deg, ${p.primary}, ${p.accent})`);
    card.style.setProperty('--glow', p.primary + 'aa');
    card.innerHTML = `
      <div class="silhouette" style="color:${p.primary}">${SILHOUETTES[key]}</div>
      <div class="name">${def.name.toUpperCase()}</div>
      <div class="sub">${def.subtitle}</div>
      <div class="blurb">${def.blurb}</div>
    `;
    card.addEventListener('click', () => pickDragon(key));
    cardsEl.appendChild(card);
  }
}
function pickDragon(key) {
  if (selected) return;
  selected = true;
  scene.remove(player.mesh);
  player.mesh = makeDragon(key);
  player.mesh.position.copy(player.pos);
  player.mesh.quaternion.copy(player.quat);
  scene.add(player.mesh);
  player.archetype = key;
  player.skillCD = 0;
  wave = 1;
  score = 0;
  combo = 0;
  comboTimer = 0;
  waveState = 'fighting';
  startWave(1);
  selectScreen.classList.add('hidden');
  document.body.classList.add('selected');
  skillNameEl.textContent = SKILLS[key].name;
  skillIndicator.style.setProperty('--skill-color', '#' + SKILLS[key].color.toString(16).padStart(6, '0'));
}
renderCards();

canvas.addEventListener('click', () => {
  if (!selected) return;
  if (!input.pointerLocked) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  input.pointerLocked = document.pointerLockElement === canvas;
  if (input.pointerLocked) {
    titleEl.classList.add('fade');
    hint.classList.add('fade');
    document.body.classList.add('armed');
  } else {
    hint.classList.remove('fade');
  }
});

document.addEventListener('mousedown', (e) => {
  if (e.button === 0) input.fire = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
});

const keymap = {
  KeyW: 'pitchUp', KeyS: 'pitchDown',
  KeyA: 'yawLeft', KeyD: 'yawRight',
  KeyQ: 'rollLeft', KeyE: 'rollRight',
  Space: 'flap',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyF: 'fire',
};
document.addEventListener('keydown', (e) => {
  const k = keymap[e.code];
  if (k) {
    input[k] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }
  if (e.code === 'KeyR') {
    if (!player.alive) location.reload();
    else activateSkill();
  }
});
document.addEventListener('keyup', (e) => {
  const k = keymap[e.code];
  if (k) input[k] = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  fire.onResize();
  streaks.onResize();
});

function currentRoll(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return e.z;
}

const tmpFwd = new THREE.Vector3();
const tmpHead = new THREE.Vector3();
const tmpToTarget = new THREE.Vector3();

function updatePlayer(dt) {
  if (!player.alive) return;

  if (player.skillCD > 0) player.skillCD = Math.max(0, player.skillCD - dt);
  if (player.healingT > 0) {
    player.hp = Math.min(1, player.hp + dt * (0.4 / 3.0));
    player.healingT -= dt;
  }

  const pitchAxis = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);
  const yawAxis   = (input.yawRight ? 1 : 0) - (input.yawLeft ? 1 : 0);
  const rollAxis  = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);

  player.pitchSmooth = (player.pitchSmooth || 0);
  player.yawSmooth   = (player.yawSmooth || 0);
  const accelK   = 1 - Math.exp(-2.5 * dt);
  const releaseK = 1 - Math.exp(-1.4 * dt);
  const pitchK = Math.abs(pitchAxis) > Math.abs(player.pitchSmooth) ? accelK : releaseK;
  const yawK   = Math.abs(yawAxis)   > Math.abs(player.yawSmooth)   ? accelK : releaseK;
  player.pitchSmooth += (pitchAxis - player.pitchSmooth) * pitchK;
  player.yawSmooth   += (yawAxis   - player.yawSmooth)   * yawK;

  const idleBank  = Math.sin(elapsed * 0.45) * 0.045;
  const idlePitch = Math.sin(elapsed * 0.33 + 1.2) * 0.025;

  const pitchRate = player.pitchSmooth * 1.0 + idlePitch;
  const targetBank = player.yawSmooth * 0.75 + idleBank;
  player.bank += (targetBank - player.bank) * (1 - Math.exp(-1.6 * dt));
  const yawRate = player.yawSmooth * 0.7 * (0.55 + Math.abs(player.bank));
  const curRoll = currentRoll(player.quat);
  const rollRate = (player.bank - curRoll) * 3.0 + rollAxis * 1.6;

  const dq = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchRate * dt, yawRate * dt, rollRate * dt, 'YXZ')
  );
  player.quat.multiply(dq).normalize();

  tmpFwd.set(0, 0, -1).applyQuaternion(player.quat);

  player.flapBoost = Math.max(0, player.flapBoost - dt * 1.4);
  if (input.flap) {
    player.vel.addScaledVector(tmpFwd, 38 * dt);
    player.flapBoost = Math.min(1, player.flapBoost + dt * 2.5);
  }
  if (input.sprint) player.vel.addScaledVector(tmpFwd, 22 * dt);

  const speed = player.vel.length();
  const liftK = 1 - Math.exp(-0.7 * dt);
  player.vel.lerp(tmpFwd.clone().multiplyScalar(speed), liftK);

  const stallF = THREE.MathUtils.clamp(1 - speed / CRUISE, 0, 1);
  player.vel.y -= 9.8 * (0.35 + 0.65 * stallF) * dt;

  player.vel.multiplyScalar(Math.pow(0.995, dt * 60));

  const cap = MAX_SPEED * (input.sprint ? 1.2 : 1.0);
  if (player.vel.length() > cap) player.vel.setLength(cap);

  player.pos.addScaledVector(player.vel, dt);

  const groundH = world.terrain.heightAt(player.pos.x, player.pos.z);
  const minH = groundH + 12;
  if (player.pos.y < minH) {
    player.pos.y = minH;
    if (player.vel.y < 0) player.vel.y = 0;
    if (player.vel.length() > 70) damagePlayer(0.18);
  }

  player.mesh.position.copy(player.pos);
  player.mesh.quaternion.copy(player.quat);

  if (input.fire && player.heat < 1.0) {
    player.heat = Math.min(1, player.heat + dt / 3.0);
    dragonHeadWorld(player.mesh, tmpHead);
    dragonForward(player.mesh, tmpFwd);
    const muzzleDir = tmpFwd.clone();
    fire.emit(tmpHead, muzzleDir, 9, 55);

    for (const e of enemies) {
      if (!e.alive) continue;
      tmpToTarget.copy(e.pos).sub(tmpHead);
      const dist = tmpToTarget.length();
      tmpToTarget.normalize();
      const dot = tmpToTarget.dot(muzzleDir);
      if (dot > Math.cos(THREE.MathUtils.degToRad(15)) && dist < 140) {
        e.hp = Math.max(0, e.hp - 0.45 * dt);
        if (e.hp <= 0) killEnemy(e);
      }
    }
  } else if (player.heat > 0) {
    player.heat = Math.max(0, player.heat - dt / 4.0);
  }
}

function updateEnemy(enemy, dt, t) {
  if (!enemy.alive) return;

  if (enemy.frozenUntil && t < enemy.frozenUntil) {
    enemy.vel.multiplyScalar(0.92);
    enemy.pos.addScaledVector(enemy.vel, dt);
    const minH = world.terrain.heightAt(enemy.pos.x, enemy.pos.z) + 40;
    if (enemy.pos.y < minH) enemy.pos.y = minH;
    enemy.mesh.position.copy(enemy.pos);
    enemy.mesh.userData.eyes.emissiveIntensity = 1.5;
    return;
  }
  if (enemy.stunUntil && t < enemy.stunUntil) {
    enemy.vel.multiplyScalar(0.97);
    enemy.pos.addScaledVector(enemy.vel, dt);
    enemy.mesh.position.copy(enemy.pos);
    return;
  }

  enemy.stateT += dt;
  const toPlayer = new THREE.Vector3().subVectors(player.pos, enemy.pos);
  const distToPlayer = toPlayer.length();
  toPlayer.normalize();

  let desiredDir = new THREE.Vector3();

  switch (enemy.state) {
    case 'APPROACH': {
      desiredDir.copy(toPlayer).add(enemy.fireOffset).normalize();
      if (distToPlayer < 120 || enemy.stateT > 6) {
        enemy.state = 'STRAFE';
        enemy.stateT = 0;
        enemy.fireOffset.set(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.5
        );
      }
      break;
    }
    case 'STRAFE': {
      const tangent = new THREE.Vector3()
        .crossVectors(toPlayer, new THREE.Vector3(0, 1, 0))
        .normalize();
      desiredDir.copy(tangent).addScaledVector(toPlayer, 0.35).normalize();
      if (enemy.stateT > 0.7 && t > enemy.nextFireT && distToPlayer < 160) {
        enemy.state = 'BREATHE_FIRE';
        enemy.stateT = 0;
        enemy.fireWindup = 0;
      } else if (enemy.stateT > 1.6) {
        enemy.state = 'BANK_AWAY';
        enemy.stateT = 0;
      }
      break;
    }
    case 'BREATHE_FIRE': {
      desiredDir.copy(toPlayer);
      if (enemy.stateT < 0.8) {
        enemy.fireWindup = enemy.stateT / 0.8;
        enemy.firing = 0;
      } else if (enemy.stateT < 2.6) {
        enemy.fireWindup = 1;
        enemy.firing = 1;
        const head = dragonHeadWorld(enemy.mesh, new THREE.Vector3());
        const fwd = dragonForward(enemy.mesh, new THREE.Vector3());
        fire.emit(head, fwd, 8, 55);
        const toHead = new THREE.Vector3().subVectors(player.pos, head);
        const dHead = toHead.length();
        toHead.normalize();
        const dot = toHead.dot(fwd);
        if (dot > Math.cos(THREE.MathUtils.degToRad(15)) && dHead < 140) {
          damagePlayer(0.42 * (enemy.fireMult || 1) * dt);
        }
      } else {
        enemy.fireWindup = 0;
        enemy.firing = 0;
        enemy.state = 'STRAFE';
        enemy.stateT = 0;
        enemy.nextFireT = t + 2.2 + Math.random() * 1.2;
      }
      break;
    }
    case 'BANK_AWAY': {
      const away = toPlayer.clone().multiplyScalar(-0.4);
      away.y += 0.5;
      desiredDir.copy(away).normalize();
      if (enemy.stateT > 0.7) {
        enemy.state = 'APPROACH';
        enemy.stateT = 0;
      }
      break;
    }
  }

  const desiredQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    desiredDir
  );
  enemy.quat.slerp(desiredQuat, 1 - Math.exp(-1.6 * dt));

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.quat);
  const speed = 48 + (enemy.state === 'BANK_AWAY' ? 12 : 0);
  enemy.vel.lerp(fwd.multiplyScalar(speed), 1 - Math.exp(-2 * dt));
  enemy.pos.addScaledVector(enemy.vel, dt);

  const minH = world.terrain.heightAt(enemy.pos.x, enemy.pos.z) + 40;
  if (enemy.pos.y < minH) {
    enemy.pos.y = minH;
    enemy.vel.y = Math.max(enemy.vel.y, 4);
  }
  if (enemy.pos.y > 1100) enemy.pos.y = 1100;

  enemy.mesh.position.copy(enemy.pos);
  enemy.mesh.quaternion.copy(enemy.quat);

  enemy.mesh.userData.eyes.emissiveIntensity = 3 + enemy.fireWindup * 6;
  setDragonDamage(enemy.mesh, 1 - enemy.hp);
}

let damageFlashT = 0;
function damagePlayer(amount) {
  if (!player.alive) return;
  player.hp = Math.max(0, player.hp - amount);
  damageFlashT = 0.4;
  if (player.hp <= 0) killPlayer();
}

let timeScale = 1.0;
let endTimer = 0;
let endState = null;

function killEnemy(enemy) {
  enemy.alive = false;
  addScore(enemy.isBoss ? 2500 : 500);
  if (enemies.every(e => !e.alive)) {
    if (wave >= TOTAL_WAVES) {
      timeScale = 0.35;
      endState = 'win';
      endTimer = 0;
    } else {
      waveState = 'transition';
      waveTransitionT = 0;
      spawnOrbs(7);
    }
  }
}

function killPlayer() {
  player.alive = false;
  endState = 'lose';
  endTimer = 0;
}

function updateEnd(dt) {
  if (!endState) return;
  endTimer += dt;
  if (endState === 'win') {
    for (const e of enemies) {
      e.pos.y -= 80 * dt * (1 + endTimer);
      e.mesh.position.copy(e.pos);
      e.mesh.rotateZ(2.0 * dt);
    }
    if (endTimer > 1.0) {
      timeScale += (1.0 - timeScale) * Math.min(1, dt * 0.5);
    }
    if (endTimer > 2.5) showEnd('THE SKY IS YOURS');
  }
  if (endState === 'lose') {
    player.vel.y -= 40 * dt;
    player.pos.addScaledVector(player.vel, dt);
    player.mesh.position.copy(player.pos);
    player.mesh.rotateZ(1.5 * dt);
    if (endTimer > 1.5) showEnd('YOU HAVE FALLEN');
  }
}

let endShown = false;
function showEnd(text) {
  if (endShown) return;
  endShown = true;
  endEl.querySelector('.end-text').textContent = text;
  const sub = endEl.querySelector('.end-sub');
  sub.innerHTML = `Final score · <b style="color:#ffd23f">${score.toLocaleString()}</b><br>Press R to fly again`;
  endEl.classList.add('show');
}

function updateCamera(dt) {
  const speed = player.vel.length();
  const speedNorm = THREE.MathUtils.clamp(speed / MAX_SPEED, 0, 1);

  const partialRollQuat = player.quat.clone();
  const eu = new THREE.Euler().setFromQuaternion(partialRollQuat, 'YXZ');
  eu.z *= 0.6;
  partialRollQuat.setFromEuler(eu);

  const offset = new THREE.Vector3(0, 3.0, 9).applyQuaternion(partialRollQuat);
  const camTarget = player.pos.clone().add(offset);
  camera.position.lerp(camTarget, 1 - Math.exp(-4.5 * dt));

  camera.quaternion.slerp(partialRollQuat, 1 - Math.exp(-3.5 * dt));

  const targetFov = 75 + 22 * speedNorm + (input.sprint ? 4 : 0);
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  return speedNorm;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function updateHUD() {
  hpFill.style.width = (player.hp * 100) + '%';
  heatFill.style.width = (player.heat * 100) + '%';
  heatFill.classList.toggle('hot', player.heat > 0.8);
  const alive = enemies.filter(e => e.alive);
  if (alive.length) {
    const nearest = alive.reduce((best, e) =>
      dist(player.pos, e.pos) < dist(player.pos, best.pos) ? e : best
    , alive[0]);
    if (player.hp < 1 || nearest.hp < 1 || dist(player.pos, nearest.pos) < 500) {
      enemyHpWrap.classList.add('show');
      enemyHpFill.style.width = (nearest.hp * 100) + '%';
      enemyHpWrap.querySelector('.bar-label').textContent =
        nearest.name.toUpperCase() + (nearest.name === 'Veil' ? ' · SKARN OF CALDEN' : ' · VETHRIM OF BRENNOC');
    }
  }
  if (damageFlashT > 0) {
    damageFlashT -= 1 / 60;
    damageFlash.style.opacity = Math.max(0, damageFlashT * 1.6);
  } else {
    damageFlash.style.opacity = 0;
  }

  if (player.archetype && SKILLS[player.archetype]) {
    const total = SKILLS[player.archetype].cooldown;
    const remaining = player.skillCD;
    const pct = total > 0 ? (1 - remaining / total) * 100 : 100;
    skillCDFill.style.width = pct + '%';
    skillIndicator.classList.toggle('ready', remaining <= 0);
  }
}

const clock = new THREE.Clock();
let elapsed = 0;

function loop() {
  const rawDt = Math.min(0.05, clock.getDelta());
  const dt = rawDt * timeScale;
  elapsed += dt;

  updatePlayer(dt);
  for (const e of enemies) updateEnemy(e, dt, elapsed);
  updateOrbs(dt, elapsed);
  if (comboTimer > 0) {
    comboTimer -= rawDt;
    if (comboTimer <= 0) {
      combo = 0;
      comboEl.classList.remove('active');
    }
  }
  if (waveState === 'transition') {
    waveTransitionT += rawDt;
    if (orbs.length === 0 || waveTransitionT > 14) {
      clearOrbs();
      wave++;
      waveState = 'fighting';
      startWave(wave);
    }
  }
  updateEnd(rawDt);

  animateDragon(player.mesh, elapsed, dt, player.flapBoost);
  for (let i = 0; i < enemies.length; i++) {
    animateDragon(enemies[i].mesh, elapsed * (1.05 + i * 0.06) + 1.7 + i, dt, 0);
  }

  fire.update(dt);
  updateWorld(world, dt, elapsed, camera);
  updatePopulation(population, dt, elapsed);

  const speedNorm = updateCamera(dt);
  streaks.update(camera, dt, speedNorm);

  world.sun.target.position.copy(player.pos);
  world.sun.position.copy(player.pos).addScaledVector(world.sky.sunDir, 1500);

  updateHUD();

  composer.render();
  requestAnimationFrame(loop);
}

loop();

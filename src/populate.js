import * as THREE from 'three';
import { CASTLE_POS, VILLAGE_POS, STONES_POS } from './world.js';

const HARETH_POS  = new THREE.Vector3(1900,  0,  300);
const BONEFOLD_POS = new THREE.Vector3(-500, 0, -2100);

export function populateWorld(scene, world) {
  const forests = addForests(scene, world.terrain);
  const bridge  = addDrownedBridge(scene, world.terrain);
  const bones   = addBonefold(scene, world.terrain);
  const denizens = addGroundDenizens(scene, world.terrain);
  const ravens  = addSkyCarrion(scene);
  return { forests, bridge, bones, denizens, ravens };
}

export function updatePopulation(state, dt, t) {
  // Iron Riders march in column along road from village to castle
  const riderGroup = state.denizens.ironRiders;
  for (let i = 0; i < riderGroup.children.length; i++) {
    const k = riderGroup.children[i];
    const u = k.userData;
    const phase = (t * 6 + u.offset) % 400;
    const p = phase / 400;
    const x = THREE.MathUtils.lerp(VILLAGE_POS.x + 60, CASTLE_POS.x - 80, p);
    const z = THREE.MathUtils.lerp(VILLAGE_POS.z + 30, CASTLE_POS.z + 80, p);
    const h = state.denizens.terrain.heightAt(x, z);
    k.position.set(x, h, z);
    const lookX = THREE.MathUtils.lerp(VILLAGE_POS.x + 60, CASTLE_POS.x - 80, p + 0.01);
    const lookZ = THREE.MathUtils.lerp(VILLAGE_POS.z + 30, CASTLE_POS.z + 80, p + 0.01);
    k.rotation.y = Math.atan2(lookX - x, lookZ - z);
  }

  // Carrn-folk flee village
  const folk = state.denizens.carrnFolk;
  for (let i = 0; i < folk.children.length; i++) {
    const p = folk.children[i];
    const u = p.userData;
    const dist = ((t * 3 + u.offset) % 90);
    const ang = u.angle;
    const x = VILLAGE_POS.x + Math.cos(ang) * (50 + dist);
    const z = VILLAGE_POS.z + Math.sin(ang) * (50 + dist) + u.lane;
    const h = state.denizens.terrain.heightAt(x, z);
    p.position.set(x, h + 1, z);
  }

  // Sky-Carrion ravens circle the village
  for (let i = 0; i < state.ravens.children.length; i++) {
    const r = state.ravens.children[i];
    const u = r.userData;
    const ang = u.phase + t * u.speed;
    r.position.set(
      Math.cos(ang) * u.radius,
      u.height + Math.sin(t * 0.7 + i) * 8,
      Math.sin(ang) * u.radius
    );
    r.rotation.y = -ang + Math.PI / 2;
    r.rotation.z = Math.sin(t * 4 + i) * 0.4;
  }
}

function addForests(scene, terrain) {
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4, 5);
  const coneGeo  = new THREE.ConeGeometry(2.6, 8, 5);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x2a1f17, roughness: 1.0, flatShading: true,
  });
  const leafMatDark = new THREE.MeshStandardMaterial({
    color: 0x2d3a2a, roughness: 1.0, flatShading: true,
  });
  const leafMatMoss = new THREE.MeshStandardMaterial({
    color: 0x3e4a32, roughness: 1.0, flatShading: true,
  });
  const N = 700;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const leavesA = new THREE.InstancedMesh(coneGeo, leafMatDark, N);
  const leavesB = new THREE.InstancedMesh(coneGeo, leafMatMoss, N);
  const m = new THREE.Matrix4();
  let placedA = 0, placedB = 0, placedT = 0;
  for (let i = 0; i < N * 4 && placedT < N; i++) {
    const x = (Math.random() - 0.5) * 6800;
    const z = (Math.random() - 0.5) * 6800;
    const h = terrain.heightAt(x, z);
    if (h < 60 || h > 360) continue;
    const dCastle  = Math.hypot(x - CASTLE_POS.x,  z - CASTLE_POS.z);
    const dVillage = Math.hypot(x - VILLAGE_POS.x, z - VILLAGE_POS.z);
    const dStones  = Math.hypot(x - STONES_POS.x,  z - STONES_POS.z);
    const dBones   = Math.hypot(x - BONEFOLD_POS.x, z - BONEFOLD_POS.z);
    if (dCastle < 180 || dVillage < 90 || dStones < 70 || dBones < 250) continue;
    const s = 0.7 + Math.random() * 0.9;
    m.makeScale(s, s, s).setPosition(x, h + 2 * s, z);
    trunks.setMatrixAt(placedT++, m);
    const isMoss = h > 200 || Math.random() < 0.35;
    m.makeScale(s, s, s).setPosition(x, h + 7 * s, z);
    if (isMoss) leavesB.setMatrixAt(placedB++, m);
    else        leavesA.setMatrixAt(placedA++, m);
  }
  trunks.count  = placedT;
  leavesA.count = placedA;
  leavesB.count = placedB;
  trunks.instanceMatrix.needsUpdate  = true;
  leavesA.instanceMatrix.needsUpdate = true;
  leavesB.instanceMatrix.needsUpdate = true;
  trunks.castShadow = false;
  leavesA.castShadow = false;
  leavesB.castShadow = false;
  scene.add(trunks, leavesA, leavesB);
  return { trunks, leavesA, leavesB };
}

function addDrownedBridge(scene, terrain) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x6b6358, roughness: 0.95, flatShading: true,
  });
  const bedMat = new THREE.MeshStandardMaterial({
    color: 0x877863, roughness: 1.0, flatShading: true,
  });
  const stumpMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a1a, roughness: 1.0, flatShading: true,
  });
  const archCount = 9, spacing = 16;

  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(70, archCount * spacing + 40),
    bedMat
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.5;
  g.add(bed);

  for (let i = 0; i < archCount; i++) {
    const z = (i - (archCount - 1) / 2) * spacing;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 6), stoneMat);
    pillar.position.set(0, 13, z);
    g.add(pillar);
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(7, 1.6, 4, 10, Math.PI),
      stoneMat
    );
    arch.position.set(0, 24, z);
    arch.rotation.set(0, Math.PI / 2, 0);
    g.add(arch);
  }
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(12, 3, archCount * spacing + 12),
    stoneMat
  );
  deck.position.y = 27;
  g.add(deck);

  for (let i = 0; i < 10; i++) {
    const stump = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0 + Math.random() * 0.5, 1.5, 3, 5),
      stumpMat
    );
    stump.position.set(
      (Math.random() < 0.5 ? -1 : 1) * (38 + Math.random() * 6),
      1.5,
      (i - 4.5) * 18
    );
    g.add(stump);
  }
  const h = terrain.heightAt(HARETH_POS.x, HARETH_POS.z);
  g.position.set(HARETH_POS.x, h, HARETH_POS.z);
  g.rotation.y = 0.3;
  scene.add(g);
  return g;
}

function addBonefold(scene, terrain) {
  const g = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xdbd2c1, roughness: 0.9, flatShading: true,
  });
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x7a6e58, roughness: 1.0, flatShading: true,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(450, 800), groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.3;
  g.add(ground);
  for (let i = 0; i < 50; i++) {
    const x = (Math.random() - 0.5) * 360;
    const z = (Math.random() - 0.5) * 700;
    const r = Math.random();
    let shape;
    if (r < 0.25) {
      shape = new THREE.Mesh(
        new THREE.SphereGeometry(3 + Math.random() * 4, 6, 5),
        boneMat
      );
      shape.scale.set(1, 0.7, 1.2);
    } else if (r < 0.7) {
      const len = 6 + Math.random() * 10;
      shape = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, len, 5),
        boneMat
      );
      shape.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    } else {
      shape = new THREE.Mesh(
        new THREE.BoxGeometry(20 + Math.random() * 14, 1.2, 1.6),
        boneMat
      );
    }
    shape.position.set(x, 0.6, z);
    shape.rotation.y = Math.random() * Math.PI;
    g.add(shape);
  }
  const h = terrain.heightAt(BONEFOLD_POS.x, BONEFOLD_POS.z);
  g.position.set(BONEFOLD_POS.x, h, BONEFOLD_POS.z);
  scene.add(g);
  return g;
}

function addGroundDenizens(scene, terrain) {
  const surcoat = new THREE.MeshStandardMaterial({
    color: 0x8c3a2a, roughness: 0.95, flatShading: true,
  });
  const horseMat = new THREE.MeshStandardMaterial({
    color: 0x1c140e, roughness: 1.0, flatShading: true,
  });
  const ochreRobe = new THREE.MeshStandardMaterial({
    color: 0xb89060, roughness: 1.0, flatShading: true,
  });
  const wardenRobe = new THREE.MeshStandardMaterial({
    color: 0xa8a29a, roughness: 1.0, flatShading: true,
  });

  const ironRiders = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const k = new THREE.Group();
    const horseBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 3.2), horseMat);
    horseBody.position.y = 1.6;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 1.4), horseMat);
    head.position.set(0, 2.6, 1.5);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.7, 0.9), surcoat);
    body.position.y = 3.2;
    const rider = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5), surcoat);
    rider.position.y = 4.3;
    k.add(horseBody, head, body, rider);
    k.userData.offset = i * 7;
    ironRiders.add(k);
  }
  scene.add(ironRiders);

  const carrnFolk = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const p = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.55, 1.9, 5), ochreRobe
    );
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 5), ochreRobe);
    head.position.y = 1.25;
    p.add(head);
    p.userData.offset = (i / 16) * 90 + Math.random() * 8;
    p.userData.angle  = Math.PI + (Math.random() - 0.5) * 0.8;
    p.userData.lane   = (Math.random() - 0.5) * 5;
    carrnFolk.add(p);
  }
  scene.add(carrnFolk);

  const stonewardens = new THREE.Group();
  const R = 24, N = 12;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 2.1, 5), wardenRobe
    );
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), wardenRobe);
    head.position.y = 1.35;
    m.add(head);
    m.position.set(Math.cos(ang) * R, 1.05, Math.sin(ang) * R);
    stonewardens.add(m);
  }
  const sh = terrain.heightAt(STONES_POS.x, STONES_POS.z);
  stonewardens.position.set(STONES_POS.x, sh, STONES_POS.z);
  scene.add(stonewardens);

  return { ironRiders, carrnFolk, stonewardens, terrain };
}

function addSkyCarrion(scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x080806, side: THREE.DoubleSide, fog: true, transparent: true, opacity: 0.95,
  });
  for (let i = 0; i < 28; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-1.0, 0);
    shape.lineTo(-0.3, 0.15);
    shape.lineTo(0, 0.05);
    shape.lineTo(0.3, 0.15);
    shape.lineTo(1.0, 0);
    shape.lineTo(0.3, -0.15);
    shape.lineTo(0, -0.05);
    shape.lineTo(-0.3, -0.15);
    shape.lineTo(-1.0, 0);
    const r = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    r.userData.phase  = Math.random() * Math.PI * 2;
    r.userData.radius = 70 + Math.random() * 110;
    r.userData.height = 70 + Math.random() * 70;
    r.userData.speed  = 0.25 + Math.random() * 0.4;
    g.add(r);
  }
  g.position.copy(VILLAGE_POS);
  g.position.y = 0;
  scene.add(g);
  return g;
}

export { HARETH_POS, BONEFOLD_POS };

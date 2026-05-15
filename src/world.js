import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const PALETTE = {
  fog:    0xc9a47a,
  valley: new THREE.Color(0x6b5a3e),
  moss:   new THREE.Color(0x5a5238),
  stone:  new THREE.Color(0x4a4238),
  snow:   new THREE.Color(0xa89a82),
  castle: 0x2a2622,
  fire:   0xffb347,
};

export function buildWorld(scene, renderer) {
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.00028);
  scene.background = new THREE.Color(PALETTE.fog);

  const sky = makeSky(scene, renderer);
  const sun = makeSun(scene);
  scene.add(new THREE.HemisphereLight(0xc9a47a, 0x2b2018, 0.55));

  const terrain = makeTerrain();
  scene.add(terrain.mesh);

  const clouds = makeClouds();
  scene.add(clouds.group);

  const landmarks = makeLandmarks(terrain);
  scene.add(landmarks.group);

  return { sky, sun, terrain, clouds, landmarks };
}

function makeSky(scene, renderer) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const u = sky.material.uniforms;
  u.turbidity.value = 6.0;
  u.rayleigh.value = 1.8;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;

  const elevation = THREE.MathUtils.degToRad(3);
  const azimuth = THREE.MathUtils.degToRad(72);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    Math.PI / 2 - elevation,
    azimuth
  );
  u.sunPosition.value.copy(sunDir);

  return { mesh: sky, sunDir };
}

function makeSun(scene) {
  const sun = new THREE.DirectionalLight(0xffd27a, 2.2);
  const elevation = THREE.MathUtils.degToRad(3);
  const azimuth = THREE.MathUtils.degToRad(72);
  sun.position.setFromSphericalCoords(2000, Math.PI / 2 - elevation, azimuth);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 3000;
  const s = 800;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}

function makeTerrain() {
  const SIZE = 8000;
  const SEG = 256;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const heights = new Float32Array(pos.count);

  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    heights[i] = h;
    colorForHeight(h, c);
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  return { mesh, heightAt, SIZE };
}

function fbm(x, z) {
  let v = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * pseudoNoise(x * freq, z * freq);
    freq *= 2.07;
    amp *= 0.5;
  }
  return v;
}

function pseudoNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const n00 = hash2(xi, zi);
  const n10 = hash2(xi + 1, zi);
  const n01 = hash2(xi, zi + 1);
  const n11 = hash2(xi + 1, zi + 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

function hash2(x, z) {
  let n = (x * 374761393 + z * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return ((n >>> 0) / 4294967295) * 2 - 1;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const CASTLE_POS = new THREE.Vector3(900, 0, -1200);
const VILLAGE_POS = new THREE.Vector3(-700, 0, 600);
const STONES_POS = new THREE.Vector3(1400, 0, 1500);

function heightAt(x, z) {
  const base = fbm(x * 0.0009, z * 0.0009) * 220;
  const ridges = Math.pow(Math.abs(fbm(x * 0.0003, z * 0.0003)), 0.6) * 480;
  let h = base + ridges;

  const peakDx = x - CASTLE_POS.x;
  const peakDz = z - CASTLE_POS.z;
  const peakD = Math.sqrt(peakDx * peakDx + peakDz * peakDz);
  const peakBoost = Math.max(0, 1 - peakD / 700);
  h += peakBoost * peakBoost * 540;

  const vDx = x - VILLAGE_POS.x;
  const vDz = z - VILLAGE_POS.z;
  const vD = Math.sqrt(vDx * vDx + vDz * vDz);
  const valleyDip = Math.max(0, 1 - vD / 350);
  h -= valleyDip * valleyDip * 220;

  return h;
}

function colorForHeight(h, out) {
  if (h < 80) {
    out.copy(PALETTE.valley);
  } else if (h < 300) {
    out.copy(PALETTE.valley).lerp(PALETTE.moss, (h - 80) / 220);
  } else if (h < 500) {
    out.copy(PALETTE.moss).lerp(PALETTE.stone, (h - 300) / 200);
  } else {
    out.copy(PALETTE.stone).lerp(PALETTE.snow, Math.min(1, (h - 500) / 220));
  }
}

function makeClouds() {
  const group = new THREE.Group();
  const layers = [];
  const layerAlts = [380, 400, 420, 440, 460];
  const cloudTex = makeCloudTexture();

  for (let i = 0; i < layerAlts.length; i++) {
    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0xfff2dc,
      fog: true,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = layerAlts[i];
    m.renderOrder = 1;
    group.add(m);
    layers.push({ mesh: m, drift: 0.5 + i * 0.15 });
  }

  return { group, layers };
}

function makeCloudTexture() {
  const N = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = x / N * 6;
      const fy = y / N * 6;
      let v = 0;
      v += pseudoNoise(fx, fy) * 0.5;
      v += pseudoNoise(fx * 2, fy * 2) * 0.25;
      v += pseudoNoise(fx * 4, fy * 4) * 0.125;
      v = (v + 1) * 0.5;
      v = Math.max(0, v - 0.45) * 2.2;
      v = Math.min(1, v);
      const i = (y * N + x) * 4;
      img.data[i + 0] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.floor(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 4;
  return tex;
}

function makeLandmarks(terrain) {
  const group = new THREE.Group();
  group.add(makeCastle(terrain));
  group.add(makeVillage(terrain));
  group.add(makeStandingStones(terrain));
  return { group };
}

function makeCastle(terrain) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.castle,
    roughness: 0.9,
    flatShading: true,
  });

  const baseH = 60;
  const base = new THREE.Mesh(new THREE.BoxGeometry(70, baseH, 70), mat);
  base.position.y = baseH / 2;
  base.castShadow = true;
  g.add(base);

  for (const [dx, dz, h] of [
    [-30, -30, 90],
    [30, -30, 70],
    [-30, 30, 50],
    [30, 30, 110],
  ]) {
    const towerGeo = new THREE.CylinderGeometry(10, 12, h, 8);
    const tower = new THREE.Mesh(towerGeo, mat);
    tower.position.set(dx, baseH + h / 2, dz);
    tower.castShadow = true;
    g.add(tower);

    if (h !== 50) {
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(12, 18, 8),
        mat
      );
      cap.position.set(dx, baseH + h + 9, dz);
      g.add(cap);
    } else {
      const rubble = new THREE.Mesh(
        new THREE.IcosahedronGeometry(10, 0),
        mat
      );
      rubble.position.set(dx + 4, baseH + h + 4, dz - 3);
      rubble.rotation.set(0.7, 1.2, 0.3);
      g.add(rubble);
    }
  }

  const h = terrain.heightAt(CASTLE_POS.x, CASTLE_POS.z);
  g.position.set(CASTLE_POS.x, h - 10, CASTLE_POS.z);
  return g;
}

function makeVillage(terrain) {
  const g = new THREE.Group();
  const hutMat = new THREE.MeshStandardMaterial({
    color: 0x3c2a1c,
    roughness: 0.9,
    flatShading: true,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x1f1410,
    roughness: 1.0,
    flatShading: true,
  });
  const emberMat = new THREE.MeshStandardMaterial({
    color: PALETTE.fire,
    emissive: PALETTE.fire,
    emissiveIntensity: 4,
  });

  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2;
    const r = 40 + Math.random() * 60;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const w = 14 + Math.random() * 6;
    const hh = 8 + Math.random() * 3;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), hutMat);
    hut.position.set(x, hh / 2, z);
    hut.rotation.y = Math.random() * Math.PI;
    g.add(hut);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.75, hh * 0.9, 4),
      roofMat
    );
    roof.position.set(x, hh + hh * 0.45, z);
    roof.rotation.y = hut.rotation.y + Math.PI / 4;
    g.add(roof);
    if (i % 2 === 0) {
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(2, 6, 6),
        emberMat
      );
      ember.position.set(x, hh + 2, z);
      g.add(ember);
    }
  }

  const fireLight = new THREE.PointLight(PALETTE.fire, 8, 400, 1.2);
  fireLight.position.y = 30;
  g.add(fireLight);
  g.userData.fireLight = fireLight;

  const smokeGeo = new THREE.PlaneGeometry(160, 700);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x1a1410,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: true,
  });
  const smoke = new THREE.Mesh(smokeGeo, smokeMat);
  smoke.position.y = 350;
  g.add(smoke);
  g.userData.smoke = smoke;

  const h = terrain.heightAt(VILLAGE_POS.x, VILLAGE_POS.z);
  g.position.set(VILLAGE_POS.x, h, VILLAGE_POS.z);
  return g;
}

function makeStandingStones(terrain) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2e,
    roughness: 0.95,
    flatShading: true,
  });
  const N = 12;
  const R = 40;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const x = Math.cos(ang) * R;
    const z = Math.sin(ang) * R;
    const h = 14 + Math.random() * 6;
    const s = new THREE.Mesh(new THREE.BoxGeometry(5, h, 3), mat);
    s.position.set(x, h / 2, z);
    s.rotation.set(
      (Math.random() - 0.5) * 0.2,
      Math.random() * Math.PI,
      (Math.random() - 0.5) * 0.2
    );
    s.castShadow = true;
    g.add(s);
  }
  const h = terrain.heightAt(STONES_POS.x, STONES_POS.z);
  g.position.set(STONES_POS.x, h, STONES_POS.z);
  return g;
}

export function updateWorld(world, dt, t, camera) {
  for (const layer of world.clouds.layers) {
    const tex = layer.mesh.material.map;
    tex.offset.x += dt * 0.005 * layer.drift;
    tex.offset.y += dt * 0.002 * layer.drift;
  }
  const smoke = world.landmarks.group.children[1]?.userData?.smoke;
  if (smoke) {
    smoke.lookAt(camera.position.x, smoke.position.y, camera.position.z);
    smoke.material.opacity = 0.5 + Math.sin(t * 0.8) * 0.08;
  }
  const fire = world.landmarks.group.children[1]?.userData?.fireLight;
  if (fire) {
    fire.intensity = 7 + Math.sin(t * 6.3) * 1.5 + Math.sin(t * 13.1) * 0.6;
  }
}

export { CASTLE_POS, VILLAGE_POS, STONES_POS };

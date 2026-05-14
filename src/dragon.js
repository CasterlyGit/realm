import * as THREE from 'three';

export const DRAGON_CATALOG = {
  pyrothar: {
    name: 'Pyrothar',
    subtitle: 'The Crimson King',
    blurb: 'Stocky bat-winged drake. Fire breath, ember trail. Slow turn, heavy hits.',
    palette: { primary: '#ff4d1a', secondary: '#ffd23f', accent: '#9a1010' },
    build: buildPyrothar,
  },
  ryujin: {
    name: 'Ryujin',
    subtitle: 'The Sky River',
    blurb: 'Eastern serpent. No wings — undulates through air. Sharp turn, electric breath.',
    palette: { primary: '#1a6bff', secondary: '#f5f8ff', accent: '#ffd700' },
    build: buildRyujin,
  },
  verdantis: {
    name: 'Verdantis',
    subtitle: 'The Jade Serpent',
    blurb: 'Feathered wings of rainbow plates. Cherry-blossom aura. Balanced flight.',
    palette: { primary: '#1fcf6b', secondary: '#ffb3d9', accent: '#ffd700' },
    build: buildVerdantis,
  },
  cryos: {
    name: 'Cryos',
    subtitle: 'The Frostbloom',
    blurb: 'Crystal-faceted wings. Snowflake trail. Lean, fast, glass-cannon.',
    palette: { primary: '#a0e6ff', secondary: '#ffffff', accent: '#1a4dff' },
    build: buildCryos,
  },
};

export function makeDragon(key, opts = {}) {
  const def = DRAGON_CATALOG[key] || DRAGON_CATALOG.pyrothar;
  const dragon = def.build(opts);
  dragon.userData.archetype = key;
  dragon.userData.def = def;
  dragon.userData.phase = Math.random() * Math.PI * 2;
  dragon.userData.damage = 0;
  return dragon;
}

function flatMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.15,
    flatShading: true,
    ...opts.extra,
  });
}
function emissiveMat(color, intensity = 4) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity,
  });
}

function segmentedChain(count, startR, endR, length, mat, taperBack = false) {
  const g = new THREE.Group();
  const segs = [];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const r = THREE.MathUtils.lerp(startR, endR, t);
    const segLen = length / count;
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.9, segLen * 1.06, 8),
      mat
    );
    seg.position.z = (taperBack ? -1 : 1) * i * segLen;
    seg.rotation.x = Math.PI / 2;
    seg.castShadow = true;
    g.add(seg);
    segs.push(seg);
  }
  g.userData.segments = segs;
  g.userData.segLen = length / count;
  return g;
}

// ─── PYROTHAR ─────────────────────────────────────────────────────────────
function buildPyrothar() {
  const root = new THREE.Group();
  const body = flatMat(0xff4d1a, { roughness: 0.55, metalness: 0.25 });
  const belly = flatMat(0xffd23f, { roughness: 0.7 });
  const wing = flatMat(0x9a1010, { roughness: 0.85, extra: { side: THREE.DoubleSide } });
  const horn = flatMat(0x3a0e0e, { roughness: 0.9 });
  const eyeM = emissiveMat(0xffff00, 5);
  const flameM = emissiveMat(0xff7a14, 6);

  const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 2), body);
  chest.scale.set(1.4, 1.15, 1.6); chest.position.set(0, 0, -1.0); chest.castShadow = true;
  root.add(chest);
  const hips = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 2), body);
  hips.scale.set(1.2, 1.0, 1.7); hips.position.set(0, -0.1, 1.3); hips.castShadow = true;
  root.add(hips);
  const bellyM = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), belly);
  bellyM.scale.set(0.95, 0.55, 2.6); bellyM.position.set(0, -0.85, 0.1);
  root.add(bellyM);

  const neck = segmentedChain(8, 0.85, 0.45, 3.5, body);
  neck.position.set(0, 0.55, -2.2); neck.rotation.x = -0.3;
  root.add(neck);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), body);
  head.position.set(0, 1.6, -5.5); head.scale.set(1.05, 0.95, 1.5);
  root.add(head);
  const jaw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), body);
  jaw.position.set(0, 1.1, -6.0); jaw.scale.set(0.9, 0.5, 1.5);
  root.add(jaw);

  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 6), horn);
    h.position.set(side * 0.45, 2.0, -5.3);
    h.rotation.set(-0.7, 0, side * 0.4);
    root.add(h);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), eyeM);
    eye.position.set(side * 0.38, 1.65, -6.0);
    root.add(eye);
  }

  const tail = segmentedChain(10, 0.6, 0.12, 5.5, body, false);
  tail.position.set(0, 0.05, 2.2); tail.rotation.x = 0.18;
  root.add(tail);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), flameM);
  flame.position.z = 5.7; tail.add(flame);

  const wingL = makeBatWing(-1, wing, horn, 1.0);
  const wingR = makeBatWing(1, wing, horn, 1.0);
  wingL.position.set(-1.1, 0.95, -0.8);
  wingR.position.set(1.1, 0.95, -0.8);
  root.add(wingL, wingR);

  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const z = -2.5 + t * 8.2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5 - Math.abs(t - 0.4) * 0.35, 4), horn);
    spike.position.set(0, 1.0 - Math.abs(t - 0.4) * 0.25, z);
    spike.rotation.x = -0.1;
    root.add(spike);
  }

  const mouth = new THREE.Object3D();
  mouth.position.set(0, 1.25, -6.4);
  root.add(mouth);

  root.userData = {
    chest, hips, neck, head, jaw, tail, wingL, wingR, mouth,
    eyes: eyeM, flame: flameM, bodyMat: body, color: new THREE.Color(0xff4d1a),
    auraColor: 0xff7a14,
  };
  return root;
}

// ─── RYUJIN ────────────────────────────────────────────────────────────────
function buildRyujin() {
  const root = new THREE.Group();
  const body = flatMat(0x1a6bff, { roughness: 0.4, metalness: 0.4 });
  const mane = flatMat(0xf5f8ff, { roughness: 0.95 });
  const gold = flatMat(0xffd700, { roughness: 0.35, metalness: 0.7 });
  const eyeM = emissiveMat(0x00ffff, 5);

  const SEGS = 26;
  const segments = [];
  for (let i = 0; i < SEGS; i++) {
    const t = i / (SEGS - 1);
    const r = 0.85 - Math.abs(t - 0.3) * 0.35 - t * 0.15;
    const seg = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.12, r), 10, 8),
      body
    );
    seg.scale.z = 1.5;
    seg.castShadow = true;
    root.add(seg);
    segments.push(seg);
  }

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), body);
  head.scale.set(1.1, 0.85, 1.4);
  root.add(head);

  const snout = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), body);
  snout.scale.set(0.85, 0.65, 1.5);
  root.add(snout);
  head.userData.snout = snout;

  const maneBall = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), mane);
  maneBall.scale.set(1.3, 1.1, 0.9);
  root.add(maneBall);
  head.userData.mane = maneBall;

  for (const side of [-1, 1]) {
    const antler = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.2, 5), gold);
    stem.position.y = 0.5;
    stem.rotation.set(-0.4, 0, side * 0.3);
    antler.add(stem);
    for (let i = 0; i < 3; i++) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.55, 5), gold);
      branch.position.set(side * (0.18 + i * 0.05), 1.0 + i * 0.18, -0.05);
      branch.rotation.set(-0.6, 0, side * (0.8 + i * 0.2));
      antler.add(branch);
    }
    root.add(antler);
    head.userData['antler' + (side > 0 ? 'R' : 'L')] = antler;

    const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 2.2, 5), mane);
    whisker.rotation.set(0, 0, side * 0.4);
    root.add(whisker);
    head.userData['whisker' + (side > 0 ? 'R' : 'L')] = whisker;

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), eyeM);
    root.add(eye);
    head.userData['eye' + (side > 0 ? 'R' : 'L')] = eye;
  }

  // small vestigial fins instead of wings (for visual punch)
  const finMat = flatMat(0x1a6bff, { extra: { side: THREE.DoubleSide } });
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 1.6, 0.6);
    shape.lineTo(side * 2.2, 0.0);
    shape.lineTo(side * 1.8, -0.8);
    shape.lineTo(side * 0.4, -0.4);
    shape.lineTo(0, 0);
    const fin = new THREE.Mesh(new THREE.ShapeGeometry(shape), finMat);
    fin.rotation.x = -Math.PI / 2;
    root.add(fin);
    if (side < 0) root.userData.finL = fin;
    else root.userData.finR = fin;
  }

  // spine of gold scales
  for (let i = 0; i < SEGS; i += 1) {
    const t = i / (SEGS - 1);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4 - Math.abs(t - 0.3) * 0.2, 4), gold);
    fin.userData.seg = i;
    fin.userData.offset = 0.3 + Math.max(0.1, 0.85 - Math.abs(t - 0.3) * 0.35 - t * 0.15);
    root.add(fin);
    segments[i].userData.spineFin = fin;
  }

  const mouth = new THREE.Object3D();
  root.add(mouth);

  root.userData = {
    segments, head, mouth,
    eyes: eyeM, bodyMat: body,
    color: new THREE.Color(0x1a6bff),
    auraColor: 0x00ffff,
    serpentine: true,
  };
  return root;
}

// ─── VERDANTIS ─────────────────────────────────────────────────────────────
function buildVerdantis() {
  const root = new THREE.Group();
  const body = flatMat(0x1fcf6b, { roughness: 0.5, metalness: 0.25 });
  const belly = flatMat(0xfff0a8, { roughness: 0.8 });
  const gold = flatMat(0xffd700, { roughness: 0.3, metalness: 0.8 });
  const eyeM = emissiveMat(0xff66cc, 5);

  const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 2), body);
  chest.scale.set(1.1, 1.0, 1.9); chest.position.set(0, 0, -0.8); chest.castShadow = true;
  root.add(chest);
  const hips = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 2), body);
  hips.scale.set(1.05, 0.95, 1.7); hips.position.set(0, -0.05, 1.4); hips.castShadow = true;
  root.add(hips);

  const neck = segmentedChain(10, 0.7, 0.32, 4.0, body);
  neck.position.set(0, 0.5, -2.0); neck.rotation.x = -0.25;
  root.add(neck);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), body);
  head.position.set(0, 1.65, -5.5); head.scale.set(1.0, 0.9, 1.5);
  root.add(head);
  const snout = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), body);
  snout.position.set(0, 1.45, -6.2); snout.scale.set(0.85, 0.55, 1.6);
  root.add(snout);

  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 5), gold);
    h.position.set(side * 0.3, 2.0, -5.3);
    h.rotation.set(-0.9, 0, side * 0.25);
    root.add(h);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), eyeM);
    eye.position.set(side * 0.3, 1.7, -5.95);
    root.add(eye);
  }

  // Feather plates along spine and tail (rainbow)
  const rainbow = [0xff5555, 0xff9933, 0xffd23f, 0x55ff88, 0x55cfff, 0xaa66ff];
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    const z = -2.5 + t * 9.5;
    const c = rainbow[i % rainbow.length];
    const featherMat = flatMat(c, { roughness: 0.5, metalness: 0.25 });
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6 - Math.abs(t - 0.4) * 0.25, 4), featherMat);
    f.position.set(0, 1.0 - Math.abs(t - 0.4) * 0.3, z);
    f.rotation.x = -0.2;
    root.add(f);
  }

  const tail = segmentedChain(12, 0.55, 0.08, 6.0, body, false);
  tail.position.set(0, 0.0, 2.4); tail.rotation.x = 0.18;
  root.add(tail);

  // Feathered wings (multiple flat plates)
  const wingL = makeFeatheredWing(-1, body, rainbow);
  const wingR = makeFeatheredWing(1, body, rainbow);
  wingL.position.set(-0.95, 0.9, -0.7);
  wingR.position.set(0.95, 0.9, -0.7);
  root.add(wingL, wingR);

  const mouth = new THREE.Object3D();
  mouth.position.set(0, 1.3, -6.6);
  root.add(mouth);

  root.userData = {
    chest, hips, neck, head, tail, wingL, wingR, mouth,
    eyes: eyeM, bodyMat: body,
    color: new THREE.Color(0x1fcf6b),
    auraColor: 0xff66cc,
  };
  return root;
}

function makeFeatheredWing(side, baseMat, rainbow) {
  const wing = new THREE.Group();
  const flapPivot = new THREE.Group();
  wing.add(flapPivot);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.13, 5.0, 6), baseMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.x = side * 2.5;
  flapPivot.add(arm);
  const featherCount = 7;
  for (let i = 0; i < featherCount; i++) {
    const t = i / (featherCount - 1);
    const c = rainbow[i % rainbow.length];
    const fmat = flatMat(c, { roughness: 0.5, metalness: 0.3, extra: { side: THREE.DoubleSide } });
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 2.5, 0.4);
    shape.lineTo(side * 3.0, -0.1);
    shape.lineTo(side * 2.2, -0.5);
    shape.lineTo(0, -0.2);
    shape.lineTo(0, 0);
    const f = new THREE.Mesh(new THREE.ShapeGeometry(shape), fmat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(side * (0.5 + t * 4.5), 0, -0.5 + t * 1.0);
    f.rotation.y = side * (-t * 0.3);
    flapPivot.add(f);
  }
  wing.userData = { flapPivot };
  return wing;
}

// ─── CRYOS ─────────────────────────────────────────────────────────────────
function buildCryos() {
  const root = new THREE.Group();
  const body = flatMat(0xa0e6ff, { roughness: 0.25, metalness: 0.55 });
  const crystal = flatMat(0xeaf6ff, {
    roughness: 0.1, metalness: 0.05,
    extra: { transparent: true, opacity: 0.7, side: THREE.DoubleSide },
  });
  const dark = flatMat(0x1a4dff, { roughness: 0.3, metalness: 0.8 });
  const eyeM = emissiveMat(0x4488ff, 6);

  const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 1), body);
  chest.scale.set(1.05, 0.95, 1.7); chest.position.set(0, 0, -0.9); chest.castShadow = true;
  root.add(chest);
  const hips = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), body);
  hips.scale.set(1.0, 0.85, 1.6); hips.position.set(0, -0.05, 1.4); hips.castShadow = true;
  root.add(hips);

  const neck = segmentedChain(11, 0.65, 0.28, 4.2, body);
  neck.position.set(0, 0.55, -2.2); neck.rotation.x = -0.25;
  root.add(neck);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65, 1), body);
  head.position.set(0, 1.7, -5.8); head.scale.set(1.0, 0.85, 1.7);
  root.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 5), body);
  snout.position.set(0, 1.55, -6.7); snout.rotation.x = Math.PI / 2;
  root.add(snout);

  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.4, 5), crystal);
    h.position.set(side * 0.35, 2.05, -5.5);
    h.rotation.set(-0.5, 0, side * 0.3);
    root.add(h);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), eyeM);
    eye.position.set(side * 0.3, 1.78, -6.2);
    root.add(eye);
  }

  // Crystal shards growing from back
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const z = -2.4 + t * 6.8;
    const size = 0.5 + Math.random() * 0.5 - Math.abs(t - 0.4) * 0.3;
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.25, size, 5), crystal);
    shard.position.set((Math.random() - 0.5) * 0.5, 1.0, z);
    shard.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    root.add(shard);
  }

  const tail = segmentedChain(13, 0.55, 0.07, 6.5, body, false);
  tail.position.set(0, 0.0, 2.3); tail.rotation.x = 0.2;
  root.add(tail);
  const tailShard = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 5), crystal);
  tailShard.position.z = 6.5; tailShard.rotation.x = Math.PI / 2;
  tail.add(tailShard);

  // Crystal facet wings (faceted plates, not membrane)
  const wingL = makeCrystalWing(-1, dark, crystal);
  const wingR = makeCrystalWing(1, dark, crystal);
  wingL.position.set(-1.0, 1.0, -0.7);
  wingR.position.set(1.0, 1.0, -0.7);
  root.add(wingL, wingR);

  const mouth = new THREE.Object3D();
  mouth.position.set(0, 1.45, -7.2);
  root.add(mouth);

  root.userData = {
    chest, hips, neck, head, tail, wingL, wingR, mouth,
    eyes: eyeM, bodyMat: body,
    color: new THREE.Color(0xa0e6ff),
    auraColor: 0x88ddff,
  };
  return root;
}

function makeCrystalWing(side, boneMat, crystal) {
  const wing = new THREE.Group();
  const flapPivot = new THREE.Group();
  wing.add(flapPivot);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 4.8, 5), boneMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.x = side * 2.4;
  flapPivot.add(arm);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2 - t * 0.5, 4), crystal);
    c.position.set(side * (1.2 + t * 0.9), -0.1, t * 1.5);
    c.rotation.set(Math.PI / 2 + 0.4, 0, side * (Math.PI / 2 + 0.2 + t * 0.15));
    flapPivot.add(c);
  }
  wing.userData = { flapPivot };
  return wing;
}

// ─── SHARED WING (BAT) ─────────────────────────────────────────────────────
function makeBatWing(side, boneMat, darkMat, scale = 1.0) {
  const wing = new THREE.Group();
  const flapPivot = new THREE.Group();
  wing.add(flapPivot);
  const elbow = new THREE.Group();
  flapPivot.add(elbow);
  const humerus = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 2.4 * scale, 6), darkMat);
  humerus.rotation.z = Math.PI / 2;
  humerus.position.x = side * 1.2 * scale;
  flapPivot.add(humerus);
  elbow.position.x = side * 2.4 * scale;
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 2.6 * scale, 6), darkMat);
  forearm.rotation.z = Math.PI / 2;
  forearm.position.x = side * 1.3 * scale;
  elbow.add(forearm);
  const lens = [3.8, 3.2, 2.6, 2.0].map(v => v * scale);
  const angles = [-0.05, -0.35, -0.7, -1.1];
  const tips = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.04, lens[i], 5), darkMat);
    f.rotation.z = side * (Math.PI / 2 + angles[i] * 0.4);
    f.position.x = side * (lens[i] / 2);
    f.rotation.x = angles[i] * 0.4;
    elbow.add(f);
    tips.push(new THREE.Vector3(
      side * (Math.cos(angles[i] * 0.4) * lens[i] + 2.6 * scale),
      0,
      Math.sin(angles[i]) * lens[i] * 1.1
    ));
  }
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(side * 2.2 * scale, -0.6);
  for (const t of tips) shape.lineTo(t.x, t.z);
  shape.lineTo(side * 0.4 * scale, 1.0);
  shape.lineTo(0, 0);
  const membrane = new THREE.Mesh(new THREE.ShapeGeometry(shape), boneMat);
  membrane.rotation.x = -Math.PI / 2;
  flapPivot.add(membrane);
  wing.userData = { flapPivot, elbow };
  return wing;
}

// ─── ANIMATION ─────────────────────────────────────────────────────────────
export function animateDragon(dragon, t, dt, flapBoost = 0) {
  const u = dragon.userData;
  if (u.serpentine) animateSerpentine(dragon, t, dt);
  else animateWinged(dragon, t, dt, flapBoost);
}

function animateWinged(dragon, t, dt, flapBoost) {
  const u = dragon.userData;
  const freq = 1.3 + flapBoost * 1.2;
  const amp = 0.55 + flapBoost * 0.3;
  const phase = u.phase + t * freq * Math.PI * 2;
  const flap = Math.sin(phase);
  if (u.wingL && u.wingL.userData.flapPivot) {
    u.wingL.userData.flapPivot.rotation.z = -flap * amp;
    u.wingR.userData.flapPivot.rotation.z = flap * amp;
    u.wingL.userData.flapPivot.rotation.y = Math.cos(phase) * 0.18;
    u.wingR.userData.flapPivot.rotation.y = -Math.cos(phase) * 0.18;
    if (u.wingL.userData.elbow) {
      u.wingL.userData.elbow.rotation.y = Math.cos(phase) * 0.25;
      u.wingR.userData.elbow.rotation.y = -Math.cos(phase) * 0.25;
    }
  }
  if (u.chest) u.chest.position.y = flap * 0.04;
  if (u.hips) u.hips.position.y = -0.05 + flap * 0.03;
  if (u.tail) {
    u.tail.rotation.y = Math.sin(phase * 0.6) * 0.1;
    u.tail.rotation.x = 0.15 + Math.sin(phase * 0.5) * 0.05;
  }
  if (u.flame) u.flame.emissiveIntensity = 5 + Math.sin(t * 8) * 1.5;
}

function animateSerpentine(dragon, t, dt) {
  const u = dragon.userData;
  const segs = u.segments;
  const phase = u.phase + t * 2.0;
  const segLen = 0.85;
  let prev = new THREE.Vector3(0, 0, -segs.length * segLen);
  for (let i = 0; i < segs.length; i++) {
    const k = i * 0.28;
    const wave = Math.sin(phase - k) * 0.3;
    const yWave = Math.sin(phase * 0.7 - k) * 0.15;
    const z = -i * segLen;
    const x = wave * (0.5 + i * 0.05);
    const y = yWave * (0.5 + i * 0.04);
    segs[i].position.set(x, y, z);
    if (segs[i].userData.spineFin) {
      const f = segs[i].userData.spineFin;
      f.position.set(x, y + f.userData.offset, z);
    }
    if (i === 0) prev = segs[0].position.clone();
  }
  // head follows segment 0 forward
  if (u.head) {
    const s0 = segs[0].position;
    u.head.position.set(s0.x, s0.y + 0.2, s0.z - 1.5);
    if (u.head.userData.snout) u.head.userData.snout.position.set(s0.x, s0.y + 0.15, s0.z - 2.4);
    if (u.head.userData.mane) u.head.userData.mane.position.set(s0.x, s0.y, s0.z - 0.5);
    if (u.head.userData.antlerL) u.head.userData.antlerL.position.set(s0.x - 0.3, s0.y + 0.5, s0.z - 1.4);
    if (u.head.userData.antlerR) u.head.userData.antlerR.position.set(s0.x + 0.3, s0.y + 0.5, s0.z - 1.4);
    if (u.head.userData.whiskerL) {
      const w = u.head.userData.whiskerL;
      w.position.set(s0.x - 0.6, s0.y + 0.1, s0.z - 2.2);
      w.rotation.z = 0.4 + Math.sin(t * 3) * 0.2;
    }
    if (u.head.userData.whiskerR) {
      const w = u.head.userData.whiskerR;
      w.position.set(s0.x + 0.6, s0.y + 0.1, s0.z - 2.2);
      w.rotation.z = -0.4 - Math.sin(t * 3) * 0.2;
    }
    if (u.head.userData.eyeL) u.head.userData.eyeL.position.set(s0.x - 0.25, s0.y + 0.3, s0.z - 2.0);
    if (u.head.userData.eyeR) u.head.userData.eyeR.position.set(s0.x + 0.25, s0.y + 0.3, s0.z - 2.0);
  }
  if (dragon.userData.finL) dragon.userData.finL.rotation.z = Math.sin(t * 4) * 0.2;
  if (dragon.userData.finR) dragon.userData.finR.rotation.z = -Math.sin(t * 4) * 0.2;
  // mouth = where the head is
  if (u.mouth) u.mouth.position.set(segs[0].position.x, segs[0].position.y + 0.1, segs[0].position.z - 2.8);
}

export function setDragonDamage(dragon, frac) {
  const u = dragon.userData;
  u.damage = frac;
  const dark = u.color.clone().multiplyScalar(1 - 0.4 * frac);
  if (u.bodyMat) u.bodyMat.color.copy(dark);
}

export function dragonHeadWorld(dragon, out = new THREE.Vector3()) {
  return dragon.userData.mouth.getWorldPosition(out);
}

export function dragonForward(dragon, out = new THREE.Vector3()) {
  out.set(0, 0, -1).applyQuaternion(dragon.quaternion);
  return out;
}

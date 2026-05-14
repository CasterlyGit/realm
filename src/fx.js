import * as THREE from 'three';

export function makeFireBreath(scene) {
  const MAX = 400;
  const positions = new Float32Array(MAX * 3);
  const velocities = new Float32Array(MAX * 3);
  const ages = new Float32Array(MAX);
  const lives = new Float32Array(MAX);
  const sizes = new Float32Array(MAX);

  for (let i = 0; i < MAX; i++) lives[i] = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: window.devicePixelRatio || 1 },
      uViewportH: { value: window.innerHeight },
    },
    vertexShader: `
      attribute float aAge;
      attribute float aLife;
      attribute float aSize;
      varying float vT;
      uniform float uPixelRatio;
      uniform float uViewportH;
      void main() {
        vT = aLife > 0.0 ? clamp(aAge / aLife, 0.0, 1.0) : 1.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float sz = aSize * (1.0 + vT * 3.0);
        gl_PointSize = sz * uPixelRatio * (uViewportH * 0.5) / max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vT;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.05, d);
        vec3 hot = vec3(1.0, 0.98, 0.85);
        vec3 mid = vec3(1.0, 0.55, 0.10);
        vec3 cool = vec3(0.75, 0.10, 0.04);
        vec3 smoke = vec3(0.10, 0.08, 0.07);
        vec3 col = mix(hot, mid, smoothstep(0.05, 0.35, vT));
        col = mix(col, cool, smoothstep(0.35, 0.7, vT));
        col = mix(col, smoke, smoothstep(0.7, 1.0, vT));
        float alpha = soft * (1.0 - smoothstep(0.75, 1.0, vT));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;

  function emit(origin, dir, count, speed) {
    for (let n = 0; n < count; n++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      positions[i * 3 + 0] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      const spreadAng = 0.25 * Math.random();
      const spreadDir = Math.random() * Math.PI * 2;
      const side = new THREE.Vector3(1, 0, 0);
      const up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(dir.y) < 0.9) side.crossVectors(dir, up).normalize();
      else side.set(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(side, dir).normalize();
      const localOffset = side
        .multiplyScalar(Math.cos(spreadDir) * Math.sin(spreadAng))
        .add(u.multiplyScalar(Math.sin(spreadDir) * Math.sin(spreadAng)));
      const v = dir
        .clone()
        .multiplyScalar(Math.cos(spreadAng))
        .add(localOffset)
        .normalize()
        .multiplyScalar(speed * (0.85 + Math.random() * 0.3));
      velocities[i * 3 + 0] = v.x;
      velocities[i * 3 + 1] = v.y;
      velocities[i * 3 + 2] = v.z;
      ages[i] = 0;
      lives[i] = 0.7 + Math.random() * 0.4;
      sizes[i] = 0.4 + Math.random() * 0.5;
    }
  }

  function update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (lives[i] <= 0) continue;
      ages[i] += dt;
      if (ages[i] >= lives[i]) {
        lives[i] = 0;
        ages[i] = 0;
        sizes[i] = 0;
        positions[i * 3 + 0] = 0;
        positions[i * 3 + 1] = -10000;
        positions[i * 3 + 2] = 0;
        continue;
      }
      positions[i * 3 + 0] += velocities[i * 3 + 0] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3 + 0] *= 0.98;
      velocities[i * 3 + 1] *= 0.98;
      velocities[i * 3 + 2] *= 0.98;
      velocities[i * 3 + 1] += 0.6 * dt;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
    geo.attributes.aLife.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  function onResize() {
    mat.uniforms.uPixelRatio.value = window.devicePixelRatio || 1;
    mat.uniforms.uViewportH.value = window.innerHeight;
  }

  return { points, emit, update, onResize };
}

export function makeSpeedStreaks(scene) {
  const N = 220;
  const positions = new Float32Array(N * 3);
  const alphas = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    alphas[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uIntensity: { value: 0.0 },
      uPixelRatio: { value: window.devicePixelRatio || 1 },
    },
    vertexShader: `
      attribute float aAlpha;
      varying float vA;
      uniform float uPixelRatio;
      void main() {
        vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 2.0 * uPixelRatio;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vA;
      uniform float uIntensity;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = vA * uIntensity * (1.0 - d * 2.0);
        gl_FragColor = vec4(0.95, 0.95, 1.0, a);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  function update(camera, dt, speedNorm) {
    const target = Math.max(0, (speedNorm - 0.3) * 1.4);
    mat.uniforms.uIntensity.value +=
      (target - mat.uniforms.uIntensity.value) * Math.min(1, dt * 4);
    points.position.copy(camera.position);
    const pos = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      let x = pos.array[i * 3 + 0];
      let y = pos.array[i * 3 + 1];
      let z = pos.array[i * 3 + 2];
      const local = new THREE.Vector3(x, y, z);
      const world = local.clone().applyQuaternion(camera.quaternion);
      const forwardDot = world.z;
      if (forwardDot > 0 && Math.abs(world.x) < 40 && Math.abs(world.y) < 40) {
        pos.array[i * 3 + 0] = (Math.random() - 0.5) * 60;
        pos.array[i * 3 + 1] = (Math.random() - 0.5) * 60;
        pos.array[i * 3 + 2] = -40 - Math.random() * 30;
        const back = new THREE.Vector3(
          pos.array[i * 3 + 0],
          pos.array[i * 3 + 1],
          pos.array[i * 3 + 2]
        ).applyQuaternion(camera.quaternion);
        pos.array[i * 3 + 0] = back.x;
        pos.array[i * 3 + 1] = back.y;
        pos.array[i * 3 + 2] = back.z;
      } else {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
        const drift = 60 * dt * (speedNorm + 0.1);
        pos.array[i * 3 + 0] += fwd.x * drift;
        pos.array[i * 3 + 1] += fwd.y * drift;
        pos.array[i * 3 + 2] += fwd.z * drift;
      }
    }
    pos.needsUpdate = true;
  }

  function onResize() {
    mat.uniforms.uPixelRatio.value = window.devicePixelRatio || 1;
  }

  return { points, update, onResize };
}

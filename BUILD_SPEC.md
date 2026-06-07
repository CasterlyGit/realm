# REALM — Build Spec (module interface contract)

You are implementing ONE leaf module of a Three.js dragon-flight game called **Realm**.
A reimagined, serene-yet-thrilling **flow-flight** game: soar a dragon through a stylized
golden-hour dreamworld of floating islands, fly through glowing rings, collect light-motes,
breathe radiant fire to shatter shadow-crystals, across three zones to an aurora finale.

**Aesthetic:** Journey / Monument Valley / Sky:CotL. Smooth gradient skies, FLAT-SHADED
elegant low-poly geometry, atmospheric fog, glowing motes. NEVER pixelated, blocky, or dark.

## Hard rules (every module)

1. `import * as THREE from 'three';` and `import { ... } from './constants.js';` — NO other deps.
   (Three.js v0.184 is installed. Web Audio API is allowed for audio.js. No npm installs.)
2. **THERMAL is the #1 constraint** — the game must not heat the laptop:
   - NO shadows, NO EffectComposer / postprocessing, NO point/spot lights (scene has exactly
     1 DirectionalLight + 1 HemisphereLight, owned by engine — do not add lights).
   - Fake all glow with `emissive` materials + additive sprites/halos (`AdditiveBlending`,
     `depthWrite:false`, `transparent:true`). 
   - Lit geometry: `MeshLambertMaterial({ flatShading:true })` (cheap per-vertex). Unlit/glow:
     `MeshBasicMaterial`. Avoid MeshStandard/Toon/Physical.
   - Use `THREE.InstancedMesh` for repeated objects (islands, stars). Bounded particle counts
     (pool ≤ `RENDER.MAX_PARTICLES` total across fx). Low-poly: ≤300 tris/island, dragon ≤2500.
   - **No per-frame allocations in update loops** — reuse module-scoped temp `THREE.Vector3`/
     `Quaternion`/`Color`. Pre-build geometry/materials once.
3. **Frame-rate independence**: all motion uses `dt` (seconds). For smoothing use
   `damp(cur, target, k, dt)` from constants (= `target + (cur-target)*exp(-k*dt)`).
4. Every module is a **factory function** returning a plain object with the exact methods below.
   Export EXACTLY the named function. Self-contained, no globals. Target < ~360 lines.
5. Any texture must be generated procedurally via `CanvasTexture` (NO external image files).
6. Be defensive: guard empty lists / missing DOM. Never throw in `update`.
7. Write the COMPLETE file to the given path. It must `vite build` with zero errors.

## Shared per-frame context `ctx` (passed to every `update(dt, ctx)`)

```js
ctx = {
  time,                       // Number — seconds since game start (monotonic)
  player: {
    pos:      THREE.Vector3,  // dragon world position (read-only)
    prevPos:  THREE.Vector3,  // position last frame
    quat:     THREE.Quaternion,
    forward:  THREE.Vector3,  // unit forward (local -Z transformed)
    right:    THREE.Vector3,  // unit right
    up:       THREE.Vector3,  // unit up
    speed:    Number,         // m/s
    speedNorm:Number,         // 0..1 over [SPEED_MIN, SPEED_MAX]
    dist:     Number,         // cumulative forward distance traveled
    glideFall:Boolean,        // true during soft-fail
  },
  zone: { index, blend, data, next }, // index 0..2; blend 0..1 progress within current zone;
                                       // data = ZONES[index]; next = ZONES[min(index+1,2)]
  camera: THREE.PerspectiveCamera,
}
```
Modules MUST NOT mutate `ctx.player` or `ctx.camera` transforms (flight.js owns those).
To tint per zone, lerp between `ctx.zone.data` colors and `ctx.zone.next` colors by `ctx.zone.blend`.

---

## Modules to implement (one per agent)

### `src/dragon.js` → `export function makeDragon()`
Procedural hero dragon. flight.js sets `group.position`/`group.quaternion` each frame BEFORE
`dragon.update`, so animate sub-parts relative to the group.
Returns `{ group, update(dt,ctx), headWorld(outV3), setFiring(bool), setBoost(bool), dispose() }`
- `group`: THREE.Group, dragon faces local **-Z**. Elegant serpentine silhouette: long neck +
  head, tapered body, two large swept wings (membrane = `MeshBasicMaterial`, DoubleSide,
  transparent ~0.72, depthWrite:false, zone-accent tint), forked tail. Body =
  `MeshLambertMaterial({flatShading:true})` dark dorsal scale. A separate **emissive belly panel**
  (`MeshBasicMaterial`, color = zone `dragonEmissive`). Eyes = small emissive dots +
  tiny additive glow sprite (color = zone `dragonEye`). NO point light.
- Wing flap: `Math.sin(time*flapFreq)` rotating two wing roots; flapFreq rises slightly with
  speed; bigger amplitude when slow. Subtle neck/tail sway.
- **Trail ribbon**: ring buffer of last ~44 group positions → a tapered ribbon mesh (BufferGeometry,
  rebuilt per frame, `AdditiveBlending`, opacity fades 0.6→0 along length, width tapers to 0,
  color = zone `trail`). `setBoost(true)` extends/brightens it.
- Lerp emissive/eye/trail colors by `ctx.zone.blend` between data & next.
- `headWorld(out)`: write the mouth/jaw world position into `out` (fire origin).
- `setFiring(true)`: brighten mouth / show intake glow. Keep ≤2500 tris.

### `src/sky.js` → `export function makeSky(scene)`
Owns the whole sky atmosphere. Returns `{ update(dt,ctx), dispose() }`
- A large **sky dome** (sphere, `BackSide`, custom `ShaderMaterial`) with vertical gradient from
  `skyTop` (zenith) to `skyHorizon`. Follows camera each frame (`mesh.position.copy(ctx.camera.position)`).
  Lerp colors between zone data & next by blend.
- Set `scene.fog = new THREE.Fog(color, near, far)` ONCE, then each frame update its `.color`/
  `.near`/`.far` from zone (lerp). Also set `scene.background = null` (dome is the sky).
- **Sun**: an additive glow sprite (procedural radial CanvasTexture) placed far along
  `zone.sunDir`. Fades out in the aurora zone.
- **Starfield**: `THREE.Points` (~600, single draw call) that fades IN as zone index → 2 (night).
- **Aurora curtains** (only visible zone 2): 3–4 tall additive plane sheets with a vertex-animated
  ShaderMaterial (waving), vertical gradient across `auroraColors`. Opacity ~0.3.
- **God-ray shafts** (subtle, zone 0/1): a few thin additive cones from sun direction, opacity ~0.06.
- **Drifting cloud planes**: 4–6 big additive textured planes (soft radial CanvasTexture) at varied
  altitudes, slowly scrolling. Reposition relative to camera so they never run out.
- All cheap, no postprocessing.

### `src/world.js` → `export function makeWorld(scene)`
Floating-island scenery (decorative — NO collision; flight is open-sky). Returns `{ update(dt,ctx), dispose() }`
- **Islands**: one `THREE.InstancedMesh` (≤120 instances) of a low-poly island chunk
  (Icosahedron/Dodecahedron-based, flatShading Lambert, tinted to zone `terrain`). Distribute in a
  moving band AROUND the flight corridor (keep a clear ~40m radius tube along player path — place
  islands offset laterally/below). **Recycle**: when an instance is behind/beyond ~`RENDER.FAR*0.85`
  from `ctx.player.pos`, reposition it ahead in the forward hemisphere with new random offset +
  scale. Use per-instance matrix updates only on recycle (not every frame).
- **Waterfalls-of-light**: a handful of vertical additive planes hanging beneath some islands,
  UV-scrolling a white→transparent gradient.
- **Distant sky-creatures**: 6–8 billboard planes (procedural silhouette CanvasTexture — bird/manta)
  far out, slow looping arcs, always facing camera.
- **Ambient debris/pollen**: a `THREE.Points` cloud (~300) drifting near the player, zone-accent color.
- Tint everything by zone blend. Keep total tris under budget.

### `src/fx.js` → `export function makeFX(scene)`
Particle system + bursts + fire stream + speed streaks. ONE shared pool (Points) ≤380 + streaks ≤120
(total ≤ `RENDER.MAX_PARTICLES`). Returns:
`{ update(dt,ctx), ringBurst(pos,colorHex), moteBurst(pos,colorHex), shatterBurst(pos,colorHex),
   fire(originV3, dirV3, on, colorHex), setSpeedStreaks(speedNorm), dispose() }`
- Pool: additive Points with a soft circular point sprite (shader or PointsMaterial w/ CanvasTexture).
  Emit functions inject particles (radial bursts: ring=24, mote=12, shatter=20). Particles have
  velocity, age, life, size, color; aged out → recycled. Hard cap respected.
- `fire(origin,dir,on,color)`: while `on`, emit a cone of fast fading particles from origin along dir
  (color = passed). Stops when on=false.
- `setSpeedStreaks(speedNorm)`: drives a separate streak Points layer (forward-moving lines near
  camera, intensity ∝ speedNorm). Reposition around `ctx.camera`.
- Reuse temp vectors; no per-particle allocation in `update`.

### `src/audio.js` → `export function makeAudio()`
Procedural Web Audio (NO audio files). Returns:
`{ start(), setSpeed(n), setZone(i), setMuffle(bool), ring(perfectBool), mote(pitchMult),
   shatter(), fireOn(), fireOff(), boost(bool), finale(), suspend(), resume(), dispose() }`
- `start()` lazily creates `AudioContext` + master gain (call from a user gesture). Until started,
  all methods are safe no-ops. Then start a warm evolving **ambient pad** (detuned sine/triangle
  voices + slow LFO lowpass) and a **wind** layer (looping filtered noise; cutoff+gain track speed).
- `ring(perfect)`: bright detuned sine sweep-up whoosh + sub thump (brighter if perfect).
- `mote(pitchMult)`: FM bell chime (carrier+modulator ratio 2.756, fast mod-index decay, ~1.1s ring).
- `shatter()`: filtered noise burst + low thump.
- `fireOn/Off`: crackle (two noise bands, fast random AM) fading in/out.
- `setMuffle(true)`: lowpass the master (critical-energy ominous filter).
- `finale()`: ascending stacked-fifths swell over ~5s + noise sweep.
- `suspend()/resume()`: `ctx.suspend()/resume()` for blur/focus.
Use the ADSR/frequency values from realm's feel doc style (instant attacks, exponential decays).

### `src/hud.js` → `export function makeHUD(handlers)`
DOM HUD + screens. `handlers = { onStart, onRestart, onResume, onToggleHand, onSetQuality(q),
onSetCool(bool), onMute(bool) }`. Returns:
`{ setScore(n), setCombo(mult), setEnergy(frac01, stateStr), setSpeed(speedNorm),
   setZone(index,name,sub), setDistanceProgress(frac01), showTitle(), hideTitle(),
   showPause(), hidePause(), showEnd(stats), hideEnd(), showZoneBanner(name,sub),
   flash(colorHex, alpha), popScore(x,y,text,colorHex), setHandStatus(text),
   setGlideFall(bool), toast(text), dispose() }`
- Manipulate ONLY these element IDs (they exist in index.html — see ID list at bottom). Wire the
  button clicks to the matching `handlers.*`. `setEnergy` colors the ribbon by `stateStr`
  ('normal'|'low'|'critical'). `setCombo` scales/colors the combo orb (hide at ≤1.0). `flash`
  briefly tints `#screen-flash`. `popScore` shows a floating `+N` div at screen x,y (pool of ~14,
  reused, rise+fade). `showEnd(stats)` fills the end screen with `{score, best, rings, motes, zone}`.
- `stateStr` thresholds come from caller; just render. All transitions via CSS classes already
  defined in style.css (toggle `.show`/`.hide`/state classes). Keep it elegant, no inline ugly styling
  beyond dynamic values (width %, transform, color).

### `src/rings.js` → `export function makeRings(scene)`
Glowing gates spawned along a forward corridor. Returns:
`{ list, update(dt,ctx), onPass(ring), reset(), dispose() }`
- `list`: Array of ring objects `{ pos:Vector3, quat:Quaternion, normal:Vector3, radius:Number,
  active:Boolean, passed:Boolean, perfect:Boolean, mesh, _id }`. (game.js reads these for pass
  detection — do NOT detect passes yourself.)
- Maintain a **spawn frontier**: keep ~14–20 rings active ahead of the player. When the player gets
  within ~`PLAY.RING_CLUSTER_GAP[zone]` of the furthest-ahead ring, spawn the next cluster (a
  hand-authored motif: line / arc / gentle spiral of 4–8 rings) starting at the frontier, advanced
  along a slowly-meandering guide direction (mostly `player.forward`, small sine wander, gentle
  altitude variation), and advance the frontier. Recycle rings far behind the player (`active=false`,
  hide mesh) into the pool.
- Each ring `mesh`: a `TorusGeometry` (radius `PLAY.RING_RADIUS`, low segments) with an emissive
  `MeshBasicMaterial` (color = zone `ringColor`) + an additive halo sprite. `normal` = ring's facing
  axis (along corridor). Gentle pulse/rotation. `onPass(ring)`: pop scale + brighten flash (game.js
  calls it after scoring; also good to spawn nothing — fx handles particles).
- `reset()` clears to initial. First cluster spawns ~140m ahead of start, reachable at cruise.

### `src/foes.js` → `export function makeFoes(scene)`
Shadow crystals + drifting wisps (gentle combat targets). Returns:
`{ list, update(dt,ctx), onShatter(foe), reset(), dispose() }`
- `list`: Array `{ pos:Vector3, radius:Number, hp:Number, hpMax:Number, type:'crystal'|'wisp'|'formation',
  active:Boolean, mesh, _id }`. game.js handles fire-hit + scoring; you handle visuals + motion.
- Spawn one element per `PLAY.FOE_SPACING[zone]` meters of travel, ahead of the player, offset to the
  sides of the corridor (don't block rings). `crystal`: stationary faceted dark-emissive shard
  (Octahedron, flatShading) that pulses (color = zone `foeColor`). `wisp`: slow drifting orb that
  meanders gently toward the player (cap drift speed low — never aggressive). `formation` (zone 2 only,
  rare): a cluster of shards, higher hp. Recycle behind player.
- `onShatter(foe)`: hide mesh, set inactive (game.js calls after hp≤0; fx spawns the burst).
- Crystals/wisps should read as obstacles-to-clear, not threats — no projectiles, no damage to player.

### `src/motes.js` → `export function makeMotes(scene)`
Floating light-motes (energy + score). Returns:
`{ list, update(dt,ctx), spawnAt(pos, value, count), onCollect(mote), reset(), dispose() }`
- `list`: Array `{ pos:Vector3, value:'small'|'pulse'|'crystal'|'aurora', active:Boolean, mesh, _id }`.
- Ambient: drift small/pulse motes near the ring corridor ahead of the player (bob via sin). Tint by
  zone `glow`/`accent`. Each mote = small emissive Basic sphere + additive halo sprite.
- **Magnetism**: each frame, if a mote is within `PLAY.MOTE_MAGNET_R` of the player (use
  `MOTE_MAGNET_R_GLIDE` when `ctx.player.glideFall`), `damp` its position toward the player so it rushes
  in. game.js detects collection (dist < `PLAY.MOTE_COLLECT_R`), sets `mote.active=false`, and calls
  `onCollect(mote)` (you hide it + recycle).
- `spawnAt(pos, value, count)`: drops from shattered foes (called by game.js) — spawn `count` motes
  bursting outward from `pos` then settling, so they can be magnetised in.
- Recycle motes that go far behind the player. Pool ≤ ~120 motes.

---

## index.html element IDs available to hud.js
`#screen-flash` (fullscreen flash), `#title-screen`, `#btn-fly`, `#btn-hand`, `#title-best`,
`#pause-screen`, `#btn-resume`, `#btn-restart-pause`, `#btn-quality`, `#btn-cool`, `#btn-mute`,
`#end-screen`, `#end-score`, `#end-best`, `#end-rings`, `#end-motes`, `#end-zone`, `#btn-restart`,
`#hud`, `#hud-score`, `#hud-combo`, `#hud-combo-num`, `#hud-energy`, `#hud-energy-fill`,
`#hud-zone`, `#hud-zone-name`, `#hud-zone-dots`, `#hud-dist-arc` (svg path), `#hud-speed`,
`#zone-banner`, `#zone-banner-name`, `#zone-banner-sub`, `#hand-status`, `#glidefall-vignette`,
`#popscore-layer`. Assume they exist; guard with `?.` anyway.

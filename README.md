# Realm

A browser-based dragon-flight duel set in the fallen kingdom of Hauthwen. You ride Eira of Aelric on her Morren dragon — three waves of aerial combat against the surviving dragon lines of three rival houses.

**Status:** v0.3 — Hauthwen canon, GLTF-ready, post-FX cinematic grade

**🐉 Play it live: [casterlygit.github.io/realm](https://casterlygit.github.io/realm/)**

## The four dragon lines

The Drake-Oath broke forty winters ago. Nine houses, nine dragon lines, one crown — most of them gone. These four still fly:

| Dragon | House | Eye | Breath |
|---|---|---|---|
| **Morren** | Aelric (yours) | Ember-orange `#FF9A3C` | Tight cone of orange-white fire |
| **Iskari** | The fallen house Iskar | Lightning-yellow `#F0E68C` | Forking pale lightning |
| **Vethrim** | Brennoc | Fog-gold `#C9A47A` | Oily black smoke shot with cinders |
| **Skarn** | Calden | Pale ice `#6FB3C9` | White-blue plasma that melts stone |

The full canon — lore, palette, lighting rules, character bible — lives in [DESIGN.md](DESIGN.md).

## How to play

| Key | Action |
|---|---|
| **W / S** | Pitch up / down |
| **A / D** | Turn left / right (auto-banks) |
| **Q / E** | Manual roll |
| **Space** | Flap (thrust) |
| **Shift** | Sprint |
| **LMB** or **F** | Fire breath (hold) |
| **R** | Signature skill |

### Game loop

1. **Pick a line** on the title screen
2. **Clear Wave 1** — two enemy dragons (the houses you didn't pick)
3. **Collect soul-orbs** between waves — heal, refund cooldown, score
4. **Clear Wave 2** — same enemies, tougher (+20% HP, +15% fire damage)
5. **Beat the FINAL BOSS** — one ascendant enemy, 2.5× HP, 1.6× size, 1.5× damage

## 🖐 Hand control (MediaPipe)

You can fly with your webcam — no keyboard needed. Click **enable hand control** on the dragon-select screen.

| Input | Action |
|---|---|
| Hand position (X/Y) | Continuous yaw + pitch (12% deadzone) |
| **✋ Open palm** | Flap thrust |
| **✊ Closed fist** | Fire breath |
| **✌ Peace sign** | Trigger R-skill |

The gesture vocabulary mirrors my companion project **[CasterlyGit/hand-signal](https://github.com/CasterlyGit/hand-signal)** — `realm` is the browser-side proof that the same six-gesture vocabulary can drive a real-time game, not just yes/no prompts.

## GLTF model upgrade (drop-in)

The four house dragons are built procedurally in [src/dragon.js](src/dragon.js), but each will auto-upgrade to a real GLB if you drop one in:

```
public/models/morren.glb
public/models/iskari.glb
public/models/vethrim.glb
public/models/skarn.glb
```

The loader auto-fits each model to ~11 units, tints toward the house palette, and hot-swaps it in over the procedural body. Missing files stay procedural — no breakage.

CC0 sources: [Sketchfab CC0 dragons](https://sketchfab.com/search?features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b&q=dragon&type=models), [Quaternius](https://quaternius.com/), [Poly Pizza](https://poly.pizza/search/dragon).

## Built with

- [Three.js](https://threejs.org/) — procedural geometry + GLTFLoader for real models
- [Vite](https://vite.dev/) for dev + production builds
- [@mediapipe/tasks-vision](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) — CDN-loaded, GPU-delegated hand tracking
- Three.js built-in `Sky` shader + `FogExp2` for golden-hour atmosphere
- `InstancedMesh` for ~700 forest trees
- `UnrealBloomPass` for skill / fire / eye glow
- Custom color-grade `ShaderPass`: filmic S-curve, warm/cool split-tone, vignette, animated film grain
- Screen-shake on hit, scaled by damage severity

## Roadmap

Shipped:

- [x] v0.1 — playable dragon-flight combat, four archetypes, three waves
- [x] v0.2 — MediaPipe hand control with scouter radar + gesture log
- [x] v0.3 — Hauthwen canon repaint: four house dragons (Morren / Iskari / Vethrim / Skarn), DESIGN.md palette throughout, opening title beat, cinematic color grade, screen-shake on hit, GLTF auto-upgrade

Next:

- [ ] Drop four CC0 GLB dragons in `public/models/` for the visual jump
- [ ] Audio pass — wind bed, breath-attack whoosh, hit impact, death-blow musical sting (bible §9: silence default, music only at death-blow + end card)
- [ ] HUD reduction — bible §9 spec is a single thin warm line for vigor, no numbers. Currently still showing wave/score/skill bars
- [ ] Ground-denizen reactivity — Carrn-folk scatter when a dragon flies low, ravens disperse from corpse circles
- [ ] Boss arena — final wave should swap to the Carrick-na-Dun broken-tower silhouette, not the open moor
- [ ] Replace the four procedural dragon silhouettes on the select-cards with bible-accurate side-views

## Run it locally

```bash
git clone https://github.com/CasterlyGit/realm
cd realm
npm install
npm run dev
```

Open [localhost:5173/realm/](http://localhost:5173/realm/).

## Project layout

```
src/
  main.js       # game loop, input, combat, waves, score, camera, post-FX
  dragon.js     # 4 house builders + GLTF auto-upgrade + shared animation
  world.js      # sky, terrain, clouds, landmarks (Hauthwen palette)
  populate.js   # forests, bridge, bonefold, NPCs, ravens
  fx.js         # fire breath particles, speed streaks
  hand.js       # MediaPipe hand-tracking → game input
  style.css     # HUD + selection screen + opening beat
public/
  models/       # drop morren.glb / iskari.glb / vethrim.glb / skarn.glb here
DESIGN.md       # canonical lore / palette / character bible
```

## License

MIT — fly free.

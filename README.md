# Realm

A browser-based dragon-flight combat game. Pick one of four distinct dragon archetypes — each with a unique body, wings, aura, and signature skill — and clear three escalating waves of aerial combat over a vibrant fantasy realm.

**🐉 Play it live: [casterlygit.github.io/realm](https://casterlygit.github.io/realm/)**

## The dragons

Four archetypes, each genuinely different in silhouette, wings, and ability:

| Dragon | Style | Signature Skill (R) | Cooldown |
|---|---|---|---|
| **Pyrothar** — The Crimson King | Stocky bat-winged fire drake | **INFERNO** — 80m radial fire blast | 12s |
| **Ryujin** — The Sky River | Long Eastern serpent, no bat wings, white mane, gold antlers | **TEMPEST** — forking lightning cone + 2s stun | 10s |
| **Verdantis** — The Jade Serpent | Rainbow-feathered wings, jade body, gold accents | **BLOOM** — heal 40% over 3s + cherry-blossom damage aura | 15s |
| **Cryos** — The Frostbloom | Crystal-facet wings, angular ice-blue body | **FROST NOVA** — 120m ice burst, freezes nearest enemy 3s | 12s |

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

1. **Pick a dragon** on the title screen
2. **Clear Wave 1** — two enemy dragons (the two archetypes you didn't pick)
3. **Collect soul-orbs** — glowing orbs spawn between waves; fly through to heal, refund cooldown, and score
4. **Clear Wave 2** — same enemies, tougher (+20% HP, +15% fire damage)
5. **Beat the FINAL BOSS** — one giant enemy, 2.5× HP, 1.6× size, 1.5× damage
6. **Chase the score** — kills + orbs build a combo multiplier. Final score shown on the end card.

## Built with

- [Three.js](https://threejs.org/) (procedural geometry, no asset downloads)
- [Vite](https://vite.dev/) for dev + production builds
- Vanilla JS, no framework
- Procedural dragons (~80 lines per archetype, flat-shaded, distinct skeletons)
- THREE.Points + custom shader for fire breath VFX
- Three.js built-in `Sky` shader + `FogExp2` for atmosphere
- Three.js `InstancedMesh` for ~700 forest trees
- `UnrealBloomPass` for skill / fire / eye glow
- Per-archetype animation: bat-wing flap for winged dragons, serpentine body undulation for Ryujin

## Design bible

The full world / lore / palette / character design reference lives in [DESIGN.md](DESIGN.md) — five dragon lines (only four implemented for v1), three houses (Aelric, Calden, Brennoc), the kingdom of Hauthwen and the duel between Eira and Sten that frames the world.

## Run it locally

```bash
git clone https://github.com/CasterlyGit/realm
cd realm
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173).

## Project layout

```
src/
  main.js       # game loop, input, combat, waves, score, camera
  dragon.js     # 4 archetype builders + shared animation
  world.js      # sky, terrain, clouds, landmarks
  populate.js   # forests, bridge, bonefold, NPCs, ravens
  fx.js         # fire breath, speed streaks
  style.css     # HUD + selection screen
DESIGN.md       # canonical lore / palette / character bible
```

## License

MIT — fly free.

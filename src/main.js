// ════════════════════════════════════════════════════════════════════════
//  main.js — bootstrap. Builds the systems, wires HUD handlers + hand
//  control + pause, and hands the frame loop to the game brain.
// ════════════════════════════════════════════════════════════════════════
import { makeEngine } from './engine.js';
import { makeSky } from './sky.js';
import { makeWorld } from './world.js';
import { makeDragon } from './dragon.js';
import { makeFX } from './fx.js';
import { makeAudio } from './audio.js';
import { makeHUD } from './hud.js';
import { makeRings } from './rings.js';
import { makeFoes } from './foes.js';
import { makeMotes } from './motes.js';
import { makeFlight } from './flight.js';
import { makeInput } from './input.js';
import { makeGame } from './game.js';
import { startHandMode, getHandInput, isHandActive } from './hand.js';

const canvas = document.getElementById('scene');

const engine = makeEngine(canvas);
const sky = makeSky(engine.scene);
const world = makeWorld(engine.scene);
const dragon = makeDragon();
engine.scene.add(dragon.group);
const fx = makeFX(engine.scene);
const rings = makeRings(engine.scene);
const foes = makeFoes(engine.scene);
const motes = makeMotes(engine.scene);
const audio = makeAudio();
const input = makeInput(canvas);
const flight = makeFlight(engine.camera, dragon);

// ── hand control ──
let handOn = false;
function toggleHand() {
  if (handOn) return;
  handOn = true;
  startHandMode((status) => hud.setHandStatus('HAND · ' + status));
}

// ── option toggles ──
let muted = false;
const handlers = {
  onStart: () => { audio.start(); game.startRun(); },
  onRestart: () => { audio.start(); game.startRun(); },
  onResume: () => game.resume(),
  onToggleHand: () => toggleHand(),
  onSetQuality: () => { const q = engine.cycleQuality(); hud.toast('QUALITY · ' + q.toUpperCase()); },
  onSetCool: () => { const c = engine.setCool(!engine.isCool()); hud.toast(c ? 'COOL MODE · 30 FPS' : 'COOL MODE OFF'); },
  onMute: () => { muted = !muted; if (audio.setMute) audio.setMute(muted); else (muted ? audio.suspend() : audio.resume()); hud.toast(muted ? 'SOUND OFF' : 'SOUND ON'); },
};

const hud = makeHUD(handlers);

const game = makeGame({ engine, sky, world, dragon, flight, fx, rings, foes, motes, audio, input, hud });

// fold hand input into the input module each frame
engine.onFrame(() => { if (handOn) input.setHand(getHandInput(), isHandActive()); });
// drive HUD pop-score animation, then the game brain
engine.onFrame((dt) => hud.update && hud.update(dt));
engine.onFrame((dt, t) => game.update(dt, t));

// pause on Escape (works even when the loop is stopped)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') game.togglePause();
});

// suspend audio when the tab is hidden / window blurred
engine.onVisibility((visible) => {
  if (!visible) audio.suspend();
  else if (game.getState() !== 'paused' && !muted) audio.resume();
});

// seed the title "best" line
const best = game.getBest();
const tb = document.getElementById('title-best');
if (tb && best) tb.textContent = 'BEST  ' + best.toLocaleString();

engine.start();
game.toTitle();

// expose for debugging
window.__realm = { engine, game, flight, audio };

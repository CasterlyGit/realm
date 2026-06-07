// ════════════════════════════════════════════════════════════════════════
//  input.js — unifies keyboard + mouse + hand-gesture into one control state.
//  Axes: pitch (+up), yaw (+right), roll (+right). Held: boost, fire, flap.
//  Edges (read-and-clear): skill, pause.
// ════════════════════════════════════════════════════════════════════════

export function makeInput(canvas) {
  const keys = Object.create(null);
  const mouse = { x: 0, y: 0, active: false }; // -1..1 from screen center
  let fireMouse = false;
  const edges = { skill: false, pause: false };

  const down = (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'r' && !keys[k]) edges.skill = true;
    if (k === 'Escape') edges.pause = true;
    keys[k] = true;
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  };
  const up = (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);

  // mouse steering = position relative to center (generous deadzone), additive
  const onMove = (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    mouse.active = true;
  };
  window.addEventListener('mousemove', onMove);
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) fireMouse = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) fireMouse = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  const DZ = 0.18; // mouse deadzone
  const dz = (v) => {
    const a = Math.abs(v);
    if (a < DZ) return 0;
    return Math.sign(v) * Math.min(1, (a - DZ) / (1 - DZ));
  };
  const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

  // hand input folded in each frame by main (it owns hand.js)
  let hand = null, handOn = false;
  function setHand(state, active) { hand = state; handOn = active; }

  const state = {
    pitch: 0, yaw: 0, roll: 0,
    boost: false, fire: false, flap: false,
  };

  function sample(mouseSteer) {
    let pitch = 0, yaw = 0, roll = 0;
    if (keys['w'] || keys['ArrowUp']) pitch += 1;
    if (keys['s'] || keys['ArrowDown']) pitch -= 1;
    if (keys['d'] || keys['ArrowRight']) yaw += 1;
    if (keys['a'] || keys['ArrowLeft']) yaw -= 1;
    if (keys['e']) roll += 1;
    if (keys['q']) roll -= 1;

    if (mouseSteer && mouse.active) {
      yaw += dz(mouse.x);
      pitch += -dz(mouse.y); // mouse up (negative y) = nose up
    }

    let boost = !!keys['Shift'];
    let fire = fireMouse || !!keys['f'];
    let flap = !!keys[' '];

    if (handOn && hand && hand.detected) {
      yaw += clamp1(hand.x);          // hand right = turn right (already mirrored)
      pitch += -clamp1(hand.y);       // hand up (y<0) = nose up
      if (hand.open) flap = true;     // ✋ flap
      if (hand.fist) fire = true;     // ✊ fire
      if (hand.peace) edges.skill = true; // ✌ skill
    }

    state.pitch = clamp1(pitch);
    state.yaw = clamp1(yaw);
    state.roll = clamp1(roll);
    state.boost = boost;
    state.fire = fire;
    state.flap = flap;
    return state;
  }

  function takeSkill() { const v = edges.skill; edges.skill = false; return v; }
  function takePause() { const v = edges.pause; edges.pause = false; return v; }

  function dispose() {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('mousemove', onMove);
  }

  return { sample, setHand, takeSkill, takePause, state, dispose };
}

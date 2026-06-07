// ════════════════════════════════════════════════════════════════════════
//  REALM — single source of truth for all tuned numbers, palettes, zones.
//  EVERY module imports from here. Do not hardcode magic numbers elsewhere.
//  World units are meters. Dragon faces local -Z (forward). Camera sits +Z.
// ════════════════════════════════════════════════════════════════════════

// ── Rendering / thermal budget (the #1 constraint: keep the laptop cool) ──
export const RENDER = {
  PIXEL_RATIO_CAP: 1.5,   // 1.5 looks sharp, ~44% less fragment work than native 2x
  FPS_DEFAULT: 60,        // manual rAF accumulator cap (never chase 120/ProMotion)
  FPS_COOL: 30,           // "cool" mode — halves GPU/CPU work almost exactly
  FAR: 1000,              // shallow far plane; fog hides the cut
  FOV_BASE: 70,           // deg, resting
  FOV_BOOST: 16,          // deg added at top speed
  EXPOSURE_BASE: 1.1,
  MAX_PARTICLES: 512,     // hard ceiling on the shared particle pool
  TRI_BUDGET: 80000,      // scene-wide soft target
};

// ── Flight physics (energy-conservation "roller-coaster" feel) ──
export const FLIGHT = {
  SPEED_MIN: 18,
  SPEED_CRUISE: 42,
  SPEED_SPRINT: 68,
  SPEED_MAX: 86,
  GRAVITY: 9.8,           // dV/dt = -g*sin(pitch) - drag*V^2 + thrust(+boost)
  DRAG: 0.00045,
  THRUST: 13,             // baseline, always on (wing-beat)
  BOOST_ACCEL: 30,        // extra accel while boosting
  FLAP_IMPULSE: 7,        // instant +m/s on a flap
  FLAP_COST: 2,
  FLAP_CD: 0.38,
  // Angular control rates (rad/s) at full input
  PITCH_RATE: 1.35,
  YAW_RATE: 1.05,
  ROLL_RATE: 1.9,
  AUTO_BANK: 0.62,        // bank = AUTO_BANK * yawInput (visual)
  BANK_MAX: 0.62,         // rad (~36deg)
  // Input smoothing stiffness (frame-rate independent: f = 1-exp(-k*dt))
  K_INPUT: 9.0,
  K_ROLL: 6.0,
  K_RETURN: 3.5,          // extra pull to center when no input
  // Soft-fail
  STALL_SPEED: 16,
  GLIDEFALL_SPEED: 30,
  GLIDEFALL_PITCH: -0.14, // rad, gentle descent
};

// ── Camera feel ──
export const CAM = {
  K_POS: 8.0,
  K_POS_Y: 5.6,
  K_LOOK: 6.0,
  K_FOV: 4.0,
  K_BANK: 5.0,
  OFFSET_BACK: 15.0,
  OFFSET_UP: 3.0,
  LOOK_AHEAD: 8.0,
  BANK_FRACTION: 0.34,
  TRAUMA_DECAY: 2.2,
  TRAUMA_RING: 0.22,
  TRAUMA_SHATTER: 0.30,
  TRAUMA_IMPACT: 0.5,
  SHAKE_POS: 0.22,
  SHAKE_ROT: 0.014,
  FOV_RING_KICK: 7,       // deg, decays via K_FOV
};

// ── Energy meter (soft fail, never a harsh death) ──
export const ENERGY = {
  MAX: 100,
  START: 78,
  DRAIN_PASSIVE: 1.9,     // /s at cruise — you must keep collecting
  DRAIN_FIRE: 6,          // /s while firing
  DRAIN_BOOST: 8,         // /s while boosting
  GLIDE_RECOVER: 1.0,     // /s while gliding clean (no fire/boost, near level)
  LOW: 25,                // amber threshold
  CRITICAL: 10,           // red; fire+boost disabled
  RING_REFILL: 6,
  RING_PERFECT_REFILL: 10,
};

// ── Scoring & combo ──
export const SCORE = {
  RING_BASE: 100,
  RING_PERFECT: 150,      // within perfect radius fraction
  RING_SPEED_BONUS: 60,   // at/above sprint speed
  COMBO_STEP: 0.5,
  COMBO_MAX: 8.0,
  COMBO_HOLD: 3.5,        // s before decay starts
  COMBO_DECAY: 0.8,       // /s
  COMBO_MOTE_STEP: 0.1,
  MOTE: { small: 25, pulse: 50, crystal: 100, aurora: 200 },
  MOTE_ENERGY: { small: 4, pulse: 8, crystal: 15, aurora: 20 },
  CRYSTAL: 200,
  WISP: 350,
  FORMATION: 1200,
};

// ── Collectible / combat tuning ──
export const PLAY = {
  RING_RADIUS: 13,
  RING_PERFECT_FRAC: 0.32,  // pass within 32% of center = perfect
  MOTE_COLLECT_R: 4.5,
  MOTE_MAGNET_R: 13,
  MOTE_MAGNET_R_GLIDE: 26,  // doubled during glide-fall "the world helps you"
  FIRE_RANGE: 90,
  FIRE_CONE_COS: 0.92,      // cos of half-angle; ~23deg cone
  FIRE_DPS: 1.0,            // hp/sec (crystal hp ~0.5, formation ~1.2)
  CRYSTAL_HP: 0.5,
  WISP_HP: 0.7,
  FORMATION_HP: 1.4,
  // Spawn density: one shadow element per N meters of travel (eased per zone)
  FOE_SPACING: [180, 130, 90],
  RING_CLUSTER_GAP: [320, 280, 240], // meters between ring clusters per zone
};

// Helpers ----------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate-independent damped approach toward target
export const damp = (cur, target, k, dt) => target + (cur - target) * Math.exp(-k * dt);

// ── Zones (the journey arc). Each is a complete palette + lighting recipe. ──
// Colors are hex ints. dragon emissive/eye/trail drive the hero look per zone.
export const ZONES = [
  {
    key: 'dawnreach',
    name: 'DAWNREACH',
    sub: 'the warm passage',
    distEnd: 3200,            // cumulative travel to leave this zone
    skyTop: 0x1a1035,
    skyHorizon: 0xff8c42,
    sun: 0xffe066,
    sunDir: [0.42, 0.5, 0.58],   // low, slightly left
    sunIntensity: 1.25,
    fog: 0xffb347,
    fogNear: 240,
    fogFar: 940,
    hemiSky: 0xff9955,
    hemiGround: 0x4a2800,
    hemiIntensity: 0.62,
    exposure: 1.18,
    terrain: [0xc8956c, 0xe8b88a, 0x7a4f3a, 0x8fbf6a],
    accent: 0xffe29a,
    glow: 0xffe29a,
    dragonEmissive: 0xff6a18,
    dragonEye: 0xffdd00,
    trail: 0xffe29a,
    ringColor: 0xffd27a,
    foeColor: 0xff6a2a,
    aurora: false,
  },
  {
    key: 'mistral',
    name: 'THE MISTRAL',
    sub: 'the high mist',
    distEnd: 7000,
    skyTop: 0x0d2240,
    skyHorizon: 0xa8d8ea,
    sun: 0xd4f0ff,
    sunDir: [0.15, 0.92, 0.36],   // high
    sunIntensity: 1.5,
    fog: 0xc5e8f0,
    fogNear: 200,
    fogFar: 880,
    hemiSky: 0xa0d4e8,
    hemiGround: 0x2a5c6a,
    hemiIntensity: 0.86,
    exposure: 1.05,
    terrain: [0xdce8e8, 0x5fa8a0, 0x2c4f58, 0xb8c4b0],
    accent: 0x7fffd4,
    glow: 0x7fffd4,
    dragonEmissive: 0x18c4ff,
    dragonEye: 0x00ffcc,
    trail: 0x7fffd4,
    ringColor: 0x9fffe6,
    foeColor: 0x6fd2ff,
    aurora: false,
  },
  {
    key: 'aurora',
    name: 'AURORA CROWN',
    sub: 'the world that lights itself',
    distEnd: 10800,          // finale triggers near here
    skyTop: 0x020818,
    skyHorizon: 0x1a0a2e,
    sun: 0x9966ff,
    sunDir: [0.2, 0.32, 0.5],     // low / mostly gone
    sunIntensity: 0.6,
    fog: 0x0a0520,
    fogNear: 300,
    fogFar: 1000,
    hemiSky: 0x00ffe0,
    hemiGround: 0x110022,
    hemiIntensity: 1.1,
    exposure: 0.96,
    terrain: [0x1a1a2e, 0x2d1b69, 0xa8f0e0, 0x7b2fff],
    accent: 0x00ffe0,
    glow: 0x00ffe0,
    dragonEmissive: 0x9933ff,
    dragonEye: 0xff44ff,
    trail: 0x00ffe0,
    ringColor: 0x66ffe6,
    foeColor: 0x9b6bff,
    aurora: true,
    auroraColors: [0x00ffe0, 0xff6eb4, 0x7b2fff],
  },
];

export const FINALE_DIST = 10800;  // distance at which the Aurora Gate finale begins

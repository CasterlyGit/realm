// ════════════════════════════════════════════════════════════════════════
//  REALM — src/hud.js
//  DOM HUD: energy ribbon, combo orb, score counter, zone dots,
//  distance arc, floating +score pops, screen flash, glide-fall vignette,
//  title / pause / end screens, zone banner.
//  No Three.js needed here — pure DOM + CSS manipulation.
//  All element IDs from BUILD_SPEC §index.html are injected if absent.
// ════════════════════════════════════════════════════════════════════════

import { ZONES, damp, clamp } from './constants.js';

// ── Colour helpers ───────────────────────────────────────────────────────
function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

function lerpHex(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return '#' + ((r << 16) | (g << 8) | bv).toString(16).padStart(6, '0');
}

// ── Lazy DOM helpers ─────────────────────────────────────────────────────
function getOrCreate(id, tag = 'div', parent = document.body) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    parent.appendChild(el);
  }
  return el;
}

// ── Pop-score pool ───────────────────────────────────────────────────────
const POP_POOL_SIZE = 14;
const _pops = [];   // { el, active, vy, age, life }

function initPopPool(layer) {
  for (let i = 0; i < POP_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'hud-pop';
    el.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'font-family:\'Cormorant Garamond\',serif',
      'font-size:22px',
      'font-weight:600',
      'letter-spacing:0.12em',
      'text-shadow:0 2px 8px rgba(0,0,0,0.85)',
      'opacity:0',
      'will-change:transform,opacity',
      'white-space:nowrap',
    ].join(';');
    layer.appendChild(el);
    _pops.push({ el, active: false, x: 0, y: 0, vy: 0, age: 0, life: 1.1 });
  }
}

// ── Zone dots ────────────────────────────────────────────────────────────
function buildZoneDots(container) {
  container.innerHTML = '';
  ZONES.forEach((z, i) => {
    const dot = document.createElement('div');
    dot.dataset.zoneIdx = i;
    dot.style.cssText = [
      'display:inline-block',
      'width:7px',
      'height:7px',
      'border-radius:50%',
      'margin:0 5px',
      'background:rgba(232,217,184,0.25)',
      'border:1px solid rgba(232,217,184,0.4)',
      'transition:background 0.6s ease,box-shadow 0.6s ease',
    ].join(';');
    container.appendChild(dot);
  });
}

// ── Distance arc SVG path ────────────────────────────────────────────────
// Draws an arc on an SVG circle. The arc element lives at #hud-dist-arc.
// We write the 'd' attribute directly.
function arcPath(frac, cx, cy, r) {
  // frac 0..1 sweeps from top, clockwise
  const angle = clamp(frac, 0, 0.9999) * Math.PI * 2 - Math.PI / 2;
  const startX = cx + r * Math.cos(-Math.PI / 2);
  const startY = cy + r * Math.sin(-Math.PI / 2);
  const endX   = cx + r * Math.cos(angle);
  const endY   = cy + r * Math.sin(angle);
  const large  = frac > 0.5 ? 1 : 0;
  if (frac <= 0) return `M ${startX} ${startY}`;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${large} 1 ${endX} ${endY}`;
}

// ── Inject all spec element IDs that may be missing from index.html ──────
function injectHUDElements() {
  // Master overlay containers
  const body = document.body;

  // ── #screen-flash ───────────────────────────────────────────────
  const flash = getOrCreate('screen-flash', 'div', body);
  flash.style.cssText = [
    'position:fixed','inset:0','pointer-events:none',
    'z-index:50','opacity:0',
    'transition:opacity 0.08s linear',
  ].join(';');

  // ── #glidefall-vignette ─────────────────────────────────────────
  const vignette = getOrCreate('glidefall-vignette', 'div', body);
  vignette.style.cssText = [
    'position:fixed','inset:0','pointer-events:none','z-index:4',
    'opacity:0',
    'transition:opacity 0.6s ease',
    'background:radial-gradient(ellipse at center,transparent 35%,rgba(14,24,56,0.55) 80%,rgba(8,14,38,0.82) 100%)',
  ].join(';');

  // ── #title-screen ───────────────────────────────────────────────
  const title = getOrCreate('title-screen', 'div', body);
  title.style.cssText = [
    'position:fixed','inset:0','z-index:20',
    'display:flex','flex-direction:column','align-items:center',
    'justify-content:center','gap:28px',
    'background:radial-gradient(ellipse at center,rgba(26,16,53,0.72),rgba(5,3,14,0.96) 70%)',
    'transition:opacity 1.4s ease',
  ].join(';');
  title.innerHTML = `
    <div style="font-size:clamp(14px,1.4vw,20px);letter-spacing:0.65em;text-transform:uppercase;color:rgba(232,217,184,0.55);font-family:'Cormorant Garamond',serif;">REALM</div>
    <div style="font-size:clamp(38px,5vw,80px);font-weight:400;font-style:italic;letter-spacing:0.08em;color:#f0e3c2;text-shadow:0 0 48px rgba(255,178,60,0.35),0 4px 16px rgba(0,0,0,0.95);font-family:'Cormorant Garamond',serif;">A Sky of Dragons</div>
    <div style="font-size:clamp(12px,1.1vw,16px);letter-spacing:0.4em;color:rgba(201,164,122,0.7);font-style:italic;font-family:'Cormorant Garamond',serif;">soar · collect · endure</div>
    <div id="title-best" style="font-size:13px;letter-spacing:0.35em;color:rgba(232,217,184,0.45);font-family:'Cormorant Garamond',serif;margin-top:4px;"></div>
    <button id="btn-fly" style="${btnStyle('#ffe29a')}margin-top:12px;">FLY</button>
    <button id="btn-hand" style="${btnStyle('rgba(93,217,255,0.85)')}font-size:12px;">ENABLE HAND CONTROL</button>
  `;

  // ── #pause-screen ───────────────────────────────────────────────
  const pause = getOrCreate('pause-screen', 'div', body);
  pause.style.cssText = [
    'position:fixed','inset:0','z-index:20',
    'display:flex','flex-direction:column','align-items:center',
    'justify-content:center','gap:20px',
    'background:rgba(5,3,14,0.82)',
    'transition:opacity 0.4s ease',
    'opacity:0','pointer-events:none',
  ].join(';');
  pause.innerHTML = `
    <div style="font-size:clamp(22px,3vw,42px);letter-spacing:0.5em;font-style:italic;color:#f0e3c2;font-family:'Cormorant Garamond',serif;">PAUSED</div>
    <button id="btn-resume" style="${btnStyle('#7fffd4')}">RESUME</button>
    <button id="btn-restart-pause" style="${btnStyle('rgba(232,217,184,0.7)')}font-size:12px;">RESTART</button>
    <div style="display:flex;gap:14px;margin-top:8px;align-items:center;">
      <button id="btn-quality" style="${btnStyleSmall()}">QUALITY</button>
      <button id="btn-cool" style="${btnStyleSmall()}">COOL MODE</button>
      <button id="btn-mute" style="${btnStyleSmall()}">MUTE</button>
    </div>
  `;

  // ── #end-screen ─────────────────────────────────────────────────
  const endScr = getOrCreate('end-screen', 'div', body);
  endScr.style.cssText = [
    'position:fixed','inset:0','z-index:20',
    'display:flex','flex-direction:column','align-items:center',
    'justify-content:center','gap:18px',
    'background:radial-gradient(ellipse at center,rgba(12,6,26,0.4) 0%,rgba(4,2,10,0.92) 65%,rgba(0,0,0,0.98) 100%)',
    'transition:opacity 1.6s ease',
    'opacity:0','pointer-events:none',
  ].join(';');
  endScr.innerHTML = `
    <div style="font-size:clamp(28px,4vw,64px);letter-spacing:0.45em;font-style:italic;color:#f0e3c2;text-shadow:0 0 40px rgba(180,120,255,0.4),0 4px 12px rgba(0,0,0,0.9);font-family:'Cormorant Garamond',serif;">JOURNEY COMPLETE</div>
    <div id="end-score" style="font-size:clamp(44px,6vw,90px);font-weight:500;letter-spacing:0.2em;color:#ffe29a;text-shadow:0 0 28px rgba(255,210,100,0.45),0 2px 8px rgba(0,0,0,0.9);font-family:'Cormorant Garamond',serif;">0</div>
    <div id="end-best" style="font-size:13px;letter-spacing:0.4em;color:rgba(232,217,184,0.5);font-family:'Cormorant Garamond',serif;"></div>
    <div style="display:flex;gap:32px;margin:8px 0;">
      <div style="text-align:center;">
        <div style="font-size:10px;letter-spacing:0.4em;color:rgba(232,217,184,0.5);margin-bottom:4px;font-family:'Cormorant Garamond',serif;">RINGS</div>
        <div id="end-rings" style="font-size:26px;letter-spacing:0.15em;color:#f0e3c2;font-family:'Cormorant Garamond',serif;">0</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px;letter-spacing:0.4em;color:rgba(232,217,184,0.5);margin-bottom:4px;font-family:'Cormorant Garamond',serif;">MOTES</div>
        <div id="end-motes" style="font-size:26px;letter-spacing:0.15em;color:#f0e3c2;font-family:'Cormorant Garamond',serif;">0</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px;letter-spacing:0.4em;color:rgba(232,217,184,0.5);margin-bottom:4px;font-family:'Cormorant Garamond',serif;">ZONE</div>
        <div id="end-zone" style="font-size:26px;letter-spacing:0.15em;color:#f0e3c2;font-family:'Cormorant Garamond',serif;">—</div>
      </div>
    </div>
    <button id="btn-restart" style="${btnStyle('#ffe29a')}margin-top:8px;">FLY AGAIN</button>
  `;

  // ── #hud (main in-flight overlay) ───────────────────────────────
  let hud = document.getElementById('hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'hud';
    hud.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;';
    body.appendChild(hud);
  }

  // Score top-centre
  const scoreWrap = getOrCreate('hud-score-wrap', 'div', hud);
  scoreWrap.style.cssText = [
    'position:absolute','top:18px','left:50%',
    'transform:translateX(-50%)',
    'display:flex','flex-direction:column','align-items:center','gap:2px',
    'pointer-events:none',
  ].join(';');
  scoreWrap.innerHTML = `
    <div id="hud-score" style="font-size:clamp(24px,2.8vw,44px);font-weight:500;letter-spacing:0.2em;color:#f0e3c2;text-shadow:0 2px 12px rgba(0,0,0,0.85);font-family:'Cormorant Garamond',serif;">0</div>
    <div id="hud-combo" style="display:flex;align-items:center;gap:7px;opacity:0;transition:opacity 0.25s ease;">
      <div id="hud-combo-orb" style="width:14px;height:14px;border-radius:50%;background:#ffe29a;box-shadow:0 0 10px #ffe29a;transition:transform 0.2s ease,background 0.3s ease,box-shadow 0.3s ease;"></div>
      <div id="hud-combo-num" style="font-size:14px;font-style:italic;letter-spacing:0.1em;color:rgba(201,164,122,0.9);font-family:'Cormorant Garamond',serif;">×1.0</div>
    </div>
  `;

  // Energy ribbon — bottom left
  const energyWrap = getOrCreate('hud-energy', 'div', hud);
  energyWrap.style.cssText = [
    'position:absolute','bottom:28px','left:24px',
    'display:flex','flex-direction:column','gap:5px',
    'width:220px',
  ].join(';');
  energyWrap.innerHTML = `
    <div style="font-size:9px;letter-spacing:0.45em;color:rgba(232,217,184,0.6);font-family:'Cormorant Garamond',serif;">ENERGY</div>
    <div style="height:6px;background:rgba(0,0,0,0.5);border:1px solid rgba(232,217,184,0.2);position:relative;overflow:hidden;box-shadow:inset 0 0 5px rgba(0,0,0,0.6);border-radius:1px;">
      <div id="hud-energy-fill" style="height:100%;width:78%;background:linear-gradient(90deg,#6fa8dc,#7fffd4 60%,#aff);transition:width 0.18s ease-out,background 0.4s ease;box-shadow:0 0 10px rgba(127,255,212,0.5);border-radius:1px;"></div>
    </div>
  `;

  // Speed indicator — bottom left, below energy
  const speedWrap = getOrCreate('hud-speed', 'div', hud);
  speedWrap.style.cssText = [
    'position:absolute','bottom:52px','left:24px',
    'font-size:10px','letter-spacing:0.35em',
    'color:rgba(232,217,184,0.45)',
    'font-family:\'Cormorant Garamond\',serif',
    'pointer-events:none',
  ].join(';');

  // Zone name + dots — top left
  const zoneWrap = getOrCreate('hud-zone', 'div', hud);
  zoneWrap.style.cssText = [
    'position:absolute','top:18px','left:22px',
    'display:flex','flex-direction:column','gap:3px',
    'pointer-events:none',
  ].join(';');
  zoneWrap.innerHTML = `
    <div id="hud-zone-name" style="font-size:10px;letter-spacing:0.5em;color:rgba(232,217,184,0.5);font-family:'Cormorant Garamond',serif;text-transform:uppercase;"></div>
    <div id="hud-zone-dots" style="display:flex;align-items:center;"></div>
  `;

  // Distance arc — SVG top-right
  const arcWrap = getOrCreate('hud-dist-arc-wrap', 'div', hud);
  arcWrap.style.cssText = [
    'position:absolute','top:14px','right:18px',
    'width:54px','height:54px',
    'pointer-events:none',
  ].join(';');
  arcWrap.innerHTML = `
    <svg viewBox="0 0 54 54" width="54" height="54" style="overflow:visible;">
      <circle cx="27" cy="27" r="22" fill="none" stroke="rgba(232,217,184,0.12)" stroke-width="2.5"/>
      <path id="hud-dist-arc" fill="none" stroke="#ffe29a" stroke-width="2.5" stroke-linecap="round"
            style="filter:drop-shadow(0 0 4px rgba(255,226,154,0.7));transition:stroke 0.5s ease;"/>
    </svg>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font-size:9px;letter-spacing:0.25em;color:rgba(232,217,184,0.5);font-family:'Cormorant Garamond',serif;">DIST</div>
  `;

  // Zone banner — centre
  const banner = getOrCreate('zone-banner', 'div', hud);
  banner.style.cssText = [
    'position:absolute','top:28vh','left:0','right:0',
    'text-align:center',
    'opacity:0','pointer-events:none',
    'transition:opacity 0.4s ease',
  ].join(';');
  banner.innerHTML = `
    <div id="zone-banner-name" style="font-size:clamp(26px,3.8vw,56px);font-weight:400;font-style:italic;letter-spacing:0.45em;color:#f0e3c2;text-shadow:0 0 32px rgba(0,0,0,0.9),0 4px 14px rgba(0,0,0,0.95);font-family:'Cormorant Garamond',serif;"></div>
    <div id="zone-banner-sub" style="font-size:clamp(13px,1.5vw,20px);font-style:italic;letter-spacing:0.18em;color:rgba(201,164,122,0.8);margin-top:8px;font-family:'Cormorant Garamond',serif;"></div>
  `;

  // Hand status — bottom right
  const handStatus = getOrCreate('hand-status', 'div', hud);
  handStatus.style.cssText = [
    'position:absolute','bottom:28px','right:22px',
    'font-size:10px','letter-spacing:0.35em',
    'color:rgba(93,217,255,0.65)',
    'font-family:\'Cormorant Garamond\',serif',
    'pointer-events:none',
    'transition:color 0.3s ease',
  ].join(';');

  // Pop-score layer
  const popLayer = getOrCreate('popscore-layer', 'div', hud);
  popLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';

  // Toast — bottom centre
  const toast = getOrCreate('hud-toast', 'div', hud);
  toast.style.cssText = [
    'position:absolute','bottom:80px','left:50%',
    'transform:translateX(-50%)',
    'font-size:12px','letter-spacing:0.35em',
    'color:rgba(232,217,184,0.85)',
    'font-family:\'Cormorant Garamond\',serif',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 0.4s ease',
    'text-shadow:0 2px 6px rgba(0,0,0,0.9)',
    'white-space:nowrap',
  ].join(';');

  return { popLayer };
}

function btnStyle(color) {
  return [
    `background:transparent`,
    `border:1px solid ${color}`,
    `color:${color}`,
    `font-family:'Cormorant Garamond',serif`,
    `font-size:14px`,
    `font-weight:500`,
    `letter-spacing:0.35em`,
    `padding:11px 38px`,
    `border-radius:2px`,
    `cursor:pointer`,
    `pointer-events:auto`,
    `transition:all 0.2s ease`,
  ].join(';') + ';';
}

function btnStyleSmall() {
  return [
    `background:transparent`,
    `border:1px solid rgba(232,217,184,0.35)`,
    `color:rgba(232,217,184,0.65)`,
    `font-family:'Cormorant Garamond',serif`,
    `font-size:10px`,
    `letter-spacing:0.35em`,
    `padding:7px 16px`,
    `border-radius:2px`,
    `cursor:pointer`,
    `pointer-events:auto`,
    `transition:all 0.2s ease`,
  ].join(';') + ';';
}

// ── Zone-tinted energy colours ───────────────────────────────────────────
const ENERGY_COLORS = {
  normal:   { grad: ['#6fa8dc', '#7fffd4'], glow: 'rgba(127,255,212,0.5)' },
  low:      { grad: ['#c86a00', '#ffb347'], glow: 'rgba(255,180,60,0.6)'  },
  critical: { grad: ['#8a0a06', '#ff3a14'], glow: 'rgba(255,58,20,0.7)'  },
};

// ─────────────────────────────────────────────────────────────────────────
//  makeHUD — factory
// ─────────────────────────────────────────────────────────────────────────
export function makeHUD(handlers = {}) {
  const { onStart, onRestart, onResume, onToggleHand,
          onSetQuality, onSetCool, onMute } = handlers;

  const { popLayer } = injectHUDElements();

  // Initialise pop pool
  initPopPool(popLayer);

  // Cache element references
  const $ = id => document.getElementById(id);

  // Wire buttons
  $('btn-fly')?.addEventListener('click',             () => onStart?.());
  $('btn-hand')?.addEventListener('click',            () => onToggleHand?.());
  $('btn-resume')?.addEventListener('click',          () => onResume?.());
  $('btn-restart-pause')?.addEventListener('click',   () => onRestart?.());
  $('btn-quality')?.addEventListener('click',         () => onSetQuality?.('high'));
  $('btn-cool')?.addEventListener('click',            () => onSetCool?.(true));
  $('btn-mute')?.addEventListener('click',            () => onMute?.(true));
  $('btn-restart')?.addEventListener('click',         () => onRestart?.());

  // ── Zone dots init ────────────────────────────────────────────────
  const dotsContainer = $('hud-zone-dots');
  if (dotsContainer) buildZoneDots(dotsContainer);

  // ── Flash timeout handle ──────────────────────────────────────────
  let _flashTimer = null;

  // ── Banner animation handle ───────────────────────────────────────
  let _bannerTimer = null;

  // ── Toast timeout ─────────────────────────────────────────────────
  let _toastTimer = null;

  // ── Score display (animated counter) ─────────────────────────────
  let _displayScore = 0;

  // ── Zone accent for arc / combo ───────────────────────────────────
  let _zoneAccent = '#ffe29a';

  // ─────────────────────────────────────────────────────────────────
  //  Returned API
  // ─────────────────────────────────────────────────────────────────
  return {

    // ── setScore ────────────────────────────────────────────────────
    setScore(n) {
      const el = $('hud-score');
      if (!el) return;
      const target = Math.round(n);
      if (target === _displayScore) return;
      _displayScore = target;
      el.textContent = target.toLocaleString();
    },

    // ── setCombo ────────────────────────────────────────────────────
    setCombo(mult) {
      const wrap  = $('hud-combo');
      const orb   = $('hud-combo-orb');
      const label = $('hud-combo-num');
      if (!wrap) return;
      if (mult <= 1.0) {
        wrap.style.opacity = '0';
        return;
      }
      wrap.style.opacity = '1';
      const t = clamp((mult - 1.0) / 7.0, 0, 1);
      // Colour: cream → gold → aurora cyan
      const orbColor = t < 0.5
        ? lerpHex(0xffe29a, 0xff9933, t * 2)
        : lerpHex(0xff9933, 0x00ffe0, (t - 0.5) * 2);
      const scale = 1 + t * 0.8;
      if (orb) {
        orb.style.background   = orbColor;
        orb.style.boxShadow    = `0 0 ${10 + t * 14}px ${orbColor}`;
        orb.style.transform    = `scale(${scale.toFixed(2)})`;
      }
      if (label) {
        label.textContent = `×${mult.toFixed(1)}`;
        label.style.color = orbColor;
      }
    },

    // ── setEnergy ───────────────────────────────────────────────────
    setEnergy(frac01, stateStr = 'normal') {
      const fill = $('hud-energy-fill');
      if (!fill) return;
      const pct = clamp(frac01 * 100, 0, 100).toFixed(1);
      fill.style.width = pct + '%';
      const cfg = ENERGY_COLORS[stateStr] || ENERGY_COLORS.normal;
      fill.style.background = `linear-gradient(90deg,${cfg.grad[0]},${cfg.grad[1]})`;
      fill.style.boxShadow  = `0 0 10px ${cfg.glow}`;
    },

    // ── setSpeed ────────────────────────────────────────────────────
    setSpeed(speedNorm) {
      const el = $('hud-speed');
      if (!el) return;
      const pct = Math.round(clamp(speedNorm, 0, 1) * 100);
      el.textContent = pct + '%';
      el.style.color = speedNorm > 0.8
        ? 'rgba(127,255,212,0.7)'
        : speedNorm > 0.5
          ? 'rgba(255,226,154,0.55)'
          : 'rgba(232,217,184,0.4)';
    },

    // ── setZone ─────────────────────────────────────────────────────
    setZone(index, name, sub) {
      // Zone name label
      const nameEl = $('hud-zone-name');
      if (nameEl) nameEl.textContent = name || '';

      // Dots: highlight active
      const dots = document.querySelectorAll('#hud-zone-dots [data-zone-idx]');
      const zone = ZONES[index] || ZONES[0];
      _zoneAccent = hexCss(zone.accent);

      dots.forEach(dot => {
        const i = parseInt(dot.dataset.zoneIdx, 10);
        if (i === index) {
          dot.style.background  = _zoneAccent;
          dot.style.boxShadow   = `0 0 6px ${_zoneAccent}`;
          dot.style.borderColor = _zoneAccent;
        } else if (i < index) {
          dot.style.background  = 'rgba(232,217,184,0.45)';
          dot.style.boxShadow   = 'none';
          dot.style.borderColor = 'rgba(232,217,184,0.45)';
        } else {
          dot.style.background  = 'rgba(232,217,184,0.1)';
          dot.style.boxShadow   = 'none';
          dot.style.borderColor = 'rgba(232,217,184,0.25)';
        }
      });

      // Arc accent
      const arc = $('hud-dist-arc');
      if (arc) arc.style.stroke = _zoneAccent;
    },

    // ── setDistanceProgress ─────────────────────────────────────────
    setDistanceProgress(frac01) {
      const arc = $('hud-dist-arc');
      if (!arc) return;
      arc.setAttribute('d', arcPath(clamp(frac01, 0, 1), 27, 27, 22));
    },

    // ── showTitle / hideTitle ────────────────────────────────────────
    showTitle() {
      const el = $('title-screen');
      if (!el) return;
      el.style.opacity         = '1';
      el.style.pointerEvents   = 'auto';
    },
    hideTitle() {
      const el = $('title-screen');
      if (!el) return;
      el.style.opacity       = '0';
      el.style.pointerEvents = 'none';
    },

    // ── showPause / hidePause ────────────────────────────────────────
    showPause() {
      const el = $('pause-screen');
      if (!el) return;
      el.style.opacity       = '1';
      el.style.pointerEvents = 'auto';
    },
    hidePause() {
      const el = $('pause-screen');
      if (!el) return;
      el.style.opacity       = '0';
      el.style.pointerEvents = 'none';
    },

    // ── showEnd / hideEnd ────────────────────────────────────────────
    showEnd(stats = {}) {
      const el = $('end-screen');
      if (!el) return;
      // Fill stats
      const scoreEl = $('end-score');
      const bestEl  = $('end-best');
      const ringsEl = $('end-rings');
      const motesEl = $('end-motes');
      const zoneEl  = $('end-zone');
      if (scoreEl) scoreEl.textContent = (stats.score ?? 0).toLocaleString();
      if (bestEl)  bestEl.textContent  = stats.best > (stats.score ?? 0)
        ? `BEST  ${stats.best.toLocaleString()}`
        : stats.best ? `NEW BEST  ${stats.best.toLocaleString()}` : '';
      if (ringsEl) ringsEl.textContent = stats.rings ?? 0;
      if (motesEl) motesEl.textContent = stats.motes ?? 0;
      if (zoneEl)  zoneEl.textContent  = stats.zone  ?? '—';
      el.style.opacity       = '1';
      el.style.pointerEvents = 'auto';
    },
    hideEnd() {
      const el = $('end-screen');
      if (!el) return;
      el.style.opacity       = '0';
      el.style.pointerEvents = 'none';
    },

    // ── showZoneBanner ───────────────────────────────────────────────
    showZoneBanner(name, sub) {
      const banner  = $('zone-banner');
      const nameEl  = $('zone-banner-name');
      const subEl   = $('zone-banner-sub');
      if (!banner) return;
      if (nameEl) nameEl.textContent = name || '';
      if (subEl)  subEl.textContent  = sub  || '';
      banner.style.opacity = '1';
      if (_bannerTimer) clearTimeout(_bannerTimer);
      // Animate: fade in, hold, fade out
      banner.style.animation = 'none';
      void banner.offsetWidth; // reflow
      banner.style.transition = 'opacity 0.6s ease';
      banner.style.opacity    = '1';
      _bannerTimer = setTimeout(() => {
        if (banner) banner.style.opacity = '0';
      }, 3200);
    },

    // ── flash ────────────────────────────────────────────────────────
    flash(colorHex, alpha = 0.45) {
      const el = $('screen-flash');
      if (!el) return;
      const r = (colorHex >> 16) & 0xff;
      const g = (colorHex >> 8)  & 0xff;
      const b =  colorHex        & 0xff;
      el.style.background = `rgba(${r},${g},${b},1)`;
      el.style.opacity    = String(clamp(alpha, 0, 1));
      if (_flashTimer) clearTimeout(_flashTimer);
      _flashTimer = setTimeout(() => {
        if (el) el.style.opacity = '0';
      }, 80);
    },

    // ── popScore ─────────────────────────────────────────────────────
    popScore(x, y, text, colorHex = 0xffe29a) {
      const pop = _pops.find(p => !p.active);
      if (!pop) return;
      pop.active = true;
      pop.age    = 0;
      pop.life   = 1.1;
      pop.x      = x;
      pop.y      = y;
      pop.vy     = -(70 + Math.random() * 40);   // px/s upward
      const col = hexCss(colorHex);
      pop.el.style.color     = col;
      pop.el.style.textShadow = `0 0 12px ${col}`;
      pop.el.textContent     = text;
      pop.el.style.left      = x + 'px';
      pop.el.style.top       = y + 'px';
      pop.el.style.opacity   = '1';
      pop.el.style.transform = 'translateY(0) scale(1)';
    },

    // ── setHandStatus ────────────────────────────────────────────────
    setHandStatus(text) {
      const el = $('hand-status');
      if (el) el.textContent = text || '';
    },

    // ── setGlideFall ─────────────────────────────────────────────────
    setGlideFall(bool) {
      const el = $('glidefall-vignette');
      if (!el) return;
      el.style.opacity = bool ? '1' : '0';
    },

    // ── toast ────────────────────────────────────────────────────────
    toast(text) {
      const el = $('hud-toast');
      if (!el) return;
      el.textContent  = text;
      el.style.opacity = '1';
      if (_toastTimer) clearTimeout(_toastTimer);
      _toastTimer = setTimeout(() => {
        if (el) el.style.opacity = '0';
      }, 2200);
    },

    // ── update — called every frame by game.js ────────────────────────
    // Advances pop-score particles.
    // (Not in spec return signature but needed for pops & score lerp.)
    update(dt) {
      // Advance pop-score pool
      for (let i = 0; i < _pops.length; i++) {
        const p = _pops[i];
        if (!p.active) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.active          = false;
          p.el.style.opacity = '0';
          continue;
        }
        const t   = p.age / p.life;
        p.y      += p.vy * dt;
        const op  = t < 0.15 ? t / 0.15 : 1 - ((t - 0.15) / 0.85);
        const sc  = 1 + 0.15 * Math.sin(Math.PI * t);
        p.el.style.top       = p.y.toFixed(1) + 'px';
        p.el.style.opacity   = clamp(op, 0, 1).toFixed(3);
        p.el.style.transform = `scale(${sc.toFixed(3)})`;
      }
    },

    // ── dispose ──────────────────────────────────────────────────────
    dispose() {
      if (_flashTimer)  clearTimeout(_flashTimer);
      if (_bannerTimer) clearTimeout(_bannerTimer);
      if (_toastTimer)  clearTimeout(_toastTimer);
      // Remove injected screens + hud elements created by this module
      ['title-screen','pause-screen','end-screen',
       'screen-flash','glidefall-vignette','hud-toast',
       'hud-score-wrap','hud-energy','hud-speed',
       'hud-zone','hud-dist-arc-wrap','zone-banner',
       'hand-status','popscore-layer'].forEach(id => {
        document.getElementById(id)?.remove();
      });
    },
  };
}

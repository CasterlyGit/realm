const MP_VERSION = '0.10.18';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;

let handLandmarker = null;
let video = null;
let overlay = null;
let octx = null;
let lastVideoTime = -1;

const state = {
  active: false,
  initializing: false,
  detected: false,
  x: 0, y: 0,
  fist: false,
  open: false,
  peace: false,
  raw: null,
};

export function getHandInput() { return state; }
export function isHandActive() { return state.active; }

export async function startHandMode(onStatus) {
  if (state.active || state.initializing) return;
  state.initializing = true;
  onStatus?.('REQUESTING CAMERA…');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 360, facingMode: 'user' },
      audio: false,
    });
    video = document.getElementById('webcam-video');
    overlay = document.getElementById('webcam-overlay');
    octx = overlay.getContext('2d');
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth || 480;
    overlay.height = video.videoHeight || 360;

    onStatus?.('LOADING MODEL…');
    const { HandLandmarker, FilesetResolver } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/+esm`
    );
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });

    state.active = true;
    state.initializing = false;
    document.getElementById('webcam-wrap').classList.add('show');
    onStatus?.('TRACKING');
    requestAnimationFrame(detectLoop);
  } catch (err) {
    state.initializing = false;
    onStatus?.('ERROR: ' + (err.message || err));
    console.error(err);
  }
}

export function stopHandMode() {
  state.active = false;
  if (video && video.srcObject) {
    for (const t of video.srcObject.getTracks()) t.stop();
    video.srcObject = null;
  }
  document.getElementById('webcam-wrap')?.classList.remove('show');
}

function detectLoop() {
  if (!state.active) return;
  if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    if (result.landmarks && result.landmarks.length > 0) {
      const lm = result.landmarks[0];
      state.detected = true;
      let sx = 0, sy = 0;
      for (const p of lm) { sx += p.x; sy += p.y; }
      sx /= lm.length; sy /= lm.length;
      // mirror X for selfie view, so hand-right turns right
      state.x = (0.5 - sx) * 2 * -1;
      state.y = (sy - 0.5) * 2;

      const f = fingersExtended(lm, result.handedness?.[0]?.[0]?.categoryName === 'Right');
      state.open  = f.thumb && f.index && f.middle && f.ring && f.pinky;
      state.fist  = !f.index && !f.middle && !f.ring && !f.pinky;
      state.peace = !f.ring && !f.pinky && f.index && f.middle;
      state.raw = lm;
      drawOverlay(lm);
    } else {
      state.detected = false;
      state.x = 0; state.y = 0;
      state.fist = state.open = state.peace = false;
      octx.clearRect(0, 0, overlay.width, overlay.height);
    }
    updateGestureLabel();
  }
  requestAnimationFrame(detectLoop);
}

// Landmarks: 0=wrist · 4=thumb tip · 8=index · 12=middle · 16=ring · 20=pinky
// PIP joints: 6=index · 10=middle · 14=ring · 18=pinky · for thumb use 2/3
function fingersExtended(lm, rightHand) {
  return {
    thumb: rightHand ? lm[4].x < lm[3].x : lm[4].x > lm[3].x,
    index:  lm[8].y  < lm[6].y,
    middle: lm[12].y < lm[10].y,
    ring:   lm[16].y < lm[14].y,
    pinky:  lm[20].y < lm[18].y,
  };
}

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

function drawOverlay(lm) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);

  // mirror context so overlay matches selfie video
  octx.save();
  octx.translate(w, 0);
  octx.scale(-1, 1);

  // center crosshair zone
  octx.strokeStyle = 'rgba(255, 215, 63, 0.45)';
  octx.lineWidth = 1.5;
  octx.beginPath();
  octx.arc(w / 2, h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2);
  octx.stroke();

  // bones
  octx.strokeStyle = '#5dd9ff';
  octx.lineWidth = 2.5;
  for (const [a, b] of CONNECTIONS) {
    octx.beginPath();
    octx.moveTo(lm[a].x * w, lm[a].y * h);
    octx.lineTo(lm[b].x * w, lm[b].y * h);
    octx.stroke();
  }
  // joints
  octx.fillStyle = '#ffd23f';
  for (const p of lm) {
    octx.beginPath();
    octx.arc(p.x * w, p.y * h, 3.5, 0, Math.PI * 2);
    octx.fill();
  }
  octx.restore();
}

function updateGestureLabel() {
  const el = document.getElementById('gesture-label');
  if (!el) return;
  let g = '—';
  if (state.peace) g = '✌ SKILL';
  else if (state.fist) g = '✊ FIRE';
  else if (state.open) g = '✋ FLAP';
  el.textContent = g;
}

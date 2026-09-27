// How the device is tilted (-1..1 on both axes), for the sheen on gold and varnish.
// iPad/phone: DeviceOrientation (iOS asks for permission, only from a user gesture); laptop: the mouse position;
// otherwise a slow drift so the gold still breathes.

export const tilt = { x: 0, y: 0 };
const target = { x: 0, y: 0 };
let source: 'none' | 'device' | 'mouse' = 'none';
let base: { b: number; g: number } | null = null;
let asked = false;
let t = 0;

function onOrient(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return;
  source = 'device';
  // relative to how the device was held when we started listening
  if (!base) base = { b: e.beta, g: e.gamma };
  const landscape = Math.abs((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number) === 90;
  let dx = (e.gamma - base.g) / 25, dy = (e.beta - base.b) / 25;
  if (landscape) [dx, dy] = [dy, -dx];
  target.x = Math.max(-1, Math.min(1, dx));
  target.y = Math.max(-1, Math.min(1, dy));
}

/** Call from a user gesture (tap) to ask for motion access on iOS. */
export function askTilt() {
  if (asked) return;
  asked = true;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (DOE && typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((r) => { if (r === 'granted') window.addEventListener('deviceorientation', onOrient); }).catch(() => {});
  } else if (DOE) window.addEventListener('deviceorientation', onOrient);
}

window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || source === 'device') return;
  source = 'mouse';
  target.x = (e.clientX / window.innerWidth - 0.5) * 1.6;
  target.y = (e.clientY / window.innerHeight - 0.5) * 1.6;
});

export function updateTilt(dt: number) {
  t += dt;
  if (source === 'none') {
    target.x = Math.sin(t * 0.37) * 0.5;
    target.y = Math.sin(t * 0.23 + 1) * 0.35;
  }
  const k = 1 - Math.exp(-dt * 6);
  tilt.x += (target.x - tilt.x) * k;
  tilt.y += (target.y - tilt.y) * k;
}

/** Re-centre (e.g. when a new stage starts, so "now" is neutral). */
export function recentreTilt() { base = null; }

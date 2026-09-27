import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import './style.css';
import { imageUrl, loadCatalog, loadImage, loadLevel, type CatalogItem, type LevelId } from './data';
import { Renderer } from './render/renderer';
import { Camera } from './game/camera';
import { Input } from './game/input';
import { Studio, type Recording } from './game/studio';
import { updateTilt } from './game/tilt';
import { clearWork, idbGet, loadPrefs, loadWork, savePrefs } from './game/save';
import { UI } from './ui/ui';
import { sound } from './audio/audio';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const cam = new Camera();
const prefs = loadPrefs();
sound.muted = prefs.muted;
sound.musicOn = prefs.music;
sound.sfxOn = prefs.sfx;
let studio: Studio | null = null;
let catalog: CatalogItem[] = [];
let opening = false;

const ui = new UI(document.getElementById('ui')!, {
  open: (it) => ui.showCommission(it),
  start: (it, level, fresh) => void open(it, level, fresh),
  back: () => leave(),
  tool: (t) => studio?.setTool(t),
  select: (c) => studio?.retouch.select(c, studio.time),
  hint: () => studio?.hint(),
  fit: () => cam.fit(0.6),
  peek: (on) => studio?.setPeek(on),
  mute: () => {
    prefs.muted = !prefs.muted;
    sound.setMuted(prefs.muted);
    savePrefs(prefs);
    return prefs.muted;
  },
  music: () => { prefs.music = !prefs.music; sound.setMusic(prefs.music); savePrefs(prefs); return prefs.music; },
  sfx: () => { prefs.sfx = !prefs.sfx; sound.setSfx(prefs.sfx); savePrefs(prefs); return prefs.sfx; },
  skip: () => studio?.skipStage(),
  gallery: (focus) => { leave(false); ui.showGallery(catalog, focus); },
  menu: () => { leave(false); showMenu(); },
  replay: (it) => void replay(it),
  restart: () => {
    if (!studio) return;
    const it = studio.item, lv = studio.levelId;
    void open(it, lv, true);
  },
}, prefs);

const input = new Input(canvas, cam, () => studio?.handler() ?? null);
input.onAnyDown = () => sound.unlock();
window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

async function replay(it: CatalogItem) {
  const rec = await idbGet<Recording>('rec-done:' + it.slug);
  if (!rec) { ui.toast('Nie ma nagrania tej renowacji. Odnów obraz jeszcze raz, żeby je nagrać.', 4000); return; }
  await open(it, rec.level, false, rec);
}

async function open(it: CatalogItem, level: LevelId, fresh: boolean, rec?: Recording) {
  if (opening) return;
  opening = true;
  if (studio) { studio.flush(); studio = null; }
  ui.loading(true);
  try {
    if (fresh && !rec) clearWork(it.slug);
    const save = fresh || rec ? null : loadWork(it.slug);
    const [img, lv] = await Promise.all([loadImage(imageUrl(it.slug)), loadLevel(it.slug, level)]);
    const gpu = renderer.load(img, lv);
    renderer.particles.list.length = 0;
    ui.showHud(it, !!rec);
    studio = new Studio(it, level, lv, gpu, renderer, cam, ui, rec);
    layout();
    await studio.begin(save && save.level === level ? save : null);
    layout();
    if (!studio.cleaning.finished || studio.phase === 'retouch') cam.fit();
    if (location.hash.includes('skip')) studio.skipCleaning();
  } catch (e) {
    console.error(e);
    ui.toast('Nie udało się wczytać obrazu. Sprawdź połączenie.', 5000);
    showMenu();
  } finally {
    ui.loading(false);
    opening = false;
  }
}

function leave(toMenu = true) {
  const wasReplay = studio?.replaying;
  const slug = studio?.item.slug;
  if (studio) studio.flush();
  studio = null;
  renderer.unload();
  if (!toMenu) return;
  if (wasReplay) ui.showGallery(catalog, slug);
  else showMenu();
}

function showMenu() {
  ui.showMenu(catalog);
}

function layout() {
  renderer.resize();
  cam.setViewport(renderer.w, renderer.h);
  if (studio) cam.insets = ui.insets();
}

window.addEventListener('resize', () => {
  const fitted = cam.isFitted();
  layout();
  if (fitted && studio) cam.fit();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) studio?.flush(); sound.pause(document.hidden); });
window.addEventListener('pagehide', () => studio?.flush());

// #debug: live input state on screen (for testing gestures on the iPad)
let dbg: HTMLElement | null = null;
if (location.hash.includes('debug')) {
  input.logOn = true;
  dbg = document.createElement('pre');
  dbg.style.cssText = 'position:fixed;left:8px;bottom:120px;z-index:99;margin:0;padding:8px 10px;font:11px/1.35 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.7);border-radius:8px;pointer-events:none;white-space:pre';
  document.body.append(dbg);
}

let last = performance.now();
let insetT = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  if (studio && !document.hidden) renderer.governor(dt);
  if (dbg) dbg.textContent = input.debug() + `\nzoom ${cam.zoom.toFixed(2)} (min ${cam.minZoom.toFixed(2)}, max ${cam.maxZoom.toFixed(2)}) · q ${renderer.quality.toFixed(2)} · ${studio?.phase ?? ''}`;
  requestAnimationFrame(frame);
}
function step(dt: number) {
  if (studio) {
    insetT -= dt;
    if (insetT <= 0) { insetT = 0.5; cam.insets = ui.insets(); }
    cam.update(dt);
    updateTilt(dt);
    studio.update(dt);
  }
  renderer.particles.update(dt);
  renderer.render(cam, studio?.scene ?? ({} as never));
}

async function boot() {
  layout();
  try { await document.fonts.load('600 40px "Source Sans 3"'); } catch { /* fall back */ }
  renderer.setFont('"Source Sans 3", system-ui, sans-serif');
  try {
    catalog = await loadCatalog();
  } catch {
    catalog = [];
  }
  showMenu();
  if (location.hash.includes('gallery')) ui.showGallery(catalog);
  const m = location.hash.match(/#p=([\w-]+)(?:\/(\w+))?/);
  if (m) {
    const it = catalog.find((c) => c.slug === m[1]);
    if (it) void open(it, (m[2] as LevelId) || 'latwy', location.hash.includes('fresh'));
  }
  requestAnimationFrame(frame);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// dev helper: __k.tick(60) runs 60 frames synchronously (the browser pane may be hidden and throttle rAF)
(window as unknown as { __k: unknown }).__k = {
  get studio() { return studio; }, cam, renderer, ui, input,
  tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) step(dt); last = performance.now(); },
  /** Render now and POST the canvas (+ a rough DOM overlay is not included) to the dev server: work/shots/<name>.png */
  shot(name = 'shot') { step(0); return fetch('/__shot?name=' + name, { method: 'POST', body: canvas.toDataURL('image/png') }).then((r) => r.text()); },
};
if (import.meta.env.DEV) {
  // synthetic strokes for automated checks: __k.stroke([[x,y],...], {type:'pen', pressure:0.8}); __k.zig(x0,y0,x1,y1,rows,steps)
  const k = (window as unknown as { __k: Record<string, unknown> }).__k;
  const tick = k.tick as (n?: number) => void;
  k.stroke = (pts: number[][], o: { id?: number; type?: string; pressure?: number } = {}) => {
    const mk = (type: string, x: number, y: number) => new PointerEvent(type, { pointerId: o.id ?? 1, pointerType: o.type ?? 'mouse', clientX: x, clientY: y, pressure: o.pressure ?? 0.5, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true });
    canvas.dispatchEvent(mk('pointerdown', pts[0][0], pts[0][1])); tick(1);
    for (let i = 1; i < pts.length; i++) { canvas.dispatchEvent(mk('pointermove', pts[i][0], pts[i][1])); tick(1); }
    canvas.dispatchEvent(mk('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1])); tick(1);
  };
  k.zig = (x0: number, y0: number, x1: number, y1: number, rows = 6, steps = 20, o = {}) => {
    const pts: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const y = y0 + ((y1 - y0) * r) / Math.max(1, rows - 1);
      for (let i = 0; i <= steps; i++) { const t = i / steps; pts.push([r % 2 ? x1 - (x1 - x0) * t : x0 + (x1 - x0) * t, y]); }
    }
    (k.stroke as (p: number[][], o: object) => void)(pts, o);
  };
  k.tap = (x: number, y: number) => (k.stroke as (p: number[][]) => void)([[x, y]]);
}
void boot();

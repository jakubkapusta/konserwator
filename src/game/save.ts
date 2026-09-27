// Progress: localStorage for the small stuff (stage, painted fields), IndexedDB for the dirt snapshot.
// All storage access is wrapped: private mode or blocked storage must never break the game.
import type { LevelId } from '../data';

export type Stage = 'clean' | 'retouch' | 'gild' | 'varnish' | 'done';

export interface WorkSave {
  v: 1;
  slug: string;
  level: LevelId;
  stage: Stage;
  t: number;
  clean?: { tool: number; done: boolean[][]; init: number[][]; initTotal: number[] };
  painted?: number[];
  sel?: number;
  hints?: number;
  gild?: { laid: boolean[]; done: boolean[] };
  varnish?: number[];
  progress: number; // 0..1 of the current stage, for the menu
}

const WORK = 'konserwator.work.v1';
const DONE = 'konserwator.done.v1';
const PREFS = 'konserwator.prefs.v1';

function read<T>(k: string, d: T): T {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : d;
  } catch { return d; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ }
}

export function loadWork(slug: string): WorkSave | null {
  return read<Record<string, WorkSave>>(WORK, {})[slug] ?? null;
}
export function allWork() { return read<Record<string, WorkSave>>(WORK, {}); }
export function saveWork(w: WorkSave) {
  const all = read<Record<string, WorkSave>>(WORK, {});
  all[w.slug] = w;
  write(WORK, all);
}
export function clearWork(slug: string) {
  const all = read<Record<string, WorkSave>>(WORK, {});
  delete all[slug];
  write(WORK, all);
  void idbDel('dirt:' + slug);
}

export function loadDone(): Record<string, Partial<Record<LevelId, number>>> { return read(DONE, {}); }
export function markDone(slug: string, level: LevelId) {
  const d = loadDone();
  (d[slug] ??= {})[level] = Date.now();
  write(DONE, d);
}

export interface Prefs { muted: boolean; music: boolean; sfx: boolean; hints: Record<string, boolean> }
export function loadPrefs(): Prefs { return { muted: false, music: true, sfx: true, hints: {}, ...read<Partial<Prefs>>(PREFS, {}) }; }
export function savePrefs(p: Prefs) { write(PREFS, p); }

// ---- IndexedDB (dirt snapshots) ----
let dbp: Promise<IDBDatabase | null> | null = null;
function db() {
  if (!dbp) dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('konserwator', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
export async function idbSet(k: string, v: unknown) {
  const d = await db();
  if (!d) return;
  await new Promise<void>((res) => {
    try {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    } catch { res(); }
  });
}
export async function idbGet<T>(k: string): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    try {
      const r = d.transaction('kv').objectStore('kv').get(k);
      r.onsuccess = () => res((r.result as T) ?? null);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
export async function idbDel(k: string) {
  const d = await db();
  if (!d) return;
  try { d.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch { /* ignore */ }
}

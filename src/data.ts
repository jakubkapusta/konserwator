// Catalog of paintings and the per-level data built by tools/build.py (public/p/...).

export type LevelId = 'latwy' | 'sredni' | 'trudny';
export const LEVELS: { id: LevelId; name: string }[] = [
  { id: 'latwy', name: 'Łatwy' },
  { id: 'sredni', name: 'Średni' },
  { id: 'trudny', name: 'Trudny' },
];

export interface CatalogItem {
  slug: string;
  size: [number, number];
  levels: Record<LevelId, { colors: number; regions: number; v?: string }>;
  v?: string; // content hash of image + thumb
  title: string;
  author: string;
  date: string;
  objectNumber: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
  kind?: string;
  medium?: string;
  iiif?: string; // IIIF image service (full-resolution detail on deep zoom)
  dimensions?: string;
  story?: { client: string; text: string };
  card?: string[];
  dirt?: Partial<{ soot: number; webs: number; spots: number }>;
}

export interface Region {
  c: number; // paint index
  x: number; // label point
  y: number;
  r: number; // inscribed radius at the label point
  a: number; // area (px)
  b: [number, number, number, number]; // bbox x0, y0, x1, y1
}

export interface LevelData {
  level: LevelId;
  width: number;
  height: number;
  palette: [number, number, number][];
  regions: Region[];
  map: Uint16Array; // region id per pixel, row-major
  byColor: number[][]; // region ids per paint
}

const base = './p/';

export async function loadCatalog(): Promise<CatalogItem[]> {
  const r = await fetch(base + 'catalog.json', { cache: 'no-cache' });
  const j = await r.json();
  for (const p of j.paintings as CatalogItem[]) {
    if (p.v) versions.set(p.slug, p.v);
    for (const [lv, info] of Object.entries(p.levels)) if (info.v) versions.set(p.slug + '/' + lv, info.v);
  }
  return j.paintings;
}

const versions = new Map<string, string>();
const q = (v?: string) => (v ? `?v=${v}` : '');
export const thumbUrl = (slug: string) => `${base}${slug}/thumb.jpg${q(versions.get(slug))}`;
export const imageUrl = (slug: string) => `${base}${slug}/image.jpg${q(versions.get(slug))}`;

export async function loadLevel(slug: string, level: LevelId): Promise<LevelData> {
  const [info, bin] = await Promise.all([
    fetch(`${base}${slug}/${level}.json${q(versions.get(slug + '/' + level))}`).then((r) => r.json()),
    fetch(`${base}${slug}/${level}.bin${q(versions.get(slug + '/' + level))}`).then((r) => r.arrayBuffer()),
  ]);
  const runs = new Uint16Array(bin);
  const map = new Uint16Array(info.width * info.height);
  let o = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const v = runs[i], n = runs[i + 1];
    map.fill(v, o, o + n);
    o += n;
  }
  const byColor: number[][] = info.palette.map(() => []);
  info.regions.forEach((r: Region, i: number) => byColor[r.c].push(i));
  return { level, width: info.width, height: info.height, palette: info.palette, regions: info.regions, map, byColor };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image ' + url));
    im.src = url;
  });
}

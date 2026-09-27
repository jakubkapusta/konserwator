// Screen-space particles: dust puffs, scraped flakes, solvent droplets, sparkles. CPU simulated, drawn as sprites.

export const enum Sprite { Dot = 0, Flake = 1, Spark = 2, Ring = 3 }

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; grow: number; rot: number; spin: number;
  r: number; g: number; b: number; a: number;
  add: boolean; // additive (light) vs normal
  life: number; age: number;
  grav: number; drag: number;
  k: Sprite;
}

const MAX = 1400;

export class Particles {
  list: Particle[] = [];

  spawn(p: Partial<Particle> & { x: number; y: number }) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      vx: 0, vy: 0, size: 6, grow: 0, rot: Math.random() * 6.28, spin: 0,
      r: 1, g: 1, b: 1, a: 1, add: false, life: 1, age: 0, grav: 0, drag: 1, k: Sprite.Dot, ...p,
    });
  }

  update(dt: number) {
    const l = this.list;
    let j = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.size += p.grow * dt;
      l[j++] = p;
    }
    l.length = j;
  }

  /** Writes instances: x, y, size, rot, r, g, b, a (premultiplied), sprite. Returns count. */
  fill(out: Float32Array, additive: boolean) {
    let n = 0;
    for (const p of this.list) {
      if (p.add !== additive) continue;
      const t = p.age / p.life;
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t) * 1.2;
      const a = Math.min(1, p.a * fade);
      const o = n * 9;
      if (o + 9 > out.length) break;
      out[o] = p.x; out[o + 1] = p.y; out[o + 2] = Math.max(0.5, p.size); out[o + 3] = p.rot;
      out[o + 4] = p.r * a; out[o + 5] = p.g * a; out[o + 6] = p.b * a; out[o + 7] = additive ? 0 : a;
      out[o + 8] = p.k;
      n++;
    }
    return n;
  }
}

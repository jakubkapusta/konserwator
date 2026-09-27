// DOM layer: the studio (menu), the commission card, the workbench HUD (tools, palette, toasts, cursor, hint ring).
import { LEVELS, thumbUrl, type CatalogItem, type LevelData, type LevelId } from '../data';
import type { Tool } from '../render/dirt';
import type { PointerKind } from '../game/input';
import type { Cleaning } from '../game/cleaning';
import { TOOLS } from '../game/cleaning';
import type { Phase, StudioUI } from '../game/studio';
import { allWork, loadDone, type WorkSave } from '../game/save';
import { ICON, TOOL_ICONS } from './icons';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const STAGE_NAMES: Record<string, string> = { clean: 'Czyszczenie', retouch: 'Retusz', done: 'Ukończony' };

export interface UIActions {
  open(item: CatalogItem): void;
  start(item: CatalogItem, level: LevelId, fresh: boolean): void;
  back(): void;
  tool(t: Tool): void;
  select(c: number): void;
  hint(): void;
  fit(): void;
  peek(on: boolean): void;
  mute(): boolean;
  skip(): void;
  restart(): void;
}

export class UI implements StudioUI {
  private menu = h('section', 'screen menu');
  private comm = h('section', 'screen commission');
  private hud = h('section', 'screen hud');
  private fin = h('section', 'screen finale');
  private loadingEl = h('div', 'screen loading', 'Rozpakowuję obraz<i></i>');
  private stageName = h('div', 'stage-name');
  private stageSub = h('div', 'stage-sub');
  private barFill = h('i');
  private tools = h('div', 'dock tools');
  private pal = h('div', 'dock palette');
  private swatches = h('div', 'swatches');
  private findBtn = h('button', 'find', ICON.find + '<span>Znajdź</span>');
  private toastEl = h('div', 'toast');
  private cursorEl = h('div', 'cursor', '<div class="area"></div>');
  private markerEl = h('div', 'marker');
  private pop = h('div', 'menu-pop');
  private soundBtn = h('button', 'pill icon');
  private toastTimer = 0;
  private swEls: HTMLElement[] = [];
  private totals: number[] = [];
  private curTool: Tool = 1;
  private cursorTool = -1;
  item: CatalogItem | null = null;

  constructor(private root: HTMLElement, private act: UIActions, muted: boolean) {
    root.append(this.menu, this.comm, this.hud, this.fin, this.loadingEl);
    this.buildHud(muted);
  }

  // ---------------- menu ----------------
  showMenu(items: CatalogItem[]) {
    this.hideAll();
    const work = allWork();
    const done = loadDone();
    this.menu.innerHTML = '';
    const head = h('header', '', `<h1>Konser<span>w</span>ator</h1><p>Pracownia konserwacji malarstwa</p>`);
    const grid = h('div', 'commissions');
    for (const it of items) {
      const w = work[it.slug];
      const d = done[it.slug] ?? {};
      const c = h('button', 'card' + (Object.keys(d).length ? ' done' : w ? ' started' : ''));
      c.innerHTML = `<div class="dots">${LEVELS.map((l) => `<i class="${d[l.id] ? 'on' : ''}" title="${l.name}"></i>`).join('')}</div>
        <div class="pic"><div class="fr"><img src="${thumbUrl(it.slug)}" alt="" loading="lazy"></div></div>
        <h3>${it.title}</h3><div class="by">${it.author}, ${it.date}</div>
        <div class="state">${w ? stateText(w) : Object.keys(d).length ? 'Wisi w galerii' : 'Nowe zlecenie'}</div>`;
      c.onclick = () => this.act.open(it);
      grid.append(c);
    }
    const foot = h('footer', '', 'Obrazy: Rijksmuseum, domena publiczna');
    this.menu.append(head, grid, foot);
    this.menu.classList.add('show');
  }

  showCommission(it: CatalogItem) {
    this.item = it;
    const w = allWork()[it.slug];
    const done = loadDone()[it.slug] ?? {};
    let level: LevelId = w?.level ?? 'latwy';
    const sheet = h('div', 'sheet');
    sheet.innerHTML = `<div class="tag">Zlecenie</div><h2>${it.title}</h2><div class="by">kopia według: ${it.author}, ${it.date}</div>
      <div class="story"><img src="${thumbUrl(it.slug)}" alt=""><p>${it.story?.text ?? ''}<span class="client">${it.story?.client ?? ''}</span></p></div>`;
    const lv = h('div', 'levels');
    const lvEls = LEVELS.map((l) => {
      const b = h('button', 'lvl' + (done[l.id] ? ' won' : ''), `<b>${l.name}</b><span>${it.levels[l.id].colors} farb · ${it.levels[l.id].regions} pól</span>`);
      b.onclick = () => { level = l.id; lvEls.forEach((e, i) => e.classList.toggle('on', LEVELS[i].id === level)); upd(); };
      lv.append(b);
      return b;
    });
    const actions = h('div', 'actions');
    const upd = () => {
      lvEls.forEach((e, i) => e.classList.toggle('on', LEVELS[i].id === level));
      actions.innerHTML = '';
      const cancel = h('button', 'btn ghost', 'Wróć');
      cancel.onclick = () => this.comm.classList.remove('show');
      if (w && w.level === level && w.stage !== 'done') {
        const cont = h('button', 'btn', 'Kontynuuj · ' + stateText(w));
        cont.onclick = () => this.act.start(it, level, false);
        const fresh = h('button', 'btn ghost', 'Zacznij od nowa');
        fresh.onclick = () => this.act.start(it, level, true);
        actions.append(cont, fresh, cancel);
      } else {
        const go = h('button', 'btn', w && w.stage !== 'done' ? 'Zacznij na tym poziomie' : 'Przyjmij zlecenie');
        go.onclick = () => this.act.start(it, level, true);
        actions.append(go, cancel);
      }
    };
    sheet.append(lv, actions, h('div', 'credit', `Oryginał: ${it.license}${it.objectNumber ? ' · ' + it.objectNumber : ''}`));
    upd();
    this.comm.innerHTML = '';
    this.comm.append(sheet);
    this.comm.onclick = (e) => { if (e.target === this.comm) this.comm.classList.remove('show'); };
    this.comm.classList.add('show');
  }

  loading(on: boolean) { this.loadingEl.classList.toggle('show', on); }

  hideAll() {
    for (const e of [this.menu, this.comm, this.hud, this.fin]) e.classList.remove('show');
    this.pop.classList.remove('show');
  }

  // ---------------- HUD ----------------
  private buildHud(muted: boolean) {
    const top = h('div', 'top');
    const back = h('button', 'pill back', ICON.back + '<span>Pracownia</span>');
    back.onclick = () => this.act.back();
    const sb = h('div', 'stagebox');
    const bar = h('div', 'bar');
    bar.append(this.barFill);
    sb.append(this.stageName, bar, this.stageSub);
    const right = h('div', 'right');
    const eye = h('button', 'pill icon', ICON.eye);
    eye.title = 'Przytrzymaj, żeby zobaczyć oryginał';
    const peekOn = (e: Event) => { e.preventDefault(); eye.classList.add('on'); this.act.peek(true); };
    const peekOff = () => { eye.classList.remove('on'); this.act.peek(false); };
    eye.addEventListener('pointerdown', peekOn);
    eye.addEventListener('pointerup', peekOff);
    eye.addEventListener('pointerleave', peekOff);
    eye.addEventListener('pointercancel', peekOff);
    const fit = h('button', 'pill icon', ICON.fit);
    fit.title = 'Cały obraz';
    fit.onclick = () => this.act.fit();
    this.soundBtn.innerHTML = muted ? ICON.mute : ICON.sound;
    this.soundBtn.onclick = () => { const m = this.act.mute(); this.soundBtn.innerHTML = m ? ICON.mute : ICON.sound; };
    const more = h('button', 'pill icon', ICON.more);
    more.onclick = (e) => { e.stopPropagation(); this.pop.classList.toggle('show'); };
    right.append(eye, fit, this.soundBtn, more);
    top.append(back, sb, right);

    const skip = h('button', '', 'Pomiń czyszczenie (test)');
    skip.onclick = () => { this.pop.classList.remove('show'); this.act.skip(); };
    const restart = h('button', '', 'Zacznij ten obraz od nowa');
    restart.onclick = () => { this.pop.classList.remove('show'); this.act.restart(); };
    this.pop.append(h('div', 'muted', 'Rysik maluje, palce przesuwają i przybliżają. Bez rysika: jeden palec maluje, dwa przesuwają.'), h('div', 'sep'), skip, restart);
    document.addEventListener('pointerdown', (e) => { if (!this.pop.contains(e.target as Node)) this.pop.classList.remove('show'); });

    for (const t of TOOLS) {
      const b = h('button', 'tool', TOOL_ICONS[t.id].svg + `<span>${t.name}</span><div class="ring"></div>`);
      b.dataset.t = String(t.id);
      b.title = t.hint;
      b.onclick = () => this.act.tool(t.id);
      this.tools.append(b);
    }
    this.findBtn.onclick = () => this.act.hint();
    this.pal.append(this.findBtn, this.swatches);
    this.hud.append(top, this.tools, this.pal, this.toastEl, this.cursorEl, this.markerEl, this.pop);
  }

  showHud(it: CatalogItem) {
    this.hideAll();
    this.item = it;
    this.hud.classList.add('show');
    this.stageSub.textContent = it.title;
  }

  /** Space taken by the bars, for the camera. */
  insets() {
    const top = (this.hud.querySelector('.top') as HTMLElement).getBoundingClientRect().bottom + 6;
    const dock = this.pal.classList.contains('show') ? this.pal : this.tools;
    const bottom = window.innerHeight - dock.getBoundingClientRect().top + 8;
    return { top: Math.max(56, top), bottom: Math.max(90, Math.min(bottom, 180)), left: 8, right: 8 };
  }

  phase(p: Phase) {
    const clean = p === 'intro' || p === 'clean';
    this.tools.classList.toggle('show', clean);
    this.pal.classList.toggle('show', p === 'retouch');
    this.stageName.textContent = clean || p === 'toRetouch' ? STAGE_NAMES.clean : p === 'retouch' ? STAGE_NAMES.retouch : 'Obraz odzyskał kolory';
    if (p === 'finale' || p === 'done') { this.barFill.style.width = '100%'; this.fin.classList.remove('show'); }
    if (p === 'toRetouch') this.barFill.style.width = '100%';
    if (p === 'retouch') this.barFill.style.width = '0%';
  }

  cleanProgress(c: Cleaning) {
    this.barFill.style.width = (c.progress * 100).toFixed(1) + '%';
    const needed = c.toolsNeeded;
    for (const el of this.tools.children as HTMLCollectionOf<HTMLElement>) {
      const def = TOOLS.find((t) => t.id === +el.dataset.t!)!;
      const show = needed.includes(def);
      el.style.display = show ? '' : 'none';
      const rem = def.channels.filter((ch) => c.channels.includes(ch)).reduce((a, ch) => a + c.remaining(ch), 0) / Math.max(1, def.channels.filter((ch) => c.channels.includes(ch)).length);
      el.style.setProperty('--p', (1 - rem).toFixed(3));
      el.classList.toggle('clear', show && def.channels.every((ch) => !c.channels.includes(ch) || c.layerDone[ch]));
    }
  }

  tool(t: Tool) {
    this.curTool = t;
    for (const el of this.tools.children as HTMLCollectionOf<HTMLElement>) {
      el.classList.toggle('on', +el.dataset.t! === t);
      if (+el.dataset.t! === t) el.classList.remove('nudge');
    }
  }

  suggestTool(t: Tool) {
    if (t === this.curTool) return;
    const el = this.tools.querySelector(`[data-t="${t}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
  }

  toast(text: string, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  palette(lv: LevelData, left: number[], sel: number) {
    this.swatches.innerHTML = '';
    this.totals = lv.byColor.map((r) => r.length);
    this.swEls = lv.palette.map((c, i) => {
      const b = h('button', 'sw');
      const L = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
      b.style.setProperty('--c', `rgb(${c[0]},${c[1]},${c[2]})`);
      b.style.setProperty('--t', L > 0.55 ? '#2a2018' : '#fbf5ea');
      b.style.setProperty('--ts', L > 0.55 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.6)');
      b.innerHTML = `<span class="ring"></span><span class="blob"></span><b>${i + 1}</b><i></i>`;
      b.onclick = () => this.act.select(i);
      this.swatches.append(b);
      return b;
    });
    left.forEach((n, i) => this.paintLeft(i, n, true));
    this.select(sel);
  }

  paintLeft(c: number, left: number, instant = false) {
    const el = this.swEls[c];
    if (!el) return;
    el.style.setProperty('--p', (1 - left / Math.max(1, this.totals[c])).toFixed(3));
    (el.querySelector('i') as HTMLElement).textContent = String(left);
    if (left === 0) {
      if (instant) el.classList.add('done');
      else setTimeout(() => el.classList.add('done'), 650);
    }
    this.findBtn.classList.toggle('pulse', this.swEls.some((e, i) => e.classList.contains('on') && i === c && left > 0 && left <= 2));
  }

  select(c: number) {
    this.swEls.forEach((e, i) => e.classList.toggle('on', i === c));
    const el = this.swEls[c];
    if (el) {
      const r = el.getBoundingClientRect(), p = this.swatches.getBoundingClientRect();
      if (r.left < p.left + 20 || r.right > p.right - 20) this.swatches.scrollLeft += r.left - p.left - p.width / 2 + r.width / 2;
      const left = +((el.querySelector('i') as HTMLElement).textContent || 0);
      this.findBtn.classList.toggle('pulse', left > 0 && left <= 2);
    }
  }

  wrong(c: number) {
    const el = this.swEls[c];
    if (!el || el.classList.contains('done')) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  retouchProgress(done: number, total: number) {
    this.barFill.style.width = ((done / Math.max(1, total)) * 100).toFixed(1) + '%';
  }

  cursor(x: number, y: number, show: boolean, tool: Tool, r: number, kind: PointerKind | null, swabDirt: number) {
    const c = this.cursorEl;
    c.classList.toggle('show', show);
    if (!show) return;
    if (this.cursorTool !== tool) {
      this.cursorTool = tool;
      c.querySelector('svg')?.remove();
      c.insertAdjacentHTML('beforeend', TOOL_ICONS[tool].svg);
      const [tx, ty] = TOOL_ICONS[tool].tip;
      const s = c.querySelector('svg') as SVGElement;
      s.style.left = -tx + 'px';
      s.style.top = -ty + 'px';
      s.style.transformOrigin = `${tx}px ${ty}px`;
    }
    c.classList.toggle('pen', kind === 'pen');
    c.classList.toggle('touch', kind === 'touch');
    c.style.transform = `translate(${x}px, ${y}px)`;
    const a = c.firstElementChild as HTMLElement;
    a.style.width = a.style.height = 2 * r + 'px';
    const d = Math.min(1, swabDirt);
    c.style.setProperty('--tip', `rgb(${251 - d * 90},${247 - d * 120},${238 - d * 180})`);
  }

  marker(x: number, y: number, r: number, show: boolean) {
    const m = this.markerEl;
    m.classList.toggle('show', show);
    if (!show) return;
    const d = Math.max(34, r * 2);
    m.style.width = m.style.height = d + 'px';
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }

  finale() {
    const it = this.item;
    if (!it) return;
    const sheet = h('div', 'sheet');
    sheet.innerHTML = `<div class="tag">Karta obrazu</div><h2>${it.title}</h2><div class="by">${it.author}, ${it.date}</div>
      <div class="card-text" style="margin-top:14px">${(it.card ?? []).map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="next">Retusz ukończony. Złocenie ramy, werniks i galeria dojdą w kolejnym etapie prac.</div>`;
    const actions = h('div', 'actions');
    const admire = h('button', 'btn ghost', 'Podziwiaj');
    admire.onclick = () => this.fin.classList.remove('show');
    const back = h('button', 'btn', 'Wróć do pracowni');
    back.onclick = () => this.act.back();
    actions.append(back, admire);
    sheet.append(actions, h('div', 'credit', `${it.license}${it.objectNumber ? ' · ' + it.objectNumber : ''}`));
    this.fin.innerHTML = '';
    this.fin.append(sheet);
    this.fin.classList.add('show');
  }
}

function stateText(w: WorkSave) {
  const lv = LEVELS.find((l) => l.id === w.level)?.name ?? '';
  if (w.stage === 'done') return `${lv}: ukończony`;
  return `${lv} · ${STAGE_NAMES[w.stage].toLowerCase()} ${Math.round(w.progress * 100)}%`;
}

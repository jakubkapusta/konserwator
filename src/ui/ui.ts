// DOM layer: the studio (menu), the commission card, the workbench HUD (tools, palette, toasts, cursor, hint ring).
import { downloadAll, LEVELS, thumbUrl, type CatalogItem, type LevelData, type LevelId } from '../data';
import type { Tool } from '../render/dirt';
import type { PointerKind } from '../game/input';
import type { Cleaning } from '../game/cleaning';
import { TOOLS } from '../game/cleaning';
import type { Phase, StudioUI } from '../game/studio';
import { allWork, loadDone, type Prefs, type WorkSave } from '../game/save';
import { ICON, TOOL_ICONS } from './icons';
import { Motes } from './motes';

const hashStr = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const STAGE_NAMES: Record<string, string> = { clean: 'Czyszczenie', retouch: 'Retusz', gild: 'Złocenie', varnish: 'Werniks', done: 'Ukończony' };
const PHASE_NAMES: Record<Phase, string> = {
  intro: 'Czyszczenie', clean: 'Czyszczenie', toRetouch: 'Czyszczenie', retouch: 'Retusz', toGild: 'Retusz',
  gild: 'Złocenie ramy', toVarnish: 'Złocenie ramy', varnish: 'Werniks', finale: 'Odnowiony', done: 'Odnowiony',
};

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
  gallery(focus?: string): void;
  menu(): void;
  replay(item: CatalogItem): void;
  music(): boolean;
  sfx(): boolean;
  skip(): void;
  restart(): void;
}

export class UI implements StudioUI {
  private menu = h('section', 'screen menu');
  private gal = h('section', 'screen gallery');
  replaying = false;
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
  private findBtn = h('button', 'find', ICON.find + '<span>Znajdź</span><em></em>');
  private hintsLeft = 5;
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

  constructor(private root: HTMLElement, private act: UIActions, private prefs: Prefs) {
    root.append(this.menu, this.gal, this.comm, this.hud, this.fin, this.loadingEl);
    this.buildHud(prefs);
  }

  /** Music / effects switches: the same state wherever they are (studio corner, gallery, workbench menu). */
  private flipSound(which: 'music' | 'sfx') {
    if (which === 'music') this.act.music(); else this.act.sfx();
    this.syncSound();
  }
  private syncSound() {
    this.root.querySelectorAll<HTMLElement>('[data-snd]').forEach((e) => e.classList.toggle(e.classList.contains('toggle') ? 'on' : 'off',
      e.classList.contains('toggle') ? this.prefs[e.dataset.snd as 'music' | 'sfx'] : !this.prefs[e.dataset.snd as 'music' | 'sfx']));
  }
  private soundCorner() {
    const box = h('div', 'snd');
    for (const [k, icon, title] of [['music', ICON.note, 'Muzyka'], ['sfx', ICON.sound, 'Efekty dźwiękowe']] as const) {
      const b = h('button', 'knob', icon);
      b.dataset.snd = k;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.onclick = () => this.flipSound(k);
      box.append(b);
    }
    return box;
  }

  // ---------------- menu ----------------
  private kindFilter = '';
  private showDone = false;
  private motes: Motes | null = null;

  /** The studio: an easel with the current work, commissions hanging salon-style on the wall, dust in the window light. */
  showMenu(items: CatalogItem[]) {
    this.hideAll();
    const work = allWork();
    const done = loadDone();
    const isDone = (it: CatalogItem) => Object.keys(done[it.slug] ?? {}).length > 0;
    const live = (it: CatalogItem) => !!work[it.slug] && work[it.slug].stage !== 'done';
    this.menu.innerHTML = '';
    const motes = h('canvas', 'motes') as HTMLCanvasElement;
    this.menu.append(h('div', 'beam'), motes);
    (this.motes ??= new Motes(motes));
    if (this.motes.canvas !== motes) this.motes = new Motes(motes);
    this.motes.start();

    const head = h('header', 'sign', `<h1 class="gilt">Konserwator</h1><p>Pracownia konserwacji malarstwa</p>`);
    head.append(this.tabs('menu'));
    this.menu.append(head, this.soundCorner());

    // the easel: the most recent work in progress, or the next commission waiting
    const current = items.filter(live).sort((a, b) => work[b.slug].t - work[a.slug].t);
    const next = current[0] ?? items.find((it) => !isDone(it) && !live(it)) ?? items[0];
    if (next) {
      const w = work[next.slug];
      const p = live(next) ? w.progress : 0;
      const stage = live(next) ? w.stage : 'new';
      const easel = h('section', 'easel-hero');
      easel.innerHTML = `
        <div class="easel">
          <svg class="legs" viewBox="0 0 200 300" preserveAspectRatio="none"><path d="M100 0 L30 300 M100 0 L170 300 M100 0 L100 300" stroke="#5d3b22" stroke-width="9" stroke-linecap="round"/><path d="M40 220 H160" stroke="#4a2e1a" stroke-width="10" stroke-linecap="round"/></svg>
          <div class="board">${this.miniature(next, stage, p, 'big')}</div>
          <div class="ledge"></div>
        </div>
        <div class="hero-text">
          <div class="tag">${current.length ? 'Na sztalugach' : 'Czeka na ciebie'}</div>
          <h2>${next.title}</h2><div class="by">${next.author}, ${next.date}</div>
          ${live(next) ? `<div class="hero-bar"><i style="width:${(p * 100).toFixed(0)}%"></i></div><div class="hero-state">${stateText(w)}</div>` : `<p class="hero-story">${next.story?.text ?? ''}</p>`}
        </div>`;
      const go = h('button', 'btn', live(next) ? 'Wróć do pracy' : 'Obejrzyj zlecenie');
      go.onclick = () => this.act.open(next);
      easel.querySelector('.hero-text')!.append(go);
      easel.querySelector('.easel')!.addEventListener('click', () => this.act.open(next));
      if (current.length > 1) {
        const more = h('div', 'others');
        current.slice(1, 5).forEach((it) => {
          const b = h('button', 'mini', `${this.miniature(it, work[it.slug].stage, work[it.slug].progress, 'small')}<span>${it.title}</span>`);
          b.onclick = () => this.act.open(it);
          more.append(b);
        });
        easel.querySelector('.hero-text')!.append(more);
      }
      this.menu.append(easel);
    }

    // the wall
    const kinds = [...new Set(items.map((i) => i.kind).filter(Boolean))] as string[];
    const bar = h('div', 'wallbar');
    const chips = h('div', 'chips');
    const toggle = h('button', 'toggle-done', '<i></i><span>Pokaż ukończone</span>');
    const wall = h('div', 'salon');
    const fill = () => {
      wall.innerHTML = '';
      const list = items.filter((it) => (!this.kindFilter || it.kind === this.kindFilter) && (this.showDone || !isDone(it)));
      list.forEach((it, i) => {
        const w = work[it.slug];
        const stage = isDone(it) ? 'done' : live(it) ? w.stage : 'new';
        const rot = ((hashStr(it.slug) % 100) / 100 - 0.5) * 3.2;
        const c = h('button', `hung-card ${stage === 'done' ? 'done' : stage === 'new' ? 'new' : 'started'}`);
        c.style.setProperty('--rot', rot.toFixed(2) + 'deg');
        c.style.setProperty('--delay', Math.min(i, 20) * 45 + 'ms');
        const L = it.levels.latwy;
        c.innerHTML = `<div class="string"></div>${this.miniature(it, stage, live(it) ? w.progress : 0, 'onwall', [200, 175, 225][hashStr(it.slug) % 3])}
          <div class="label"><div class="meta"><em>${it.kind ?? 'obraz'} · ${L.colors} farb · od ${L.regions} pól</em>
          <i class="dots">${LEVELS.map((l) => `<u class="${done[it.slug]?.[l.id] ? 'on' : ''}"></u>`).join('')}</i></div><b>${it.title}</b><span>${it.author}</span></div>`;
        c.onclick = () => { c.classList.remove('swing'); void c.offsetWidth; c.classList.add('swing'); setTimeout(() => this.act.open(it), 180); };
        wall.append(c);
      });
      if (!list.length) wall.append(h('div', 'empty-wall', this.showDone ? 'Nic tu nie ma.' : 'Wszystkie zlecenia z tej grupy już wiszą w galerii. Włącz „Pokaż ukończone”.'));
      chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.k === this.kindFilter));
      toggle.classList.toggle('on', this.showDone);
    };
    for (const k of ['', ...kinds]) {
      const b = h('button', '', k ? k[0].toUpperCase() + k.slice(1) : 'Wszystkie');
      b.dataset.k = k;
      b.onclick = () => { this.kindFilter = k; fill(); };
      chips.append(b);
    }
    toggle.onclick = () => { this.showDone = !this.showDone; fill(); };
    bar.append(h('h2', 'shelf', 'Zlecenia'), chips, toggle);
    fill();
    const foot = h('footer', '', 'Obrazy: Rijksmuseum, domena publiczna');
    // the flag holds how many paintings were downloaded: new ones in the catalog ask for a download again
    let offFlag: string | null = null;
    try { offFlag = localStorage.getItem('konserwator.offline'); } catch { /* ignore */ }
    const off = h('button', 'offline', offFlag === String(items.length) ? 'Cała kolekcja jest dostępna offline ✓'
      : `Pobierz całą kolekcję do gry bez internetu (ok. ${Math.round(items.length * 1.9)} MB)`);
    off.onclick = async () => {
      if (off.classList.contains('busy')) return;
      off.classList.add('busy');
      const failed = await downloadAll(items, (d, t) => { off.textContent = `Pobieram obrazy… ${Math.round((d / t) * 100)}%`; });
      off.classList.remove('busy');
      if (failed) off.textContent = `Nie udało się pobrać ${failed} plików. Spróbuj ponownie.`;
      else { off.textContent = 'Cała kolekcja jest dostępna offline ✓'; try { localStorage.setItem('konserwator.offline', String(items.length)); } catch { /* ignore */ } }
    };
    this.menu.append(bar, wall, off, foot);
    this.menu.classList.add('show');
    this.syncSound();
  }

  /** A painting in its current state: dirty, partly cleaned (diagonal wipe by progress) or restored in gold. */
  private miniature(it: CatalogItem, stage: string, progress: number, size: 'big' | 'onwall' | 'small', wallH = 200) {
    const src = thumbUrl(it.slug);
    const ar = it.size[0] / it.size[1];
    // explicit picture size: big fits a box, wall has a fixed height, small a fixed width
    let pw: string, ph: string;
    if (size === 'big') {
      const box = Math.min(window.innerWidth * 0.72, 330), bh = Math.min(window.innerHeight * 0.38, 330);
      const w = Math.min(box, bh * ar);
      pw = w + 'px'; ph = w / ar + 'px';
    } else if (size === 'onwall') {
      const w = Math.min(wallH * ar, window.innerWidth - 90);
      pw = w + 'px'; ph = w / ar + 'px';
    } else { pw = '56px'; ph = 56 / ar + 'px'; }
    const cleanFrac = stage === 'new' ? 0 : stage === 'clean' ? progress * 0.9 : 1;
    const wipe = (cleanFrac * 140 - 20).toFixed(0);
    const gilt = stage === 'done' || stage === 'varnish' ? ' gilt' : '';
    return `<div class="mini-frame ${size}${gilt}" style="--pw:${pw};--ph:${ph}">
      <div class="mini-pic">
        <img class="dirty" src="${src}" alt="" loading="lazy">
        ${cleanFrac > 0 ? `<img class="clean" src="${src}" alt="" loading="lazy" style="clip-path: polygon(0 0, ${wipe}% 0, ${Number(wipe) - 40}% 100%, 0 100%)">` : ''}
        ${cleanFrac < 1 ? '<div class="grime"></div>' : ''}
        ${stage === 'new' ? '<svg class="web" viewBox="0 0 60 60"><path d="M60 0 L0 60 M60 0 L20 60 M60 0 L40 60 M60 0 L0 20 M60 0 L0 40 M36 0 Q44 16 60 24 M24 0 Q36 26 60 36 M12 0 Q28 34 60 48" stroke="rgba(235,230,215,.5)" stroke-width="0.7" fill="none"/></svg>' : ''}
        ${gilt ? '<div class="sheen"></div>' : ''}
      </div></div>`;
  }

  showCommission(it: CatalogItem) {
    this.item = it;
    const w = allWork()[it.slug];
    const done = loadDone()[it.slug] ?? {};
    let level: LevelId = w?.level ?? 'latwy';
    const sheet = h('div', 'sheet');
    sheet.innerHTML = `<div class="tag">${it.kind ? it.kind[0].toUpperCase() + it.kind.slice(1) : 'Obraz'}</div><h2>${it.title}</h2><div class="by">${it.author}, ${it.date}</div>
      <div class="orig"><img src="${thumbUrl(it.slug)}" alt=""><div>${(it.card ?? []).slice(0, 2).map((p) => `<p>${p}</p>`).join('')}</div></div>
      <div class="order"><div class="tag">Zlecenie</div><p>${it.story?.text ?? ''}</p><span class="client">${it.story?.client ?? ''}</span></div>`;
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
    for (const e of [this.menu, this.gal, this.comm, this.hud, this.fin]) e.classList.remove('show');
    this.motes?.stop();
    this.pop.classList.remove('show');
  }

  // ---------------- HUD ----------------
  private buildHud(prefs: Prefs) {
    const muted = prefs.muted;
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
    const fit = h('button', 'pill icon fit', ICON.fit);
    fit.title = 'Cały obraz';
    fit.onclick = () => this.act.fit();
    this.soundBtn.innerHTML = muted ? ICON.mute : ICON.sound;
    this.soundBtn.onclick = () => { const m = this.act.mute(); this.soundBtn.innerHTML = m ? ICON.mute : ICON.sound; };
    const more = h('button', 'pill icon', ICON.more);
    more.onclick = (e) => { e.stopPropagation(); this.pop.classList.toggle('show'); };
    right.append(eye, fit, this.soundBtn, more);
    top.append(back, sb, right);

    const skip = h('button', '', 'Pomiń ten etap (test)');
    skip.onclick = () => { this.pop.classList.remove('show'); this.act.skip(); };
    const restart = h('button', '', 'Zacznij ten obraz od nowa');
    restart.onclick = () => { this.pop.classList.remove('show'); this.act.restart(); };
    const toggle = (label: string, k: 'music' | 'sfx') => {
      const b = h('button', 'toggle' + (prefs[k] ? ' on' : ''), `<i></i><span>${label}</span>`);
      b.dataset.snd = k;
      b.onclick = () => this.flipSound(k);
      return b;
    };
    this.pop.append(
      toggle('Muzyka', 'music'),
      toggle('Efekty dźwiękowe', 'sfx'),
      h('div', 'sep'),
      h('div', 'muted', 'Rysik maluje, palce przesuwają i przybliżają, a stuknięcie palcem maluje pole. Bez rysika jeden palec maluje, a dwa przesuwają.'),
      h('div', 'sep'), skip, restart);
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

  showHud(it: CatalogItem, replay = false) {
    this.hideAll();
    this.item = it;
    this.replaying = replay;
    this.hud.classList.toggle('replay', replay);
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
    this.tools.classList.toggle('show', clean && !this.replaying);
    this.pal.classList.toggle('show', p === 'retouch' && !this.replaying);
    const name = this.item?.gold ? PHASE_NAMES[p].replace('Złocenie ramy', 'Złocenie') : PHASE_NAMES[p];
    this.stageName.textContent = this.replaying ? 'Nagranie renowacji' : name;
    this.stageSub.textContent = this.replaying ? name + ' · ' + (this.item?.title ?? '') : this.item?.title ?? '';
    if (p === 'finale' || p === 'done') { this.barFill.style.width = '100%'; this.fin.classList.remove('show'); }
    if (p === 'toRetouch' || p === 'toGild' || p === 'toVarnish') this.barFill.style.width = '100%';
    if (p === 'retouch' || p === 'gild' || p === 'varnish') this.barFill.style.width = '0%';
  }

  progress(p: number) {
    this.barFill.style.width = (p * 100).toFixed(1) + '%';
  }

  cleanProgress(c: Cleaning) {
    this.barFill.style.width = (c.progress * 100).toFixed(1) + '%';
    const needed = c.toolsNeeded;
    for (const el of this.tools.children as HTMLCollectionOf<HTMLElement>) {
      const id = +el.dataset.t! as Tool;
      const def = TOOLS.find((t) => t.id === id)!;
      const show = needed.includes(def);
      el.style.display = show ? '' : 'none';
      el.style.setProperty('--p', c.toolProgress(id).toFixed(3));
      el.classList.toggle('clear', show && c.toolClear(id));
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
    this.findBtn.classList.toggle('pulse', this.hintsLeft > 0 && this.swEls.some((e, i) => e.classList.contains('on') && i === c && left > 0 && left <= 2));
  }

  select(c: number) {
    this.swEls.forEach((e, i) => e.classList.toggle('on', i === c));
    const el = this.swEls[c];
    if (el) {
      const r = el.getBoundingClientRect(), p = this.swatches.getBoundingClientRect();
      if (r.left < p.left + 20 || r.right > p.right - 20) this.swatches.scrollLeft += r.left - p.left - p.width / 2 + r.width / 2;
      const left = +((el.querySelector('i') as HTMLElement).textContent || 0);
      this.findBtn.classList.toggle('pulse', this.hintsLeft > 0 && left > 0 && left <= 2);
    }
  }

  wrong(c: number) {
    const el = this.swEls[c];
    if (!el || el.classList.contains('done')) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  hints(left: number) {
    this.hintsLeft = left;
    (this.findBtn.querySelector('em') as HTMLElement).textContent = String(left);
    this.findBtn.classList.toggle('empty', left <= 0);
    if (left <= 0) this.findBtn.classList.remove('pulse');
  }

  retouchProgress(done: number, total: number) {
    this.barFill.style.width = ((done / Math.max(1, total)) * 100).toFixed(1) + '%';
  }

  cursor(x: number, y: number, show: boolean, tool: number, r: number, kind: PointerKind | null, swabDirt: number) {
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
    a.style.display = r > 0 ? '' : 'none';
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

  private tabs(on: 'menu' | 'gallery') {
    const t = h('nav', 'tabs');
    const a = h('button', on === 'menu' ? 'on' : '', 'Pracownia');
    const b = h('button', on === 'gallery' ? 'on' : '', 'Galeria');
    a.onclick = () => this.act.menu();
    b.onclick = () => this.act.gallery();
    t.append(a, b);
    return t;
  }

  showGallery(items: CatalogItem[], focus?: string) {
    this.hideAll();
    const done = loadDone();
    const hung = items.filter((it) => done[it.slug] && Object.keys(done[it.slug]).length);
    this.gal.innerHTML = '';
    const head = h('header', '', `<h1>Galeria</h1><p>${hung.length ? `Odnowione obrazy: ${hung.length} z ${items.length}` : 'Tu zawisną obrazy, które odnowisz.'}</p>`);
    head.append(this.tabs('gallery'));
    const hall = h('div', 'hall');
    const wall = h('div', 'wall');
    for (const it of hung) {
      const lv = done[it.slug];
      const best = Math.max(...LEVELS.map((l, i) => (lv[l.id] ? i : -1)));
      const f = h('button', `hung style-${best}`);
      f.dataset.slug = it.slug;
      const [w, hh] = it.size;
      const H = 300, W = Math.round((H * w) / hh);
      f.innerHTML = `<div class="lamp"></div><div class="fr"><div class="fr-bead"><div class="fr-in"><img src="${thumbUrl(it.slug)}" alt="" style="width:${Math.min(W, 380)}px"></div></div></div>
        <div class="plaque"><b>${it.title}</b><span>${it.author}, ${it.date}</span><i>${LEVELS.map((l) => `<em class="${lv[l.id] ? 'on' : ''}"></em>`).join('')}</i></div>`;
      f.onclick = () => this.galleryCard(it);
      wall.append(f);
    }
    const left = items.length - hung.length;
    if (left) {
      const e = h('div', 'hung empty', `<div class="nail"></div><span>${left === 1 ? 'Jeszcze jedno miejsce' : `Jeszcze ${left} ${left < 5 ? 'miejsca' : 'miejsc'}`} na ścianie</span>`);
      wall.append(e);
    }
    hall.append(wall);
    this.gal.append(head, hall, h('footer', '', 'Obrazy: Rijksmuseum, domena publiczna'), this.soundCorner());
    this.gal.classList.add('show');
    this.syncSound();
    if (focus) {
      const el = wall.querySelector(`[data-slug="${focus}"]`) as HTMLElement | null;
      if (el) {
        requestAnimationFrame(() => { hall.scrollLeft = el.offsetLeft - (hall.clientWidth - el.clientWidth) / 2; });
        el.classList.add('fresh');
      }
    }
  }

  private galleryCard(it: CatalogItem) {
    const done = loadDone()[it.slug] ?? {};
    const sheet = h('div', 'sheet');
    sheet.innerHTML = `<div class="tag">Karta obrazu</div><h2>${it.title}</h2><div class="by">${it.author}, ${it.date}</div>
      <div class="card-text" style="margin-top:14px">${(it.card ?? []).map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="facts">${[it.medium, it.dimensions, it.objectNumber].filter(Boolean).join(' · ')}</div>
      <div class="order"><div class="tag">Zlecenie wykonane</div><p>${it.story?.text ?? ''}</p><span class="client">${it.story?.client ?? ''}</span></div>
      <div class="won">${LEVELS.map((l) => `<span class="${done[l.id] ? 'on' : ''}">${l.name}${done[l.id] ? ' ✓' : ''}</span>`).join('')}</div>`;
    const actions = h('div', 'actions');
    const watch = h('button', 'btn', 'Obejrzyj renowację');
    watch.onclick = () => { this.comm.classList.remove('show'); this.act.replay(it); };
    const again = h('button', 'btn ghost', 'Odnów jeszcze raz');
    again.onclick = () => this.showCommission(it);
    const close = h('button', 'btn ghost', 'Zamknij');
    close.onclick = () => this.comm.classList.remove('show');
    actions.append(watch, again, close);
    sheet.append(actions, h('div', 'credit', `${it.license}${it.objectNumber ? ' · ' + it.objectNumber : ''}`));
    this.comm.innerHTML = '';
    this.comm.append(sheet);
    this.comm.onclick = (e) => { if (e.target === this.comm) this.comm.classList.remove('show'); };
    this.comm.classList.add('show');
  }

  replayDone() {
    const sheet = h('div', 'sheet');
    sheet.innerHTML = `<div class="tag">Koniec nagrania</div><h2>${this.item?.title ?? ''}</h2><div class="by">${this.item?.author ?? ''}, ${this.item?.date ?? ''}</div>`;
    const actions = h('div', 'actions');
    const back = h('button', 'btn', 'Wróć do galerii');
    back.onclick = () => this.act.gallery(this.item?.slug);
    const admire = h('button', 'btn ghost', 'Podziwiaj');
    admire.onclick = () => this.fin.classList.remove('show');
    actions.append(back, admire);
    sheet.append(actions);
    this.fin.innerHTML = '';
    this.fin.append(sheet);
    this.fin.classList.add('show');
  }

  finale() {
    const it = this.item;
    if (!it) return;
    const sheet = h('div', 'sheet');
    sheet.innerHTML = `<div class="tag">Karta obrazu</div><h2>${it.title}</h2><div class="by">${it.author}, ${it.date}</div>
      <div class="card-text" style="margin-top:14px">${(it.card ?? []).map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="facts">${[it.medium, it.dimensions].filter(Boolean).join(' · ')}</div>
      <div class="order"><div class="tag">Zlecenie wykonane</div><p>${it.story?.text ?? ''}</p><span class="client">${it.story?.client ?? ''}</span></div>`;
    const actions = h('div', 'actions');
    const admire = h('button', 'btn ghost', 'Podziwiaj');
    admire.onclick = () => { this.fin.classList.remove('show'); this.toast('Przechyl iPada albo porusz myszą: złoto i werniks łapią światło.', 3600); };
    const hang = h('button', 'btn', 'Powieś w galerii');
    hang.onclick = () => this.act.gallery(it.slug);
    actions.append(hang, admire);
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

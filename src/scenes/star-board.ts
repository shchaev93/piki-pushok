import { CONFIG } from '../config';
import type { Target } from '../engine/input';
import type { Renderer } from '../engine/renderer';
import { scaleDef } from '../sprites/grid';
import { STAR_SPRITES } from '../sprites/items';
import { bitmap } from '../sprites/render';
import { Particles } from './particles';
import type { Game } from './scene';

// Доска звезд за занятия. Звезды ставят только родители (панель взрослых),
// ребенок их видит: маленькая доска на стене домика, по тапу крупно.
// Когда звезд стало больше или меньше, чем ребенок видел в прошлый раз,
// доска сама открывается: новая звезда прилетает с искорками, снятая тихо гаснет.

const BOARD = { x: 3, y: 21, w: 34, h: 26 };
const SMALL_POS = [
  [3, 3],
  [13, 3],
  [23, 3],
  [8, 14],
  [18, 14],
];
const TALK_BIG = scaleDef(STAR_SPRITES.talk, 2);

interface Anim {
  kind: 'gain' | 'loss';
  from: number;
  to: number;
  t: number;
}

export class StarBoard {
  open = false;
  private anim: Anim | null = null;
  private time = 0;
  private autoOpenIn = 0;

  /** Свои искорки: рисуются поверх затемнения открытой доски. */
  private particles = new Particles();

  constructor(
    private g: Game,
    private onJoy: () => void,
  ) {
    const st = g.store.data.stars;
    if (st.count !== st.seen) {
      // изменения с прошлого раза: показываем через полсекунды после входа в домик
      this.anim = { kind: st.count > st.seen ? 'gain' : 'loss', from: st.seen, to: st.count, t: -1 };
      this.autoOpenIn = 600;
    }
  }

  private get count() {
    return this.g.store.data.stars.count;
  }

  /** Цель на доске: открыть крупно. Когда доска открыта, тап в любом месте закрывает. */
  targets(): Target[] {
    if (this.open) {
      return [{ id: 'stars:close', x: -400, y: -400, w: 1000, h: 1000, onTap: () => this.close() }];
    }
    return [{ id: 'stars', x: BOARD.x, y: BOARD.y, w: BOARD.w, h: BOARD.h, onTap: () => this.show() }];
  }

  private show() {
    this.open = true;
    this.g.sfx.play('pop');
  }

  private close() {
    if (this.anim && this.anim.t >= 0 && this.anim.t < this.animMs()) return; // дадим анимации доиграть
    this.open = false;
  }

  private animMs() {
    if (!this.anim) return 0;
    return Math.abs(this.anim.to - this.anim.from) * 450 + 700;
  }

  update(dt: number) {
    this.time += dt;
    this.particles.update(dt);
    if (this.autoOpenIn > 0) {
      this.autoOpenIn -= dt;
      if (this.autoOpenIn <= 0) {
        this.open = true;
        if (this.anim) this.anim.t = 0;
      }
    }
    const a = this.anim;
    if (a && a.t >= 0) {
      const before = a.t;
      a.t += dt;
      if (a.kind === 'gain') {
        // каждая новая звезда прилетает через 450 мс, со звуком и искорками
        for (let i = a.from; i < a.to; i++) {
          const at = (i - a.from) * 450 + 300;
          if (before < at && a.t >= at) {
            const p = this.bigPos(i);
            this.particles.burst(p.x + 9, p.y + 9, 8);
            this.g.sfx.play('catch');
          }
        }
      }
      if (before < this.animMs() && a.t >= this.animMs()) {
        if (a.kind === 'gain') {
          this.onJoy();
          this.g.sfx.play(a.to >= CONFIG.stars.goal ? 'fanfare' : 'joy');
        }
        // ребенок увидел: запоминаем
        this.g.store.update((s) => (s.stars.seen = s.stars.count));
        this.anim = null;
      }
    }
  }

  /** Где крупная звезда номер i на открытой доске. */
  private bigPos(i: number) {
    return { x: 18 + i * 24, y: 40 };
  }

  /** Сколько звезд рисовать и как (с учетом анимации). */
  private starState(i: number): { full: boolean; scale: number; alpha: number } {
    const a = this.anim;
    if (!a || a.t < 0) return { full: i < (a ? a.from : this.count), scale: 1, alpha: 1 };
    if (a.kind === 'gain') {
      if (i < a.from) return { full: true, scale: 1, alpha: 1 };
      if (i >= a.to) return { full: false, scale: 1, alpha: 1 };
      const at = (i - a.from) * 450 + 300;
      if (a.t < at) return { full: false, scale: 1, alpha: 1 };
      const k = Math.min(1, (a.t - at) / 250);
      return { full: true, scale: 1 + (1 - k) * 0.6, alpha: 1 };
    }
    // потеря: снятые звезды мягко гаснут
    if (i < a.to) return { full: true, scale: 1, alpha: 1 };
    if (i >= a.from) return { full: false, scale: 1, alpha: 1 };
    return { full: true, scale: 1, alpha: Math.max(0, 1 - a.t / 900) };
  }

  /** Доска на стене. */
  drawBoard(r: Renderer) {
    const b = BOARD;
    const done = this.count >= CONFIG.stars.goal;
    const frame = done && Math.floor(this.time / 400) % 2 ? '#F5C542' : '#B9825A';
    r.rect(b.x, b.y, b.w, b.h, '#5A4650');
    r.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, frame);
    r.rect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, '#FFF8EC');
    for (let i = 0; i < CONFIG.stars.goal && i < SMALL_POS.length; i++) {
      const [sx, sy] = SMALL_POS[i];
      const st = this.anim && this.anim.t >= 0 ? this.starState(i) : { full: i < this.shownCount(), scale: 1, alpha: 1 };
      const def = st.full ? STAR_SPRITES.small : STAR_SPRITES.smallEmpty;
      r.sprite(st.full ? 'star.small' : 'star.smallEmpty', def, b.x + sx, b.y + sy);
    }
  }

  /** До показа анимации на маленькой доске видно старое число звезд. */
  private shownCount() {
    return this.anim ? this.anim.from : this.count;
  }

  /** Крупная доска поверх домика. */
  drawOverlay(r: Renderer) {
    if (!this.open) return;
    const v = r.layout.view;
    const c = r.ctx;
    c.save();
    c.fillStyle = 'rgba(60,40,70,0.55)';
    c.fillRect(Math.floor(v.x0) - 1, Math.floor(v.y0) - 1, Math.ceil(v.x1 - v.x0) + 2, Math.ceil(v.y1 - v.y0) + 2);
    c.restore();
    r.rect(10, 28, 172, 44, '#5A4650');
    r.rect(11, 29, 170, 42, '#B9825A');
    r.rect(12, 30, 168, 40, '#FFF8EC');
    const goal = CONFIG.stars.goal;
    for (let i = 0; i < goal; i++) {
      const p = this.bigPos(i);
      const st = this.starState(i);
      const full = st.full;
      const sc = 2 * st.scale;
      const size = 9 * sc;
      c.save();
      c.globalAlpha = st.alpha;
      const img = full ? bitmap('star.big', STAR_SPRITES.big) : bitmap('star.bigEmpty', STAR_SPRITES.bigEmpty);
      // крупная звезда: масштаб 2, при появлении чуть больше
      c.drawImage(
        img.canvas,
        Math.round(p.x + 9 - size / 2),
        Math.round(p.y + 9 - size / 2),
        Math.round(size),
        Math.round(size),
      );
      c.restore();
    }
    // цель: разговор с Пушком
    const done = this.count >= goal && !(this.anim && this.anim.t >= 0 && this.anim.t < this.animMs());
    const bob = done ? Math.round(Math.sin(this.time / 200) * 1.5) : 0;
    r.rect(137, 48, 4, 1, '#B9825A');
    r.sprite('star.talk2', TALK_BIG, 145, 37 + bob);
    if (done && Math.floor(this.time / 250) % 2) this.particles.spawn('sparkle', 150 + Math.random() * 20, 38, 0, -8, 400);
    this.particles.draw(r);
  }
}

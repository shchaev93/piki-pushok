import { CONFIG, type FoodId } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { feed, isFull, moodOf, satietyNow, takeFood } from '../game/rules';
import { dress } from '../pushok/dress';
import { Pushok, type Script } from '../pushok/actor';
import type { SpriteDef } from '../sprites/grid';
import { ICONS } from '../sprites/icons';
import { DISH_SPRITES, FOOD_SPRITES, ITEM_ICONS } from '../sprites/items';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { FOODS } from './shop';
import { BTN, drawButton, drawHomeButton, drawSatiety, drawSlot, homeButton } from './ui';

// Кормление за столиком: еду из корзинки перетаскивают пальцем ко рту Пушка.
// Семечки (любимые) вызывают самую радостную реакцию. Если Пушок сыт,
// он вежливо отказывается, и еда возвращается в корзинку.

const S = 3; // масштаб Пушка крупным планом
const TABLE_Y = 64;
const TRAY_Y = 80;

interface Slot {
  kind: 'food' | 'dish';
  id: string;
  /** для блюд: индекс первого такого блюда в save.dishes */
  count: number;
  def: SpriteDef;
  key: string;
}

export class FeedScene implements Scene {
  readonly id = 'feed' as const;
  private pushok = new Pushok();
  private particles = new Particles();
  private drag: { id: number; slot: Slot; x: number; y: number } | null = null;
  private eatLeft = 0;
  private refuse = 0;
  private time = 0;
  /** Для e2e-тестов: сколько раз Пушок вежливо отказался. */
  refusals = 0;

  constructor(private g: Game) {
    const s = g.store.data;
    dress(this.pushok, s, false); // за едой гитару откладывает
    this.pushok.x = 96;
    this.pushok.y = TABLE_Y + 6;
  }

  private slots(): Slot[] {
    const s = this.g.store.data;
    const out: Slot[] = [];
    for (const f of FOODS) {
      const n = s.basket[f] ?? 0;
      if (n > 0) out.push({ kind: 'food', id: f, count: n, def: FOOD_SPRITES[f], key: `food.${f}` });
    }
    const dishes = new Map<string, number>();
    for (const d of s.dishes) dishes.set(d.dish, (dishes.get(d.dish) ?? 0) + 1);
    for (const [id, n] of dishes) out.push({ kind: 'dish', id, count: n, def: DISH_SPRITES[id] ?? DISH_SPRITES.soup, key: `dish.${id}` });
    return out;
  }

  private slotRect(i: number, n: number) {
    // справа место под кнопку магазина: слоты ужимаются, если их много
    const gap = 3;
    const w = Math.min(24, Math.floor(150 / n) - gap);
    const total = n * w + (n - 1) * gap;
    return { x: Math.round(86 - total / 2 + i * (w + gap)), y: TRAY_Y + 2, w, h: 22 };
  }

  /** Куда тянуть еду: рот Пушка (строка 9, колонка 8 сетки). */
  private mouth() {
    const p = this.pushok;
    return { x: p.x + 0.5 * S, y: p.y + p.lift * S - (16 - 9.5) * S };
  }

  private shopButton(safe: Rect) {
    return { x: Math.floor(Math.min(safe.x1, 222)) - 3 - BTN, y: TRAY_Y + 2 };
  }

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    const sb = this.slots().length ? this.shopButton(safe) : { x: 96 - BTN / 2, y: TRAY_Y + 2 };
    list.push({ id: 'btn:shop', x: sb.x, y: sb.y, w: BTN, h: BTN, onTap: () => this.g.go('shop') });
    return list;
  }

  pointerDown(x: number, y: number, id: number) {
    if (this.drag || this.eatLeft > 0) return false;
    const slots = this.slots();
    const min = this.g.minTarget();
    let best: Slot | null = null;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      const r = this.slotRect(i, slots.length);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const half = Math.max(r.w, min) / 2;
      const halfH = Math.max(r.h, min) / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(x - cx) <= half && Math.abs(y - cy) <= halfH && d < bestD) {
        bestD = d;
        best = s;
      }
    });
    if (!best) return false;
    this.drag = { id, slot: best, x, y };
    this.g.sfx.play('pop');
    return true;
  }

  pointerMove(x: number, y: number, id: number) {
    if (!this.drag || this.drag.id !== id) return;
    this.drag.x = x;
    this.drag.y = y;
    const m = this.mouth();
    // еда «взлетает» над пальцем, чтобы палец ее не закрывал
    if (Math.hypot(x - m.x, y - 8 - m.y) < 14) this.give(this.drag.slot);
  }

  pointerUp(_x: number, _y: number, id: number) {
    if (this.drag?.id === id) this.drag = null; // не донесли: еда остается в корзинке
  }

  private give(slot: Slot) {
    this.drag = null;
    const now = this.g.now();
    if (isFull(satietyNow(this.g.store.data.satiety, now))) {
      // сыт: вежливо качает головой, еда остается в корзинке
      this.refuse = 900;
      this.refusals++;
      this.g.sfx.play('nope');
      this.particles.spawn('heart', this.pushok.x + 20, this.pushok.y - 44, 0, -10, 900);
      return;
    }
    let favorite = false;
    this.g.store.update((s) => {
      if (slot.kind === 'food') {
        const f = slot.id as FoodId;
        if (!takeFood(s, f)) return;
        feed(s, CONFIG.food[f].satiety, now);
        favorite = CONFIG.food[f].favorite;
      } else {
        const i = s.dishes.findIndex((d) => d.dish === slot.id);
        if (i < 0) return;
        const [d] = s.dishes.splice(i, 1);
        feed(s, d.satiety, now);
        favorite = true; // блюда тоже очень радуют
      }
    });
    this.eatLeft = 1300;
    this.g.sfx.play('chew');
    const m = this.mouth();
    for (let i = 0; i < 4; i++) this.particles.spawn('crumb', m.x - 4 + Math.random() * 8, m.y + 2, (Math.random() - 0.5) * 16, 14, 600);
    if (favorite) {
      for (let i = 0; i < 3; i++) this.particles.spawn('heart', m.x - 18 + i * 14, m.y - 30, (i - 1) * 6, -16, 1100);
      this.pushok.run(null, this.celebrate());
    }
  }

  private *celebrate(): Script {
    let t = 0;
    while (t < 1300) t += yield;
    this.g.sfx.play('joy');
    yield* this.pushok.joy(2, 4);
  }

  update(dt: number) {
    this.time += dt;
    this.pushok.update(dt);
    this.particles.update(dt);
    const p = this.pushok;
    const mood = moodOf(satietyNow(this.g.store.data.satiety, this.g.now()));
    p.idleFrame = mood === 'veryHungry' ? 'sad' : 'base';
    if (this.eatLeft > 0) {
      this.eatLeft -= dt;
      p.frame = Math.floor(this.eatLeft / 160) % 2 ? 'eatOpen' : 'eatMunch';
      if (Math.floor(this.eatLeft / 320) !== Math.floor((this.eatLeft + dt) / 320)) this.g.sfx.play('chew');
      if (this.eatLeft <= 0) p.frame = 'base';
    } else if (this.refuse > 0) {
      this.refuse -= dt;
      p.frame = 'happy1';
      p.x = 96 + Math.round(Math.sin(this.refuse / 60)) * 1;
      if (this.refuse <= 0) {
        p.frame = 'base';
        p.x = 96;
      }
    } else if (this.drag && !p.busy) {
      const m = this.mouth();
      p.frame = Math.hypot(this.drag.x - m.x, this.drag.y - m.y) < 45 ? 'eatOpen' : 'base';
    }
  }

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    r.rect(x0, y0, w, yEnd - y0, '#FFF4E2');
    for (let y = 6; y < TABLE_Y; y += 10) {
      for (let x = Math.floor(x0 / 12) * 12 + (y % 20 ? 6 : 0); x < x0 + w; x += 12) r.rect(x, y, 1, 1, '#F6DFC3');
    }
    r.rect(x0, TRAY_Y - 4, w, yEnd - TRAY_Y + 4, '#F3D6AE');
    r.rect(x0, TRAY_Y - 4, w, 1, '#5A4650');

    // Пушок за столиком, крупно
    const p = this.pushok;
    const saved = { x: p.x, y: p.y, lift: p.lift };
    p.lift = saved.lift * S;
    r.pushok(p, S);
    p.lift = saved.lift;
    const mood = moodOf(satietyNow(this.g.store.data.satiety, this.g.now()));
    if (mood !== 'full' && this.eatLeft <= 0) {
      const bob = Math.round(Math.sin(this.time / 400));
      r.sprite('item.thought', ITEM_ICONS.thought, p.x + 22, p.y - 64 + bob, 2);
    }

    // столик со скатертью
    r.rect(24, TABLE_Y, 144, 9, '#5A4650');
    r.rect(25, TABLE_Y + 1, 142, 7, '#F7A9C0');
    for (let x = 27; x < 166; x += 4) r.rect(x, TABLE_Y + 3, 2, 2, '#FFFFFF');
    r.rect(32, TABLE_Y + 9, 4, 3, '#5A4650');
    r.rect(156, TABLE_Y + 9, 4, 3, '#5A4650');

    // корзинка с едой
    const slots = this.slots();
    slots.forEach((s, i) => {
      const rc = this.slotRect(i, slots.length);
      drawSlot(r, rc.x, rc.y, rc.w, rc.h);
      const dragging = this.drag?.slot.key === s.key ? 1 : 0;
      const sw = s.def.rows[0].length;
      const sh = s.def.rows.length;
      if (s.count - dragging > 0) r.sprite(s.key, s.def, rc.x + Math.floor((rc.w - sw) / 2), rc.y + Math.floor((rc.h - 3 - sh) / 2));
      // сколько штук: точки под иконкой
      for (let k = 0; k < Math.min(5, s.count - dragging); k++) r.rect(rc.x + rc.w / 2 - 5 + k * 2.5, rc.y + rc.h - 3, 1, 1, '#E8457A');
    });
    if (!slots.length) {
      // корзинка пуста: кнопка магазина посередине прыгает
      drawButton(r, { x: 96 - BTN / 2, y: TRAY_Y + 2 }, 'icon.basket', ICONS.basket, 0, true);
    } else {
      drawButton(r, this.shopButton(safe), 'icon.basket', ICONS.basket);
    }

    this.particles.draw(r);

    if (this.drag) {
      const d = this.drag.slot.def;
      r.sprite(this.drag.slot.key, d, this.drag.x - d.rows[0].length, this.drag.y - 8 - d.rows.length, 2);
    }

    drawSatiety(r, Math.floor(Math.min(safe.x1, 222)) - 3 - 26, Math.ceil(safe.y0) + 3, satietyNow(this.g.store.data.satiety, this.g.now()), 2);
    drawHomeButton(r, safe);
  }
}


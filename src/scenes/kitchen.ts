import { CONFIG, type FoodId } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { cook, takeFood } from '../game/rules';
import { dress } from '../pushok/dress';
import { Pushok } from '../pushok/actor';
import type { Dish } from '../save/schema';
import { ICONS } from '../sprites/icons';
import { DISH_SPRITES, FOOD_SPRITES, ITEM_ICONS } from '../sprites/items';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { FOODS } from './shop';
import { BTN, drawButton, drawHintRing, drawHomeButton, drawSlot, homeButton } from './ui';

// Кухня: 2-3 продукта перетащить в кастрюльку и помешать пальцем по кругу.
// Ошибочных рецептов нет: особые сочетания дают особые блюда, остальное = суп-сюрприз.
// Продукты списываются из корзинки только когда блюдо готово.

const K = CONFIG.kitchen;
const POT = { x: 72, y: 36 };
const MOUTH = { x: 96, y: 38 }; // центр открытой кастрюльки
const TRAY_Y = 82;

export class KitchenScene implements Scene {
  readonly id = 'kitchen' as const;
  private pushok = new Pushok();
  private particles = new Particles();
  /** Что лежит в кастрюльке (публично для e2e-тестов). */
  inPot: FoodId[] = [];
  private drag: { id: number; food: FoodId; x: number; y: number } | null = null;
  private stir: { id: number; last: number; acc: number; moved: number; x: number; y: number; downOn: number } | null = null;
  /** 0..1: насколько домешали */
  private progress = 0;
  private done: { dish: Dish; t: number } | null = null;
  private time = 0;

  constructor(private g: Game) {
    const s = g.store.data;
    dress(this.pushok, s, false);
    this.pushok.x = 160;
    this.pushok.y = 64;
  }

  /** Сколько каждого продукта осталось в корзинке (минус лежащее в кастрюльке). */
  private available(): { food: FoodId; n: number }[] {
    const b = this.g.store.data.basket;
    return FOODS.map((f) => ({ food: f, n: (b[f] ?? 0) - this.inPot.filter((x) => x === f).length })).filter(
      (x) => (b[x.food] ?? 0) > 0,
    );
  }

  private slotRect(i: number, n: number) {
    const gap = 3;
    const w = Math.min(24, Math.floor(150 / n) - gap);
    const total = n * w + (n - 1) * gap;
    return { x: Math.round(86 - total / 2 + i * (w + gap)), y: TRAY_Y + 2, w, h: 22 };
  }

  /** Для e2e-тестов: центр ячейки продукта в корзинке. */
  slotCenter(food: FoodId) {
    const a = this.available();
    const i = a.findIndex((x) => x.food === food);
    if (i < 0) return null;
    const r = this.slotRect(i, a.length);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  get dishesMade() {
    return this.done ? 1 : 0;
  }

  private tableButton(safe: Rect) {
    return { x: Math.floor(Math.min(safe.x1, 222)) - 3 - BTN, y: Math.ceil(safe.y0) + 3 };
  }
  private shopButton(safe: Rect) {
    return { x: Math.floor(Math.min(safe.x1, 222)) - 3 - BTN, y: TRAY_Y + 2 };
  }

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    const t = this.tableButton(safe);
    list.push({ id: 'btn:table', x: t.x, y: t.y, w: BTN, h: BTN, onTap: () => this.g.go('feed') });
    const sb = this.shopButton(safe);
    list.push({ id: 'btn:shop', x: sb.x, y: sb.y, w: BTN, h: BTN, onTap: () => this.g.go('shop') });
    return list;
  }

  private inPotZone(x: number, y: number) {
    return x > POT.x - 2 && x < POT.x + 50 && y > 14 && y < POT.y + 16;
  }

  /** Положение продукта номер i в кастрюльке (покачивается на «волнах»). */
  private potItemPos(i: number) {
    const n = this.inPot.length;
    const x = MOUTH.x - ((n - 1) * 15) / 2 + i * 15 - 6;
    const swirl = this.progress * Math.PI * 4;
    return {
      x: x + Math.round(Math.sin(swirl + i * 2) * 2 * Math.min(1, this.progress * 3)),
      y: MOUTH.y - 14 + Math.round(Math.sin(this.time / 300 + i) * 1),
    };
  }

  pointerDown(x: number, y: number, id: number) {
    if (this.drag || this.stir || this.done) return false;
    // продукт из корзинки
    const a = this.available();
    const min = this.g.minTarget();
    let best: FoodId | null = null;
    let bestD = Infinity;
    a.forEach((s, i) => {
      if (s.n <= 0) return;
      const r = this.slotRect(i, a.length);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(x - cx) <= Math.max(r.w, min) / 2 && Math.abs(y - cy) <= Math.max(r.h, min) / 2 && d < bestD) {
        bestD = d;
        best = s.food;
      }
    });
    if (best) {
      this.drag = { id, food: best, x, y };
      this.g.sfx.play('pop');
      return true;
    }
    // кастрюлька: мешать или вынуть продукт
    if (this.inPotZone(x, y) && this.inPot.length) {
      let downOn = -1;
      this.inPot.forEach((_, i) => {
        const p = this.potItemPos(i);
        if (Math.abs(x - (p.x + 6)) < 9 && Math.abs(y - (p.y + 6)) < 9) downOn = i;
      });
      this.stir = { id, last: Math.atan2(y - MOUTH.y, x - MOUTH.x), acc: 0, moved: 0, x, y, downOn };
      return true;
    }
    return false;
  }

  pointerMove(x: number, y: number, id: number) {
    if (this.drag?.id === id) {
      this.drag.x = x;
      this.drag.y = y;
      return;
    }
    const s = this.stir;
    if (!s || s.id !== id) return;
    s.moved += Math.hypot(x - s.x, y - s.y);
    s.x = x;
    s.y = y;
    if (this.inPot.length < K.minIngredients) return;
    if (Math.hypot(x - MOUTH.x, y - MOUTH.y) < 3) return; // в самом центре угол скачет
    const a = Math.atan2(y - MOUTH.y, x - MOUTH.x);
    let d = a - s.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    s.last = a;
    // любое направление и даже «туда-сюда» засчитывается
    const before = Math.floor(this.progress * K.stirTurns * 4);
    this.progress = Math.min(1, this.progress + Math.abs(d) / (Math.PI * 2 * K.stirTurns));
    if (Math.floor(this.progress * K.stirTurns * 4) !== before) {
      this.g.sfx.play('stir');
      this.particles.spawn('bubble', MOUTH.x - 10 + Math.random() * 20, MOUTH.y - 4, 0, -10, 700);
    }
    if (this.progress >= 1) this.finish();
  }

  pointerUp(x: number, y: number, id: number) {
    if (this.drag?.id === id) {
      const food = this.drag.food;
      this.drag = null;
      if (this.inPotZone(x, y - 8) && this.inPot.length < K.maxIngredients) {
        this.inPot.push(food);
        this.progress = 0;
        this.g.sfx.play('splash');
        this.particles.burst(MOUTH.x, MOUTH.y - 6, 4, 'bubble');
      } else if (this.inPot.length >= K.maxIngredients) {
        this.g.sfx.play('nope');
      }
      return;
    }
    const s = this.stir;
    if (s?.id === id) {
      this.stir = null;
      // короткий тап по продукту в кастрюльке = вынуть его обратно
      if (s.moved < 4 && s.downOn >= 0 && this.progress < 0.15) {
        this.inPot.splice(s.downOn, 1);
        this.progress = 0;
        this.g.sfx.play('pop');
      }
    }
  }

  private finish() {
    const dish = cook(this.inPot);
    const ingredients = [...this.inPot];
    this.g.store.update((s) => {
      for (const f of ingredients) takeFood(s, f);
      s.dishes.push(dish);
    });
    this.inPot = [];
    this.stir = null;
    this.progress = 0;
    this.done = { dish, t: 0 };
    this.g.sfx.play(dish.dish === 'soup' ? 'joy' : 'fanfare');
    this.particles.burst(MOUTH.x, MOUTH.y - 18, 10);
    this.pushok.run(null, this.pushok.joy(3, 4));
  }

  update(dt: number) {
    this.time += dt;
    this.pushok.update(dt);
    this.particles.update(dt);
    if (this.done) {
      this.done.t += dt;
      if (this.done.t > 2600) this.done = null; // блюдо улетело в корзинку
    }
    if (this.progress > 0 && Math.random() < dt / 400) {
      this.particles.spawn('steam', MOUTH.x - 8 + Math.random() * 16, MOUTH.y - 10, 0, -8, 900);
    }
  }

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    // кафельная стена, плита, пол
    r.rect(x0, y0, w, yEnd - y0, '#DDF0F7');
    for (let y = Math.floor(y0 / 9) * 9; y < 64; y += 9) r.rect(x0, y, w, 1, '#C6E3EF');
    for (let x = Math.floor(x0 / 9) * 9; x < x0 + w; x += 9) r.rect(x, y0, 1, 64 - y0, '#C6E3EF');
    r.rect(x0, 64, w, 3, '#5A4650');
    r.rect(x0, 65, w, 1, '#CBD2DE');
    r.rect(x0, 67, w, 13, '#E7B985');
    for (let x = Math.floor(x0 / 24) * 24; x < x0 + w; x += 24) r.rect(x, 67, 1, 13, '#B9825A');
    r.rect(x0, 80, w, yEnd - 80, '#F3D6AE');
    r.rect(x0, 80, w, 1, '#5A4650');

    // содержимое кастрюльки: вода → суп по мере помешивания
    const water = this.inPot.length ? mixColor('#BFE6FA', '#F9C37A', this.progress) : '#5A4650';
    for (let dy = -3; dy <= 3; dy++) {
      const half = Math.round(21 * Math.sqrt(1 - (dy / 4) ** 2));
      r.rect(MOUTH.x - half, MOUTH.y + dy, half * 2, 1, water);
    }
    this.inPot.forEach((f, i) => {
      const p = this.potItemPos(i);
      r.sprite(`food.${f}`, FOOD_SPRITES[f], p.x, p.y);
    });
    r.sprite('item.pot', ITEM_ICONS.pot, POT.x, POT.y);

    // подсказка: можно мешать
    if (this.inPot.length >= K.minIngredients && !this.done) {
      drawHintRing(r, MOUTH.x, MOUTH.y - 2, 26, this.time);
      if (!this.stir) {
        const a = this.time / 400;
        r.sprite('item.spoon', ITEM_ICONS.spoon, MOUTH.x + Math.cos(a) * 12 - 2, MOUTH.y - 14 + Math.sin(a) * 3);
      }
    }
    if (this.stir && this.inPot.length >= K.minIngredients) {
      r.sprite('item.spoon', ITEM_ICONS.spoon, this.stir.x - 2, this.stir.y - 12);
    }

    r.pushok(this.pushok, 2);

    // готовое блюдо поднимается над кастрюлькой
    if (this.done) {
      const d = DISH_SPRITES[this.done.dish.dish] ?? DISH_SPRITES.soup;
      const t = Math.min(1, this.done.t / 500);
      const y = MOUTH.y - 12 - t * 14 + Math.sin(this.done.t / 200) * 1;
      r.sprite(`dish.${this.done.dish.dish}`, d, MOUTH.x - 16, y - 11, 2);
    }

    // корзинка: только сырые продукты
    const a = this.available();
    a.forEach((s, i) => {
      const rc = this.slotRect(i, a.length);
      drawSlot(r, rc.x, rc.y, rc.w, rc.h, s.n > 0 ? '#FFFFFF' : '#EEE7EA');
      const dragging = this.drag?.food === s.food ? 1 : 0;
      const def = FOOD_SPRITES[s.food];
      if (s.n - dragging > 0) {
        r.sprite(`food.${s.food}`, def, rc.x + Math.floor((rc.w - def.rows[0].length) / 2), rc.y + Math.floor((rc.h - 3 - def.rows.length) / 2));
      }
      for (let k = 0; k < Math.min(5, s.n - dragging); k++) r.rect(rc.x + rc.w / 2 - 5 + k * 2.5, rc.y + rc.h - 3, 1, 1, '#E8457A');
    });
    drawButton(r, this.shopButton(safe), 'icon.basket', ICONS.basket, 0, a.every((x) => x.n <= 0) && !this.inPot.length);
    drawButton(r, this.tableButton(safe), 'item.miniTable', ITEM_ICONS.miniTable, 0, this.g.store.data.dishes.length > 0);

    this.particles.draw(r);
    if (this.drag) {
      const d = FOOD_SPRITES[this.drag.food];
      r.sprite(`food.${this.drag.food}`, d, this.drag.x - d.rows[0].length, this.drag.y - 8 - d.rows.length, 2);
    }
    drawHomeButton(r, safe);
  }
}

function mixColor(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

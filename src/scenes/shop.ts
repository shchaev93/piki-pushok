import { CONFIG, type FoodId } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { buy, canBuy } from '../game/rules';
import { Pushok } from '../pushok/actor';
import { isHatId } from '../sprites/hats';
import { DISH_SPRITES, FOOD_SPRITES, ITEM_ICONS } from '../sprites/items';
import type { SpriteDef } from '../sprites/grid';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { BTN, drawCoins, drawHomeButton, homeButton } from './ui';

// Магазин еды: полка с продуктами, цена = кружочки-денежки под продуктом.
// Купленное летит в корзинку. Не хватает денежек: продукт покачивается,
// а Пушок «думает» об облачке (подсказка, где их заработать). Без штрафов.

export const FOODS = Object.keys(CONFIG.food) as FoodId[];
const SHELF_Y = 50;
const BASKET = { x: 22, y: 74, w: 136, h: 30 };

interface Flying {
  def: SpriteDef;
  key: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
}

/** Содержимое корзинки как список иконок (продукты, потом блюда). */
export function basketIcons(save: { basket: Partial<Record<FoodId, number>>; dishes: { dish: string }[] }) {
  const out: { key: string; def: SpriteDef }[] = [];
  for (const f of FOODS) for (let i = 0; i < (save.basket[f] ?? 0); i++) out.push({ key: `food.${f}`, def: FOOD_SPRITES[f] });
  for (const d of save.dishes) out.push({ key: `dish.${d.dish}`, def: DISH_SPRITES[d.dish] ?? DISH_SPRITES.soup });
  return out;
}

export class ShopScene implements Scene {
  readonly id = 'shop' as const;
  private pushok = new Pushok();
  private particles = new Particles();
  private wiggle: Partial<Record<FoodId, number>> = {};
  private flying: Flying[] = [];
  private thinkCloud = 0;

  constructor(private g: Game) {
    const s = g.store.data;
    this.pushok.hat = isHatId(s.equipped.hat) ? s.equipped.hat : null;
    this.pushok.guitar = s.equipped.guitar;
    this.pushok.x = 176;
    this.pushok.y = 104;
  }

  private itemPos(i: number) {
    const def = FOOD_SPRITES[FOODS[i]];
    const w = def.rows[0].length * 2;
    const h = def.rows.length * 2;
    const cx = 22 + i * 37;
    return { x: cx - w / 2, y: SHELF_Y - h, w, h, cx };
  }

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    FOODS.forEach((f, i) => {
      const p = this.itemPos(i);
      // цель = продукт и его цена под полкой
      list.push({ id: `food:${f}`, x: p.cx - 16, y: p.y - 2, w: 32, h: SHELF_Y + 12 - p.y, onTap: () => this.tap(f, i) });
    });
    return list;
  }

  private tap(f: FoodId, i: number) {
    const save = this.g.store.data;
    if (!canBuy(save, f)) {
      this.g.sfx.play('nope');
      this.wiggle[f] = 500;
      this.thinkCloud = 1800;
      return;
    }
    this.g.store.update((s) => buy(s, f));
    this.g.sfx.play('coin');
    const p = this.itemPos(i);
    const n = Math.max(0, basketIcons(this.g.store.data).length - 1);
    const slot = this.basketSlot(n);
    this.flying.push({ def: FOOD_SPRITES[f], key: `food.${f}`, sx: p.x, sy: p.y, tx: slot.x, ty: slot.y, t: 0 });
    this.particles.burst(p.cx, p.y + p.h / 2, 5);
    if (CONFIG.food[f].favorite) {
      this.particles.spawn('heart', this.pushok.x - 4, this.pushok.y - 20, 0, -14, 900);
    }
    this.pushok.run(null, this.pushok.joy(1, 4));
  }

  private basketSlot(i: number) {
    const perRow = 10;
    return { x: BASKET.x + 6 + (i % perRow) * 13, y: BASKET.y + 3 + Math.floor(i / perRow) * 13 };
  }

  update(dt: number) {
    this.pushok.update(dt);
    this.particles.update(dt);
    for (const k of Object.keys(this.wiggle) as FoodId[]) {
      this.wiggle[k]! -= dt;
      if (this.wiggle[k]! <= 0) delete this.wiggle[k];
    }
    for (const f of this.flying) f.t = Math.min(1, f.t + dt / 500);
    this.flying = this.flying.filter((f) => f.t < 1);
    if (this.thinkCloud > 0) this.thinkCloud -= dt;
  }

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    // стена лавки и полосатый навес
    r.rect(x0, y0, w, yEnd - y0, '#E6F4DC');
    for (let x = Math.floor(x0 / 16) * 16; x < x0 + w; x += 16) {
      r.rect(x, y0, 8, 14 - y0, '#F7A9C0');
      r.rect(x + 8, y0, 8, 14 - y0, '#FFFFFF');
    }
    for (let x = Math.floor(x0 / 8) * 8; x < x0 + w; x += 8) r.rect(x + 1, 14, 6, 2, '#F7A9C0');
    r.rect(x0, 14, w, 1, '#5A4650');
    // пол
    r.rect(x0, 66, w, yEnd - 66, '#F3D6AE');
    r.rect(x0, 66, w, 1, '#5A4650');
    // полка
    r.rect(4, SHELF_Y, 184, 4, '#5A4650');
    r.rect(5, SHELF_Y + 1, 182, 2, '#E7B985');
    r.rect(10, SHELF_Y + 4, 3, 10, '#B9825A');
    r.rect(179, SHELF_Y + 4, 3, 10, '#B9825A');

    const coins = this.g.store.data.coins;
    FOODS.forEach((f, i) => {
      const p = this.itemPos(i);
      const wl = this.wiggle[f] ?? 0;
      const dx = wl > 0 ? Math.round(Math.sin(wl / 35) * 2) : 0;
      r.sprite(`food.${f}`, FOOD_SPRITES[f], p.x + dx, p.y, 2);
      // цена кружочками; если хватает, они яркие
      const price = CONFIG.food[f].price;
      const px = p.cx - (price * 5) / 2;
      drawCoins(r, px, SHELF_Y + 6, price);
      if (coins < price) r.rect(px - 1, SHELF_Y + 5, price * 5 + 1, 7, 'rgba(230,244,220,0.55)');
    });

    // корзинка
    const b = BASKET;
    r.rect(b.x, b.y, b.w, b.h, '#5A4650');
    r.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, '#E7B985');
    for (let y = b.y + 4; y < b.y + b.h - 1; y += 4) r.rect(b.x + 1, y, b.w - 2, 1, '#D29F6B');
    for (let x = b.x + 5; x < b.x + b.w - 1; x += 6) r.rect(x, b.y + 1, 1, b.h - 2, '#D29F6B');
    const icons = basketIcons(this.g.store.data);
    const flyingN = this.flying.length;
    icons.slice(0, Math.max(0, Math.min(20, icons.length - flyingN))).forEach((ic, i) => {
      const s = this.basketSlot(i);
      r.sprite(ic.key, ic.def, s.x, s.y);
    });
    for (const f of this.flying) {
      const e = 1 - (1 - f.t) * (1 - f.t);
      const x = f.sx + (f.tx - f.sx) * e;
      const y = f.sy + (f.ty - f.sy) * e - Math.sin(Math.PI * f.t) * 14;
      r.sprite(f.key, f.def, x, y);
    }

    r.pushok(this.pushok);
    if (this.thinkCloud > 0) {
      r.sprite('item.thoughtCloud', ITEM_ICONS.thoughtCloud, this.pushok.x - 14, this.pushok.y - 32);
    }
    this.particles.draw(r);

    // кошелек: все денежки рядами
    drawCoins(r, Math.min(safe.x1, 192 + 30) - 56, Math.max(19, Math.ceil(safe.y0) + 19), coins, 10, 40);
    drawHomeButton(r, safe);
  }
}

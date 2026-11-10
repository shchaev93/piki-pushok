import { CONFIG, type FoodId } from '../config';
import type { Dish, Save } from '../save/schema';

// Правила игры без DOM: голод, денежки, открытия, кухня. Все числа из CONFIG.

const H = CONFIG.hunger;
const HOUR = 3_600_000;

/** Сколько сытости теряется за час. От полной до «просит кушать» = hoursFullToHungry. */
export const satietyLossPerHour = (H.max - H.hungryBelow) / H.hoursFullToHungry;

/** Сытость в момент now: падает в реальном времени, даже пока игра закрыта, но не ниже floor. */
export function satietyNow(s: { value: number; at: number }, now: number): number {
  const hours = Math.max(0, now - s.at) / HOUR;
  if (s.value <= H.floor) return s.value;
  return Math.max(H.floor, s.value - satietyLossPerHour * hours);
}

export type Mood = 'full' | 'hungry' | 'veryHungry';

export function moodOf(satiety: number): Mood {
  if (satiety < H.veryHungryBelow) return 'veryHungry';
  if (satiety < H.hungryBelow) return 'hungry';
  return 'full';
}

/** Сыт настолько, что вежливо отказывается (еда возвращается в корзинку). */
export const isFull = (satiety: number) => satiety >= H.max - 2;

/** Покормить: фиксируем текущую сытость и прибавляем. */
export function feed(save: Save, amount: number, now: number) {
  const v = Math.min(H.max, satietyNow(save.satiety, now) + amount);
  save.satiety = { value: v, at: now };
}

// ---------- денежки и открытия ----------

export function canBuy(save: Save, food: FoodId) {
  return save.coins >= CONFIG.food[food].price;
}

export function buy(save: Save, food: FoodId): boolean {
  if (!canBuy(save, food)) return false;
  save.coins -= CONFIG.food[food].price;
  save.basket[food] = (save.basket[food] ?? 0) + 1;
  return true;
}

export function takeFood(save: Save, food: FoodId): boolean {
  const n = save.basket[food] ?? 0;
  if (n < 1) return false;
  if (n === 1) delete save.basket[food];
  else save.basket[food] = n - 1;
  return true;
}

export interface Unlock {
  kind: 'hat' | 'guitar';
  id: string;
}

/** Добавляет в save все вещи, открытые к текущему числу бабочек. Возвращает новые. */
export function applyUnlocks(save: Save): Unlock[] {
  const fresh: Unlock[] = [];
  for (const h of CONFIG.hats) {
    if (save.butterfliesTotal >= h.unlockAt && !save.unlocked.hats.includes(h.id)) {
      save.unlocked.hats.push(h.id);
      fresh.push({ kind: 'hat', id: h.id });
    }
  }
  for (const g of CONFIG.guitars) {
    if (save.butterfliesTotal >= g.unlockAt && !save.unlocked.guitars.includes(g.id)) {
      save.unlocked.guitars.push(g.id);
      fresh.push({ kind: 'guitar', id: g.id });
    }
  }
  return fresh;
}

/** Поймана бабочка: денежка, общий счетчик, открытия. */
export function catchButterfly(save: Save): Unlock[] {
  save.coins += CONFIG.cloud.coinsPerButterfly;
  save.butterfliesTotal += 1;
  return applyUnlocks(save);
}

export const unseenUnlocks = (save: Save) => [
  ...save.unlocked.hats.filter((id) => !save.seen.includes(`hat:${id}`)),
  ...save.unlocked.guitars.filter((id) => !save.seen.includes(`guitar:${id}`)),
];

// ---------- кухня ----------

/** Блюдо из 2-3 продуктов. Ошибочных рецептов нет: без особого рецепта = суп-сюрприз. */
export function cook(ingredients: readonly FoodId[]): Dish {
  const K = CONFIG.kitchen;
  const key = [...ingredients].sort().join('+');
  const special = K.recipes.find((r) => [...r.ingredients].sort().join('+') === key);
  const sum = ingredients.reduce((s, f) => s + CONFIG.food[f].satiety, 0);
  return {
    dish: special?.dish ?? 'soup',
    satiety: Math.max(K.dishMin, Math.round(sum * K.dishMultiplier)),
  };
}

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

export type WearKind = 'hat' | 'sweater' | 'guitar';

export interface Unlock {
  kind: WearKind;
  id: string;
}

/** Списки вещей по видам: конфиг, открытые, надетая. */
const WEAR = {
  hat: { list: () => CONFIG.hats, unlocked: 'hats', equipped: 'hat' },
  sweater: { list: () => CONFIG.sweaters, unlocked: 'sweaters', equipped: 'sweater' },
  guitar: { list: () => CONFIG.guitars, unlocked: 'guitars', equipped: 'guitar' },
} as const;

export const WEAR_KINDS: readonly WearKind[] = ['hat', 'sweater', 'guitar'];

export const unlockedOf = (save: Save, kind: WearKind) => save.unlocked[WEAR[kind].unlocked];
export const equippedOf = (save: Save, kind: WearKind) => save.equipped[WEAR[kind].equipped];

/** Надеть вещь или снять, если она уже надета. Закрытую не надевает. */
export function toggleWear(save: Save, kind: WearKind, id: string): boolean {
  if (!unlockedOf(save, kind).includes(id)) return false;
  const key = WEAR[kind].equipped;
  save.equipped[key] = save.equipped[key] === id ? null : id;
  return true;
}

/** Добавляет в save все вещи, открытые к текущему числу бабочек. Возвращает новые. */
export function applyUnlocks(save: Save): Unlock[] {
  const fresh: Unlock[] = [];
  for (const kind of WEAR_KINDS) {
    const open = unlockedOf(save, kind);
    for (const item of WEAR[kind].list()) {
      if (save.butterfliesTotal >= item.unlockAt && !open.includes(item.id)) {
        open.push(item.id);
        fresh.push({ kind, id: item.id });
      }
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

export const unseenUnlocks = (save: Save) =>
  WEAR_KINDS.flatMap((kind) => unlockedOf(save, kind).filter((id) => !save.seen.includes(`${kind}:${id}`)));

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

// ---------- день и ночь ----------

/** Ночь ли сейчас дома. */
export const isNight = (save: Save, now: number) => save.night !== null && now < save.night;

/** Раунд облачка долетели до ночного неба: дома наступает ночь. */
export function startNight(save: Save, now: number) {
  save.night = now + CONFIG.night.nightMinutes * 60_000;
}

/** Утро: ночь закончилась, спящий Пушок просыпается. */
export function morning(save: Save) {
  save.night = null;
  save.home.sleeping = false;
}

export type SkyPhase = 'day' | 'sunset' | 'evening' | 'night';

/** Какое небо в момент t (0..1) раунда облачка. */
export function skyAt(t: number): SkyPhase {
  const N = CONFIG.night;
  if (t >= N.nightFrom) return 'night';
  if (t >= N.eveningFrom) return 'evening';
  if (t >= N.sunsetFrom) return 'sunset';
  return 'day';
}

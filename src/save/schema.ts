import { CONFIG, type FoodId } from '../config';

// Схема сохранения. Хранится только на устройстве, личных данных нет.

export const SAVE_VERSION = 2;

export interface Dish {
  dish: string;
  satiety: number;
}

export interface SaveV2 {
  version: 2;
  createdAt: number;
  coins: number;
  /** Общий счетчик пойманных бабочек: по нему открывается гардероб. */
  butterfliesTotal: number;
  /** Сытость и момент, к которому она относится. Падение считается от at. */
  satiety: { value: number; at: number };
  /** Купленные продукты в корзинке. */
  basket: Partial<Record<FoodId, number>>;
  /** Приготовленные блюда в корзинке. */
  dishes: Dish[];
  unlocked: { hats: string[]; guitars: string[] };
  /** Открытые вещи, которые ребенок уже видел в гардеробе ('hat:bow', 'guitar:pink'). */
  seen: string[];
  equipped: { hat: string | null; guitar: string | null };
  settings: { sound: boolean };
  home: { pushokAt: string | null };
}

export type Save = SaveV2;

export function defaultSave(now: number): Save {
  return {
    version: 2,
    createdAt: now,
    coins: 0,
    butterfliesTotal: 0,
    satiety: { value: CONFIG.hunger.max, at: now },
    basket: {},
    dishes: [],
    unlocked: { hats: [], guitars: [] },
    seen: [],
    equipped: { hat: null, guitar: null },
    settings: { sound: true },
    home: { pushokAt: null },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
const FOOD_IDS = Object.keys(CONFIG.food) as FoodId[];

function basketOf(v: unknown) {
  const out: Partial<Record<FoodId, number>> = {};
  if (isObj(v)) {
    for (const id of FOOD_IDS) {
      const n = v[id];
      if (typeof n === 'number' && n >= 1) out[id] = Math.floor(n);
    }
  }
  return out;
}

function dishesOf(v: unknown): Dish[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .filter((d) => typeof d.dish === 'string' && typeof d.satiety === 'number' && Number.isFinite(d.satiety))
    .map((d) => ({ dish: d.dish as string, satiety: Math.max(0, Math.round(d.satiety as number)) }));
}

/** Приводит данные любой формы к валидной Save, подставляя значения по умолчанию. */
export function sanitize(raw: Record<string, unknown>, now: number): Save {
  const d = defaultSave(now);
  const sat = isObj(raw.satiety) ? raw.satiety : {};
  const unl = isObj(raw.unlocked) ? raw.unlocked : {};
  const eq = isObj(raw.equipped) ? raw.equipped : {};
  const st = isObj(raw.settings) ? raw.settings : {};
  const home = isObj(raw.home) ? raw.home : {};
  return {
    version: 2,
    createdAt: num(raw.createdAt, d.createdAt),
    coins: Math.floor(num(raw.coins, 0)),
    butterfliesTotal: Math.floor(num(raw.butterfliesTotal, 0)),
    satiety: {
      value: num(sat.value, d.satiety.value, CONFIG.hunger.floor, CONFIG.hunger.max),
      // время из будущего (сбитые часы) не должно замораживать голод
      at: Math.min(num(sat.at, now), now),
    },
    basket: basketOf(raw.basket),
    dishes: dishesOf(raw.dishes),
    unlocked: { hats: strArr(unl.hats), guitars: strArr(unl.guitars) },
    seen: strArr(raw.seen),
    equipped: { hat: strOrNull(eq.hat), guitar: strOrNull(eq.guitar) },
    settings: { sound: typeof st.sound === 'boolean' ? st.sound : true },
    home: { pushokAt: strOrNull(home.pushokAt) },
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Миграции: ключ = версия, ИЗ которой переводим. */
export const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: блюда стали списком с сытостью, появился список «уже видел».
  // В v1 блюд еще не было (кухня появилась позже), поэтому старое поле отбрасываем.
  1: (raw) => ({ ...raw, version: 2, dishes: [], seen: [] }),
};

export function migrate(
  raw: Record<string, unknown>,
  now: number,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SAVE_VERSION,
): Save {
  let data = raw;
  let v = typeof data.version === 'number' ? data.version : target;
  if (v > target) throw new Error(`сохранение из более новой версии (${v})`);
  while (v < target) {
    const step = migrations[v];
    if (!step) throw new Error(`нет миграции с версии ${v}`);
    data = step(data);
    v++;
  }
  return sanitize(data, now);
}

import { CONFIG, type FoodId } from '../config';

// Схема сохранения. Хранится только на устройстве, личных данных нет.
// Поля следующих этапов заведены сразу, чтобы не делать миграции на каждом этапе.

export const SAVE_VERSION = 1;

export interface SaveV1 {
  version: 1;
  createdAt: number;
  coins: number;
  /** Общий счетчик пойманных бабочек: по нему открывается гардероб. */
  butterfliesTotal: number;
  /** Сытость и момент, к которому она относится. Падение считается от at. */
  satiety: { value: number; at: number };
  /** Купленные продукты и приготовленные блюда в корзинке. */
  basket: Partial<Record<FoodId, number>>;
  dishes: Record<string, number>;
  unlocked: { hats: string[]; guitars: string[] };
  equipped: { hat: string | null; guitar: string | null };
  settings: { sound: boolean };
  home: { pushokAt: string | null };
}

export type Save = SaveV1;

export function defaultSave(now: number): Save {
  return {
    version: 1,
    createdAt: now,
    coins: 0,
    butterfliesTotal: 0,
    satiety: { value: CONFIG.hunger.max, at: now },
    basket: {},
    dishes: {},
    unlocked: { hats: [], guitars: [] },
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
const counts = (v: unknown) => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && n >= 1) out[k] = Math.floor(n);
  return out;
};

/** Приводит данные любой формы к валидной Save, подставляя значения по умолчанию. */
export function sanitize(raw: Record<string, unknown>, now: number): Save {
  const d = defaultSave(now);
  const sat = isObj(raw.satiety) ? raw.satiety : {};
  const unl = isObj(raw.unlocked) ? raw.unlocked : {};
  const eq = isObj(raw.equipped) ? raw.equipped : {};
  const st = isObj(raw.settings) ? raw.settings : {};
  const home = isObj(raw.home) ? raw.home : {};
  return {
    version: 1,
    createdAt: num(raw.createdAt, d.createdAt),
    coins: Math.floor(num(raw.coins, 0)),
    butterfliesTotal: Math.floor(num(raw.butterfliesTotal, 0)),
    satiety: {
      value: num(sat.value, d.satiety.value, CONFIG.hunger.floor, CONFIG.hunger.max),
      at: num(sat.at, now),
    },
    basket: counts(raw.basket),
    dishes: counts(raw.dishes),
    unlocked: { hats: strArr(unl.hats), guitars: strArr(unl.guitars) },
    equipped: { hat: strOrNull(eq.hat), guitar: strOrNull(eq.guitar) },
    settings: { sound: typeof st.sound === 'boolean' ? st.sound : true },
    home: { pushokAt: strOrNull(home.pushokAt) },
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Миграции: ключ = версия, ИЗ которой переводим. Пока версия одна. */
export const MIGRATIONS: Record<number, Migration> = {};

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

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
  unlocked: { hats: string[]; guitars: string[]; sweaters: string[] };
  /** Открытые вещи, которые ребенок уже видел в гардеробе ('hat:bow', 'guitar:pink', 'sweater:heart'). */
  seen: string[];
  equipped: { hat: string | null; guitar: string | null; sweater: string | null };
  settings: { sound: boolean };
  /** Пушок спит в кроватке ночью (до тапа по нему или до утра). */
  home: { pushokAt: string | null; sleeping: boolean };
  /** Если сейчас ночь: момент, когда наступит утро. Иначе null. */
  night: number | null;
  /** Звезды за занятия: ставят родители. seen = сколько звезд ребенок уже видел. */
  stars: { count: number; seen: number; log: LessonEntry[] };
  /** Голосовой разговор с Пушком. Все хранится только на этом устройстве. */
  talk: TalkState;
  /** Что недавно было в игре (летал на облачке, катался с горки…): Пушок знает об этом в разговоре. */
  journal: JournalEntry[];
}

export interface JournalEntry {
  at: number;
  /** С точки зрения Пушка: «катался с горки», «тебе купили морковку». */
  text: string;
  /** Сколько раз подряд (одинаковые события склеиваются). */
  n: number;
}

export interface TalkTurn {
  at: number;
  role: 'kira' | 'pushok' | 'event';
  text: string;
  /** Пометки эмоции и действия Пушка («[эмоция: радость]»): модель видит их в истории, вслух они не звучат. */
  tags?: string;
}

export interface TalkState {
  enabled: boolean;
  /** Адрес сервера и код доступа: вводят родители, в коде игры их нет. */
  serverUrl: string;
  code: string;
  /** Учет минут: дата (местная) и сколько потрачено сегодня, плюс подаренные родителями минуты. */
  day: string;
  usedMs: number;
  extraMs: number;
  warned: boolean;
  /** Тетрадка Пушка (сказки, новости, записки для родителей). Форму проверяет сервер. */
  notebook: unknown;
  history: TalkTurn[];
}

/** Запись о занятии: delta = оценка (+1/0/-1), applied = насколько реально изменился счет. */
export interface LessonEntry {
  at: number;
  delta: number;
  applied: number;
  /** «Новый круг»: счет обнулен после награды. */
  restart?: boolean;
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
    unlocked: { hats: [], guitars: [], sweaters: [] },
    seen: [],
    equipped: { hat: null, guitar: null, sweater: null },
    settings: { sound: true },
    home: { pushokAt: null, sleeping: false },
    night: null,
    stars: { count: 0, seen: 0, log: [] },
    talk: defaultTalk(),
    journal: [],
  };
}

export const defaultTalk = (): TalkState => ({
  // режим включен сразу: награда за пять звезд уже получена
  enabled: true,
  serverUrl: '',
  code: '',
  day: '',
  usedMs: 0,
  extraMs: 0,
  warned: false,
  notebook: null,
  history: [],
});

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

const HISTORY_MAX = 400;

function talkOf(v: unknown): TalkState {
  const t = isObj(v) ? v : {};
  const d = defaultTalk();
  const history = Array.isArray(t.history)
    ? t.history
        .filter(isObj)
        .filter((h) => typeof h.text === 'string' && ['kira', 'pushok', 'event'].includes(h.role as string))
        .map((h) => ({
          at: num(h.at, 0),
          role: h.role as TalkTurn['role'],
          text: (h.text as string).slice(0, 2000),
          ...(typeof h.tags === 'string' && h.tags ? { tags: h.tags.slice(0, 100) } : {}),
        }))
        .slice(-HISTORY_MAX)
    : [];
  return {
    enabled: typeof t.enabled === 'boolean' ? t.enabled : d.enabled,
    serverUrl: typeof t.serverUrl === 'string' ? t.serverUrl : '',
    code: typeof t.code === 'string' ? t.code : '',
    day: typeof t.day === 'string' ? t.day : '',
    usedMs: num(t.usedMs, 0),
    extraMs: num(t.extraMs, 0),
    warned: t.warned === true,
    notebook: isObj(t.notebook) ? t.notebook : null,
    history,
  };
}

function starsOf(v: unknown): Save['stars'] {
  const st = isObj(v) ? v : {};
  const goal = CONFIG.stars.goal;
  const log = Array.isArray(st.log)
    ? st.log
        .filter(isObj)
        .filter((e) => typeof e.at === 'number' && typeof e.delta === 'number' && typeof e.applied === 'number')
        .map((e) => ({
          at: e.at as number,
          delta: Math.sign(e.delta as number),
          applied: Math.round(e.applied as number),
          ...(e.restart === true ? { restart: true } : {}),
        }))
    : [];
  return {
    count: Math.floor(num(st.count, 0, 0, goal)),
    seen: Math.floor(num(st.seen, 0, 0, goal)),
    log,
  };
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
    unlocked: { hats: strArr(unl.hats), guitars: strArr(unl.guitars), sweaters: strArr(unl.sweaters) },
    seen: strArr(raw.seen),
    equipped: { hat: strOrNull(eq.hat), guitar: strOrNull(eq.guitar), sweater: strOrNull(eq.sweater) },
    settings: { sound: typeof st.sound === 'boolean' ? st.sound : true },
    home: { pushokAt: strOrNull(home.pushokAt), sleeping: home.sleeping === true },
    night: typeof raw.night === 'number' && Number.isFinite(raw.night) ? raw.night : null,
    stars: starsOf(raw.stars),
    talk: talkOf(raw.talk),
    journal: Array.isArray(raw.journal)
      ? raw.journal
          .filter(isObj)
          .filter((e) => typeof e.text === 'string')
          .map((e) => ({ at: Math.min(num(e.at, now), now), text: (e.text as string).slice(0, 120), n: Math.max(1, Math.floor(num(e.n, 1))) }))
          .slice(-JOURNAL_MAX)
      : [],
  };
}

export const JOURNAL_MAX = 15;

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

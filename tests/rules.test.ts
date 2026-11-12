import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  isNight,
  morning,
  skyAt,
  startNight,
  applyUnlocks,
  buy,
  catchButterfly,
  cook,
  feed,
  isFull,
  moodOf,
  satietyLossPerHour,
  satietyNow,
  takeFood,
  unseenUnlocks,
} from '../src/game/rules';
import { defaultSave, migrate } from '../src/save/schema';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

describe('голод', () => {
  it('от полной сытости до «просит кушать» около 6 часов', () => {
    const s = { value: 100, at: T0 };
    expect(satietyNow(s, T0 + 5.9 * HOUR)).toBeGreaterThanOrEqual(CONFIG.hunger.hungryBelow);
    expect(moodOf(satietyNow(s, T0 + 6.1 * HOUR))).toBe('hungry');
    expect(satietyLossPerHour).toBeCloseTo(10);
  });

  it('падает и пока игра закрыта, но не ниже 10', () => {
    const s = { value: 100, at: T0 };
    expect(satietyNow(s, T0 + 30 * 24 * HOUR)).toBe(10);
    expect(moodOf(10)).toBe('veryHungry');
  });

  it('время назад (сбитые часы) не прибавляет сытость', () => {
    expect(satietyNow({ value: 50, at: T0 }, T0 - HOUR)).toBe(50);
  });

  it('кормление: прибавка к текущей сытости, максимум 100', () => {
    const s = defaultSave(T0);
    s.satiety = { value: 100, at: T0 };
    feed(s, 25, T0 + 8 * HOUR); // было 20
    expect(s.satiety.value).toBeCloseTo(45);
    expect(s.satiety.at).toBe(T0 + 8 * HOUR);
    feed(s, 500, T0 + 8 * HOUR);
    expect(s.satiety.value).toBe(100);
    expect(isFull(s.satiety.value)).toBe(true);
  });

  it('баланс: раунд 12 бабочек + 1 яблочко кормит с нижнего предела почти досыта', () => {
    const s = defaultSave(T0);
    s.satiety = { value: 10, at: T0 };
    for (let i = 0; i < 12; i++) catchButterfly(s);
    feed(s, CONFIG.hunger.cloudApple, T0);
    // 12 денежек: 3 семечки (12) или 2 семечки + 2 морковки
    while (buy(s, 'seeds'));
    while (buy(s, 'carrot'));
    for (const f of ['seeds', 'carrot'] as const) while (takeFood(s, f)) feed(s, CONFIG.food[f].satiety, T0);
    expect(s.satiety.value).toBeGreaterThanOrEqual(95);
  });
});

describe('денежки и корзинка', () => {
  it('покупка списывает цену, без денег не покупает', () => {
    const s = defaultSave(T0);
    s.coins = 5;
    expect(buy(s, 'seeds')).toBe(true);
    expect(s.coins).toBe(1);
    expect(s.basket.seeds).toBe(1);
    expect(buy(s, 'seeds')).toBe(false);
    expect(s.coins).toBe(1);
  });
  it('takeFood убирает пустые записи', () => {
    const s = defaultSave(T0);
    s.basket.apple = 1;
    expect(takeFood(s, 'apple')).toBe(true);
    expect(s.basket).toEqual({});
    expect(takeFood(s, 'apple')).toBe(false);
  });
});

describe('открытия гардероба', () => {
  it('корона на 5-й бабочке, гитара на 15-й', () => {
    const s = defaultSave(T0);
    const fresh = [];
    for (let i = 0; i < 4; i++) fresh.push(...catchButterfly(s));
    expect(fresh).toEqual([]);
    expect(catchButterfly(s)).toEqual([{ kind: 'hat', id: 'crown' }]);
    for (let i = 5; i < 14; i++) catchButterfly(s);
    expect(catchButterfly(s)).toEqual([{ kind: 'guitar', id: 'pink' }]);
    expect(s.coins).toBe(15);
    expect(unseenUnlocks(s)).toEqual(['crown', 'star', 'pink']);
  });
  it('12 шляпок и 6 гитар; пороги из ТЗ сохранены, новые между ними', () => {
    const hats = Object.fromEntries(CONFIG.hats.map((h) => [h.id, h.unlockAt]));
    expect(hats).toMatchObject({ crown: 5, bow: 25, wreath: 50, pompom: 90, cherry: 140, heart: 200 });
    const guitars = Object.fromEntries(CONFIG.guitars.map((g) => [g.id, g.unlockAt]));
    expect(guitars).toMatchObject({ pink: 15, blue: 70, gold: 170 });
    expect(CONFIG.hats).toHaveLength(12);
    expect(CONFIG.guitars).toHaveLength(6);
    // в гардеробе по порядку открытия
    const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
    expect(CONFIG.hats.map((h) => h.unlockAt)).toEqual(sorted(CONFIG.hats.map((h) => h.unlockAt)));
    expect(CONFIG.guitars.map((g) => g.unlockAt)).toEqual(sorted(CONFIG.guitars.map((g) => g.unlockAt)));
  });
  it('у каждой вещи из конфига есть спрайт и мелодия гитары', async () => {
    const { HATS } = await import('../src/sprites/hats');
    const { GUITARS } = await import('../src/sprites/items');
    for (const h of CONFIG.hats) expect(HATS, h.id).toHaveProperty(h.id);
    for (const g of CONFIG.guitars) expect(GUITARS, g.id).toHaveProperty(g.id);
  });
  it('повторно не открывает', () => {
    const s = defaultSave(T0);
    s.butterfliesTotal = 300;
    expect(applyUnlocks(s)).toHaveLength(18);
    expect(applyUnlocks(s)).toHaveLength(0);
  });
});

describe('кухня', () => {
  it('яблоко + семечки = пирожок, порядок не важен', () => {
    expect(cook(['seeds', 'apple']).dish).toBe('pie');
    expect(cook(['apple', 'seeds']).dish).toBe('pie');
  });
  it('любая другая комбинация = суп-сюрприз', () => {
    expect(cook(['bread', 'carrot']).dish).toBe('soup');
    expect(cook(['apple', 'seeds', 'bread']).dish).toBe('soup');
  });
  it('блюдо сытнее суммы продуктов (×1.3), но не меньше 35', () => {
    expect(cook(['carrot', 'bread']).satiety).toBe(35); // 24 × 1.3 = 31 → 35
    expect(cook(['seeds', 'apple']).satiety).toBe(52); // 40 × 1.3
    expect(cook(['seeds', 'seeds', 'seeds']).satiety).toBe(98);
  });
});

describe('миграция v1 → v2', () => {
  it('прогресс сохраняется, блюда и «видел» появляются пустыми', () => {
    const v1 = {
      version: 1,
      createdAt: T0,
      coins: 7,
      butterfliesTotal: 12,
      satiety: { value: 60, at: T0 },
      basket: { seeds: 2 },
      dishes: { pie: 1 },
      unlocked: { hats: ['crown'], guitars: [] },
      equipped: { hat: 'crown', guitar: null },
      settings: { sound: false },
      home: { pushokAt: 'bed' },
    };
    const s = migrate(v1, T0);
    expect(s.version).toBe(2);
    expect(s.coins).toBe(7);
    expect(s.basket).toEqual({ seeds: 2 });
    expect(s.dishes).toEqual([]);
    expect(s.seen).toEqual([]);
    expect(s.equipped.hat).toBe('crown');
    expect(s.settings.sound).toBe(false);
  });
});

describe('день и ночь', () => {
  it('небо раунда: день → закат → вечер → ночь', () => {
    expect(skyAt(0)).toBe('day');
    expect(skyAt(0.6)).toBe('sunset');
    expect(skyAt(0.8)).toBe('evening');
    expect(skyAt(0.95)).toBe('night');
    expect(skyAt(1)).toBe('night');
  });
  it('долетели до ночи: дома ночь на nightMinutes, потом утро', () => {
    const s = defaultSave(T0);
    expect(isNight(s, T0)).toBe(false);
    startNight(s, T0);
    expect(isNight(s, T0 + 1000)).toBe(true);
    expect(isNight(s, T0 + CONFIG.night.nightMinutes * 60_000 + 1)).toBe(false);
  });
  it('утро будит спящего Пушка', () => {
    const s = defaultSave(T0);
    startNight(s, T0);
    s.home.sleeping = true;
    morning(s);
    expect(s.night).toBeNull();
    expect(s.home.sleeping).toBe(false);
  });
  it('старое сохранение без полей ночи читается как день', () => {
    const s = migrate({ version: 2, coins: 3, home: { pushokAt: 'bed' } }, T0);
    expect(s.night).toBeNull();
    expect(s.home).toEqual({ pushokAt: 'bed', sleeping: false });
  });
});

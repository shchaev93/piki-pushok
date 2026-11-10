import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
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
    expect(unseenUnlocks(s)).toEqual(['crown', 'pink']);
  });
  it('пороги из конфига растут, всего 6 шляпок и 3 гитары', () => {
    expect(CONFIG.hats.map((h) => h.unlockAt)).toEqual([5, 25, 50, 90, 140, 200]);
    expect(CONFIG.guitars.map((g) => g.unlockAt)).toEqual([15, 70, 170]);
  });
  it('повторно не открывает', () => {
    const s = defaultSave(T0);
    s.butterfliesTotal = 300;
    expect(applyUnlocks(s)).toHaveLength(9);
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

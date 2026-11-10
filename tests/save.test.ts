import { describe, expect, it, vi } from 'vitest';
import { defaultSave, migrate, sanitize } from '../src/save/schema';
import { BACKUP_KEY, createStore, loadSave, requestPersist, SAVE_KEY, type KV } from '../src/save/store';

class MemKV implements KV {
  map = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
}

const NOW = 1_700_000_000_000;

describe('сохранение', () => {
  it('без данных стартует со значений по умолчанию', () => {
    const { save, recovered } = loadSave(new MemKV(), NOW);
    expect(save).toEqual(defaultSave(NOW));
    expect(recovered).toBe(false);
    expect(save.satiety).toEqual({ value: 100, at: NOW });
  });

  it('каждое изменение сразу пишется и читается обратно', () => {
    const kv = new MemKV();
    const store = createStore(kv, () => NOW);
    store.update((s) => {
      s.settings.sound = false;
      s.home.pushokAt = 'trampoline';
    });
    expect(JSON.parse(kv.map.get(SAVE_KEY)!).settings.sound).toBe(false);
    const again = createStore(kv, () => NOW + 1000);
    expect(again.data.settings.sound).toBe(false);
    expect(again.data.home.pushokAt).toBe('trampoline');
  });

  it('update не мутирует старый снимок', () => {
    const store = createStore(new MemKV(), () => NOW);
    const before = store.data;
    store.update((s) => (s.coins = 5));
    expect(before.coins).toBe(0);
    expect(store.data.coins).toBe(5);
  });

  it('битый JSON уходит в резервный ключ, игра не падает', () => {
    const kv = new MemKV();
    kv.map.set(SAVE_KEY, '{oops');
    const { save, recovered } = loadSave(kv, NOW);
    expect(recovered).toBe(true);
    expect(save).toEqual(defaultSave(NOW));
    expect(kv.map.get(BACKUP_KEY)).toBe('{oops');
  });

  it('неполные и мусорные поля заменяются значениями по умолчанию', () => {
    const s = sanitize({ coins: -5, satiety: { value: 3 }, basket: { seeds: 2, apple: 'x' }, settings: { sound: 'no' } }, NOW);
    expect(s.coins).toBe(0);
    expect(s.satiety.value).toBe(10); // нижний предел сытости
    expect(s.basket).toEqual({ seeds: 2 });
    expect(s.settings.sound).toBe(true);
  });

  it('сохранение из будущей версии не затирается молча', () => {
    const kv = new MemKV();
    kv.map.set(SAVE_KEY, JSON.stringify({ version: 99 }));
    expect(loadSave(kv, NOW).recovered).toBe(true);
    expect(kv.map.get(BACKUP_KEY)).toContain('99');
  });

  it('миграции применяются по цепочке', () => {
    const migrations = { 0: (r: Record<string, unknown>) => ({ ...r, version: 1, coins: (r.money as number) ?? 0 }) };
    const s = migrate({ version: 0, money: 7 }, NOW, migrations, 1);
    expect(s.coins).toBe(7);
  });

  it('сброс обнуляет прогресс, но оставляет настройку звука', () => {
    const store = createStore(new MemKV(), () => NOW);
    store.update((s) => {
      s.coins = 9;
      s.butterfliesTotal = 30;
      s.settings.sound = false;
    });
    store.reset();
    expect(store.data.coins).toBe(0);
    expect(store.data.butterfliesTotal).toBe(0);
    expect(store.data.settings.sound).toBe(false);
  });

  it('ошибка записи не роняет игру и видна в lastWriteOk', () => {
    const kv = new MemKV();
    const store = createStore(kv, () => NOW);
    kv.failWrites = true;
    expect(() => store.update((s) => (s.coins = 1))).not.toThrow();
    expect(store.lastWriteOk).toBe(false);
  });
});

describe('navigator.storage.persist', () => {
  it('вызывается и возвращает granted', async () => {
    const persist = vi.fn(async () => true);
    const st = { persist, persisted: async () => false } as unknown as StorageManager;
    expect(await requestPersist(st)).toBe('granted');
    expect(persist).toHaveBeenCalledOnce();
  });
  it('не вызывается повторно, если уже постоянное', async () => {
    const persist = vi.fn(async () => true);
    const st = { persist, persisted: async () => true } as unknown as StorageManager;
    expect(await requestPersist(st)).toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });
  it('отказ и отсутствие API', async () => {
    expect(await requestPersist({ persist: async () => false } as unknown as StorageManager)).toBe('denied');
    expect(await requestPersist(undefined)).toBe('unsupported');
  });
});

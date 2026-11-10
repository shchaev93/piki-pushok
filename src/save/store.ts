import { defaultSave, migrate, type Save } from './schema';

export const SAVE_KEY = 'piki-pushok.save';
export const BACKUP_KEY = 'piki-pushok.save.broken';

/** Минимальный интерфейс хранилища: localStorage или заглушка в тестах. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Store {
  readonly data: Readonly<Save>;
  /** Изменение + немедленная запись на устройство. */
  update(fn: (draft: Save) => void): void;
  /** Сброс прогресса (из панели взрослых). Настройка звука сохраняется. */
  reset(): void;
  /** Удалась ли последняя запись (нет места, приватный режим и т.п.). */
  readonly lastWriteOk: boolean;
  /** Повторная запись (на pagehide, на всякий случай). */
  flush(): void;
  onChange(cb: (s: Readonly<Save>) => void): void;
}

export function loadSave(kv: KV, now: number): { save: Save; recovered: boolean } {
  let text: string | null;
  try {
    text = kv.getItem(SAVE_KEY);
  } catch {
    return { save: defaultSave(now), recovered: false };
  }
  if (text === null) return { save: defaultSave(now), recovered: false };
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('не объект');
    return { save: migrate(raw as Record<string, unknown>, now), recovered: false };
  } catch {
    // Битые данные не теряем: откладываем копию и начинаем с чистого листа.
    try {
      kv.setItem(BACKUP_KEY, text);
    } catch {
      /* нет места: ничего не поделать */
    }
    return { save: defaultSave(now), recovered: true };
  }
}

export function createStore(kv: KV, now: () => number = Date.now): Store {
  let data = loadSave(kv, now()).save;
  let lastWriteOk = true;
  const listeners: ((s: Readonly<Save>) => void)[] = [];

  const write = () => {
    try {
      kv.setItem(SAVE_KEY, JSON.stringify(data));
      lastWriteOk = true;
    } catch {
      lastWriteOk = false;
    }
  };
  const commit = () => {
    write();
    listeners.forEach((cb) => cb(data));
  };

  return {
    get data() {
      return data;
    },
    get lastWriteOk() {
      return lastWriteOk;
    },
    update(fn) {
      const draft = structuredClone(data);
      fn(draft);
      data = draft;
      commit();
    },
    reset() {
      const sound = data.settings.sound;
      data = defaultSave(now());
      data.settings.sound = sound;
      commit();
    },
    flush: write,
    onChange(cb) {
      listeners.push(cb);
    },
  };
}

export type PersistState = 'granted' | 'denied' | 'unsupported';

/** Просим браузер не стирать данные при нехватке места (ТЗ: вызвать при старте). */
export async function requestPersist(storage: StorageManager | undefined = navigator.storage): Promise<PersistState> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

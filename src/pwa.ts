import { registerSW } from 'virtual:pwa-register';

// Service worker: игра кэшируется целиком и дальше работает без сети.
// Обновления:
// - нашлась новая версия в первые секунды после запуска → включаем сразу
//   (ребенок еще не успел начать играть);
// - нашлась позже → включаем, когда приложение свернули и открыли снова;
// - в панели взрослых есть кнопка «Проверить обновление».

export type UpdateState = 'current' | 'checking' | 'ready' | 'offline' | 'unsupported';

export interface Pwa {
  state(): UpdateState;
  /** Проверить сервер; если есть новая версия, сразу включить ее (перезагрузка). */
  checkAndApply(): Promise<UpdateState>;
}

const LAUNCH_WINDOW_MS = 15_000;

export function setupPwa(): Pwa {
  if (!('serviceWorker' in navigator)) return { state: () => 'unsupported', checkAndApply: async () => 'unsupported' };
  const startedAt = Date.now();
  let state: UpdateState = 'current';
  let reg: ServiceWorkerRegistration | undefined;
  let hiddenAt = 0;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      state = 'ready';
      // только что запустили игру: обновляемся сразу, пока ничего не начато
      if (Date.now() - startedAt < LAUNCH_WINDOW_MS) void updateSW(true);
    },
    onRegisteredSW(_url, r) {
      reg = r;
      // проверка раз в час, если игра долго открыта
      if (r) setInterval(() => void r.update().catch(() => {}), 60 * 60 * 1000);
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (state === 'ready' && Date.now() - hiddenAt > 1500) void updateSW(true);
    // вернулись в игру: заодно спросим сервер, нет ли новой версии
    else void reg?.update().catch(() => {});
  });

  return {
    state: () => state,
    async checkAndApply() {
      if (state === 'ready') {
        await updateSW(true);
        return 'ready';
      }
      if (!reg) return state;
      state = 'checking';
      try {
        await reg.update();
      } catch {
        state = 'offline';
        return state;
      }
      // новая версия ставится несколько секунд: ждем, пока она станет «ожидающей»
      for (let i = 0; i < 40 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 250));
      if (reg.waiting) {
        state = 'ready';
        await updateSW(true);
        return 'ready';
      }
      state = 'current';
      return state;
    },
  };
}

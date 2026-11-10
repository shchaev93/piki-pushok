import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker: игра кэшируется целиком и дальше работает без сети.
 * Новая версия ставится в фоне и применяется, только когда приложение
 * вернули из фона (или при следующем запуске), а не посреди игры.
 */
export function setupPwa() {
  if (!('serviceWorker' in navigator)) return;
  let pending = false;
  let hiddenAt = 0;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
    },
    onRegisteredSW(_url, reg) {
      // Проверка обновлений раз в час, если игра долго открыта.
      if (reg) setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (pending && Date.now() - hiddenAt > 1500) void updateSW(true);
  });
}

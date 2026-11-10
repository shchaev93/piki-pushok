import './style.css';
import { App } from './app';
import { Sfx } from './audio/sfx';
import { createStore, requestPersist, type KV } from './save/store';
import { maybeShowInstallHint } from './ui/install-hint';
import { setupPwa } from './pwa';

declare const __APP_VERSION__: string;

function storage(): KV {
  try {
    const k = '__piki_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    // Хранилище недоступно (приватный режим): играем без сохранения.
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  }
}

/** Только касания: без зума, выделения, лупы и контекстного меню. */
function lockGestures() {
  const inPanel = (e: Event) => (e.target as Element | null)?.closest?.('.panel');
  document.addEventListener('touchmove', (e) => !inPanel(e) && e.preventDefault(), { passive: false });
  document.addEventListener('touchstart', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart']) {
    document.addEventListener(ev, (e) => e.preventDefault());
  }
}

async function start() {
  lockGestures();
  const store = createStore(storage());
  Sfx.usePlaybackSession();
  const sfx = new Sfx();
  sfx.enabled = store.data.settings.sound;
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click'] as const) {
    addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });
  }
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const probe = document.getElementById('safe-probe')!;
  const app = new App(canvas, probe, store, sfx, __APP_VERSION__);

  addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      store.flush();
      sfx.suspend();
    }
  });

  (window as unknown as { __piki: unknown }).__piki = { app, store };
  maybeShowInstallHint();
  setupPwa();
  app.persist = await requestPersist();
}

if (location.hash === '#sprites') {
  void import('./debug/gallery').then((m) => m.showGallery(__APP_VERSION__));
} else {
  void start();
}
addEventListener('hashchange', () => location.reload());

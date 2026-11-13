import { CONFIG } from '../config';
import { rateLesson, restartStars, starsGoalReached, undoLesson, type LessonRating } from '../game/rules';
import type { Sfx } from '../audio/sfx';
import type { PersistState, Store } from '../save/store';
import { isStandalone } from './platform';
import type { Pwa } from '../pwa';

// Панель для взрослых. Открывается только удержанием шестеренки 3 секунды.
// Здесь текст допустим: ребенок сюда не попадает.

export interface AdultPanel {
  open(): void;
  readonly isOpen: boolean;
}

interface Opts {
  store: Store;
  sfx: Sfx;
  version: string;
  persist: () => PersistState;
  onReset: () => void;
  pwa: () => Pwa | null;
  /** Звезды поменялись: домик покажет ребенку изменение. */
  onStarsChanged: () => void;
}

const persistText: Record<PersistState, string> = {
  granted: 'постоянное (браузер не сотрет данные сам)',
  denied: 'обычное (браузер может стереть данные при нехватке места)',
  unsupported: 'браузер не сообщает',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function createAdultPanel(o: Opts): AdultPanel {
  const root = el('div', 'overlay adult');
  root.hidden = true;
  const panel = el('div', 'panel');
  root.append(panel);

  const head = el('div', 'head');
  const title = el('h2', '', 'Для взрослых');
  const close = el('button', 'btn primary close', 'Закрыть');
  head.append(title, close);
  const row = el('div', 'row');
  const sound = el('button', 'btn');
  const reset = el('button', 'btn hold-btn');
  row.append(sound, reset);
  const resetNote = el('p', 'note reset-note');
  const update = el('button', 'btn', 'Проверить обновление');
  const info = el('div', 'info');
  // ---------- звезды за занятия ----------
  const stars = el('div', 'stars');
  const starsTitle = el('p', 'stars-title');
  const rateRow = el('div', 'row');
  const good = el('button', 'btn good', 'Старалась: +★');
  const noStar = el('button', 'btn', 'Без звезды в этот раз');
  rateRow.append(good, noStar);
  const starsRow2 = el('div', 'row');
  const undo = el('button', 'btn', 'Отменить последнюю запись');
  const restart = el('button', 'btn', 'Новый круг (звезды с нуля)');
  starsRow2.append(undo, restart);
  const starsNote = el('p', 'note');
  const history = el('div', 'info history');
  stars.append(starsTitle, rateRow, starsRow2, starsNote, history);
  let starsChanged = false;

  const fmt = (t: number) =>
    new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const renderStars = () => {
    const st = o.store.data.stars;
    const goal = CONFIG.stars.goal;
    starsTitle.textContent = `Звезды за занятия: ${'★'.repeat(st.count)}${'☆'.repeat(goal - st.count)} (${st.count} из ${goal})`;
    restart.hidden = !starsGoalReached(o.store.data);
    undo.disabled = st.log.length === 0;
    if (starsGoalReached(o.store.data)) {
      starsNote.textContent = `Цель достигнута! Награда: разговор с Пушком (появится, когда сделаем). «Новый круг» начнет звезды заново.`;
    }
    const label = (e: { delta: number; applied: number; restart?: boolean }) =>
      e.restart ? 'новый круг' : e.delta > 0 ? 'старалась, +★' : e.delta < 0 ? 'звезда снята (старая запись)' : 'без звезды';
    history.replaceChildren(
      ...st.log
        .slice(-6)
        .reverse()
        .map((e) => el('p', '', `${fmt(e.at)}: ${label(e)}${!e.restart && e.delta !== 0 && e.applied === 0 ? ' (без изменений: предел)' : ''}`)),
    );
  };
  const rate = (r: LessonRating, msg: string) => {
    o.store.update((s) => rateLesson(s, r, Date.now()));
    starsChanged = true;
    starsNote.textContent = msg;
    renderStars();
  };
  good.addEventListener('click', () =>
    rate(1, 'Записано: +★. Новая звезда появится на доске в домике. Похвалите за то, что именно получилось.'),
  );
  noStar.addEventListener('click', () =>
    rate(0, 'Записано без звезды. Заработанные звезды остаются: в следующий раз получится.'),
  );
  undo.addEventListener('click', () => {
    o.store.update((s) => undoLesson(s));
    starsChanged = true;
    starsNote.textContent = 'Последняя запись отменена.';
    renderStars();
  });
  restart.addEventListener('click', () => {
    o.store.update((s) => restartStars(s, Date.now()));
    starsChanged = true;
    starsNote.textContent = 'Новый круг: звезды с нуля, история сохранена.';
    renderStars();
  });

  panel.append(head, stars, row, resetNote, update, info);

  // Обновление игры вручную: если на сайте новая версия, игра перезагрузится в нее.
  update.addEventListener('click', async () => {
    const pwa = o.pwa();
    if (!pwa) {
      update.textContent = 'Обновления недоступны в этом браузере';
      return;
    }
    update.textContent = 'Проверяю...';
    const r = await pwa.checkAndApply();
    update.textContent =
      r === 'ready'
        ? 'Обновляю...'
        : r === 'offline'
          ? 'Нет интернета, попробуйте позже'
          : 'Установлена последняя версия';
  });
  document.body.append(root);

  const renderSound = () => {
    sound.textContent = o.store.data.settings.sound ? 'Звук: включен' : 'Звук: выключен';
  };

  const renderInfo = () => {
    const d = o.store.data;
    info.replaceChildren(
      ...[
        `Версия: ${o.version}`,
        `Режим: ${isStandalone() ? 'с иконки на экране «Домой»' : 'вкладка браузера'}`,
        `Хранилище: ${persistText[o.persist()]}`,
        `Сохранение: ${o.store.lastWriteOk ? 'работает' : 'НЕ записывается'}`,
        `Пойманных бабочек: ${d.butterfliesTotal}, денежек: ${d.coins}`,
      ].map((t) => el('p', '', t)),
    );
    if (!isStandalone()) {
      info.append(
        el(
          'p',
          'warn',
          'Играйте только с иконки на экране «Домой». В обычной вкладке Safari данные могут стереться через 7 дней без посещения.',
        ),
      );
    }
  };

  sound.addEventListener('click', () => {
    o.store.update((s) => (s.settings.sound = !s.settings.sound));
    o.sfx.enabled = o.store.data.settings.sound;
    renderSound();
  });

  // Сброс подтверждается вторым удержанием 3 секунды.
  let holdStart = 0;
  let raf = 0;
  const setP = (p: number) => reset.style.setProperty('--p', `${Math.round(p * 100)}%`);
  const stopHold = () => {
    cancelAnimationFrame(raf);
    holdStart = 0;
    setP(0);
  };
  const tick = () => {
    const p = (performance.now() - holdStart) / CONFIG.adultHoldMs;
    if (p >= 1) {
      stopHold();
      o.store.reset();
      o.onReset();
      resetNote.textContent = 'Прогресс сброшен.';
      renderInfo();
      return;
    }
    setP(p);
    raf = requestAnimationFrame(tick);
  };
  reset.textContent = 'Сброс прогресса: удерживайте 3 с';
  reset.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resetNote.textContent = '';
    holdStart = performance.now();
    raf = requestAnimationFrame(tick);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) reset.addEventListener(ev, stopHold);

  close.addEventListener('click', () => {
    if (starsChanged) {
      starsChanged = false;
      o.onStarsChanged();
    }
    root.hidden = true;
    stopHold();
  });

  return {
    open() {
      starsNote.textContent = '';
      renderStars();
      update.textContent = 'Проверить обновление';
      renderSound();
      renderInfo();
      resetNote.textContent = '';
      root.hidden = false;
    },
    get isOpen() {
      return !root.hidden;
    },
  };
}

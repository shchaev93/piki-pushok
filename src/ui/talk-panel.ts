import { CONFIG } from '../config';
import type { Store } from '../save/store';
import { localDay, talkLeftMs } from '../scenes/talk';
import { api } from '../talk/api';
import { micStats } from '../talk/recorder';

// Раздел «Разговор с Пушком» в панели взрослых: настройка сервера, проверка связи
// и расходов за день, минуты, записки ребенка для родителей, тетрадка и история.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const fmt = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type Nb = { stories?: { title?: string; stoppedAt?: string }[]; notesForParents?: { date?: string; text?: string }[] };

export function createTalkSection(store: Store) {
  const root = el('div', 'stars talk');
  const title = el('p', 'talk-title', 'Разговор с Пушком');
  const status = el('p', 'note');
  const row = el('div', 'row');
  const toggle = el('button', 'btn');
  const more = el('button', 'btn', `+${CONFIG.talk.extraMinutes} минут сегодня`);
  row.append(toggle, more);
  const url = el('input', 'field');
  url.type = 'url';
  url.placeholder = 'Адрес сервера, https://...';
  url.autocomplete = 'off';
  const code = el('input', 'field');
  code.type = 'text';
  code.placeholder = 'Код доступа';
  code.autocomplete = 'off';
  // Код сверяется с учетом регистра: iPhone не должен сам делать первую букву заглавной или «исправлять» код.
  code.autocapitalize = 'off';
  code.spellcheck = false;
  code.setAttribute('autocorrect', 'off');
  const check = el('button', 'btn', 'Сохранить и проверить связь');
  const checkNote = el('p', 'note');
  const micNote = el('p', 'note mic-note');
  const notes = el('details', 'info');
  const book = el('details', 'info');
  const hist = el('details', 'info');
  const clear = el('button', 'btn', 'Стереть историю разговоров');
  root.append(title, status, row, url, code, check, checkNote, micNote, notes, book, hist, clear);
  let changed = false;

  const list = (box: HTMLElement, name: string, rows: string[]) => {
    box.replaceChildren(el('summary', '', `${name} (${rows.length})`), ...(rows.length ? rows : ['пока пусто']).map((t) => el('p', '', t)));
  };

  const render = () => {
    const t = store.data.talk;
    const today = localDay();
    const left = Math.max(0, Math.round(talkLeftMs(store.data, today) / 60_000));
    const total = CONFIG.talk.minutesPerDay + Math.round((t.day === today ? t.extraMs : 0) / 60_000);
    toggle.textContent = t.enabled ? 'Разговор: включен' : 'Разговор: выключен';
    status.textContent =
      t.serverUrl && t.code ? `Сегодня осталось ${left} мин из ${total}.` : 'Чтобы Пушок заговорил, впишите адрес сервера и код доступа.';
    const m = micStats;
    micNote.textContent = m
      ? `Микрофон, последняя запись (${fmt(m.at)}): ` +
        (m.error
          ? `ошибка ${m.error}, режим звука ${m.session}.`
          : `${m.seconds.toFixed(1)} с, кусков ${m.frames}, громкость ${m.peak.toFixed(3)} при шуме ${m.noise.toFixed(3)}, ` +
            `речь ${m.hadSpeech ? 'да' : 'нет'}${m.manual ? ', остановили касанием' : ''}; ${m.rate} Гц, движок ${m.ctxState}, режим звука ${m.session}.`)
      : '';
    if (document.activeElement !== url) url.value = t.serverUrl;
    if (document.activeElement !== code) code.value = t.code;
    const nb = (t.notebook ?? {}) as Nb;
    list(notes, 'Записки для родителей', [...(nb.notesForParents ?? [])].reverse().map((n) => `${n.date ?? ''}: ${n.text ?? ''}`));
    list(book, 'Тетрадка сказок', (nb.stories ?? []).map((s) => `${s.title ?? ''}: ${s.stoppedAt ?? ''}`));
    list(
      hist,
      'История разговоров',
      t.history
        .filter((h) => h.role !== 'event')
        .slice(-40)
        .reverse()
        .map((h) => `${fmt(h.at)} ${h.role === 'kira' ? 'Она' : 'Пушок'}: ${h.text}`),
    );
  };

  toggle.addEventListener('click', () => {
    store.update((s) => (s.talk.enabled = !s.talk.enabled));
    changed = true;
    render();
  });

  more.addEventListener('click', () => {
    store.update((s) => {
      if (s.talk.day !== localDay()) {
        s.talk.day = localDay();
        s.talk.usedMs = 0;
        s.talk.extraMs = 0;
      }
      s.talk.extraMs += CONFIG.talk.extraMinutes * 60_000;
      s.talk.warned = false;
    });
    render();
  });

  check.addEventListener('click', async () => {
    const serverUrl = url.value.trim();
    const accessCode = code.value.trim();
    store.update((s) => {
      s.talk.serverUrl = serverUrl;
      s.talk.code = accessCode;
    });
    checkNote.textContent = 'Проверяю...';
    try {
      const h = await api.health({ serverUrl, code: accessCode });
      const b = h.budget;
      checkNote.textContent = b
        ? `Связь есть. Модель ${h.model} (${h.provider}). Сегодня потрачено $${b.llmUsd.toFixed(3)} из $${b.limits.dailyLlmUsd} и ${b.voiceRub.toFixed(1)} ₽ из ${b.limits.dailyVoiceRub} ₽.`
        : 'Связь есть.';
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      checkNote.textContent =
        kind === 'auth'
          ? 'Сервер отвечает, но код доступа неверный.'
          : kind === 'config'
            ? 'Впишите адрес и код.'
            : 'Сервер не отвечает. Проверьте адрес и интернет.';
    }
    render();
  });

  clear.addEventListener('click', () => {
    store.update((s) => (s.talk.history = []));
    render();
  });

  return {
    root,
    render: () => {
      checkNote.textContent = '';
      render();
    },
    /** Включение/выключение менялось с прошлого вызова. */
    takeChanged: () => {
      const c = changed;
      changed = false;
      return c;
    },
  };
}

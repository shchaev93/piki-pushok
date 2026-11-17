import { describe, expect, it } from 'vitest';
import { logEvent } from '../src/game/journal';
import { defaultSave, JOURNAL_MAX, sanitize } from '../src/save/schema';
import { gameState } from '../src/talk/session';
import { exportText } from '../src/talk/export';

describe('журнал игры для разговора', () => {
  it('одинаковые события подряд склеиваются, разные — нет, старые уходят', () => {
    const s = defaultSave(0);
    logEvent(s, 'катался с горки', 1000);
    logEvent(s, 'катался с горки', 2000);
    logEvent(s, 'прыгал на батуте', 3000);
    logEvent(s, 'катался с горки', 4000);
    expect(s.journal.map((e) => `${e.text}×${e.n}`)).toEqual(['катался с горки×2', 'прыгал на батуте×1', 'катался с горки×1']);
    // через 10 минут — уже новое событие
    logEvent(s, 'катался с горки', 4000 + 11 * 60_000);
    expect(s.journal.at(-1)!.n).toBe(1);
    for (let i = 0; i < 40; i++) logEvent(s, `событие ${i}`, 10 ** 7 + i);
    expect(s.journal).toHaveLength(JOURNAL_MAX);
    expect(s.journal.at(-1)!.text).toBe('событие 39');
  });

  it('журнал переживает перезапуск, битые записи отбрасываются', () => {
    const now = 10 ** 9;
    const s = sanitize({ journal: [{ at: now - 60_000, text: 'летал на облачке', n: 2 }, { at: 5 }, 'мусор', { text: 'x'.repeat(300), at: now + 10 ** 9 }] }, now);
    expect(s.journal).toEqual([
      { at: now - 60_000, text: 'летал на облачке', n: 2 },
      { at: now, text: 'x'.repeat(120), n: 1 },
    ]);
    expect(sanitize({}, now).journal).toEqual([]);
  });

  it('выгрузка для разбора: история с пометками, тетрадка, журнал', () => {
    const s = defaultSave(0);
    s.talk.history = [
      { at: 0, role: 'event', text: '[Событие: начало разговора]' },
      { at: 0, role: 'kira', text: 'покатайся с горки пожалуйста' },
      { at: 0, role: 'pushok', text: 'Ура, качусь!', tags: '[действие: горка]' },
    ];
    s.talk.notebook = { stories: [{ title: 'Лесная', stoppedAt: 'Тимка у речки', characters: [{ name: 'Тимка' }], events: [{ text: 'Тимка нашел домик' }] }], currentStory: 'Лесная', news: [], notesForParents: [{ date: '2026-01-01', text: 'фея' }] };
    logEvent(s, 'катался с горки', 0);
    const t = exportText(s, '0.15.0', 0);
    expect(t).toContain('Игра: [Событие: начало разговора]');
    expect(t).toContain('Она: покатайся с горки пожалуйста');
    expect(t).toContain('Пушок: [действие: горка] Ура, качусь!');
    expect(t).toContain('- Лесная (герои: Тимка) — остановились: Тимка у речки');
    expect(t).toContain('    · Тимка нашел домик');
    expect(t).toContain('- 2026-01-01: фея');
    expect(t).toContain('катался с горки');
  });

  it('тетрадка: старое сохранение считает всю прошлую историю уже записанной', () => {
    const old = sanitize({ talk: { history: [{ at: 500, role: 'kira', text: 'привет' }, { at: 900, role: 'pushok', text: 'Привет!' }] } }, 1000);
    expect(old.talk.notebookAt).toBe(900);
    expect(sanitize({ talk: { notebookAt: 700, history: [{ at: 900, role: 'kira', text: 'а' }] } }, 1000).talk.notebookAt).toBe(700);
    expect(sanitize({}, 1000).talk.notebookAt).toBe(0);
  });

  it('сводка для Пушка: где стоит, сытость, свежие события сначала', () => {
    const now = 10 ** 9;
    const s = defaultSave(now);
    s.home.pushokAt = 'slide';
    s.coins = 7;
    logEvent(s, 'летал на облачке', now - 30 * 60_000);
    logEvent(s, 'катался с горки', now);
    const g = gameState(s, 'home', now);
    expect(g).toMatchObject({ spot: 'slide', night: false, coins: 7, mood: 'full' });
    expect(g.journal).toEqual([
      { ago: 0, text: 'катался с горки', n: 1 },
      { ago: 30, text: 'летал на облачке', n: 1 },
    ]);
    // не в домике — места у предмета нет
    expect(gameState(s, 'music', now).spot).toBeNull();
  });
});

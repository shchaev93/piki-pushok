import { describe, expect, it } from 'vitest';
import { logEvent } from '../src/game/journal';
import { defaultSave, JOURNAL_MAX, sanitize } from '../src/save/schema';
import { gameState } from '../src/talk/session';

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

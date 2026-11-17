import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, extractJson, normalizeNotebook, pcmPeak, secretaryMessages, talk, updateNotebook, type Deps } from '../src/app.ts';
import { Budget, moscowDate, sttCostRub, ttsCostRub } from '../src/budget.ts';
import { loadConfig } from '../src/config.ts';
import { applyOps, notebookText } from '../src/notebook.ts';
import { cleanForSpeech, extractCues, pushokSystemPrompt } from '../src/prompts.ts';
import { splitForTts } from '../src/speechkit.ts';

// Внешние сервисы подменены: ни один тест не ходит в OpenRouter или SpeechKit и ничего не тратит.

const NOW = Date.UTC(2026, 10, 17, 9, 0);

interface Call {
  url: string;
  body: unknown;
}

function fakeFetch(opts: { heard?: string; reply?: string; cost?: number } = {}) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const raw = init?.body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    calls.push({ url, body });
    if (url.includes('stt:recognize')) return Response.json({ result: opts.heard ?? 'привет пушок' });
    if (url.includes('utteranceSynthesis')) {
      const chunk = (s: string) => JSON.stringify({ result: { audioChunk: { data: Buffer.from(s).toString('base64') } } });
      return new Response(`${chunk('RIFF')}\n${chunk('DATA')}\n`);
    }
    if (url.endsWith('/chat/completions')) {
      return Response.json({
        choices: [{ message: { content: opts.reply ?? 'Привет! Я рад тебя слышать 😊 *машет лапкой*' } }],
        usage: { prompt_tokens: 5000, completion_tokens: 300, cost: opts.cost ?? 0.0012, completion_tokens_details: { reasoning_tokens: 200 } },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

function deps(over: Partial<Parameters<typeof loadConfig>[0]> = {}, fetchOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pushok-'));
  const cfg = loadConfig({
    ACCESS_CODE: 'tsss',
    KID_NAME: 'Тестия',
    OPENROUTER_API_KEY: 'k',
    YANDEX_API_KEY: 'y',
    DATA_DIR: dir,
    SEED_FILE: join(dir, 'seed.json'),
    ...over,
  });
  const { f, calls } = fakeFetch(fetchOpts);
  const d: Deps = { cfg, budget: new Budget(join(dir, 'budget.json'), cfg.limits, () => NOW), fetch: f, now: () => NOW, glossary: 'Мурзилка — герой мультика' };
  return { d, calls };
}

describe('цена и потолок', () => {
  it('тарифы SpeechKit: блоки по 15 с и по 250 знаков', () => {
    expect(sttCostRub(1)).toBeCloseTo(0.1626);
    expect(sttCostRub(16)).toBeCloseTo(0.3252);
    expect(ttsCostRub(250)).toBeCloseTo(0.1626);
    expect(ttsCostRub(251)).toBeCloseTo(0.3252);
  });

  it('потолок на модель и на голос, отдельно; новый день обнуляет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pushok-b-'));
    let now = NOW;
    const b = new Budget(join(dir, 'b.json'), { dailyLlmUsd: 0.3, dailyVoiceRub: 60 }, () => now);
    b.addLlm(0.29);
    expect(b.check()).toEqual({ ok: true });
    b.addLlm(0.02);
    expect(b.check()).toEqual({ ok: false, reason: 'llm' });
    // счетчики переживают перезапуск
    const again = new Budget(join(dir, 'b.json'), { dailyLlmUsd: 0.3, dailyVoiceRub: 60 }, () => now);
    expect(again.check()).toEqual({ ok: false, reason: 'llm' });
    now += 24 * 3600_000;
    expect(again.check()).toEqual({ ok: true });
    again.addVoice(61);
    expect(again.check()).toEqual({ ok: false, reason: 'voice' });
  });

  it('московская дата', () => {
    expect(moscowDate(Date.UTC(2026, 10, 17, 21, 30))).toBe('2026-11-18');
  });
});

describe('запрос к модели', () => {
  it('провайдер закреплен, без перескакивания, размышления на минимуме, без хранения данных', async () => {
    const { d, calls } = deps();
    await talk(d, { text: 'привет', history: [] });
    const llm = calls.find((c) => c.url.endsWith('/chat/completions'))!.body as Record<string, any>;
    expect(llm.model).toBe('z-ai/glm-5.3');
    expect(llm.provider).toEqual({ order: ['wafer/us'], allow_fallbacks: false, zdr: true, data_collection: 'deny' });
    expect(llm.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(llm.max_tokens).toBe(2500);
  });

  it('звук → распознавание → модель → голос; ответ очищен для озвучки; расходы учтены', async () => {
    const { d, calls } = deps({}, { heard: 'расскажи сказку' });
    const pcm = Buffer.alloc(32000 * 3); // 3 секунды
    const r = await talk(d, { audio: pcm.toString('base64'), history: [{ role: 'pushok', text: 'Привет!' }] });
    expect(r.heard).toBe('расскажи сказку');
    expect(r.reply).toBe('Привет! Я рад тебя слышать');
    expect(r.audio).toHaveLength(1);
    expect(Buffer.from(r.audio[0], 'base64').toString()).toBe('RIFFDATA');
    expect(calls.map((c) => c.url.split('?')[0].split('/').pop())).toEqual(['stt:recognize', 'completions', 'utteranceSynthesis']);
    const st = d.budget.status();
    expect(st.llmUsd).toBeCloseTo(0.0012);
    expect(st.voiceRub).toBeCloseTo(0.1626 * 2);
    // история уходит в модель как диалог, начало разговора — системный промпт с именем
    const llm = calls[1].body as { messages: { role: string; content: string }[] };
    expect(llm.messages[0].content).toContain('Тестия');
    expect(llm.messages.at(-2)).toEqual({ role: 'assistant', content: 'Привет!' });
    expect(llm.messages.at(-1)).toEqual({ role: 'user', content: 'расскажи сказку' });
  });

  it('тишина без события: модель не вызывается (бесплатно)', async () => {
    const { d, calls } = deps({}, { heard: '' });
    const r = await talk(d, { audio: Buffer.alloc(32000).toString('base64'), history: [] });
    expect(r.reply).toBe('Я не расслышал. Скажи еще разок?');
    expect(calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(false);
  });

  it('журнал: только числа (длительность, громкость, длины), без слов ребенка', async () => {
    const lines: string[] = [];
    const { d } = deps({}, { heard: 'расскажи сказку' });
    d.log = (l) => lines.push(l);
    const pcm = Buffer.alloc(32000 * 2);
    pcm.writeInt16LE(16384, 100); // пик 0.5
    await talk(d, { audio: pcm.toString('base64'), history: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('звук 2.0 с (пик 0.500)');
    expect(lines[0]).toContain('распознано 15 симв.');
    expect(lines[0]).not.toContain('сказку');
    expect(pcmPeak(Buffer.alloc(3200))).toBe(0);
  });

  it('пометки эмоции и действия: вырезаются из голоса, уходят игре и в историю', () => {
    const c = extractCues('[эмоция: Радость] [действие: горка] Ура, качусь с горки!');
    expect(c).toEqual({
      text: '  Ура, качусь с горки!',
      emotion: 'joy',
      action: 'slide',
      actions: ['slide'],
      cook: null,
      tags: '[эмоция: радость] [действие: горка]',
      unknown: [],
    });
    expect(cleanForSpeech(c.text)).toBe('Ура, качусь с горки!');
    // незнакомые слова — без пометки, но и вслух скобки не звучат
    const u = extractCues('[действие: полет] [эмоция: ярость] Не получится!');
    expect(u.emotion).toBeNull();
    expect(u.action).toBeNull();
    expect(cleanForSpeech(u.text)).toBe('Не получится!');
    expect(cleanForSpeech('[что-то] Привет')).toBe('Привет');
    expect(cleanForSpeech('Я уже схожил! Не грустю.')).toBe('Я уже сходил! Не грущу.');
  });

  it('две просьбы подряд: два действия по порядку, третье не берется; готовка и действие вместе', () => {
    const c = extractCues('[действие: горка] [действие: батут] [действие: лазилка] Сначала с горки, потом на батут!');
    expect(c).toMatchObject({ action: 'slide', actions: ['slide', 'trampoline'], tags: '[действие: горка] [действие: батут]' });
    expect(cleanForSpeech(c.text)).toBe('Сначала с горки, потом на батут!');
    const k = extractCues('[эмоция: радость] [готовить: яблоко, семечки] [действие: кушать] Испеку пирог!');
    expect(k).toMatchObject({ emotion: 'joy', action: 'kitchen', actions: ['kitchen', 'table'], cook: ['apple', 'seeds'] });
    expect(k.tags).toBe('[эмоция: радость] [готовить: яблоко, семечки] [действие: кушать]');
    // из одних продуктов два блюда не варятся
    expect(extractCues('[готовить: сыр, хлебушек] [готовить: яблоко, морковка] Ой').actions).toEqual(['kitchen']);
  });

  it('ответ сервера несет эмоцию и действие; место попадает в промпт', async () => {
    const { d, calls } = deps({}, { reply: '[эмоция: смех] [действие: батут] Прыг-прыг, хи-хи!' });
    const r = await talk(d, { text: 'попрыгай', history: [], place: 'home' });
    expect(r.reply).toBe('Прыг-прыг, хи-хи!');
    expect(r).toMatchObject({ emotion: 'laugh', action: 'trampoline', actions: ['trampoline'], tags: '[эмоция: смех] [действие: батут]' });
    const llm = calls.find((c) => c.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] };
    expect(llm.messages[0].content).toContain('Ты сейчас в домике');
  });

  it('готовка из корзинки: пометка с продуктами, корзинка и блюда — в промпте', async () => {
    const c = extractCues('[готовить: Морковка, сыр] Варю суп!');
    expect(c).toMatchObject({ action: 'kitchen', cook: ['carrot', 'cheese'], tags: '[готовить: морковка, сыр]', unknown: [] });
    expect(extractCues('[готовить: хлебушек и сыр]').cook).toEqual(['bread', 'cheese']);
    // один продукт или незнакомый — не готовка, а «непонятная пометка» для журнала
    expect(extractCues('[готовить: торт] Ой').action).toBeNull();
    expect(extractCues('[готовить: торт] Ой').unknown).toEqual(['[готовить: торт]']);
    expect(extractCues('[действие: полетать] Нет').unknown).toEqual(['[действие: полетать]']);

    const { d, calls } = deps({}, { reply: '[готовить: морковка, морковка] Варю!' });
    const r = await talk(d, { text: 'приготовь', history: [], place: 'home', basket: { carrot: 2, cheese: 0, cake: 5 }, dishes: ['pie', 'soup', 'pie'] });
    expect(r).toMatchObject({ action: 'kitchen', cook: ['carrot', 'carrot'], reply: 'Варю!' });
    const sys = (calls.find((x) => x.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] }).messages[0].content;
    expect(sys).toContain('КОРЗИНКА (продукты для готовки прямо сейчас): морковка 2\n');
    expect(sys).toContain('ГОТОВЫЕ БЛЮДА на столике: пирог 2, суп-сюрприз 1');
    expect(sys).toContain('ЧТО ТЫ УМЕЕШЬ');
    expect(sys).toContain('ВЕЖЛИВОСТЬ');
  });

  it('Пушок знает, что сейчас в игре: где стоит, что надето, день или ночь, недавние события', async () => {
    const { d, calls } = deps();
    await talk(d, {
      text: 'а что ты делал?',
      history: [],
      place: 'home',
      outfit: 'корона, розовая гитара',
      game: {
        spot: 'slide', night: true, sleeping: false, mood: 'hungry', coins: 12, butterflies: 34, stars: 5,
        journal: [
          { ago: 0, text: 'катался с горки', n: 3 },
          { ago: 25, text: 'летал на облачке: поймал бабочек: 7 (это 7 денежек)', n: 1 },
          { ago: 2000, text: 'спал в кроватке', n: 1 },
          { ago: 5000, text: 'x'.repeat(500), n: 1 },
        ],
        extra: 'лишнее поле',
      },
    });
    const sys = (calls.find((x) => x.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] }).messages[0].content;
    expect(sys).toContain('- Ты сейчас в домике, стоишь у горки.');
    expect(sys).toContain('- На тебе: корона, розовая гитара.');
    expect(sys).toContain('- Сейчас ночь, в окне месяц.');
    expect(sys).toContain('- Сытость: ты проголодался.');
    expect(sys).toContain('Денежек: 12. Бабочек поймано за все время: 34. Звездочек на доске за занятия: 5.');
    expect(sys).toContain('- только что: катался с горки (3 раза)');
    expect(sys).toContain('- 25 мин назад: летал на облачке: поймал бабочек: 7');
    expect(sys).toContain('- вчера: спал в кроватке');
    expect(sys).toContain(`- давно: ${'x'.repeat(120)}\n`);
    expect(sys).not.toContain('лишнее поле');
    // без сводки (старая версия игры) промпт тоже собирается
    const music = pushokSystemPrompt({ kidName: 'Тестия', notebook: { stories: [], currentStory: null, news: [], notesForParents: [] }, outfit: '', today: '2026-01-01', glossary: '', place: 'music' });
    expect(music).toContain('- Ты сейчас в музыкальной комнате');
    expect(music).toContain('- На тебе: ничего не надето.');
    expect(extractCues('[действие: песня] Ля-ля!').action).toBe('sing');
  });

  it('тишина в режиме «слушает сам»: ни модели, ни голоса — Пушок молча слушает дальше', async () => {
    const { d, calls } = deps({}, { heard: '' });
    const r = await talk(d, { audio: Buffer.alloc(32000).toString('base64'), history: [], quiet: true });
    expect(r.reply).toBe('');
    expect(r.audio).toEqual([]);
    expect(calls.map((c) => c.url.split('?')[0].split('/').pop())).toEqual(['stt:recognize']);
  });

  it('событие игры уходит модели в квадратных скобках', async () => {
    const { d, calls } = deps();
    await talk(d, { event: 'start', history: [] });
    const llm = calls.find((c) => c.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] };
    expect(llm.messages.at(-1)!.content).toBe('[Событие: начало разговора]');
  });
});

describe('тетрадка: отдельные записи и правки секретаря', () => {
  const base = () =>
    normalizeNotebook({
      stories: [
        {
          title: 'Лесная',
          characters: [{ name: 'Тимка', about: 'котик' }],
          rules: ['котик не летает'],
          events: [{ date: '2026-11-16', text: 'Тимка нашел домик' }],
          stoppedAt: 'у речки',
          updatedAt: '2026-11-16',
        },
      ],
      currentStory: 'Лесная',
      news: [
        { date: '2026-11-16', text: 'слепила котика' },
        { date: '2026-11-16', text: 'у папы музыкальная комната' },
      ],
      notesForParents: [{ date: '2026-11-16', text: 'наушники с ушками' }],
    });

  it('секретарь присылает правки: новый герой, событие, записка, новая сказка', async () => {
    const ops = {
      ops: [
        { op: 'hero', story: 's1', name: 'Звездочка', about: 'котенок с неба' },
        { op: 'event', story: 's1', text: 'Тимка встретил Звездочку' },
        { op: 'stopped', story: 's1', text: 'куда пойдут дальше?' },
        { op: 'note', text: 'кукла с розовыми волосами' },
        { op: 'event', story: 'Феечка в желуде', text: 'феечка живет в желуде' },
      ],
    };
    const { d, calls } = deps({}, { reply: `Вот: ${JSON.stringify(ops)}` });
    const lines: string[] = [];
    d.log = (l) => lines.push(l);
    const r = await updateNotebook(d, { notebook: base(), history: [{ role: 'kira', text: 'запиши куклу' }] });
    expect(r.changed).toBe(true);
    const nb = r.notebook;
    expect(nb.stories[0].characters.map((c) => c.name)).toEqual(['Тимка', 'Звездочка']);
    expect(nb.stories[0].events.map((e) => e.text)).toEqual(['Тимка нашел домик', 'Тимка встретил Звездочку']);
    expect(nb.stories[0].events[1].date).toBe('2026-11-17');
    expect(nb.stories[0].stoppedAt).toBe('куда пойдут дальше?');
    expect(nb.stories[0].updatedAt).toBe('2026-11-17');
    expect(nb.notesForParents.map((n) => n.text)).toEqual(['наушники с ушками', 'кукла с розовыми волосами']);
    // новая сказка появилась сама и стала текущей
    expect(nb.stories[1]).toMatchObject({ title: 'Феечка в желуде', events: [{ text: 'феечка живет в желуде' }] });
    expect(nb.currentStory).toBe('Феечка в желуде');
    // секретарь видит записи с номерами
    const sent = (calls.find((c) => c.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] }).messages[1].content;
    expect(sent).toContain('s1h1 Тимка — котик');
    expect(sent).toContain('s1e1 Тимка нашел домик');
    expect(sent).toContain('n2 (2026-11-16) у папы музыкальная комната');
    expect(sent).toContain('p1 (2026-11-16) наушники с ушками');
    expect(lines[0]).toMatch(/правок 5, пропущено 0/);
    expect(lines[0]).not.toContain('куклу');
  });

  it('номера — по тетрадке до правок; исправить, убрать; сказку целиком убрать нельзя', () => {
    const r = applyOps(
      base(),
      [
        { op: 'remove', id: 'n2' }, // событие игры попало в новости
        { op: 'fix', id: 'n1', text: 'слепила котика из пластилина' },
        { op: 'news', text: 'нарисовала закат' },
        { op: 'fix', id: 's1h1', name: 'Тинка' }, // поправила имя
        { op: 'fix', id: 's1r1', text: 'котик не летает, а ходит' },
        { op: 'remove', id: 's1' },
        { op: 'remove', id: 'n9' },
        { op: 'news', text: 'Слепила котика из пластилина!' }, // уже есть
        { op: 'полетели' },
      ],
      '2026-11-17',
    );
    expect(r.notebook.news.map((n) => n.text)).toEqual(['слепила котика из пластилина', 'нарисовала закат']);
    expect(r.notebook.stories).toHaveLength(1);
    expect(r.notebook.stories[0].characters[0]).toEqual({ name: 'Тинка', about: 'котик' });
    expect(r.notebook.stories[0].rules).toEqual(['котик не летает, а ходит']);
    expect(r).toMatchObject({ applied: 5, skipped: 4 });
  });

  it('за раз убирается не больше пяти записей', () => {
    const nb = normalizeNotebook({ notesForParents: Array.from({ length: 8 }, (_, i) => ({ date: 'd', text: `пункт ${i}` })) });
    const r = applyOps(nb, Array.from({ length: 8 }, (_, i) => ({ op: 'remove', id: `p${i + 1}` })), '2026-11-17');
    expect(r.notebook.notesForParents).toHaveLength(3);
  });

  it('ответ не в виде правок (вся тетрадка целиком) — тетрадка как была', async () => {
    const { d } = deps({}, { reply: JSON.stringify({ stories: [], notesForParents: [] }) });
    const r = await updateNotebook(d, { notebook: base(), history: [{ role: 'kira', text: 'а' }] });
    expect(r.changed).toBe(false);
    expect(r.notebook.stories).toHaveLength(1);
    expect(r.notebook.notesForParents).toHaveLength(1);
    const bad = await updateNotebook(deps({}, { reply: 'не знаю' }).d, { notebook: base(), history: [{ role: 'kira', text: 'а' }] });
    expect(bad).toMatchObject({ changed: false, error: 'не удалось разобрать ответ' });
  });

  it('старые реплики отдельно от новых: секретарь пишет только новое', () => {
    const h = [
      { role: 'kira' as const, text: 'старое' },
      { role: 'pushok' as const, text: 'ответ' },
      { role: 'kira' as const, text: 'новое' },
    ];
    const m = secretaryMessages('Тестия', base(), h, 1, '2026-11-17')[1].content;
    expect(m).toContain('ПРЕДЫДУЩИЕ РЕПЛИКИ (уже учтены):\nДевочка: старое\nПушок: ответ\n\nНОВЫЕ РЕПЛИКИ:\nДевочка: новое');
    expect(secretaryMessages('Тестия', base(), h, undefined, 'x')[1].content).not.toContain('ПРЕДЫДУЩИЕ');
  });

  it('старая тетрадка (пересказ одним куском) делится на отдельные события', () => {
    const summary = 'Тата превратилась в леопарда. Бабушка Руми испугалась! Потом все помирились и пили чай. ' + 'Был большой бал в Облачном замке. '.repeat(8);
    const n = normalizeNotebook({ stories: [{ title: 'Тата', summary, updatedAt: '2026-11-15' }], currentStory: 'тата' });
    expect(n.stories[0].events.length).toBeGreaterThan(1);
    for (const e of n.stories[0].events) expect(e.text.length).toBeLessThanOrEqual(200);
    expect(n.stories[0].events[0]).toMatchObject({ date: '2026-11-15', text: expect.stringMatching(/^Тата превратилась в леопарда\. Бабушка Руми испугалась!/) });
    expect(n.currentStory).toBe('Тата');
  });

  it('событий слишком много: начало сказки и свежее остаются', () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ date: 'd', text: `событие ${i + 1}` }));
    const e = normalizeNotebook({ stories: [{ title: 'Т', events }] }).stories[0].events.map((x) => x.text);
    expect(e).toHaveLength(30);
    expect(e.slice(0, 5)).toEqual(['событие 1', 'событие 2', 'событие 3', 'событие 4', 'событие 15']);
    expect(e.at(-1)).toBe('событие 40');
  });

  it('Пушку тетрадка приходит простым текстом: текущая сказка целиком, другие коротко', () => {
    const nb = base();
    nb.stories.push({
      title: 'Морская',
      characters: [],
      rules: [],
      events: ['а', 'б', 'в', 'г', 'д', 'е'].map((t) => ({ date: '', text: `было ${t}` })),
      stoppedAt: 'кит',
      updatedAt: '',
    });
    nb.notesForParents = Array.from({ length: 15 }, (_, i) => ({ date: 'd', text: `записка ${i + 1}` }));
    const t = notebookText(nb, 'Тестия');
    expect(t).toContain('Сейчас сочиняем сказку «Лесная».');
    expect(t).toContain('Герои: Тимка — котик.');
    expect(t).toContain('- Тимка нашел домик');
    expect(t).toContain('Остановились: у речки');
    expect(t).toContain('- было а\n- было г\n- было д\n- было е');
    expect(t).not.toContain('было б');
    expect(t).toContain('НОВОСТИ ИЗ ЖИЗНИ ТЕСТИЯ');
    expect(t).toContain('записка 15');
    expect(t).not.toContain('записка 5\n');
    const p = pushokSystemPrompt({ kidName: 'Тестия', notebook: nb, outfit: '', today: 'x', glossary: '' });
    expect(p).toContain('СКАЗКА «Лесная»');
    expect(p).not.toContain('"stories"');
  });

  it('мусор и лишний размер обрезаются', () => {
    const n = normalizeNotebook({ stories: [{ title: 'x'.repeat(500), characters: 'нет' }], news: new Array(40).fill({ date: 'd', text: 't' }) });
    expect(n.stories[0].title).toHaveLength(60);
    expect(n.stories[0].characters).toEqual([]);
    expect(n.news).toHaveLength(15);
    expect(() => extractJson('без json')).toThrow();
  });
});

describe('промпт и текст для голоса', () => {
  it('имя из настроек, правила про эхо, «подожди», поправки, прощание', () => {
    const p = pushokSystemPrompt({ kidName: 'Тестия', notebook: normalizeNotebook({}), outfit: 'корона', today: '2026-11-17', glossary: 'Мурзилка — герой мультика' });
    expect(p).toContain('СЛОВАРИК ЕЕ МИРА');
    expect(p).toContain('Мурзилка');
    expect(pushokSystemPrompt({ kidName: 'Т', notebook: normalizeNotebook({}), outfit: '', today: 'x', glossary: '' })).not.toContain('СЛОВАРИК');
    expect(p).toContain('Тестия');
    expect(p).toContain('Жду!');
    expect(p).toContain('эхо');
    expect(p).toContain('Ее версия всегда верная');
    expect(p).toContain('Сам разговор не заканчивай');
    expect(p).toContain('корона');
  });

  it('из ответа убираются эмодзи, ремарки и разметка', () => {
    expect(cleanForSpeech('**Ура!** 🎉 *прыгает* Привет')).toBe('Ура! Привет');
    expect(cleanForSpeech('<think>хм</think>Да')).toBe('Да');
  });

  it('длинный ответ режется на куски до 250 знаков по предложениям', () => {
    const text = 'Жила-была фея Лиля. '.repeat(30);
    const parts = splitForTts(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(250);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.trim());
  });
});

describe('HTTP', () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  async function start(d: Deps) {
    server = createServer(createHandler(d));
    await new Promise<void>((r) => server!.listen(0, r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('без кода — 401; CORS только для сайта игры', async () => {
    const { d } = deps();
    const base = await start(d);
    const bad = await fetch(`${base}/talk`, { method: 'POST', body: '{}' });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${base}/health`, { headers: { 'x-access-code': 'tsss', origin: 'https://shchaev93.github.io' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://shchaev93.github.io');
    const evil = await fetch(`${base}/health`, { headers: { 'x-access-code': 'tsss', origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('потолок исчерпан — 429 budget, внешние сервисы не вызываются', async () => {
    const { d, calls } = deps();
    d.budget.addLlm(1);
    const base = await start(d);
    const r = await fetch(`${base}/talk`, { method: 'POST', headers: { 'x-access-code': 'tsss' }, body: JSON.stringify({ text: 'привет' }) });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'budget', reason: 'llm' });
    expect(calls).toHaveLength(0);
  });
});

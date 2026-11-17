import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, extractJson, normalizeNotebook, talk, updateNotebook, type Deps } from '../src/app.ts';
import { Budget, moscowDate, sttCostRub, ttsCostRub } from '../src/budget.ts';
import { loadConfig } from '../src/config.ts';
import { cleanForSpeech, pushokSystemPrompt } from '../src/prompts.ts';
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

  it('событие игры уходит модели в квадратных скобках', async () => {
    const { d, calls } = deps();
    await talk(d, { event: 'start', history: [] });
    const llm = calls.find((c) => c.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] };
    expect(llm.messages.at(-1)!.content).toBe('[Событие: начало разговора]');
  });
});

describe('тетрадка', () => {
  it('секретарь: JSON вытаскивается из ответа, тетрадка нормализуется', async () => {
    const nb = { stories: [], currentStory: null, news: [], notesForParents: [] };
    const updated = { stories: [{ title: 'Лесная', characters: [{ name: 'Тимка', about: 'котик, ходит' }], rules: ['не летает'], summary: 's', stoppedAt: 'x', updatedAt: '2026-11-17' }], currentStory: 'Лесная', news: [], notesForParents: [{ date: '2026-11-17', text: 'фея на батарейках' }] };
    const { d } = deps({}, { reply: `Вот тетрадка: ${JSON.stringify(updated)} готово` });
    const r = await updateNotebook(d, { notebook: nb, history: [{ role: 'kira', text: 'запиши фею' }] });
    expect(r.changed).toBe(true);
    expect(r.notebook.stories[0].characters[0].name).toBe('Тимка');
    expect(r.notebook.notesForParents).toHaveLength(1);
  });

  it('секретарь не может потерять сказки или записки', async () => {
    const nb = normalizeNotebook({ stories: [{ title: 'Лесная' }, { title: 'Морская' }], notesForParents: [{ date: 'd', text: 'x' }] });
    const { d } = deps({}, { reply: JSON.stringify({ stories: [{ title: 'Лесная' }], notesForParents: [] }) });
    const r = await updateNotebook(d, { notebook: nb, history: [{ role: 'kira', text: 'а' }] });
    expect(r.changed).toBe(false);
    expect(r.notebook.stories).toHaveLength(2);
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

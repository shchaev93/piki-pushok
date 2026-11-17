import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Budget, moscowDate, sttCostRub, ttsCostRub } from './budget.ts';
import type { Config } from './config.ts';
import { chat, type ChatMessage } from './openrouter.ts';
import {
  cleanForSpeech,
  emptyNotebook,
  extractCues,
  pushokSystemPrompt,
  secretarySystemPrompt,
  type Action,
  type Emotion,
  type GameState,
  type Notebook,
} from './prompts.ts';
import { pcmSeconds, recognize, splitForTts, synthesize } from './speechkit.ts';

// HTTP-сервер Пушка. Хранит только счетчики расходов; разговоры и тетрадка живут на телефоне.

export type Turn = { role: 'kira' | 'pushok' | 'event'; text: string };
export type GameEvent = 'start' | 'warn' | 'end';

const EVENT_TEXT: Record<GameEvent, string> = {
  start: '[Событие: начало разговора]',
  warn: '[Событие: осталось 3 минуты]',
  end: '[Событие: время вышло]',
};

/** Сколько последних реплик отправлять модели. */
const HISTORY_TURNS = 24;
const MAX_AUDIO_BYTES = 960_000; // 30 с PCM 16 кГц
const NOT_HEARD = 'Я не расслышал. Скажи еще разок?';
const FALLBACK = 'Ой, я задумался! Повтори, пожалуйста?';

export interface Deps {
  cfg: Config;
  budget: Budget;
  fetch: typeof fetch;
  now: () => number;
  /** Словарик мира ребенка из data/glossary.txt (может быть пустым). */
  glossary: string;
  /** Журнал работы: только числа и длительности, без слов ребенка. */
  log?: (line: string) => void;
}

export function readGlossary(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Журнал работы: в консоль контейнера и в файл data/talk-log.txt (переживает обновления сервера).
 * Только числа и служебные пометки, без слов ребенка. Файл больше 2 МБ уходит в .1.
 */
export function fileLog(file: string) {
  return (line: string) => {
    const l = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${line}`;
    console.log(l);
    try {
      if (existsSync(file) && statSync(file).size > 2_000_000) renameSync(file, `${file}.1`);
      appendFileSync(file, `${l}\n`);
    } catch {
      /* журнал не должен ломать разговор */
    }
  };
}

export function createDeps(cfg: Config): Deps {
  return {
    cfg,
    budget: new Budget(join(cfg.dataDir, 'budget.json'), cfg.limits),
    fetch,
    now: Date.now,
    glossary: readGlossary(cfg.glossaryFile),
    log: fileLog(join(cfg.dataDir, 'talk-log.txt')),
  };
}

// ---------- проверка тетрадки ----------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Привести тетрадку любой формы к ожидаемой и ограничить размер (она едет в каждый запрос). */
export function normalizeNotebook(v: unknown): Notebook {
  const n = obj(v);
  const dated = (x: unknown) => ({ date: str(obj(x).date, 10), text: str(obj(x).text, 300) });
  return {
    stories: arr(n.stories)
      .slice(0, 10)
      .map((s) => {
        const o = obj(s);
        return {
          title: str(o.title, 60),
          characters: arr(o.characters)
            .slice(0, 20)
            .map((c) => ({ name: str(obj(c).name, 40), about: str(obj(c).about, 200) }))
            .filter((c) => c.name),
          rules: arr(o.rules).slice(0, 10).map((r) => str(r, 150)).filter(Boolean),
          summary: str(o.summary, 900),
          stoppedAt: str(o.stoppedAt, 300),
          updatedAt: str(o.updatedAt, 10),
        };
      })
      .filter((s) => s.title),
    currentStory: typeof n.currentStory === 'string' ? n.currentStory.slice(0, 60) : null,
    news: arr(n.news).map(dated).filter((x) => x.text).slice(-15),
    notesForParents: arr(n.notesForParents).map(dated).filter((x) => x.text).slice(-100),
  };
}

function historyMessages(history: Turn[]): ChatMessage[] {
  return history.slice(-HISTORY_TURNS).map((t) =>
    t.role === 'pushok'
      ? { role: 'assistant', content: t.text }
      : { role: 'user', content: t.role === 'event' ? t.text : t.text || '(тишина)' },
  );
}

/** Вытащить JSON из ответа модели (иногда она оборачивает его в текст). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('нет JSON');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- обработчики ----------

interface TalkBody {
  audio?: string;
  text?: string;
  event?: GameEvent;
  history?: Turn[];
  notebook?: unknown;
  outfit?: string;
  /** Где Пушок в игре: 'talk' (комната разговора) или 'home' (домик). */
  place?: string;
  /** Фраза поймана по громкости: если слов не распознано, молча слушать дальше (без голоса и без затрат на него). */
  quiet?: boolean;
  /** Корзинка игры: { carrot: 2, cheese: 1 } — из чего Пушок может готовить. */
  basket?: unknown;
  /** Готовые блюда на столике: ['soup', 'pie']. */
  dishes?: unknown;
  /** Что сейчас в игре (где стоит, день/ночь, сытость, недавние события). */
  game?: unknown;
}

/** Сводка игры из запроса: только известные поля, короткие строки, не больше 10 событий. */
export function gameOf(v: unknown): GameState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const g = v as Record<string, unknown>;
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(1e6, Math.floor(Number(x)))) : 0);
  return {
    spot: typeof g.spot === 'string' ? g.spot.slice(0, 20) : null,
    night: g.night === true,
    sleeping: g.sleeping === true,
    mood: g.mood === 'hungry' || g.mood === 'veryHungry' ? g.mood : 'full',
    coins: n(g.coins),
    butterflies: n(g.butterflies),
    stars: n(g.stars),
    journal: arr(g.journal)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { text?: unknown }).text === 'string')
      .slice(0, 10)
      .map((e) => ({ ago: n(e.ago), text: (e.text as string).replace(/\s+/g, ' ').slice(0, 120), n: Math.max(1, n(e.n)) })),
  };
}

/** Корзинка из запроса: только известные продукты и целые количества 0..99. */
function basketOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const id of ['seeds', 'apple', 'carrot', 'cheese', 'bread']) {
    const n = Number((v as Record<string, unknown>)[id]);
    if (Number.isFinite(n) && n > 0) out[id] = Math.min(99, Math.floor(n));
  }
  return out;
}

export async function talk(d: Deps, body: TalkBody) {
  const { cfg, budget } = d;
  const notebook = normalizeNotebook(body.notebook ?? emptyNotebook());
  const history = arr(body.history).filter((t): t is Turn => !!t && typeof (t as Turn).text === 'string') as Turn[];

  const t0 = Date.now();
  // 1. что сказала (распознаем, если пришел звук)
  let heard = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
  let audioSec = 0;
  let peak = 0;
  if (body.audio) {
    const pcm = Buffer.from(body.audio, 'base64');
    if (pcm.length > MAX_AUDIO_BYTES) throw new HttpError(413, 'audio too long');
    audioSec = pcmSeconds(pcm.length);
    peak = pcmPeak(pcm);
    budget.addVoice(sttCostRub(audioSec));
    heard = pcm.length > 3200 ? await recognize(cfg.yandex, pcm, d.fetch) : '';
  }
  const t1 = Date.now();

  // 2. ответ Пушка (пустое без события — без модели, это бесплатно)
  let reply: string;
  let costUsd = 0;
  let usage = { prompt: 0, completion: 0, reasoning: 0 };
  let cues: { emotion: Emotion | null; action: Action | null; cook: string[] | null; tags: string } = {
    emotion: null,
    action: null,
    cook: null,
    tags: '',
  };
  let unknownTags: string[] = [];
  if (!heard && !body.event && body.quiet) {
    // шум без слов в режиме «слушает сам»: Пушок молчит и слушает дальше
    budget.countRequest();
    d.log?.(
      `talk тишина: звук ${audioSec.toFixed(1)} с (пик ${peak.toFixed(3)}), слов нет; распознавание ${t1 - t0} мс; ` +
        `голос ${sttCostRub(audioSec).toFixed(2)} ₽`,
    );
    return { heard: '', reply: '', audio: [] as string[], costUsd: 0, usage, ...cues };
  }
  if (!heard && !body.event) {
    reply = NOT_HEARD;
  } else {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: pushokSystemPrompt({
          kidName: cfg.kidName,
          notebook,
          outfit: str(body.outfit, 120),
          today: moscowDate(d.now()),
          glossary: d.glossary,
          place: body.place === 'home' || body.place === 'music' ? body.place : 'talk',
          game: gameOf(body.game),
          basket: basketOf(body.basket),
          dishes: arr(body.dishes).filter((x): x is string => typeof x === 'string').slice(0, 20),
        }),
      },
      ...historyMessages(history),
    ];
    const current = [body.event ? EVENT_TEXT[body.event] : '', heard].filter(Boolean).join('\n');
    messages.push({ role: 'user', content: current });
    const r = await chat(cfg.openrouter, messages, cfg.openrouter.maxTokens, d.fetch);
    budget.addLlm(r.costUsd);
    costUsd = r.costUsd;
    usage = r.usage;
    const c = extractCues(r.text);
    cues = { emotion: c.emotion, action: c.action, cook: c.cook, tags: c.tags };
    unknownTags = c.unknown;
    reply = cleanForSpeech(c.text) || FALLBACK;
  }
  const t2 = Date.now();

  // 3. голос
  const ttsRub = splitForTts(reply).reduce((sum, part) => sum + ttsCostRub(part.length), 0);
  budget.addVoice(ttsRub);
  const audio = (await synthesize(cfg.yandex, reply, d.fetch)).map((b) => Buffer.from(b).toString('base64'));
  budget.countRequest();
  d.log?.(
    `talk ${body.event ?? '-'}: звук ${audioSec.toFixed(1)} с (пик ${peak.toFixed(3)}), распознано ${heard.length} симв., ` +
      `ответ ${reply.length} симв.${cues.tags ? ` ${cues.emotion ?? '-'}/${cues.action ?? '-'}${cues.cook ? `(${cues.cook.join('+')})` : ''}` : ''}` +
      `${unknownTags.length ? ` непонятные пометки ${unknownTags.join(' ')}` : ''}; ` +
      `распознавание ${t1 - t0} мс, модель ${t2 - t1} мс, голос ${Date.now() - t2} мс; ` +
      `${body.place ?? '-'}, история ${history.length}, вход ${usage.prompt} ток.; ` +
      `$${costUsd.toFixed(5)} + ${(sttCostRub(audioSec) + ttsRub).toFixed(2)} ₽`,
  );
  return { heard, reply, audio, costUsd, usage, ...cues };
}

/** Самая громкая точка записи 0..1 (тишина от сломанного микрофона дает 0). */
export function pcmPeak(pcm: Buffer): number {
  let max = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
  return max / 32768;
}

interface NotebookBody {
  notebook?: unknown;
  history?: Turn[];
}

export async function updateNotebook(d: Deps, body: NotebookBody) {
  const notebook = normalizeNotebook(body.notebook ?? emptyNotebook());
  const history = arr(body.history).filter((t): t is Turn => !!t && typeof (t as Turn).text === 'string') as Turn[];
  if (!history.length) return { notebook, changed: false, costUsd: 0 };
  const transcript = history
    .slice(-40)
    .map((t) => `${t.role === 'kira' ? 'Девочка' : t.role === 'pushok' ? 'Пушок' : 'Игра'}: ${t.text}`)
    .join('\n');
  const r = await chat(
    d.cfg.openrouter,
    [
      { role: 'system', content: secretarySystemPrompt(d.cfg.kidName) },
      {
        role: 'user',
        content: `Сегодня ${moscowDate(d.now())}.\n\nТЕКУЩАЯ ТЕТРАДКА:\n${JSON.stringify(notebook)}\n\nСВЕЖИЙ КУСОК РАЗГОВОРА:\n${transcript}`,
      },
    ],
    d.cfg.openrouter.secretaryMaxTokens,
    d.fetch,
  );
  d.budget.addLlm(r.costUsd);
  d.log?.(`тетрадка: кусок ${history.length} реплик, вход ${r.usage.prompt} ток., выход ${r.usage.completion}; $${r.costUsd.toFixed(5)}`);
  try {
    const updated = normalizeNotebook(extractJson(r.text));
    // защита: секретарь не должен терять сказки и записки целиком
    if (updated.stories.length < notebook.stories.length || updated.notesForParents.length < notebook.notesForParents.length) {
      return { notebook, changed: false, costUsd: r.costUsd, error: 'секретарь потерял записи' };
    }
    return { notebook: updated, changed: true, costUsd: r.costUsd };
  } catch {
    return { notebook, changed: false, costUsd: r.costUsd, error: 'не удалось разобрать ответ' };
  }
}

export function seed(d: Deps) {
  try {
    return { notebook: normalizeNotebook(JSON.parse(readFileSync(d.cfg.seedFile, 'utf8'))) };
  } catch {
    return { notebook: emptyNotebook() };
  }
}

// ---------- HTTP ----------

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const hits = new Map<string, number[]>();

function rateLimited(ip: string, perMinute: number, now: number) {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > perMinute;
}

async function readBody(req: IncomingMessage, limit = 2_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export function createHandler(d: Deps) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin ?? '';
    const send = (status: number, data: unknown) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (d.cfg.allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': d.cfg.allowedOrigins.includes(origin) ? origin : 'null',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/health' && req.method === 'GET' && !req.headers['x-access-code']) {
        send(200, { ok: true });
        return;
      }
      if (!d.cfg.accessCode || req.headers['x-access-code'] !== d.cfg.accessCode) throw new HttpError(401, 'нужен код доступа');
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
      if (rateLimited(ip, d.cfg.limits.requestsPerMinute, d.now())) throw new HttpError(429, 'слишком часто');

      if (url.pathname === '/health' && req.method === 'GET') {
        send(200, { ok: true, budget: d.budget.status(), model: d.cfg.openrouter.model, provider: d.cfg.openrouter.provider });
        return;
      }
      if (url.pathname === '/seed' && req.method === 'GET') {
        send(200, seed(d));
        return;
      }
      if (req.method !== 'POST') throw new HttpError(404, 'нет такого адреса');
      const b = d.budget.check();
      if (!b.ok) {
        send(429, { error: 'budget', reason: b.reason });
        return;
      }
      const body = (await readBody(req)) as Record<string, unknown>;
      if (url.pathname === '/talk') send(200, await talk(d, body as TalkBody));
      else if (url.pathname === '/notebook') send(200, await updateNotebook(d, body as NotebookBody));
      else throw new HttpError(404, 'нет такого адреса');
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message });
      else {
        console.error(new Date().toISOString(), (e as Error).message);
        send(502, { error: 'upstream' });
      }
    }
  };
}

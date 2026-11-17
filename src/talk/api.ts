import type { FoodId } from '../config';
import type { TalkTurn } from '../save/schema';

// Связь с сервером Пушка. Адрес и код доступа вводят родители в панели взрослых.

export type TalkEvent = 'start' | 'warn' | 'end';
/** Эмоции Пушка: модель ставит пометку, игра показывает. */
export type Emotion = 'joy' | 'laugh' | 'surprise' | 'sad' | 'think' | 'love' | 'sleepy';
/** Действия в домике по просьбе ребенка. */
export type Action = 'slide' | 'trampoline' | 'climber' | 'rope' | 'bath' | 'toilet' | 'table' | 'kitchen' | 'guitar';
/** Где сейчас Пушок: от этого зависит, что он может сделать. */
export type Place = 'talk' | 'home';

export interface TalkReply {
  heard: string;
  /** Пустой ответ: фраза оказалась шумом, Пушок молча слушает дальше. */
  reply: string;
  audio: string[];
  emotion?: Emotion | null;
  action?: Action | null;
  /** Продукты для настоящей готовки (при action = 'kitchen'). */
  cook?: FoodId[] | null;
  /** Пометки в виде текста — для истории (модель видит, что показывала). */
  tags?: string;
}

export class TalkError extends Error {
  readonly kind: 'config' | 'auth' | 'budget' | 'network' | 'server';
  constructor(kind: TalkError['kind'], message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

export interface ServerConf {
  serverUrl: string;
  code: string;
}

async function call<T>(conf: ServerConf, path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  if (!conf.serverUrl || !conf.code) throw new TalkError('config');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${conf.serverUrl.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Access-Code': conf.code, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new TalkError('network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new TalkError('auth');
  if (res.status === 429) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new TalkError(data.error === 'budget' ? 'budget' : 'server');
  }
  if (!res.ok) throw new TalkError('server', `HTTP ${res.status}`);
  return (await res.json()) as T;
}

const toServer = (h: TalkTurn[]) => h.map(({ role, text, tags }) => ({ role, text: tags ? `${tags} ${text}` : text }));

export const api = {
  talk: (
    c: ServerConf,
    req: { audio?: string; event?: TalkEvent; history: TalkTurn[]; notebook: unknown; outfit: string; place: Place; quiet?: boolean; basket: Partial<Record<FoodId, number>>; dishes: string[] },
  ) => call<TalkReply>(c, '/talk', { ...req, history: toServer(req.history.slice(-24)) }),
  notebook: (c: ServerConf, notebook: unknown, history: TalkTurn[]) =>
    call<{ notebook: unknown; changed: boolean }>(c, '/notebook', { notebook, history: history.map(({ role, text }) => ({ role, text })) }, 60000),
  seed: (c: ServerConf) => call<{ notebook: unknown }>(c, '/seed'),
  health: (c: ServerConf) =>
    call<{ ok: boolean; model?: string; provider?: string; budget?: { llmUsd: number; voiceRub: number; limits: { dailyLlmUsd: number; dailyVoiceRub: number } } }>(
      c,
      '/health',
    ),
};

import type { Config } from './config.ts';

// Запрос к модели через OpenRouter. Провайдер закреплен (allow_fallbacks: false),
// поэтому цена всегда по прайсу выбранного провайдера. Стоимость берется из usage.cost.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  costUsd: number;
  usage: { prompt: number; completion: number; reasoning: number };
}

export class LlmError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function chat(
  cfg: Config['openrouter'],
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResult> {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: maxTokens,
      // у GLM 5.3 «размышления» обязательны и по умолчанию на максимуме — держим минимум
      reasoning: { effort: cfg.reasoningEffort, exclude: true },
      provider: { order: [cfg.provider], allow_fallbacks: false, zdr: true, data_collection: 'deny' },
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new LlmError(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const u = data.usage ?? {};
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    costUsd: typeof u.cost === 'number' ? u.cost : 0,
    usage: {
      prompt: u.prompt_tokens ?? 0,
      completion: u.completion_tokens ?? 0,
      reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

// Настройки сервера Пушка. Все берется из переменных окружения (файл .env на сервере),
// в коде нет ни ключей, ни имени ребенка.

export interface Config {
  port: number;
  /** Код доступа: родители вводят его в панели взрослых. Без него сервер не отвечает. */
  accessCode: string;
  kidName: string;
  allowedOrigins: string[];
  openrouter: {
    apiKey: string;
    /** На проде: релей edge.envela.ru:8443 (с российских адресов OpenRouter закрыт). */
    baseUrl: string;
    model: string;
    /** Закрепленный провайдер, без перескакивания на других (иначе цена непредсказуема). */
    provider: string;
    reasoningEffort: string;
    maxTokens: number;
    secretaryMaxTokens: number;
  };
  yandex: {
    apiKey: string;
    /** Нужен для пользовательского аккаунта; для сервисного аккаунта пусто. */
    folderId: string;
    voice: string;
    role: string;
  };
  limits: {
    /** Жесткий дневной потолок на модель, в долларах (по московской дате). */
    dailyLlmUsd: number;
    /** Жесткий дневной потолок на SpeechKit, в рублях. */
    dailyVoiceRub: number;
    requestsPerMinute: number;
  };
  dataDir: string;
  seedFile: string;
  /** Словарик мира ребенка (личное, только на сервере). */
  glossaryFile: string;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 8080),
    accessCode: env.ACCESS_CODE ?? '',
    kidName: env.KID_NAME ?? 'друг',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://shchaev93.github.io,http://localhost:4173,http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY ?? '',
      baseUrl: (env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      model: env.LLM_MODEL ?? 'z-ai/glm-5.3',
      provider: env.LLM_PROVIDER ?? 'wafer/us',
      reasoningEffort: env.LLM_REASONING_EFFORT ?? 'low',
      maxTokens: num(env.LLM_MAX_TOKENS, 2500),
      secretaryMaxTokens: num(env.LLM_SECRETARY_MAX_TOKENS, 4000),
    },
    yandex: {
      apiKey: env.YANDEX_API_KEY ?? '',
      folderId: env.YANDEX_FOLDER_ID ?? '',
      voice: env.TTS_VOICE ?? 'anton',
      role: env.TTS_ROLE ?? 'good',
    },
    limits: {
      dailyLlmUsd: num(env.DAILY_LLM_USD, 0.3),
      dailyVoiceRub: num(env.DAILY_VOICE_RUB, 60),
      requestsPerMinute: num(env.REQUESTS_PER_MINUTE, 30),
    },
    dataDir: env.DATA_DIR ?? './data',
    seedFile: env.SEED_FILE ?? './data/seed.json',
    glossaryFile: env.GLOSSARY_FILE ?? './data/glossary.txt',
  };
}

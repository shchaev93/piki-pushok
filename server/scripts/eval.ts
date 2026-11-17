// Тестовый прогон характера Пушка (без голоса, только модель).
// Запуск: node server/scripts/eval.ts [лимит в долларах, по умолчанию 0.30]
// Берет из приватной папки server/data (не в git): seed.json, glossary.txt, eval-scenarios.json.
// Ключ и имя — из server/.env (OPENROUTER_API_KEY, KID_NAME).
// Сам останавливается, если потратил больше лимита. Отчет: server/data/eval-report.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applySecretary, normalizeNotebook, readGlossary, secretaryMessages, type Turn } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { chat, type ChatMessage } from '../src/openrouter.ts';
import { cleanForSpeech, extractCues, pushokSystemPrompt, type GameState } from '../src/prompts.ts';

type Role = 'kira' | 'pushok';
interface Scenario {
  id: string;
  check: string;
  history?: [Role, string][];
  say?: string;
  event?: 'start' | 'back' | 'warn' | 'end';
  /** Где Пушок: в комнате разговора (по умолчанию) или в домике. */
  place?: 'talk' | 'home';
  /** Корзинка и готовые блюда (для готовки). */
  basket?: Record<string, number>;
  dishes?: string[];
  /** Что надето и что сейчас в игре (сводка, как ее присылает игра). */
  outfit?: string;
  game?: GameState;
}
interface Scenarios {
  storyTitle: string;
  scenarios: Scenario[];
  secretary: {
    id: string;
    check: string;
    history: [Role, string][];
    /** Сколько последних реплик новые (остальные секретарь уже учел). */
    fresh?: number;
    /** Что дописать в тетрадку перед прогоном (например, неверная новость). */
    notebookExtra?: { news?: { date: string; text: string }[] };
  }[];
}

const root = join(import.meta.dirname, '..');
const envFile = join(root, '.env');
// Два режима: локально — настройки из server/.env и OpenRouter напрямую;
// на сервере (в контейнере, .env рядом нет) — из окружения контейнера, OpenRouter через релей.
const local = existsSync(envFile);
const env: Record<string, string | undefined> = local ? {} : { ...process.env };
if (local) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  env.OPENROUTER_BASE_URL = env.OPENROUTER_BASE_URL_LOCAL ?? 'https://openrouter.ai/api/v1';
}
const data = env.DATA_DIR ?? join(root, 'data');
const cfg = loadConfig(env);
if (!cfg.openrouter.apiKey || !env.KID_NAME) {
  console.error('Нужны OPENROUTER_API_KEY и KID_NAME (в server/.env локально или в окружении контейнера)');
  process.exit(1);
}
const kidName = env.KID_NAME;
const CAP = Number(process.argv[2] ?? 0.3);
/** Необязательно: прогнать только сценарии, в названии которых есть эти слова (через запятую). */
const ONLY = (process.argv[3] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const picked = (id: string) => !ONLY.length || ONLY.some((w) => id.includes(w));
const seed = normalizeNotebook(JSON.parse(readFileSync(join(data, 'seed.json'), 'utf8')));
const glossary = readGlossary(join(data, 'glossary.txt'));
const set = JSON.parse(readFileSync(join(data, 'eval-scenarios.json'), 'utf8')) as Scenarios;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const fill = (s: string) => s.replaceAll('{name}', kidName);

const EVENT: Record<string, string> = {
  start: '[Событие: начало разговора]',
  back: '[Событие: вернулись к разговору]',
  warn: '[Событие: осталось 3 минуты]',
  end: '[Событие: время вышло]',
};

let spent = 0;
const lines: string[] = [
  `# Прогон Пушка: ${cfg.openrouter.model} у ${cfg.openrouter.provider}, размышления ${cfg.openrouter.reasoningEffort}`,
  '',
];

async function run(id: string, check: string, messages: ChatMessage[], maxTokens: number, show: (t: string) => string) {
  if (spent >= CAP) {
    lines.push(`## ${id}`, `ПРОПУЩЕНО: потрачен лимит $${CAP}`, '');
    return;
  }
  const t0 = Date.now();
  try {
    const r = await chat(cfg.openrouter, messages, maxTokens);
    const ms = Date.now() - t0;
    spent += r.costUsd;
    lines.push(
      `## ${id}`,
      `Проверить: ${check}`,
      '',
      `Вход: «${messages.at(-1)!.content.slice(0, 300)}»`,
      '',
      `Пушок: ${show(r.text)}`,
      '',
      `_${(ms / 1000).toFixed(1)} с · вход ${r.usage.prompt} · выход ${r.usage.completion} (размышления ${r.usage.reasoning}) · $${r.costUsd.toFixed(5)}_`,
      '',
    );
    console.log(`${id}: ${(ms / 1000).toFixed(1)} с, $${r.costUsd.toFixed(5)}, итого $${spent.toFixed(4)}`);
  } catch (e) {
    lines.push(`## ${id}`, `ОШИБКА: ${(e as Error).message}`, '');
    console.log(`${id}: ОШИБКА ${(e as Error).message}`);
  }
}

const toMsg = ([role, text]: [Role, string]): ChatMessage =>
  role === 'pushok' ? { role: 'assistant', content: fill(text) } : { role: 'user', content: fill(text) };

for (const s of set.scenarios.filter((x) => picked(x.id))) {
  const msgs: ChatMessage[] = [
    {
      role: 'system',
      content: pushokSystemPrompt({
        kidName,
        notebook: seed,
        outfit: s.outfit ?? 'корона и кофточка в полоску',
        today,
        glossary,
        place: s.place ?? 'talk',
        basket: s.basket ?? { seeds: 1 },
        dishes: s.dishes ?? [],
        game: s.game,
      }),
    },
    ...(s.history ?? []).map(toMsg),
    { role: 'user', content: [s.event ? EVENT[s.event] : '', s.say ? fill(s.say) : ''].filter(Boolean).join('\n') },
  ];
  await run(s.id, s.check, msgs, cfg.openrouter.maxTokens, (t) => {
    const c = extractCues(t);
    const said = cleanForSpeech(c.text) || '(ПУСТО: размышления съели весь лимит)';
    return `${c.tags ? `**${c.tags}** ` : ''}${said}`;
  });
}

for (const s of set.secretary.filter((x) => picked(x.id))) {
  const history: Turn[] = s.history.map(([role, text]) => ({ role, text: fill(text) }));
  const book = normalizeNotebook({ ...seed, news: [...seed.news, ...(s.notebookExtra?.news ?? [])] });
  await run(s.id, s.check, secretaryMessages(kidName, book, history, s.fresh, today), cfg.openrouter.secretaryMaxTokens, (t) => {
    const r = applySecretary(book, t, today);
    if ('error' in r && r.error) return `ОШИБКА: ${r.error}: ${t.slice(0, 300)}`;
    const nb = r.notebook;
    const story = nb.stories.find((x) => x.title === set.storyTitle);
    return [
      `правки: \`${t.replace(/\s+/g, ' ').slice(0, 1500)}\``,
      `применено ${r.applied}, пропущено ${r.skipped}`,
      `сказок ${nb.stories.length} (было ${seed.stories.length}); сейчас: ${nb.currentStory}`,
      `герои: ${story?.characters.map((c) => c.name).join(', ')}`,
      `новые события: ${story?.events.slice(-3).map((e) => e.text).join(' | ')}`,
      `stoppedAt: ${story?.stoppedAt}`,
      `news: ${nb.news.map((n) => n.text).join(' | ')}`,
      `для родителей: ${nb.notesForParents.map((n) => n.text).join(' | ') || '—'}`,
    ].join('\n\n');
  });
}

lines.push(`**Итого потрачено: $${spent.toFixed(4)}** (лимит $${CAP})`);
writeFileSync(join(data, 'eval-report.md'), lines.join('\n'));
console.log(`Готово. Потрачено $${spent.toFixed(4)}. Отчет: server/data/eval-report.md`);

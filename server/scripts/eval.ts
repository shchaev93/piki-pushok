// Тестовый прогон характера Пушка (без голоса, только модель).
// Запуск: node server/scripts/eval.ts [лимит в долларах, по умолчанию 0.30]
// Берет из приватной папки server/data (не в git): seed.json, glossary.txt, eval-scenarios.json.
// Ключ и имя — из server/.env (OPENROUTER_API_KEY, KID_NAME).
// Сам останавливается, если потратил больше лимита. Отчет: server/data/eval-report.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeNotebook, readGlossary } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { chat, type ChatMessage } from '../src/openrouter.ts';
import { cleanForSpeech, extractCues, pushokSystemPrompt, secretarySystemPrompt } from '../src/prompts.ts';

type Role = 'kira' | 'pushok';
interface Scenario {
  id: string;
  check: string;
  history?: [Role, string][];
  say?: string;
  event?: 'start' | 'warn' | 'end';
  /** Где Пушок: в комнате разговора (по умолчанию) или в домике. */
  place?: 'talk' | 'home';
  /** Корзинка и готовые блюда (для готовки). */
  basket?: Record<string, number>;
  dishes?: string[];
}
interface Scenarios {
  storyTitle: string;
  scenarios: Scenario[];
  secretary: { id: string; check: string; history: [Role, string][] }[];
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
const seed = normalizeNotebook(JSON.parse(readFileSync(join(data, 'seed.json'), 'utf8')));
const glossary = readGlossary(join(data, 'glossary.txt'));
const set = JSON.parse(readFileSync(join(data, 'eval-scenarios.json'), 'utf8')) as Scenarios;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const fill = (s: string) => s.replaceAll('{name}', kidName);

const EVENT: Record<string, string> = {
  start: '[Событие: начало разговора]',
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

for (const s of set.scenarios) {
  const msgs: ChatMessage[] = [
    {
      role: 'system',
      content: pushokSystemPrompt({
        kidName,
        notebook: seed,
        outfit: 'корона и кофточка в полоску',
        today,
        glossary,
        place: s.place ?? 'talk',
        basket: s.basket ?? { seeds: 1 },
        dishes: s.dishes ?? [],
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

for (const s of set.secretary) {
  const transcript = s.history.map(([role, text]) => `${role === 'kira' ? 'Девочка' : 'Пушок'}: ${fill(text)}`).join('\n');
  await run(
    s.id,
    s.check,
    [
      { role: 'system', content: secretarySystemPrompt(kidName) },
      { role: 'user', content: `Сегодня ${today}.\n\nТЕКУЩАЯ ТЕТРАДКА:\n${JSON.stringify(seed)}\n\nСВЕЖИЙ КУСОК РАЗГОВОРА:\n${transcript}` },
    ],
    cfg.openrouter.secretaryMaxTokens,
    (t) => {
      try {
        const nb = normalizeNotebook(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)));
        const story = nb.stories.find((x) => x.title === set.storyTitle);
        return [
          `сказок ${nb.stories.length} (было ${seed.stories.length}); currentStory: ${nb.currentStory}`,
          `герои: ${story?.characters.map((c) => c.name).join(', ')}`,
          `stoppedAt: ${story?.stoppedAt}`,
          `news: ${nb.news.map((n) => n.text).join(' | ')}`,
          `для родителей: ${nb.notesForParents.map((n) => n.text).join(' | ') || '—'}`,
        ].join('\n\n');
      } catch {
        return `НЕ JSON: ${t.slice(0, 300)}`;
      }
    },
  );
}

lines.push(`**Итого потрачено: $${spent.toFixed(4)}** (лимит $${CAP})`);
writeFileSync(join(data, 'eval-report.md'), lines.join('\n'));
console.log(`Готово. Потрачено $${spent.toFixed(4)}. Отчет: server/data/eval-report.md`);

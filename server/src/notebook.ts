// Тетрадка Пушка — его память о разговорах. Хранится на телефоне, сервер только проверяет форму.
// Каждый факт — отдельная короткая запись: событие сказки, герой, правило мира, новость, записка.
// Секретарь не переписывает тетрадку целиком, а присылает правки: добавить, исправить, убрать запись.
// Так старое не теряется при пересказе, а ответ секретаря короткий (дешевле и быстрее).

export interface Dated {
  date: string;
  text: string;
}

export interface Story {
  title: string;
  characters: { name: string; about: string }[];
  /** Правила мира сказки, которые установил ребенок («котик не летает, а ходит»). */
  rules: string[];
  /** Что было в сказке, по порядку: каждое событие — отдельная запись. */
  events: Dated[];
  stoppedAt: string;
  updatedAt: string;
}

export interface Notebook {
  stories: Story[];
  /** Название сказки, которую сейчас сочиняют, или null. */
  currentStory: string | null;
  news: Dated[];
  notesForParents: Dated[];
}

export const emptyNotebook = (): Notebook => ({ stories: [], currentStory: null, news: [], notesForParents: [] });

export const LIMITS = {
  stories: 10,
  characters: 20,
  rules: 10,
  /** Событий в сказке: первые KEEP_FIRST (начало) + самые свежие. */
  events: 30,
  keepFirstEvents: 4,
  news: 15,
  notes: 100,
  text: 200,
};

// ---------- проверка формы ----------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Для сравнения «то же самое уже записано» (без учета регистра, ё и знаков). */
const same = (a: string, b: string) => {
  const k = (s: string) => s.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return k(a) === k(b);
};
const dated = (x: unknown): Dated => ({ date: str(obj(x).date, 10), text: str(obj(x).text, LIMITS.text) });

/** Старая тетрадка: пересказ сказки одним куском — режем на записи по предложениям. */
function splitSummary(summary: string, date: string): Dated[] {
  const out: Dated[] = [];
  let cur = '';
  for (const s of summary.split(/(?<=[.!?…])\s+/)) {
    if (cur && cur.length + s.length + 1 > LIMITS.text) {
      out.push({ date, text: cur });
      cur = '';
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push({ date, text: cur.slice(0, LIMITS.text) });
  return out;
}

/** Слишком много событий: начало сказки и самое свежее остаются, середина уходит. */
function trimEvents(events: Dated[]): Dated[] {
  if (events.length <= LIMITS.events) return events;
  const k = LIMITS.keepFirstEvents;
  return [...events.slice(0, k), ...events.slice(events.length - (LIMITS.events - k))];
}

/** Привести тетрадку любой формы (в том числе старой, с summary) к ожидаемой и ограничить размер. */
export function normalizeNotebook(v: unknown): Notebook {
  const n = obj(v);
  const stories = arr(n.stories)
    .slice(0, LIMITS.stories)
    .map((s): Story => {
      const o = obj(s);
      const updatedAt = str(o.updatedAt, 10);
      const events = Array.isArray(o.events)
        ? o.events.map(dated).filter((e) => e.text)
        : splitSummary(typeof o.summary === 'string' ? o.summary.replace(/\s+/g, ' ').trim().slice(0, 900) : '', updatedAt);
      return {
        title: str(o.title, 60),
        characters: arr(o.characters)
          .map((c) => ({ name: str(obj(c).name, 40), about: str(obj(c).about, LIMITS.text) }))
          .filter((c) => c.name)
          .slice(0, LIMITS.characters),
        rules: arr(o.rules).map((r) => str(r, 150)).filter(Boolean).slice(0, LIMITS.rules),
        events: trimEvents(events),
        stoppedAt: str(o.stoppedAt, 300),
        updatedAt,
      };
    })
    .filter((s) => s.title);
  const current = typeof n.currentStory === 'string' ? n.currentStory : '';
  return {
    stories,
    currentStory: stories.find((s) => current && same(s.title, current))?.title ?? null,
    news: arr(n.news).map(dated).filter((x) => x.text).slice(-LIMITS.news),
    notesForParents: arr(n.notesForParents).map(dated).filter((x) => x.text).slice(-LIMITS.notes),
  };
}

// ---------- тетрадка для Пушка ----------

const dateOf = (d: string) => (d ? `${d}: ` : '');

/** Тетрадка простым текстом для промпта Пушка (короче JSON). Текущая сказка — целиком, остальные — коротко. */
export function notebookText(nb: Notebook, kidName: string): string {
  const out: string[] = [];
  out.push(nb.currentStory ? `Сейчас сочиняем сказку «${nb.currentStory}».` : 'Сейчас никакую сказку не сочиняем.');
  if (!nb.stories.length) out.push('Сказок пока нет.');
  for (const s of nb.stories) {
    const full = s.title === nb.currentStory;
    out.push('', `СКАЗКА «${s.title}»${s.updatedAt ? ` (сочиняли ${s.updatedAt})` : ''}`);
    if (s.characters.length) out.push(`Герои: ${s.characters.map((c) => (c.about ? `${c.name} — ${c.about}` : c.name)).join('; ')}.`);
    if (s.rules.length) out.push(`Правила мира (соблюдай всегда, и в своих выдумках тоже): ${s.rules.join('; ')}.`);
    const ev = full || s.events.length <= 4 ? s.events : [s.events[0], ...s.events.slice(-3)];
    if (ev.length) {
      out.push(full ? 'Что было, по порядку:' : 'Что было (начало и последнее):');
      for (const e of ev) out.push(`- ${e.text}`);
    }
    if (s.stoppedAt) out.push(`Остановились: ${s.stoppedAt}`);
  }
  out.push('', `НОВОСТИ ИЗ ЖИЗНИ ${kidName.toUpperCase()} (можно вспомнить в разговоре)`);
  out.push(...(nb.news.length ? nb.news.map((x) => `- ${dateOf(x.date)}${x.text}`) : ['- пока нет']));
  const notes = nb.notesForParents.slice(-10);
  out.push('', 'ЗАПИСКИ ДЛЯ МАМЫ И ПАПЫ (что ты уже записал, последние)');
  out.push(...(notes.length ? notes.map((x) => `- ${dateOf(x.date)}${x.text}`) : ['- пока нет']));
  return out.join('\n');
}

// ---------- тетрадка для секретаря: у каждой записи свой номер ----------

/** Тетрадка с номерами записей: s1 — сказка, s1h2 — герой, s1r1 — правило, s1e3 — событие, n4 — новость, p5 — записка. */
export function notebookForSecretary(nb: Notebook): string {
  const out: string[] = [];
  const cur = nb.stories.findIndex((s) => s.title === nb.currentStory);
  out.push(`Сейчас сочиняем: ${cur >= 0 ? `s${cur + 1}` : 'ничего'}`);
  nb.stories.forEach((s, i) => {
    const id = `s${i + 1}`;
    out.push('', `${id} сказка «${s.title}»${s.updatedAt ? ` (обновлена ${s.updatedAt})` : ''}`);
    out.push('  герои:', ...s.characters.map((c, j) => `  ${id}h${j + 1} ${c.name} — ${c.about}`));
    out.push('  правила мира:', ...s.rules.map((r, j) => `  ${id}r${j + 1} ${r}`));
    out.push('  что было:', ...s.events.map((e, j) => `  ${id}e${j + 1} ${e.text}`));
    out.push(`  остановились: ${s.stoppedAt || '—'}`);
  });
  if (!nb.stories.length) out.push('Сказок пока нет.');
  out.push('', 'новости из жизни:', ...nb.news.map((x, i) => `n${i + 1} (${x.date}) ${x.text}`));
  // записок может быть до сотни: секретарю хватит последних (номера настоящие)
  const from = Math.max(0, nb.notesForParents.length - 30);
  out.push('', 'записки для мамы и папы:', ...nb.notesForParents.slice(from).map((x, i) => `p${from + i + 1} (${x.date}) ${x.text}`));
  return out.join('\n');
}

// ---------- правки секретаря ----------

export type Op =
  | { op: 'event' | 'rule' | 'stopped'; story: string; text: string }
  | { op: 'hero'; story: string; name: string; about?: string }
  | { op: 'current'; story: string }
  | { op: 'news' | 'note'; text: string }
  | { op: 'fix'; id: string; text?: string; name?: string }
  | { op: 'remove'; id: string };

const MAX_OPS = 25;
const MAX_REMOVES = 5;

/**
 * Применить правки секретаря. Номера записей (s1e3, n2) относятся к тетрадке ДО правок,
 * поэтому сначала все находим, а удаляем в самом конце. Неизвестные и битые правки пропускаются.
 */
export function applyOps(nbIn: Notebook, opsIn: unknown, today: string): { notebook: Notebook; applied: number; skipped: number } {
  const nb: Notebook = structuredClone(nbIn);
  const ops = arr(opsIn).slice(0, MAX_OPS).map(obj);
  const origStories = [...nb.stories];
  const removed = new Set<object>();
  let removes = 0;
  let applied = 0;
  let skipped = 0;
  const touch = (s: Story) => (s.updatedAt = today);

  /** Сказка по номеру (s2) или по названию; новое название — новая сказка, ее и сочиняют. */
  const storyOf = (ref: unknown, create: boolean): Story | null => {
    const r = str(ref, 60);
    if (!r) return null;
    const m = r.match(/^s(\d+)$/i);
    if (m) return origStories[Number(m[1]) - 1] ?? null;
    const found = nb.stories.find((s) => same(s.title, r));
    if (found || !create || nb.stories.length >= LIMITS.stories) return found ?? null;
    const s: Story = { title: r, characters: [], rules: [], events: [], stoppedAt: '', updatedAt: today };
    nb.stories.push(s);
    nb.currentStory = s.title;
    return s;
  };

  /** Запись по номеру: где она лежит и сама запись. */
  type Ref =
    | { kind: 'story'; story: Story }
    | { kind: 'hero'; story: Story; item: Story['characters'][number] }
    | { kind: 'rule'; story: Story; index: number; box: { text: string } }
    | { kind: 'event' | 'news' | 'note'; story?: Story; item: Dated };
  const ruleBoxes = new Map<Story, { text: string }[]>();
  for (const s of origStories) ruleBoxes.set(s, s.rules.map((text) => ({ text })));
  const refOf = (idIn: unknown): Ref | null => {
    const id = str(idIn, 20).toLowerCase();
    let m = id.match(/^s(\d+)(?:([hre])(\d+))?$/);
    if (m) {
      const story = origStories[Number(m[1]) - 1];
      if (!story) return null;
      if (!m[2]) return { kind: 'story', story };
      const i = Number(m[3]) - 1;
      if (m[2] === 'h') return story.characters[i] ? { kind: 'hero', story, item: story.characters[i] } : null;
      if (m[2] === 'r') {
        const box = ruleBoxes.get(story)?.[i];
        return box ? { kind: 'rule', story, index: i, box } : null;
      }
      return story.events[i] ? { kind: 'event', story, item: story.events[i] } : null;
    }
    m = id.match(/^([np])(\d+)$/);
    if (m) {
      const list = m[1] === 'n' ? nb.news : nb.notesForParents;
      const item = list[Number(m[2]) - 1];
      return item ? { kind: m[1] === 'n' ? 'news' : 'note', item } : null;
    }
    return null;
  };
  // ссылки на записи до правок: дальнейшие добавления не сдвигают номера
  const refs = new Map<string, Ref | null>();
  for (const o of ops) if (o.op === 'fix' || o.op === 'remove') refs.set(str(o.id, 20).toLowerCase(), refOf(o.id));

  for (const o of ops) {
    const text = str(o.text, LIMITS.text);
    let ok = false;
    switch (o.op) {
      case 'event':
      case 'rule':
      case 'stopped': {
        const s = text && storyOf(o.story, true);
        if (!s) break;
        if (o.op === 'stopped') s.stoppedAt = str(o.text, 300);
        else if (o.op === 'rule') {
          if (s.rules.some((r) => same(r, text))) break;
          s.rules.push(text);
          ruleBoxes.get(s)?.push({ text });
        } else {
          if (s.events.some((e) => same(e.text, text))) break;
          s.events.push({ date: today, text });
        }
        touch(s);
        ok = true;
        break;
      }
      case 'hero': {
        const name = str(o.name, 40);
        const s = name && storyOf(o.story, true);
        if (!s) break;
        const about = str(o.about, LIMITS.text);
        const h = s.characters.find((c) => same(c.name, name));
        if (h) {
          if (!about || same(h.about, about)) break;
          h.about = about;
        } else s.characters.push({ name, about });
        touch(s);
        ok = true;
        break;
      }
      case 'current': {
        const s = storyOf(o.story, true);
        if (s) {
          nb.currentStory = s.title;
          ok = true;
        }
        break;
      }
      case 'news':
      case 'note': {
        const list = o.op === 'news' ? nb.news : nb.notesForParents;
        if (!text || list.some((x) => same(x.text, text))) break;
        list.push({ date: today, text });
        ok = true;
        break;
      }
      case 'fix': {
        const r = refs.get(str(o.id, 20).toLowerCase());
        if (!r) break;
        if (r.kind === 'story') {
          const title = str(o.text, 60);
          if (!title) break;
          if (nb.currentStory === r.story.title) nb.currentStory = title;
          r.story.title = title;
        } else if (r.kind === 'hero') {
          const name = str(o.name, 40);
          if (!name && !text) break;
          if (name) r.item.name = name;
          if (text) r.item.about = text;
          touch(r.story);
        } else if (r.kind === 'rule') {
          if (!text) break;
          r.box.text = text;
          touch(r.story);
        } else {
          if (!text) break;
          r.item.text = text;
          if (r.story) touch(r.story);
        }
        ok = true;
        break;
      }
      case 'remove': {
        const r = refs.get(str(o.id, 20).toLowerCase());
        // сказки целиком секретарь не удаляет; удалений за раз немного — защита от сбоя модели
        if (!r || r.kind === 'story' || removes >= MAX_REMOVES) break;
        removed.add(r.kind === 'rule' ? r.box : r.item);
        if (r.story) touch(r.story);
        removes++;
        ok = true;
        break;
      }
    }
    if (ok) applied++;
    else skipped++;
  }

  for (const s of nb.stories) {
    const boxes = ruleBoxes.get(s);
    if (boxes) s.rules = boxes.filter((b) => !removed.has(b)).map((b) => b.text);
    s.characters = s.characters.filter((c) => !removed.has(c));
    s.events = s.events.filter((e) => !removed.has(e));
  }
  nb.news = nb.news.filter((x) => !removed.has(x));
  nb.notesForParents = nb.notesForParents.filter((x) => !removed.has(x));
  return { notebook: normalizeNotebook(nb), applied, skipped };
}

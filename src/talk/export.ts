import { CONFIG } from '../config';
import type { Save } from '../save/schema';

// Текст разговоров для разбора: родители копируют его в панели взрослых и сами решают,
// кому показать. С устройства ничего не уходит само.

const time = (t: number) =>
  new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

type Nb = {
  stories?: { title?: string; stoppedAt?: string; characters?: { name?: string }[]; events?: { text?: string }[] }[];
  currentStory?: string | null;
  news?: { date?: string; text?: string }[];
  notesForParents?: { date?: string; text?: string }[];
};

export function exportText(s: Readonly<Save>, version: string, now = Date.now()): string {
  const out: string[] = [`Разговоры с Пушком — выгрузка ${time(now)}, игра ${version}`, ''];
  out.push('== ИСТОРИЯ (старые сверху) ==');
  for (const h of s.talk.history) {
    const who = h.role === 'kira' ? 'Она' : h.role === 'pushok' ? 'Пушок' : 'Игра';
    out.push(`${time(h.at)} ${who}: ${h.tags ? `${h.tags} ` : ''}${h.text}`);
  }
  const nb = (s.talk.notebook ?? {}) as Nb;
  out.push('', '== ТЕТРАДКА ==', `Сейчас сочиняем: ${nb.currentStory ?? '—'}`);
  for (const st of nb.stories ?? []) {
    out.push(`- ${st.title ?? ''} (герои: ${(st.characters ?? []).map((c) => c.name).join(', ')}) — остановились: ${st.stoppedAt ?? ''}`);
    for (const e of st.events ?? []) out.push(`    · ${e.text ?? ''}`);
  }
  out.push('Новости:', ...(nb.news ?? []).map((n) => `- ${n.date ?? ''}: ${n.text ?? ''}`));
  out.push('Записки для родителей:', ...(nb.notesForParents ?? []).map((n) => `- ${n.date ?? ''}: ${n.text ?? ''}`));
  out.push('', '== ЖУРНАЛ ИГРЫ ==', ...s.journal.map((e) => `${time(e.at)} ${e.text}${e.n > 1 ? ` (${e.n} раз)` : ''}`));
  const t = s.talk;
  out.push('', `Минут сегодня: ${Math.round(t.usedMs / 60_000)} из ${CONFIG.talk.minutesPerDay + Math.round(t.extraMs / 60_000)} (${t.day || '—'})`);
  return out.join('\n');
}

import { JOURNAL_MAX, type Save } from '../save/schema';

// Журнал игры для разговора: что недавно было (летал на облачке, катался с горки,
// купили морковку). Пушок получает его с каждой фразой и может об этом поговорить.
// Записи — с точки зрения Пушка, без имени ребенка: «тебя покормили семечками».
// Одинаковые события подряд (в течение 10 минут) склеиваются: «катался с горки» ×3.

const MERGE_MS = 10 * 60_000;

export function logEvent(save: Save, text: string, now = Date.now()) {
  const j = save.journal;
  const last = j.at(-1);
  if (last && last.text === text && now - last.at < MERGE_MS) {
    last.n++;
    last.at = now;
  } else {
    j.push({ at: now, text, n: 1 });
  }
  if (j.length > JOURNAL_MAX) j.splice(0, j.length - JOURNAL_MAX);
}

/** Занятия в домике — как о них сказать. */
export const ACTIVITY_TEXT: Record<string, string> = {
  slide: 'катался с горки',
  trampoline: 'прыгал на батуте',
  climber: 'лазил на лазилке',
  rope: 'прыгал через скакалку',
  bath: 'купался в ванне',
  toilet: 'сходил в туалет',
  bed: 'полежал в кроватке',
  table: 'покушал за столиком',
  kitchen: 'нюхал кастрюльку на кухне',
};

export const FOOD_TEXT: Record<string, string> = {
  seeds: 'семечки',
  apple: 'яблоко',
  carrot: 'морковку',
  cheese: 'сыр',
  bread: 'хлебушек',
};

export const DISH_TEXT: Record<string, string> = {
  pie: 'пирог',
  sandwich: 'бутерброд',
  salad: 'салат',
  soup: 'суп-сюрприз',
};

// Цели касания в логических координатах сцены. Любая цель при хит-тесте
// расширяется минимум до 64 CSS px. Hover и двойных тапов нет.

export interface Target {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Срабатывает сразу при касании. */
  onTap?: () => void;
  /** Удержание: прогресс 0..1, завершение после ms. Отпустил раньше = отмена. */
  hold?: { ms: number; onProgress(p: number): void; onComplete(): void };
}

/** Прямоугольник цели после расширения до минимального размера. */
export function expanded(t: Target, min: number) {
  const w = Math.max(t.w, min);
  const h = Math.max(t.h, min);
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const inside = (r: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
  px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;

/**
 * Какая цель под пальцем. Сначала точное попадание (верхняя цель = последняя
 * в списке), иначе ближайшая по центру среди расширенных зон.
 */
export function hitTest(targets: readonly Target[], px: number, py: number, min: number): Target | null {
  for (let i = targets.length - 1; i >= 0; i--) if (inside(targets[i], px, py)) return targets[i];
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (!inside(expanded(t, min), px, py)) continue;
    const d = Math.hypot(t.x + t.w / 2 - px, t.y + t.h / 2 - py);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

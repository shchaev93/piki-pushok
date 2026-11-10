import { CONFIG } from '../config';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import type { SpriteDef } from '../sprites/grid';
import { ICONS } from '../sprites/icons';
import { COIN, ITEM_ICONS } from '../sprites/items';

// Общие элементы интерфейса без текста: круглые кнопки, денежки, сердечко сытости.

export const BTN = 22;

export interface Btn {
  x: number;
  y: number;
}

/** Круглая кнопка с иконкой. wiggle > 0 = покачивание (мс до конца). */
export function drawButton(r: Renderer, b: Btn, key: string, icon: SpriteDef, wiggle = 0, pulse = false) {
  const dx = wiggle > 0 ? Math.round(Math.sin(wiggle / 40) * 1.5) : 0;
  const dy = pulse ? -Math.round(Math.abs(Math.sin(performance.now() / 220)) * 2) : 0;
  r.sprite('icon.button', ICONS.button, b.x + dx, b.y + dy);
  const iw = icon.rows[0].length;
  const ih = icon.rows.length;
  r.sprite(key, icon, b.x + dx + Math.floor((BTN - iw) / 2), b.y + dy + Math.floor((BTN - ih) / 2));
}

/** Кнопка «домой» в левом верхнем углу безопасной зоны. */
export function homeButton(safe: Rect): Btn {
  return { x: Math.ceil(safe.x0) + 3, y: Math.ceil(safe.y0) + 3 };
}

export function drawHomeButton(r: Renderer, safe: Rect, pulse = false) {
  drawButton(r, homeButton(safe), 'item.house', ITEM_ICONS.house, 0, pulse);
}

/** Денежки кружочками: рядами по perRow, без цифр. Возвращает ширину. */
export function drawCoins(r: Renderer, x: number, y: number, n: number, perRow = 10, maxShown = 40) {
  const shown = Math.min(n, maxShown);
  for (let i = 0; i < shown; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    r.sprite('item.coin', COIN, x + col * 5 + (row % 2) * 2, y + row * 4);
  }
  return Math.min(shown, perRow) * 5;
}

// Сердечко сытости: заливается снизу вверх по уровню сытости.
const HEART = [
  '..OOO...OOO..',
  '.OXXXO.OXXXO.',
  'OXXXXXOXXXXXO',
  'OXXXXXXXXXXXO',
  'OXXXXXXXXXXXO',
  '.OXXXXXXXXXO.',
  '..OXXXXXXXO..',
  '...OXXXXXO...',
  '....OXXXO....',
  '.....OXO.....',
  '......O......',
];

export function drawSatiety(r: Renderer, x: number, y: number, value: number, scale = 1) {
  const H = CONFIG.hunger;
  const level = (value - 0) / H.max; // 0..1
  const rows = HEART.length;
  const filledFrom = rows - 1 - Math.round(level * (rows - 2)); // строки ниже этой залиты
  const fill = value < H.veryHungryBelow ? '#F7A9C0' : '#E8457A';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < HEART[j].length; i++) {
      const ch = HEART[j][i];
      if (ch === '.') continue;
      const c = ch === 'O' ? '#5A4650' : j >= filledFrom ? fill : '#FFFFFF';
      r.rect(x + i * scale, y + j * scale, scale, scale, c);
    }
  }
}

/** Ячейка-подложка для предмета (в корзинке, на полке, в гардеробе). */
export function drawSlot(r: Renderer, x: number, y: number, w: number, h: number, fill = '#FFFFFF', border = '#5A4650') {
  r.rect(x + 1, y, w - 2, h, border);
  r.rect(x, y + 1, w, h - 2, border);
  r.rect(x + 1, y + 1, w - 2, h - 2, fill);
}

/** Мерцающая подсказка «сюда»: кольцо из точек, крутится. */
export function drawHintRing(r: Renderer, cx: number, cy: number, radius: number, t: number, color = '#E8457A') {
  const n = 16;
  for (let i = 0; i < n; i++) {
    if ((i + Math.floor(t / 90)) % 4 !== 0) continue;
    const a = (i / n) * Math.PI * 2;
    r.rect(Math.round(cx + Math.cos(a) * radius), Math.round(cy + Math.sin(a) * radius * 0.6), 2, 2, color);
  }
}

import type { FoodId } from '../config';
import { CharCanvas, recolor, type SpriteDef } from './grid';
import { FURN_PALETTE } from './home-objects';

// Предметы этапов 2-5: бабочки, денежка, еда, блюда, облако, кнопки, кастрюля, гитары.

const def = (rows: string[]): SpriteDef => ({ rows, palette: FURN_PALETTE });

// ---------- облачко ----------

export const BUTTERFLY_OPEN = def(['OO...OO', 'OPPOPPO', 'OPPOPPO', '.OPOPO.', '.OO.OO.']);
export const BUTTERFLY_FOLDED = def(['..O.O..', '.OPOPO.', '.OPOPO.', '..OOO..', '...O...']);
/** Цвета крылышек: каждая бабочка своего цвета. */
export const BUTTERFLY_COLORS = ['#F7A9C0', '#8ECDF2', '#F5C542', '#C9A6E8', '#9BD38A'];
export const butterfly = (open: boolean, color: string) => recolor(open ? BUTTERFLY_OPEN : BUTTERFLY_FOLDED, { P: color });

export const COIN = def(['.OOO.', 'OWYYO', 'OYYYO', 'OYYYO', '.OOO.']);

function bigCloud(): string[] {
  // Объединение трех эллипсов, контур только по внешнему краю.
  const W = 36;
  const H = 13;
  const blobs = [
    [9, 8, 8, 4.6],
    [27, 8, 8, 4.6],
    [18, 6.5, 10, 6],
  ];
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && blobs.some(([cx, cy, rx, ry]) => Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) <= 1);
  const c = new CharCanvas(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      // мягкая голубая тень у нижнего края
      c.set(x, y, edge ? 'O' : !inside(x, y + 2) ? 'L' : 'W');
    }
  }
  return c.rows();
}
export const BIG_CLOUD = def(bigCloud());

// ---------- еда ----------

function seeds(): string[] {
  const c = new CharCanvas(12, 12);
  c.disc(6, 6, 3.4, 5.6, 'E');
  for (let y = 3; y <= 8; y++) c.set(5, y, 'W');
  for (let y = 4; y <= 7; y++) c.set(7, y, 'S');
  return c.rows();
}

function apple(): string[] {
  const c = new CharCanvas(12, 12);
  c.disc(6, 7.2, 5.4, 4.8, 'J');
  c.set(3, 5, 'W').set(3, 6, 'W').set(4, 5, 'W');
  c.set(6, 1, 'O').set(6, 2, 'O');
  c.set(7, 0, 'O').set(8, 0, 'O').set(7, 1, 'G').set(8, 1, 'G').set(9, 1, 'O');
  return c.rows();
}

function carrot(): string[] {
  const c = new CharCanvas(12, 13);
  for (let y = 3; y <= 12; y++) {
    const half = Math.round((3.4 * (12 - y)) / 9);
    for (let x = 6 - half - 1; x <= 6 + half; x++) {
      const edge = x === 6 - half - 1 || x === 6 + half || y === 3 || y === 12;
      c.set(x, y, edge ? 'O' : 'R');
    }
  }
  c.set(5, 6, 'O').set(6, 9, 'O');
  c.set(4, 0, 'K').set(5, 1, 'G').set(6, 0, 'G').set(6, 1, 'K').set(7, 1, 'G').set(8, 0, 'K').set(5, 2, 'K').set(6, 2, 'G');
  return c.rows();
}

function cheese(): string[] {
  const c = new CharCanvas(13, 10);
  for (let y = 1; y <= 8; y++) {
    const right = 1 + Math.round(((y - 1) * 11) / 7);
    for (let x = 1; x <= right; x++) c.set(x, y, x === 1 || x === right || y === 8 ? 'O' : 'Y');
  }
  c.set(1, 0, 'O');
  c.set(3, 5, 'A').set(6, 6, 'A').set(4, 7, 'A').set(8, 7, 'A');
  return c.rows();
}

function bread(): string[] {
  const c = new CharCanvas(14, 10);
  c.disc(7, 5, 6.6, 4.4, 'B');
  c.box(1, 5, 12, 5, 'B');
  c.rect(2, 5, 10, 1, 'B');
  c.set(4, 2, 'D').set(5, 3, 'D').set(7, 2, 'D').set(8, 3, 'D').set(10, 3, 'D');
  return c.rows();
}

export const FOOD_SPRITES: Record<FoodId, SpriteDef> = {
  seeds: def(seeds()),
  apple: def(apple()),
  carrot: def(carrot()),
  cheese: def(cheese()),
  bread: def(bread()),
};

// ---------- блюда ----------

function pie(): string[] {
  const c = new CharCanvas(16, 11);
  c.disc(8, 8.5, 7.8, 2.4, 'W');
  c.disc(8, 6, 6.6, 4.4, 'Y');
  c.rect(1, 7, 14, 1, 'O');
  for (const x of [5, 8, 11]) for (let y = 3; y <= 6; y++) c.set(x, y, 'R');
  c.rect(3, 4, 10, 1, 'R');
  return c.rows();
}

function soup(): string[] {
  const c = new CharCanvas(16, 11);
  for (let y = 4; y <= 10; y++) {
    const half = Math.round(7.5 - ((y - 4) * (y - 4)) / 7);
    for (let x = 8 - half; x < 8 + half; x++) c.set(x, y, x === 8 - half || x === 8 + half - 1 || y === 10 ? 'O' : 'C');
  }
  c.disc(8, 4, 7.4, 2.2, 'A');
  c.set(5, 4, 'R').set(9, 3, 'G').set(11, 4, 'J');
  c.set(6, 6, 'L').set(7, 6, 'L');
  return c.rows();
}

function sandwich(): string[] {
  const c = new CharCanvas(16, 11);
  c.box(1, 7, 14, 4, 'B');
  c.rect(0, 6, 16, 1, 'G');
  c.rect(1, 5, 14, 1, 'Y');
  c.set(3, 6, 'K').set(8, 6, 'K').set(12, 6, 'K');
  c.disc(8, 4, 7.2, 3.4, 'B');
  c.rect(2, 5, 12, 1, 'Y');
  c.set(5, 2, 'W').set(9, 2, 'W');
  return c.rows();
}

function salad(): string[] {
  const c = new CharCanvas(16, 11);
  for (let y = 5; y <= 10; y++) {
    const half = Math.round(7.5 - ((y - 5) * (y - 5)) / 5);
    for (let x = 8 - half; x < 8 + half; x++) c.set(x, y, x === 8 - half || x === 8 + half - 1 || y === 10 ? 'O' : 'W');
  }
  c.disc(8, 4, 6.5, 2.8, 'G');
  c.set(5, 3, 'J').set(9, 2, 'R').set(11, 4, 'J').set(7, 4, 'K').set(4, 5, 'R').set(10, 5, 'K');
  return c.rows();
}

export const DISH_SPRITES: Record<string, SpriteDef> = {
  pie: def(pie()),
  soup: def(soup()),
  sandwich: def(sandwich()),
  salad: def(salad()),
};

// ---------- кнопки и мелочи ----------

function house(): string[] {
  const c = new CharCanvas(14, 13);
  for (let y = 0; y <= 6; y++) {
    for (let x = 6 - y; x <= 7 + y; x++) c.set(x, y, x === 6 - y || x === 7 + y || y === 6 ? 'O' : 'J');
  }
  c.box(2, 6, 10, 7, 'B');
  c.box(6, 8, 4, 5, 'D');
  c.box(3, 8, 3, 3, 'L');
  return c.rows();
}

function miniTable(): string[] {
  const c = new CharCanvas(14, 10);
  c.box(1, 6, 2, 4, 'D').box(11, 6, 2, 4, 'D');
  c.box(0, 4, 14, 3, 'P');
  c.blit(['OOOOOO', 'OYMYMO', '.OOOO.'], 4, 1);
  return c.rows();
}

function thoughtBubble(): CharCanvas {
  const c = new CharCanvas(15, 13);
  c.disc(9, 5, 5.8, 5, 'W');
  c.disc(3, 10.5, 1.6, 1.6, 'W');
  c.disc(1, 12.5, 1, 1, 'W');
  return c;
}

/** Мысль-облачко с семечкой: Пушок проголодался. */
function thought(): string[] {
  const c = thoughtBubble();
  c.set(9, 2, 'E').set(8, 3, 'E').set(9, 3, 'W').set(10, 3, 'E').set(8, 4, 'E').set(9, 4, 'W').set(10, 4, 'E');
  c.set(8, 5, 'E').set(9, 5, 'W').set(10, 5, 'E').set(9, 6, 'E').set(9, 7, 'E');
  return c.rows();
}

/** Мысль с облачком: «денежки зарабатывают на облачке». */
function thoughtCloud(): string[] {
  const c = thoughtBubble();
  c.blit(['..CCC..', '.CCCCCC', 'CCCCCCC', '.CCCCC.'], 6, 3);
  return c.rows();
}

function pot(): string[] {
  const c = new CharCanvas(48, 28);
  c.box(0, 10, 5, 7, 'J').box(43, 10, 5, 7, 'J'); // ручки
  c.box(3, 5, 42, 23, 'J');
  c.rect(4, 9, 40, 2, 'P');
  c.set(8, 14, 'W').set(8, 15, 'W').set(9, 14, 'W');
  c.box(1, 3, 46, 4, 'S'); // бортик
  return c.rows();
}

const SPOON = def([
  '.OO.',
  '.OO.',
  '.OD.',
  '.OD.',
  '.OD.',
  '.OD.',
  '.OD.',
  '.OD.',
  'OOOO',
  'OSSO',
  'OSSO',
  '.OO.',
]);

export const ITEM_ICONS = {
  house: def(house()),
  miniTable: def(miniTable()),
  thought: def(thought()),
  thoughtCloud: def(thoughtCloud()),
  pot: def(pot()),
  spoon: SPOON,
  coin: COIN,
} as const;

// ---------- гитары ----------

function guitar(): string[] {
  const c = new CharCanvas(16, 10);
  // гриф к правому верхнему углу
  for (let t = 0; t <= 7; t++) {
    const x = 7 + t;
    const y = 5 - Math.floor(t / 2);
    c.set(x, y - 1, 'O').set(x, y, 'D').set(x, y + 1, 'O');
  }
  c.box(13, 0, 3, 3, 'D');
  // корпус «восьмеркой»
  c.disc(4.5, 6, 4.4, 3.8, 'B');
  c.disc(7.5, 5.5, 2.6, 2.6, 'B');
  c.set(5, 5, 'E').set(5, 6, 'E').set(6, 5, 'E').set(6, 6, 'E');
  // лапки, которые держат гитару
  c.blit(['OOO', 'OWO', 'OOO'], 0, 7);
  c.blit(['OOO', 'OWO', 'OOO'], 9, 3);
  return c.rows();
}
const GUITAR_BASE = def(guitar());
export const GUITARS: Record<string, SpriteDef> = {
  pink: recolor(GUITAR_BASE, { B: '#F7A9C0' }),
  blue: recolor(GUITAR_BASE, { B: '#8ECDF2' }),
  gold: recolor(GUITAR_BASE, { B: '#F5C542' }),
};

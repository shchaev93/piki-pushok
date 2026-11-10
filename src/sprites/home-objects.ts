import { CharCanvas, type SpriteDef } from './grid';

// Мебель домика и мелкие спрайты. Общая палитра в стиле pushok.svg:
// темный контур 'O' и 4-6 цветов на предмет.
export const FURN_PALETTE = {
  O: '#5A4650',
  W: '#FFFFFF',
  B: '#E7B985', // светлое дерево
  D: '#B9825A', // темное дерево
  P: '#F7A9C0',
  J: '#E8457A',
  C: '#8ECDF2',
  L: '#D6F0FC',
  Y: '#F5C542',
  G: '#9BD38A',
  R: '#F5A04A',
  S: '#CBD2DE',
  M: '#A0673C',
  E: '#2B2B3A',
  V: '#C9A6E8',
  K: '#5E9E58', // темная зелень
  N: '#D93A55', // вишня
  A: '#F9C37A', // супчик
} as const;

const def = (rows: string[]): SpriteDef => ({ rows, palette: FURN_PALETTE });

function bed(blanketOver: boolean): string[] {
  const c = new CharCanvas(30, 16);
  c.box(0, 0, 5, 16, 'D'); // изголовье
  c.box(25, 5, 5, 11, 'D'); // изножье
  c.box(4, 7, 22, 4, 'W'); // матрас
  c.box(4, 10, 22, 4, 'B'); // царга
  if (!blanketOver) {
    c.box(5, 4, 8, 4, 'W'); // подушка
    c.box(12, 6, 14, 5, 'P'); // одеяло
    for (const x of [15, 19, 23]) c.set(x, 8, 'J');
  }
  return c.rows();
}

/** Одеяло поверх спящего Пушка. */
function bedBlanket(): string[] {
  const c = new CharCanvas(30, 16);
  c.box(5, 5, 21, 6, 'P');
  for (const x of [8, 12, 16, 20, 24]) c.set(x, 7, 'J');
  for (const x of [10, 14, 18, 22]) c.set(x, 9, 'J');
  return c.rows();
}

function table(): string[] {
  const c = new CharCanvas(24, 14);
  c.box(2, 6, 3, 8, 'D');
  c.box(19, 6, 3, 8, 'D');
  c.box(0, 3, 24, 4, 'P'); // скатерть
  for (let x = 2; x < 23; x += 3) c.set(x, 4, 'W');
  for (let x = 3; x < 23; x += 3) c.set(x, 5, 'W');
  c.blit(['OOOOOOOO', 'OYMYYMYO', '.OYYYYO.', '..OOOO..'], 8, 0); // мисочка с семечками
  return c.rows();
}

function bath(): string[] {
  const c = new CharCanvas(26, 16);
  c.box(21, 0, 3, 4, 'S'); // кран
  c.box(0, 4, 26, 3, 'W'); // бортик
  c.rect(1, 5, 24, 1, 'L');
  c.box(1, 6, 24, 7, 'W');
  c.rect(2, 9, 22, 1, 'C');
  c.box(3, 12, 4, 4, 'Y');
  c.box(19, 12, 4, 4, 'Y');
  return c.rows();
}

function toilet(): string[] {
  const c = new CharCanvas(11, 16);
  c.box(1, 1, 8, 6, 'C'); // бачок
  c.box(6, 2, 2, 2, 'S'); // кнопка смыва
  c.box(0, 6, 11, 3, 'W'); // сиденье
  c.box(2, 8, 7, 5, 'W');
  c.box(1, 12, 9, 4, 'W');
  return c.rows();
}

function trampoline(): string[] {
  const c = new CharCanvas(30, 12);
  c.box(4, 4, 3, 8, 'S');
  c.box(23, 4, 3, 8, 'S');
  c.box(0, 2, 30, 4, 'J');
  for (let x = 3; x < 28; x += 4) c.rect(x, 3, 2, 2, 'Y');
  c.rect(1, 1, 28, 1, 'C'); // сетка-батут
  c.rect(1, 0, 28, 1, 'O');
  return c.rows();
}

/** Горка: лесенка слева, площадка, скат под 45° вправо вниз. */
function slide(): string[] {
  const c = new CharCanvas(38, 30);
  c.box(0, 2, 3, 28, 'S');
  c.box(7, 2, 3, 28, 'S');
  for (let y = 7; y < 28; y += 5) c.rect(3, y, 4, 2, 'O');
  c.box(23, 17, 3, 13, 'S'); // опора
  c.box(0, 0, 13, 4, 'B'); // площадка
  for (let t = 0; t <= 24; t++) {
    const x = 12 + t;
    const y = 1 + t;
    c.set(x, y, 'O').set(x, y + 1, 'Y').set(x, y + 2, 'Y').set(x, y + 3, 'O');
  }
  c.rect(36, 25, 2, 4, 'O').rect(36, 26, 1, 2, 'Y');
  return c.rows();
}

function climber(): string[] {
  const c = new CharCanvas(26, 42);
  const top = 4;
  c.box(0, top, 4, 38, 'R');
  c.box(22, top, 4, 38, 'R');
  for (const y of [9, 17, 25]) c.box(3, top + y, 20, 3, 'G');
  c.box(0, top, 26, 4, 'R');
  c.rect(12, 0, 1, top, 'O'); // флажок
  c.blit(['OOOO.', 'OJJJO', 'OOOO.'], 13, 0);
  return c.rows();
}

/** Скакалка лежит на полу петлей. */
function rope(): string[] {
  const c = new CharCanvas(28, 9);
  for (let x = 3; x <= 24; x++) {
    const t = (x - 13.5) / 10.5;
    const y = Math.round(3 + 4 * (1 - t * t));
    c.set(x, y, 'J').set(x, y + 1, 'O');
  }
  c.box(0, 1, 4, 6, 'Y');
  c.box(24, 1, 4, 6, 'Y');
  return c.rows();
}

function kitchen(): string[] {
  const c = new CharCanvas(34, 34);
  c.box(0, 15, 34, 19, 'B'); // тумба
  c.box(4, 19, 16, 12, 'S'); // духовка
  c.box(7, 22, 10, 5, 'E');
  c.rect(8, 23, 3, 1, 'R');
  c.box(23, 19, 8, 12, 'D');
  c.set(24, 25, 'O');
  c.box(0, 12, 34, 4, 'S'); // плита
  for (const x of [25, 29]) c.set(x, 13, 'E');
  c.box(8, 5, 16, 8, 'J'); // кастрюлька
  c.rect(9, 7, 14, 1, 'P');
  c.box(6, 7, 3, 3, 'J').box(23, 7, 3, 3, 'J'); // ручки
  c.box(7, 3, 18, 3, 'S'); // крышка
  c.box(14, 0, 4, 4, 'S');
  return c.rows();
}

export const HOME_SPRITES = {
  bed: def(bed(false)),
  bedSleep: def(bed(true)),
  bedBlanket: def(bedBlanket()),
  table: def(table()),
  bath: def(bath()),
  toilet: def(toilet()),
  trampoline: def(trampoline()),
  slide: def(slide()),
  climber: def(climber()),
  rope: def(rope()),
  kitchen: def(kitchen()),
} as const;

/** Частицы и мелочи. */
export const SMALL_SPRITES = {
  z: def(['OOOO', '..O.', '.O..', 'OOOO']),
  bubble: def(['.OO.', 'OLWO', 'OLLO', '.OO.']),
  heart: def(['.O.O.', 'OJOJO', 'OJJJO', '.OJO.', '..O..']),
  sparkle: def(['.Y.', 'YWY', '.Y.']),
  note: def(['..OO', '..OO', '..O.', 'OOO.', 'OOO.']),
  steam: def(['.WW.', 'WWWW', '.WW.']),
  crumb: def(['YM', 'MY']),
} as const;

export type HomeSpriteId = keyof typeof HOME_SPRITES;
export type SmallSpriteId = keyof typeof SMALL_SPRITES;

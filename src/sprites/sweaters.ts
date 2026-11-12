import type { SpriteDef } from './grid';
import { FURN_PALETTE } from './home-objects';

// Кофточки: слой на нижней половине Пушка (строки 10-15 базовой сетки, по ширине тела)
// и отдельная иконка-кофточка для гардероба. Символы = общая палитра предметов.

/** Шаблон слоя: B = основной цвет, A = отделка (резинка внизу), O = контур. */
const LAYER = [
  'OBBBBBBOOOBBBBBBO', // ворот: V-вырез под мордочкой
  'OBBBBBBBOBBBBBBBO',
  'OBBBBBBBBBBBBBBBO',
  'OBBBOBBBBBBBOBBBO', // лапки, как в базовой сетке
  '.OAAAAAAAAAAAAAO.', // резинка
  '..OOOOOOOOOOOOO..',
];

const ICON = [
  '..OOO....OOO..',
  '.OBBBOOOOBBBO.',
  'OBBBBBBBBBBBBO',
  'OBBOBBBBBBOBBO',
  'OOO.OBBBBO.OOO',
  '....OBBBBO....',
  '....OAAAAO....',
  '....OOOOOO....',
];

/** Узор: для клетки B в (x, строка) вернуть символ другого цвета или null. */
type Pattern = (x: number, row: number) => string | null;

function paint(template: readonly string[], base: string, accent: string, pattern: Pattern): string[] {
  return template.map((r, row) =>
    r
      .split('')
      .map((ch, x) => (ch === 'B' ? (pattern(x, row) ?? base) : ch === 'A' ? accent : ch))
      .join(''),
  );
}

interface SweaterStyle {
  base: string;
  accent: string;
  /** узор на слое (по координатам слоя) */
  layer: Pattern;
  /** узор на иконке (по координатам иконки) */
  icon: Pattern;
}

const STYLES: Record<string, SweaterStyle> = {
  // розовая с сердечком
  heart: {
    base: 'P',
    accent: 'J',
    layer: (x, r) => ((r === 1 && (x === 7 || x === 9)) || (r === 2 && x >= 7 && x <= 9) || (r === 3 && x === 8) ? 'J' : null),
    icon: (x, r) => ((r === 2 && (x === 6 || x === 8)) || (r === 3 && x >= 6 && x <= 8) || (r === 4 && x === 7) ? 'J' : null),
  },
  // голубая в полоску
  stripes: {
    base: 'C',
    accent: 'W',
    layer: (_x, r) => (r === 1 || r === 3 ? 'W' : null),
    icon: (_x, r) => (r === 2 || r === 5 ? 'W' : null),
  },
  // желтая в горошек
  dots: {
    base: 'Y',
    accent: 'R',
    layer: (x, r) => ((x + r * 2) % 4 === 0 ? 'R' : null),
    icon: (x, r) => ((x + r * 2) % 4 === 0 ? 'R' : null),
  },
  // зеленая со звездочкой
  star: {
    base: 'G',
    accent: 'Y',
    layer: (x, r) => ((r === 1 && x === 8) || (r === 2 && x >= 7 && x <= 9) || (r === 3 && (x === 7 || x === 9)) ? 'Y' : null),
    icon: (x, r) => ((r === 2 && x === 7) || (r === 3 && x >= 6 && x <= 8) || (r === 4 && (x === 6 || x === 8)) ? 'Y' : null),
  },
  // сиреневая с зигзагом
  zigzag: {
    base: 'V',
    accent: 'W',
    layer: (x, r) => ((r === 1 && x % 4 === 1) || (r === 2 && x % 2 === 0) || (r === 3 && x % 4 === 3) ? 'W' : null),
    icon: (x, r) => ((r === 3 && x % 2 === 0) || (r === 5 && x % 2 === 1) ? 'W' : null),
  },
  // радужная
  rainbow: {
    base: 'J',
    accent: 'C',
    layer: (_x, r) => ['J', 'R', 'Y', 'G'][r] ?? null,
    icon: (_x, r) => ['J', 'J', 'R', 'Y', 'G', 'C'][r] ?? null,
  },
};

const def = (rows: string[]): SpriteDef => ({ rows, palette: FURN_PALETTE });

/** Слой кофточки на Пушке. */
export const SWEATERS: Record<string, SpriteDef> = Object.fromEntries(
  Object.entries(STYLES).map(([id, st]) => [id, def(paint(LAYER, st.base, st.accent, st.layer))]),
);

/** Иконка кофточки для гардероба и вкладки. */
export const SWEATER_ICONS: Record<string, SpriteDef> = Object.fromEntries(
  Object.entries(STYLES).map(([id, st]) => [id, def(paint(ICON, st.base, st.accent, st.icon))]),
);

/** Высота слоя в строках сетки. */
export const SWEATER_ROWS = LAYER.length;

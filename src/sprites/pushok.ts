import { compose, parseGrid, patch, type Composed, type Grid, type SpriteDef } from './grid';
import { HATS, type HatId } from './hats';

// Палитра и базовая сетка из ТЗ, без изменений.
export const PUSHOK_PALETTE = {
  O: '#5A4650', // контур
  W: '#FFFFFF', // шерсть
  P: '#F7A9C0', // уши внутри
  R: '#F5A04A', // оранжевые пятнышки у глаз
  E: '#2B2B3A', // глаза
  H: '#B9C3E3', // блик в глазах
  N: '#E07A8F', // нос
  M: '#A0673C', // пятнышко на пузике
} as const;

export const PUSHOK_BASE: readonly string[] = [
  '..OOO.......OOO..',
  '.OPPWO.....OWPPO.',
  '.OPWWOOOOOOOWWPO.',
  '.OWWWWWWWWWWWWWO.',
  'OWWWWWWWWWWWWWWWO',
  'ORRHEEWWWWWHEERRO',
  'ORREEEWWWWWEEERRO',
  'OWREEEWWWWWEEERWO',
  'OWWWWWWWNWWWWWWWO',
  'OWWWWWWOWOWWWWWWO',
  'OWWWWWWWWWWWWWWWO',
  'OWWWWWWMMMWWWWWWO',
  'OWWWWWWMMMWWWWWWO',
  'OWWWOWWWWWWWOWWWO',
  '.OWWWWWWWWWWWWWO.',
  '..OOOOOOOOOOOOO..',
];

/** Якорь шляпки: нижний ряд шляпки ложится на строку 1, колонки 5-11. */
export const HAT_ANCHOR = { bottomRow: 1, col: 5, width: 7 } as const;

const EYE_COLS = [3, 11] as const;

function eyes(rows: readonly string[], r5: string, r6: string, r7: string): string[] {
  let out = [...rows];
  for (const c of EYE_COLS) {
    out = patch(out, 5, c, r5);
    out = patch(out, 6, c, r6);
    out = patch(out, 7, c, r7);
  }
  return out;
}

/** Глаза закрыты: горизонтальная линия в 3 пикселя вместо каждого глаза. */
export const closedEyes = (rows: readonly string[]) => eyes(rows, 'WWW', 'OOO', 'WWW');
/** Радостные глаза-дужки ^ ^. */
const happyEyes = (rows: readonly string[]) => eyes(rows, 'WEW', 'EWE', 'WWW');
/** Тяжелые веки: грустный взгляд. */
const sadEyes = (rows: readonly string[]) => eyes(rows, 'OOO', 'HEE', 'EEE');

/** Сжатие: убираем ровный ряд тела (строка 10). Спрайт рисуется от нижнего края. */
const squash = (rows: readonly string[]) => rows.filter((_, i) => i !== 10);
/** Вытягивание: дублируем строку 10. */
const stretch = (rows: readonly string[]) => [...rows.slice(0, 11), ...rows.slice(10)];

const mouthOpen = (rows: readonly string[]) => patch(patch(rows, 9, 7, 'OEO'), 10, 7, 'WEW');
const mouthMunch = (rows: readonly string[]) => patch(rows, 9, 7, 'OOO');

/** Грусть: уши опущены в стороны, рот уголками вниз, поза ниже на 1 ряд. */
function sadPose(rows: readonly string[]): string[] {
  let out = [...rows];
  out[0] = '.................';
  out[1] = 'OOO...........OOO';
  out[2] = 'OPPOOOOOOOOOOOPPO';
  out = sadEyes(out);
  out = patch(out, 9, 7, 'WOW');
  out = patch(out, 10, 7, 'OWO');
  return out.filter((_, i) => i !== 12);
}

export const PUSHOK_FRAMES = {
  base: PUSHOK_BASE,
  blink: closedEyes(PUSHOK_BASE),
  /** Медитация на облачке (этап 2) и сон: глаза закрыты. */
  meditate: closedEyes(PUSHOK_BASE),
  sleep: closedEyes(PUSHOK_BASE),
  hopSquash: squash(PUSHOK_BASE),
  hopStretch: stretch(PUSHOK_BASE),
  /** Радость: 2 кадра подпрыгивания. */
  happy1: squash(happyEyes(PUSHOK_BASE)),
  happy2: stretch(happyEyes(PUSHOK_BASE)),
  /** Грусть (режим «очень голодный», этап 3). */
  sad: sadPose(PUSHOK_BASE),
  eatOpen: mouthOpen(PUSHOK_BASE),
  eatMunch: mouthMunch(PUSHOK_BASE),
  sniff: happyEyes(mouthMunch(PUSHOK_BASE)),
} as const;

export type PushokFrame = keyof typeof PUSHOK_FRAMES;

export function pushokDef(frame: PushokFrame): SpriteDef {
  return { rows: PUSHOK_FRAMES[frame], palette: PUSHOK_PALETTE };
}

/**
 * Пушок в кадре frame со шляпкой hat поверх головы.
 * oy в результате = на сколько пикселей шляпка подняла холст над сеткой Пушка.
 */
export function pushokWithHat(frame: PushokFrame, hat: HatId | null): Composed {
  const body: Grid = parseGrid(pushokDef(frame), `pushok.${frame}`);
  if (!hat) return { grid: body, ox: 0, oy: 0 };
  const hatGrid = parseGrid(HATS[hat], `hat.${hat}`);
  // Кадры с убранными или добавленными рядами меняют высоту, но голова
  // (строки 0-9) остается на своих индексах, поэтому якорь общий.
  return compose([
    { grid: body, x: 0, y: 0 },
    { grid: hatGrid, x: HAT_ANCHOR.col, y: HAT_ANCHOR.bottomRow - (hatGrid.h - 1) },
  ]);
}

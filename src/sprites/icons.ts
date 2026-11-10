import { CharCanvas, type SpriteDef } from './grid';
import { FURN_PALETTE } from './home-objects';

const def = (rows: string[]): SpriteDef => ({ rows, palette: FURN_PALETTE });

/** Круглая подложка кнопки 22×22. */
function buttonFrame(fill: string): string[] {
  const c = new CharCanvas(22, 22);
  const r = 10.5;
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 22; x++) {
      const d = Math.hypot(x - 10.5, y - 10.5);
      if (d <= r - 1.2) c.set(x, y, fill);
      else if (d <= r) c.set(x, y, 'O');
    }
  }
  return c.rows();
}

export const ICONS = {
  button: def(buttonFrame('W')),
  /** Облачко = мини-игра. */
  cloud: def([
    '......OOOO......',
    '.....OWWWWO.....',
    '..OOOWWWWWWOOO..',
    '.OWWWWWWWWWWWWO.',
    'OWWWLWWWWWWLWWWO',
    'OWWWWWWWWWWWWWWO',
    'OLWWWWWWWWWWWWLO',
    '.OLLLLLLLLLLLLO.',
    '..OOOOOOOOOOOO..',
  ]),
  /** Гардероб = шкаф. */
  wardrobe: def([
    'OOOOOOOOOOOO',
    'OBBBBOOBBBBO',
    'OBBBBOOBBBBO',
    'OBBBBOOBBBBO',
    'OBBBYOOYBBBO',
    'OBBBBOOBBBBO',
    'OBBBBOOBBBBO',
    'OBBBBOOBBBBO',
    'OOOOOOOOOOOO',
    '.OO......OO.',
  ]),
  /** Магазин еды = корзинка с яблочком. */
  basket: def([
    '....OOOOOO....',
    '...O......O...',
    '..O...OO...O..',
    '..O..OJJO..O..',
    'OOOOOOJJOOOOOO',
    'OBDBDBDBDBDBDO',
    '.ODBDBDBDBDBO.',
    '.OBDBDBDBDBDO.',
    '..OOOOOOOOOO..',
  ]),
  /** Шестеренка для взрослых. */
  gear: def([
    '.....OO.....',
    '..O.OSSO.O..',
    '.OSOSSSSOSO.',
    '..OSSSSSSO..',
    '.OSSSOOSSSO.',
    'OSSSO..OSSSO',
    'OSSSO..OSSSO',
    '.OSSSOOSSSO.',
    '..OSSSSSSO..',
    '.OSOSSSSOSO.',
    '..O.OSSO.O..',
    '.....OO.....',
  ]),
  /** Телефон для экрана «поверни». */
  phone: def([
    'OOOOOOOOOO',
    'OEEEEEEEEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OELLLLLLEO',
    'OEEEEEEEEO',
    'OEEEOOEEEO',
    'OOOOOOOOOO',
  ]),
} as const;

export type IconId = keyof typeof ICONS;

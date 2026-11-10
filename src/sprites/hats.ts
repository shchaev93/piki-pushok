import type { SpriteDef } from './grid';

// Шляпки рисуются отдельным слоем над головой Пушка (см. HAT_ANCHOR в pushok.ts).
// Ширина каждой шляпки 7 колонок, они ложатся на колонки 5-11 базовой сетки,
// нижний ряд шляпки = строка 1 базовой сетки.
// Корона утверждена. Остальные предварительные, финал согласуется с ребенком.

const HAT_PALETTE = {
  O: '#5A4650',
  W: '#FFFFFF',
  Y: '#F5C542',
  J: '#E8457A',
  P: '#F7A9C0',
  G: '#9BD38A',
  C: '#8ECDF2',
  N: '#D93A55',
  V: '#C9A6E8',
  K: '#5E9E58',
};

export const HATS = {
  crown: {
    rows: ['.Y.Y.Y.', '.YYYYY.', '.YJYJY.'],
    palette: { Y: '#F5C542', J: '#E8457A' },
  },
  bow: {
    rows: ['.OO.OO.', 'OPPOPPO', 'OPJJJPO', 'OPPOPPO', '.OO.OO.'],
    palette: HAT_PALETTE,
  },
  wreath: {
    rows: ['.P.Y.P.', 'PYPKPYP', 'GKGGGKG'],
    palette: HAT_PALETTE,
  },
  pompom: {
    rows: ['..OOO..', '..OWO..', '.OOOOO.', '.OCCCO.', 'OCCCCCO', 'OWWWWWO'],
    palette: HAT_PALETTE,
  },
  cherry: {
    rows: ['....O..', '...OK..', '..ONNO.', '.OONNOO', '.OPPPPO', 'OOOOOOO'],
    palette: HAT_PALETTE,
  },
  heart: {
    rows: ['.OO.OO.', 'OJJOJJO', 'OJJJJJO', '.OJJJO.', 'VVOJOVV'],
    palette: HAT_PALETTE,
  },
} satisfies Record<string, SpriteDef>;

export type HatId = keyof typeof HATS;

export const isHatId = (id: string | null): id is HatId => id !== null && id in HATS;

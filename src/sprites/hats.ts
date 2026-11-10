import type { SpriteDef } from './grid';

// Шляпки рисуются отдельным слоем над головой Пушка (см. HAT_ANCHOR в pushok.ts).
// Ширина каждой шляпки 7 колонок, они ложатся на колонки 5-11 базовой сетки.
// Остальные 5 шляпок появятся на этапе 4 после согласования с ребенком.

export const HATS = {
  crown: {
    rows: ['.Y.Y.Y.', '.YYYYY.', '.YJYJY.'],
    palette: { Y: '#F5C542', J: '#E8457A' },
  },
} satisfies Record<string, SpriteDef>;

export type HatId = keyof typeof HATS;

// Спрайты задаются сетками символов: одна строка = один ряд пикселей,
// символ = цвет из палитры, '.' = прозрачный пиксель.
// Модуль не зависит от DOM, поэтому его используют и тесты, и генератор иконок.

export type Palette = Readonly<Record<string, string>>;

export interface SpriteDef {
  rows: readonly string[];
  palette: Palette;
}

/** Готовая растровая сетка: цвет каждого пикселя или null. */
export interface Grid {
  w: number;
  h: number;
  px: (string | null)[];
}

export function parseGrid(def: SpriteDef, name = 'sprite'): Grid {
  const { rows, palette } = def;
  if (rows.length === 0) throw new Error(`${name}: пустая сетка`);
  const w = rows[0].length;
  const px: (string | null)[] = [];
  rows.forEach((row, y) => {
    if (row.length !== w) {
      throw new Error(`${name}: строка ${y} длиной ${row.length}, ожидалось ${w}`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.') {
        px.push(null);
        continue;
      }
      const color = palette[ch];
      if (!color) throw new Error(`${name}: неизвестный символ '${ch}' в (${x}, ${y})`);
      px.push(color);
    }
  });
  return { w, h: rows.length, px };
}

export function pixelAt(g: Grid, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
  return g.px[y * g.w + x];
}

export interface Layer {
  grid: Grid;
  /** Положение левого верхнего угла слоя в координатах базового слоя. */
  x: number;
  y: number;
}

export interface Composed {
  grid: Grid;
  /** Где в итоговой сетке оказалась точка (0,0) базовых координат. */
  ox: number;
  oy: number;
}

/** Накладывает слои по порядку. Холст расширяется, если слой выходит за край. */
export function compose(layers: readonly Layer[]): Composed {
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  const maxX = Math.max(...layers.map((l) => l.x + l.grid.w));
  const maxY = Math.max(...layers.map((l) => l.y + l.grid.h));
  const w = maxX - minX;
  const h = maxY - minY;
  const px: (string | null)[] = new Array(w * h).fill(null);
  for (const l of layers) {
    for (let y = 0; y < l.grid.h; y++) {
      for (let x = 0; x < l.grid.w; x++) {
        const c = l.grid.px[y * l.grid.w + x];
        if (c) px[(l.y - minY + y) * w + (l.x - minX + x)] = c;
      }
    }
  }
  return { grid: { w, h, px }, ox: -minX, oy: -minY };
}

/** Перекраска: заменяет цвета по таблице (например, другая гитара или шляпка). */
export function recolor(def: SpriteDef, changes: Record<string, string>): SpriteDef {
  return { rows: def.rows, palette: { ...def.palette, ...changes } };
}

/** Заменяет кусок строки сетки, начиная с колонки col. */
export function patch(rows: readonly string[], row: number, col: number, text: string): string[] {
  const out = [...rows];
  const r = out[row];
  if (col + text.length > r.length) throw new Error(`patch: выход за край строки ${row}`);
  out[row] = r.slice(0, col) + text + r.slice(col + text.length);
  return out;
}

/**
 * Рисовалка сеток для крупных предметов (мебель): те же символы палитры,
 * но собранные из прямоугольников и линий. Результат = обычные строки сетки.
 */
export class CharCanvas {
  private cells: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => new Array<string>(w).fill('.'));
  }

  set(x: number, y: number, ch: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y][x] = ch;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
    return this;
  }

  /** Прямоугольник с темным контуром 'O' и заливкой fill. */
  box(x: number, y: number, w: number, h: number, fill: string, outline = 'O'): this {
    this.rect(x, y, w, h, outline);
    if (w > 2 && h > 2) this.rect(x + 1, y + 1, w - 2, h - 2, fill);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, ch: string): this {
    // Брезенхэм
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, ch);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return this;
  }

  /** Вставляет другую сетку символов ('.' не перекрывает). */
  blit(rows: readonly string[], x: number, y: number): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] !== '.') this.set(x + i, y + j, row[i]);
    });
    return this;
  }

  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }
}

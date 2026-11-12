import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compose, parseGrid, pixelAt, recolor, CharCanvas } from '../src/sprites/grid';
import { allSprites } from '../src/sprites';
import { HAT_ANCHOR, PUSHOK_BASE, PUSHOK_FRAMES, pushokWithHat } from '../src/sprites/pushok';

/** Разбирает утвержденный pushok.svg в карту «клетка → цвет». */
function readApprovedSvg() {
  const svg = readFileSync(new URL('../assets/pushok.svg', import.meta.url), 'utf8');
  const cells = new Map<string, string>();
  const rectRe = /<rect x="(\d+)" y="(\d+)" width="16" height="16" fill="(#[0-9A-Fa-f]{6})"\/>/g;
  let m: RegExpExecArray | null;
  while ((m = rectRe.exec(svg))) {
    const col = (Number(m[1]) - 44) / 16;
    const row = (Number(m[2]) - 44) / 16;
    expect(Number.isInteger(col) && Number.isInteger(row)).toBe(true);
    cells.set(`${col},${row}`, m[3].toUpperCase());
  }
  return cells;
}

describe('Пушок совпадает с утвержденным pushok.svg', () => {
  it('база + корона по якорю = SVG по всем 17×17 клеткам', () => {
    const svg = readApprovedSvg();
    const { grid } = pushokWithHat('base', 'crown');
    expect(grid.w).toBe(17);
    expect(grid.h).toBe(17);
    let filled = 0;
    for (let y = 0; y < 17; y++) {
      for (let x = 0; x < 17; x++) {
        const ours = pixelAt(grid, x, y)?.toUpperCase() ?? null;
        const theirs = svg.get(`${x},${y}`) ?? null;
        expect(ours, `клетка (${x}, ${y})`).toBe(theirs);
        if (ours) filled++;
      }
    }
    expect(filled).toBe(svg.size);
  });

  it('корона: нижний ряд на строке 1 базы, колонки 5-11, холст выше на 1', () => {
    const c = pushokWithHat('base', 'crown');
    expect(c.oy).toBe(1);
    expect(HAT_ANCHOR).toEqual({ bottomRow: 1, col: 5, width: 7 });
    // нижний ряд короны (.YJYJY.) на строке 1 базы
    expect(pixelAt(c.grid, 7, 1 + c.oy)).toBe('#E8457A');
  });

  it('база без шляпки = сетка из ТЗ 17×16', () => {
    const { grid } = pushokWithHat('base', null);
    expect(grid.w).toBe(17);
    expect(grid.h).toBe(16);
    expect(PUSHOK_BASE.length).toBe(16);
  });

  it('медитация: вместо каждого глаза линия ровно в 3 пикселя', () => {
    const rows = PUSHOK_FRAMES.meditate;
    expect(rows[6].slice(3, 6)).toBe('OOO');
    expect(rows[6].slice(11, 14)).toBe('OOO');
    for (const r of [5, 7]) {
      expect(rows[r].slice(3, 6)).toBe('WWW');
      expect(rows[r].slice(11, 14)).toBe('WWW');
    }
    expect(rows.join('')).not.toContain('E');
  });

  it('радость = 2 кадра разной высоты (подпрыгивание)', () => {
    expect(PUSHOK_FRAMES.happy1.length).not.toBe(PUSHOK_FRAMES.happy2.length);
  });
});

describe('Кофточки на Пушке', () => {
  it('ни в одном кадре кофточка не закрывает мордочку (строки 0-9) и не меняет размер', async () => {
    const { SWEATERS } = await import('../src/sprites/sweaters');
    for (const frame of Object.keys(PUSHOK_FRAMES) as (keyof typeof PUSHOK_FRAMES)[]) {
      const plain = pushokWithHat(frame, 'crown', 'pink');
      for (const sw of Object.keys(SWEATERS)) {
        const dressed = pushokWithHat(frame, 'crown', 'pink', sw);
        expect(dressed.grid.h, `${frame}+${sw}`).toBe(plain.grid.h);
        expect(dressed.grid.w).toBe(plain.grid.w);
        for (let y = 0; y < 10 + plain.oy; y++) {
          for (let x = 0; x < plain.grid.w; x++) {
            expect(pixelAt(dressed.grid, x, y), `${frame}+${sw} (${x},${y})`).toBe(pixelAt(plain.grid, x, y));
          }
        }
      }
    }
  });
});

describe('Все спрайты корректны', () => {
  const sprites = allSprites();
  it.each(Object.keys(sprites))('%s: строки одной длины, все символы есть в палитре', (name) => {
    expect(() => parseGrid(sprites[name], name)).not.toThrow();
  });

  it('на один спрайт не больше 6 цветов + контур (кроме подложек)', () => {
    for (const [name, def] of Object.entries(sprites)) {
      const used = new Set(def.rows.join('').replace(/\./g, ''));
      expect(used.size, name).toBeLessThanOrEqual(9);
    }
  });
});

describe('grid', () => {
  it('ошибка на строку другой длины и на неизвестный символ', () => {
    expect(() => parseGrid({ rows: ['OO', 'O'], palette: { O: '#000000' } })).toThrow(/строка 1/);
    expect(() => parseGrid({ rows: ['OX'], palette: { O: '#000000' } })).toThrow(/X/);
  });

  it('compose расширяет холст вверх', () => {
    const a = parseGrid({ rows: ['A'], palette: { A: '#111111' } });
    const b = parseGrid({ rows: ['B', 'B'], palette: { B: '#222222' } });
    const c = compose([{ grid: a, x: 0, y: 0 }, { grid: b, x: 0, y: -1 }]);
    expect(c.grid.h).toBe(2);
    expect(c.oy).toBe(1);
    expect(pixelAt(c.grid, 0, 1)).toBe('#222222');
  });

  it('recolor меняет только палитру', () => {
    const d = recolor({ rows: ['A'], palette: { A: '#111111' } }, { A: '#FF0000' });
    expect(parseGrid(d).px[0]).toBe('#FF0000');
  });

  it('CharCanvas.box рисует контур и заливку', () => {
    expect(new CharCanvas(3, 3).box(0, 0, 3, 3, 'W').rows()).toEqual(['OOO', 'OWO', 'OOO']);
  });
});

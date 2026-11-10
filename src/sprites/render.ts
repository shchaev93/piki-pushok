import { parseGrid, type Grid, type SpriteDef } from './grid';
import { pushokWithHat, type PushokFrame } from './pushok';
import type { HatId } from './hats';

// Перевод сеток в канвасы (1 клетка = 1 px). Масштабирует уже контекст сцены.

export interface Bitmap {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** Смещение точки (0,0) исходной сетки внутри bitmap (нужно для шляпок). */
  ox: number;
  oy: number;
}

export function gridToCanvas(g: Grid): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = g.w;
  canvas.height = g.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  g.px.forEach((c, i) => {
    if (!c) return;
    const n = parseInt(c.slice(1), 16);
    img.data[i * 4] = (n >> 16) & 255;
    img.data[i * 4 + 1] = (n >> 8) & 255;
    img.data[i * 4 + 2] = n & 255;
    img.data[i * 4 + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const cache = new Map<string, Bitmap>();

export function bitmap(key: string, def: SpriteDef): Bitmap {
  let b = cache.get(key);
  if (!b) {
    const g = parseGrid(def, key);
    b = { canvas: gridToCanvas(g), w: g.w, h: g.h, ox: 0, oy: 0 };
    cache.set(key, b);
  }
  return b;
}

export function pushokBitmap(frame: PushokFrame, hat: HatId | null): Bitmap {
  const key = `pushok:${frame}:${hat ?? '-'}`;
  let b = cache.get(key);
  if (!b) {
    const c = pushokWithHat(frame, hat);
    b = { canvas: gridToCanvas(c.grid), w: c.grid.w, h: c.grid.h, ox: c.ox, oy: c.oy };
    cache.set(key, b);
  }
  return b;
}

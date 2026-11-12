import type { Pushok } from '../pushok/actor';
import { PUSHOK_FRAMES } from '../sprites/pushok';
import { bitmap, pushokBitmap, type Bitmap } from '../sprites/render';
import type { SpriteDef } from '../sprites/grid';
import type { Layout } from './layout';

/**
 * Рисование в логических координатах сцены. Масштаб и смещение целые,
 * координаты округляются, поэтому каждый пиксель спрайта = ровный квадрат.
 */
export class Renderer {
  layout!: Layout;
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  begin(layout: Layout) {
    this.layout = layout;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.setTransform(layout.scale, 0, 0, layout.scale, layout.originX, layout.originY);
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  bmp(b: Bitmap, x: number, y: number) {
    this.ctx.drawImage(b.canvas, Math.round(x) - b.ox, Math.round(y) - b.oy);
  }

  sprite(key: string, def: SpriteDef, x: number, y: number, scale = 1) {
    const b = bitmap(key, def);
    if (scale === 1) this.bmp(b, x, y);
    else this.ctx.drawImage(b.canvas, Math.round(x), Math.round(y), b.w * scale, b.h * scale);
  }

  /** Размер спрайта в пикселях. */
  static size(def: SpriteDef) {
    return { w: def.rows[0].length, h: def.rows.length };
  }

  /** Пушок рисуется от нижнего центра: так кадры разной высоты стоят на земле. */
  pushok(p: Pushok, scale = 1) {
    const frame = p.displayFrame;
    const b = pushokBitmap(frame, p.hat, p.guitar, p.sweater);
    const bodyH = PUSHOK_FRAMES[frame].length;
    const left = Math.round(p.x) - 8 * scale;
    const top = Math.round(p.y + p.lift) - bodyH * scale;
    this.ctx.drawImage(b.canvas, left - b.ox * scale, top - b.oy * scale, b.w * scale, b.h * scale);
  }

  /** Подпись для взрослых: в физических пикселях поверх сцены. */
  adultText(text: string, cssX: number, cssY: number, sizeCss = 13, color = '#5A4650', align: CanvasTextAlign = 'center') {
    const c = this.ctx;
    const l = this.layout;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.font = `${Math.round(sizeCss * l.dpr)}px -apple-system, system-ui, sans-serif`;
    c.fillText(text, cssX * l.dpr, cssY * l.dpr);
    c.restore();
  }
}

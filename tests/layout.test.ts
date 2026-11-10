import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { expanded, hitTest, type Target } from '../src/engine/input';
import { computeLayout, cssToScene, sceneToCss } from '../src/engine/layout';

const IPHONE = { w: 844, h: 390, dpr: 3, insets: { top: 0, right: 47, bottom: 21, left: 47 } };
const TABLET = { w: 1280, h: 800, dpr: 2, insets: { top: 24, right: 0, bottom: 0, left: 0 } };
const SMALL_ANDROID_TABLET = { w: 962, h: 601, dpr: 1.5, insets: { top: 0, right: 0, bottom: 0, left: 0 } };

describe('масштаб сцены', () => {
  for (const [name, d] of Object.entries({ IPHONE, TABLET, SMALL_ANDROID_TABLET })) {
    it(`${name}: целый масштаб, сцена целиком в безопасной зоне`, () => {
      const l = computeLayout(d.w, d.h, d.dpr, d.insets);
      expect(Number.isInteger(l.scale)).toBe(true);
      expect(Number.isInteger(l.originX)).toBe(true);
      expect(Number.isInteger(l.originY)).toBe(true);
      expect(l.safe.x0).toBeLessThanOrEqual(0);
      expect(l.safe.y0).toBeLessThanOrEqual(0);
      expect(l.safe.x1).toBeGreaterThanOrEqual(CONFIG.scene.width);
      expect(l.safe.y1).toBeGreaterThanOrEqual(CONFIG.scene.height);
      // фон покрывает весь экран
      expect(l.view.x0).toBeLessThanOrEqual(l.safe.x0);
      expect(l.view.x1).toBeGreaterThanOrEqual(l.safe.x1);
      expect(l.portrait).toBe(false);
    });

    it(`${name}: минимальная цель = 64 CSS px`, () => {
      const l = computeLayout(d.w, d.h, d.dpr, d.insets);
      const cssPerLogical = l.scale / l.dpr;
      expect(l.minTarget * cssPerLogical).toBeCloseTo(64, 5);
      const t: Target = { id: 'tiny', x: 10, y: 10, w: 4, h: 4 };
      const e = expanded(t, l.minTarget);
      expect(e.w * cssPerLogical).toBeGreaterThanOrEqual(64);
      expect(e.h * cssPerLogical).toBeGreaterThanOrEqual(64);
    });
  }

  it('iPhone: Пушок (16 px) выше 50 CSS px', () => {
    const l = computeLayout(IPHONE.w, IPHONE.h, IPHONE.dpr, IPHONE.insets);
    expect((16 * l.scale) / l.dpr).toBeGreaterThan(50);
  });

  it('вертикально = portrait', () => {
    expect(computeLayout(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 }).portrait).toBe(true);
  });

  it('CSS → сцена → CSS без потерь', () => {
    const l = computeLayout(TABLET.w, TABLET.h, TABLET.dpr, TABLET.insets);
    const s = cssToScene(l, 300, 200);
    const c = sceneToCss(l, s.x, s.y);
    expect(c.x).toBeCloseTo(300);
    expect(c.y).toBeCloseTo(200);
  });
});

describe('хит-тест', () => {
  const a: Target = { id: 'a', x: 0, y: 0, w: 10, h: 10 };
  const b: Target = { id: 'b', x: 30, y: 0, w: 4, h: 4 };
  it('точное попадание, верхняя цель выигрывает', () => {
    const over: Target = { id: 'over', x: 5, y: 5, w: 10, h: 10 };
    expect(hitTest([a, over], 6, 6, 0)?.id).toBe('over');
  });
  it('мелкая цель ловится в радиусе минимального размера', () => {
    expect(hitTest([a, b], 27, 2, 20)?.id).toBe('b');
    expect(hitTest([a, b], 27, 2, 0)).toBeNull();
  });
  it('из двух расширенных зон выигрывает ближайшая', () => {
    expect(hitTest([a, b], 20, 2, 40)?.id).toBe('b');
  });
});

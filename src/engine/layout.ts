import { CONFIG } from '../config';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Layout {
  cssW: number;
  cssH: number;
  dpr: number;
  devW: number;
  devH: number;
  /** Сколько физических пикселей экрана в одном пикселе спрайта. Всегда целое. */
  scale: number;
  /** Положение точки (0,0) сцены в физических пикселях. Целое. */
  originX: number;
  originY: number;
  /** Весь холст в логических координатах (фон рисуется на нем целиком). */
  view: Rect;
  /** Безопасная зона (без выреза и полоски «домой») в логических координатах. */
  safe: Rect;
  portrait: boolean;
  /** Минимальная цель касания в логических px (64 CSS px). */
  minTarget: number;
}

/**
 * Целый масштаб, при котором сцена 192×108 целиком влезает в безопасную зону.
 * Остаток по краям закрашивается фоном сцены, а не черными полосами.
 */
export function computeLayout(
  cssW: number,
  cssH: number,
  dpr: number,
  insets: Insets,
  scene = CONFIG.scene,
): Layout {
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));
  const ax = Math.round(insets.left * dpr);
  const ay = Math.round(insets.top * dpr);
  const aw = Math.max(1, devW - ax - Math.round(insets.right * dpr));
  const ah = Math.max(1, devH - ay - Math.round(insets.bottom * dpr));
  const scale = Math.max(1, Math.min(Math.floor(aw / scene.width), Math.floor(ah / scene.height)));
  const originX = ax + Math.floor((aw - scene.width * scale) / 2);
  const originY = ay + Math.floor((ah - scene.height * scale) / 2);
  const toL = (dx: number, dy: number) => [(dx - originX) / scale, (dy - originY) / scale] as const;
  const [vx0, vy0] = toL(0, 0);
  const [vx1, vy1] = toL(devW, devH);
  const [sx0, sy0] = toL(ax, ay);
  const [sx1, sy1] = toL(ax + aw, ay + ah);
  return {
    cssW,
    cssH,
    dpr,
    devW,
    devH,
    scale,
    originX,
    originY,
    view: { x0: vx0, y0: vy0, x1: vx1, y1: vy1 },
    safe: { x0: sx0, y0: sy0, x1: sx1, y1: sy1 },
    portrait: cssH > cssW,
    minTarget: (CONFIG.minTouchCssPx * dpr) / scale,
  };
}

/** CSS-координаты касания → логические координаты сцены. */
export function cssToScene(l: Layout, cx: number, cy: number) {
  return { x: (cx * l.dpr - l.originX) / l.scale, y: (cy * l.dpr - l.originY) / l.scale };
}

/** Логические координаты → CSS (для тестов и DOM-оверлеев). */
export function sceneToCss(l: Layout, x: number, y: number) {
  return { x: (x * l.scale + l.originX) / l.dpr, y: (y * l.scale + l.originY) / l.dpr };
}

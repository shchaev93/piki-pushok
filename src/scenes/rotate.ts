import type { Renderer } from '../engine/renderer';
import type { Pushok } from '../pushok/actor';
import { ICONS } from '../sprites/icons';
import { bitmap } from '../sprites/render';
import type { SpriteDef } from '../sprites/grid';

/** Телефон, повернутый набок: та же сетка, транспонированная. */
const phoneSideways: SpriteDef = {
  palette: ICONS.phone.palette,
  rows: ICONS.phone.rows[0].split('').map((_, x) =>
    ICONS.phone.rows
      .map((r) => r[x])
      .reverse()
      .join(''),
  ),
};

/**
 * Экран «поверни»: Пушок и телефон, который ложится набок.
 * Рисуется своим масштабом, потому что сцена домика рассчитана на горизонталь.
 */
export function drawRotate(r: Renderer, pushok: Pushok, time: number) {
  const l = r.layout;
  const c = r.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#FFF4E2';
  c.fillRect(0, 0, l.devW, l.devH);

  const s = Math.max(2, Math.floor(Math.min(l.devW / 44, l.devH / 80)));
  const ox = Math.floor((l.devW - 40 * s) / 2);
  const oy = Math.floor((l.devH - 56 * s) / 2);
  c.imageSmoothingEnabled = false;
  c.setTransform(s, 0, 0, s, ox, oy);

  const sideways = Math.floor(time / 1100) % 2 === 1;
  const phone = sideways ? bitmap('rotate.phoneSide', phoneSideways) : bitmap('icon.phone', ICONS.phone);
  c.drawImage(phone.canvas, Math.round(20 - phone.w / 2), Math.round(18 - phone.h / 2));

  const hop = sideways ? Math.round(-Math.abs(Math.sin(time / 160)) * 3) : 0;
  pushok.x = 20;
  pushok.y = 54 + hop;
  pushok.lift = 0;
  pushok.frame = sideways ? 'happy2' : 'base';
  r.pushok(pushok);

  r.adultText('Поверните устройство горизонтально', l.cssW / 2, l.cssH - 44, 14);
  r.adultText('Не поворачивается? Выключите блокировку поворота экрана', l.cssW / 2, l.cssH - 24, 12, '#8A7680');
}

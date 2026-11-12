import { CONFIG } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { catchButterfly, feed, startNight, type Unlock } from '../game/rules';
import { dress } from '../pushok/dress';
import { Pushok } from '../pushok/actor';
import { CharCanvas, type SpriteDef } from '../sprites/grid';
import { isHatId, HATS } from '../sprites/hats';
import { FURN_PALETTE } from '../sprites/home-objects';
import { ICONS } from '../sprites/icons';
import { BIG_CLOUD, BUTTERFLY_COLORS, butterfly, FOOD_SPRITES, GUITARS, ITEM_ICONS } from '../sprites/items';
import { SWEATER_ICONS } from '../sprites/sweaters';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { BTN, drawButton, drawHomeButton, homeButton } from './ui';

// Облачко: Пушок медитирует, облачко тянется за пальцем, бабочки и яблочки
// пролетают волнами. Промахов и штрафов нет. Раунд 60 секунд, выйти можно когда угодно.

const C = CONFIG.cloud;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const SUN: SpriteDef = {
  palette: FURN_PALETTE,
  rows: new CharCanvas(15, 15).disc(7.5, 7.5, 7, 7, 'Y').rect(4, 5, 2, 2, 'W').rows(),
};
/** Солнце на закате: оранжевое. */
const SUN_SET: SpriteDef = { rows: SUN.rows, palette: { ...FURN_PALETTE, Y: '#F5A04A' } };

/** Месяц: круг, из которого вырезан сдвинутый круг. */
function moon(): string[] {
  const c = new CharCanvas(13, 15);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 13; x++) {
      const inA = Math.hypot(x + 0.5 - 6.5, y + 0.5 - 7.5) <= 6.4;
      const inB = Math.hypot(x + 0.5 - 9.5, y + 0.5 - 5.5) <= 5.6;
      if (inA && !inB) c.set(x, y, Math.hypot(x + 0.5 - 6.5, y + 0.5 - 7.5) > 5.4 ? 'Y' : 'M');
    }
  }
  return c.rows();
}
const MOON: SpriteDef = { rows: moon(), palette: { M: '#FFF6C8', Y: '#F5DE8A' } };

/** Небо по ключевым кадрам: день, закат, вечер, ночь (4 полосы сверху вниз). */
const SKY = {
  day: ['#A9DCF7', '#BFE6FA', '#D2EEFC', '#E3F5FD'],
  sunset: ['#F4AE9C', '#F8C3A8', '#FBD6B4', '#FDE7C6'],
  evening: ['#7D6CB8', '#A285C4', '#CF9EC2', '#EDBBB2'],
  night: ['#1C2156', '#232963', '#2C3271', '#373E7E'],
};

/** Цвета полос неба в момент t (0..1 раунда) и «ночность» 0..1. */
export function skyColors(t: number): { bands: string[]; night: number } {
  const N = CONFIG.night;
  const keys: [number, string[]][] = [
    [N.sunsetFrom, SKY.day],
    [(N.sunsetFrom + N.eveningFrom) / 2, SKY.sunset],
    [(N.eveningFrom + N.nightFrom) / 2, SKY.evening],
    [N.nightFrom, SKY.night],
  ];
  let bands = SKY.day;
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, a] = keys[i];
    const [tb, b] = keys[i + 1];
    if (t >= ta && t <= tb) bands = a.map((c, j) => mix(c, b[j], (t - ta) / (tb - ta)));
  }
  if (t > N.nightFrom) bands = SKY.night;
  const night = Math.min(1, Math.max(0, (t - N.eveningFrom) / (N.nightFrom - N.eveningFrom)));
  return { bands, night };
}

interface Flyer {
  kind: 'butterfly' | 'apple';
  x: number;
  baseY: number;
  y: number;
  vx: number;
  amp: number;
  freq: number;
  phase: number;
  color: string;
}

interface ToCounter {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  color: string;
  index: number;
}

type Phase = 'play' | 'ending' | 'summary';

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export class CloudScene implements Scene {
  readonly id = 'cloud' as const;
  private pushok = new Pushok();
  /** Центр облачка по x и верх облачка по y. */
  private cx = 96;
  private cy = 62;
  private tx = 96;
  private ty = 62;
  private drag: { id: number; lx: number; ly: number } | null = null;
  private time = 0;
  private phase: Phase = 'play';
  private phaseT = 0;
  private flyers: Flyer[] = [];
  private nextButterfly = 700;
  private nextApple = rand(...C.appleEveryMs);
  private caughtColors: string[] = [];
  private toCounter: ToCounter[] = [];
  private particles = new Particles();
  private eatLeft = 0;
  private fresh: Unlock[] = [];
  private safe: Rect = { x0: 0, y0: 0, x1: CONFIG.scene.width, y1: CONFIG.scene.height };
  private stars = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random() * 0.75, big: Math.random() < 0.2 }));
  private bgClouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 50 + rand(0, 30), y: rand(8, 70), v: rand(2, 5) }));

  constructor(private g: Game) {
    const s = g.store.data;
    dress(this.pushok, s, false);
    this.pushok.frame = 'meditate';
  }

  /** Для e2e-тестов. */
  get caught() {
    return this.caughtColors.length;
  }
  get currentPhase() {
    return this.phase;
  }
  /** Для e2e-тестов: запустить бабочку или яблочко прямо в облачко. */
  debugSpawnAtCloud(kind: Flyer['kind']) {
    const f = this.makeFlyer(kind);
    f.x = this.cx;
    f.baseY = this.cy;
    f.amp = 0;
    f.vx = 0;
    this.flyers.push(f);
  }
  /** Для e2e-тестов: перемотать раунд на долю frac (0..1), чтобы снять небо. */
  debugSkyAt(frac: number) {
    this.time = frac * C.roundSeconds * 1000;
  }
  /** Для e2e-тестов: перемотать раунд к концу. */
  debugFinish() {
    this.time = C.roundSeconds * 1000;
  }
  get cloudPos() {
    return { x: this.cx, y: this.cy };
  }

  targets(safe: Rect): Target[] {
    this.safe = safe;
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    if (this.phase === 'summary') {
      const again = this.againButton();
      const home = this.summaryHome();
      list.push({ id: 'btn:home2', x: home.x, y: home.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
      list.push({ id: 'btn:again', x: again.x, y: again.y, w: BTN, h: BTN, onTap: () => this.g.go('cloud') });
    }
    return list;
  }

  private againButton() {
    return { x: Math.round(CONFIG.scene.width / 2) + 6, y: 84 };
  }
  private summaryHome() {
    return { x: Math.round(CONFIG.scene.width / 2) - 6 - BTN, y: 84 };
  }

  // ---------- перетаскивание ----------

  pointerDown(x: number, y: number, id: number) {
    if (this.phase !== 'play') return false;
    this.drag = { id, lx: x, ly: y };
    return true;
  }

  pointerMove(x: number, y: number, id: number) {
    if (!this.drag || this.drag.id !== id) return;
    this.tx += x - this.drag.lx;
    this.ty += y - this.drag.ly;
    this.drag.lx = x;
    this.drag.ly = y;
    this.clampTarget();
  }

  pointerUp(_x: number, _y: number, id: number) {
    if (this.drag?.id === id) this.drag = null;
  }

  private clampTarget() {
    const s = this.safe;
    this.tx = Math.min(s.x1 - 18, Math.max(s.x0 + 18, this.tx));
    this.ty = Math.min(s.y1 - 13, Math.max(s.y0 + 26, this.ty));
  }

  // ---------- игра ----------

  update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    const k = Math.min(1, (C.follow * dt) / 1000);
    this.cx += (this.tx - this.cx) * k;
    this.cy += (this.ty - this.cy) * k;

    if (this.phase === 'play') {
      this.spawn(dt);
      if (this.time >= C.roundSeconds * 1000) this.setPhase('ending');
    } else if (this.phase === 'ending') {
      // облачко мягко опускается домой, Пушок открывает глаза
      this.tx = CONFIG.scene.width / 2;
      this.ty = 66;
      if (this.phaseT > 1600) this.setPhase('summary');
    }

    this.moveFlyers(dt);
    this.updateCounter(dt);
    this.particles.update(dt);
    for (const c of this.bgClouds) {
      c.x -= (c.v * dt) / 1000;
      if (c.x < this.safe.x0 - 40) c.x = this.safe.x1 + 20;
    }

    const p = this.pushok;
    p.update(dt);
    p.x = this.cx;
    p.y = this.cy + 7;
    if (this.eatLeft > 0) {
      this.eatLeft -= dt;
      p.frame = Math.floor(this.eatLeft / 150) % 2 ? 'eatOpen' : 'eatMunch';
      p.lift = 0;
    } else if (this.phase === 'play') {
      p.frame = 'meditate';
      p.lift = Math.sin(this.time / 700);
    } else if (this.phase === 'ending') {
      p.frame = 'base';
      p.lift = 0;
    } else {
      const t = (this.phaseT % 900) / 900;
      p.lift = -Math.abs(Math.sin(Math.PI * t)) * 4;
      p.frame = t < 0.15 || t > 0.85 ? 'happy1' : 'happy2';
    }
  }

  private setPhase(ph: Phase) {
    this.phase = ph;
    this.phaseT = 0;
    this.drag = null;
    if (ph === 'ending') this.g.sfx.play('joy');
    if (ph === 'summary') {
      // долетели до ночи: дома тоже наступает ночь
      this.g.store.update((s) => startNight(s, this.g.now()));
      this.g.sfx.play(this.fresh.length ? 'fanfare' : 'lullaby');
      if (this.fresh.length) this.particles.burst(this.cx, this.cy - 20, 10);
    }
  }

  private spawn(dt: number) {
    this.nextButterfly -= dt;
    if (this.nextButterfly <= 0) {
      this.nextButterfly = rand(...C.butterflyEveryMs);
      this.flyers.push(this.makeFlyer('butterfly'));
    }
    this.nextApple -= dt;
    if (this.nextApple <= 0) {
      this.nextApple = rand(...C.appleEveryMs);
      this.flyers.push(this.makeFlyer('apple'));
    }
  }

  private makeFlyer(kind: Flyer['kind']): Flyer {
    const s = this.safe;
    const fromLeft = Math.random() < 0.5;
    const speed = kind === 'apple' ? C.appleSpeed : rand(...C.butterflySpeed);
    const baseY = rand(s.y0 + 16, s.y1 - 16);
    return {
      kind,
      x: fromLeft ? s.x0 - 10 : s.x1 + 10,
      baseY,
      y: baseY,
      vx: fromLeft ? speed : -speed,
      amp: kind === 'apple' ? rand(3, 6) : rand(6, 14),
      freq: rand(1.2, 2.2),
      phase: rand(0, Math.PI * 2),
      color: BUTTERFLY_COLORS[Math.floor(Math.random() * BUTTERFLY_COLORS.length)],
    };
  }

  private moveFlyers(dt: number) {
    const s = this.safe;
    const hit = { x0: this.cx - 19, x1: this.cx + 19, y0: this.cy - 12, y1: this.cy + 12 };
    const keep: Flyer[] = [];
    for (const f of this.flyers) {
      f.x += (f.vx * dt) / 1000;
      f.y = f.baseY + Math.sin((this.time / 1000) * f.freq + f.phase) * f.amp;
      const caught = this.phase !== 'summary' && f.x > hit.x0 && f.x < hit.x1 && f.y > hit.y0 && f.y < hit.y1;
      if (caught) {
        this.onCatch(f);
        continue;
      }
      if (f.x < s.x0 - 20 || f.x > s.x1 + 20) continue;
      keep.push(f);
    }
    this.flyers = keep;
  }

  private onCatch(f: Flyer) {
    this.particles.burst(f.x, f.y, 6);
    if (f.kind === 'apple') {
      // пойманное яблочко Пушок сразу съедает
      this.g.sfx.play('chew');
      this.eatLeft = 900;
      this.particles.spawn('heart', this.cx + 6, this.cy - 18, 4, -12, 900);
      this.g.store.update((s) => feed(s, CONFIG.hunger.cloudApple, this.g.now()));
      return;
    }
    this.g.sfx.play('catch');
    const index = this.caughtColors.length;
    this.caughtColors.push(f.color);
    this.toCounter.push({ x: f.x, y: f.y, sx: f.x, sy: f.y, t: 0, color: f.color, index });
    // каждая бабочка сразу сохраняется: выйти можно в любой момент
    this.g.store.update((s) => this.fresh.push(...catchButterfly(s)));
  }

  /** Куда в счетчике ложится бабочка номер i (маленький ряд сверху). */
  private counterPos(i: number) {
    const perRow = 15;
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const n = Math.min(perRow, this.caughtColors.length - row * perRow);
    const x0 = CONFIG.scene.width / 2 - (n * 9) / 2;
    return { x: x0 + col * 9, y: Math.ceil(this.safe.y0) + 4 + row * 7 };
  }

  private updateCounter(dt: number) {
    for (const c of this.toCounter) c.t = Math.min(1, c.t + dt / 450);
    this.toCounter = this.toCounter.filter((c) => c.t < 1);
  }

  // ---------- отрисовка ----------

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const h = Math.ceil(v.y1 - v.y0) + 2;
    // небо за раунд: день → закат → вечер → ночь (мягкий таймер без цифр)
    const t = Math.min(1, this.time / (C.roundSeconds * 1000));
    const sky = skyColors(t);
    sky.bands.forEach((c, i) => r.rect(x0, y0 + (h * i) / 4, w, h / 4 + 1, c));

    // звезды загораются вечером и мерцают
    if (sky.night > 0) {
      this.stars.forEach((st, i) => {
        if (i / this.stars.length > sky.night) return;
        if ((Math.floor(this.time / 350) + i) % 7 === 0) return;
        const sx = Math.round(x0 + st.x * w);
        const sy = Math.round(y0 + st.y * h);
        r.rect(sx, sy, 1, 1, '#FFF6C8');
        if (st.big) {
          r.rect(sx - 1, sy, 3, 1, '#FFF6C8');
          r.rect(sx, sy - 1, 1, 3, '#FFF6C8');
        }
      });
    }

    // солнышко идет по небу и садится за край
    const N = CONFIG.night;
    const span = safe.x1 - safe.x0 - 56;
    const sunX = safe.x0 + 34 + span * Math.min(1, t / N.nightFrom);
    const set = Math.max(0, (t - 0.45) / (N.nightFrom - 0.45));
    const sunY = 14 - Math.sin(Math.PI * Math.min(t, 0.5)) * 6 + set * set * (safe.y1 - safe.y0 + 30);
    if (sunY < safe.y1 + 2) r.sprite(t > N.sunsetFrom ? 'cloud.sunset' : 'cloud.sun', t > N.sunsetFrom ? SUN_SET : SUN, sunX, sunY);

    // месяц поднимается к ночи
    if (t > N.eveningFrom) {
      const up = Math.min(1, (t - N.eveningFrom) / (1 - N.eveningFrom));
      const e = 1 - (1 - up) * (1 - up);
      r.sprite('cloud.moon', MOON, Math.min(safe.x1, 222) - 46, 70 - e * 58);
    }

    r.ctx.globalAlpha = 1 - 0.6 * sky.night;
    for (const c of this.bgClouds) r.sprite('icon.cloud', ICONS.cloud, c.x, c.y);
    r.ctx.globalAlpha = 1;

    for (const f of this.flyers) this.drawFlyer(r, f);

    // Пушок сидит в облачке: облачко рисуется поверх нижней части
    r.pushok(this.pushok);
    r.sprite('cloud.big', BIG_CLOUD, Math.round(this.cx) - 18, Math.round(this.cy) + 1);

    this.particles.draw(r);

    if (this.phase === 'summary') this.drawSummary(r);
    else {
      this.drawCounter(r);
      drawHomeButton(r, safe);
    }
  }

  private drawFlyer(r: Renderer, f: Flyer) {
    if (f.kind === 'apple') {
      r.sprite('food.apple', FOOD_SPRITES.apple, Math.round(f.x) - 6, Math.round(f.y) - 6);
      return;
    }
    const open = Math.floor((this.time + f.phase * 300) / 140) % 2 === 0;
    r.sprite(`bf:${open ? 1 : 0}:${f.color}`, butterfly(open, f.color), Math.round(f.x) - 3, Math.round(f.y) - 2);
  }

  private drawCounter(r: Renderer) {
    const flying = new Set(this.toCounter.map((c) => c.index));
    this.caughtColors.forEach((color, i) => {
      if (flying.has(i)) return;
      const p = this.counterPos(i);
      r.sprite(`bf:1:${color}`, butterfly(true, color), p.x, p.y);
    });
    for (const c of this.toCounter) {
      const p = this.counterPos(c.index);
      const e = 1 - (1 - c.t) * (1 - c.t);
      const x = c.sx + (p.x - c.sx) * e;
      const y = c.sy + (p.y - c.sy) * e - Math.sin(Math.PI * c.t) * 8;
      r.sprite(`bf:1:${c.color}`, butterfly(true, c.color), x, y);
    }
  }

  private drawSummary(r: Renderer) {
    // ряд пойманных бабочек крупно
    const n = this.caughtColors.length;
    const perRow = 10;
    const rows = Math.ceil(n / perRow);
    const appear = Math.floor(this.phaseT / 120); // бабочки появляются по одной
    for (let i = 0; i < Math.min(n, appear); i++) {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const x = CONFIG.scene.width / 2 - (inRow * 16) / 2 + (i % perRow) * 16 + 1;
      const y = 8 + row * 13 + (rows > 2 ? 0 : 4);
      r.sprite(`bf:1:${this.caughtColors[i]}`, butterfly(true, this.caughtColors[i]), x, y, 2);
    }
    // новые вещи в гардеробе
    if (this.fresh.length && this.phaseT > 600) {
      let x = this.cx + 24;
      for (const u of this.fresh.slice(0, 3)) {
        const d = u.kind === 'hat' && isHatId(u.id) ? HATS[u.id] : u.kind === 'sweater' ? SWEATER_ICONS[u.id] : GUITARS[u.id];
        if (!d) continue;
        const bob = Math.round(Math.sin(this.phaseT / 200) * 1.5);
        r.sprite(`${u.kind}.${u.id}`, d, x, this.cy - 22 + bob, 2);
        x += d.rows[0].length * 2 + 6;
      }
    }
    drawButton(r, this.summaryHome(), 'item.house', ITEM_ICONS.house, 0, true);
    drawButton(r, this.againButton(), 'icon.cloud', ICONS.cloud);
  }
}

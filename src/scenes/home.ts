import { CONFIG, type ActivityId } from '../config';
import type { Sfx } from '../audio/sfx';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { dress } from '../pushok/dress';
import { during, Pushok, tween, wait, type Script } from '../pushok/actor';
import type { Store } from '../save/store';
import type { Game, Scene } from './scene';
import { isNight, moodOf, morning, satietyNow, unseenUnlocks } from '../game/rules';
import { ITEM_ICONS, MUSIC_SPRITES } from '../sprites/items';
import { drawCoins, drawSatiety } from './ui';
import { HOME_SPRITES, SMALL_SPRITES, type HomeSpriteId, type SmallSpriteId } from '../sprites/home-objects';
import { ICONS } from '../sprites/icons';
import type { SpriteDef } from '../sprites/grid';
import { bitmap } from '../sprites/render';

/** Предмет домика: где стоит, где Пушок отдыхает после занятия. */
interface HomeObject {
  id: ActivityId;
  sprite: HomeSpriteId;
  x: number;
  y: number;
  /** Куда Пушок приходит и где остается после занятия (нижний центр). */
  rest: { x: number; y: number };
}

const sz = (s: HomeSpriteId) => ({ w: HOME_SPRITES[s].rows[0].length, h: HOME_SPRITES[s].rows.length });

export const HOME_OBJECTS: HomeObject[] = [
  { id: 'bed', sprite: 'bed', x: 4, y: 50, rest: { x: 19, y: 76 } },
  { id: 'climber', sprite: 'climber', x: 40, y: 22, rest: { x: 53, y: 76 } },
  { id: 'bath', sprite: 'bath', x: 108, y: 48, rest: { x: 121, y: 76 } },
  { id: 'toilet', sprite: 'toilet', x: 137, y: 48, rest: { x: 142, y: 76 } },
  { id: 'kitchen', sprite: 'kitchen', x: 154, y: 30, rest: { x: 171, y: 76 } },
  { id: 'trampoline', sprite: 'trampoline', x: 6, y: 88, rest: { x: 21, y: 88 } },
  { id: 'table', sprite: 'table', x: 52, y: 84, rest: { x: 64, y: 90 } },
  { id: 'slide', sprite: 'slide', x: 98, y: 70, rest: { x: 142, y: 104 } },
  { id: 'rope', sprite: 'rope', x: 150, y: 90, rest: { x: 164, y: 99 } },
];

const FLOOR_Y = 58;

interface Particle {
  sprite: SmallSpriteId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

type UiButton = 'cloud' | 'wardrobe' | 'basket' | 'music';

export class HomeScene implements Scene {
  readonly id = 'home' as const;
  readonly pushok: Pushok;
  private store: Store;
  private sfx: Sfx;
  private particles: Particle[] = [];
  private wiggle: Partial<Record<UiButton, number>> = {};
  /** Прогресс удержания шестеренки 0..1 (рисуется кольцом). */
  gearHold = 0;
  /** Скакалка крутится: угол, пока идет занятие. */
  private ropeAngle: number | null = null;
  private time = 0;

  constructor(private g: Game) {
    this.store = g.store;
    this.sfx = g.sfx;
    const store = g.store;
    this.pushok = new Pushok(() => this.sfx.play('hop'));
    const at = HOME_OBJECTS.find((o) => o.id === store.data.home.pushokAt);
    if (at) {
      this.pushok.x = at.rest.x;
      this.pushok.y = at.rest.y;
    }
    dress(this.pushok, store.data);

    // день или ночь: если ночь прошла, пока игра была закрыта, наступило утро
    const night = isNight(store.data, g.now());
    if (!night && (store.data.night !== null || store.data.home.sleeping)) store.update(morning);
    this.wasNight = night;
    this.nightLevel = night ? 1 : 0;
    if (night && store.data.home.sleeping) this.pushok.run('sleep', this.sleepScript(true));
  }

  /** Плавность перехода день/ночь: 0 = день, 1 = ночь. */
  private nightLevel = 0;
  private wasNight = false;
  private yawnIn: number = CONFIG.night.yawnEveryMs;

  get night() {
    return isNight(this.store.data, this.g.now());
  }

  get sleeping() {
    return this.pushok.busy === 'sleep';
  }

  /** Ночной сон: до тапа по Пушку или до утра. */
  private *sleepScript(alreadyInBed: boolean): Script {
    const p = this.pushok;
    const bed = HOME_OBJECTS.find((o) => o.id === 'bed')!;
    p.sortY = 66.1;
    if (alreadyInBed) {
      p.x = 15;
      p.y = 60;
    } else {
      yield* p.hopTo(bed.rest.x, bed.rest.y);
      p.sortY = 66.1;
      yield* p.jumpTo(15, 60, 8);
      this.sfx.play('lullaby');
    }
    p.frame = 'sleep';
    p.overlay = { sprite: 'bedBlanket', x: bed.x, y: bed.y };
    if (!this.store.data.home.sleeping) this.store.update((s) => (s.home.sleeping = true));
    let z = 0;
    let t = 0;
    for (;;) {
      t += yield;
      p.frame = 'sleep';
      if (t > z) {
        z = t + 1300;
        this.spawn('z', p.x + 6, p.y - 16, 5, -8, 1700);
      }
    }
  }

  /** Проснулся: потягивается, радуется и вылезает из кроватки. */
  private *wakeScript(): Script {
    const p = this.pushok;
    const bed = HOME_OBJECTS.find((o) => o.id === 'bed')!;
    this.store.update((s) => (s.home.sleeping = false));
    p.sortY = 66.1;
    p.overlay = { sprite: 'bedBlanket', x: bed.x, y: bed.y };
    yield* during(500, () => (p.frame = 'blink'));
    p.overlay = null;
    this.sfx.play('joy');
    yield* p.joy(1, 4);
    yield* p.jumpTo(bed.rest.x, bed.rest.y, 8);
    p.sortY = null;
  }

  /** Ночью Пушок иногда зевает: подсказка, что пора в кроватку. */
  private *yawnScript(): Script {
    const p = this.pushok;
    this.spawn('z', p.x + 5, p.y - 18, 4, -8, 1200);
    const bed = HOME_OBJECTS.find((o) => o.id === 'bed')!;
    this.spawn('sparkle', bed.x + 14, bed.y + 2, 0, -6, 900);
    yield* during(800, (t) => (p.frame = t < 600 ? 'meditate' : 'base'));
  }

  /** Сытость сейчас (падает в реальном времени). */
  private satiety() {
    return satietyNow(this.store.data.satiety, this.g.now());
  }

  update(dt: number) {
    this.time += dt;
    const mood = moodOf(this.satiety());
    // очень голодный: грустно сидит и двигается медленнее (без болезней и побегов)
    this.pushok.idleFrame = mood === 'veryHungry' ? 'sad' : 'base';
    this.pushok.speedFactor = mood === 'veryHungry' ? CONFIG.hunger.veryHungrySpeedFactor : 1;
    // день и ночь
    const night = this.night;
    if (this.wasNight && !night) {
      // утро: спящий Пушок просыпается сам
      this.store.update(morning);
      this.sfx.play('joy');
      if (this.pushok.busy === 'sleep') this.pushok.run(null, this.wakeScript());
    }
    this.wasNight = night;
    // сумерки/рассвет за полторы секунды
    const target = night ? 1 : 0;
    const step = dt / 1500;
    this.nightLevel =
      target > this.nightLevel ? Math.min(target, this.nightLevel + step) : Math.max(target, this.nightLevel - step);
    if (night && !this.pushok.busy) {
      this.yawnIn -= dt;
      if (this.yawnIn <= 0) {
        this.yawnIn = CONFIG.night.yawnEveryMs;
        this.pushok.run(null, this.yawnScript());
      }
    }
    this.pushok.update(dt);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const k of Object.keys(this.wiggle) as UiButton[]) {
      this.wiggle[k]! -= dt;
      if (this.wiggle[k]! <= 0) delete this.wiggle[k];
    }
  }

  // ---------- касания ----------

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    for (const o of HOME_OBJECTS) {
      const { w, h } = sz(o.sprite);
      list.push({ id: `obj:${o.id}`, x: o.x, y: o.y, w, h, onTap: () => this.tapObject(o.id) });
    }
    const p = this.pushok;
    list.push({ id: 'pushok', x: p.x - 9, y: p.y - 17, w: 18, h: 18, onTap: () => this.tapPushok() });
    for (const b of this.buttonRects(safe)) {
      list.push({ id: `btn:${b.id}`, x: b.x, y: b.y, w: 22, h: 22, onTap: () => this.tapButton(b.id) });
    }
    if (this.night) {
      list.push({ id: 'window', x: 74, y: 28, w: 28, h: 20, onTap: () => this.tapWindow() });
    }
    const g = this.gearRect(safe);
    list.push({
      id: 'gear',
      ...g,
      hold: {
        ms: CONFIG.adultHoldMs,
        onProgress: (v) => (this.gearHold = v),
        onComplete: () => {
          this.gearHold = 0;
          this.g.openAdult();
        },
      },
    });
    return list;
  }

  private buttonRects(safe: { x1: number; y0: number }) {
    const ids: UiButton[] = ['cloud', 'wardrobe', 'basket', 'music'];
    const right = Math.floor(Math.min(safe.x1, CONFIG.scene.width + 40)) - 3;
    return ids.map((id, i) => ({ id, x: right - (ids.length - i) * 25 + 3, y: Math.ceil(safe.y0) + 3 }));
  }

  private gearRect(safe: { x0: number; y0: number }) {
    return { x: Math.ceil(safe.x0) + 3, y: Math.ceil(safe.y0) + 3, w: 12, h: 12 };
  }

  tapObject(id: ActivityId) {
    const o = HOME_OBJECTS.find((x) => x.id === id)!;
    // спит: никуда не идет, пока его самого не разбудят
    if (this.sleeping) {
      this.spawn('z', this.pushok.x + 6, this.pushok.y - 16, 5, -8, 1200);
      return;
    }
    this.sfx.play('tap');
    if (id === 'bed' && this.night) {
      // ночью кроватка = спать до утра
      this.store.update((s) => (s.home.pushokAt = 'bed'));
      this.ropeAngle = null;
      this.pushok.run('sleep', this.sleepScript(false));
      return;
    }
    this.store.update((s) => (s.home.pushokAt = id));
    this.ropeAngle = null;
    this.pushok.run(id, this.activity(o));
  }

  private tapPushok() {
    if (this.sleeping) {
      this.pushok.run(null, this.wakeScript());
      return;
    }
    if (this.pushok.busy) return;
    const guitar = this.pushok.guitar;
    if (guitar) {
      // с гитарой в лапках Пушок играет мелодию
      this.sfx.melody(guitar);
      this.pushok.run('music', this.playGuitar());
      return;
    }
    this.sfx.play('joy');
    this.spawn('heart', this.pushok.x, this.pushok.y - 18, 0, -14, 900);
    this.pushok.run(null, this.pushok.joy(2));
  }

  private tapButton(id: UiButton) {
    this.sfx.play('tap');
    const to = { cloud: 'cloud', basket: 'shop', wardrobe: 'wardrobe', music: 'music' } as const;
    if (this.sleeping) {
      // спит, а мы уходим в другую комнату: сначала просыпается и вылезает из кроватки
      this.pushok.run('waking', this.wakeThenGo(to[id]));
      return;
    }
    if (this.pushok.busy === 'waking') return;
    this.g.go(to[id]);
  }

  private *wakeThenGo(to: 'cloud' | 'shop' | 'wardrobe' | 'music'): Script {
    yield* this.wakeScript();
    this.g.go(to);
  }

  /** Ночью окно = «раздвинуть шторы»: наступает утро. */
  private tapWindow() {
    if (!this.night) return;
    this.store.update(morning);
    // остальное (рассвет, пробуждение) сделает update при смене ночи на день
  }

  private *playGuitar(): Script {
    const p = this.pushok;
    let n = 0;
    yield* during(1400, (t) => {
      p.frame = Math.floor(t / 170) % 2 ? 'happy2' : 'happy1';
      p.lift = -Math.abs(Math.sin(t / 170)) * 1.5;
      if (t > n) {
        n += 340;
        this.spawn('note', p.x + 6 + Math.random() * 6, p.y - 18, 4 + Math.random() * 6, -14, 1000);
      }
    });
  }

  // ---------- занятия ----------

  private spawn(sprite: SmallSpriteId, x: number, y: number, vx: number, vy: number, life: number) {
    this.particles.push({ sprite, x, y, vx, vy, life, max: life });
  }

  private *activity(o: HomeObject): Script {
    const p = this.pushok;
    const ms = CONFIG.activityMs[o.id];
    const sfx = this.sfx;
    switch (o.id) {
      case 'bed': {
        yield* p.hopTo(o.rest.x, o.rest.y);
        p.sortY = 66.1;
        yield* p.jumpTo(15, 60, 8);
        p.frame = 'sleep';
        p.overlay = { sprite: 'bedBlanket', x: o.x, y: o.y };
        sfx.play('lullaby');
        let z = 0;
        yield* during(ms, (t) => {
          if (t > z) {
            z += 900;
            this.spawn('z', p.x + 6, p.y - 16, 6, -10, 1400);
          }
        });
        p.overlay = null;
        sfx.play('joy');
        yield* p.joy(1, 3);
        yield* p.jumpTo(o.rest.x, o.rest.y, 8);
        p.sortY = null;
        break;
      }
      case 'climber': {
        yield* p.hopTo(o.rest.x, o.rest.y);
        p.sortY = 64.1;
        yield* p.jumpTo(53, 64, 4, 300);
        const step = (ms - 900) / 6;
        const climbTo = (y: number, msStep: number) => {
          const sy = p.y;
          return tween(msStep, (t) => (p.y = sy + (y - sy) * t));
        };
        for (const y of [51, 43, 35]) {
          sfx.play('climb');
          yield* climbTo(y, step);
        }
        sfx.play('joy');
        yield* p.joy(1, 3);
        for (const y of [43, 51, 64]) yield* climbTo(y, step * 0.8);
        yield* p.hopTo(o.rest.x, o.rest.y);
        break;
      }
      case 'bath': {
        yield* p.hopTo(o.rest.x, o.rest.y);
        p.sortY = 63.9; // за бортиком ванны
        yield* p.jumpTo(121, 58, 12);
        sfx.play('splash');
        let b = 0;
        yield* during(ms, (t) => {
          p.lift = Math.sin(t / 180);
          p.frame = Math.floor(t / 600) % 2 ? 'happy1' : 'base';
          if (t > b) {
            b += 260;
            this.spawn('bubble', 110 + Math.random() * 22, 50, (Math.random() - 0.5) * 8, -12 - Math.random() * 8, 1200);
          }
          if (Math.floor(t / 1100) !== Math.floor((t - 16) / 1100)) sfx.play('splash');
        });
        p.lift = 0;
        yield* p.jumpTo(o.rest.x, o.rest.y, 12);
        p.sortY = null;
        break;
      }
      case 'toilet': {
        yield* p.hopTo(o.rest.x, o.rest.y);
        p.sortY = 64.1;
        yield* p.jumpTo(142, 55, 8);
        // сидит с закрытыми глазами и чуть ерзает
        yield* during(ms * 0.45, (t) => {
          p.frame = 'meditate';
          p.lift = Math.floor(t / 250) % 2 ? -1 : 0;
        });
        p.lift = 0;
        sfx.play('flush');
        p.frame = 'happy1';
        for (let i = 0; i < 6; i++) {
          this.spawn('bubble', 138 + Math.random() * 6, 56, (Math.random() - 0.5) * 16, -14 - Math.random() * 10, 900);
        }
        yield* during(ms * 0.3, (t) => (p.frame = Math.floor(t / 200) % 2 ? 'happy2' : 'happy1'));
        yield* p.jumpTo(o.rest.x, o.rest.y, 8);
        p.sortY = null;
        sfx.play('joy');
        yield* p.joy(1, 3);
        break;
      }
      case 'trampoline': {
        p.sortY = 100.1;
        yield* p.hopTo(o.rest.x, o.rest.y);
        const n = Math.max(3, Math.round(ms / 650));
        for (let i = 0; i < n; i++) {
          sfx.play('boing');
          yield* tween(ms / n, (t) => {
            p.lift = -Math.sin(Math.PI * t) * 20;
            p.frame = t < 0.12 || t > 0.9 ? 'happy1' : 'happy2';
          });
          this.spawn('sparkle', p.x + (i % 2 ? 9 : -10), p.y - 4, 0, -10, 500);
        }
        break;
      }
      case 'table': {
        // за столиком кормят: открываем крупный план
        p.sortY = 97.9;
        yield* p.hopTo(o.rest.x, o.rest.y);
        this.g.go('feed');
        break;
      }
      case 'slide': {
        p.sortY = 100.1;
        yield* p.hopTo(103, 101);
        sfx.play('climb');
        yield* tween(ms * 0.35, (t) => {
          p.y = 101 + (70 - 101) * t;
          p.frame = Math.floor(t * 8) % 2 ? 'hopStretch' : 'base';
        });
        p.frame = 'happy2';
        sfx.play('whee');
        yield* tween(ms * 0.35, (t) => {
          const e = t * t;
          p.x = 110 + 24 * e;
          p.y = 70 + 24 * e;
        });
        this.spawn('sparkle', 136, 92, 10, -10, 500);
        yield* p.jumpTo(o.rest.x, o.rest.y, 6, 350);
        sfx.play('joy');
        yield* p.joy(1, 3);
        break;
      }
      case 'rope': {
        yield* p.hopTo(o.rest.x, o.rest.y);
        p.sortY = 99.5;
        const period = 700;
        let last = 0;
        yield* during(ms, (t) => {
          const a = ((t / period) % 1) * Math.PI * 2;
          this.ropeAngle = a;
          // веревка внизу (a около π): Пушок подпрыгивает
          const d = Math.cos(a - Math.PI);
          p.lift = d > 0.3 ? -d * 6 : 0;
          p.frame = d > 0.3 ? 'happy2' : 'happy1';
          const turn = Math.floor(t / period);
          if (turn !== last) {
            last = turn;
            sfx.play('rope');
          }
        });
        this.ropeAngle = null;
        sfx.play('joy');
        break;
      }
      case 'kitchen': {
        // Пушок нюхает кастрюльку и зовет на кухню
        yield* p.hopTo(o.rest.x, o.rest.y);
        sfx.play('sniff');
        this.spawn('steam', 168, 26, 0, -9, 900);
        yield* during(500, () => (p.frame = 'sniff'));
        this.g.go('kitchen');
        break;
      }
    }
    yield* wait(0);
  }

  // ---------- отрисовка ----------

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    this.drawRoom(r, v);

    const p = this.pushok;
    const active = p.busy;
    type Item = { y: number; order: number; draw: () => void };
    const items: Item[] = HOME_OBJECTS.map((o) => {
      const { h } = sz(o.sprite);
      let sprite: HomeSpriteId = o.sprite;
      if (o.id === 'bed' && (active === 'bed' || active === 'sleep' || active === null) && p.overlay) sprite = 'bedSleep';
      const hideRope = o.id === 'rope' && this.ropeAngle !== null;
      return {
        y: o.y + h,
        order: 0,
        draw: () => {
          if (!hideRope) r.sprite(`home.${sprite}`, HOME_SPRITES[sprite], o.x, o.y);
        },
      };
    });
    items.push({
      y: p.sortY ?? p.y,
      order: 1,
      draw: () => {
        if (this.ropeAngle !== null) this.drawRope(r, false);
        r.pushok(p);
        if (!p.busy && moodOf(this.satiety()) !== 'full') {
          const bob = Math.round(Math.sin(this.time / 400));
          r.sprite('item.thought', ITEM_ICONS.thought, p.x + 2, p.y - 31 + bob);
        }
        if (p.overlay) r.sprite(`home.${p.overlay.sprite}`, HOME_SPRITES[p.overlay.sprite], p.overlay.x, p.overlay.y);
        if (this.ropeAngle !== null) this.drawRope(r, true);
      },
    });
    items.sort((a, b) => a.y - b.y || a.order - b.order);
    for (const it of items) it.draw();

    if (this.nightLevel > 0.01) this.drawNight(r, v);

    for (const q of this.particles) {
      if (q.life < 200 && Math.floor(q.life / 50) % 2) continue; // мягкое мерцание перед исчезновением
      r.sprite(`small.${q.sprite}`, SMALL_SPRITES[q.sprite], q.x, q.y);
    }

    this.drawUi(r, safe);
  }

  private drawRoom(r: Renderer, v: { x0: number; y0: number; x1: number; y1: number }) {
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    // стена в мелкий горошек
    r.rect(x0, y0, w, FLOOR_Y - y0, '#FFF4E2');
    for (let y = 6; y < FLOOR_Y - 4; y += 10) {
      for (let x = Math.floor(x0 / 12) * 12 + (y % 20 ? 6 : 0); x < x0 + w; x += 12) r.rect(x, y, 1, 1, '#F6DFC3');
    }
    // окно с облачком
    // окно ниже кнопок: сверху справа им нужно место
    const wy = 28;
    r.rect(74, wy, 28, 20, '#5A4650');
    r.rect(75, wy + 1, 26, 18, '#BFE6FA');
    r.rect(80, wy + 5, 7, 3, '#FFFFFF');
    r.rect(82, wy + 4, 4, 1, '#FFFFFF');
    r.rect(92, wy + 11, 6, 2, '#FFFFFF');
    r.rect(87, wy + 1, 1, 18, '#5A4650');
    r.rect(75, wy + 9, 26, 1, '#5A4650');
    r.rect(72, wy + 20, 32, 2, '#B9825A');
    // плинтус и пол
    r.rect(x0, FLOOR_Y, w, 1, '#5A4650');
    r.rect(x0, FLOOR_Y + 1, w, 2, '#E7B985');
    const yEnd = Math.ceil(v.y1) + 1;
    r.rect(x0, FLOOR_Y + 3, w, yEnd - FLOOR_Y - 3, '#F3D6AE');
    for (let y = FLOOR_Y + 12, row = 0; y < yEnd; y += 10, row++) {
      r.rect(x0, y, w, 1, '#E5BF90');
      for (let x = Math.floor(x0 / 32) * 32 + (row % 2 ? 16 : 0); x < x0 + w; x += 32) r.rect(x, y - 9, 1, 9, '#E9C79C');
    }
    // коврик
    r.rect(68, 78, 40, 9, '#F7C6D3');
    r.rect(70, 77, 36, 1, '#F7C6D3');
    r.rect(70, 87, 36, 1, '#F7C6D3');
    for (let x = 72; x < 106; x += 6) r.rect(x, 82, 2, 1, '#F7A9C0');
  }

  /** Ночь: комната темнеет (синий фильтр), в окне месяц и звезды. */
  private drawNight(r: Renderer, v: { x0: number; y0: number; x1: number; y1: number }) {
    const k = this.nightLevel;
    const c = r.ctx;
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * k);
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = `rgb(${lerp(255, 124)},${lerp(255, 130)},${lerp(255, 196)})`;
    c.fillRect(Math.floor(v.x0) - 1, Math.floor(v.y0) - 1, Math.ceil(v.x1 - v.x0) + 2, Math.ceil(v.y1 - v.y0) + 2);
    c.restore();
    // окно: ночное небо
    c.save();
    c.globalAlpha = k;
    const wy = 28;
    r.rect(75, wy + 1, 12, 8, '#232963');
    r.rect(88, wy + 1, 13, 8, '#232963');
    r.rect(75, wy + 10, 12, 9, '#232963');
    r.rect(88, wy + 10, 13, 9, '#232963');
    r.rect(92, wy + 3, 4, 4, '#FFF6C8'); // месяц
    r.rect(94, wy + 2, 3, 3, '#232963');
    for (const [sx, sy] of [[78, 3], [83, 6], [80, 13], [90, 14], [97, 12], [85, 16]]) {
      if ((Math.floor(this.time / 400) + sx) % 5 !== 0) r.rect(sx, wy + sy, 1, 1, '#FFF6C8');
    }
    // ночник у кроватки
    r.rect(36, 52, 3, 4, '#5A4650');
    r.rect(35, 49, 5, 3, '#F5C542');
    c.restore();
  }

  /** Скакалка как дуга между «лапками». front = часть перед Пушком. */
  private drawRope(r: Renderer, front: boolean) {
    const a = this.ropeAngle!;
    const isFront = Math.sin(a) > 0;
    if (isFront !== front) return;
    const p = this.pushok;
    const hx = Math.round(p.x);
    const hy = Math.round(p.y) - 8;
    const half = 12;
    const sag = -Math.cos(a) * 10; // >0 вниз
    for (let dx = -half; dx <= half; dx++) {
      const t = dx / half;
      const y = Math.round(hy + sag * (1 - t * t));
      r.rect(hx + dx, y, 1, 1, '#E8457A');
    }
    r.rect(hx - half - 2, hy - 1, 3, 3, '#5A4650');
    r.rect(hx - half - 1, hy, 1, 1, '#F5C542');
    r.rect(hx + half, hy - 1, 3, 3, '#5A4650');
    r.rect(hx + half + 1, hy, 1, 1, '#F5C542');
  }

  private drawUi(r: Renderer, safe: { x0: number; y0: number; x1: number; y1: number }) {
    const icons: Record<UiButton, SpriteDef> = { cloud: ICONS.cloud, wardrobe: ICONS.wardrobe, basket: ICONS.basket, music: MUSIC_SPRITES.note };
    for (const b of this.buttonRects(safe)) {
      const wl = this.wiggle[b.id];
      const dx = wl ? Math.round(Math.sin(wl / 40) * 1.5) : 0;
      r.sprite('icon.button', ICONS.button, b.x + dx, b.y);
      const ic = icons[b.id];
      const iw = ic.rows[0].length;
      const ih = ic.rows.length;
      r.sprite(`btn.${b.id}`, ic, b.x + dx + Math.floor((22 - iw) / 2), b.y + Math.floor((22 - ih) / 2));
    }
    const g = this.gearRect(safe);
    r.bmp(bitmap('icon.gear', ICONS.gear), g.x, g.y);
    // сытость сердечком и денежки кружочками, без цифр
    drawSatiety(r, g.x + 18, g.y, this.satiety());
    drawCoins(r, g.x + 35, g.y + 1, this.store.data.coins, 10, 30);
    if (unseenUnlocks(this.store.data).length) {
      // в гардеробе обновка: искорка над кнопкой шкафа
      const w = this.buttonRects(safe).find((b) => b.id === 'wardrobe')!;
      if (Math.floor(this.time / 300) % 2) r.sprite('small.sparkle', SMALL_SPRITES.sparkle, w.x + 17, w.y);
    }
    if (this.gearHold > 0) {
      // кольцо из пикселей вокруг шестеренки
      const n = 28;
      const lit = Math.floor(this.gearHold * n);
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = Math.round(g.x + 6 + Math.cos(ang) * 9 - 0.5);
        const y = Math.round(g.y + 6 + Math.sin(ang) * 9 - 0.5);
        r.rect(x, y, 1, 1, i < lit ? '#E8457A' : '#E9D3BC');
      }
    }
  }
}

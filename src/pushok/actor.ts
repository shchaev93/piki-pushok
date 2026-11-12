import { CONFIG } from '../config';
import type { HatId } from '../sprites/hats';
import type { HomeSpriteId } from '../sprites/home-objects';
import type { PushokFrame } from '../sprites/pushok';

/**
 * Сценарий = генератор: каждый yield ждет следующего кадра и получает dt в мс.
 * Так анимации пишутся последовательно: «допрыгать, поспать, вылезти».
 */
export type Script = Generator<void, void, number>;

export function* wait(ms: number): Script {
  let t = 0;
  while (t < ms) t += yield;
}

/** f(t) с t от 0 до 1 за ms миллисекунд. */
export function* tween(ms: number, f: (t: number) => void): Script {
  let t = 0;
  f(0);
  while (t < ms) {
    t += yield;
    f(Math.min(1, t / ms));
  }
}

/** Каждый кадр в течение ms вызывает f(прошло, dt). */
export function* during(ms: number, f: (elapsed: number, dt: number) => void): Script {
  let t = 0;
  while (t < ms) {
    const dt: number = yield;
    t += dt;
    f(Math.min(t, ms), dt);
  }
}

export interface Overlay {
  sprite: HomeSpriteId;
  x: number;
  y: number;
}

export class Pushok {
  /** Нижний центр Пушка в координатах сцены. */
  x = 86;
  y = 80;
  /** Подъем над землей при прыжке (отрицательное значение = выше). */
  lift = 0;
  frame: PushokFrame = 'base';
  hat: HatId | null = null;
  guitar: string | null = null;
  sweater: string | null = null;
  /** Кадр «по умолчанию»: обычный или грустный (очень голодный). */
  idleFrame: PushokFrame = 'base';
  /** Порядок отрисовки: по умолчанию по y, занятие может поставить его перед или за предметом. */
  sortY: number | null = null;
  /** Предмет, нарисованный поверх Пушка (одеяло). */
  overlay: Overlay | null = null;
  /** Чем сейчас занят (id предмета) или null. */
  busy: string | null = null;
  speedFactor = 1;

  private script: Script | null = null;
  private blinkIn = 3000;
  private blinkLeft = 0;

  constructor(private onHopLand: () => void = () => {}) {}

  get displayFrame(): PushokFrame {
    const f = this.frame === 'base' ? this.idleFrame : this.frame;
    return f === 'base' && this.blinkLeft > 0 ? 'blink' : f;
  }

  /** Запускает новый сценарий, прерывая текущий (ребенок может тапать что угодно). */
  run(busy: string | null, script: Script) {
    this.resetPose();
    this.busy = busy;
    this.script = script;
    this.step(0);
  }

  update(dt: number) {
    if (this.script) this.step(dt);
    if (this.blinkLeft > 0) this.blinkLeft -= dt;
    else if ((this.blinkIn -= dt) <= 0) {
      this.blinkLeft = CONFIG.pushok.blinkMs;
      const [a, b] = CONFIG.pushok.blinkEveryMs;
      this.blinkIn = a + Math.random() * (b - a);
    }
  }

  private step(dt: number) {
    const r = this.script!.next(dt);
    if (r.done) {
      this.script = null;
      this.busy = null;
      this.resetPose();
    }
  }

  private resetPose() {
    this.frame = 'base';
    this.lift = 0;
    this.sortY = null;
    this.overlay = null;
  }

  /** Перемещение прыжками к точке (x, y). */
  *hopTo(x: number, y: number): Script {
    const { hopSpeed, hopMs, hopHeight } = CONFIG.pushok;
    const sx = this.x;
    const sy = this.y;
    const dist = Math.hypot(x - sx, y - sy);
    if (dist < 0.5) return;
    const total = Math.max(hopMs, (dist / (hopSpeed * this.speedFactor)) * 1000);
    const hops = Math.max(1, Math.round(total / hopMs));
    const ms = hops * hopMs;
    let lastHop = 0;
    yield* tween(ms, (t) => {
      this.x = sx + (x - sx) * t;
      this.y = sy + (y - sy) * t;
      const ph = (t * hops) % 1;
      const hop = Math.floor(t * hops);
      this.lift = t >= 1 ? 0 : -Math.sin(Math.PI * ph) * hopHeight;
      this.frame = t >= 1 || ph < 0.18 || ph > 0.85 ? 'hopSquash' : 'hopStretch';
      if (hop !== lastHop) {
        lastHop = hop;
        this.onHopLand();
      }
    });
    this.frame = 'base';
    this.lift = 0;
  }

  /** Один большой прыжок по дуге (в ванну, на кроватку). */
  *jumpTo(x: number, y: number, height = 10, ms = 450): Script {
    const sx = this.x;
    const sy = this.y;
    yield* tween(ms, (t) => {
      this.x = sx + (x - sx) * t;
      this.y = sy + (y - sy) * t;
      this.lift = -Math.sin(Math.PI * t) * height;
      this.frame = t < 0.15 || t > 0.9 ? 'hopSquash' : 'hopStretch';
    });
    this.lift = 0;
    this.frame = 'base';
    this.onHopLand();
  }

  /** Радостное подпрыгивание на месте (2 кадра радости). */
  *joy(times = 2, height = 5): Script {
    for (let i = 0; i < times; i++) {
      yield* tween(380, (t) => {
        this.lift = -Math.sin(Math.PI * t) * height;
        this.frame = t < 0.2 || t > 0.85 ? 'happy1' : 'happy2';
      });
    }
    this.lift = 0;
    this.frame = 'base';
  }
}

import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { dress } from '../pushok/dress';
import { during, Pushok, type Script } from '../pushok/actor';
import { MUSIC_SPRITES } from '../sprites/items';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { BTN, drawHomeButton, homeButton } from './ui';

// Музыкальная комната: пианино с крупными радужными клавишами, барабан,
// тарелка и микрофон. Ребенок играет, Пушок пританцовывает, а у микрофона
// поет тонким голоском. Без правильных и неправильных нот.

const S = 2; // Пушок крупнее, чем в домике
const STAGE_Y = 74;
const HOME_X = 88;
const MIC_X = 116;

const KEYS = {
  y: 80,
  h: 26,
  w: 22,
  x0: 8,
  // до мажор, вторая октава: звонко и по-детски
  freq: [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5],
  color: ['#F7A9C0', '#F5A04A', '#F5C542', '#9BD38A', '#8ECDF2', '#7FA8E8', '#C9A6E8', '#E8457A'],
};

/** Песенки Пушка (простые собственные мотивы), по кругу. */
export const SONGS: readonly (readonly number[])[] = [
  [784, 659, 784, 659, 880, 784, 659, 523],
  [523, 659, 784, 1047, 988, 784, 880, 784],
  [659, 698, 784, 659, 587, 523, 587, 659, 523],
];

const DRUM = { x: 144, y: 54 };
const CYMBAL = { x: 172, y: 40 };
const MIC = { x: MIC_X + 15, y: 53 };

export class MusicScene implements Scene {
  readonly id = 'music' as const;
  private pushok = new Pushok(() => this.g.sfx.play('hop'));
  private particles = new Particles();
  private pressed = new Map<number, number>(); // клавиша → мс подсветки
  private drumHit = 0;
  private cymbalHit = 0;
  private time = 0;
  private song = 0;
  /** Для e2e-тестов: сколько песен спето и нот сыграно. */
  songsSung = 0;
  notesPlayed = 0;

  constructor(private g: Game) {
    const s = g.store.data;
    dress(this.pushok, s);
    this.pushok.x = HOME_X;
    this.pushok.y = STAGE_Y;
  }

  get singing() {
    return this.pushok.busy === 'sing';
  }

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    KEYS.freq.forEach((_, i) => {
      list.push({ id: `key:${i}`, x: KEYS.x0 + i * KEYS.w, y: KEYS.y, w: KEYS.w, h: KEYS.h, onTap: () => this.key(i) });
    });
    list.push({ id: 'drum', x: DRUM.x, y: DRUM.y, w: 28, h: 20, onTap: () => this.drum() });
    list.push({ id: 'cymbal', x: CYMBAL.x, y: CYMBAL.y, w: 18, h: 12, onTap: () => this.cymbal() });
    list.push({ id: 'mic', x: MIC.x, y: MIC.y, w: 12, h: 22, onTap: () => this.mic() });
    const p = this.pushok;
    list.push({ id: 'pushok', x: p.x - 8 * S, y: p.y - 16 * S, w: 17 * S, h: 16 * S, onTap: () => this.tapPushok() });
    return list;
  }

  // ---------- инструменты ----------

  private key(i: number) {
    this.g.sfx.piano(KEYS.freq[i]);
    this.pressed.set(i, 220);
    this.notesPlayed++;
    this.particles.spawn('note', KEYS.x0 + i * KEYS.w + 8, KEYS.y - 8, (Math.random() - 0.5) * 8, -18, 900);
    this.dance();
  }

  private drum() {
    this.g.sfx.drum();
    this.drumHit = 140;
    this.particles.burst(DRUM.x + 14, DRUM.y + 4, 4);
    this.dance(6);
  }

  private cymbal() {
    this.g.sfx.cymbal();
    this.cymbalHit = 400;
    this.particles.spawn('sparkle', CYMBAL.x + 9, CYMBAL.y, 10, -12, 500);
    this.dance();
  }

  /** Пушок пританцовывает в такт (если не поет и не играет на гитаре). */
  private dance(height = 4) {
    if (this.pushok.busy) return;
    this.pushok.run(null, this.pushok.joy(1, height));
  }

  private mic() {
    if (this.pushok.busy === 'sing') return;
    this.pushok.run('sing', this.singScript());
  }

  private *singScript(): Script {
    const p = this.pushok;
    yield* p.hopTo(MIC_X, STAGE_Y);
    const notes = SONGS[this.song % SONGS.length];
    this.song++;
    this.songsSung++;
    const step = 320;
    const ms = this.g.sfx.sing(notes, step / 1000);
    let last = -1;
    yield* during(ms, (t) => {
      const syl = Math.floor(t / step);
      // рот открыт на каждом «ля»
      p.frame = t % step < step * 0.7 ? 'eatOpen' : 'happy1';
      p.lift = -Math.abs(Math.sin((t / step) * Math.PI)) * 1.5;
      if (syl !== last) {
        last = syl;
        this.particles.spawn('note', MIC_X + 8 + Math.random() * 14, STAGE_Y - 34 - Math.random() * 6, -6 + Math.random() * 18, -12 - Math.random() * 8, 1100);
      }
    });
    p.lift = 0;
    this.particles.spawn('heart', MIC_X, STAGE_Y - 40, 0, -12, 900);
    this.g.sfx.play('joy');
    yield* p.joy(1, 4);
    yield* p.hopTo(HOME_X, STAGE_Y);
  }

  private tapPushok() {
    if (this.pushok.busy) return;
    if (this.pushok.guitar) {
      this.g.sfx.melody(this.pushok.guitar);
      this.pushok.run('music', this.guitarScript());
    } else {
      this.g.sfx.play('joy');
      this.pushok.run(null, this.pushok.joy(2, 4));
    }
  }

  private *guitarScript(): Script {
    const p = this.pushok;
    let n = 0;
    yield* during(1400, (t) => {
      p.frame = Math.floor(t / 170) % 2 ? 'happy2' : 'happy1';
      if (t > n) {
        n += 300;
        this.particles.spawn('note', p.x + 12 + Math.random() * 8, p.y - 30, 6 + Math.random() * 8, -16, 1000);
      }
    });
  }

  update(dt: number) {
    this.time += dt;
    this.pushok.update(dt);
    this.particles.update(dt);
    for (const [k, v] of this.pressed) {
      if (v - dt <= 0) this.pressed.delete(k);
      else this.pressed.set(k, v - dt);
    }
    this.drumHit = Math.max(0, this.drumHit - dt);
    this.cymbalHit = Math.max(0, this.cymbalHit - dt);
  }

  // ---------- отрисовка ----------

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    // сиреневые стены с нотками, деревянная сцена
    r.rect(x0, y0, w, yEnd - y0, '#EDE3F7');
    for (let y = 8; y < STAGE_Y - 6; y += 14) {
      for (let x = Math.floor(x0 / 18) * 18 + (y % 28 ? 9 : 0); x < x0 + w; x += 18) {
        r.rect(x, y, 1, 4, '#DCCBEE');
        r.rect(x - 2, y + 3, 2, 2, '#DCCBEE');
      }
    }
    // гирлянда-огоньки
    for (let x = Math.floor(x0 / 10) * 10; x < x0 + w; x += 10) {
      const on = Math.floor(this.time / 400 + x / 10) % 3;
      r.rect(x, 30 + (Math.floor(x / 10) % 2), 2, 2, ['#F5C542', '#F7A9C0', '#8ECDF2'][on]);
    }
    r.rect(x0, 30, w, 1, '#C9A6E8');
    r.rect(x0, STAGE_Y, w, 6, '#D9A066');
    r.rect(x0, STAGE_Y, w, 1, '#5A4650');
    r.rect(x0, STAGE_Y + 6, w, yEnd - STAGE_Y - 6, '#5A4650');

    // барабан и тарелка
    const cy = this.cymbalHit > 0 ? Math.round(Math.sin(this.cymbalHit / 30)) : 0;
    r.sprite('music.cymbal', MUSIC_SPRITES.cymbal, CYMBAL.x, CYMBAL.y + cy);
    r.sprite('music.drum', MUSIC_SPRITES.drum, DRUM.x, DRUM.y + (this.drumHit > 0 ? 1 : 0));

    // Пушок
    const p = this.pushok;
    const lift = p.lift;
    p.lift = lift * S;
    r.pushok(p, S);
    p.lift = lift;
    // микрофон перед Пушком: он поет прямо в него
    r.sprite('music.mic', MUSIC_SPRITES.mic, MIC.x, MIC.y);

    // пианино: корпус и радужные клавиши
    r.rect(KEYS.x0 - 4, KEYS.y - 6, KEYS.w * 8 + 8, KEYS.h + 10, '#5A4650');
    r.rect(KEYS.x0 - 3, KEYS.y - 5, KEYS.w * 8 + 6, 3, '#7A6670');
    r.rect(KEYS.x0 - 3, KEYS.y - 2, KEYS.w * 8 + 6, 1, '#F5C542');
    KEYS.color.forEach((c, i) => {
      const down = this.pressed.has(i) ? 2 : 0;
      const x = KEYS.x0 + i * KEYS.w;
      r.rect(x + 1, KEYS.y + down, KEYS.w - 2, KEYS.h - 1 - down, c);
      r.rect(x + 3, KEYS.y + 2 + down, 3, KEYS.h - 8, 'rgba(255,255,255,0.45)');
    });

    this.particles.draw(r);
    drawHomeButton(r, safe);
  }
}

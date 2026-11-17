import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { Pushok } from '../pushok/actor';
import { dress } from '../pushok/dress';
import { emotionScript } from '../pushok/emotion';
import { CharCanvas, type SpriteDef } from '../sprites/grid';
import { FURN_PALETTE } from '../sprites/home-objects';
import type { Cue, TalkPhase, TalkSession, Why } from '../talk/session';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { CONFIG } from '../config';
import { drawHomeButton, homeButton, BTN } from './ui';

// Комната «Разговор»: крупный Пушок и большая кнопка-микрофон. Пушок слушает сам;
// кнопка — «я договорила», «помолчи» (пока он говорит) или «проснись» (после дремы).
// Можно держать и горизонтально, и вертикально (как видеозвонок).
// Сам разговор живет в TalkSession и продолжается в домике.

export { localDay, outfitText, talkLeftMs } from '../talk/session';

const S = 3;

/** Где что стоит: сцена 192×108 или вертикальная 108×192. */
const GEO = {
  land: { P: { x: 96, y: 70 }, MIC: { x: 96, y: 89 }, floor: 76 },
  port: { P: { x: 54, y: 120 }, MIC: { x: 54, y: 160 }, floor: 126 },
};
const MIC_R = 15;

const MIC_ICON: SpriteDef = {
  palette: FURN_PALETTE,
  rows: [
    '..OOOOO..',
    '.OSSSSSO.',
    '.OSSSSSO.',
    '.OSSSSSO.',
    '.OSSSSSO.',
    '.OSSSSSO.',
    'O.OSSSO.O',
    'O..OOO..O',
    '.O.....O.',
    '..OOOOO..',
    '....O....',
    '..OOOOO..',
  ],
};

const discDef = (fill: string, ring: string): SpriteDef => ({
  palette: { ...FURN_PALETTE, X: fill, Q: ring },
  rows: new CharCanvas(31, 31).disc(15.5, 15.5, 15.4, 15.4, 'X', 'Q').rows(),
});
const MIC_IDLE = discDef('#FFFFFF', '#E8457A');
const MIC_ON = discDef('#F7A9C0', '#E8457A');
const MIC_OFF = discDef('#E9E1E4', '#B8A9B0');

export class TalkScene implements Scene {
  readonly id = 'talk' as const;
  readonly portrait = true;
  private pushok = new Pushok();
  private particles = new Particles(2);
  private time = 0;
  /** Последняя отрисовка была вертикальной (от этого зависят цели касания). */
  private vertical = false;
  private talk: TalkSession;

  constructor(private g: Game) {
    this.talk = g.talk;
    dress(this.pushok, g.store.data);
    this.place();
    this.talk.onCue = (c) => this.onCue(c);
  }

  get phase(): TalkPhase {
    return this.talk.phase;
  }

  get why(): Why {
    return this.talk.why;
  }

  private get geo() {
    return this.vertical ? GEO.port : GEO.land;
  }

  private place() {
    this.pushok.x = this.geo.P.x;
    this.pushok.y = this.geo.P.y;
  }

  private onCue(c: Cue) {
    if (c.actions.length) {
      // просят покататься с горки и т.п.: Пушок бежит в домик и делает это там (одно или два подряд)
      this.talk.pendingCue = c;
      this.g.go('home');
      return;
    }
    if (c.emotion) {
      const p = this.pushok;
      p.run('emotion', emotionScript(p, c.emotion, (s, x, y, vx, vy, life) => this.particles.spawn(s, x, y, vx * 2, vy * 2, life), S));
    }
  }

  // ---------- касания ----------

  targets(safe: Rect): Target[] {
    const h = homeButton(safe);
    const m = this.geo.MIC;
    return [
      { id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') },
      { id: 'mic', x: m.x - MIC_R, y: m.y - MIC_R, w: MIC_R * 2, h: MIC_R * 2, onTap: () => this.talk.tapMic() },
    ];
  }

  // ---------- время ----------

  update(dt: number) {
    this.time += dt;
    this.pushok.update(dt);
    this.particles.update(dt);
    const p = this.pushok;
    const phase = this.talk.phase;
    if (phase === 'sleeping' || phase === 'offline') {
      if (Math.floor(this.time / 1400) !== Math.floor((this.time - dt) / 1400)) {
        this.particles.spawn('z', p.x + 18, p.y - 46, 6, -8, 1600);
      }
    }
    if (p.busy) return; // эмоция ведет Пушка сама
    p.lift = 0;
    switch (phase) {
      case 'listening':
        p.frame = 'base';
        p.lift = this.talk.hearing ? -Math.round(this.talk.rec.level * 2) : 0;
        break;
      case 'thinking':
        p.frame = 'meditate';
        break;
      case 'speaking':
        p.frame = this.talk.voice.level > 0.12 ? 'eatOpen' : 'base';
        break;
      case 'idle':
        p.frame = 'blink';
        break;
      case 'sleeping':
      case 'offline':
        p.frame = 'sleep';
        break;
      default:
        p.frame = 'base';
    }
  }

  // ---------- отрисовка ----------

  draw(r: Renderer) {
    const vertical = r.layout.portrait;
    if (vertical !== this.vertical) {
      this.vertical = vertical;
      this.place();
    }
    const { P, MIC, floor } = this.geo;
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    const phase = this.talk.phase;
    const night = phase === 'sleeping' || phase === 'offline';
    r.rect(x0, y0, w, yEnd - y0, night ? '#3A3F7A' : '#FDEFF4');
    for (let y = 8; y < floor; y += 12) {
      for (let x = Math.floor(x0 / 16) * 16 + (y % 24 ? 8 : 0); x < x0 + w; x += 16) {
        r.rect(x, y, 2, 2, night ? '#545AA0' : '#F9D9E3');
      }
    }
    r.rect(x0, floor, w, yEnd - floor, night ? '#2C3066' : '#F3D6AE');
    r.rect(x0, floor, w, 1, '#5A4650');
    // подушка под Пушком
    r.rect(P.x - 30, P.y - 4, 60, 8, '#5A4650');
    r.rect(P.x - 29, P.y - 3, 58, 6, '#C9A6E8');

    const p = this.pushok;
    const lift = p.lift;
    p.lift = lift * S;
    r.pushok(p, S);
    p.lift = lift;

    if (phase === 'thinking' || phase === 'connecting') {
      // мысль-облачко с бегущими точками
      const cx = Math.min(P.x + 22, Math.floor(v.x1) - 30);
      const cy = P.y - 56;
      r.rect(cx, cy, 28, 14, '#5A4650');
      r.rect(cx + 1, cy + 1, 26, 12, '#FFFFFF');
      r.rect(cx - 2, cy + 15, 3, 3, '#FFFFFF');
      const k = Math.floor(this.time / 300) % 4;
      for (let i = 0; i < 3; i++) r.rect(cx + 6 + i * 6, cy + 6, 3, 3, i < k ? '#E8457A' : '#F3D6E0');
    }

    // кнопка-микрофон: белая — слушает, розовая — слышит речь, серая — думает или спит
    const hearing = this.talk.hearing;
    const disabled = phase === 'thinking' || phase === 'connecting' || night;
    const disc = hearing ? MIC_ON : disabled ? MIC_OFF : MIC_IDLE;
    const pulse = phase === 'idle' ? Math.round(Math.abs(Math.sin(this.time / 400)) * 2) : 0;
    r.sprite(hearing ? 'talk.micOn' : disabled ? 'talk.micOff' : 'talk.micIdle', disc, MIC.x - 15, MIC.y - 15 - pulse);
    r.sprite('talk.mic', MIC_ICON, MIC.x - 4, MIC.y - 6 - pulse);
    if (phase === 'listening') {
      // кольцо: тихо бегущие точки — слушает; кольцо от громкости — слышит
      const rr = 17 + (hearing ? this.talk.rec.level * 6 : 0);
      const lit = hearing ? 20 : 3;
      const off = Math.floor(this.time / 120);
      for (let i = 0; i < 20; i++) {
        if (!hearing && (i + off) % 20 >= lit) continue;
        const a = (i / 20) * Math.PI * 2;
        r.rect(Math.round(MIC.x + Math.cos(a) * rr), Math.round(MIC.y + Math.sin(a) * rr), 2, 2, '#E8457A');
      }
    }

    // сколько минут осталось: огоньки сверху, по одному на минуту
    const total = CONFIG.talk.minutesPerDay + Math.round(this.g.store.data.talk.extraMs / 60_000);
    const left = Math.max(0, Math.ceil(this.talk.leftMs / 60_000));
    const step = vertical ? 3 : 4;
    const perRow = vertical ? 15 : 40;
    const cx0 = Math.round((v.x0 + v.x1) / 2);
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, total - row * perRow);
      const x = cx0 - Math.round((inRow * step) / 2) + (i % perRow) * step;
      const y = Math.max(4, Math.ceil(safe.y0) + 4) + (vertical ? 26 : 0) + row * step;
      r.rect(x, y, step - 1, step - 1, i < left ? '#F5C542' : night ? '#545AA0' : '#E9D3BC');
    }

    this.particles.draw(r);
    drawHomeButton(r, safe);
  }
}

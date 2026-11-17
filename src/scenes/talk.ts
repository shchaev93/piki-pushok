import { Sfx } from '../audio/sfx';
import { CONFIG } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { Pushok } from '../pushok/actor';
import { dress } from '../pushok/dress';
import type { Save, TalkTurn } from '../save/schema';
import { CharCanvas, type SpriteDef } from '../sprites/grid';
import { FURN_PALETTE } from '../sprites/home-objects';
import { api, TalkError, type TalkEvent } from '../talk/api';
import { VoicePlayer } from '../talk/player';
import { Recorder, toBase64 } from '../talk/recorder';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { BTN, drawHomeButton, homeButton } from './ui';

// Комната «Разговор»: большая кнопка-микрофон. Тап — Пушок слушает, повторный тап
// или пауза — отправить. Пока Пушок говорит, микрофон выключен (нет эха).
// 20 минут в день; за 3 минуты Пушок зевает, в конце прощается до завтра.

export type TalkPhase = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'sleeping' | 'offline';
type Why = 'time' | 'budget' | 'config' | 'auth' | 'network' | 'mic' | null;

const T = CONFIG.talk;
const S = 3;
const P = { x: 96, y: 70 };
const MIC = { x: 96, y: 89, r: 15 };

const OUTFIT: Record<string, Record<string, string>> = {
  hat: {
    crown: 'корона', star: 'звездочка', bow: 'бантик', flower: 'цветочек', wreath: 'веночек', cap: 'кепка',
    pompom: 'шапка с помпоном', bunny: 'ушки зайчика', cherry: 'шляпка с вишенкой', party: 'праздничный колпачок',
    heart: 'ободок с сердечком', rainbow: 'радужная шляпка',
  },
  sweater: {
    heart: 'розовая кофточка с сердечком', stripes: 'голубая кофточка в полоску', dots: 'желтая кофточка в горошек',
    star: 'зеленая кофточка со звездочкой', zigzag: 'сиреневая кофточка с зигзагом', rainbow: 'радужная кофточка',
  },
  guitar: {
    pink: 'розовая гитара', green: 'зеленая гитара', blue: 'голубая гитара', lilac: 'сиреневая гитара',
    gold: 'золотая гитара', rainbow: 'радужная гитара',
  },
};

export function outfitText(s: Readonly<Save>): string {
  const e = s.equipped;
  return [OUTFIT.hat[e.hat ?? ''], OUTFIT.sweater[e.sweater ?? ''], OUTFIT.guitar[e.guitar ?? '']].filter(Boolean).join(', ');
}

export const localDay = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Сколько минут разговора осталось сегодня (в мс). */
export function talkLeftMs(s: Readonly<Save>, day = localDay()): number {
  const t = s.talk;
  if (t.day !== day) return T.minutesPerDay * 60_000;
  return T.minutesPerDay * 60_000 + t.extraMs - t.usedMs;
}

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
  phase: TalkPhase = 'connecting';
  why: Why = null;
  private pushok = new Pushok();
  private particles = new Particles();
  private rec = new Recorder();
  private voice = new VoicePlayer();
  private time = 0;
  private unsavedMs = 0;
  private pendingEvent: TalkEvent | null = null;
  private turnsSinceNotebook = 0;
  private failures = 0;
  private alive = true;

  constructor(private g: Game) {
    dress(this.pushok, g.store.data);
    this.pushok.x = P.x;
    this.pushok.y = P.y;
    // в комнате разговора iPhone должен и записывать, и играть: в обычном режиме 'playback' микрофон дает тишину
    Sfx.useSession('play-and-record');
    // вход в комнату — касание: здесь можно разбудить звук на iOS
    this.voice.unlock();
    const day = localDay();
    if (g.store.data.talk.day !== day) {
      g.store.update((s) => {
        s.talk.day = day;
        s.talk.usedMs = 0;
        s.talk.extraMs = 0;
        s.talk.warned = false;
      });
    }
    void this.begin();
  }

  private get conf() {
    const t = this.g.store.data.talk;
    return { serverUrl: t.serverUrl, code: t.code };
  }

  get leftMs() {
    return talkLeftMs(this.g.store.data);
  }

  private async begin() {
    if (!this.conf.serverUrl || !this.conf.code) return this.goOffline('config');
    if (this.leftMs <= 0) return this.goSleep('time');
    try {
      if (!this.g.store.data.talk.notebook) {
        const { notebook } = await api.seed(this.conf);
        if (this.alive) this.g.store.update((s) => (s.talk.notebook = notebook));
      }
      await this.exchange({ event: 'start' });
    } catch (e) {
      this.onError(e);
    }
  }

  /** Один обмен репликами: отправить звук и/или событие, озвучить ответ. */
  private async exchange(req: { audio?: string; event?: TalkEvent }) {
    this.phase = 'thinking';
    const event = req.event ?? this.pendingEvent ?? undefined;
    this.pendingEvent = null;
    const s = this.g.store.data;
    const r = await api.talk(this.conf, {
      audio: req.audio,
      event,
      history: s.talk.history,
      notebook: s.talk.notebook,
      outfit: outfitText(s),
    });
    if (!this.alive) return;
    this.failures = 0;
    const now = Date.now();
    const turns: TalkTurn[] = [];
    if (event) turns.push({ at: now, role: 'event', text: `[Событие: ${event === 'start' ? 'начало разговора' : event === 'warn' ? 'осталось 3 минуты' : 'время вышло'}]` });
    if (r.heard) turns.push({ at: now, role: 'kira', text: r.heard });
    turns.push({ at: now, role: 'pushok', text: r.reply });
    this.g.store.update((d) => {
      d.talk.history.push(...turns);
      if (d.talk.history.length > 400) d.talk.history.splice(0, d.talk.history.length - 400);
    });
    if (r.heard) this.turnsSinceNotebook++;
    this.phase = 'speaking';
    await this.voice.play(r.audio);
    if (!this.alive) return;
    if (event === 'end') {
      this.goSleep('time');
      void this.saveNotebook();
      return;
    }
    this.phase = 'idle';
    // записка для родителей или пора обновить тетрадку
    if (this.turnsSinceNotebook >= T.notebookEveryTurns || /запиш|для пап|для мам|секрет|список/i.test(r.heard)) void this.saveNotebook();
  }

  private async saveNotebook() {
    if (!this.turnsSinceNotebook) return;
    const s = this.g.store.data;
    const chunk = s.talk.history.slice(-Math.max(8, this.turnsSinceNotebook * 2 + 2));
    this.turnsSinceNotebook = 0;
    try {
      const r = await api.notebook(this.conf, s.talk.notebook, chunk);
      if (r.changed) this.g.store.update((d) => (d.talk.notebook = r.notebook));
    } catch {
      /* тетрадка обновится в следующий раз */
    }
  }

  private onError(e: unknown) {
    if (!this.alive) return;
    const kind = e instanceof TalkError ? e.kind : 'network';
    if (kind === 'budget') return this.goSleep('budget');
    if (kind === 'auth' || kind === 'config') return this.goOffline(kind);
    this.failures++;
    this.g.sfx.play('nope');
    if (this.failures >= 2) return this.goOffline('network');
    this.phase = 'idle';
  }

  private goSleep(why: Why) {
    this.phase = 'sleeping';
    this.why = why;
  }

  private goOffline(why: Why) {
    this.phase = 'offline';
    this.why = why;
  }

  // ---------- касания ----------

  targets(safe: Rect): Target[] {
    const h = homeButton(safe);
    return [
      { id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.leaveHome() },
      { id: 'mic', x: MIC.x - MIC.r, y: MIC.y - MIC.r, w: MIC.r * 2, h: MIC.r * 2, onTap: () => this.tapMic() },
    ];
  }

  private leaveHome() {
    this.g.go('home');
  }

  /** Уход из комнаты: остановить запись и голос, дописать тетрадку. */
  leave() {
    this.alive = false;
    this.rec.stop();
    this.voice.stop();
    this.flushTime();
    void this.saveNotebook();
    Sfx.usePlaybackSession();
  }

  private tapMic() {
    this.voice.unlock();
    if (this.phase === 'idle') void this.listen();
    else if (this.phase === 'listening') this.rec.stop();
    else if (this.phase === 'speaking') {
      this.voice.stop(); // перебить Пушка можно
    } else if (this.phase === 'offline' && this.why === 'network') {
      this.failures = 0;
      this.phase = 'connecting';
      void this.begin();
    } else this.g.sfx.play('nope');
  }

  private async listen() {
    this.phase = 'listening';
    this.g.sfx.play('pop');
    let rec;
    try {
      rec = await this.rec.start();
    } catch {
      return this.goOffline('mic');
    }
    if (!this.alive) return;
    // сама остановила — отправляем (тишину сервер обработает без модели, бесплатно);
    // остановилось само без речи — просто ждем дальше
    if ((!rec.hadSpeech && !rec.manual) || rec.seconds < 0.4) {
      this.phase = 'idle';
      return;
    }
    try {
      await this.exchange({ audio: toBase64(rec.pcm) });
    } catch (e) {
      this.onError(e);
    }
  }

  // ---------- время ----------

  private flushTime() {
    if (this.unsavedMs <= 0) return;
    const ms = this.unsavedMs;
    this.unsavedMs = 0;
    this.g.store.update((s) => (s.talk.usedMs += ms));
  }

  update(dt: number) {
    this.time += dt;
    this.pushok.update(dt);
    this.particles.update(dt);
    this.voice.tick();
    const counting = this.phase === 'idle' || this.phase === 'listening' || this.phase === 'thinking' || this.phase === 'speaking';
    if (counting) {
      this.unsavedMs += dt;
      if (this.unsavedMs > 5000) this.flushTime();
      const left = this.leftMs - this.unsavedMs;
      if (left <= T.warnMinutesLeft * 60_000 && !this.g.store.data.talk.warned) {
        this.g.store.update((s) => (s.talk.warned = true));
        this.pendingEvent = 'warn';
      }
      if (left <= 0 && this.phase === 'idle') {
        this.flushTime();
        void this.exchange({ event: 'end' }).catch((e) => this.onError(e));
      }
    }
    // Пушок: слушает, думает, говорит, спит
    const p = this.pushok;
    p.lift = 0;
    switch (this.phase) {
      case 'listening':
        p.frame = 'base';
        p.lift = -Math.round(this.rec.level * 2);
        break;
      case 'thinking':
        p.frame = 'meditate';
        break;
      case 'speaking':
        p.frame = this.voice.level > 0.12 ? 'eatOpen' : 'base';
        break;
      case 'sleeping':
      case 'offline':
        p.frame = 'sleep';
        if (Math.floor(this.time / 1400) !== Math.floor((this.time - dt) / 1400)) this.particles.spawn('z', P.x + 18, P.y - 46, 6, -8, 1600);
        break;
      default:
        p.frame = 'base';
    }
  }

  // ---------- отрисовка ----------

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    const night = this.phase === 'sleeping' || this.phase === 'offline';
    r.rect(x0, y0, w, yEnd - y0, night ? '#3A3F7A' : '#FDEFF4');
    for (let y = 8; y < 76; y += 12) {
      for (let x = Math.floor(x0 / 16) * 16 + (y % 24 ? 8 : 0); x < x0 + w; x += 16) {
        r.rect(x, y, 2, 2, night ? '#545AA0' : '#F9D9E3');
      }
    }
    r.rect(x0, 76, w, yEnd - 76, night ? '#2C3066' : '#F3D6AE');
    r.rect(x0, 76, w, 1, '#5A4650');
    // подушка под Пушком
    r.rect(P.x - 30, P.y - 4, 60, 8, '#5A4650');
    r.rect(P.x - 29, P.y - 3, 58, 6, '#C9A6E8');

    const p = this.pushok;
    const lift = p.lift;
    p.lift = lift * S;
    r.pushok(p, S);
    p.lift = lift;

    if (this.phase === 'thinking' || this.phase === 'connecting') {
      // мысль-облачко с бегущими точками
      r.rect(P.x + 22, 14, 28, 14, '#5A4650');
      r.rect(P.x + 23, 15, 26, 12, '#FFFFFF');
      r.rect(P.x + 20, 29, 3, 3, '#FFFFFF');
      const k = Math.floor(this.time / 300) % 4;
      for (let i = 0; i < 3; i++) r.rect(P.x + 28 + i * 6, 20, 3, 3, i < k ? '#E8457A' : '#F3D6E0');
    }

    // кнопка-микрофон
    const disabled = this.phase === 'thinking' || this.phase === 'connecting' || night;
    const disc = this.phase === 'listening' ? MIC_ON : disabled ? MIC_OFF : MIC_IDLE;
    const pulse = this.phase === 'idle' ? Math.round(Math.abs(Math.sin(this.time / 400)) * 2) : 0;
    r.sprite(this.phase === 'listening' ? 'talk.micOn' : disabled ? 'talk.micOff' : 'talk.micIdle', disc, MIC.x - 15, MIC.y - 15 - pulse);
    r.sprite('talk.mic', MIC_ICON, MIC.x - 4, MIC.y - 6 - pulse);
    if (this.phase === 'listening') {
      // кольцо громкости
      const rr = 17 + this.rec.level * 6;
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        r.rect(Math.round(MIC.x + Math.cos(a) * rr), Math.round(MIC.y + Math.sin(a) * rr), 2, 2, '#E8457A');
      }
    }

    // сколько минут осталось: огоньки сверху, по одному на минуту
    const total = T.minutesPerDay + Math.round(this.g.store.data.talk.extraMs / 60_000);
    const left = Math.max(0, Math.ceil((this.leftMs - this.unsavedMs) / 60_000));
    const startX = 96 - total * 2;
    for (let i = 0; i < total; i++) r.rect(startX + i * 4, Math.max(4, Math.ceil(safe.y0) + 4), 3, 3, i < left ? '#F5C542' : night ? '#545AA0' : '#E9D3BC');

    this.particles.draw(r);
    drawHomeButton(r, safe);
  }
}

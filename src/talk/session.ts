import { Sfx } from '../audio/sfx';
import { CONFIG, type FoodId } from '../config';
import type { Save, TalkTurn } from '../save/schema';
import type { Game } from '../scenes/scene';
import { api, TalkError, type Action, type Emotion, type Place, type TalkEvent } from './api';
import { VoicePlayer } from './player';
import { Recorder, toBase64 } from './recorder';

// Разговор с Пушком живет поверх комнат: начинается в комнате «Разговор» и продолжается
// в домике (там Пушок еще и делает то, что просят). В других комнатах — пауза.
// Пушок слушает сам, как голосовой режим Claude: заговорила — записал, замолчала — ответил.
// Пока Пушок говорит, микрофон не слушается (нет эха). 20 минут в день;
// за 3 минуты Пушок зевает, в конце прощается до завтра.

export type TalkPhase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'idle' | 'sleeping' | 'offline';
export type Why = 'time' | 'budget' | 'config' | 'auth' | 'network' | 'mic' | null;
export interface Cue {
  emotion: Emotion | null;
  action: Action | null;
  /** Продукты из корзинки для настоящей готовки (action = 'kitchen'). */
  cook: FoodId[] | null;
}

const T = CONFIG.talk;

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

const EVENT_TEXT: Record<TalkEvent, string> = {
  start: '[Событие: начало разговора]',
  warn: '[Событие: осталось 3 минуты]',
  end: '[Событие: время вышло]',
};

export class TalkSession {
  phase: TalkPhase = 'idle';
  why: Why = null;
  /** Разговор начат в комнате «Разговор» и еще не закончился. */
  on = false;
  place: Place = 'talk';
  /** Текущая комната подписывается на эмоции и действия из ответов. */
  onCue: ((c: Cue) => void) | null = null;
  /** Действие, которое попросили в комнате разговора: его сделает домик. */
  pendingCue: Cue | null = null;
  /** Пушок сейчас делает действие (горка, батут…): слушать начнет, когда закончит, — иначе услышит свои «вжух» и «буммм». */
  actionRunning = false;
  readonly rec = new Recorder();
  readonly voice = new VoicePlayer();
  /** Поколение: после паузы или ухода старые ответы и записи никуда не идут. */
  private gen = 0;
  private unsavedMs = 0;
  private pendingEvent: TalkEvent | null = null;
  private endDue = false;
  private turnsSinceNotebook = 0;
  private failures = 0;

  constructor(private g: Game) {}

  private get conf() {
    const t = this.g.store.data.talk;
    return { serverUrl: t.serverUrl, code: t.code };
  }

  get leftMs() {
    return talkLeftMs(this.g.store.data) - this.unsavedMs;
  }

  /** Пушок слышит речь прямо сейчас. */
  get hearing() {
    return this.phase === 'listening' && this.rec.hearing;
  }

  /** Вызывать из касания: на iOS звук и микрофон можно будить только так. */
  prime() {
    Sfx.useSession('play-and-record');
    this.voice.unlock();
    this.rec.prepare();
  }

  /** Вход в комнату «Разговор» (из касания). */
  enterRoom() {
    this.place = 'talk';
    this.prime();
    if (this.on) {
      if (this.phase === 'idle') this.resume();
      return;
    }
    const day = localDay();
    if (this.g.store.data.talk.day !== day) {
      this.g.store.update((s) => {
        s.talk.day = day;
        s.talk.usedMs = 0;
        s.talk.extraMs = 0;
        s.talk.warned = false;
      });
    }
    this.why = null;
    this.failures = 0;
    this.endDue = false;
    const gen = ++this.gen;
    void this.begin(gen);
  }

  /** Вход в домик: если разговор идет — продолжается, после паузы — снова слушает. */
  enterHome() {
    this.place = 'home';
    if (!this.on) {
      Sfx.usePlaybackSession();
      return;
    }
    this.prime();
    if (this.phase === 'idle') this.resume();
  }

  /** Другие комнаты (облачко, магазин, кухня…): микрофон и голос выключаются, разговор на паузе. */
  suspend() {
    if (this.on) {
      this.gen++;
      this.rec.close();
      this.voice.stop();
      this.flushTime();
      void this.saveNotebook();
      this.phase = 'idle';
    }
    Sfx.usePlaybackSession();
  }

  /** Снова слушать после паузы или дремы. */
  resume() {
    if (!this.on || this.phase === 'sleeping' || this.phase === 'offline') return;
    this.prime();
    const gen = ++this.gen;
    void this.loop(gen);
  }

  /** Касание кнопки-микрофона. */
  tapMic() {
    this.prime();
    switch (this.phase) {
      case 'listening':
        this.rec.finish(); // «я договорила»
        break;
      case 'speaking':
        this.voice.stop(); // перебить Пушка можно
        break;
      case 'idle':
        if (this.on) this.resume();
        else this.enterRoom();
        break;
      case 'offline':
        if (this.why === 'network' || this.why === 'mic') this.enterRoom();
        else this.g.sfx.play('nope');
        break;
      default:
        this.g.sfx.play('nope');
    }
  }

  /** Действие для домика (если просили в комнате разговора). */
  takeCue(): Cue | null {
    const c = this.pendingCue;
    this.pendingCue = null;
    return c;
  }

  private async begin(gen: number) {
    if (!this.conf.serverUrl || !this.conf.code) return this.goOffline('config');
    if (talkLeftMs(this.g.store.data) <= 0) return this.goSleep('time');
    this.on = true;
    this.phase = 'connecting';
    // микрофон открываем сразу, пока идет касание (iOS); разрешение спросят один раз
    const mic = this.rec.open().then(
      () => true,
      () => false,
    );
    try {
      if (!this.g.store.data.talk.notebook) {
        const { notebook } = await api.seed(this.conf);
        if (gen !== this.gen) return;
        this.g.store.update((s) => (s.talk.notebook = notebook));
      }
      await this.exchange({ event: 'start' }, gen);
    } catch (e) {
      return this.onError(e, gen);
    }
    if (gen !== this.gen) return;
    if (!(await mic)) return this.goOffline('mic');
    if (gen === this.gen) void this.loop(gen);
  }

  /** Слушать и отвечать, пока разговор идет. */
  private async loop(gen: number) {
    try {
      await this.rec.open();
    } catch {
      if (gen === this.gen) this.goOffline('mic');
      return;
    }
    while (gen === this.gen) {
      if (this.endDue) {
        this.endDue = false;
        try {
          await this.exchange({ event: 'end' }, gen);
        } catch (e) {
          this.onError(e, gen);
          if (gen === this.gen) this.goSleep('time');
        }
        return;
      }
      // пока катается или прыгает — не слушаем (его звуки попали бы в микрофон), но не дольше 12 с
      for (let waited = 0; this.actionRunning && waited < 12_000 && gen === this.gen; waited += 100) {
        await new Promise((res) => setTimeout(res, 100));
      }
      if (gen !== this.gen) return;
      this.phase = 'listening';
      const rec = await this.rec.listen(T.idleAfterMs);
      if (gen !== this.gen) return;
      if (!rec) {
        if (this.endDue) continue;
        // долго молчат: Пушок дремлет, микрофон выключен, минуты не идут
        this.flushTime();
        this.rec.close();
        this.phase = 'idle';
        return;
      }
      if (rec.seconds < 0.4) continue;
      try {
        // сама нажала «готово» — ответ будет в любом случае; поймано по громкости — шум без слов пропускается
        await this.exchange({ audio: toBase64(rec.pcm), quiet: !rec.manual }, gen);
      } catch (e) {
        this.onError(e, gen);
        // уснул или потерял связь — stop() уже сменил поколение, цикл закончится сам
      }
    }
  }

  /** Один обмен репликами: отправить звук и/или событие, озвучить ответ. */
  private async exchange(req: { audio?: string; event?: TalkEvent; quiet?: boolean }, gen: number) {
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
      place: this.place,
      quiet: !!req.quiet && !event,
      basket: s.basket,
      dishes: s.dishes.map((d) => d.dish),
    });
    if (gen !== this.gen) return;
    this.failures = 0;
    if (!r.reply) return; // шум без слов: молча слушаем дальше
    const now = Date.now();
    const turns: TalkTurn[] = [];
    if (event) turns.push({ at: now, role: 'event', text: EVENT_TEXT[event] });
    if (r.heard) turns.push({ at: now, role: 'kira', text: r.heard });
    turns.push({ at: now, role: 'pushok', text: r.reply, ...(r.tags ? { tags: r.tags } : {}) });
    this.g.store.update((d) => {
      d.talk.history.push(...turns);
      if (d.talk.history.length > 400) d.talk.history.splice(0, d.talk.history.length - 400);
    });
    if (r.heard) this.turnsSinceNotebook++;
    if (r.emotion || r.action) this.onCue?.({ emotion: r.emotion ?? null, action: r.action ?? null, cook: r.cook ?? null });
    if (gen !== this.gen) return;
    this.phase = 'speaking';
    await this.voice.play(r.audio);
    if (gen !== this.gen) return;
    if (event === 'end') {
      this.goSleep('time');
      void this.saveNotebook();
      return;
    }
    // записка для родителей или пора обновить тетрадку
    if (this.turnsSinceNotebook >= T.notebookEveryTurns || /запиш|для пап|для мам|секрет|список/i.test(r.heard)) void this.saveNotebook();
    // хвост собственного голоса не должен попасть в микрофон
    await new Promise((res) => setTimeout(res, 300));
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

  private onError(e: unknown, gen: number) {
    if (gen !== this.gen) return;
    const kind = e instanceof TalkError ? e.kind : 'network';
    if (kind === 'budget') return this.goSleep('budget');
    if (kind === 'auth' || kind === 'config') return this.goOffline(kind);
    this.failures++;
    this.g.sfx.play('nope');
    if (this.failures >= 2) return this.goOffline('network');
    if (this.phase === 'connecting' || this.phase === 'thinking') this.phase = 'idle';
  }

  private stop(phase: 'sleeping' | 'offline', why: Why) {
    this.gen++;
    this.flushTime();
    this.rec.close();
    this.on = false;
    this.phase = phase;
    this.why = why;
  }

  private goSleep(why: Why) {
    this.stop('sleeping', why);
  }

  private goOffline(why: Why) {
    this.stop('offline', why);
  }

  private flushTime() {
    if (this.unsavedMs <= 0) return;
    const ms = this.unsavedMs;
    this.unsavedMs = 0;
    this.g.store.update((s) => (s.talk.usedMs += ms));
  }

  /** Каждый кадр, в любой комнате: время разговора, зевок за 3 минуты, конец. */
  update(dt: number) {
    this.voice.tick();
    if (!this.on) return;
    if (this.phase !== 'listening' && this.phase !== 'thinking' && this.phase !== 'speaking') return;
    this.unsavedMs += dt;
    if (this.unsavedMs > 5000) this.flushTime();
    const left = this.leftMs;
    if (left <= T.warnMinutesLeft * 60_000 && !this.g.store.data.talk.warned) {
      this.g.store.update((s) => (s.talk.warned = true));
      this.pendingEvent = 'warn';
    }
    if (left <= 0 && !this.endDue) {
      this.endDue = true;
      if (this.phase === 'listening') this.rec.cancel();
    }
  }
}

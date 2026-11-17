import { Sfx } from '../audio/sfx';
import { CONFIG } from '../config';

// Микрофон для разговора «как в Claude»: открывается один раз (из касания) и слушает сам.
// Начало речи ловится по громкости: несколько громких кусков подряд. Последние полсекунды
// до этого тоже идут в запись, чтобы не съесть первый слог. После паузы silenceMs фраза
// отдается: моно, 16 кГц, 16 бит (LPCM) для SpeechKit. Пока Пушок говорит, звук не слушается.
//
// iPhone: звуковой движок записи создается прямо в касании (иначе iOS может не дать его
// запустить), а режим звука в разговоре — 'play-and-record': в 'playback' микрофон дает тишину.

export interface Recording {
  pcm: Uint8Array;
  seconds: number;
  hadSpeech: boolean;
  /** Отдано касанием (ребенок сам сказал «готово»), а не по паузе. */
  manual: boolean;
}

/** Сведения о последней фразе — для проверки микрофона в панели взрослых. */
export interface MicStats {
  at: number;
  session: string;
  rate: number;
  ctxState: string;
  frames: number;
  seconds: number;
  peak: number;
  noise: number;
  hadSpeech: boolean;
  manual: boolean;
  error?: string;
}

export let micStats: MicStats | null = null;

const T = CONFIG.talk;
/** Ниже этой громкости речи не бывает, даже если в комнате совсем тихо. */
const MIN_SPEECH_RMS = 0.015;
/** Столько громких кусков подряд (по ~85 мс) — это речь, а не стук. */
const START_FRAMES = 2;
/** Сколько звука до начала речи взять в запись, мс. */
const PREROLL_MS = 600;
/** Фраза короче (по громким кускам) — это не речь: слушаем дальше. */
const MIN_VOICED_MS = 350;

type Mode = 'off' | 'waiting' | 'speech';

export class Recorder {
  /** Громкость 0..1 для анимации. */
  level = 0;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private opening: Promise<void> | null = null;
  private mode: Mode = 'off';
  private resolve: ((r: Recording | null) => void) | null = null;
  private waitStartedAt = 0;
  private maxWaitMs = 0;
  /** Звук, пока ждем речь (последние ~10 с) — на случай, если ребенок нажмет «готово» сам. */
  private waiting: Float32Array[] = [];
  private chunks: Float32Array[] = [];
  private loud = 0;
  private voicedMs = 0;
  private speechAt = 0;
  private lastVoiceAt = 0;
  private noise = 0.008;
  private peak = 0;
  private frames = 0;

  get isOpen() {
    return this.node !== null;
  }

  /** Речь идет прямо сейчас (для анимации «слышу»). */
  get hearing() {
    return this.mode === 'speech';
  }

  get listening() {
    return this.mode !== 'off';
  }

  /** Создать и разбудить звуковой движок записи. Вызывать из касания (iOS), даже если микрофон откроется позже. */
  prepare(): AudioContext | null {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Открыть микрофон. Лучше из касания: тогда iOS разрешит звуковой движок. */
  open(): Promise<void> {
    if (this.node) return Promise.resolve();
    if (this.opening) return this.opening;
    const ctx = this.prepare();
    if (!ctx || !navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('NoMic'));
    this.opening = (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        this.ctx = null;
        void ctx.close().catch(() => {});
        micStats = { ...this.stats(ctx, false), error: (e as Error).name || 'ошибка' };
        throw e;
      } finally {
        this.opening = null;
      }
      if (this.ctx !== ctx) {
        // пока ждали разрешения, из разговора ушли
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
        return;
      }
      // движок еще спит — будим еще раз, но не ждем дольше секунды
      if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
      const src = ctx.createMediaStreamSource(this.stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0), ctx.sampleRate);
      src.connect(node);
      node.connect(ctx.destination); // без этого Safari не вызывает onaudioprocess
      this.node = node;
      // сроки проверяем и по таймеру: если звук не идет совсем, ожидание все равно закончится
      this.timer = setInterval(() => this.checkEnd(performance.now()), 250);
    })();
    return this.opening;
  }

  /** Закрыть микрофон (ушли из разговора). Ожидание фразы заканчивается с null. */
  close() {
    this.cancel();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.level = 0;
  }

  /**
   * Ждать фразу. Промис отдает запись, когда ребенок договорил, или null,
   * если долго молчали (maxWaitMs) или ожидание отменили.
   */
  listen(maxWaitMs: number): Promise<Recording | null> {
    this.cancel();
    this.mode = 'waiting';
    this.waitStartedAt = performance.now();
    this.maxWaitMs = maxWaitMs;
    this.waiting = [];
    this.chunks = [];
    this.loud = 0;
    this.voicedMs = 0;
    this.peak = 0;
    this.frames = 0;
    return new Promise((r) => (this.resolve = r));
  }

  /** Перестать слушать без записи (Пушок заговорил, ушли из комнаты). */
  cancel() {
    const r = this.resolve;
    this.resolve = null;
    this.mode = 'off';
    this.level = 0;
    r?.(null);
  }

  /** Касание «я договорила»: отдать то, что слышно сейчас, даже если громкость не дотянула до речи. */
  finish() {
    if (!this.resolve) return;
    if (this.mode === 'waiting') this.chunks = this.waiting;
    this.done(true);
  }

  private onAudio(data: Float32Array, rate: number) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    if (this.mode === 'off') {
      this.level = 0;
      return;
    }
    const frameMs = (data.length / rate) * 1000;
    const copy = new Float32Array(data);
    this.frames++;
    this.peak = Math.max(this.peak, rms);
    this.level = Math.min(1, rms * 8);
    const now = performance.now();
    const loud = rms > Math.max(MIN_SPEECH_RMS, this.noise * 3);
    if (this.mode === 'waiting') {
      this.waiting.push(copy);
      const keep = Math.ceil(10_000 / frameMs);
      if (this.waiting.length > keep) this.waiting.splice(0, this.waiting.length - keep);
      if (loud) {
        this.loud++;
        if (this.loud >= START_FRAMES) {
          // началась речь: берем и то, что было чуть раньше
          const pre = Math.ceil(PREROLL_MS / frameMs) + START_FRAMES;
          this.chunks = this.waiting.slice(-pre);
          this.mode = 'speech';
          this.speechAt = now;
          this.lastVoiceAt = now;
          this.voicedMs = this.loud * frameMs;
        }
      } else {
        this.loud = 0;
        // шум комнаты: быстро вниз, медленно вверх
        this.noise = rms < this.noise ? (this.noise + rms) / 2 : this.noise * 0.98 + rms * 0.02;
      }
    } else {
      this.chunks.push(copy);
      if (loud) {
        this.voicedMs += frameMs;
        this.lastVoiceAt = now;
      }
    }
    this.checkEnd(now);
  }

  private checkEnd(now: number) {
    if (!this.resolve) return;
    if (this.mode === 'waiting') {
      if (this.maxWaitMs && now - this.waitStartedAt > this.maxWaitMs) {
        micStats = this.stats(this.ctx, false);
        this.cancel();
      }
      return;
    }
    if (this.mode !== 'speech') return;
    if (now - this.lastVoiceAt > T.silenceMs || now - this.speechAt > T.maxRecordMs) {
      if (this.voicedMs < MIN_VOICED_MS) {
        // это был стук или вскрик, а не фраза: слушаем дальше
        this.mode = 'waiting';
        this.loud = 0;
        this.chunks = [];
        return;
      }
      this.done(false);
    }
  }

  private done(manual: boolean) {
    const resolve = this.resolve;
    if (!resolve) return;
    const hadSpeech = this.mode === 'speech';
    this.resolve = null;
    this.mode = 'off';
    this.level = 0;
    const rate = this.ctx?.sampleRate ?? 48000;
    micStats = this.stats(this.ctx, manual, hadSpeech);
    const pcm = toPcm16k(this.chunks, rate);
    this.chunks = [];
    this.waiting = [];
    resolve({ pcm, seconds: pcm.length / 32000, hadSpeech, manual });
  }

  private stats(ctx: AudioContext | null, manual: boolean, hadSpeech = false): MicStats {
    return {
      at: Date.now(),
      session: Sfx.sessionType(),
      rate: ctx?.sampleRate ?? 0,
      ctxState: ctx?.state ?? 'нет',
      frames: this.frames,
      seconds: this.chunks.reduce((s, c) => s + c.length, 0) / (ctx?.sampleRate || 48000),
      peak: this.peak,
      noise: this.noise,
      hadSpeech,
      manual,
    };
  }
}

/** Склеить куски и пересчитать в 16 кГц 16 бит (усреднением). */
export function toPcm16k(chunks: Float32Array[], rate: number): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const ratio = rate / 16000;
  const outLen = Math.floor(total / ratio);
  const out = new Int16Array(outLen);
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(total, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

import { Sfx } from '../audio/sfx';
import { CONFIG } from '../config';

// Запись голоса для SpeechKit: моно, 16 кГц, 16 бит (LPCM).
// Запись заканчивается сама, когда ребенок замолчал (после речи пауза silenceMs),
// по таймеру maxRecordMs или если речи не было noSpeechMs.
//
// iPhone: звуковой движок записи создается прямо в касании (после ожидания доступа
// к микрофону iOS может не дать его запустить), а режим звука в комнате разговора
// должен быть 'play-and-record' — в режиме 'playback' микрофон дает тишину.

export interface Recording {
  pcm: Uint8Array;
  seconds: number;
  hadSpeech: boolean;
  /** Остановлено повторным тапом (ребенок сам решил, что договорил). */
  manual: boolean;
}

/** Сведения о последней записи — для проверки микрофона в панели взрослых. */
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
const NOISE_MS = 500;
const MIN_SPEECH_RMS = 0.015;

export class Recorder {
  /** Громкость 0..1 для анимации кнопки. */
  level = 0;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chunks: Float32Array[] = [];
  private resolve: ((r: Recording) => void) | null = null;
  private starting = false;
  private stopRequested = false;
  private startedAt = 0;
  private lastVoiceAt = 0;
  private speech = false;
  private noise = Infinity;
  private peak = 0;
  private frames = 0;

  get active() {
    return this.resolve !== null || this.starting;
  }

  /** Начать запись. Вызывать из касания. Промис завершается, когда запись закончится (сама или через stop()). */
  async start(): Promise<Recording> {
    // движок создаем и будим до первого await, пока идет касание
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    void ctx.resume().catch(() => {});
    this.starting = true;
    this.stopRequested = false;
    this.speech = false;
    this.noise = Infinity;
    this.peak = 0;
    this.frames = 0;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      this.starting = false;
      this.ctx = null;
      void ctx.close().catch(() => {});
      micStats = { ...this.stats(ctx, false), error: (e as Error).name || 'ошибка' };
      throw e;
    }
    // если движок все еще спит — еще раз будим, но не ждем дольше секунды
    if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    const src = ctx.createMediaStreamSource(this.stream);
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.startedAt = performance.now();
    this.lastVoiceAt = this.startedAt;
    this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
    src.connect(this.node);
    this.node.connect(ctx.destination); // без этого Safari не вызывает onaudioprocess
    // сроки проверяем и по таймеру: если звук не идет совсем, запись все равно закончится
    this.timer = setInterval(() => this.checkEnd(performance.now()), 250);
    const done = new Promise<Recording>((r) => (this.resolve = r));
    this.starting = false;
    if (this.stopRequested) this.stop(true);
    return done;
  }

  private onAudio(data: Float32Array) {
    this.chunks.push(new Float32Array(data));
    this.frames++;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    this.peak = Math.max(this.peak, rms);
    this.level = Math.min(1, rms * 8);
    const now = performance.now();
    // фоновый шум — самый тихий кусок первых полсекунды (ребенок мог заговорить сразу)
    if (now - this.startedAt < NOISE_MS) {
      this.noise = Math.min(this.noise, rms);
    } else {
      if (!Number.isFinite(this.noise)) this.noise = 0.005;
      if (rms > Math.max(MIN_SPEECH_RMS, this.noise * 3)) {
        this.speech = true;
        this.lastVoiceAt = now;
      } else {
        this.noise = this.noise * 0.95 + rms * 0.05; // шум комнаты меняется — подстраиваемся
      }
    }
    this.checkEnd(now);
  }

  private checkEnd(now: number) {
    if (!this.resolve) return;
    const elapsed = now - this.startedAt;
    if (
      (this.speech && now - this.lastVoiceAt > T.silenceMs) ||
      elapsed > T.maxRecordMs ||
      (!this.speech && elapsed > T.noSpeechMs)
    ) {
      this.stop(false);
    }
  }

  private stats(ctx: AudioContext | null, manual: boolean): MicStats {
    return {
      at: Date.now(),
      session: Sfx.sessionType(),
      rate: ctx?.sampleRate ?? 0,
      ctxState: ctx?.state ?? 'нет',
      frames: this.frames,
      seconds: this.frames ? (performance.now() - this.startedAt) / 1000 : 0,
      peak: this.peak,
      noise: Number.isFinite(this.noise) ? this.noise : 0,
      hadSpeech: this.speech,
      manual,
    };
  }

  /** Закончить запись сейчас (повторный тап по кнопке). */
  stop(manual = true) {
    if (this.starting) {
      this.stopRequested = true; // доступ к микрофону еще не дали — остановим сразу после
      return;
    }
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    const rate = ctx?.sampleRate ?? 48000;
    micStats = this.stats(ctx, manual);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.level = 0;
    const pcm = toPcm16k(this.chunks, rate);
    this.chunks = [];
    resolve({ pcm, seconds: pcm.length / 32000, hadSpeech: this.speech, manual });
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

import { CONFIG } from '../config';

// Запись голоса для SpeechKit: моно, 16 кГц, 16 бит (LPCM).
// Запись заканчивается сама, когда ребенок замолчал (после речи пауза silenceMs),
// по таймеру maxRecordMs или если речи не было noSpeechMs.

export interface Recording {
  pcm: Uint8Array;
  seconds: number;
  hadSpeech: boolean;
  /** Остановлено повторным тапом (ребенок сам решил, что договорил). */
  manual: boolean;
}

const T = CONFIG.talk;

export class Recorder {
  /** Громкость 0..1 для анимации кнопки. */
  level = 0;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private resolve: ((r: Recording) => void) | null = null;
  private startedAt = 0;
  private lastVoiceAt = 0;
  private speech = false;
  private noise = 0.01;

  get active() {
    return this.resolve !== null;
  }

  /** Начать запись. Промис завершается, когда запись закончится (сама или через stop()). */
  async start(): Promise<Recording> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.speech = false;
    this.noise = 0.01;
    this.startedAt = performance.now();
    this.lastVoiceAt = this.startedAt;
    this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
    src.connect(this.node);
    this.node.connect(this.ctx.destination); // без этого Safari не вызывает onaudioprocess
    return new Promise((r) => (this.resolve = r));
  }

  private onAudio(data: Float32Array) {
    this.chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    this.level = Math.min(1, rms * 8);
    const now = performance.now();
    // первые полсекунды меряем фоновый шум, дальше речь = заметно громче шума
    if (now - this.startedAt < 500) this.noise = Math.max(this.noise, rms);
    else if (rms > Math.max(0.02, this.noise * 2.5)) {
      this.speech = true;
      this.lastVoiceAt = now;
    }
    const elapsed = now - this.startedAt;
    if (
      (this.speech && now - this.lastVoiceAt > T.silenceMs) ||
      elapsed > T.maxRecordMs ||
      (!this.speech && elapsed > T.noSpeechMs)
    ) {
      this.stop(false);
    }
  }

  /** Закончить запись сейчас (повторный тап по кнопке). */
  stop(manual = true) {
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    const rate = this.ctx?.sampleRate ?? 48000;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
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

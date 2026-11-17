import { CONFIG } from '../config';

// Голос Пушка: WAV-куски от сервера проигрываются по очереди, чуть быстрее и выше
// (тонкий голосок хомячка). level — громкость для движения рта.

export class VoicePlayer {
  level = 0;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private current: AudioBufferSourceNode | null = null;
  private stopped = false;
  private buf = new Uint8Array(256);

  get playing() {
    return this.current !== null;
  }

  /** Звуковой движок браузера или null, если его нет (тогда Пушок «говорит» молча). */
  private context(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Вызывать из касания: на iOS звук можно запустить только из жеста. */
  unlock() {
    const ctx = this.context();
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  /** Проиграть куски по очереди. Промис завершается, когда голос закончился или его остановили. */
  async play(segments: string[]): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    this.stopped = false;
    for (const b64 of segments) {
      if (this.stopped) break;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      let audio: AudioBuffer;
      try {
        audio = await ctx.decodeAudioData(bytes.buffer.slice(0));
      } catch {
        continue; // испорченный кусок пропускаем
      }
      await new Promise<void>((done) => {
        const src = ctx.createBufferSource();
        src.buffer = audio;
        src.playbackRate.value = CONFIG.talk.voiceRate;
        src.connect(this.analyser!);
        src.onended = () => done();
        this.current = src;
        src.start();
      });
    }
    this.current = null;
    this.level = 0;
  }

  stop() {
    this.stopped = true;
    try {
      this.current?.stop();
    } catch {
      /* уже остановлен */
    }
  }

  /** Обновить уровень громкости (вызывать каждый кадр). */
  tick() {
    if (!this.analyser || !this.current) {
      this.level = 0;
      return;
    }
    this.analyser.getByteTimeDomainData(this.buf);
    let peak = 0;
    for (const v of this.buf) peak = Math.max(peak, Math.abs(v - 128));
    this.level = Math.min(1, peak / 64);
  }
}

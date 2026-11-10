// Короткие мягкие звуки, синтезированные Web Audio. Файлов и сети не нужно.
// На iOS звук можно включить только из обработчика касания: см. unlock().

export type SoundId =
  | 'tap'
  | 'hop'
  | 'boing'
  | 'splash'
  | 'whee'
  | 'climb'
  | 'chew'
  | 'lullaby'
  | 'rope'
  | 'sniff'
  | 'wiggle'
  | 'joy'
  | 'hold';

type Ctx = AudioContext;

export class Sfx {
  enabled = true;
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Вызывать из pointerdown: создает и будит AudioContext. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** При сворачивании приложения звук усыпляем, чтобы не тратить батарею. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  play(id: SoundId) {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    switch (id) {
      case 'tap':
        this.tone(660, t, 0.08, 'sine', 0.5, 880);
        break;
      case 'hop':
        this.tone(420, t, 0.06, 'sine', 0.18, 560);
        break;
      case 'boing':
        this.tone(220, t, 0.28, 'sine', 0.6, 520);
        break;
      case 'splash':
        this.hiss(t, 0.35, 1800, 0.5);
        this.tone(520, t + 0.05, 0.1, 'sine', 0.25, 760);
        break;
      case 'whee':
        this.tone(400, t, 0.6, 'triangle', 0.4, 1000);
        break;
      case 'climb':
        [523, 587, 659].forEach((f, i) => this.tone(f, t + i * 0.12, 0.08, 'triangle', 0.35));
        break;
      case 'chew':
        this.hiss(t, 0.06, 900, 0.35);
        break;
      case 'lullaby':
        [392, 330, 349, 294].forEach((f, i) => this.tone(f, t + i * 0.42, 0.38, 'sine', 0.3));
        break;
      case 'rope':
        this.hiss(t, 0.12, 2600, 0.25);
        break;
      case 'sniff':
        this.hiss(t, 0.05, 3000, 0.25);
        this.hiss(t + 0.12, 0.05, 3000, 0.25);
        break;
      case 'wiggle':
        this.tone(500, t, 0.07, 'sine', 0.35, 450);
        this.tone(500, t + 0.09, 0.07, 'sine', 0.35, 450);
        break;
      case 'joy':
        [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.08, 0.12, 'sine', 0.4));
        break;
      case 'hold':
        this.tone(330, t, 0.05, 'sine', 0.15);
        break;
    }
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(t: number, dur: number, freq: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

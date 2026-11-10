import type { Sfx } from './audio/sfx';
import { hitTest, type Target } from './engine/input';
import { computeLayout, cssToScene, sceneToCss, type Insets, type Layout } from './engine/layout';
import { Renderer } from './engine/renderer';
import { Pushok } from './pushok/actor';
import type { PersistState, Store } from './save/store';
import { HomeScene } from './scenes/home';
import { drawRotate } from './scenes/rotate';
import { createAdultPanel, type AdultPanel } from './ui/adult';

interface Hold {
  pointerId: number;
  target: Target;
  start: number;
}

export class App {
  layout!: Layout;
  persist: PersistState = 'unsupported';
  home: HomeScene;
  private renderer: Renderer;
  private adult: AdultPanel;
  private hold: Hold | null = null;
  private last = 0;
  private time = 0;
  private rotatePushok = new Pushok();
  frames = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private probe: HTMLElement,
    private store: Store,
    private sfx: Sfx,
    version: string,
  ) {
    this.renderer = new Renderer(canvas.getContext('2d', { alpha: false })!);
    this.adult = createAdultPanel({
      store,
      sfx,
      version,
      persist: () => this.persist,
      onReset: () => (this.home = this.makeHome()),
    });
    this.home = this.makeHome();
    this.resize();
    addEventListener('resize', () => this.resize());
    screen.orientation?.addEventListener?.('change', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    for (const ev of ['pointerup', 'pointercancel'] as const) addEventListener(ev, (e) => this.up(e));
    requestAnimationFrame((t) => this.frame(t));
  }

  private makeHome() {
    return new HomeScene(this.store, this.sfx, () => this.adult.open());
  }

  private insets(): Insets {
    const s = getComputedStyle(this.probe);
    const n = (v: string) => parseFloat(v) || 0;
    return { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) };
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.layout = computeLayout(w, h, devicePixelRatio || 1, this.insets());
    if (this.canvas.width !== this.layout.devW || this.canvas.height !== this.layout.devH) {
      this.canvas.width = this.layout.devW;
      this.canvas.height = this.layout.devH;
    }
  }

  private targets(): Target[] {
    return this.home.targets(this.layout.safe);
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.sfx.unlock();
    if (this.adult.isOpen || this.layout.portrait) return;
    const p = cssToScene(this.layout, e.clientX, e.clientY);
    const t = hitTest(this.targets(), p.x, p.y, this.layout.minTarget);
    if (!t) return;
    if (t.hold) {
      if (!this.hold) this.hold = { pointerId: e.pointerId, target: t, start: performance.now() };
    } else t.onTap?.();
  }

  private up(e: PointerEvent) {
    if (this.hold && this.hold.pointerId === e.pointerId) {
      this.hold.target.hold!.onProgress(0);
      this.hold = null;
    }
  }

  private frame(ts: number) {
    const dt = Math.min(50, this.last ? ts - this.last : 16);
    this.last = ts;
    this.time += dt;
    this.frames++;

    if (this.hold) {
      const h = this.hold.target.hold!;
      const p = (performance.now() - this.hold.start) / h.ms;
      if (p >= 1) {
        this.hold = null;
        h.onComplete();
      } else h.onProgress(p);
    }

    const r = this.renderer;
    r.begin(this.layout);
    if (this.layout.portrait) {
      this.rotatePushok.update(dt);
      drawRotate(r, this.rotatePushok, this.time);
    } else {
      this.home.update(dt);
      this.home.draw(r);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Для e2e-тестов: центр цели в CSS px. */
  targetCss(id: string) {
    const t = this.targets().find((x) => x.id === id);
    if (!t) return null;
    return sceneToCss(this.layout, t.x + t.w / 2, t.y + t.h / 2);
  }

  /** Для e2e-тестов: размеры целей касания в CSS px после расширения. */
  targetSizesCss() {
    const k = this.layout.scale / this.layout.dpr;
    return this.targets().map((t) => ({
      id: t.id,
      w: Math.max(t.w, this.layout.minTarget) * k,
      h: Math.max(t.h, this.layout.minTarget) * k,
    }));
  }
}

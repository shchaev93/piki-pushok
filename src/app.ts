import type { Sfx } from './audio/sfx';
import { hitTest, type Target } from './engine/input';
import { computeLayout, cssToScene, sceneToCss, type Insets, type Layout } from './engine/layout';
import { Renderer } from './engine/renderer';
import { Pushok } from './pushok/actor';
import type { PersistState, Store } from './save/store';
import { CloudScene } from './scenes/cloud';
import { FeedScene } from './scenes/feed';
import { ShopScene } from './scenes/shop';
import { HomeScene } from './scenes/home';
import { drawRotate } from './scenes/rotate';
import type { Game, Scene, SceneId } from './scenes/scene';
import { createAdultPanel, type AdultPanel } from './ui/adult';

interface Hold {
  pointerId: number;
  target: Target;
  start: number;
}

const FADE_MS = 220;

export class App {
  layout!: Layout;
  persist: PersistState = 'unsupported';
  scene: Scene;
  readonly game: Game;
  private renderer: Renderer;
  private adult: AdultPanel;
  private hold: Hold | null = null;
  /** Пальцы, которые сцена взяла себе (перетаскивание). */
  private dragging = new Set<number>();
  private last = 0;
  private time = 0;
  private fade = 0;
  private rotatePushok = new Pushok();
  frames = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private probe: HTMLElement,
    store: Store,
    private sfx: Sfx,
    version: string,
  ) {
    this.renderer = new Renderer(canvas.getContext('2d', { alpha: false })!);
    this.game = {
      store,
      sfx,
      go: (id) => this.go(id),
      openAdult: () => this.adult.open(),
      now: () => Date.now(),
      minTarget: () => this.layout.minTarget,
    };
    this.adult = createAdultPanel({
      store,
      sfx,
      version,
      persist: () => this.persist,
      onReset: () => this.go('home'),
    });
    this.scene = this.make('home');
    this.resize();
    addEventListener('resize', () => this.resize());
    screen.orientation?.addEventListener?.('change', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel'] as const) addEventListener(ev, (e) => this.up(e));
    requestAnimationFrame((t) => this.frame(t));
  }

  private make(id: SceneId): Scene {
    switch (id) {
      case 'cloud':
        return new CloudScene(this.game);
      case 'shop':
        return new ShopScene(this.game);
      case 'feed':
        return new FeedScene(this.game);
      default:
        return new HomeScene(this.game);
    }
  }

  go(id: SceneId) {
    this.hold = null;
    this.dragging.clear();
    this.scene = this.make(id);
    this.fade = FADE_MS;
  }

  private insets(): Insets {
    const s = getComputedStyle(this.probe);
    const n = (v: string) => parseFloat(v) || 0;
    return { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) };
  }

  resize() {
    this.layout = computeLayout(innerWidth, innerHeight, devicePixelRatio || 1, this.insets());
    if (this.canvas.width !== this.layout.devW || this.canvas.height !== this.layout.devH) {
      this.canvas.width = this.layout.devW;
      this.canvas.height = this.layout.devH;
    }
  }

  private targets(): Target[] {
    return this.scene.targets(this.layout.safe);
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.sfx.unlock();
    if (this.adult.isOpen || this.layout.portrait) return;
    const p = cssToScene(this.layout, e.clientX, e.clientY);
    const t = hitTest(this.targets(), p.x, p.y, this.layout.minTarget);
    if (t) {
      if (t.hold) {
        if (!this.hold) this.hold = { pointerId: e.pointerId, target: t, start: performance.now() };
      } else t.onTap?.();
      return;
    }
    if (this.scene.pointerDown?.(p.x, p.y, e.pointerId)) this.dragging.add(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (!this.dragging.has(e.pointerId)) return;
    const p = cssToScene(this.layout, e.clientX, e.clientY);
    this.scene.pointerMove?.(p.x, p.y, e.pointerId);
  }

  private up(e: PointerEvent) {
    if (this.hold && this.hold.pointerId === e.pointerId) {
      this.hold.target.hold!.onProgress(0);
      this.hold = null;
    }
    if (this.dragging.delete(e.pointerId)) {
      const p = cssToScene(this.layout, e.clientX, e.clientY);
      this.scene.pointerUp?.(p.x, p.y, e.pointerId);
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
      this.scene.update(dt);
      this.scene.draw(r);
      if (this.fade > 0) {
        this.fade -= dt;
        const c = r.ctx;
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = Math.max(0, this.fade / FADE_MS);
        c.fillStyle = '#FFF4E2';
        c.fillRect(0, 0, this.layout.devW, this.layout.devH);
        c.restore();
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Для e2e-тестов: центр цели в CSS px. */
  targetCss(id: string) {
    const t = this.targets().find((x) => x.id === id);
    if (!t) return null;
    return sceneToCss(this.layout, t.x + t.w / 2, t.y + t.h / 2);
  }

  /** Для e2e-тестов: логическая точка сцены → CSS px. */
  toCss(x: number, y: number) {
    return sceneToCss(this.layout, x, y);
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

  /** Совместимость с тестами этапа 1. */
  get home() {
    return this.scene as HomeScene;
  }
}

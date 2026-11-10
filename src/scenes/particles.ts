import type { Renderer } from '../engine/renderer';
import { SMALL_SPRITES, type SmallSpriteId } from '../sprites/home-objects';

interface Particle {
  sprite: SmallSpriteId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Искорки, сердечки, пузырьки: летят и мягко мерцают перед исчезновением. */
export class Particles {
  private list: Particle[] = [];

  spawn(sprite: SmallSpriteId, x: number, y: number, vx: number, vy: number, life: number) {
    this.list.push({ sprite, x, y, vx, vy, life });
  }

  /** Россыпь искорок во все стороны. */
  burst(x: number, y: number, n = 6, sprite: SmallSpriteId = 'sparkle') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const v = 14 + Math.random() * 10;
      this.spawn(sprite, x, y, Math.cos(a) * v, Math.sin(a) * v, 500 + Math.random() * 300);
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(r: Renderer) {
    for (const q of this.list) {
      if (q.life < 200 && Math.floor(q.life / 50) % 2) continue;
      r.sprite(`small.${q.sprite}`, SMALL_SPRITES[q.sprite], q.x, q.y);
    }
  }
}

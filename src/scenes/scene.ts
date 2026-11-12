import type { Sfx } from '../audio/sfx';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import type { Store } from '../save/store';

export type SceneId = 'home' | 'cloud' | 'shop' | 'feed' | 'wardrobe' | 'kitchen' | 'music';

/** Что сцены получают от приложения. */
export interface Game {
  store: Store;
  sfx: Sfx;
  go(id: SceneId): void;
  openAdult(): void;
  now(): number;
  /** Минимальная цель касания в логических px (для своих хит-тестов при перетаскивании). */
  minTarget(): number;
}

export interface Scene {
  readonly id: SceneId;
  update(dt: number): void;
  draw(r: Renderer): void;
  /** Кнопки и предметы, на которые нажимают. */
  targets(safe: Rect): Target[];
  /**
   * Перетаскивание: вызывается, если касание не попало ни в одну цель.
   * Вернуть true, если сцена взяла жест себе.
   */
  pointerDown?(x: number, y: number, id: number): boolean;
  pointerMove?(x: number, y: number, id: number): void;
  pointerUp?(x: number, y: number, id: number): void;
}

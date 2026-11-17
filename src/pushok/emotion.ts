import type { SmallSpriteId } from '../sprites/home-objects';
import type { Emotion } from '../talk/api';
import { during, tween, type Pushok, type Script } from './actor';

// Эмоции Пушка в разговоре: полторы секунды движения и значки над головой, потом
// он снова обычный. Звуков нет — в это время звучит его голос.
// k — во сколько раз Пушок нарисован крупнее обычного (в комнате разговора — втрое):
// от этого зависит, где у него голова. Подскоки (lift) — в пикселях самого Пушка.

export type Spawn = (sprite: SmallSpriteId, x: number, y: number, vx: number, vy: number, life: number) => void;

export function* emotionScript(p: Pushok, e: Emotion, spawn: Spawn, k = 1): Script {
  const top = () => p.y - 18 * k;
  switch (e) {
    case 'joy': {
      for (let i = 0; i < 4; i++) spawn('sparkle', p.x + (i - 1.5) * 7 * k, top(), (i - 1.5) * 8, -14, 900);
      yield* p.joy(2, 4);
      break;
    }
    case 'laugh': {
      let n = 0;
      yield* during(1500, (t) => {
        const odd = Math.floor(t / 110) % 2;
        p.frame = odd ? 'happy1' : 'happy2';
        p.lift = odd ? -1 : 0;
        if (t >= n) {
          n += 500;
          spawn('ha', p.x + (n % 1000 ? 6 : -14) * k, top(), n % 1000 ? 6 : -6, -12, 900);
        }
      });
      break;
    }
    case 'surprise': {
      spawn('bang', p.x + 7 * k, top() - 2 * k, 0, -5, 1300);
      yield* tween(260, (t) => {
        p.frame = 'hopStretch';
        p.lift = -Math.sin(Math.PI * t) * 3;
      });
      yield* during(900, () => (p.frame = 'hopStretch'));
      break;
    }
    case 'sad': {
      spawn('tear', p.x + 4 * k, p.y - 10 * k, 0, 7, 1100);
      yield* during(1600, () => (p.frame = 'sad'));
      break;
    }
    case 'think': {
      let n = 0;
      yield* during(1600, (t) => {
        p.frame = 'meditate';
        if (t >= n) {
          n += 400;
          spawn('bubble', p.x + 8 * k + (n / 400) * 2 * k, top() - (n / 400) * 2 * k, 2, -8, 700);
        }
      });
      break;
    }
    case 'love': {
      for (let i = 0; i < 3; i++) spawn('heart', p.x + (i - 1) * 8 * k, top() + (i % 2) * 3 * k, (i - 1) * 6, -12, 1200);
      yield* during(1400, (t) => (p.frame = Math.floor(t / 350) % 2 ? 'happy1' : 'blink'));
      break;
    }
    case 'sleepy': {
      spawn('z', p.x + 6 * k, top(), 5, -8, 1300);
      yield* during(1500, (t) => {
        p.frame = t < 1000 ? 'meditate' : 'blink';
        p.lift = t < 1000 ? Math.round(Math.sin(t / 250)) * 0.5 : 0;
      });
      break;
    }
  }
}

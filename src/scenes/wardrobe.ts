import { CONFIG } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { Pushok, during, type Script } from '../pushok/actor';
import { silhouette, type SpriteDef } from '../sprites/grid';
import { HATS, isHatId } from '../sprites/hats';
import { SMALL_SPRITES } from '../sprites/home-objects';
import { butterfly, GUITARS, ITEM_ICONS } from '../sprites/items';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { BTN, drawHomeButton, drawSlot, homeButton } from './ui';

// Гардероб: 6 шляпок и 3 гитары, надеты одна шляпка и одна гитара.
// Вещи открываются по общему числу пойманных бабочек. Закрытая вещь = силуэт
// с бабочкой и полоской «сколько еще осталось». Тап по Пушку с гитарой = мелодия.

const S = 3;
const SIL = '#D9C7CF';

interface Item {
  kind: 'hat' | 'guitar';
  id: string;
  unlockAt: number;
  def: SpriteDef;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class WardrobeScene implements Scene {
  readonly id = 'wardrobe' as const;
  private pushok = new Pushok();
  private particles = new Particles();
  private wiggle = new Map<string, number>();
  private fresh: Set<string>;
  private think = 0;
  private time = 0;

  constructor(private g: Game) {
    const s = g.store.data;
    this.fresh = new Set([
      ...s.unlocked.hats.map((id) => `hat:${id}`),
      ...s.unlocked.guitars.map((id) => `guitar:${id}`),
    ].filter((k) => !s.seen.includes(k)));
    // увидел обновки: искорка на кнопке гардероба дома больше не горит
    if (this.fresh.size) g.store.update((d) => d.seen.push(...this.fresh));
    this.dress();
    this.pushok.x = 96;
    this.pushok.y = 98;
  }

  private dress() {
    const s = this.g.store.data;
    this.pushok.hat = isHatId(s.equipped.hat) ? s.equipped.hat : null;
    this.pushok.guitar = s.equipped.guitar && GUITARS[s.equipped.guitar] ? s.equipped.guitar : null;
  }

  private items(): Item[] {
    const out: Item[] = [];
    CONFIG.hats.forEach((h, i) => {
      const def = HATS[h.id as keyof typeof HATS];
      if (!def) return;
      out.push({ kind: 'hat', id: h.id, unlockAt: h.unlockAt, def, x: 6 + (i % 2) * 29, y: 29 + Math.floor(i / 2) * 25, w: 26, h: 22 });
    });
    CONFIG.guitars.forEach((gt, i) => {
      out.push({ kind: 'guitar', id: gt.id, unlockAt: gt.unlockAt, def: GUITARS[gt.id], x: 150, y: 29 + i * 25, w: 38, h: 22 });
    });
    return out;
  }

  private isOpen(it: Item) {
    const u = this.g.store.data.unlocked;
    return (it.kind === 'hat' ? u.hats : u.guitars).includes(it.id);
  }

  private isOn(it: Item) {
    const e = this.g.store.data.equipped;
    return (it.kind === 'hat' ? e.hat : e.guitar) === it.id;
  }

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    for (const it of this.items()) {
      list.push({ id: `${it.kind}:${it.id}`, x: it.x, y: it.y, w: it.w, h: it.h, onTap: () => this.tapItem(it) });
    }
    list.push({ id: 'pushok', x: 96 - 8 * S, y: 98 - 16 * S, w: 17 * S, h: 16 * S, onTap: () => this.tapPushok() });
    return list;
  }

  private tapItem(it: Item) {
    if (!this.isOpen(it)) {
      // еще закрыто: вещь покачивается, Пушок думает о бабочках
      this.g.sfx.play('nope');
      this.wiggle.set(`${it.kind}:${it.id}`, 500);
      this.think = 1800;
      return;
    }
    const on = this.isOn(it);
    this.g.store.update((s) => {
      if (it.kind === 'hat') s.equipped.hat = on ? null : it.id;
      else s.equipped.guitar = on ? null : it.id;
    });
    this.dress();
    this.g.sfx.play(on ? 'pop' : 'joy');
    if (!on) this.particles.burst(96, it.kind === 'hat' ? 46 : 80, 7);
    this.pushok.run(null, this.pushok.joy(1, 3));
  }

  private tapPushok() {
    if (this.pushok.busy) return;
    if (this.pushok.guitar) {
      this.g.sfx.melody(this.pushok.guitar);
      this.pushok.run('music', this.play());
    } else {
      this.g.sfx.play('joy');
      this.pushok.run(null, this.pushok.joy(2, 3));
    }
  }

  private *play(): Script {
    const p = this.pushok;
    let n = 0;
    yield* during(1400, (t) => {
      p.frame = Math.floor(t / 170) % 2 ? 'happy2' : 'happy1';
      p.lift = -Math.abs(Math.sin(t / 170)) * 1;
      if (t > n) {
        n += 300;
        this.particles.spawn('note', 112 + Math.random() * 14, 52, 6 + Math.random() * 8, -16, 1100);
      }
    });
  }

  update(dt: number) {
    this.time += dt;
    this.pushok.update(dt);
    this.particles.update(dt);
    for (const [k, v] of this.wiggle) {
      if (v - dt <= 0) this.wiggle.delete(k);
      else this.wiggle.set(k, v - dt);
    }
    if (this.think > 0) this.think -= dt;
  }

  draw(r: Renderer) {
    const v = r.layout.view;
    const safe = r.layout.safe;
    const x0 = Math.floor(v.x0) - 1;
    const w = Math.ceil(v.x1 - v.x0) + 2;
    const y0 = Math.floor(v.y0) - 1;
    const yEnd = Math.ceil(v.y1) + 1;
    // внутри шкафа: доски и вешалка
    r.rect(x0, y0, w, yEnd - y0, '#F6E2C6');
    for (let x = Math.floor(x0 / 14) * 14; x < x0 + w; x += 14) r.rect(x, y0, 1, yEnd - y0, '#EBCDA8');
    r.rect(x0, 18, w, 2, '#B9825A');
    r.rect(x0, 18, w, 1, '#5A4650');
    r.rect(x0, 100, w, yEnd - 100, '#E7B985');
    r.rect(x0, 100, w, 1, '#5A4650');
    r.rect(64, 98, 64, 4, '#F7C6D3');

    const p = this.pushok;
    const lift = p.lift;
    p.lift = lift * S;
    r.pushok(p, S);
    p.lift = lift;

    const total = this.g.store.data.butterfliesTotal;
    for (const it of this.items()) {
      const key = `${it.kind}:${it.id}`;
      const open = this.isOpen(it);
      const on = this.isOn(it);
      const wl = this.wiggle.get(key) ?? 0;
      const dx = wl > 0 ? Math.round(Math.sin(wl / 35) * 2) : 0;
      drawSlot(r, it.x + dx, it.y, it.w, it.h, on ? '#FDE2EA' : '#FFFFFF', on ? '#E8457A' : '#5A4650');
      const def = open ? it.def : silhouette(it.def, SIL);
      const sc = 2;
      const sw = it.def.rows[0].length * sc;
      const sh = it.def.rows.length * sc;
      r.sprite(`${open ? '' : 'sil:'}${key}`, def, it.x + dx + Math.floor((it.w - sw) / 2), it.y + Math.floor((it.h - sh) / 2) - (open ? 0 : 1), sc);
      if (!open) {
        // бабочка и полоска прогресса до открытия
        r.sprite('bf:1:#C9A6E8', butterfly(true, '#C9A6E8'), it.x + dx + it.w - 9, it.y + 2);
        const bw = it.w - 6;
        r.rect(it.x + dx + 3, it.y + it.h - 4, bw, 2, '#EEE3E7');
        r.rect(it.x + dx + 3, it.y + it.h - 4, Math.round((bw * Math.min(total, it.unlockAt)) / it.unlockAt), 2, '#C9A6E8');
      } else if (this.fresh.has(key) && Math.floor(this.time / 300) % 2) {
        r.sprite('small.sparkle', SMALL_SPRITES.sparkle, it.x + it.w - 5, it.y + 1);
      }
    }

    if (this.think > 0) {
      r.sprite('item.thoughtCloud', ITEM_ICONS.thoughtCloud, 112, 26, 2);
    }
    this.particles.draw(r);
    drawHomeButton(r, safe);
  }
}

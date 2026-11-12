import { CONFIG } from '../config';
import type { Target } from '../engine/input';
import type { Rect } from '../engine/layout';
import type { Renderer } from '../engine/renderer';
import { Pushok, during, type Script } from '../pushok/actor';
import { dress } from '../pushok/dress';
import { equippedOf, toggleWear, unlockedOf, WEAR_KINDS, type WearKind } from '../game/rules';
import { SWEATER_ICONS } from '../sprites/sweaters';
import { scaleDef, silhouette, type SpriteDef } from '../sprites/grid';
import { HATS, isHatId } from '../sprites/hats';
import { SMALL_SPRITES } from '../sprites/home-objects';
import { butterfly, GUITARS, ITEM_ICONS } from '../sprites/items';
import { Particles } from './particles';
import type { Game, Scene } from './scene';
import { BTN, drawButton, drawHomeButton, drawSlot, homeButton } from './ui';

// Гардероб: шляпки, кофточки и гитары на трех вкладках, надето по одной вещи каждого вида.
// Вещи открываются по общему числу пойманных бабочек. Закрытая вещь = силуэт
// с бабочкой и полоской «сколько еще осталось». Тап по Пушку с гитарой = мелодия.

const S = 3;
const SIL = '#D9C7CF';
const PX = 40; // Пушок слева
const PY = 98;

type Tab = WearKind;

interface Item {
  kind: Tab;
  id: string;
  unlockAt: number;
  def: SpriteDef;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Иконки вкладок: корона, кофточка, гитара. */
const TAB_ICONS: Record<Tab, SpriteDef> = {
  hat: scaleDef(HATS.crown, 2),
  sweater: SWEATER_ICONS.heart,
  guitar: GUITARS.pink,
};

export class WardrobeScene implements Scene {
  readonly id = 'wardrobe' as const;
  private pushok = new Pushok();
  private particles = new Particles();
  private wiggle = new Map<string, number>();
  private fresh: Set<string>;
  private think = 0;
  private time = 0;
  tab: Tab = 'hat';

  constructor(private g: Game) {
    const s = g.store.data;
    this.fresh = new Set(
      WEAR_KINDS.flatMap((k) => unlockedOf(s, k).map((id) => `${k}:${id}`)).filter((k) => !s.seen.includes(k)),
    );
    // увидел обновки: искорка на кнопке гардероба дома больше не горит
    if (this.fresh.size) g.store.update((d) => d.seen.push(...this.fresh));
    // открываем вкладку, где появилась обновка
    const firstFresh = [...this.fresh][0];
    if (firstFresh) this.tab = firstFresh.split(':')[0] as Tab;
    this.dress();
    this.pushok.x = PX;
    this.pushok.y = PY;
  }

  private dress() {
    dress(this.pushok, this.g.store.data);
  }

  /** Вещи текущей вкладки: шляпки сеткой 4×3, кофточки и гитары 3×2. */
  private items(): Item[] {
    if (this.tab === 'hat') {
      return CONFIG.hats
        .filter((h) => isHatId(h.id))
        .map((h, i) => ({
          kind: 'hat' as const,
          id: h.id,
          unlockAt: h.unlockAt,
          def: HATS[h.id as keyof typeof HATS],
          x: 76 + (i % 4) * 29,
          y: 31 + Math.floor(i / 4) * 25,
          w: 26,
          h: 22,
        }));
    }
    const kind = this.tab;
    const list = kind === 'guitar' ? CONFIG.guitars : CONFIG.sweaters;
    const defs = kind === 'guitar' ? GUITARS : SWEATER_ICONS;
    return list
      .filter((it) => defs[it.id])
      .map((it, i) => ({
        kind,
        id: it.id,
        unlockAt: it.unlockAt,
        def: defs[it.id],
        x: 76 + (i % 3) * 39,
        y: 36 + Math.floor(i / 3) * 30,
        w: 36,
        h: 26,
      }));
  }

  private tabButton(t: Tab) {
    return { x: 88 + WEAR_KINDS.indexOf(t) * 28, y: 3 };
  }

  private isOpen(it: Item) {
    return unlockedOf(this.g.store.data, it.kind).includes(it.id);
  }

  private isOn(it: Item) {
    return equippedOf(this.g.store.data, it.kind) === it.id;
  }

  targets(safe: Rect): Target[] {
    const list: Target[] = [];
    const h = homeButton(safe);
    list.push({ id: 'btn:home', x: h.x, y: h.y, w: BTN, h: BTN, onTap: () => this.g.go('home') });
    for (const t of WEAR_KINDS) {
      const b = this.tabButton(t);
      list.push({
        id: `tab:${t}`,
        x: b.x,
        y: b.y,
        w: BTN,
        h: BTN,
        onTap: () => {
          if (this.tab !== t) this.g.sfx.play('pop');
          this.tab = t;
        },
      });
    }
    for (const it of this.items()) {
      list.push({ id: `${it.kind}:${it.id}`, x: it.x, y: it.y, w: it.w, h: it.h, onTap: () => this.tapItem(it) });
    }
    list.push({ id: 'pushok', x: PX - 8 * S, y: PY - 16 * S, w: 17 * S, h: 16 * S, onTap: () => this.tapPushok() });
    return list;
  }

  private tapItem(it: Item) {
    if (!this.isOpen(it)) {
      // еще закрыто: вещь покачивается, Пушок думает об облачке с бабочками
      this.g.sfx.play('nope');
      this.wiggle.set(`${it.kind}:${it.id}`, 500);
      this.think = 1800;
      return;
    }
    const on = this.isOn(it);
    this.g.store.update((s) => toggleWear(s, it.kind, it.id));
    this.dress();
    this.g.sfx.play(on ? 'pop' : 'joy');
    if (!on) this.particles.burst(PX, it.kind === 'hat' ? 48 : it.kind === 'sweater' ? 76 : 82, 7);
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
        this.particles.spawn('note', PX + 16 + Math.random() * 10, 52, 6 + Math.random() * 8, -16, 1100);
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
    r.rect(x0, 27, w, 2, '#B9825A');
    r.rect(x0, 27, w, 1, '#5A4650');
    r.rect(x0, 102, w, yEnd - 102, '#E7B985');
    r.rect(x0, 102, w, 1, '#5A4650');
    r.rect(PX - 30, 100, 60, 3, '#F7C6D3');

    const p = this.pushok;
    const lift = p.lift;
    p.lift = lift * S;
    r.pushok(p, S);
    p.lift = lift;

    // вкладки: выбранная розовая и чуть выше
    for (const t of WEAR_KINDS) {
      const b = this.tabButton(t);
      const on = this.tab === t;
      if (on) r.rect(b.x + 3, b.y + BTN - 1, BTN - 6, 2, '#E8457A');
      drawButton(r, { x: b.x, y: b.y - (on ? 1 : 0) }, `tab.${t}`, TAB_ICONS[t]);
    }

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

    if (this.think > 0) r.sprite('item.thoughtCloud', ITEM_ICONS.thoughtCloud, PX + 6, 20, 2);
    this.particles.draw(r);
    drawHomeButton(r, safe);
  }
}

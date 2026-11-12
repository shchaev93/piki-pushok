import type { Save } from '../save/schema';
import { isHatId } from '../sprites/hats';
import { GUITARS } from '../sprites/items';
import { SWEATERS } from '../sprites/sweaters';
import type { Pushok } from './actor';

/** Одеть Пушка по сохранению: шляпка, кофточка и (если уместно) гитара. */
export function dress(p: Pushok, s: Readonly<Save>, withGuitar = true) {
  const e = s.equipped;
  p.hat = isHatId(e.hat) ? e.hat : null;
  p.sweater = e.sweater && SWEATERS[e.sweater] ? e.sweater : null;
  p.guitar = withGuitar && e.guitar && GUITARS[e.guitar] ? e.guitar : null;
}

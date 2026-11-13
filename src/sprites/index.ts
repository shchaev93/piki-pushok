import type { SpriteDef } from './grid';
import { HATS } from './hats';
import { HOME_SPRITES, SMALL_SPRITES } from './home-objects';
import { ICONS } from './icons';
import { BIG_CLOUD, BUTTERFLY_FOLDED, BUTTERFLY_OPEN, DISH_SPRITES, FOOD_SPRITES, GUITARS, ITEM_ICONS, MUSIC_SPRITES, STAR_SPRITES } from './items';
import { PUSHOK_FRAMES, pushokDef, type PushokFrame } from './pushok';
import { SWEATER_ICONS, SWEATERS } from './sweaters';

/** Все спрайты игры по именам: для тестов и страницы #sprites. */
export function allSprites(): Record<string, SpriteDef> {
  const out: Record<string, SpriteDef> = {};
  const add = (prefix: string, rec: Record<string, SpriteDef>) => {
    for (const [k, v] of Object.entries(rec)) out[`${prefix}.${k}`] = v;
  };
  for (const f of Object.keys(PUSHOK_FRAMES) as PushokFrame[]) out[`pushok.${f}`] = pushokDef(f);
  add('hat', HATS);
  add('guitar', GUITARS);
  add('sweater', SWEATERS);
  add('sweaterIcon', SWEATER_ICONS);
  add('home', HOME_SPRITES);
  add('small', SMALL_SPRITES);
  add('icon', ICONS);
  add('item', ITEM_ICONS);
  add('food', FOOD_SPRITES);
  add('dish', DISH_SPRITES);
  add('music', MUSIC_SPRITES);
  add('star', STAR_SPRITES);
  out['cloud.big'] = BIG_CLOUD;
  out['butterfly.open'] = BUTTERFLY_OPEN;
  out['butterfly.folded'] = BUTTERFLY_FOLDED;
  return out;
}

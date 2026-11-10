import type { SpriteDef } from './grid';
import { HATS } from './hats';
import { HOME_SPRITES, SMALL_SPRITES } from './home-objects';
import { ICONS } from './icons';
import { PUSHOK_FRAMES, pushokDef, type PushokFrame } from './pushok';

/** Все спрайты игры по именам: для тестов и страницы #sprites. */
export function allSprites(): Record<string, SpriteDef> {
  const out: Record<string, SpriteDef> = {};
  for (const f of Object.keys(PUSHOK_FRAMES) as PushokFrame[]) out[`pushok.${f}`] = pushokDef(f);
  for (const [k, v] of Object.entries(HATS)) out[`hat.${k}`] = v;
  for (const [k, v] of Object.entries(HOME_SPRITES)) out[`home.${k}`] = v;
  for (const [k, v] of Object.entries(SMALL_SPRITES)) out[`small.${k}`] = v;
  for (const [k, v] of Object.entries(ICONS)) out[`icon.${k}`] = v;
  return out;
}

import approvedSvg from '../../assets/pushok.svg?url';
import { allSprites } from '../sprites';
import { parseGrid, type Grid } from '../sprites/grid';
import { pushokWithHat } from '../sprites/pushok';
import { HATS, type HatId } from '../sprites/hats';
import { GUITARS } from '../sprites/items';
import { gridToCanvas } from '../sprites/render';

// Страница #sprites: все спрайты крупно, чтобы проверить их глазами
// и показать ребенку. Из игры сюда не попасть, только по адресу.

function tile(name: string, g: Grid, scale = 6) {
  const fig = document.createElement('figure');
  const c = gridToCanvas(g);
  c.style.width = `${g.w * scale}px`;
  c.style.height = `${g.h * scale}px`;
  const cap = document.createElement('figcaption');
  cap.textContent = name;
  fig.append(c, cap);
  return fig;
}

export function showGallery(version: string) {
  document.getElementById('game')?.remove();
  document.documentElement.classList.add('gallery');
  document.body.classList.add('gallery');
  const h = document.createElement('h1');
  h.textContent = `Спрайты (${version})`;
  const row = document.createElement('section');
  const img = document.createElement('img');
  img.src = approvedSvg;
  img.width = 180;
  const ref = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = 'pushok.svg (утвержденный)';
  ref.append(img, cap);
  row.append(ref, tile('из сетки: база + корона', pushokWithHat('base', 'crown').grid, 10));
  const outfits = document.createElement('section');
  for (const h of Object.keys(HATS) as HatId[]) outfits.append(tile(`Пушок + ${h}`, pushokWithHat('base', h).grid, 5));
  for (const g of Object.keys(GUITARS)) outfits.append(tile(`Пушок + гитара ${g}`, pushokWithHat('base', null, g).grid, 5));
  outfits.append(tile('корона + гитара, грусть', pushokWithHat('sad', 'crown', 'gold').grid, 5));
  const all = document.createElement('section');
  for (const [name, def] of Object.entries(allSprites())) all.append(tile(name, parseGrid(def, name)));
  document.body.append(h, row, outfits, all);
}

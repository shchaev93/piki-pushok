// Генерирует PNG-иконки PWA из сетки Пушка с короной (как в pushok.svg).
// Без внешних зависимостей: свой минимальный PNG-кодер на node:zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pushokWithHat } from '../src/sprites/pushok';

const BG = [0xff, 0xf4, 0xe2];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // фильтр None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Пушок по центру квадрата size, занимая долю fill по большей стороне. */
function icon(size: number, fill: number): Buffer {
  const { grid } = pushokWithHat('base', 'crown');
  const scale = Math.max(1, Math.floor((size * fill) / Math.max(grid.w, grid.h)));
  const ox = Math.floor((size - grid.w * scale) / 2);
  const oy = Math.floor((size - grid.h * scale) / 2);
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set([...BG, 255], i * 4);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const c = grid.px[y * grid.w + x];
      if (!c) continue;
      const n = parseInt(c.slice(1), 16);
      for (let j = 0; j < scale; j++) {
        for (let i = 0; i < scale; i++) {
          const o = ((oy + y * scale + j) * size + ox + x * scale + i) * 4;
          px.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], o);
        }
      }
    }
  }
  return encodePng(size, size, px);
}

const out = new URL('../public/', import.meta.url);
mkdirSync(new URL('icons/', out), { recursive: true });
const files: [string, number, number][] = [
  ['icons/icon-192.png', 192, 0.72],
  ['icons/icon-512.png', 512, 0.72],
  // maskable: Android обрезает края, Пушок должен уместиться в безопасный круг
  ['icons/icon-maskable-512.png', 512, 0.56],
  ['icons/apple-touch-icon.png', 180, 0.72],
  ['favicon.png', 64, 0.9],
];
for (const [name, size, fill] of files) writeFileSync(new URL(name, out), icon(size, fill));
console.log(`иконки: ${files.map((f) => f[0]).join(', ')}`);

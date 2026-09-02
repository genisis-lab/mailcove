#!/usr/bin/env node
// Generates public/icon-192.png and public/icon-512.png without native deps:
// a rounded gradient tile with a simple envelope mark, encoded as PNG by hand.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function icon(size) {
  const pad = size * 0.0625;
  const radius = size * 0.25;
  const inside = (x, y) => {
    const x0 = pad;
    const y0 = pad;
    const x1 = size - pad;
    const y1 = size - pad;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = x < x0 + radius ? x0 + radius : x > x1 - radius ? x1 - radius : x;
    const cy = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  // Envelope body and flap in relative coordinates.
  const ex0 = size * 0.25;
  const ex1 = size * 0.75;
  const ey0 = size * 0.34;
  const ey1 = size * 0.69;
  const er = size * 0.06;
  const inEnvelope = (x, y) => {
    if (x < ex0 || x > ex1 || y < ey0 || y > ey1) return false;
    const cx = x < ex0 + er ? ex0 + er : x > ex1 - er ? ex1 - er : x;
    const cy = y < ey0 + er ? ey0 + er : y > ey1 - er ? ey1 - er : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= er ** 2;
  };
  const stroke = size * 0.045;
  const inFlap = (x, y) => {
    // V shape from the top corners to the middle.
    const mx = size / 2;
    const my = size * 0.53;
    const dist = (ax, ay, bx, by) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    };
    return dist(ex0 + er, ey0 + er * 0.6, mx, my) < stroke / 2 || dist(ex1 - er, ey0 + er * 0.6, mx, my) < stroke / 2;
  };
  return png(size, (x, y) => {
    if (!inside(x + 0.5, y + 0.5)) return [0, 0, 0, 0];
    const t = (x + y) / (2 * size);
    if (inEnvelope(x + 0.5, y + 0.5)) {
      if (inFlap(x + 0.5, y + 0.5)) return [79, 70, 229, 255];
      return [255, 255, 255, 245];
    }
    return [Math.round(lerp(99, 14, t)), Math.round(lerp(102, 165, t)), Math.round(lerp(241, 233, t)), 255];
  });
}

mkdirSync(join(root, 'public'), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(root, 'public', `icon-${size}.png`), icon(size));
  console.log(`wrote public/icon-${size}.png`);
}

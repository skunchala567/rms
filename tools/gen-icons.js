'use strict';

/**
 * Generates PNG app icons (no external image libraries) by drawing a simple
 * bus icon into a raw RGBA buffer and encoding it as PNG via zlib.
 *   node tools/gen-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crcTable = crc32.table;
  if (!crcTable) {
    crcTable = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // rest 0
  // add filter byte (0) per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Simple drawing helpers on an RGBA buffer
function makeCanvas(size) {
  return { size, buf: Buffer.alloc(size * size * 4) };
}
function setPx(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  c.buf[i] = r; c.buf[i + 1] = g; c.buf[i + 2] = b; c.buf[i + 3] = a;
}
function fillRect(c, x0, y0, w, h, color, radius = 0) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (radius > 0) {
        const rx = Math.min(x - x0, x0 + w - 1 - x);
        const ry = Math.min(y - y0, y0 + h - 1 - y);
        if (rx < radius && ry < radius) {
          const dx = radius - rx, dy = radius - ry;
          if (dx * dx + dy * dy > radius * radius) continue;
        }
      }
      setPx(c, x, y, color);
    }
  }
}
function fillCircle(c, cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPx(c, x, y, color);
    }
  }
}
function gradientBg(c, top, bottom) {
  for (let y = 0; y < c.size; y++) {
    const t = y / (c.size - 1);
    const col = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
      255,
    ];
    for (let x = 0; x < c.size; x++) setPx(c, x, y, col);
  }
}

const SAND = [216, 201, 174, 255];      // pale sand (bus body)
const SAND_TOP = [239, 230, 212, 255];   // lighter sand (roof)
const CHARCOAL = [87, 87, 87, 255];      // windows
const DARK = [43, 43, 43, 255];          // wheels
const GRAY = [140, 140, 140, 255];       // hubs
const LINE = [196, 178, 144, 255];       // body line

function drawIcon(size, maskable) {
  const c = makeCanvas(size);
  const s = size / 512; // scale factor
  const S = (n) => Math.round(n * s);
  // maskable: keep content within safe area (~80%), so scale bus down a bit
  const pad = maskable ? size * 0.12 : 0;
  const inner = size - pad * 2;
  const is = inner / 512;
  const IS = (n) => Math.round(pad + n * is);
  const ISz = (n) => Math.round(n * is);

  gradientBg(c, [106, 106, 106], [69, 69, 69]);

  // bus body
  fillRect(c, IS(116), IS(150), ISz(280), ISz(180), SAND, S(28));
  fillRect(c, IS(116), IS(150), ISz(280), ISz(46), SAND_TOP, S(22));
  // windows
  fillRect(c, IS(140), IS(210), ISz(56), ISz(48), CHARCOAL, S(8));
  fillRect(c, IS(208), IS(210), ISz(56), ISz(48), CHARCOAL, S(8));
  fillRect(c, IS(276), IS(210), ISz(56), ISz(48), CHARCOAL, S(8));
  fillRect(c, IS(344), IS(210), ISz(34), ISz(48), CHARCOAL, S(8));
  // lower line
  fillRect(c, IS(116), IS(282), ISz(280), ISz(10), LINE);
  // wheels
  fillCircle(c, IS(176), IS(346), ISz(30), DARK);
  fillCircle(c, IS(176), IS(346), ISz(13), GRAY);
  fillCircle(c, IS(336), IS(346), ISz(30), DARK);
  fillCircle(c, IS(336), IS(346), ISz(13), GRAY);

  return encodePNG(size, size, c.buf);
}

fs.writeFileSync(path.join(OUT, 'icon-192.png'), drawIcon(192, false));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), drawIcon(512, false));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), drawIcon(512, true));
console.log('Generated PNG icons in public/icons/');

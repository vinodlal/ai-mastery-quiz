// Generates PWA icons as PNGs with zero dependencies (pure Node + zlib).
// Design: indigo->violet gradient tile with a white quiz-list mark.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function drawIcon(S, { maskable = false } = {}) {
  const px = Buffer.alloc(S * S * 4);
  const top = [79, 70, 229], bot = [139, 92, 246]; // indigo-600 -> violet-500
  const R = maskable ? 0 : S * 0.21;
  const inRounded = (x, y) => {
    if (R === 0) return true;
    const cx = Math.min(Math.max(x, R), S - R), cy = Math.min(Math.max(y, R), S - R);
    return (x - cx) ** 2 + (y - cy) ** 2 <= R * R || (x >= R && x <= S - R) || (y >= R && y <= S - R);
  };
  // content inset: maskable icons need a safe zone (~20%)
  const inset = maskable ? 0.20 : 0.14;
  const cW = S * (1 - inset * 2), cX = S * inset;
  const bars = [
    { y: 0.30, w: 0.86 },
    { y: 0.50, w: 0.62 },
    { y: 0.70, w: 0.74 },
  ];
  const barH = S * 0.075, dotR = S * 0.045;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      if (!inRounded(x, y)) { px[o + 3] = 0; continue; }
      const t = y / S;
      let r = lerp(top[0], bot[0], t), g = lerp(top[1], bot[1], t), b = lerp(top[2], bot[2], t);
      for (const bar of bars) {
        const by = S * bar.y, bx0 = cX + dotR * 2.8, bx1 = cX + dotR * 2.8 + (cW - dotR * 2.8) * bar.w;
        // bullet dot
        const dcx = cX + dotR, dcy = by;
        if ((x - dcx) ** 2 + (y - dcy) ** 2 <= dotR ** 2) { r = g = b = 255; }
        // rounded bar
        const hy = barH / 2;
        const nx = Math.min(Math.max(x, bx0 + hy), bx1 - hy);
        if ((x - nx) ** 2 + (y - by) ** 2 <= hy ** 2) { r = g = b = 255; }
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  return encodePNG(S, S, px);
}

writeFileSync(join(outDir, "icon-192.png"), drawIcon(192));
writeFileSync(join(outDir, "icon-512.png"), drawIcon(512));
writeFileSync(join(outDir, "icon-512-maskable.png"), drawIcon(512, { maskable: true }));
writeFileSync(join(outDir, "apple-touch-icon.png"), drawIcon(180, { maskable: true }));
console.log("Icons written to public/icons/");

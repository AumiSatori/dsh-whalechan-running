#!/usr/bin/env node
/**
 * webm2apng.mjs — 把黑底 WebM 动作转成透明背景 APNG（给 DSH 深度求索中图标用）
 *
 * 源素材：yanzwzz/dsh-whale-girl-pet（MIT）assets/thumb/*.webm，360x360 / 24fps / VP9 / yuv420p（无 alpha，纯黑底）
 * 做法：ffmpeg 抽帧 → 黑底连通域抠图（反预乘）→ 统一窗口裁切 → Lanczos3 缩放 → USM → APNG
 *
 * 用法：node webm2apng.mjs <in.webm> <out.apng> [--fps 6] [--size 64] [--crop 290]
 *                          [--cx 180] [--cy 192] [--t1 64] [--sharpen 0.55] [--preview dir] [--still out.png]
 */
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── PNG / APNG 编码 ─────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function ihdr(w, h) { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 6; return chunk("IHDR", b); }
function fctl(seq, w, h, dn, dd) {
  const b = Buffer.alloc(26);
  b.writeUInt32BE(seq, 0); b.writeUInt32BE(w, 4); b.writeUInt32BE(h, 8); b.writeUInt32BE(0, 12); b.writeUInt32BE(0, 16);
  b.writeUInt16BE(dn, 20); b.writeUInt16BE(dd, 22); b[24] = 0; b[25] = 0;
  return chunk("fcTL", b);
}
function idat(rgba, w, h) {
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(rows, y * (w * 4 + 1) + 1);
  }
  return zlib.deflateSync(rows, { level: 9 });
}
function encodePNG(rgba, w, h) {
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(rows, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr(w, h),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 黑底 → 透明（连通域 + 反预乘）─────────────────────────────────────────
function keyBlack(rgba, w, h, t0 = 8, t1 = 64) {
  const n = w * h;
  const bg = new Uint8Array(n);
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const m = rgba[j] > rgba[j + 1] ? (rgba[j] > rgba[j + 2] ? rgba[j] : rgba[j + 2]) : (rgba[j + 1] > rgba[j + 2] ? rgba[j + 1] : rgba[j + 2]);
    lum[i] = m;
  }
  // 从四边 BFS：只穿过 lum < t1 的像素
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i) => { if (!bg[i] && lum[i] < t1) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const y = (i / w) | 0, x = i - y * w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const span = t1 - t0;
  for (let i = 0; i < n; i++) {
    if (!bg[i]) continue;
    const j = i * 4;
    const l = lum[i];
    if (l <= t0) { rgba[j] = 0; rgba[j + 1] = 0; rgba[j + 2] = 0; rgba[j + 3] = 0; continue; }
    const a = (l - t0) / span;              // 0..1
    const inv = 1 / Math.max(a, 0.02);      // 反预乘（黑底合成 → 原色）
    rgba[j] = Math.min(255, Math.round(rgba[j] * inv));
    rgba[j + 1] = Math.min(255, Math.round(rgba[j + 1] * inv));
    rgba[j + 2] = Math.min(255, Math.round(rgba[j + 2] * inv));
    rgba[j + 3] = Math.round(a * 255);
  }
  return rgba;
}

// ── 缩放 / 锐化（与 make-apng.mjs 同款）────────────────────────────────────
const LANCZOS = (x) => {
  const a = Math.abs(x);
  if (a < 1e-8) return 1;
  if (a >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};
function kernel(nSrc, nDst) {
  const scale = nDst / nSrc;
  const widen = Math.max(1, 1 / scale);
  const support = 3 * widen;
  const out = [];
  for (let i = 0; i < nDst; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(nSrc - 1, Math.ceil(center + support));
    const ws = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) { const wt = LANCZOS((j - center) / widen); ws.push([j, wt]); sum += wt; }
    out.push(ws.map(([j, wt]) => [j, wt / sum]));
  }
  return out;
}
function resize(rgba, sw, sh, dw, dh) {
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = rgba[i * 4 + 3] / 255;
    pm[i * 4] = rgba[i * 4] * a; pm[i * 4 + 1] = rgba[i * 4 + 1] * a; pm[i * 4 + 2] = rgba[i * 4 + 2] * a; pm[i * 4 + 3] = a;
  }
  const kx = kernel(sw, dw), ky = kernel(sh, dh);
  const tmp = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, wt] of kx[x]) { const o = (y * sw + sx) * 4; r += pm[o] * wt; g += pm[o + 1] * wt; b += pm[o + 2] * wt; a += pm[o + 3] * wt; }
      const o = (y * dw + x) * 4; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sy, wt] of ky[y]) { const o = (sy * dw + x) * 4; r += tmp[o] * wt; g += tmp[o + 1] * wt; b += tmp[o + 2] * wt; a += tmp[o + 3] * wt; }
      const o = (y * dw + x) * 4;
      const aa = Math.max(0, Math.min(1, a));
      const inv = aa > 1e-4 ? 1 / aa : 0;
      out[o] = Math.max(0, Math.min(255, r * inv));
      out[o + 1] = Math.max(0, Math.min(255, g * inv));
      out[o + 2] = Math.max(0, Math.min(255, b * inv));
      out[o + 3] = Math.round(aa * 255);
    }
  }
  return out;
}
function unsharp(rgba, w, h, amount) {
  if (amount <= 0) return rgba;
  const n = w * h;
  const pm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = rgba[i * 4 + 3] / 255; pm[i * 3] = rgba[i * 4] * a; pm[i * 3 + 1] = rgba[i * 4 + 1] * a; pm[i * 3 + 2] = rgba[i * 4 + 2] * a; }
  const blur = new Float32Array(n * 3);
  const K = [1, 2, 1], KSUM = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = Math.max(0, Math.min(h - 1, y + dy));
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.max(0, Math.min(w - 1, x + dx));
        const wt = K[dx + 1] * K[dy + 1];
        const o = (yy * w + xx) * 3;
        r += pm[o] * wt; g += pm[o + 1] * wt; b += pm[o + 2] * wt;
      }
    }
    const o = (y * w + x) * 3;
    blur[o] = r / (KSUM * KSUM); blur[o + 1] = g / (KSUM * KSUM); blur[o + 2] = b / (KSUM * KSUM);
  }
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    if (a <= 0) continue;
    const inv = 1 / a;
    for (let c = 0; c < 3; c++) {
      const sharp = pm[i * 3 + c] + amount * (pm[i * 3 + c] - blur[i * 3 + c]);
      out[i * 4 + c] = Math.max(0, Math.min(255, sharp * inv));
    }
  }
  return out;
}
function crop(rgba, w, h, x0, y0, cw, ch) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = y0 + y;
    for (let x = 0; x < cw; x++) {
      const sx = x0 + x;
      const o = (y * cw + x) * 4;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) { out[o + 3] = 0; continue; }
      const i = (sy * w + sx) * 4;
      out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; out[o + 3] = rgba[i + 3];
    }
  }
  return out;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
const [, , src, outPath, ...flags] = process.argv;
const opt = (n, d) => { const i = flags.indexOf("--" + n); return i >= 0 ? Number(flags[i + 1]) : d; };
const strOpt = (n) => { const i = flags.indexOf("--" + n); return i >= 0 ? flags[i + 1] : null; };
if (!src || !outPath) {
  console.log("用法: node webm2apng.mjs <in.webm> <out.apng> [--fps 6] [--size 64] [--crop 290] [--cx 180] [--cy 192] [--t1 64] [--sharpen 0.55] [--preview dir] [--still out.png]");
  process.exit(1);
}
const FPS = opt("fps", 6);
const SIZE = opt("size", 64);
const CROP = opt("crop", 290);
const CX = opt("cx", 180);
const CY = opt("cy", 192);
const T1 = opt("t1", 64);
const SHARPEN = opt("sharpen", 0.55);
const preview = strOpt("preview");
const still = strOpt("still");

const SW = 360, SH = 360;
const r = spawnSync("ffmpeg", ["-v", "error", "-i", src, "-vf", `fps=${FPS}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 30 });
if (r.status !== 0 || !r.stdout?.length) { console.error("ffmpeg 失败", r.status, r.stderr?.toString().slice(0, 300)); process.exit(1); }
const fs_ = SW * SH * 4;
const count = Math.floor(r.stdout.length / fs_);
const delayMs = Math.round(1000 / FPS);  // APNG delay_num 单位 1/1000 秒（6fps → 167ms）

const cropX = Math.round(CX - CROP / 2), cropY = Math.round(CY - CROP / 2);
const frames = [];
for (let k = 0; k < count; k++) {
  let rgba = new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset + k * fs_, fs_);
  rgba = new Uint8ClampedArray(rgba);           // 拷贝，避免共享内存被改
  keyBlack(rgba, SW, SH, 8, T1);
  const c = crop(rgba, SW, SH, cropX, cropY, CROP, CROP);
  const small = resize(c, CROP, CROP, SIZE, SIZE);
  frames.push(unsharp(small, SIZE, SIZE, SHARPEN));
}
if (!frames.length) { console.error("无帧"); process.exit(1); }

// APNG 组装
const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(SIZE, SIZE)];
const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
parts.push(chunk("acTL", actl));
parts.push(fctl(0, SIZE, SIZE, delayMs, 1000));
parts.push(chunk("IDAT", idat(frames[0], SIZE, SIZE)));
let seq = 1;
for (let i = 1; i < frames.length; i++) {
  parts.push(fctl(seq++, SIZE, SIZE, delayMs, 1000));
  const hdr = Buffer.alloc(4); hdr.writeUInt32BE(seq++, 0);
  parts.push(chunk("fdAT", Buffer.concat([hdr, idat(frames[i], SIZE, SIZE)])));
}
parts.push(chunk("IEND", Buffer.alloc(0)));
const apng = Buffer.concat(parts);
writeFileSync(outPath, apng);
console.log(`✅ ${outPath} · ${SIZE}x${SIZE} · ${frames.length}帧 @${FPS}fps · ${apng.length}B · 裁 (${cropX},${cropY})+${CROP}`);

if (still) writeFileSync(still, encodePNG(frames[Math.floor(frames.length * 0.35)], SIZE, SIZE));
if (preview) {
  if (!existsSync(preview)) mkdirSync(preview, { recursive: true });
  const step = Math.max(1, Math.floor(frames.length / 8));
  for (let i = 0; i < frames.length; i += step) writeFileSync(join(preview, `p-${String(i).padStart(3, "0")}.png`), encodePNG(frames[i], SIZE, SIZE));
}

// make-apng.mjs — .ani → APNG（去光标箭头 / Lanczos3 / USM / 抽帧），dsh-whalechan-running 素材生产线
// 用法: node tools/make-apng.mjs <file.ani> <out.apng> [--size 32] [--scale 2] [--frames 30] [--sharpen 0.5] [--preview dir] [--icon out.png]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { readdirSync } from "node:fs";

// ── PNG / APNG 编码 ─────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function ihdr(w, h) { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 6; return chunk("IHDR", b); }
function fctl(seq, w, h, dn, dd) {
  const b = Buffer.alloc(26);
  b.writeUInt32BE(seq, 0); b.writeUInt32BE(w, 4); b.writeUInt32BE(h, 8);
  b.writeUInt16BE(dn, 20); b.writeUInt16BE(dd, 22);
  return chunk("fcTL", b);
}
function idat(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return deflateSync(raw, { level: 9 });
}
function encodePNG(rgba, w, h) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(w, h), chunk("IDAT", idat(rgba, w, h)), chunk("IEND", Buffer.alloc(0))]);
}

// ── .ani → 原始 RGBA 帧 ─────────────────────────────────────────────────────
function parseAni(file) {
  const buf = readFileSync(file);
  const icons = []; let anih = null, rate = null;
  (function walk(start, end) {
    let p = start;
    while (p + 8 <= end) {
      const id = buf.toString("ascii", p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      const body = p + 8;
      if (id === "LIST") walk(body + 4, body + size);
      else if (id === "anih") anih = { nFrames: buf.readUInt32LE(body + 4), jifRate: buf.readUInt32LE(body + 28) };
      else if (id === "rate") rate = Array.from({ length: size / 4 }, (_, i) => buf.readUInt32LE(body + i * 4));
      else if (id === "icon") icons.push(buf.subarray(body, body + size));
      p = body + size + (size & 1);
    }
  })(12, buf.length);
  return { icons, anih, rate };
}
function icoToRGBA(ico) {
  const count = ico.readUInt16LE(4);
  let best = 0, bestBpp = -1;
  for (let i = 0; i < count; i++) { const e = 6 + i * 16; const bpp = ico.readUInt16LE(e + 6); if (bpp > bestBpp) { bestBpp = bpp; best = e; } }
  const size = ico.readUInt32LE(best + 8);
  const off = ico.readUInt32LE(best + 12);
  const d = ico.subarray(off, off + size);
  const biSize = d.readUInt32LE(0);
  const w = d.readInt32LE(4);
  const hRaw = d.readInt32LE(8);
  const bpp = d.readUInt16LE(14);
  const h = Math.abs(hRaw) / 2;
  const pixels = d.subarray(biSize);
  const rgba = Buffer.alloc(w * h * 4);
  const stride = Math.ceil((w * bpp) / 32) * 4;
  for (let y = 0; y < h; y++) {
    const sy = hRaw > 0 ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const o = sy * stride + x * (bpp / 8);
      const o2 = (y * w + x) * 4;
      rgba[o2] = pixels[o + 2]; rgba[o2 + 1] = pixels[o + 1]; rgba[o2 + 2] = pixels[o]; rgba[o2 + 3] = pixels[o + 3];
    }
  }
  return { width: w, height: h, rgba };
}

// ── 连通域：找出并抹掉光标箭头 ──────────────────────────────────────────────
function components(rgba, w, h, threshold = 10) {
  const seen = new Uint8Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || rgba[i * 4 + 3] <= threshold) continue;
    let sp = 0; stack[sp++] = i; seen[i] = 1;
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const members = [];
    while (sp) {
      const p = stack[--sp]; n++; members.push(p);
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        if (Math.abs((q % w) - x) > 1) continue;
        if (rgba[q * 4 + 3] <= threshold) continue;
        seen[q] = 1; stack[sp++] = q;
      }
    }
    comps.push({ n, x0, y0, x1, y1, members });
  }
  return comps;
}

function stripCursor(rgba, w, h, verbose) {
  const comps = components(rgba, w, h);
  comps.sort((a, b) => b.n - a.n);
  const main = comps[0];
  // 箭头 = 除主块之外、位于主块左上方向、且本身不算太小的块
  // 光标箭头固定钉在左上角（实测 256 尺度下 bbox 约 (3,6)-(105,89)），
  // 且它的描边/高光会被拆成多个碎块（3596 / 648 / 55px 等），所以不能按面积筛 ——
  // 只按「bbox 落在左上角窗口内 且 明显小于主块」判定。
  const junk = comps.slice(1).filter((c) => c.n < main.n * 0.5 && c.x1 <= w * 0.46 && c.y1 <= h * 0.38);
  if (verbose) console.log(`  连通块 ${comps.length} 个；主块 ${main.n}px bbox(${main.x0},${main.y0})-(${main.x1},${main.y1})；判定箭头 ${junk.length} 块: ` + junk.map((c) => `[${c.n}px ${c.x0},${c.y0}-${c.x1},${c.y1}]`).join(" "));
  for (const c of junk) for (const p of c.members) rgba[p * 4 + 3] = 0;
  return junk.length;
}

function bbox(rgba, w, h, threshold = 10) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function crop(rgba, w, h, x0, y0, cw, ch) {
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const s = (sy * w + sx) * 4, d = (y * cw + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return out;
}

// ── Lanczos3（scale-aware，下采样时展宽支撑 = 低通，抑制混叠）───────────────
const LANCZOS = (x) => {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

// 权重表：目标像素 → [[源索引, 归一权重], ...]
function kernel(nSrc, nDst) {
  const ratio = nSrc / nDst;
  const widen = Math.max(1, ratio);      // 缩小越多，支撑越宽
  const support = 3 * widen;
  const table = [];
  for (let d = 0; d < nDst; d++) {
    const center = (d + 0.5) * ratio - 0.5;
    const lo = Math.max(0, Math.ceil(center - support));
    const hi = Math.min(nSrc - 1, Math.floor(center + support));
    const row = [];
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      const wgt = LANCZOS((i - center) / widen);
      if (wgt <= 0) continue;
      row.push([i, wgt]); sum += wgt;
    }
    if (sum > 0) for (const it of row) it[1] /= sum;
    table.push(row);
  }
  return table;
}

function resize(rgba, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return rgba;
  const kx = kernel(sw, dw), ky = kernel(sh, dh);
  // 水平：sw×sh → dw×sh，premultiplied
  const mid = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [i, wt] of kx[x]) {
        const o = (y * sw + i) * 4, al = rgba[o + 3] / 255;
        r += rgba[o] * al * wt; g += rgba[o + 1] * al * wt; b += rgba[o + 2] * al * wt; a += al * wt;
      }
      const d = (y * dw + x) * 4;
      mid[d] = r; mid[d + 1] = g; mid[d + 2] = b; mid[d + 3] = a;
    }
  }
  // 垂直：dw×sh → dw×dh，回 straight alpha
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [i, wt] of ky[y]) {
        const o = (i * dw + x) * 4;
        r += mid[o] * wt; g += mid[o + 1] * wt; b += mid[o + 2] * wt; a += mid[o + 3] * wt;
      }
      const d = (y * dw + x) * 4;
      const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
      if (a > 0.0009) { out[d] = cl(r / a); out[d + 1] = cl(g / a); out[d + 2] = cl(b / a); }
      out[d + 3] = cl(a * 255);
    }
  }
  return out;
}

// ── USM 锐化（在 premultiplied 空间做，避免透明边缘串色）────────────────────
function unsharp(rgba, w, h, amount) {
  if (!(amount > 0)) return rgba;
  const n = w * h;
  const pa = new Float32Array(n), pr = new Float32Array(n), pg = new Float32Array(n), pb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const al = rgba[i * 4 + 3] / 255;
    pa[i] = al; pr[i] = rgba[i * 4] * al; pg[i] = rgba[i * 4 + 1] * al; pb[i] = rgba[i * 4 + 2] * al;
  }
  const K = [1, 2, 1];
  const blur = (src) => {
    const t = new Float32Array(n), o = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, ws = 0;
      for (let k = -1; k <= 1; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; s += src[y * w + xx] * K[k + 1]; ws += K[k + 1]; }
      t[y * w + x] = s / ws;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, ws = 0;
      for (let k = -1; k <= 1; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; s += t[yy * w + x] * K[k + 1]; ws += K[k + 1]; }
      o[y * w + x] = s / ws;
    }
    return o;
  };
  const br = blur(pr), bg = blur(pg), bb = blur(pb);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < n; i++) {
    const al = pa[i];
    if (al <= 0.002) continue;
    rgba[i * 4] = cl((pr[i] + amount * (pr[i] - br[i])) / al);
    rgba[i * 4 + 1] = cl((pg[i] + amount * (pg[i] - bg[i])) / al);
    rgba[i * 4 + 2] = cl((pb[i] + amount * (pb[i] - bb[i])) / al);
  }
  return rgba;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const [, , src, outPath, ...flags] = process.argv;
const opt = (n, d) => { const i = flags.indexOf("--" + n); return i >= 0 ? Number(flags[i + 1]) : d; };
const strOpt = (n) => { const i = flags.indexOf("--" + n); return i >= 0 ? flags[i + 1] : null; };
if (!src || !outPath) { console.log("用法: node dearrow.mjs <file.ani> <out.apng> [--size 32] [--scale 2] [--frames 30] [--sharpen 0.5] [--preview dir] [--icon out.png]"); process.exit(1); }

const size = opt("size", 32);
const every = opt("every", 1);
const frameCount = opt("frames", 0);          // 均匀抽成 N 帧（优先于 --every）
const scale = opt("scale", 1);                // 输出像素 = size * scale（给 HiDPI 用）
const sharpen = opt("sharpen", 0.5);          // USM 强度，0 = 关
const preview = strOpt("preview");
const outSize = Math.round(size * scale);

const { icons, anih, rate } = parseAni(src);
const delays = rate ?? Array(icons.length).fill(anih?.jifRate ?? 3);

// 帧挑选：均匀取 N 帧（含首尾），delay 由后面按原 time step 合并累加
const pickIdx = (() => {
  if (frameCount > 0 && frameCount < icons.length) {
    const idx = [];
    for (let k = 0; k < frameCount; k++) idx.push(Math.round((k * (icons.length - 1)) / (frameCount - 1)));
    return [...new Set(idx)];
  }
  const idx = [];
  for (let i = 0; i < icons.length; i += every) idx.push(i);
  return idx;
})();

// 1) 去箭头 + 求共同 bbox
const frames = [];
let totalJunk = 0;
for (let k = 0; k < pickIdx.length; k++) {
  const i = pickIdx[k];
  const f = icoToRGBA(icons[i]);
  if (k === 0) console.log(`源帧 ${f.width}x${f.height}，原 ${icons.length} 帧 → 取 ${pickIdx.length} 帧，输出 ${outSize}x${outSize}${scale > 1 ? `（${scale}x）` : ""}`);
  totalJunk += stripCursor(f.rgba, f.width, f.height, k === 0);
  // 抽帧后每帧持续时间 = 被合并掉的原始帧 delay 之和
  const end = k + 1 < pickIdx.length ? pickIdx[k + 1] : icons.length;
  let acc = 0;
  for (let j = i; j < end; j++) acc += delays[j] ?? 3;
  frames.push({ ...f, delay: Math.max(1, acc) });
}
console.log(`去箭头：累计清除 ${totalJunk} 个连通块`);

// 2) 共同 bbox（所有帧的并集 → 保证动画过程中不抖动裁切）
let ux0 = 1e9, uy0 = 1e9, ux1 = -1, uy1 = -1;
for (const f of frames) {
  const b = bbox(f.rgba, f.width, f.height);
  if (!b) continue;
  ux0 = Math.min(ux0, b.x0); uy0 = Math.min(uy0, b.y0);
  ux1 = Math.max(ux1, b.x1); uy1 = Math.max(uy1, b.y1);
}
const cw = ux1 - ux0 + 1, ch = uy1 - uy0 + 1;
console.log(`人物并集 bbox: (${ux0},${uy0})-(${ux1},${uy1}) → ${cw}x${ch}`);

// 3) 正方形裁切（以 bbox 中心为准，边长取长边）
const side = Math.max(cw, ch);
const cx = ux0 + cw / 2, cy = uy0 + ch / 2;
const cropX = Math.round(cx - side / 2), cropY = Math.round(cy - side / 2);

const out = [];
for (const f of frames) {
  const c = crop(f.rgba, f.width, f.height, cropX, cropY, side, side);
  const small = resize(c, side, side, outSize, outSize);
  out.push({ rgba: unsharp(small, outSize, outSize, sharpen), delay: f.delay });
}
if (sharpen > 0) console.log(`USM 锐化 amount=${sharpen}`);

// 4) APNG
const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(outSize, outSize)];
const actl = Buffer.alloc(8); actl.writeUInt32BE(out.length, 0); actl.writeUInt32BE(0, 4);
parts.push(chunk("acTL", actl));
parts.push(fctl(0, outSize, outSize, Math.max(1, out[0].delay * 10), 600));
parts.push(chunk("IDAT", idat(out[0].rgba, outSize, outSize)));
let seq = 1;
for (let i = 1; i < out.length; i++) {
  parts.push(fctl(seq++, outSize, outSize, Math.max(1, out[i].delay * 10), 600));
  const hdr = Buffer.alloc(4); hdr.writeUInt32BE(seq++, 0);
  parts.push(chunk("fdAT", Buffer.concat([hdr, idat(out[i].rgba, outSize, outSize)])));
}
parts.push(chunk("IEND", Buffer.alloc(0)));
const apng = Buffer.concat(parts);
writeFileSync(outPath, apng);
console.log(`✅ APNG ${outPath} · ${outSize}x${outSize} · ${out.length} 帧 · ${apng.length} 字节`);

// 4.5) 单帧 icon（取中段一帧，姿态更完整）
const iconPath = strOpt("icon");
if (iconPath) {
  const pick = out[Math.floor(out.length * 0.35)];
  writeFileSync(iconPath, encodePNG(pick.rgba, outSize, outSize));
  console.log("icon → " + iconPath);
}

// 5) 预览帧
if (preview) {
  if (!existsSync(preview)) mkdirSync(preview, { recursive: true });
  for (let i = 0; i < out.length; i += Math.max(1, Math.floor(out.length / 6))) {
    writeFileSync(join(preview, `preview-${String(i).padStart(3, "0")}.png`), encodePNG(out[i].rgba, outSize, outSize));
  }
  console.log("预览 → " + preview + " (" + readdirSync(preview).length + " 张)");
}

# -*- coding: utf-8 -*-
"""把 pool 里的 APNG 转成「精灵图」（10 列网格），命名 <名字>__s<帧数>.png。

为什么要精灵图：浏览器播 APNG/WebP 这类动画图时，在循环接缝处会走「重新解码 + 重新
合成」那条路，个别环境（GPU 合成层、WebKit、部分 Electron 版本）会闪出一帧残影/花屏。
精灵图是**一张静态 PNG**，靠 background-position 位移逐帧，不经过动画图的解码器，
接缝处只是位置跳回第一格，物理上不可能出解码类花屏。

用法：
  python apng2sprite.py <apng目录> <输出目录> [--cols 10] [--cell 64]
"""
import os
import sys
from PIL import Image, ImageSequence

def convert(src, dst, cols=10, cell=64):
    im = Image.open(src)
    frames = [f.convert("RGBA") for f in ImageSequence.Iterator(im)]
    n = len(frames)
    if not n:
        raise SystemExit(f"{src} 没有帧")
    if frames[0].size != (cell, cell):
        frames = [f.resize((cell, cell), Image.LANCZOS) for f in frames]
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, ((i % cols) * cell, (i // cols) * cell))
    sheet.save(dst, "PNG", optimize=True)
    return n, sheet.size, os.path.getsize(dst)

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    srcdir, dstdir = sys.argv[1], sys.argv[2]
    cols = 10
    cell = 64
    args = sys.argv[3:]
    if "--cols" in args:
        cols = int(args[args.index("--cols") + 1])
    if "--cell" in args:
        cell = int(args[args.index("--cell") + 1])
    os.makedirs(dstdir, exist_ok=True)
    total_src = total_dst = 0
    names = sorted(n for n in os.listdir(srcdir) if n.lower().endswith(".apng"))
    for name in names:
        base = os.path.splitext(name)[0]
        src = os.path.join(srcdir, name)
        n = n_frames_of(src)  # 先数帧，文件名要带帧数
        out = os.path.join(dstdir, f"{base}__s{n}.png")
        n2, sz, bytes_ = convert(src, out, cols, cell)
        total_src += os.path.getsize(src)
        total_dst += bytes_
        print(f"{name:34s} -> {os.path.basename(out):40s} {n2:3d}帧 {sz[0]}x{sz[1]} {bytes_/1024:.0f}KB")
    print(f"\n共 {len(names)} 个；APNG {total_src/1024/1024:.1f}MB → 精灵图 {total_dst/1024/1024:.1f}MB")
    return 0

def n_frames_of(p):
    return getattr(Image.open(p), "n_frames", 1)

if __name__ == "__main__":
    sys.exit(main())

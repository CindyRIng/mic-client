#!/usr/bin/env python3
"""Decode the two Focus/Jigsaw captcha PNGs and locate the puzzle gap (target x)."""
import struct
import zlib
import sys
import numpy as np


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8
    idat = b''
    plte = None
    trns = None
    w = h = bitdepth = colortype = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bitdepth, colortype, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
            assert inter == 0, 'interlaced not supported'
        elif typ == b'PLTE':
            plte = np.frombuffer(chunk, dtype=np.uint8).reshape(-1, 3)
        elif typ == b'tRNS':
            trns = np.frombuffer(chunk, dtype=np.uint8)
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    bpp = max(1, (channels * bitdepth + 7) // 8)
    stride = (w * channels * bitdepth + 7) // 8
    out = np.zeros((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.uint8)
    p = 0
    for y in range(h):
        ft = raw[p]
        p += 1
        line = np.frombuffer(raw[p:p + stride], dtype=np.uint8).copy()
        p += stride
        if ft == 0:
            pass
        elif ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            line = (line.astype(np.int16) + prev.astype(np.int16)).astype(np.uint8)
        elif ft == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((int(left) + int(prev[i])) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = int(line[i - bpp]) if i >= bpp else 0
                b = int(prev[i])
                c = int(prev[i - bpp]) if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y] = line
        prev = line

    if colortype == 3:
        idx = out.reshape(h, w).astype(np.int32)
        rgb = plte[idx]
        alpha = np.full((h, w), 255, dtype=np.uint8)
        if trns is not None:
            alpha = np.where(idx < len(trns), trns[np.clip(idx, 0, len(trns) - 1)], 255).astype(np.uint8)
        return np.dstack([rgb, alpha])
    if colortype == 0:
        v = out.reshape(h, w)
        return np.dstack([v, v, v, np.full_like(v, 255)])
    if colortype == 2:
        return np.dstack([out.reshape(h, w, 3), np.full((h, w), 255, dtype=np.uint8)])
    if colortype == 4:
        v = out.reshape(h, w, 2)
        return np.dstack([v[:, :, 0], v[:, :, 0], v[:, :, 0], v[:, :, 1]])
    return out.reshape(h, w, 4)


def find_offset(bg_path, piece_path, verbose=True):
    bg = read_png(bg_path).astype(np.int32)      # HxWx4 (background, 310 wide)
    jg = read_png(piece_path).astype(np.int32)   # Hx47x4
    H, W = bg.shape[:2]
    ph, pw = jg.shape[:2]
    mask = jg[:, :, 3] > 128
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    best = None
    scores = []
    for x in range(0, W - pw + 1):
        bg_patch = bg[ys, xs + x, :3]
        pc = jg[ys, xs, :3]
        diff = np.abs(bg_patch - pc).mean()
        scores.append((diff, x))
        if best is None or diff < best[0]:
            best = (diff, x)
    scores.sort()
    if verbose:
        print('piece bbox px:', xs.min(), xs.max(), ys.min(), ys.max())
        print('top candidates (mean abs diff, x):', scores[:8])
        print('piece rgb sample:', jg[ys[0], xs[0], :3])
        print('bg rgb at best:', bg[ys[0], xs[0] + best[1], :3])
    return best[1], scores[0][0]


if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else '/home/songqian/mic-client/recon/artifacts/captcha/run1'
    import os
    print(find_offset(os.path.join(base, 'orig0.png'), os.path.join(base, 'jig0.png')))

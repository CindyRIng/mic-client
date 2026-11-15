/**
 * Focus Captcha (vemic FCaptcha 3.0.2, blockPuzzle) offline solving primitives.
 *
 * The browser flow captures the two PNGs served by `POST /captcha/get`, then:
 *  1) decode PNG -> RGBA (no external deps; zlib is built into Node)
 *  2) background luminance -> Sobel gradient edge map
 *  3) jigsaw alpha mask -> boundary pixels
 *  4) scan candidate offsets (x, y); maximize mean edge response under the boundary
 *  5) drag distance (DOM px) = x * domImageWidth / 310  (constant from FCaptcha JS)
 *
 * Reference implementation and evidence: `recon/scripts/captcha-autosolve.mjs`
 * and `docs/research/captcha-autosolve.md`.
 */
import zlib from 'node:zlib';
import { AppError } from '../errors.js';

export const CAPTCHA_SOURCE_IMAGE_WIDTH = 310;

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

export interface CaptchaOffset {
  /** Best matching puzzle gap x in the 310px-wide source image. */
  x: number;
  /** Best matching y (typically 0 for this captcha family). */
  y: number;
  score: number;
  boundaryCount: number;
  imageWidth: number;
  imageHeight: number;
}

function pngError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('CAPTCHA_SOLVE_FAILED', `captcha image decode failed: ${message}`, details);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Minimal PNG decoder for the captcha images: 8-bit depth, color types 0/2/3/4/6,
 * non-interlaced, no gamma corrections. Returns RGBA pixels.
 */
export function decodePng(input: Buffer | Uint8Array): RgbaImage {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || signature.some((b, i) => buf[i] !== b)) throw pngError('bad PNG signature');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const chunk = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? 0;
      interlace = chunk[12] ?? 0;
    } else if (type === 'PLTE') {
      palette = Buffer.from(chunk);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(chunk);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(chunk));
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) throw pngError('missing IHDR');
  if (bitDepth !== 8) throw pngError(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw pngError('interlaced PNG not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw pngError(`unsupported color type ${colorType}`);
  if (colorType === 3 && !palette) throw pngError('palette PNG without PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw pngError('truncated IDAT stream');

  const rows = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++] ?? 0;
    const line = new Uint8Array(stride);
    raw.copy(line, 0, p, p + stride);
    p += stride;
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < stride; i++) line[i] = ((line[i] ?? 0) + (line[i - bpp] ?? 0)) & 0xff;
        break;
      case 2:
        for (let i = 0; i < stride; i++) line[i] = ((line[i] ?? 0) + (prev[i] ?? 0)) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? (line[i - bpp] ?? 0) : 0;
          line[i] = ((line[i] ?? 0) + ((left + (prev[i] ?? 0)) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? (line[i - bpp] ?? 0) : 0;
          const b = prev[i] ?? 0;
          const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
          line[i] = ((line[i] ?? 0) + paeth(a, b, c)) & 0xff;
        }
        break;
      default:
        throw pngError(`unsupported PNG filter ${filter}`);
    }
    rows.set(line, y * stride);
    prev = line;
  }

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * stride + x * bpp;
      const dst = (y * width + x) * 4;
      if (colorType === 0) {
        const v = rows[src] ?? 0;
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
        out[dst + 3] = 255;
      } else if (colorType === 2) {
        out[dst] = rows[src] ?? 0;
        out[dst + 1] = rows[src + 1] ?? 0;
        out[dst + 2] = rows[src + 2] ?? 0;
        out[dst + 3] = 255;
      } else if (colorType === 3) {
        const idx = rows[src] ?? 0;
        const pal = palette as Buffer;
        out[dst] = pal[idx * 3] ?? 0;
        out[dst + 1] = pal[idx * 3 + 1] ?? 0;
        out[dst + 2] = pal[idx * 3 + 2] ?? 0;
        out[dst + 3] = transparency && idx < transparency.length ? (transparency[idx] ?? 255) : 255;
      } else if (colorType === 4) {
        const v = rows[src] ?? 0;
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
        out[dst + 3] = rows[src + 1] ?? 255;
      } else {
        out[dst] = rows[src] ?? 0;
        out[dst + 1] = rows[src + 1] ?? 0;
        out[dst + 2] = rows[src + 2] ?? 0;
        out[dst + 3] = rows[src + 3] ?? 255;
      }
    }
  }
  return { width, height, data: out };
}

/** Sobel-like gradient magnitude of luminance (interior pixels; borders stay 0). */
export function edgeMap(image: RgbaImage): Float32Array {
  const { width: w, height: h, data } = image;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (data[i * 4] ?? 0) * 0.299 + (data[i * 4 + 1] ?? 0) * 0.587 + (data[i * 4 + 2] ?? 0) * 0.114;
  }
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (lum[i + 1] ?? 0) - (lum[i - 1] ?? 0);
      const gy = (lum[i + w] ?? 0) - (lum[i - w] ?? 0);
      edge[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return edge;
}

/** Boundary pixels of the opaque piece (alpha > 128, not fully surrounded in 4-neighborhood). */
export function pieceBoundary(piece: RgbaImage): Array<[number, number]> {
  const { width: w, height: h, data } = piece;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = (data[i * 4 + 3] ?? 0) > 128 ? 1 : 0;
  const points: Array<[number, number]> = [];
  const isMask = (x: number, y: number): boolean => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isMask(x, y)) continue;
      const enclosed = isMask(x - 1, y) && isMask(x + 1, y) && isMask(x, y - 1) && isMask(x, y + 1);
      if (!enclosed) points.push([x, y]);
    }
  }
  return points;
}

/**
 * Find the puzzle gap by maximizing the mean edge response under the piece boundary.
 * Deterministic: scans y then x ascending and keeps the first best score.
 */
export function computeCaptchaOffset(background: RgbaImage, piece: RgbaImage): CaptchaOffset {
  const edge = edgeMap(background);
  const boundary = pieceBoundary(piece);
  if (boundary.length === 0) {
    throw new AppError('CAPTCHA_SOLVE_FAILED', 'captcha piece has no opaque pixels', {
      piece_width: piece.width,
      piece_height: piece.height,
    });
  }
  const maxY = background.height - piece.height;
  const maxX = background.width - piece.width;
  let bestScore = -1;
  let bestX = -1;
  let bestY = -1;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      let sum = 0;
      for (const [px, py] of boundary) sum += edge[(py + y) * background.width + (px + x)] ?? 0;
      const score = sum / boundary.length;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }
  return {
    x: bestX,
    y: bestY,
    score: bestScore,
    boundaryCount: boundary.length,
    imageWidth: background.width,
    imageHeight: background.height,
  };
}

/** FCaptcha drag distance: `domDelta = x * domImageWidth / 310`. */
export function offsetToDragDistance(offsetX: number, domImageWidth: number, sourceWidth = CAPTCHA_SOURCE_IMAGE_WIDTH): number {
  if (!Number.isFinite(domImageWidth) || domImageWidth <= 0) throw pngError('invalid DOM image width', { domImageWidth });
  return (offsetX * domImageWidth) / sourceWidth;
}

/** Offline convenience: decode two PNGs and return the best offset. */
export function solveCaptchaFromPngs(backgroundPng: Buffer | Uint8Array, piecePng: Buffer | Uint8Array): CaptchaOffset {
  return computeCaptchaOffset(decodePng(backgroundPng), decodePng(piecePng));
}

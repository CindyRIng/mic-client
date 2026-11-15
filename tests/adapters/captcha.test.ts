import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import {
  computeCaptchaOffset,
  decodePng,
  edgeMap,
  offsetToDragDistance,
  pieceBoundary,
  solveCaptchaFromPngs,
} from '../../src/core/session/captcha.js';

const RUN1 = path.resolve('recon/artifacts/captcha/run1');
const ORIG = fs.readFileSync(path.join(RUN1, 'orig0.png'));
const JIG = fs.readFileSync(path.join(RUN1, 'jig0.png'));

describe('Focus Captcha offline algorithm (recon/artifacts/captcha/run1)', () => {
  it('decodes the background PNG (310x155, palette color type)', () => {
    const image = decodePng(ORIG);
    expect(image.width).toBe(310);
    expect(image.height).toBe(155);
    expect(image.data.length).toBe(310 * 155 * 4);
    // palette expansion: opaque pixels
    expect(image.data[3]).toBeGreaterThan(0);
  });

  it('decodes the jigsaw PNG (47x155, alpha channel)', () => {
    const piece = decodePng(JIG);
    expect(piece.width).toBe(47);
    expect(piece.height).toBe(155);
    const opaque = pieceBoundary(piece);
    expect(opaque.length).toBeGreaterThan(50);
  });

  it('matches the saved run1 offset (documented expectation x≈100)', () => {
    const bg = decodePng(ORIG);
    const jig = decodePng(JIG);
    expect(edgeMap(bg).length).toBe(bg.width * bg.height);
    const offset = computeCaptchaOffset(bg, jig);
    expect(offset.y).toBe(0);
    // run1 target x is 99 (docs mention x≈100 for this sample)
    expect(offset.x).toBeGreaterThanOrEqual(95);
    expect(offset.x).toBeLessThanOrEqual(103);
    expect(offset.boundaryCount).toBeGreaterThan(50);
    expect(offset.score).toBeGreaterThan(0);
    expect(solveCaptchaFromPngs(ORIG, JIG).x).toBe(offset.x);
  });

  it('converts source-image x to the DOM drag distance (310 * domX / imgWidth inverse)', () => {
    expect(offsetToDragDistance(99, 280)).toBeCloseTo((99 * 280) / 310, 5);
    expect(offsetToDragDistance(0, 280)).toBe(0);
    expect(() => offsetToDragDistance(10, 0)).toThrowError(AppError);
  });

  it('rejects non-PNG input with CAPTCHA_SOLVE_FAILED', () => {
    try {
      decodePng(Buffer.from('not a png'));
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('CAPTCHA_SOLVE_FAILED');
    }
  });
});

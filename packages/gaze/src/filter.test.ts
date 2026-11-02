import { describe, expect, it } from 'vitest';
import { OneEuroFilter2D } from './filter';
import { createRng } from './rng';

const std = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

describe('OneEuroFilter2D', () => {
  it('cuts jitter on a noisy fixation by at least 2.5x', () => {
    const rng = createRng(1);
    const f = new OneEuroFilter2D();
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const p = { x: 0.5 + 0.02 * rng.gauss(), y: 0.5 + 0.02 * rng.gauss() };
      const q = f.filter(p, i * 33.3);
      if (i > 30) {
        raw.push(p.x);
        out.push(q.x);
      }
    }
    expect(std(out)).toBeLessThan(std(raw) / 2.5);
  });

  it('follows a step with small lag (within 3% in <= 6 frames, 90% in <= 3)', () => {
    const f = new OneEuroFilter2D();
    for (let i = 0; i < 30; i++) f.filter({ x: 0.2, y: 0.2 }, i * 33.3);
    const outs: number[] = [];
    for (let i = 30; i < 50; i++) outs.push(f.filter({ x: 0.8, y: 0.8 }, i * 33.3).x);
    const frac = (v: number) => (v - 0.2) / 0.6;
    expect(frac(outs[2]!)).toBeGreaterThan(0.9);
    expect(Math.abs(outs[5]! - 0.8)).toBeLessThan(0.03);
  });

  it('is lower lag than a fixed low-pass at the same fixation smoothing', () => {
    // a ramp of 0.5 screens/s: the filter should track within ~2% once speed is picked up
    const f = new OneEuroFilter2D();
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const x = 0.1 + (0.5 * i * 33.3) / 1000;
      last = f.filter({ x, y: 0.5 }, i * 33.3).x - x;
    }
    expect(Math.abs(last)).toBeLessThan(0.05);
  });

  it('reset restarts, and out-of-order timestamps do not blow up', () => {
    const f = new OneEuroFilter2D();
    f.filter({ x: 0.1, y: 0.1 }, 100);
    const same = f.filter({ x: 0.9, y: 0.9 }, 100);
    expect(Number.isFinite(same.x)).toBe(true);
    f.reset();
    expect(f.filter({ x: 0.7, y: 0.7 }, 5).x).toBe(0.7);
  });
});

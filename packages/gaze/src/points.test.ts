import { describe, expect, it } from 'vitest';
import { calibrationPoints } from './points';

describe('calibrationPoints', () => {
  it.each([5, 9, 16] as const)('returns %i distinct points inset from the edges', (n) => {
    const p = calibrationPoints(n);
    expect(p.length).toBe(n);
    for (const q of p) {
      expect(q.x).toBeGreaterThanOrEqual(0.05);
      expect(q.x).toBeLessThanOrEqual(0.95);
      expect(q.y).toBeGreaterThanOrEqual(0.05);
      expect(q.y).toBeLessThanOrEqual(0.95);
    }
    expect(new Set(p.map((q) => `${q.x},${q.y}`)).size).toBe(n);
  });

  it('9-point grid is a snake: neighbors are one grid step apart, starts top-left', () => {
    const p = calibrationPoints(9);
    expect(p[0]).toEqual({ x: 0.08, y: 0.08 });
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
      expect(d).toBeLessThan(0.43);
    }
    expect(p[3]!.x).toBeCloseTo(0.92); // second row runs right to left
    expect(p[5]!.x).toBeCloseTo(0.08);
    expect(p[8]!.x).toBeCloseTo(0.92);
    expect(p[8]!.y).toBeCloseTo(0.92);
  });

  it('5-point: four corners clockwise then center', () => {
    const p = calibrationPoints(5);
    expect(p[4]).toEqual({ x: 0.5, y: 0.5 });
    expect(p[0]!.x).toBeLessThan(p[1]!.x);
    expect(p[1]!.y).toBeLessThan(p[2]!.y);
  });
});

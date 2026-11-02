import { describe, expect, it } from 'vitest';
import { DwellDetector } from './dwell';
import { GazeCalibration } from './calibration';
import { GazeTracker } from './tracker';
import { calibrationPoints } from './points';
import { simulateGaze } from './sim';

describe('DwellDetector', () => {
  it('fires once after dwellMs inside radiusPx, then not again until it leaves', () => {
    const d = new DwellDetector({ radiusPx: 40, dwellMs: 600 });
    const fired: number[] = [];
    let lastProgress = 0;
    for (let t = 0; t <= 1500; t += 33) {
      const r = d.update({ x: 500 + 10 * Math.sin(t / 50), y: 400 }, t);
      if (r.fired) fired.push(t);
      lastProgress = r.progress;
    }
    expect(fired.length).toBe(1);
    expect(fired[0]!).toBeGreaterThanOrEqual(600);
    expect(fired[0]!).toBeLessThan(700);
    expect(lastProgress).toBe(1);
  });

  it('progress rises monotonically and resets when leaving the radius', () => {
    const d = new DwellDetector({ radiusPx: 40, dwellMs: 1000 });
    let p = 0;
    for (let t = 0; t <= 500; t += 33) {
      const r = d.update({ x: 100, y: 100 }, t);
      expect(r.progress).toBeGreaterThanOrEqual(p);
      p = r.progress;
    }
    expect(p).toBeGreaterThan(0.4);
    const away = d.update({ x: 300, y: 100 }, 533);
    expect(away.progress).toBe(0);
    expect(away.fired).toBe(false);
    expect(away.center).toEqual({ x: 300, y: 100 });
    // after moving it can fire again at the new spot
    let fired = false;
    for (let t = 566; t <= 1700; t += 33) fired ||= d.update({ x: 300, y: 100 }, t).fired;
    expect(fired).toBe(true);
  });

  it('never fires for a moving point', () => {
    const d = new DwellDetector({ radiusPx: 40, dwellMs: 500 });
    let fired = false;
    for (let t = 0; t < 3000; t += 33) fired ||= d.update({ x: t * 0.5, y: 100 }, t).fired;
    expect(fired).toBe(false);
  });
});

describe('GazeTracker', () => {
  it('returns null point before calibration, smoothed points after, and freezes during a blink', () => {
    const screen = { width: 1920, height: 1080 };
    const pts = calibrationPoints(9);
    const cal = simulateGaze(pts, { msPerPoint: 1500, seed: 2 });
    const calib = new GazeCalibration();
    cal.frames.forEach((f, i) => { if (f.tsMs % 1500 > 500) calib.addSample(f, cal.targets[i]!); });
    const tracker = new GazeTracker(calib, screen);
    const before = tracker.update(cal.frames[0]!);
    expect(before.point).toBeNull();
    expect(calib.fit(screen).ok).toBe(true);

    const run = simulateGaze([{ x: 0.5, y: 0.5 }], { msPerPoint: 3000, seed: 9, script: [{ atMs: 2000, kind: 'winkLeft', durationMs: 300 }] });
    let heldFrames = 0;
    let moved = 0;
    let prev: { x: number; y: number } | null = null;
    let mid: { x: number; y: number } | null = null;
    for (const f of run.frames) {
      const r = tracker.update(f);
      if (f.tsMs > 1000 && f.tsMs < 1900) mid = r.point;
      if (r.held) {
        heldFrames++;
        expect(r.dwell.fired).toBe(false);
        if (prev && r.point) moved += Math.hypot(r.point.x - prev.x, r.point.y - prev.y);
      }
      prev = r.point;
    }
    expect(heldFrames).toBeGreaterThan(5);
    expect(moved).toBeLessThan(0.05);
    expect(mid!.x).toBeGreaterThan(0.35);
    expect(mid!.x).toBeLessThan(0.65);
    const recent = tracker.recentPoint(500);
    expect(recent).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { GestureDetector } from './gestures';
import { simulateGaze, simulateGazeFrames } from './sim';

describe('simulateGazeFrames', () => {
  it('is deterministic per seed, time-ordered, 30 fps, and covers the path', () => {
    const path = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }];
    const a = simulateGazeFrames(path, { seed: 3, msPerPoint: 1000 });
    const b = simulateGazeFrames(path, { seed: 3, msPerPoint: 1000 });
    const c = simulateGazeFrames(path, { seed: 4, msPerPoint: 1000 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThanOrEqual(59);
    expect(a.length).toBeLessThanOrEqual(61);
    for (let i = 1; i < a.length; i++) expect(a[i]!.tsMs).toBeGreaterThan(a[i - 1]!.tsMs);
    const { targets } = simulateGaze(path, { seed: 3, msPerPoint: 1000 });
    expect(targets[targets.length - 1]!.x).toBeCloseTo(0.9, 2);
  });

  it('scripted wink triggers the gesture detector; natural blinks do not', () => {
    const frames = simulateGazeFrames([{ x: 0.5, y: 0.5 }], { msPerPoint: 6000, seed: 1, naturalBlinkEveryMs: 1200, script: [{ atMs: 3000, kind: 'winkRight', durationMs: 300 }] });
    const det = new GestureDetector();
    const ev = frames.flatMap((f) => det.update(f));
    expect(ev.map((e) => e.type)).toEqual(['wink_right']);
  });

  it('mouth and brows scripts produce events', () => {
    const frames = simulateGazeFrames([{ x: 0.5, y: 0.5 }], { msPerPoint: 4000, seed: 1, script: [{ atMs: 500, kind: 'mouthOpen' }, { atMs: 2200, kind: 'browsUp' }] });
    const det = new GestureDetector();
    const types = frames.flatMap((f) => det.update(f)).map((e) => e.type);
    expect(types).toContain('mouth_open_start');
    expect(types).toContain('mouth_open_end');
    expect(types).toContain('brows_up');
  });
});

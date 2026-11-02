import { FEATURE_COUNT } from './features';
import type { GazeFrame } from './types';

/** Test helper: a neutral frame with overrides. */
export function mkFrame(tsMs: number, o: Partial<Omit<GazeFrame, 'tsMs'>> = {}): GazeFrame {
  return {
    tsMs,
    features: new Array<number>(FEATURE_COUNT).fill(0),
    blinkLeft: 0,
    blinkRight: 0,
    jawOpen: 0,
    browUp: 0,
    head: { yaw: 0, pitch: 0, roll: 0 },
    faceBox: { cx: 0.5, cy: 0.5, size: 0.3 },
    ...o,
  };
}

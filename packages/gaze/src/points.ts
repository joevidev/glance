import type { Vec2 } from './types';

const LO = 0.08;
const HI = 0.92;

/**
 * Normalized calibration targets, inset 8% from every edge (users cannot hold a gaze on the very edge and
 * the webcam sees extreme angles poorly). 9 and 16 are grids visited in a snake (boustrophedon) order so
 * consecutive dots are neighbors; 5 is the four corners clockwise then the center.
 */
export function calibrationPoints(n: 9 | 16 | 5): Vec2[] {
  if (n === 5) {
    return [{ x: LO, y: LO }, { x: HI, y: LO }, { x: HI, y: HI }, { x: LO, y: HI }, { x: 0.5, y: 0.5 }];
  }
  const k = n === 9 ? 3 : 4;
  const vals = Array.from({ length: k }, (_, i) => LO + ((HI - LO) * i) / (k - 1));
  const out: Vec2[] = [];
  for (let r = 0; r < k; r++) {
    const row = vals.map((x) => ({ x, y: vals[r]! }));
    out.push(...(r % 2 === 0 ? row : row.reverse()));
  }
  return out;
}

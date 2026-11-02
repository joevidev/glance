import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_NAMES, frameFromResult } from './features';
import type { LandmarkerResultLike } from './types';

/** Build a fake 478-point mesh: a straight frontal face with symmetric eyes, iris offset (dx,dy) in eye widths. */
function fakeMesh(irisDx = 0, irisDy = 0, scale = 1, cx = 0.5, cy = 0.5) {
  const lm = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  const set = (i: number, x: number, y: number) => (lm[i] = { x: cx + x * scale, y: cy + y * scale, z: 0 });
  const w = 0.06; // eye width in normalized units (at aspect 1)
  // eye A (user's right, image-left): corners 33 (outer, left) and 133 (inner, right) centered at x=-0.1
  set(33, -0.1 - w / 2, 0); set(133, -0.1 + w / 2, 0);
  set(159, -0.1, -0.012); set(145, -0.1, 0.012);
  set(468, -0.1 + irisDx * w, irisDy * w);
  // eye B (user's left, image-right): 362 (inner, left) and 263 (outer, right) centered at x=+0.1
  set(362, 0.1 - w / 2, 0); set(263, 0.1 + w / 2, 0);
  set(386, 0.1, -0.012); set(374, 0.1, 0.012);
  set(473, 0.1 + irisDx * w, irisDy * w);
  set(1, 0, 0.08); set(152, 0, 0.25); set(10, 0, -0.2);
  return lm;
}
const rotY = (th: number) => [Math.cos(th), 0, -Math.sin(th), 0, 0, 1, 0, 0, Math.sin(th), 0, Math.cos(th), 0, 0, 0, 0, 1];
const rotX = (ph: number) => [1, 0, 0, 0, 0, Math.cos(ph), Math.sin(ph), 0, 0, -Math.sin(ph), Math.cos(ph), 0, 0, 0, 0, 1];
const idx = (n: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(n);

describe('frameFromResult', () => {
  it('returns null with no face, or without iris landmarks', () => {
    expect(frameFromResult({ faceLandmarks: [] }, 0)).toBeNull();
    expect(frameFromResult({ faceLandmarks: [fakeMesh().slice(0, 468)] }, 0)).toBeNull();
  });

  it('computes eye-axis-normalized iris offsets, face box, blendshapes and head pose', () => {
    const r: LandmarkerResultLike = {
      faceLandmarks: [fakeMesh(0.1, 0.05)],
      faceBlendshapes: [{ categories: [
        { categoryName: 'eyeBlinkLeft', score: 0.8 }, { categoryName: 'eyeBlinkRight', score: 0.1 },
        { categoryName: 'jawOpen', score: 0.4 }, { categoryName: 'browInnerUp', score: 0.2 },
        { categoryName: 'browOuterUpLeft', score: 0.6 }, { categoryName: 'browOuterUpRight', score: 0.8 },
        { categoryName: 'cheekPuff', score: 1 },
      ] }],
      facialTransformationMatrixes: [{ data: new Float32Array(rotY(0.3)) }],
    };
    const f = frameFromResult(r, 1234, { aspect: 1 })!;
    expect(f.tsMs).toBe(1234);
    expect(f.features.length).toBe(FEATURE_COUNT);
    expect(f.features.every(Number.isFinite)).toBe(true);
    expect(f.features[idx('gx')]).toBeCloseTo(0.1, 5);
    expect(f.features[idx('gy')]).toBeCloseTo(0.05, 5);
    expect(f.features[idx('ixA')]).toBeCloseTo(0.1, 5);
    expect(f.features[idx('ixB')]).toBeCloseTo(0.1, 5);
    expect(f.features[idx('open')]).toBeCloseTo(0.024 / 0.06, 5);
    expect(f.blinkLeft).toBeCloseTo(0.8);
    expect(f.blinkRight).toBeCloseTo(0.1);
    expect(f.jawOpen).toBeCloseTo(0.4);
    expect(f.browUp).toBeCloseTo(0.7); // max(inner 0.2, mean outer 0.7)
    expect(f.head.yaw).toBeCloseTo(0.3, 5);
    expect(f.head.pitch).toBeCloseTo(0, 5);
    expect(f.faceBox.cx).toBeCloseTo(0.5, 1);
    expect(f.faceBox.size).toBeGreaterThan(0.1);
  });

  it('iris offset is invariant to head roll in the image plane', () => {
    const base = fakeMesh(0.12, 0.04);
    const th = 0.4;
    const rolled = base.map((p) => {
      const x = p.x - 0.5, y = p.y - 0.5;
      return { x: 0.5 + x * Math.cos(th) - y * Math.sin(th), y: 0.5 + x * Math.sin(th) + y * Math.cos(th), z: 0 };
    });
    const a = frameFromResult({ faceLandmarks: [base] }, 0, { aspect: 1 })!;
    const b = frameFromResult({ faceLandmarks: [rolled] }, 0, { aspect: 1 })!;
    expect(b.features[idx('gx')]).toBeCloseTo(a.features[idx('gx')]!, 4);
    expect(b.features[idx('gy')]).toBeCloseTo(a.features[idx('gy')]!, 4);
    expect(b.head.roll).toBeCloseTo(th, 2); // fallback pose from the eye line
  });

  it('is scale-invariant (distance to camera) for iris offsets, and pitch sign: + = looking down', () => {
    const near = frameFromResult({ faceLandmarks: [fakeMesh(0.1, 0, 1.5)] }, 0, { aspect: 1 })!;
    const far = frameFromResult({ faceLandmarks: [fakeMesh(0.1, 0, 0.7)] }, 0, { aspect: 1 })!;
    expect(near.features[idx('gx')]).toBeCloseTo(far.features[idx('gx')]!, 5);
    expect(near.features[idx('size')]!).toBeGreaterThan(far.features[idx('size')]!);
    const down = frameFromResult({ faceLandmarks: [fakeMesh()], facialTransformationMatrixes: [{ data: rotX(0.25) }] }, 0)!;
    expect(down.head.pitch).toBeCloseTo(0.25, 5);
  });

  it('looking right (iris toward image right) gives positive gx', () => {
    const f = frameFromResult({ faceLandmarks: [fakeMesh(0.15, 0)] }, 0, { aspect: 1 })!;
    expect(f.features[idx('gx')]!).toBeGreaterThan(0.1);
    const l = frameFromResult({ faceLandmarks: [fakeMesh(-0.15, 0)] }, 0, { aspect: 1 })!;
    expect(l.features[idx('gx')]!).toBeLessThan(-0.1);
  });
});

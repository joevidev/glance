import type { LandmarkerResultLike } from './types';

export type FaceLandmarkerHandle = {
  detect(video: HTMLVideoElement, tsMs: number): LandmarkerResultLike;
  close(): void;
};

/**
 * Wrap MediaPipe FilesetResolver + FaceLandmarker (VIDEO mode, blendshapes + transformation matrixes,
 * 1 face). Tries the GPU delegate first and falls back to CPU. `@mediapipe/tasks-vision` is imported
 * lazily so Node-side tests never load it.
 *
 * wasmRoot: URL/path of the directory holding vision_wasm_internal.{js,wasm} (copy
 *           node_modules/@mediapipe/tasks-vision/wasm into the app's static assets).
 * modelUrl: URL/path of face_landmarker.task.
 */
export async function createFaceLandmarker(opts: { wasmRoot: string; modelUrl: string }): Promise<FaceLandmarkerHandle> {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmRoot);
  const make = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.modelUrl, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  let lm;
  try {
    lm = await make('GPU');
  } catch {
    lm = await make('CPU');
  }
  const landmarker = lm;
  let lastTs = -1;
  return {
    detect(video, tsMs) {
      // MediaPipe requires strictly increasing timestamps in VIDEO mode.
      const ts = tsMs > lastTs ? tsMs : lastTs + 1;
      lastTs = ts;
      try {
        return landmarker.detectForVideo(video, ts) as unknown as LandmarkerResultLike;
      } catch {
        return { faceLandmarks: [] };
      }
    },
    close() {
      landmarker.close();
    },
  };
}

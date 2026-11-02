export type Vec2 = { x: number; y: number };

/** One processed camera frame. See features.ts for the feature vector layout. */
export type GazeFrame = {
  tsMs: number;
  features: number[];
  /** 0..1, MediaPipe eyeBlinkLeft / eyeBlinkRight (the USER's left / right eye). */
  blinkLeft: number;
  blinkRight: number;
  /** 0..1, jawOpen and brow raise (max of browInnerUp and mean browOuterUp L/R). */
  jawOpen: number;
  browUp: number;
  /** Radians. yaw + = nose toward image right, pitch + = looking DOWN, roll + = clockwise in the image. */
  head: { yaw: number; pitch: number; roll: number };
  /** Normalized 0..1 face bounding box center and size (larger side). */
  faceBox: { cx: number; cy: number; size: number };
};

/** Structural subset of @mediapipe/tasks-vision FaceLandmarkerResult. */
export interface LandmarkerResultLike {
  faceLandmarks: { x: number; y: number; z: number }[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { data: number[] | Float32Array }[];
}

export type ScreenSize = { width: number; height: number };

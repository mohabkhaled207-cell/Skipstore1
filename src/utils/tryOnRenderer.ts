import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  ArmSegment,
  GarmentPlacement,
  POSE_IDX,
  PosePoint,
  ResolvedTryOnCategory,
  computeArmOcclusionCorridors,
  computeGarmentPlacement,
  shouldHideOnTrackingLoss,
  smoothLandmarks,
} from './tryOn';
import { TryOnConfig } from './store';

export function isWebGLSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

export function isWasmSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

export async function createLocalPoseLandmarker(
  delegate: 'GPU' | 'CPU',
  enableSegmentation: boolean
): Promise<PoseLandmarker> {
  if (!isWasmSupported()) {
    const err = new Error('WASM not supported');
    err.name = 'WebGLUnsupportedError';
    throw err;
  }

  const vision = await import('@mediapipe/tasks-vision');
  const wasmFileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');

  const buildOptions = (targetDelegate: 'GPU' | 'CPU', withSeg: boolean) => ({
    baseOptions: {
      modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task',
      delegate: targetDelegate,
    },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    outputSegmentationMasks: withSeg,
  });

  try {
    return await vision.PoseLandmarker.createFromOptions(wasmFileset, buildOptions(delegate, enableSegmentation));
  } catch (gpuErr) {
    if (delegate === 'GPU') {
      try {
        return await vision.PoseLandmarker.createFromOptions(wasmFileset, buildOptions('CPU', enableSegmentation));
      } catch {
        throw gpuErr;
      }
    }
    throw gpuErr;
  }
}

export interface TryOnFrameState {
  smoothedLandmarks: PosePoint[] | null;
  smoothedWorldLandmarks: PosePoint[] | null;
  missedFrames: number;
  lastInferenceAt: number;
  lastFpsSampleAt: number;
  renderedFramesSinceSample: number;
  fps: number;
  poseDetected: boolean;
  garmentVisible: boolean;
}

export function createInitialFrameState(): TryOnFrameState {
  return {
    smoothedLandmarks: null,
    smoothedWorldLandmarks: null,
    missedFrames: 0,
    lastInferenceAt: 0,
    lastFpsSampleAt: performance.now(),
    renderedFramesSinceSample: 0,
    fps: 0,
    poseDetected: false,
    garmentVisible: false,
  };
}

export interface RenderFrameParams {
  video: HTMLVideoElement;
  displayCanvas: HTMLCanvasElement;
  inferenceCanvas: HTMLCanvasElement;
  occlusionCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  landmarker: PoseLandmarker | null;
  garmentImage: HTMLImageElement | null;
  category: ResolvedTryOnCategory;
  config: TryOnConfig;
  mirrored: boolean;
  inferenceIntervalMs: number;
  inferenceWidth: number;
  inferenceHeight: number;
  enableArmOcclusion: boolean;
  frameState: TryOnFrameState;
  nowMs: number;
}

/**
 * Processes one live video frame completely inside local browser memory.
 * Zero network calls, zero persistent storage writes.
 */
export function renderTryOnFrame(params: RenderFrameParams): {
  poseDetected: boolean;
  garmentVisible: boolean;
  fpsUpdated: number | null;
} {
  const {
    video,
    displayCanvas,
    inferenceCanvas,
    occlusionCanvas,
    maskCanvas,
    landmarker,
    garmentImage,
    category,
    config,
    mirrored,
    inferenceIntervalMs,
    inferenceWidth,
    inferenceHeight,
    enableArmOcclusion,
    frameState,
    nowMs,
  } = params;

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  if (displayCanvas.width !== vw || displayCanvas.height !== vh) {
    displayCanvas.width = vw;
    displayCanvas.height = vh;
  }

  const ctx = displayCanvas.getContext('2d', { alpha: false });
  if (!ctx) {
    return { poseDetected: false, garmentVisible: false, fpsUpdated: null };
  }

  // 1. Draw live video frame (mirrored for front selfie camera)
  ctx.save();
  if (mirrored) {
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();

  // 2. Run MediaPipe Pose Landmarker at adaptive interval
  let segMaskFloat: Float32Array | null = null;
  let segMaskWidth = 0;
  let segMaskHeight = 0;
  let activeResult: PoseLandmarkerResult | null = null;

  if (landmarker && nowMs - frameState.lastInferenceAt >= inferenceIntervalMs) {
    frameState.lastInferenceAt = nowMs;

    if (inferenceCanvas.width !== inferenceWidth || inferenceCanvas.height !== inferenceHeight) {
      inferenceCanvas.width = inferenceWidth;
      inferenceCanvas.height = inferenceHeight;
    }
    const infCtx = inferenceCanvas.getContext('2d', { willReadFrequently: false });
    if (infCtx) {
      infCtx.drawImage(video, 0, 0, inferenceWidth, inferenceHeight);
      try {
        activeResult = landmarker.detectForVideo(inferenceCanvas, nowMs);
        if (activeResult.landmarks && activeResult.landmarks.length > 0) {
          frameState.smoothedLandmarks = smoothLandmarks(
            frameState.smoothedLandmarks,
            activeResult.landmarks[0],
            0.44
          );
          if (activeResult.worldLandmarks && activeResult.worldLandmarks.length > 0) {
            frameState.smoothedWorldLandmarks = smoothLandmarks(
              frameState.smoothedWorldLandmarks,
              activeResult.worldLandmarks[0],
              0.38
            );
          }
          frameState.missedFrames = 0;
          frameState.poseDetected = true;

          if (
            enableArmOcclusion &&
            config.armOcclusion &&
            activeResult.segmentationMasks &&
            activeResult.segmentationMasks.length > 0
          ) {
            const mask = activeResult.segmentationMasks[0];
            segMaskWidth = mask.width;
            segMaskHeight = mask.height;
            if (mask.hasFloat32Array()) {
              segMaskFloat = mask.getAsFloat32Array();
            }
          }
        } else {
          frameState.missedFrames += 1;
          if (shouldHideOnTrackingLoss(frameState.missedFrames, 4)) {
            frameState.poseDetected = false;
            frameState.smoothedLandmarks = null;
            frameState.smoothedWorldLandmarks = null;
          }
        }
      } catch {
        frameState.missedFrames += 1;
      }
    }
  }

  // 3. Fit & render garment layer when body pose is tracked
  let placement: GarmentPlacement | null = null;
  if (frameState.poseDetected && frameState.smoothedLandmarks && garmentImage && garmentImage.naturalWidth > 0) {
    const aspect = garmentImage.naturalWidth / Math.max(1, garmentImage.naturalHeight);
    placement = computeGarmentPlacement(
      frameState.smoothedLandmarks,
      { width: vw, height: vh },
      aspect,
      category,
      config,
      mirrored,
      frameState.smoothedWorldLandmarks
    );

    if (placement.visible) {
      ctx.save();
      ctx.translate(placement.centerX, placement.centerY);
      ctx.rotate(placement.rotationRad);
      ctx.transform(placement.yawScaleX, 0, placement.skewX, 1, 0, 0);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.drawImage(
        garmentImage,
        -placement.width / 2,
        -placement.height / 2,
        placement.width,
        placement.height
      );
      ctx.restore();
      frameState.garmentVisible = true;

      // 4. Forearm / hand occlusion when arms cross in front of torso
      if (
        enableArmOcclusion &&
        config.armOcclusion &&
        segMaskFloat &&
        segMaskWidth > 0 &&
        segMaskHeight > 0
      ) {
        const lS = frameState.smoothedLandmarks[POSE_IDX.LEFT_SHOULDER];
        const rS = frameState.smoothedLandmarks[POSE_IDX.RIGHT_SHOULDER];
        const shoulderDistPx = Math.hypot((lS.x - rS.x) * vw, (lS.y - rS.y) * vh);
        const armSegments = computeArmOcclusionCorridors(
          frameState.smoothedLandmarks,
          { width: vw, height: vh },
          mirrored,
          shoulderDistPx
        );
        const frontArms = armSegments.filter((a) => a.inFrontOfTorso);
        if (frontArms.length > 0) {
          compositeFrontArms(
            ctx,
            video,
            occlusionCanvas,
            maskCanvas,
            segMaskFloat,
            segMaskWidth,
            segMaskHeight,
            frontArms,
            vw,
            vh,
            mirrored
          );
        }
      }
    } else {
      frameState.garmentVisible = false;
    }
  } else {
    frameState.garmentVisible = false;
  }

  if (activeResult) {
    try {
      activeResult.close();
    } catch {}
  }

  // FPS counter sampling every 1s
  frameState.renderedFramesSinceSample += 1;
  let fpsUpdated: number | null = null;
  if (nowMs - frameState.lastFpsSampleAt >= 1000) {
    const elapsed = (nowMs - frameState.lastFpsSampleAt) / 1000;
    frameState.fps = Math.round(frameState.renderedFramesSinceSample / Math.max(0.1, elapsed));
    frameState.renderedFramesSinceSample = 0;
    frameState.lastFpsSampleAt = nowMs;
    fpsUpdated = frameState.fps;
  }

  return {
    poseDetected: frameState.poseDetected,
    garmentVisible: frameState.garmentVisible,
    fpsUpdated,
  };
}

function compositeFrontArms(
  displayCtx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  occlusionCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  segMaskFloat: Float32Array,
  maskW: number,
  maskH: number,
  frontArms: ArmSegment[],
  vw: number,
  vh: number,
  mirrored: boolean
) {
  if (maskCanvas.width !== maskW || maskCanvas.height !== maskH) {
    maskCanvas.width = maskW;
    maskCanvas.height = maskH;
  }
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const imgData = maskCtx.createImageData(maskW, maskH);
  const data = imgData.data;
  const len = Math.min(segMaskFloat.length, maskW * maskH);
  for (let i = 0; i < len; i++) {
    const confidence = segMaskFloat[i];
    const alpha = confidence > 0.55 ? Math.min(255, Math.round((confidence - 0.55) * 2.2 * 255)) : 0;
    const idx = i * 4;
    data[idx] = 255;
    data[idx + 1] = 255;
    data[idx + 2] = 255;
    data[idx + 3] = alpha;
  }
  maskCtx.putImageData(imgData, 0, 0);

  if (occlusionCanvas.width !== vw || occlusionCanvas.height !== vh) {
    occlusionCanvas.width = vw;
    occlusionCanvas.height = vh;
  }
  const occCtx = occlusionCanvas.getContext('2d');
  if (!occCtx) return;

  occCtx.clearRect(0, 0, vw, vh);
  occCtx.save();
  // Draw forearm corridor capsules first
  occCtx.lineCap = 'round';
  occCtx.strokeStyle = '#ffffff';
  for (const arm of frontArms) {
    occCtx.lineWidth = arm.thicknessPx;
    occCtx.beginPath();
    occCtx.moveTo(arm.elbowX, arm.elbowY);
    occCtx.lineTo(arm.wristX, arm.wristY);
    occCtx.stroke();
  }

  // Intersect forearm corridors with person segmentation mask
  occCtx.globalCompositeOperation = 'source-in';
  occCtx.save();
  if (mirrored) {
    occCtx.translate(vw, 0);
    occCtx.scale(-1, 1);
  }
  occCtx.drawImage(maskCanvas, 0, 0, vw, vh);

  // Fill intersected arm region with live camera pixels
  occCtx.globalCompositeOperation = 'source-in';
  occCtx.drawImage(video, 0, 0, vw, vh);
  occCtx.restore();
  occCtx.restore();

  displayCtx.drawImage(occlusionCanvas, 0, 0, vw, vh);
}

/**
 * Pure client-side helper for the store owner: removes solid/cloth backdrop
 * (e.g. blue backdrop or studio background) from an uploaded image into a
 * transparent PNG data URL without calling any external server or API.
 */
export function convertImageToTransparentPngLocal(
  imageDataUrl: string,
  tolerance = 58
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const maxSide = 720;
        const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * ratio));
        const h = Math.max(1, Math.round(img.naturalHeight * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const px = imageData.data;

        // Sample average color from image border corners to identify background tone
        const sampleCoords = [
          [2, 2],
          [w - 3, 2],
          [2, h - 3],
          [w - 3, h - 3],
          [Math.floor(w / 2), 2],
        ];
        let avgR = 0;
        let avgG = 0;
        let avgB = 0;
        for (const [sx, sy] of sampleCoords) {
          const i = (sy * w + sx) * 4;
          avgR += px[i];
          avgG += px[i + 1];
          avgB += px[i + 2];
        }
        avgR /= sampleCoords.length;
        avgG /= sampleCoords.length;
        avgB /= sampleCoords.length;

        // Edge-seeded BFS flood fill so interior matching garment colors stay intact
        const visited = new Uint8Array(w * h);
        const queue = new Int32Array(w * h);
        let head = 0;
        let tail = 0;

        const pushIfBg = (x: number, y: number) => {
          if (x < 0 || x >= w || y < 0 || y >= h) return;
          const idx = y * w + x;
          if (visited[idx]) return;
          const p = idx * 4;
          const dr = px[p] - avgR;
          const dg = px[p + 1] - avgG;
          const db = px[p + 2] - avgB;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dist <= tolerance) {
            visited[idx] = 1;
            queue[tail++] = idx;
          }
        };

        for (let x = 0; x < w; x++) {
          pushIfBg(x, 0);
          pushIfBg(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
          pushIfBg(0, y);
          pushIfBg(w - 1, y);
        }

        while (head < tail) {
          const cur = queue[head++];
          const cx = cur % w;
          const cy = Math.floor(cur / w);
          px[cur * 4 + 3] = 0;
          pushIfBg(cx + 1, cy);
          pushIfBg(cx - 1, cy);
          pushIfBg(cx, cy + 1);
          pushIfBg(cx, cy - 1);
        }

        ctx.putImageData(imageData, 0, 0);
        const out = canvas.toDataURL('image/png');
        canvas.width = 0;
        canvas.height = 0;
        resolve(out);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('تعذر تحميل الصورة للمعالجة'));
    img.src = imageDataUrl;
  });
}

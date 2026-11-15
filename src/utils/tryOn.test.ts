import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSE_IDX,
  PosePoint,
  computeArmOcclusionCorridors,
  computeGarmentPlacement,
  detectDevicePerformanceProfile,
  getCameraErrorArabic,
  inferTryOnCategory,
  isValidTryOnAssetUrl,
  shouldHideOnTrackingLoss,
  smoothLandmarks,
} from './tryOn';
import {
  teardownTryOnSession,
  verifyZeroNetworkAndStorageLeak,
} from './tryOnPrivacy';
import { Product } from './store';

function makeStandingPose(overrides: Partial<Record<number, Partial<PosePoint>>> = {}): PosePoint[] {
  const pts: PosePoint[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
    presence: 0.95,
  }));

  pts[POSE_IDX.LEFT_SHOULDER] = { x: 0.62, y: 0.28, z: 0, visibility: 0.98, presence: 0.98 };
  pts[POSE_IDX.RIGHT_SHOULDER] = { x: 0.38, y: 0.28, z: 0, visibility: 0.98, presence: 0.98 };
  pts[POSE_IDX.LEFT_ELBOW] = { x: 0.68, y: 0.44, z: -0.02, visibility: 0.95, presence: 0.95 };
  pts[POSE_IDX.RIGHT_ELBOW] = { x: 0.32, y: 0.44, z: -0.02, visibility: 0.95, presence: 0.95 };
  pts[POSE_IDX.LEFT_WRIST] = { x: 0.64, y: 0.58, z: -0.05, visibility: 0.92, presence: 0.92 };
  pts[POSE_IDX.RIGHT_WRIST] = { x: 0.36, y: 0.58, z: -0.05, visibility: 0.92, presence: 0.92 };
  pts[POSE_IDX.LEFT_HIP] = { x: 0.58, y: 0.56, z: 0, visibility: 0.95, presence: 0.95 };
  pts[POSE_IDX.RIGHT_HIP] = { x: 0.42, y: 0.56, z: 0, visibility: 0.95, presence: 0.95 };
  pts[POSE_IDX.LEFT_KNEE] = { x: 0.57, y: 0.76, z: 0, visibility: 0.92, presence: 0.92 };
  pts[POSE_IDX.RIGHT_KNEE] = { x: 0.43, y: 0.76, z: 0, visibility: 0.92, presence: 0.92 };
  pts[POSE_IDX.LEFT_ANKLE] = { x: 0.57, y: 0.93, z: 0, visibility: 0.9, presence: 0.9 };
  pts[POSE_IDX.RIGHT_ANKLE] = { x: 0.43, y: 0.93, z: 0, visibility: 0.9, presence: 0.9 };

  for (const [k, v] of Object.entries(overrides)) {
    const idx = Number(k);
    pts[idx] = { ...pts[idx], ...v };
  }
  return pts;
}

test('inferTryOnCategory classifies tops, trousers, full outfits, and unsupported items', () => {
  assert.equal(inferTryOnCategory({ name: 'تيشيرت أبيض أوفر سايز', category: 'تيشيرتات' }), 'top');
  assert.equal(inferTryOnCategory({ name: 'سويت شيرت قطن', category: 'شتوي' }), 'top');
  assert.equal(inferTryOnCategory({ name: 'هودي أسود ثقيل', category: 'هوديز' }), 'top');
  assert.equal(inferTryOnCategory({ name: 'قميص كتان', category: 'قمصان' }), 'top');
  assert.equal(inferTryOnCategory({ name: 'بنطلون جينز أزرق', category: 'بنطلونات' }), 'trousers');
  assert.equal(
    inferTryOnCategory({ name: 'طقم تيشيرت أبيض + جينز غامق + كوتشي أبيض', category: 'أطقم' }),
    'full_outfit'
  );
  assert.equal(inferTryOnCategory({ name: 'حقيبة جلد كروس', category: 'شنط' }), 'unsupported');
  assert.equal(inferTryOnCategory({ name: 'كوتشي رياضي', category: 'أحذية' }), 'unsupported');

  const explicitOverride: Pick<Product, 'name' | 'category' | 'tryOnCategory'> = {
    name: 'طقم تيشيرت أبيض + جينز',
    category: 'أطقم',
    tryOnCategory: 'top',
  };
  assert.equal(inferTryOnCategory(explicitOverride), 'top');
});

test('isValidTryOnAssetUrl accepts transparent PNG/WebP and rejects JPEG flat-lay photos', () => {
  assert.equal(isValidTryOnAssetUrl('data:image/png;base64,AAAA'), true);
  assert.equal(isValidTryOnAssetUrl('data:image/webp;base64,BBBB'), true);
  assert.equal(isValidTryOnAssetUrl('https://cdn.example.com/shirt.png'), true);
  assert.equal(isValidTryOnAssetUrl('data:image/jpeg;base64,/9j/4AAQ'), false);
  assert.equal(isValidTryOnAssetUrl('https://cdn.example.com/photo.jpg'), false);
  assert.equal(isValidTryOnAssetUrl(''), false);
});

test('computeGarmentPlacement scales with distance and tracks movement and tilt', () => {
  const viewport = { width: 640, height: 480 };

  const basePose = makeStandingPose();
  const basePlacement = computeGarmentPlacement(basePose, viewport, 0.85, 'top', null, false);
  assert.equal(basePlacement.visible, true);
  assert.equal(basePlacement.reason, 'ok');
  assert.ok(basePlacement.width > 180 && basePlacement.width < 320);
  assert.ok(Math.abs(basePlacement.rotationRad) < 0.05);

  // Move closer (wider shoulder span) -> garment width & height increase proportionally
  const closerPose = makeStandingPose({
    [POSE_IDX.LEFT_SHOULDER]: { x: 0.72, y: 0.25 },
    [POSE_IDX.RIGHT_SHOULDER]: { x: 0.28, y: 0.25 },
    [POSE_IDX.LEFT_HIP]: { x: 0.65, y: 0.68 },
    [POSE_IDX.RIGHT_HIP]: { x: 0.35, y: 0.68 },
  });
  const closerPlacement = computeGarmentPlacement(closerPose, viewport, 0.85, 'top', null, false);
  assert.equal(closerPlacement.visible, true);
  assert.ok(closerPlacement.width > basePlacement.width * 1.5);
  assert.ok(closerPlacement.height > basePlacement.height * 1.3);

  // Move right -> garment centerX shifts right
  const shiftedRightPose = makeStandingPose({
    [POSE_IDX.LEFT_SHOULDER]: { x: 0.82, y: 0.28 },
    [POSE_IDX.RIGHT_SHOULDER]: { x: 0.58, y: 0.28 },
    [POSE_IDX.LEFT_HIP]: { x: 0.78, y: 0.56 },
    [POSE_IDX.RIGHT_HIP]: { x: 0.62, y: 0.56 },
  });
  const shiftedPlacement = computeGarmentPlacement(shiftedRightPose, viewport, 0.85, 'top', null, false);
  assert.ok(shiftedPlacement.centerX > basePlacement.centerX + 100);

  // Tilt shoulders -> rotationRad follows tilt
  const tiltedPose = makeStandingPose({
    [POSE_IDX.LEFT_SHOULDER]: { x: 0.62, y: 0.34 },
    [POSE_IDX.RIGHT_SHOULDER]: { x: 0.38, y: 0.22 },
  });
  const tiltedPlacement = computeGarmentPlacement(tiltedPose, viewport, 0.85, 'top', null, false);
  assert.ok(Math.abs(tiltedPlacement.rotationRad) > 0.2);
});

test('computeGarmentPlacement supports trousers and full_outfit and hides on lost tracking', () => {
  const viewport = { width: 640, height: 480 };
  const pose = makeStandingPose();

  const trousers = computeGarmentPlacement(pose, viewport, 0.6, 'trousers', null, false);
  assert.equal(trousers.visible, true);
  assert.ok(trousers.centerY > 280);

  const outfit = computeGarmentPlacement(pose, viewport, 0.55, 'full_outfit', null, false);
  assert.equal(outfit.visible, true);
  assert.ok(outfit.height > trousers.height);

  // Low confidence shoulders -> hidden cleanly
  const lostPose = makeStandingPose({
    [POSE_IDX.LEFT_SHOULDER]: { visibility: 0.1, presence: 0.1 },
    [POSE_IDX.RIGHT_SHOULDER]: { visibility: 0.1, presence: 0.1 },
  });
  const hiddenTop = computeGarmentPlacement(lostPose, viewport, 0.85, 'top', null, false);
  assert.equal(hiddenTop.visible, false);
  assert.equal(hiddenTop.reason, 'low_confidence');

  assert.equal(shouldHideOnTrackingLoss(1, 4), false);
  assert.equal(shouldHideOnTrackingLoss(4, 4), true);
});

test('smoothLandmarks damps micro jitter while following intentional movement', () => {
  const prev = makeStandingPose();
  const jittered = makeStandingPose({
    [POSE_IDX.LEFT_SHOULDER]: { x: 0.625, y: 0.283 },
  });
  const smoothed = smoothLandmarks(prev, jittered, 0.4);
  assert.ok(smoothed[POSE_IDX.LEFT_SHOULDER].x > 0.62 && smoothed[POSE_IDX.LEFT_SHOULDER].x < 0.625);
});

test('computeArmOcclusionCorridors detects forearms moving in front of torso', () => {
  const pose = makeStandingPose({
    [POSE_IDX.LEFT_WRIST]: { x: 0.52, y: 0.42, z: -0.18, visibility: 0.95 },
    [POSE_IDX.RIGHT_WRIST]: { x: 0.36, y: 0.58, z: 0.05, visibility: 0.95 },
  });
  const segments = computeArmOcclusionCorridors(pose, { width: 640, height: 480 }, false, 150);
  assert.equal(segments.length, 2);
  const left = segments.find((s) => s.side === 'left');
  const right = segments.find((s) => s.side === 'right');
  assert.equal(left?.inFrontOfTorso, true);
  assert.equal(right?.inFrontOfTorso, false);
});

test('device performance profile and Arabic camera error handling', () => {
  const high = detectDevicePerformanceProfile(8, true, 'auto');
  assert.equal(high.tier, 'high');
  assert.equal(high.targetFps, 30);
  assert.equal(high.enableArmOcclusion, true);

  const low = detectDevicePerformanceProfile(2, false, 'auto');
  assert.equal(low.tier, 'low');
  assert.equal(low.delegate, 'CPU');
  assert.equal(low.enableArmOcclusion, false);

  assert.equal(getCameraErrorArabic('NotAllowedError', true, true).code, 'PERMISSION_DENIED');
  assert.equal(getCameraErrorArabic('NotFoundError', true, true).code, 'NO_CAMERA');
  assert.equal(getCameraErrorArabic('NotReadableError', true, true).code, 'CAMERA_IN_USE');
  assert.equal(getCameraErrorArabic('WebGLUnsupportedError', true, true).code, 'WEBGL_UNSUPPORTED');
  assert.equal(getCameraErrorArabic('NotAllowedError', false, true).code, 'INSECURE_CONTEXT');
  assert.equal(getCameraErrorArabic('NotAllowedError', true, false).code, 'NOT_SUPPORTED');
});

test('PRIVACY PROOF: teardownTryOnSession stops all tracks, clears srcObject, wipes canvases, and closes ML tasks', () => {
  let track1Stopped = false;
  let track2Stopped = false;
  let rafCancelledId: number | null = null;
  let taskClosed = false;
  let memoryCleared = false;
  let canvasCleared = false;

  const fakeVideo = {
    paused: false,
    srcObject: { getTracks: () => [] },
    pause() {
      this.paused = true;
    },
    removeAttribute() {},
    load() {},
  };

  const fakeCanvas = {
    width: 640,
    height: 480,
    getContext() {
      return {
        clearRect() {
          canvasCleared = true;
        },
      };
    },
  };

  const report = teardownTryOnSession({
    stream: {
      getTracks: () => [
        { stop: () => { track1Stopped = true; } },
        { stop: () => { track2Stopped = true; } },
      ],
    },
    video: fakeVideo,
    canvases: [fakeCanvas],
    rafId: 42,
    cancelFrame: (id) => { rafCancelledId = id; },
    tasks: [{ close: () => { taskClosed = true; } }],
    onMemoryCleared: () => { memoryCleared = true; },
  });

  assert.equal(report.stoppedTracks, 2);
  assert.equal(track1Stopped, true);
  assert.equal(track2Stopped, true);
  assert.equal(fakeVideo.srcObject, null);
  assert.equal(report.videoCleared, true);
  assert.equal(rafCancelledId, 42);
  assert.equal(report.rafCancelled, true);
  assert.equal(canvasCleared, true);
  assert.equal(fakeCanvas.width, 0);
  assert.equal(fakeCanvas.height, 0);
  assert.equal(taskClosed, true);
  assert.equal(memoryCleared, true);
});

test('PRIVACY PROOF: frame processing triggers zero network requests and zero storage writes', () => {
  const pose = makeStandingPose();
  const proof = verifyZeroNetworkAndStorageLeak((frameBuffer, width, height) => {
    // Run pure local frame analysis + garment placement computation using in-memory frame buffer
    assert.ok(frameBuffer.byteLength === width * height * 4);
    const smoothed = smoothLandmarks(null, pose, 0.45);
    const placement = computeGarmentPlacement(smoothed, { width, height }, 0.85, 'top', null, true);
    const arms = computeArmOcclusionCorridors(smoothed, { width, height }, true, 24);
    assert.equal(placement.visible, true);
    assert.equal(arms.length, 2);
  });

  assert.equal(proof.networkRequestsCount, 0);
  assert.equal(proof.storageWritesCount, 0);
  assert.equal(proof.passed, true);
  assert.deepEqual(proof.details, []);
});

import { DEFAULT_TRY_ON_CONFIG, Product, TryOnCategory, TryOnConfig } from './store';

export type ResolvedTryOnCategory = 'top' | 'trousers' | 'full_outfit' | 'unsupported';

export interface PosePoint {
  x: number; // normalized [0..1]
  y: number; // normalized [0..1]
  z?: number; // depth relative to hips
  visibility?: number;
  presence?: number;
}

export interface GarmentPlacement {
  visible: boolean;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotationRad: number;
  yawScaleX: number;
  skewX: number;
  confidence: number;
  reason: 'ok' | 'no_pose' | 'low_confidence' | 'unsupported_category';
}

export interface ArmSegment {
  side: 'left' | 'right';
  elbowX: number;
  elbowY: number;
  wristX: number;
  wristY: number;
  thicknessPx: number;
  inFrontOfTorso: boolean;
}

export interface DevicePerformanceProfile {
  tier: 'high' | 'low';
  targetFps: number;
  inferenceIntervalMs: number;
  inferenceWidth: number;
  inferenceHeight: number;
  enableArmOcclusion: boolean;
  delegate: 'GPU' | 'CPU';
}

export interface CameraErrorInfo {
  code:
    | 'NOT_SUPPORTED'
    | 'INSECURE_CONTEXT'
    | 'PERMISSION_DENIED'
    | 'NO_CAMERA'
    | 'CAMERA_IN_USE'
    | 'WEBGL_UNSUPPORTED'
    | 'UNKNOWN';
  title: string;
  message: string;
}

// MediaPipe Pose Landmarker indices
export const POSE_IDX = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export function inferTryOnCategory(product: Pick<Product, 'category' | 'name' | 'tryOnCategory'>): ResolvedTryOnCategory {
  if (product.tryOnCategory && product.tryOnCategory !== 'auto') {
    return product.tryOnCategory;
  }

  const text = `${product.category || ''} ${product.name || ''}`.toLowerCase();

  // Bags / Shoes / Accessories are not body-draped garments
  if (
    /حقيب|حقائب|شنط|شنطة|اكسسوار|كاب|كابات|حزام|نظار|جراب|ساعة|محفظة|bag|wallet|cap|hat|accessory|accessories/i.test(
      text
    ) &&
    !/طقم|أطقم|تيشيرت|هودي|جاكيت|بنطلون|جينز|قميص/i.test(text)
  ) {
    return 'unsupported';
  }

  // Standalone footwear
  if (
    /كوتش|جزم|جزمة|أحذية|حذاء|سنيكرز|shoe|sneaker|boot/i.test(text) &&
    !/طقم|أطقم|تيشيرت|هودي|جاكيت|بنطلون|جينز|قميص|سويت شيرت/i.test(text)
  ) {
    return 'unsupported';
  }

  // Full outfit / set (when product combines top + bottom or is explicitly in أطقم)
  if (/أطقم|طقم|بدل|بدلة|ست كامل|outfit|suit|full_outfit/i.test(text)) {
    // Check if it explicitly describes a single top only inside name? Usually SKIP sets are full outfits,
    // or if tryOnCategory isn't explicitly 'top', treat full set as 'full_outfit' when pants/jeans are mentioned,
    // otherwise 'top' if only upper piece is described.
    if (/بنطال|بنطلون|جينز|trouser|pant|jean/i.test(text)) {
      return 'full_outfit';
    }
    return 'top';
  }

  // Trousers / Jeans / Shorts
  if (/بنطال|بنطلون|جينز|ميلتون|شورت|سويت بانتس|pant|jean|trouser|short/i.test(text)) {
    return 'trousers';
  }

  // Tops: T-shirt, Sweatshirt, Hoodie, Shirt, Jacket, Pullover
  if (
    /تيشيرت|تي شيرت|سويت شيرت|هودي|هوديز|قميص|قمصان|جاكيت|جواكت|جواكيت|بلوفر|بلوزة|توب|shirt|sweatshirt|hoodie|jacket|sweater|top|jacet/i.test(
      text
    )
  ) {
    return 'top';
  }

  return 'top';
}

/**
 * التجربة اللايف بالكاميرا مدعومة للتيشيرتات (القطع العلوية) والبناطيل فقط.
 * الأطقم الكاملة والأحذية والشنط والإكسسوارات تفضل على تجربة الصورة.
 */
export function isLiveTryOnCategory(category: ResolvedTryOnCategory): boolean {
  return category === 'top' || category === 'trousers';
}

export function isValidTryOnAssetUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^data:image\/(png|webp);base64,/i.test(trimmed)) return true;
  if (/^data:image\/(jpeg|jpg);base64,/i.test(trimmed)) return false;
  if (/^(https?:\/\/|\/|\.)/i.test(trimmed)) {
    // Reject obvious JPEG paths when checking transparent asset readiness
    if (/\.(jpe?g)(\?|#|$)/i.test(trimmed)) return false;
    return true;
  }
  return false;
}

export function getDefaultTryOnConfig(category: ResolvedTryOnCategory): TryOnConfig {
  if (category === 'trousers') {
    return {
      scaleX: 1.15,
      scaleY: 1.05,
      offsetX: 0,
      offsetY: 0.02,
      armOcclusion: false,
    };
  }
  if (category === 'full_outfit') {
    return {
      scaleX: 1.04,
      scaleY: 1.02,
      offsetX: 0,
      offsetY: 0,
      armOcclusion: true,
    };
  }
  return { ...DEFAULT_TRY_ON_CONFIG };
}

export function mergeTryOnConfig(
  category: ResolvedTryOnCategory,
  partial?: Partial<TryOnConfig> | null
): TryOnConfig {
  const base = getDefaultTryOnConfig(category);
  if (!partial) return base;
  return {
    scaleX: typeof partial.scaleX === 'number' && Number.isFinite(partial.scaleX) ? clamp(partial.scaleX, 0.5, 1.8) : base.scaleX,
    scaleY: typeof partial.scaleY === 'number' && Number.isFinite(partial.scaleY) ? clamp(partial.scaleY, 0.5, 1.8) : base.scaleY,
    offsetX: typeof partial.offsetX === 'number' && Number.isFinite(partial.offsetX) ? clamp(partial.offsetX, -0.4, 0.4) : base.offsetX,
    offsetY: typeof partial.offsetY === 'number' && Number.isFinite(partial.offsetY) ? clamp(partial.offsetY, -0.4, 0.4) : base.offsetY,
    armOcclusion: typeof partial.armOcclusion === 'boolean' ? partial.armOcclusion : base.armOcclusion,
  };
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function pointConfidence(pt: PosePoint | undefined): number {
  if (!pt) return 0;
  const vis = pt.visibility ?? 1;
  const pres = pt.presence ?? 1;
  return Math.min(vis, pres);
}

export function smoothLandmarks(
  prev: PosePoint[] | null,
  next: PosePoint[],
  alpha = 0.42
): PosePoint[] {
  if (!prev || prev.length !== next.length) {
    return next.map((p) => ({ ...p }));
  }
  const a = clamp(alpha, 0.05, 1);
  return next.map((n, idx) => {
    const p = prev[idx];
    // Adaptive smoothing: jump faster on larger movements, damp jitter on small movements
    const dist = Math.hypot(n.x - p.x, n.y - p.y);
    const adaptiveAlpha = dist > 0.06 ? Math.min(0.85, a + 0.3) : a;
    return {
      x: p.x + (n.x - p.x) * adaptiveAlpha,
      y: p.y + (n.y - p.y) * adaptiveAlpha,
      z: (p.z ?? 0) + ((n.z ?? 0) - (p.z ?? 0)) * adaptiveAlpha,
      visibility: n.visibility,
      presence: n.presence,
    };
  });
}

function toViewportPoint(
  pt: PosePoint,
  viewport: { width: number; height: number },
  mirrored: boolean
): { x: number; y: number; z: number } {
  const nx = mirrored ? 1 - pt.x : pt.x;
  return {
    x: nx * viewport.width,
    y: pt.y * viewport.height,
    z: pt.z ?? 0,
  };
}

export function shouldHideOnTrackingLoss(missedFrames: number, maxGraceFrames = 4): boolean {
  return missedFrames >= maxGraceFrames;
}

export function computeGarmentPlacement(
  landmarks: PosePoint[] | null | undefined,
  viewport: { width: number; height: number },
  garmentAspectRatio: number, // width / height
  category: ResolvedTryOnCategory,
  rawConfig: Partial<TryOnConfig> | null | undefined,
  mirrored: boolean,
  worldLandmarks?: PosePoint[] | null
): GarmentPlacement {
  if (category === 'unsupported') {
    return {
      visible: false,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      rotationRad: 0,
      yawScaleX: 1,
      skewX: 0,
      confidence: 0,
      reason: 'unsupported_category',
    };
  }

  if (!landmarks || landmarks.length < 29 || viewport.width <= 0 || viewport.height <= 0) {
    return {
      visible: false,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      rotationRad: 0,
      yawScaleX: 1,
      skewX: 0,
      confidence: 0,
      reason: 'no_pose',
    };
  }

  const config = mergeTryOnConfig(category, rawConfig);
  const safeAspect = clamp(garmentAspectRatio || 0.85, 0.3, 2.5);

  const lS = landmarks[POSE_IDX.LEFT_SHOULDER];
  const rS = landmarks[POSE_IDX.RIGHT_SHOULDER];
  const lH = landmarks[POSE_IDX.LEFT_HIP];
  const rH = landmarks[POSE_IDX.RIGHT_HIP];
  const lK = landmarks[POSE_IDX.LEFT_KNEE];
  const rK = landmarks[POSE_IDX.RIGHT_KNEE];
  const lA = landmarks[POSE_IDX.LEFT_ANKLE];
  const rA = landmarks[POSE_IDX.RIGHT_ANKLE];

  const shoulderConf = Math.min(pointConfidence(lS), pointConfidence(rS));
  const hipConf = Math.min(pointConfidence(lH), pointConfidence(rH));
  const kneeConf = Math.min(pointConfidence(lK), pointConfidence(rK));

  // Category-specific tracking requirements
  if (category === 'top') {
    if (shoulderConf < 0.45) {
      return {
        visible: false,
        centerX: 0,
        centerY: 0,
        width: 0,
        height: 0,
        rotationRad: 0,
        yawScaleX: 1,
        skewX: 0,
        confidence: shoulderConf,
        reason: 'low_confidence',
      };
    }

    const pLS = toViewportPoint(lS, viewport, mirrored);
    const pRS = toViewportPoint(rS, viewport, mirrored);

    const shoulderMidX = (pLS.x + pRS.x) / 2;
    const shoulderMidY = (pLS.y + pRS.y) / 2;
    const shoulderDist = Math.hypot(pLS.x - pRS.x, pLS.y - pRS.y);

    if (shoulderDist < Math.max(8, viewport.width * 0.025)) {
      return {
        visible: false,
        centerX: 0,
        centerY: 0,
        width: 0,
        height: 0,
        rotationRad: 0,
        yawScaleX: 1,
        skewX: 0,
        confidence: shoulderConf,
        reason: 'low_confidence',
      };
    }

    // Angle along shoulder line (normalized so standing upright is 0 rad)
    const dx = pLS.x - pRS.x;
    const dy = pLS.y - pRS.y;
    let rotationRad = Math.atan2(dy, dx);
    if (rotationRad > Math.PI / 2) rotationRad -= Math.PI;
    if (rotationRad < -Math.PI / 2) rotationRad += Math.PI;
    rotationRad = clamp(rotationRad, -0.65, 0.65);

    // Compute torso height using hips when visible, or proportional fallback when waist is out of frame
    let torsoHeight = shoulderDist * 1.42;
    let torsoCenterX = shoulderMidX;
    let torsoCenterY = shoulderMidY + torsoHeight * 0.44;

    if (hipConf >= 0.4) {
      const pLH = toViewportPoint(lH, viewport, mirrored);
      const pRH = toViewportPoint(rH, viewport, mirrored);
      const hipMidX = (pLH.x + pRH.x) / 2;
      const hipMidY = (pLH.y + pRH.y) / 2;
      const measuredTorso = Math.hypot(hipMidX - shoulderMidX, hipMidY - shoulderMidY);
      if (measuredTorso > shoulderDist * 0.65) {
        torsoHeight = measuredTorso * 1.18;
        torsoCenterX = shoulderMidX * 0.56 + hipMidX * 0.44;
        torsoCenterY = shoulderMidY * 0.54 + hipMidY * 0.46;
      }
    }

    // Estimate subtle 3D yaw foreshortening from world landmarks Z
    let yawScaleX = 1;
    let skewX = 0;
    if (worldLandmarks && worldLandmarks[POSE_IDX.LEFT_SHOULDER] && worldLandmarks[POSE_IDX.RIGHT_SHOULDER]) {
      const zDiff = (worldLandmarks[POSE_IDX.LEFT_SHOULDER].z ?? 0) - (worldLandmarks[POSE_IDX.RIGHT_SHOULDER].z ?? 0);
      yawScaleX = clamp(1 - Math.abs(zDiff) * 0.25, 0.72, 1);
      skewX = clamp((mirrored ? -zDiff : zDiff) * 0.14, -0.18, 0.18);
    }

    // Width covers shoulders + sleeves naturally; preserve garment aspect ratio cleanly
    const targetWidth = shoulderDist * 1.56 * config.scaleX;
    const aspectMatchedHeight = targetWidth / safeAspect;
    // Blend torso height & natural garment aspect ratio so garment never stretches absurdly
    const targetHeight = (torsoHeight * 0.55 + aspectMatchedHeight * 0.45) * config.scaleY;

    return {
      visible: true,
      centerX: torsoCenterX + config.offsetX * targetWidth,
      centerY: torsoCenterY + config.offsetY * targetHeight,
      width: targetWidth,
      height: targetHeight,
      rotationRad,
      yawScaleX,
      skewX,
      confidence: shoulderConf,
      reason: 'ok',
    };
  }

  if (category === 'trousers') {
    if (hipConf < 0.45 || kneeConf < 0.35) {
      return {
        visible: false,
        centerX: 0,
        centerY: 0,
        width: 0,
        height: 0,
        rotationRad: 0,
        yawScaleX: 1,
        skewX: 0,
        confidence: Math.min(hipConf, kneeConf),
        reason: 'low_confidence',
      };
    }

    const pLH = toViewportPoint(lH, viewport, mirrored);
    const pRH = toViewportPoint(rH, viewport, mirrored);
    const pLK = toViewportPoint(lK, viewport, mirrored);
    const pRK = toViewportPoint(rK, viewport, mirrored);

    const hipMidX = (pLH.x + pRH.x) / 2;
    const hipMidY = (pLH.y + pRH.y) / 2;
    const hipWidth = Math.hypot(pLH.x - pRH.x, pLH.y - pRH.y);
    if (hipWidth < 16) {
      return {
        visible: false,
        centerX: 0,
        centerY: 0,
        width: 0,
        height: 0,
        rotationRad: 0,
        yawScaleX: 1,
        skewX: 0,
        confidence: hipConf,
        reason: 'low_confidence',
      };
    }

    const kneeMidX = (pLK.x + pRK.x) / 2;
    const kneeMidY = (pLK.y + pRK.y) / 2;
    const ankleConf = Math.min(pointConfidence(lA), pointConfidence(rA));

    let bottomMidX = hipMidX + (kneeMidX - hipMidX) * 1.85;
    let bottomMidY = hipMidY + (kneeMidY - hipMidY) * 1.85;
    if (ankleConf >= 0.35) {
      const pLA = toViewportPoint(lA, viewport, mirrored);
      const pRA = toViewportPoint(rA, viewport, mirrored);
      bottomMidX = (pLA.x + pRA.x) / 2;
      bottomMidY = (pLA.y + pRA.y) / 2;
    }

    let rotationRad = Math.atan2(pLH.y - pRH.y, pLH.x - pRH.x);
    if (rotationRad > Math.PI / 2) rotationRad -= Math.PI;
    if (rotationRad < -Math.PI / 2) rotationRad += Math.PI;
    rotationRad = clamp(rotationRad, -0.5, 0.5);

    const legSpan = Math.hypot(bottomMidX - hipMidX, bottomMidY - hipMidY);
    const targetWidth = hipWidth * 1.65 * config.scaleX;
    const targetHeight = Math.max(legSpan * 1.08, targetWidth / safeAspect) * config.scaleY;

    return {
      visible: true,
      centerX: (hipMidX + bottomMidX) / 2 + config.offsetX * targetWidth,
      centerY: (hipMidY + bottomMidY) / 2 + config.offsetY * targetHeight,
      width: targetWidth,
      height: targetHeight,
      rotationRad,
      yawScaleX: 1,
      skewX: 0,
      confidence: Math.min(hipConf, kneeConf),
      reason: 'ok',
    };
  }

  // category === 'full_outfit'
  if (shoulderConf < 0.45 || hipConf < 0.4) {
    return {
      visible: false,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      rotationRad: 0,
      yawScaleX: 1,
      skewX: 0,
      confidence: Math.min(shoulderConf, hipConf),
      reason: 'low_confidence',
    };
  }

  const pLS = toViewportPoint(lS, viewport, mirrored);
  const pRS = toViewportPoint(rS, viewport, mirrored);
  const pLH = toViewportPoint(lH, viewport, mirrored);
  const pRH = toViewportPoint(rH, viewport, mirrored);

  const shoulderMidX = (pLS.x + pRS.x) / 2;
  const shoulderMidY = (pLS.y + pRS.y) / 2;
  const hipMidX = (pLH.x + pRH.x) / 2;
  const hipMidY = (pLH.y + pRH.y) / 2;
  const shoulderDist = Math.hypot(pLS.x - pRS.x, pLS.y - pRS.y);

  let bottomY = hipMidY + Math.hypot(hipMidX - shoulderMidX, hipMidY - shoulderMidY) * 1.35;
  let bottomX = hipMidX;
  const ankleConf = Math.min(pointConfidence(lA), pointConfidence(rA));
  if (ankleConf >= 0.35) {
    const pLA = toViewportPoint(lA, viewport, mirrored);
    const pRA = toViewportPoint(rA, viewport, mirrored);
    bottomX = (pLA.x + pRA.x) / 2;
    bottomY = (pLA.y + pRA.y) / 2;
  } else if (kneeConf >= 0.35) {
    const pLK = toViewportPoint(lK, viewport, mirrored);
    const pRK = toViewportPoint(rK, viewport, mirrored);
    const kneeMidX = (pLK.x + pRK.x) / 2;
    const kneeMidY = (pLK.y + pRK.y) / 2;
    bottomX = hipMidX + (kneeMidX - hipMidX) * 1.75;
    bottomY = hipMidY + (kneeMidY - hipMidY) * 1.75;
  }

  let rotationRad = Math.atan2(pLS.y - pRS.y, pLS.x - pRS.x);
  if (rotationRad > Math.PI / 2) rotationRad -= Math.PI;
  if (rotationRad < -Math.PI / 2) rotationRad += Math.PI;
  rotationRad = clamp(rotationRad, -0.55, 0.55);

  const outfitSpan = Math.hypot(bottomX - shoulderMidX, bottomY - shoulderMidY);
  const targetWidth = shoulderDist * 1.62 * config.scaleX;
  const targetHeight = Math.max(outfitSpan * 1.06, targetWidth / safeAspect) * config.scaleY;

  return {
    visible: true,
    centerX: shoulderMidX * 0.45 + bottomX * 0.55 + config.offsetX * targetWidth,
    centerY: shoulderMidY * 0.42 + bottomY * 0.58 + config.offsetY * targetHeight,
    width: targetWidth,
    height: targetHeight,
    rotationRad,
    yawScaleX: 1,
    skewX: 0,
    confidence: Math.min(shoulderConf, hipConf),
    reason: 'ok',
  };
}

export function computeArmOcclusionCorridors(
  landmarks: PosePoint[] | null | undefined,
  viewport: { width: number; height: number },
  mirrored: boolean,
  shoulderDistPx: number
): ArmSegment[] {
  if (!landmarks || landmarks.length < 21 || shoulderDistPx <= 0) return [];

  const lS = landmarks[POSE_IDX.LEFT_SHOULDER];
  const rS = landmarks[POSE_IDX.RIGHT_SHOULDER];
  const torsoZ = ((lS?.z ?? 0) + (rS?.z ?? 0)) / 2;
  const thicknessPx = clamp(shoulderDistPx * 0.22, 18, 84);

  const segments: ArmSegment[] = [];

  const buildSide = (side: 'left' | 'right', elbowIdx: number, wristIdx: number) => {
    const elbow = landmarks[elbowIdx];
    const wrist = landmarks[wristIdx];
    if (pointConfidence(elbow) < 0.4 || pointConfidence(wrist) < 0.4) return;
    const pE = toViewportPoint(elbow, viewport, mirrored);
    const pW = toViewportPoint(wrist, viewport, mirrored);
    // In MediaPipe Pose, smaller Z means closer to the camera
    const wristZ = wrist.z ?? 0;
    const elbowZ = elbow.z ?? 0;
    const inFrontOfTorso = wristZ < torsoZ - 0.04 || elbowZ < torsoZ - 0.03;
    segments.push({
      side,
      elbowX: pE.x,
      elbowY: pE.y,
      wristX: pW.x,
      wristY: pW.y,
      thicknessPx,
      inFrontOfTorso,
    });
  };

  buildSide('left', POSE_IDX.LEFT_ELBOW, POSE_IDX.LEFT_WRIST);
  buildSide('right', POSE_IDX.RIGHT_ELBOW, POSE_IDX.RIGHT_WRIST);
  return segments;
}

export function detectDevicePerformanceProfile(
  hardwareConcurrency = 4,
  hasWebGL = true,
  preferredMode: 'auto' | 'low' = 'auto'
): DevicePerformanceProfile {
  if (preferredMode === 'low' || hardwareConcurrency <= 4 || !hasWebGL) {
    return {
      tier: 'low',
      targetFps: 20,
      inferenceIntervalMs: 55,
      inferenceWidth: 320,
      inferenceHeight: 240,
      enableArmOcclusion: false,
      delegate: hasWebGL ? 'GPU' : 'CPU',
    };
  }
  return {
    tier: 'high',
    targetFps: 30,
    inferenceIntervalMs: 33,
    inferenceWidth: 480,
    inferenceHeight: 360,
    enableArmOcclusion: true,
    delegate: 'GPU',
  };
}

export function getCameraErrorArabic(
  errName: string,
  isSecureContext: boolean,
  hasMediaDevices: boolean
): CameraErrorInfo {
  if (!isSecureContext) {
    return {
      code: 'INSECURE_CONTEXT',
      title: 'يلزم اتصال آمن HTTPS',
      message: 'تشغيل الكاميرا المباشرة يتطلب فتح المتجر عبر رابط HTTPS آمن لحماية خصوصيتك.',
    };
  }
  if (!hasMediaDevices) {
    return {
      code: 'NOT_SUPPORTED',
      title: 'المتصفح لا يدعم الكاميرا المباشرة',
      message: 'متصفحك الحالي لا يدعم الوصول إلى الكاميرا (getUserMedia). جرّب فتح المتجر عبر Chrome أو Safari الحديث.',
    };
  }
  if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
    return {
      code: 'PERMISSION_DENIED',
      title: 'تم رفض إذن الكاميرا',
      message: 'لم يتم منح إذن الكاميرا. يمكنك السماح للكاميرا من إعدادات المتصفح بجانب شريط العنوان ثم الضغط على إعادة المحاولة.',
    };
  }
  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
    return {
      code: 'NO_CAMERA',
      title: 'لم يتم العثور على كاميرا',
      message: 'لا توجد كاميرا متصلة أو متاحة على هذا الجهاز.',
    };
  }
  if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    return {
      code: 'CAMERA_IN_USE',
      title: 'الكاميرا مستخدمة في تطبيق آخر',
      message: 'الكاميرا مفتوحة حاليًا في برنامج أو تبويب آخر. أغلقه ثم حاول مرة أخرى.',
    };
  }
  if (errName === 'WebGLUnsupportedError') {
    return {
      code: 'WEBGL_UNSUPPORTED',
      title: 'الجهاز لا يدعم تسريع الرسوميات',
      message: 'تعذر تشغيل محرك التتبع على هذا الجهاز لعدم توفر دعم كافٍ للرسوميات (WebGL/WASM).',
    };
  }
  return {
    code: 'UNKNOWN',
    title: 'تعذر تشغيل الكاميرا',
    message: 'حدث خطأ أثناء فتح الكاميرا. تأكد من الأذونات وحاول مرة أخرى.',
  };
}

export function tryOnCategoryLabelAr(cat: TryOnCategory | ResolvedTryOnCategory): string {
  switch (cat) {
    case 'top':
      return 'قطعة علوية (تيشيرت / سويت شيرت / هودي / قميص)';
    case 'trousers':
      return 'بنطلون / شورت';
    case 'full_outfit':
      return 'طقم كامل';
    case 'unsupported':
      return 'إكسسوار / حذاء (غير مدعوم للتجربة على الجسم)';
    default:
      return 'تحديد تلقائي حسب القسم والاسم';
  }
}

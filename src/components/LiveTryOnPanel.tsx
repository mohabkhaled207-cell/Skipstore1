import React, { useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { Camera, RefreshCw, ShieldCheck, SlidersHorizontal, SwitchCamera, X } from 'lucide-react';
import { Product } from '../utils/store';
import {
  CameraErrorInfo,
  detectDevicePerformanceProfile,
  getCameraErrorArabic,
  inferTryOnCategory,
  isValidTryOnAssetUrl,
  mergeTryOnConfig,
  tryOnCategoryLabelAr,
} from '../utils/tryOn';
import { teardownTryOnSession } from '../utils/tryOnPrivacy';
import {
  createInitialFrameState,
  createLocalPoseLandmarker,
  isWebGLSupported,
  renderTryOnFrame,
} from '../utils/tryOnRenderer';

interface LiveTryOnPanelProps {
  product: Product;
  isAdmin: boolean;
  onClose: () => void;
  onOpenAdminEdit?: (product: Product) => void;
}

type TryOnStatus = 'initializing' | 'active' | 'error';

export const LiveTryOnPanel: React.FC<LiveTryOnPanelProps> = ({
  product,
  isAdmin,
  onClose,
  onOpenAdminEdit,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const occlusionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const garmentImgRef = useRef<HTMLImageElement | null>(null);
  const frameStateRef = useRef(createInitialFrameState());

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [perfMode, setPerfMode] = useState<'auto' | 'low'>('auto');
  const [status, setStatus] = useState<TryOnStatus>('initializing');
  const [statusText, setStatusText] = useState('جاري طلب إذن الكاميرا وتجهيز التتبع المحلي...');
  const [poseDetected, setPoseDetected] = useState(false);
  const [garmentVisible, setGarmentVisible] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [errorInfo, setErrorInfo] = useState<CameraErrorInfo | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const resolvedCategory = inferTryOnCategory(product);
  const hasValidAsset = isValidTryOnAssetUrl(product.tryOnAssetUrl);
  const mergedConfig = mergeTryOnConfig(resolvedCategory, product.tryOnConfig);

  // Preload transparent garment image in memory when tryOnAssetUrl is configured
  useEffect(() => {
    garmentImgRef.current = null;
    if (!hasValidAsset || !product.tryOnAssetUrl) return;

    let cancelled = false;
    const img = new Image();
    if (/^https?:\/\//i.test(product.tryOnAssetUrl)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (!cancelled) {
        garmentImgRef.current = img;
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        garmentImgRef.current = null;
      }
    };
    img.src = product.tryOnAssetUrl;

    return () => {
      cancelled = true;
      garmentImgRef.current = null;
    };
  }, [hasValidAsset, product.tryOnAssetUrl]);

  // Strict privacy teardown helper
  const cleanupEverything = () => {
    const report = teardownTryOnSession({
      stream: streamRef.current,
      video: videoRef.current,
      canvases: [
        displayCanvasRef.current,
        inferenceCanvasRef.current,
        occlusionCanvasRef.current,
        maskCanvasRef.current,
      ].filter((c): c is HTMLCanvasElement => !!c),
      rafId: rafRef.current,
      tasks: landmarkerRef.current ? [landmarkerRef.current] : [],
      onMemoryCleared: () => {
        streamRef.current = null;
        rafRef.current = null;
        landmarkerRef.current = null;
        frameStateRef.current = createInitialFrameState();
      },
    });
    return report;
  };

  // Start local camera & lazy-load MediaPipe ONLY after explicit user action opened this panel
  useEffect(() => {
    let cancelled = false;

    async function startTryOnSession() {
      cleanupEverything();
      setStatus('initializing');
      setErrorInfo(null);
      setPoseDetected(false);
      setGarmentVisible(false);
      setStatusText('جاري طلب إذن الكاميرا وتجهيز التتبع المحلي...');

      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const secure = typeof window !== 'undefined' ? window.isSecureContext || isLocalhost : true;
      const hasMedia =
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

      if (!secure || !hasMedia) {
        setStatus('error');
        setErrorInfo(getCameraErrorArabic('NotSupportedError', secure, hasMedia));
        return;
      }

      const webglAvailable = isWebGLSupported();
      const hwThreads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
      const profile = detectDevicePerformanceProfile(hwThreads, webglAvailable, perfMode);

      try {
        // 1. Request live camera stream (never recorded, never uploaded)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: profile.tier === 'high' ? 720 : 480 },
            height: { ideal: profile.tier === 'high' ? 960 : 640 },
            frameRate: { ideal: profile.targetFps, max: 30 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Detect multiple cameras (front/back) after permission grant
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          if (!cancelled) {
            setHasMultipleCameras(videoInputs.length > 1);
          }
        } catch {}

        const videoEl = videoRef.current;
        if (!videoEl) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.playsInline = true;
        await videoEl.play();

        if (cancelled) {
          cleanupEverything();
          return;
        }

        setStatusText('جاري تحميل نموذج تتبع الجسم محليًا...');

        // 2. Lazy-load MediaPipe Pose Landmarker only now
        let landmarker: PoseLandmarker | null = null;
        try {
          landmarker = await createLocalPoseLandmarker(
            profile.delegate,
            profile.enableArmOcclusion && mergedConfig.armOcclusion && hasValidAsset
          );
        } catch (mlErr: any) {
          if (!cancelled) {
            setStatus('error');
            setErrorInfo(
              getCameraErrorArabic(
                mlErr?.name || 'WebGLUnsupportedError',
                secure,
                hasMedia
              )
            );
            cleanupEverything();
          }
          return;
        }

        if (cancelled) {
          landmarker.close();
          cleanupEverything();
          return;
        }

        landmarkerRef.current = landmarker;

        // Allocate reusable offscreen canvases in memory only
        if (!inferenceCanvasRef.current) {
          inferenceCanvasRef.current = document.createElement('canvas');
        }
        if (!occlusionCanvasRef.current) {
          occlusionCanvasRef.current = document.createElement('canvas');
        }
        if (!maskCanvasRef.current) {
          maskCanvasRef.current = document.createElement('canvas');
        }

        setStatus('active');
        setStatusText('قف أمام الكاميرا ليظهر الطقم على جسمك');

        let lastUiSync = 0;

        const loop = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const dc = displayCanvasRef.current;
          const ic = inferenceCanvasRef.current;
          const oc = occlusionCanvasRef.current;
          const mc = maskCanvasRef.current;

          if (v && dc && ic && oc && mc && v.readyState >= 2) {
            const nowMs = performance.now();
            const res = renderTryOnFrame({
              video: v,
              displayCanvas: dc,
              inferenceCanvas: ic,
              occlusionCanvas: oc,
              maskCanvas: mc,
              landmarker: landmarkerRef.current,
              garmentImage: garmentImgRef.current,
              category: resolvedCategory,
              config: mergedConfig,
              mirrored: facingMode === 'user',
              inferenceIntervalMs: profile.inferenceIntervalMs,
              inferenceWidth: profile.inferenceWidth,
              inferenceHeight: profile.inferenceHeight,
              enableArmOcclusion: profile.enableArmOcclusion,
              frameState: frameStateRef.current,
              nowMs,
            });

            if (nowMs - lastUiSync > 180) {
              lastUiSync = nowMs;
              setPoseDetected(res.poseDetected);
              setGarmentVisible(res.garmentVisible);
              if (!hasValidAsset) {
                setStatusText(
                  res.poseDetected
                    ? 'تم اكتشاف الجسم — المنتج يحتاج تجهيز طبقة شفافة'
                    : 'تم تشغيل الكاميرا — قف أمام الكاميرا'
                );
              } else if (res.poseDetected && res.garmentVisible) {
                setStatusText('تم اكتشاف الجسم — تحرك بحرية أمام الكاميرا');
              } else {
                setStatusText('قف أمام الكاميرا مع إظهار الكتفين لظهور القطعة');
              }
            }
          }

          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err: any) {
        if (!cancelled) {
          setStatus('error');
          setErrorInfo(getCameraErrorArabic(err?.name || 'UnknownError', secure, hasMedia));
          cleanupEverything();
        }
      }
    }

    startTryOnSession();

    const handlePageExit = () => {
      cleanupEverything();
    };
    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
      cleanupEverything();
    };
  }, [facingMode, perfMode, retryToken, resolvedCategory, hasValidAsset]);

  const handleCloseClick = () => {
    cleanupEverything();
    onClose();
  };

  return (
    <div className="ar-tryon-wrap" data-testid="tryon-panel" data-tryon-status={status}>
      {/* Hidden live <video> element strictly in-memory */}
      <video ref={videoRef} className="vh" playsInline muted autoPlay aria-hidden="true" />

      {/* Top Try-On Header */}
      <div className="ar-tryon-head">
        <div>
          <h3 className="ar-tryon-title">
            <Camera size={20} aria-hidden="true" />
            <span>التجربة المباشرة بالكاميرا</span>
          </h3>
          <p className="ar-tryon-sub">{product.name}</p>
        </div>
        <button
          type="button"
          className="btn btn-line btn-sm"
          onClick={handleCloseClick}
          data-testid="tryon-close-btn"
        >
          <X size={18} aria-hidden="true" />
          <span>إغلاق الكاميرا والعودة للمنتج</span>
        </button>
      </div>

      {/* Missing transparent asset warning for owner / transparent preview info for customer */}
      {!hasValidAsset && (
        <div className="ar-notice" role="note" data-testid="tryon-missing-asset-notice">
          <div className="ar-notice-body">
            <strong>
              {isAdmin
                ? 'هذا المنتج يحتاج إلى تجهيز أصل بصري شفاف (PNG أو WebP) للتجربة المباشرة.'
                : 'معاينة المتجر: لم يتم تجهيز طبقة ملابس شفافة مخصصة لهذه القطعة بعد.'}
            </strong>
            <span>
              {isAdmin
                ? 'يمكنك رفع صورة ملابس بخلفية شفافة من لوحة تعديل القطعة دون التأثير على صورة المنتج الأساسية.'
                : 'تظهر صورة القطعة الأصلية بجانب الكاميرا كمرجع بينما يعمل تتبع الجسم محليًا.'}
            </span>
          </div>
          {isAdmin && onOpenAdminEdit && (
            <button
              type="button"
              className="btn btn-brand btn-sm"
              onClick={() => {
                cleanupEverything();
                onOpenAdminEdit(product);
              }}
            >
              تجهيز أصل التجربة
            </button>
          )}
        </div>
      )}

      {resolvedCategory === 'unsupported' && (
        <div className="ar-notice" role="note">
          <div className="ar-notice-body">
            <strong>هذه الفئة ({product.category || 'إكسسوار/حذاء'}) غير مخصصة للتلبيس على الجسم حاليًا.</strong>
            <span>التجربة المباشرة بالكاميرا مصممة للتيشيرتات والقطع العلوية والبنطلونات فقط.</span>
          </div>
        </div>
      )}

      {/* Main Live AR Stage */}
      <div className="ar-stage-grid">
        <div className="ar-stage-box">
          {status === 'error' && errorInfo ? (
            <div className="ar-error-box" role="alert" data-testid="tryon-error">
              <Camera size={36} aria-hidden="true" />
              <h4>{errorInfo.title}</h4>
              <p>{errorInfo.message}</p>
              <div className="ar-error-actions">
                <button
                  type="button"
                  className="btn btn-brand btn-sm"
                  onClick={() => setRetryToken((t) => t + 1)}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>إعادة المحاولة</span>
                </button>
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  onClick={handleCloseClick}
                >
                  العودة لصفحة المنتج
                </button>
              </div>
            </div>
          ) : (
            <>
              <canvas
                ref={displayCanvasRef}
                className="ar-canvas"
                data-testid="tryon-canvas"
                aria-label="بث الكاميرا المباشر مع تجربة الملابس"
              />

              {/* Simple Body Detection Status Indicator */}
              <div
                className={`ar-detect-pill ${poseDetected ? 'detected' : 'searching'}`}
                role="status"
                data-testid="tryon-detection-status"
              >
                <span className="ar-detect-dot" aria-hidden="true" />
                <span>{statusText}</span>
              </div>

              {status === 'initializing' && (
                <div className="ar-loading-veil">
                  <div className="ar-spinner" aria-hidden="true" />
                  <span>{statusText}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Side Info & Controls */}
        <div className="ar-side-panel">
          <div className="ar-ref-card">
            <span className="ar-ref-label">القطعة المختارة</span>
            {product.image && (
              <img
                src={product.image}
                alt={product.name}
                className="ar-ref-thumb"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="ar-ref-meta">
              <strong>{product.name}</strong>
              <span>{tryOnCategoryLabelAr(resolvedCategory)}</span>
            </div>
          </div>

          <div className="ar-controls-group">
            <button
              type="button"
              className="btn btn-line btn-sm"
              onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
              disabled={status === 'initializing'}
              data-testid="tryon-switch-camera"
            >
              <SwitchCamera size={17} aria-hidden="true" />
              <span>
                {facingMode === 'user'
                  ? hasMultipleCameras
                    ? 'التبديل للكاميرا الخلفية'
                    : 'تجربة الكاميرا الخلفية'
                  : 'التبديل للكاميرا الأمامية'}
              </span>
            </button>

            <button
              type="button"
              className="btn btn-line btn-sm"
              onClick={() => setPerfMode((p) => (p === 'auto' ? 'low' : 'auto'))}
              data-testid="tryon-perf-toggle"
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
              <span>
                {perfMode === 'auto'
                  ? 'الأداء: تلقائي (جودة عالية)'
                  : 'الأداء: وضع موفر للأجهزة الضعيفة'}
              </span>
            </button>
          </div>

          <div className="ar-privacy-box" data-testid="tryon-privacy-notice">
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>خصوصيتك محمية 100%</strong>
              <p>
                تتم معالجة بث الكاميرا محليًا داخل متصفحك فقط، ولا يتم حفظ أو التقاط أو رفع أي صورة أو بيانات جسم لأي سيرفر أو قاعدة بيانات.
              </p>
            </div>
          </div>

          {hasValidAsset && (
            <p className="ar-hint-text">
              {garmentVisible
                ? 'تم تثبيت القطعة على الكتفين والخصر — جرّب التحرك يمينًا ويسارًا أو الاقتراب والابتعاد.'
                : 'نصيحة: ارجع خطوة للخلف في إضاءة واضحة حتى يظهر الجذع والكتفان داخل الإطار.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

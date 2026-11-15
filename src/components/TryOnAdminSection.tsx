import React, { useState } from 'react';
import { Sparkles, Trash2, Upload } from 'lucide-react';
import { DEFAULT_TRY_ON_CONFIG, TryOnCategory, TryOnConfig } from '../utils/store';
import { isValidTryOnAssetUrl, tryOnCategoryLabelAr } from '../utils/tryOn';
import { convertImageToTransparentPngLocal } from '../utils/tryOnRenderer';

interface TryOnAdminSectionProps {
  productImage: string;
  tryOnAssetUrl: string;
  tryOnCategory: TryOnCategory;
  tryOnConfig: TryOnConfig;
  onChangeAssetUrl: (url: string) => void;
  onChangeCategory: (cat: TryOnCategory) => void;
  onChangeConfig: (cfg: TryOnConfig) => void;
}

export const TryOnAdminSection: React.FC<TryOnAdminSectionProps> = ({
  productImage,
  tryOnAssetUrl,
  tryOnCategory,
  tryOnConfig,
  onChangeAssetUrl,
  onChangeCategory,
  onChangeConfig,
}) => {
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleTransparentFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalError('');

    const isTransparentMime = file.type === 'image/png' || file.type === 'image/webp';
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 760;
        const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * ratio));
        const h = Math.max(1, Math.round(img.naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const outMime = isTransparentMime ? file.type : 'image/png';
          const outUrl = canvas.toDataURL(outMime, 0.9);
          canvas.width = 0;
          canvas.height = 0;
          onChangeAssetUrl(outUrl);
        }
      };
      img.onerror = () => setLocalError('تعذر قراءة ملف الصورة المختار');
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAutoCutoutFromMainImage = async () => {
    if (!productImage) {
      setLocalError('أضف صورة المنتج الأساسية أولاً أو ارفع ملف PNG شفاف مباشرة.');
      return;
    }
    setCutoutBusy(true);
    setLocalError('');
    try {
      const transparentPng = await convertImageToTransparentPngLocal(productImage, 62);
      onChangeAssetUrl(transparentPng);
    } catch {
      setLocalError('تعذر فصل الخلفية تلقائيًا. يُفضّل رفع صورة PNG أو WebP بخلفية شفافة.');
    } finally {
      setCutoutBusy(false);
    }
  };

  const assetReady = isValidTryOnAssetUrl(tryOnAssetUrl);

  return (
    <div className="ar-admin-box" data-testid="admin-tryon-section">
      <div className="ar-admin-head">
        <div>
          <h4>إعدادات تجربة الملابس بالكاميرا (Live AR)</h4>
          <p>
            اختياري — يُضاف أصل التجربة الشفاف هنا دون التأثير على صورة المنتج الأساسية في المتجر.
          </p>
        </div>
        <span className={`ar-admin-badge ${assetReady ? 'ready' : 'pending'}`}>
          {assetReady ? 'جاهز للتجربة' : 'يحتاج أصل شفاف'}
        </span>
      </div>

      {/* Asset Preview + Upload */}
      <div className="field">
        <span className="lbl">صورة الملابس الشفافة (PNG أو WebP)</span>
        <div className="imgrow">
          <div className="prev ar-checker-prev">
            {tryOnAssetUrl ? (
              <img src={tryOnAssetUrl} alt="معاينة أصل AR" />
            ) : (
              <span className="ar-prev-empty">PNG / WebP</span>
            )}
          </div>
          <div className="ar-admin-upload-btns">
            <label className="btn btn-line btn-sm" htmlFor="tryon-asset-file">
              <Upload size={15} aria-hidden="true" />
              <span>{tryOnAssetUrl ? 'تغيير ملف PNG/WebP' : 'رفع PNG / WebP شفاف'}</span>
            </label>
            <input
              id="tryon-asset-file"
              className="vh"
              type="file"
              accept="image/png,image/webp,image/*"
              onChange={handleTransparentFileUpload}
            />

            {productImage && (
              <button
                type="button"
                className="btn btn-line btn-sm"
                onClick={handleAutoCutoutFromMainImage}
                disabled={cutoutBusy}
              >
                <Sparkles size={15} aria-hidden="true" />
                <span>{cutoutBusy ? 'جاري التفريغ...' : 'تفريغ خلفية الصورة محليًا'}</span>
              </button>
            )}

            {tryOnAssetUrl && (
              <button
                type="button"
                className="btn btn-line btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={() => onChangeAssetUrl('')}
              >
                <Trash2 size={15} aria-hidden="true" />
                <span>إزالة أصل التجربة</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Optional direct URL input */}
      <div className="field">
        <label htmlFor="p-tryon-url">أو رابط مباشر لصورة PNG/WebP شفافة (اختياري)</label>
        <input
          id="p-tryon-url"
          type="text"
          dir="ltr"
          placeholder="https://.../garment-transparent.png"
          value={tryOnAssetUrl.startsWith('data:') ? '' : tryOnAssetUrl}
          onChange={(e) => onChangeAssetUrl(e.target.value)}
        />
      </div>

      {/* Try-On Category */}
      <div className="field">
        <label htmlFor="p-tryon-cat">نوع القطعة في تتبع الجسم (tryOnCategory)</label>
        <select
          id="p-tryon-cat"
          className="ar-select"
          value={tryOnCategory}
          onChange={(e) => onChangeCategory(e.target.value as TryOnCategory)}
        >
          <option value="auto">{tryOnCategoryLabelAr('auto')}</option>
          <option value="top">{tryOnCategoryLabelAr('top')}</option>
          <option value="trousers">{tryOnCategoryLabelAr('trousers')}</option>
          <option value="full_outfit">{tryOnCategoryLabelAr('full_outfit')}</option>
        </select>
      </div>

      {/* Anchor / Scale / Offset Controls + Mannequin Preview */}
      <div className="ar-config-grid">
        <div className="ar-sliders">
          <div className="ar-slider-row">
            <label htmlFor="cfg-sx">عرض القطعة ({Math.round(tryOnConfig.scaleX * 100)}%)</label>
            <input
              id="cfg-sx"
              type="range"
              min="0.6"
              max="1.5"
              step="0.02"
              value={tryOnConfig.scaleX}
              onChange={(e) => onChangeConfig({ ...tryOnConfig, scaleX: Number(e.target.value) })}
            />
          </div>
          <div className="ar-slider-row">
            <label htmlFor="cfg-sy">طول القطعة ({Math.round(tryOnConfig.scaleY * 100)}%)</label>
            <input
              id="cfg-sy"
              type="range"
              min="0.6"
              max="1.5"
              step="0.02"
              value={tryOnConfig.scaleY}
              onChange={(e) => onChangeConfig({ ...tryOnConfig, scaleY: Number(e.target.value) })}
            />
          </div>
          <div className="ar-slider-row">
            <label htmlFor="cfg-oy">الإزاحة الرأسية ({Math.round(tryOnConfig.offsetY * 100)}%)</label>
            <input
              id="cfg-oy"
              type="range"
              min="-0.25"
              max="0.25"
              step="0.01"
              value={tryOnConfig.offsetY}
              onChange={(e) => onChangeConfig({ ...tryOnConfig, offsetY: Number(e.target.value) })}
            />
          </div>
          <div className="ar-slider-row">
            <label htmlFor="cfg-ox">الإزاحة الأفقية ({Math.round(tryOnConfig.offsetX * 100)}%)</label>
            <input
              id="cfg-ox"
              type="range"
              min="-0.2"
              max="0.2"
              step="0.01"
              value={tryOnConfig.offsetX}
              onChange={(e) => onChangeConfig({ ...tryOnConfig, offsetX: Number(e.target.value) })}
            />
          </div>

          <label className="check" style={{ marginTop: '6px', marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={tryOnConfig.armOcclusion}
              onChange={(e) => onChangeConfig({ ...tryOnConfig, armOcclusion: e.target.checked })}
            />
            <span>إظهار الذراعين أمام الملابس عند الحركة (قناع الجسم)</span>
          </label>

          <button
            type="button"
            className="btn btn-line btn-sm"
            style={{ alignSelf: 'flex-start', marginTop: '6px' }}
            onClick={() => onChangeConfig({ ...DEFAULT_TRY_ON_CONFIG })}
          >
            إعادة ضبط الإعدادات الافتراضية
          </button>
        </div>

        {/* Live Silhouette Anchor Preview */}
        <div className="ar-mannequin-preview" aria-label="معاينة نقطة ارتكاز القطعة">
          <svg viewBox="0 0 120 180" width="110" height="165" aria-hidden="true">
            <circle cx="60" cy="22" r="12" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
            <path
              d="M32 48 C40 38, 80 38, 88 48 L98 92 L86 95 L80 62 L76 112 L80 166 L64 166 L60 118 L56 166 L40 166 L44 112 L40 62 L34 95 L22 92 Z"
              fill="currentColor"
              opacity="0.14"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line x1="34" y1="48" x2="86" y2="48" stroke="var(--brand-deep)" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="42" y1="106" x2="78" y2="106" stroke="var(--brand-deep)" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
          {tryOnAssetUrl && (
            <img
              src={tryOnAssetUrl}
              alt=""
              className="ar-mannequin-overlay"
              style={{
                transform: `translate(${tryOnConfig.offsetX * 60}px, ${tryOnConfig.offsetY * 90}px) scale(${tryOnConfig.scaleX}, ${tryOnConfig.scaleY})`,
              }}
            />
          )}
        </div>
      </div>

      {localError && (
        <p className="err" role="alert">
          {localError}
        </p>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { Camera, Sparkles } from 'lucide-react';
import { Product } from '../utils/store';
import { inferTryOnCategory, isLiveTryOnCategory, isValidTryOnAssetUrl } from '../utils/tryOn';
import { LiveTryOnPanel } from './LiveTryOnPanel';
import { PhotoTryOnPanel } from './PhotoTryOnPanel';

interface VirtualTryOnPanelProps {
  product: Product;
  isAdmin: boolean;
  onClose: () => void;
  onOpenAdminEdit?: (product: Product) => void;
}

type TryOnMode = 'live' | 'photo';

/**
 * نقطة الدخول الوحيدة للتجربة داخل المتجر:
 * - لايف بالكاميرا: للتيشيرتات (القطع العلوية) والبناطيل فقط، وبتحتاج صورة قطعة شفافة (PNG/WebP).
 * - بالصورة (FASHN): لباقي الملابس، أو لو القطعة لسه مجهزلهاش أصل شفاف.
 */
export const VirtualTryOnPanel: React.FC<VirtualTryOnPanelProps> = ({
  product,
  isAdmin,
  onClose,
  onOpenAdminEdit,
}) => {
  const liveSupported = isLiveTryOnCategory(inferTryOnCategory(product));
  const liveReady = liveSupported && isValidTryOnAssetUrl(product.tryOnAssetUrl);
  // المالك يقدر يفتح اللايف حتى لو الأصل ناقص عشان يوصل لزرار "تجهيز أصل التجربة"
  const liveEnabled = liveReady || (liveSupported && isAdmin);

  const [mode, setMode] = useState<TryOnMode>(liveReady ? 'live' : 'photo');
  const activeMode: TryOnMode = mode === 'live' && !liveEnabled ? 'photo' : mode;

  return (
    <div className="tryon-switcher" data-testid="tryon-switcher">
      {liveSupported && (
        <div className="tryon-mode-tabs" role="tablist" aria-label="طريقة التجربة">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'live'}
            className={`tryon-mode-tab ${activeMode === 'live' ? 'active' : ''}`}
            onClick={() => setMode('live')}
            disabled={!liveEnabled}
            title={liveEnabled ? undefined : 'التجربة اللايف لسه مجهزة لهذه القطعة'}
            data-testid="tryon-tab-live"
          >
            <Camera size={16} aria-hidden="true" />
            <span>لايف بالكاميرا</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'photo'}
            className={`tryon-mode-tab ${activeMode === 'photo' ? 'active' : ''}`}
            onClick={() => setMode('photo')}
            data-testid="tryon-tab-photo"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>على صورتك (AI)</span>
          </button>
        </div>
      )}

      {liveSupported && !liveEnabled && (
        <p className="tryon-mode-hint" role="note">
          التجربة اللايف بالكاميرا هتتوفر لهذه القطعة قريبًا، وتقدر تجربها دلوقتي على صورتك.
        </p>
      )}

      {activeMode === 'live' ? (
        <LiveTryOnPanel
          product={product}
          isAdmin={isAdmin}
          onClose={onClose}
          onOpenAdminEdit={onOpenAdminEdit}
        />
      ) : (
        <PhotoTryOnPanel product={product} onClose={onClose} />
      )}
    </div>
  );
};

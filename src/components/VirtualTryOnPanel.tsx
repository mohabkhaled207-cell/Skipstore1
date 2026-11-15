import React, { useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Product } from '../utils/store';

interface VirtualTryOnPanelProps {
  product: Product;
  isAdmin: boolean;
  onClose: () => void;
  onOpenAdminEdit?: (product: Product) => void;
}

const MAX_FILE_BYTES = 12 * 1024 * 1024;

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('من فضلك اختر صورة بصيغة JPG أو PNG أو WebP.');
  if (file.size > MAX_FILE_BYTES) throw new Error('حجم الصورة كبير. اختر صورة أقل من 12 ميجابايت.');

  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر تجهيز الصورة على هذا الجهاز.');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.toDataURL('image/jpeg', 0.84);
}

export const VirtualTryOnPanel: React.FC<VirtualTryOnPanelProps> = ({ product, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photo, setPhoto] = useState<string>('');
  const [photoName, setPhotoName] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const handlePhoto = async (file?: File) => {
    if (!file) return;
    setError('');
    setResult('');
    try {
      const data = await compressPhoto(file);
      setPhoto(data);
      setPhotoName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر قراءة الصورة.');
    }
  };

  const generate = async () => {
    if (!photo) {
      setError('ارفع صورتك أولاً علشان نقدر نعرض الملابس عليك.');
      return;
    }
    if (!consent) {
      setError('لازم توافق على إرسال الصور إلى Google لمعالجة تجربة الملابس.');
      return;
    }
    if (!product.image) {
      setError('صورة المنتج غير متاحة حالياً.');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');
    try {
      const response = await fetch('/api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personImage: photo,
          productImageUrl: product.image,
          productName: product.name,
          productCategory: product.category,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'تعذر إنشاء صورة التجربة. حاول مرة أخرى.');
      }
      if (!data.image || !data.mimeType) {
        throw new Error('وصل رد غير مكتمل من خدمة توليد الصور.');
      }
      setResult(`data:${data.mimeType};base64,${data.image}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء توليد الصورة.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="ai-tryon-panel" data-testid="tryon-panel">
      <header className="ai-tryon-header">
        <div>
          <span className="ai-tryon-kicker"><Sparkles size={15} /> تجربة بالذكاء الاصطناعي</span>
          <h3>شوف شكل القطعة عليك</h3>
          <p>{product.name} — من غير كاميرا مباشرة أو موديل 3D</p>
        </div>
        <button type="button" className="ai-tryon-close" onClick={onClose} aria-label="إغلاق"><X size={20} /></button>
      </header>

      <div className="ai-tryon-product">
        {product.image && <img src={product.image} alt={product.name} />}
        <div><strong>{product.name}</strong><span>{product.category || 'ملابس'}</span></div>
      </div>

      {!result ? (
        <>
          <div className="ai-tryon-upload">
            {photo ? (
              <img className="ai-tryon-person-preview" src={photo} alt="معاينة صورتك" />
            ) : (
              <div className="ai-tryon-upload-empty"><ImagePlus size={34} /><strong>ارفع صورة واضحة ليك</strong><span>يفضل صورة كاملة للجسم، من الأمام، بإضاءة جيدة</span></div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => handlePhoto(event.target.files?.[0])}
            />
            <button type="button" className="btn btn-line" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={17} /> {photo ? 'تغيير الصورة' : 'اختيار صورة من الجهاز'}
            </button>
            {photoName && <small>{photoName}</small>}
          </div>

          <label className="ai-tryon-consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>أوافق على إرسال صورتي وصورة المنتج إلى Google Gemini لتوليد صورة تجربة الملابس. لن يحفظ موقع SKIP الصور في قاعدة بيانات المتجر.</span>
          </label>

          {error && <p className="ai-tryon-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-brand ai-tryon-generate" onClick={generate} disabled={loading || !photo || !consent}>
            {loading ? <><Loader2 size={18} className="ai-tryon-spin" /> جاري توليد الصورة...</> : <><Sparkles size={18} /> جرّب الملابس على صورتي</>}
          </button>
          <p className="ai-tryon-note"><ShieldCheck size={15} /> التجربة صورة مولّدة وليست قياساً دقيقاً للمقاس أو ضماناً لشكل القماش على الطبيعة.</p>
        </>
      ) : (
        <div className="ai-tryon-result">
          <img src={result} alt="نتيجة تجربة الملابس بالذكاء الاصطناعي" />
          <div className="ai-tryon-result-actions">
            <a className="btn btn-brand" href={result} download={`SKIP-try-on-${product.id}.png`}><Download size={17} /> تنزيل الصورة</a>
            <button type="button" className="btn btn-line" onClick={() => setResult('')}>تجربة صورة أخرى</button>
          </div>
        </div>
      )}

      {error && result && <p className="ai-tryon-error" role="alert">{error}</p>}
      <p className="ai-tryon-footer">تجربة الملابس بواسطة Nano Banana Pro من Google</p>
    </section>
  );
};

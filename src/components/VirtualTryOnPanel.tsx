import React, { useRef, useState } from 'react';
import { Client, handle_file } from '@gradio/client';
import { Download, ImagePlus, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Product } from '../utils/store';
import { inferTryOnCategory } from '../utils/tryOn';

interface VirtualTryOnPanelProps {
  product: Product;
  isAdmin: boolean;
  onClose: () => void;
  onOpenAdminEdit?: (product: Product) => void;
}

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const HF_SPACE = 'fashn-ai/fashn-vton-1.5';
const HF_SPACE_ORIGIN = 'https://fashn-ai-fashn-vton-1-5.hf.space';
let spaceClientPromise: ReturnType<typeof Client.connect> | null = null;

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

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('تعذر ضغط الصورة على هذا الجهاز.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('تعذر قراءة الصورة بعد تجهيزها.'));
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.84);
  });
}

function dataUriToBlob(dataUri: string): Blob {
  const match = new RegExp('^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)
  if (!match) throw new Error('تعذر تجهيز صورة الزبون للإرسال.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

function getTryOnOutputUrl(value: unknown): string {
  if (typeof value === 'string') {
    return value.startsWith('http') ? value : new URL(value, HF_SPACE_ORIGIN).toString();
  }
  if (value && typeof value === 'object') {
    const output = value as { url?: unknown; path?: unknown };
    if (typeof output.url === 'string' && output.url) {
      return new URL(output.url, HF_SPACE_ORIGIN).toString();
    }
    if (typeof output.path === 'string' && output.path) {
      return new URL(`/gradio_api/file=${encodeURIComponent(output.path)}`, HF_SPACE_ORIGIN).toString();
    }
  }
  throw new Error('لم يرجع محرك التجربة صورة صالحة. حاول مرة أخرى.');
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
      setError('لازم توافق على إرسال الصور إلى خدمة FASHN على Hugging Face.');
      return;
    }
    if (!product.image) {
      setError('صورة المنتج غير متاحة حالياً.');
      return;
    }

    const resolvedCategory = inferTryOnCategory(product);
    if (resolvedCategory === 'unsupported') {
      setError('التجربة الحالية تدعم الملابس فقط، ولا تدعم الأحذية أو الحقائب والإكسسوارات.');
      return;
    }

    const category = resolvedCategory === 'trousers'
      ? 'bottoms'
      : resolvedCategory === 'full_outfit'
        ? 'one-pieces'
        : 'tops';

    setLoading(true);
    setError('');
    setResult('');
    try {
      if (!spaceClientPromise) {
        spaceClientPromise = Client.connect(HF_SPACE);
      }
      const client = await spaceClientPromise;
      const personFile = handle_file(dataUriToBlob(photo));
      const garmentFile = product.image.startsWith('data:')
        ? handle_file(dataUriToBlob(product.image))
        : handle_file(product.image);

      const response = await client.predict('/try_on', [
        personFile,
        garmentFile,
        category,
        'model',
        30,
        1.5,
        42,
        true,
      ]);

      const imageOutput = Array.isArray(response.data) ? response.data[0] : null;
      setResult(getTryOnOutputUrl(imageOutput));
    } catch (err) {
      console.error('FASHN virtual try-on failed:', err);
      spaceClientPromise = null;
      const message = err instanceof Error ? err.message : '';
      if (/429|rate|quota|limit/i.test(message)) {
        setError('الخدمة المجانية مزدحمة أو وصلت إلى حد الاستخدام المؤقت. انتظر قليلاً ثم حاول مرة أخرى.');
      } else if (/space|connect|fetch|network|offline/i.test(message)) {
        setError('تعذر الاتصال بخدمة التجربة المجانية حالياً. قد تكون الخدمة نائمة أو مزدحمة؛ حاول مرة أخرى بعد قليل.');
      } else {
        setError(message || 'تعذر إنشاء صورة التجربة حالياً. جرّب صورة أوضح وإضاءة أفضل.');
      }
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
          <p>{product.name} — صورة مولّدة بدون كاميرا مباشرة أو موديل 3D</p>
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
            <span>أوافق على إرسال صورتي وصورة المنتج إلى خدمة FASHN على Hugging Face لمعالجة تجربة الملابس. لن يحفظ موقع SKIP الصور في قاعدة بيانات المتجر.</span>
          </label>

          {error && <p className="ai-tryon-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-brand ai-tryon-generate" onClick={generate} disabled={loading || !photo || !consent}>
            {loading ? <><Loader2 size={18} className="ai-tryon-spin" /> جاري تجهيز التجربة، قد يوجد انتظار...</> : <><Sparkles size={18} /> جرّب الملابس على صورتي</>}
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
      <p className="ai-tryon-footer">المحرك: FASHN VTON 1.5 مفتوح المصدر عبر Hugging Face Spaces. الاستخدام المجاني يعتمد على توفر GPU والحدود المؤقتة للخدمة.</p>
    </section>
  );
};
).exec(dataUri);
  if (!match) throw new Error('تعذر تجهيز صورة الزبون للإرسال.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

function getTryOnOutputUrl(value: unknown): string {
  if (typeof value === 'string') {
    return value.startsWith('http') ? value : new URL(value, HF_SPACE_ORIGIN).toString();
  }
  if (value && typeof value === 'object') {
    const output = value as { url?: unknown; path?: unknown };
    if (typeof output.url === 'string' && output.url) {
      return new URL(output.url, HF_SPACE_ORIGIN).toString();
    }
    if (typeof output.path === 'string' && output.path) {
      return new URL(`/gradio_api/file=${encodeURIComponent(output.path)}`, HF_SPACE_ORIGIN).toString();
    }
  }
  throw new Error('لم يرجع محرك التجربة صورة صالحة. حاول مرة أخرى.');
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
      setError('لازم توافق على إرسال الصور إلى خدمة FASHN على Hugging Face.');
      return;
    }
    if (!product.image) {
      setError('صورة المنتج غير متاحة حالياً.');
      return;
    }

    const resolvedCategory = inferTryOnCategory(product);
    if (resolvedCategory === 'unsupported') {
      setError('التجربة الحالية تدعم الملابس فقط، ولا تدعم الأحذية أو الحقائب والإكسسوارات.');
      return;
    }

    const category = resolvedCategory === 'trousers'
      ? 'bottoms'
      : resolvedCategory === 'full_outfit'
        ? 'one-pieces'
        : 'tops';

    setLoading(true);
    setError('');
    setResult('');
    try {
      if (!spaceClientPromise) {
        spaceClientPromise = Client.connect(HF_SPACE);
      }
      const client = await spaceClientPromise;
      const personFile = handle_file(dataUriToBlob(photo));
      const garmentFile = product.image.startsWith('data:')
        ? handle_file(dataUriToBlob(product.image))
        : handle_file(product.image);

      const response = await client.predict('/try_on', [
        personFile,
        garmentFile,
        category,
        'model',
        30,
        1.5,
        42,
        true,
      ]);

      const imageOutput = Array.isArray(response.data) ? response.data[0] : null;
      setResult(getTryOnOutputUrl(imageOutput));
    } catch (err) {
      console.error('FASHN virtual try-on failed:', err);
      spaceClientPromise = null;
      const message = err instanceof Error ? err.message : '';
      if (/429|rate|quota|limit/i.test(message)) {
        setError('الخدمة المجانية مزدحمة أو وصلت إلى حد الاستخدام المؤقت. انتظر قليلاً ثم حاول مرة أخرى.');
      } else if (/space|connect|fetch|network|offline/i.test(message)) {
        setError('تعذر الاتصال بخدمة التجربة المجانية حالياً. قد تكون الخدمة نائمة أو مزدحمة؛ حاول مرة أخرى بعد قليل.');
      } else {
        setError(message || 'تعذر إنشاء صورة التجربة حالياً. جرّب صورة أوضح وإضاءة أفضل.');
      }
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
          <p>{product.name} — صورة مولّدة بدون كاميرا مباشرة أو موديل 3D</p>
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
            <span>أوافق على إرسال صورتي وصورة المنتج إلى خدمة FASHN على Hugging Face لمعالجة تجربة الملابس. لن يحفظ موقع SKIP الصور في قاعدة بيانات المتجر.</span>
          </label>

          {error && <p className="ai-tryon-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-brand ai-tryon-generate" onClick={generate} disabled={loading || !photo || !consent}>
            {loading ? <><Loader2 size={18} className="ai-tryon-spin" /> جاري تجهيز التجربة، قد يوجد انتظار...</> : <><Sparkles size={18} /> جرّب الملابس على صورتي</>}
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
      <p className="ai-tryon-footer">المحرك: FASHN VTON 1.5 مفتوح المصدر عبر Hugging Face Spaces. الاستخدام المجاني يعتمد على توفر GPU والحدود المؤقتة للخدمة.</p>
    </section>
  );
};

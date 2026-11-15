import React, { useMemo, useState } from 'react';

const SPACE = 'https://fashn-ai-fashn-vton-1-5.hf.space';
const API = `${SPACE}/gradio_api/run/try_on`;

type GarmentCategory = 'tops' | 'bottoms' | 'one-pieces';
type PhotoType = 'flat-lay' | 'model';

async function prepareImage(file: File): Promise<{ url: string; orig_name: string; mime_type: string; size: number; meta: { _type: string } }> {
  if (!file.type.startsWith('image/')) throw new Error('من فضلك اختر ملف صورة صالح.');
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة.')); };
    image.src = url;
  });
  const scale = Math.min(1, 1200 / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('تعذر تجهيز الصورة.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.86);
  return { url, orig_name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime_type: 'image/jpeg', size: Math.round((url.length * 3) / 4), meta: { _type: 'gradio.FileData' } };
}

export default function FashnVtonTest() {
  const [person, setPerson] = useState<File | null>(null);
  const [garment, setGarment] = useState<File | null>(null);
  const [category, setCategory] = useState<GarmentCategory>('tops');
  const [photoType, setPhotoType] = useState<PhotoType>('flat-lay');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const personPreview = useMemo(() => person ? URL.createObjectURL(person) : '', [person]);
  const garmentPreview = useMemo(() => garment ? URL.createObjectURL(garment) : '', [garment]);

  async function runTryOn() {
    if (!person || !garment || busy) return;
    setBusy(true); setError(''); setResult(''); setStatus('تجهيز الصور...');
    try {
      const [personImage, garmentImage] = await Promise.all([prepareImage(person), prepareImage(garment)]);
      setStatus('إرسال الصور إلى نموذج FASHN VTON v1.5...');
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_image: personImage,
          garment_image: garmentImage,
          category,
          garment_photo_type: photoType,
          num_timesteps: 20,
          guidance_scale: 2.0,
          seed: Math.floor(Math.random() * 2147483647),
          segmentation_free: true,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`خدمة النموذج لم تستجب بشكل سليم (HTTP ${response.status}). ${detail.slice(0, 220)}`);
      }
      const payload = await response.json();
      const output = payload?.output ?? payload?.data?.[0] ?? payload;
      const imageUrl = typeof output === 'string' ? output : output?.url;
      if (!imageUrl) throw new Error('انتهت المعالجة لكن لم يصل رابط صورة النتيجة من النموذج.');
      setResult(imageUrl.startsWith('/') ? `${SPACE}${imageUrl}` : imageUrl);
      setStatus('اكتملت التجربة.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير معروف.';
      if (message.includes('Failed to fetch')) {
        setError('تعذر الاتصال المباشر بخدمة Hugging Face من المتصفح (قد يكون بسبب CORS أو توقف Space). افتح صفحة النموذج الرسمية للتأكد من عملها، ثم نجهز وسيط API عند الحاجة.');
      } else {
        setError(message);
      }
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white" dir="rtl">
      <div className="mx-auto max-w-5xl">
        <a href="/" className="mb-6 inline-flex rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">← العودة إلى المتجر</a>
        <header className="mb-8">
          <div className="mb-2 text-xs font-semibold tracking-widest text-violet-300">SKIP · EXPERIMENTAL LAB</div>
          <h1 className="text-3xl font-black md:text-4xl">تجربة الملابس بالذكاء الاصطناعي</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">اختبار مستقل لنموذج FASHN VTON v1.5. ارفع صورة الشخص وصورة قطعة الملابس لمعاينة النتيجة دون تعديل بيانات المتجر أو منتجاته.</p>
        </header>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="mb-3 text-lg font-bold">1. صورة الشخص</h2>
            <label className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-black/20 p-3 text-center hover:border-violet-400">
              {personPreview ? <img src={personPreview} alt="معاينة الشخص" className="max-h-72 rounded-lg object-contain" /> : <><span className="text-4xl">👤</span><span className="mt-3 font-semibold">اضغط لاختيار صورة الشخص</span><span className="mt-1 text-xs text-slate-400">يفضل شخص واحد ظاهر بوضوح من الأمام</span></>}
              <input className="sr-only" type="file" accept="image/*" onChange={e => setPerson(e.target.files?.[0] ?? null)} />
            </label>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="mb-3 text-lg font-bold">2. صورة قطعة الملابس</h2>
            <label className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-black/20 p-3 text-center hover:border-violet-400">
              {garmentPreview ? <img src={garmentPreview} alt="معاينة الملابس" className="max-h-72 rounded-lg object-contain" /> : <><span className="text-4xl">👕</span><span className="mt-3 font-semibold">اضغط لاختيار صورة الملابس</span><span className="mt-1 text-xs text-slate-400">صورة المنتج بخلفية بسيطة تعطي نتيجة أفضل</span></>}
              <input className="sr-only" type="file" accept="image/*" onChange={e => setGarment(e.target.files?.[0] ?? null)} />
            </label>
          </section>
        </div>

        <section className="mt-5 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold">نوع القطعة
            <select value={category} onChange={e => setCategory(e.target.value as GarmentCategory)} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 p-3 text-white">
              <option value="tops">تيشيرت / قميص / هودي / جاكيت</option>
              <option value="bottoms">بنطلون / شورت</option>
              <option value="one-pieces">قطعة كاملة / طقم قطعة واحدة</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">شكل صورة الملابس
            <select value={photoType} onChange={e => setPhotoType(e.target.value as PhotoType)} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 p-3 text-white">
              <option value="flat-lay">صورة المنتج وحده (Flat-lay)</option>
              <option value="model">الملابس على موديل</option>
            </select>
          </label>
        </section>

        <button disabled={!person || !garment || busy} onClick={runTryOn} className="mt-5 w-full rounded-xl bg-violet-600 px-5 py-4 font-bold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? 'جارٍ تنفيذ التجربة...' : 'جرّب الملابس الآن'}
        </button>
        {status && <p className="mt-3 text-center text-sm text-violet-200">{status}</p>}
        {error && <div role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-950/40 p-4 text-sm leading-6 text-red-200">{error}</div>}

        {result && <section className="mt-7 rounded-2xl border border-emerald-400/30 bg-emerald-950/20 p-5">
          <h2 className="mb-4 text-xl font-bold text-emerald-200">نتيجة التجربة</h2>
          <img src={result} alt="نتيجة تجربة الملابس" className="mx-auto max-h-[720px] rounded-xl object-contain" />
          <a href={result} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl border border-white/20 px-4 py-2 text-sm">فتح الصورة بالحجم الكامل</a>
        </section>}

        <aside className="mt-8 rounded-xl border border-amber-300/20 bg-amber-950/20 p-4 text-xs leading-6 text-amber-100/90">
          <strong>تنبيه الخصوصية والتكلفة:</strong> هذه نسخة اختبار تستخدم مساحة FASHN الرسمية المستضافة على Hugging Face، لذلك تُرسل الصورتان إلى تلك الخدمة لمعالجتهما. لا تُحفظ الصور في Firestore بواسطة هذه الصفحة. الخدمة المجانية تخضع لطابور وحدود Hugging Face؛ ليست تشغيلًا مجانيًا بلا حدود، وقد تتوقف أو يتغير رابطها. لا ترفع صورًا حساسة أو صور أشخاص دون موافقتهم.
        </aside>
        <p className="mt-4 text-center text-xs text-slate-500">Model: FASHN VTON v1.5 · Apache 2.0 · GPU hosted by Hugging Face</p>
      </div>
    </main>
  );
}

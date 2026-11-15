const MAX_PERSON_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_BYTES = 7 * 1024 * 1024;
const ALLOWED_PRODUCT_IMAGE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'firebasestorage.app',
  'lh3.googleusercontent.com',
]);

type ApiRequest = {
  method?: string;
  body?: {
    personImage?: unknown;
    productImageUrl?: unknown;
    productName?: unknown;
    productCategory?: unknown;
  };
};
type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

function parseImageDataUri(value: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error('صيغة صورة الزبون غير مدعومة. استخدم JPG أو PNG أو WebP.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PERSON_IMAGE_BYTES) {
    throw new Error('حجم صورة الزبون غير مناسب. الحد الأقصى 7 ميجابايت.');
  }
  return { mimeType: match[1], data: buffer.toString('base64') };
}

async function getProductImage(value: string) {
  if (value.startsWith('data:')) {
    return parseImageDataUri(value);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('رابط صورة المنتج غير صالح.');
  }
  if (url.protocol !== 'https:' || !ALLOWED_PRODUCT_IMAGE_HOSTS.has(url.hostname)) {
    throw new Error('مصدر صورة المنتج غير مدعوم. يجب أن تكون الصورة مرفوعة على Firebase Storage.');
  }

  const response = await fetch(url.toString(), { redirect: 'error' });
  if (!response.ok) throw new Error('تعذر تحميل صورة المنتج من التخزين.');
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('ملف صورة المنتج ليس JPG أو PNG أو WebP.');
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PRODUCT_IMAGE_BYTES) throw new Error('صورة المنتج أكبر من الحد المسموح.');
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength || arrayBuffer.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error('حجم صورة المنتج غير مناسب.');
  }
  return { mimeType: contentType, data: Buffer.from(arrayBuffer).toString('base64') };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Origin');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'خدمة Nano Banana Pro لم تُفعّل بعد. أضف GEMINI_API_KEY إلى Environment Variables في مشروع Vercel ثم أعد النشر.',
    });
  }

  try {
    const body = req.body || {};
    if (typeof body.personImage !== 'string' || typeof body.productImageUrl !== 'string') {
      return res.status(400).json({ error: 'صورة الزبون وصورة المنتج مطلوبتان.' });
    }

    const person = parseImageDataUri(body.personImage);
    const garment = await getProductImage(body.productImageUrl);
    const productName = typeof body.productName === 'string' ? body.productName.slice(0, 120) : 'قطعة ملابس';
    const productCategory = typeof body.productCategory === 'string' ? body.productCategory.slice(0, 80) : 'ملابس';

    const prompt = [
      'Create a photorealistic virtual clothing try-on image using the TWO input images.',
      'IMAGE 1 is the customer/person reference. IMAGE 2 is the exact garment/product reference.',
      'Keep the person from IMAGE 1 recognizable: preserve their face, facial features, skin tone, hair, body shape, pose, and identity as faithfully as possible.',
      'Dress the person in the exact garment shown in IMAGE 2. Preserve its real design, color, pattern, logo, print, fabric texture, collar, sleeves, seams, and visible details. Do not invent a different garment.',
      'Fit the garment naturally to the person with realistic folds, lighting, shadows, and perspective. Keep the original scene and background from IMAGE 1 as much as possible.',
      'Do not add text, labels, watermarks, extra people, accessories, or unrelated objects. Do not change the person into a different model.',
      `Product: ${productName}. Category: ${productCategory}.`,
      'Return one clean, realistic edited photograph, portrait 3:4 composition. This is a visual preview, not a measurement or size guarantee.',
    ].join(' ');

    const googleResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: person.mimeType, data: person.data } },
              { inline_data: { mime_type: garment.mimeType, data: garment.data } },
            ],
          }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            imageConfig: { aspectRatio: '3:4', imageSize: '1K' },
          },
        }),
      }
    );

    const result = await googleResponse.json().catch(() => ({}));
    if (!googleResponse.ok) {
      console.error('Gemini image generation failed:', googleResponse.status, result?.error?.message || 'Unknown provider error');
      if (googleResponse.status === 401 || googleResponse.status === 403) {
        return res.status(502).json({ error: 'مفتاح Google API غير صالح أو لا يملك صلاحية استخدام Nano Banana Pro.' });
      }
      if (googleResponse.status === 429) {
        return res.status(429).json({ error: 'تم الوصول إلى حد الطلبات أو الرصيد المتاح في Google API. حاول لاحقاً.' });
      }
      return res.status(502).json({ error: 'Google لم يتمكن من توليد الصورة حالياً. راجع إعدادات Gemini API وحاول مرة أخرى.' });
    }

    const parts = result?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
    const image = imagePart?.inlineData || imagePart?.inline_data;
    if (!image?.data) {
      return res.status(502).json({ error: 'لم يرجع Nano Banana Pro صورة. جرّب صورة أوضح وبإضاءة أفضل.' });
    }

    return res.status(200).json({
      image: image.data,
      mimeType: image.mimeType || image.mime_type || 'image/png',
    });
  } catch (error) {
    console.error('Virtual try-on request failed:', error);
    const message = error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
    return res.status(400).json({ error: message });
  }
}

export const config = { maxDuration: 60 };

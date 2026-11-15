# SKIP FASHN VTON v1.5 — Free Test

This branch adds an isolated test page at `/try-on-lab`. The normal SKIP storefront remains the default route and no store data, Firestore schema, product logic, or production branch is changed.

## Model and hosted inference
- Official FASHN Space: https://huggingface.co/spaces/fashn-ai/fashn-vton-1.5
- Model repository: https://huggingface.co/fashn-ai/fashn-vton-1.5
- Inference code: https://github.com/fashn-AI/fashn-vton-1.5
- Model license: Apache-2.0. Review the separately licensed third-party human-parser component before bundling the full stack.

The page calls the official Space Gradio endpoint directly:
`https://fashn-ai-fashn-vton-1-5.hf.space/gradio_api/run/try_on`

No FASHN API key is used. No uploaded image is written to Firestore by this page.

## Test page
After creating a Vercel Preview deployment from this branch, open:
`https://<preview-host>/try-on-lab`

## Free-tier limitations
Hugging Face ZeroGPU is queue-based and quota-limited. Current documentation lists 2 minutes/day for unauthenticated users and 5 minutes/day for free accounts. This is suitable for a limited prototype, not guaranteed production traffic. Quotas and availability can change.

## Privacy
The two resized JPEG images are sent to the official FASHN/Hugging Face Space for inference. This page does not persist them in SKIP Firestore. Do not upload sensitive images or images of people without their consent.

## Test checklist
1. Use a single, front-facing person photo.
2. Use a clear garment photo with a simple background.
3. Match category: `tops`, `bottoms`, or `one-pieces`.
4. Choose `flat-lay` for isolated product photos and `model` for clothing worn by a model.
5. Compare garment logo, print, color, fit, and face preservation.

// gpt-image-2 generation via the /v1/images/edits endpoint (accepts image refs).
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { MODEL, IMAGE_SIZE, IMAGE_QUALITY } from './config.mjs';

export class RateLimitError extends Error {
  constructor(msg) { super(msg); this.name = 'RateLimitError'; }
}

async function fileBlob(path) {
  const buf = await readFile(path);
  const ext = (path.split('.').pop() || 'jpg').toLowerCase();
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  return new Blob([buf], { type });
}

// Generate one image. refPaths: array of reference image paths (style refs, plus
// the frame-0 raw PNG for finish frames). Returns Buffer of PNG bytes.
export async function generate({ apiKey, prompt, refPaths }) {
  const form = new FormData();
  form.append('model', MODEL);
  form.append('quality', IMAGE_QUALITY);
  form.append('size', IMAGE_SIZE);
  form.append('prompt', prompt);
  for (const p of refPaths) {
    form.append('image[]', await fileBlob(p), basename(p));
  }

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (resp.status === 429) {
    const t = await resp.text().catch(() => '');
    throw new RateLimitError(`HTTP 429: ${t.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (data.error) {
    if (/rate limit|quota/i.test(data.error.message || '')) throw new RateLimitError(data.error.message);
    throw new Error(`OpenAI error: ${data.error.message}`);
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI response missing image data');
  return Buffer.from(b64, 'base64');
}

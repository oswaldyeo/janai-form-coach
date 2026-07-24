// Paths, style references, and API key sourcing. cwd-independent: everything is
// resolved relative to this file's location.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ai-visuals/lib -> repo root is three levels up.
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');
export const AI_DIR = join(REPO_ROOT, 'scripts', 'ai-visuals');
export const STATE_DIR = join(AI_DIR, 'state');
export const OUT_DIR = join(REPO_ROOT, 'assets', 'howto', 'ai');
export const WORK_DIR = join(STATE_DIR, 'work'); // raw PNGs kept for frame-1 refs
export const FORM_SPEC_DIR = join(STATE_DIR, 'form-specs'); // Stage-1 physiologist specs
export const PROGRESS_PATH = join(STATE_DIR, 'progress.json');
export const FAILED_PATH = join(STATE_DIR, 'failed-queue.json');
export const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');

export const MODEL = 'gpt-image-2';
export const IMAGE_SIZE = '1024x1024';
export const IMAGE_QUALITY = 'high';
// Conservative per-image spend estimate (gpt-image-2, high, 1024x1024).
export const EST_PER_IMAGE_USD = 0.17;
export const MAX_GEN_CALLS = 1500;
export const MAX_ATTEMPTS = 3;

// Style reference images passed with every generation.
export const STYLE_REFS = [
  '/Users/oswaldsclaw/.openclaw/workspace/.openclaw-cli-images/a4030b92ec355d2eb3be26480ad9fbf6bf0a2be2f42d23961a0b46541907326b.jpg',
  '/Users/oswaldsclaw/.openclaw/media/tool-image-generation/formcoach-proto-sumo-deadlift-start---5014f628-cd3b-48b4-8a19-bf50beb1a3fe.jpg',
];

// Source the OpenAI key from the OpenClaw gateway config. NEVER logged.
export function loadOpenAiKey() {
  const cfgPath = join(process.env.HOME, '.openclaw', 'openclaw.json');
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      // Real usable key lives under the whisper skill entry; the provider block
      // holds only an env-var placeholder ("OPENAI_API_KEY").
      const candidates = [
        cfg?.skills?.entries?.['openai-whisper-api']?.apiKey,
        cfg?.models?.providers?.openai?.apiKey,
      ];
      for (const k of candidates) {
        if (typeof k === 'string' && k.startsWith('sk-')) return k;
      }
    } catch { /* fall through */ }
  }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-')) {
    return process.env.OPENAI_API_KEY;
  }
  throw new Error('No usable OpenAI API key found (openclaw.json skills.entries.openai-whisper-api.apiKey or $OPENAI_API_KEY).');
}

export function styleRefsExist() {
  return STYLE_REFS.every((p) => existsSync(p));
}

// Physiologist verifier: invokes the claude CLI, parses the strict verdict, and
// signals rate-limit/usage-cap so the orchestrator can back off.
import { runCapture } from './util.mjs';
import { verifierPromptFromSpec, parseVerdict } from './targets.mjs';

export class VerifierRateLimit extends Error {
  constructor(msg) { super(msg); this.name = 'VerifierRateLimit'; }
}

const RATE_RE = /rate.?limit|usage limit|quota|overloaded|429|too many requests|please try again|reached your usage/i;

// Returns { verdict:'PASS'|'FAIL', issues, hint, parsed, raw }.
// `spec` is the physiologist form spec (ground truth) from Stage 1.
export async function verify(t, spec, phase, imgPath) {
  const prompt = verifierPromptFromSpec(t, spec, phase, imgPath);
  const { stdout, stderr, code } = await runCapture(
    'claude',
    ['-p', '--model', 'sonnet', '--dangerously-skip-permissions', prompt],
    { input: '/dev/null', timeoutMs: 5 * 60 * 1000 },
  );
  const combined = `${stdout}\n${stderr}`;
  const res = parseVerdict(stdout);
  if (!res.parsed) {
    // Distinguish a usage-cap/transient error from genuinely unparseable output.
    if (code !== 0 && RATE_RE.test(combined)) {
      throw new VerifierRateLimit(combined.slice(0, 300));
    }
    if (RATE_RE.test(combined)) throw new VerifierRateLimit(combined.slice(0, 300));
    return { verdict: 'UNPARSEABLE', issues: combined.slice(0, 300), hint: '', parsed: false, raw: stdout.slice(0, 500) };
  }
  return { ...res, raw: stdout.slice(0, 500) };
}

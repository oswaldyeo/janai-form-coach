// Small dependency-free utilities: semaphore, sleep, atomic JSON write, sips.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const execFileP = promisify(execFile);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Counting semaphore. acquire() resolves when a slot is free; call release().
export class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Atomic JSON write (write temp then rename) so a crash mid-write never
// corrupts the ledger.
let _tmpSeq = 0;
export async function writeJsonAtomic(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  // Unique tmp name so concurrent writers to the same path never clobber each
  // other's temp file mid-write (rename is still atomic; last writer wins).
  const tmp = `${path}.${process.pid}.${_tmpSeq++}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2));
  await rename(tmp, path);
}

// Resize longest edge to 640px, JPEG quality ~70. Returns final byte size.
export async function sipsToJpeg(srcPath, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  await execFileP('sips', [
    '-Z', '640',
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '70',
    srcPath, '--out', outPath,
  ]);
  const { statSync } = await import('node:fs');
  return statSync(outPath).size;
}

// Run a subprocess capturing stdout; resolves {stdout, code}. Never throws on
// non-zero exit — returns the code so callers can branch on it.
export async function runCapture(cmd, args, { input = '/dev/null', timeoutMs = 0, env } = {}) {
  const { spawn } = await import('node:child_process');
  const { openSync } = await import('node:fs');
  return new Promise((resolve) => {
    let stdin = 'ignore';
    try { stdin = openSync(input, 'r'); } catch { stdin = 'ignore'; }
    const child = spawn(cmd, args, { stdio: [stdin, 'pipe', 'pipe'], env: env || process.env });
    let out = '', err = '';
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code });
    });
    child.on('error', () => resolve({ stdout: out, stderr: err, code: -1 }));
  });
}

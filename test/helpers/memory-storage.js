// In-memory Web Storage stand-in for node --test. Mirrors the localStorage API
// and can simulate the failure modes that matter for data integrity:
//   quotaBytes  — throw a QuotaExceededError once the store would exceed it
//   throwOnSet  — every setItem throws (storage disabled / private mode)
//   dropWrites  — setItem "succeeds" but nothing is stored (silent loss)
//   failKeys    — Set of keys whose setItem throws QuotaExceededError
// Sizes are counted as UTF-16 code units × 2, like browsers do.

export class MemoryStorage {
  constructor({ quotaBytes = Infinity, throwOnSet = false, dropWrites = false, failKeys = new Set() } = {}) {
    this.map = new Map();
    this.quotaBytes = quotaBytes;
    this.throwOnSet = throwOnSet;
    this.dropWrites = dropWrites;
    this.failKeys = failKeys;
  }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
  bytesWith(k, v) {
    let n = 0;
    for (const [key, val] of this.map) if (key !== k) n += (key.length + val.length) * 2;
    return n + (k.length + v.length) * 2;
  }
  setItem(k, v) {
    k = String(k); v = String(v);
    if (this.throwOnSet) throw new DOMException('The operation is insecure.', 'SecurityError');
    if (this.failKeys.has(k) || this.bytesWith(k, v) > this.quotaBytes) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    if (this.dropWrites) return;
    this.map.set(k, v);
  }
}

/** Install a fresh MemoryStorage as globalThis.localStorage and return it. */
export function installStorage(opts) {
  const s = new MemoryStorage(opts);
  globalThis.localStorage = s;
  return s;
}

export const KEYS = {
  workouts: 'janai.formcoach.workouts.v2',
  active: 'janai.formcoach.active.v2',
  outbox: 'janai.formcoach.outbox.v1',
  migration: 'janai.formcoach.migration',
  historyV1: 'janai.formcoach.history.v1',
};

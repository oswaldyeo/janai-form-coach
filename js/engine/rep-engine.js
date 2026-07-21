// Deterministic rep-counting state machine.
//
// Every exercise is reduced to a single scalar `progress` in [0,1]:
//   0 = rest / start of the movement
//   1 = peak of the movement (bottom of a squat, top of a press, top of a curl)
//
// A rep is one full excursion: leave the rest zone, reach the peak zone, return
// to the rest zone. Hysteresis (two separated thresholds) stops jitter near a
// threshold from double-counting. Excursions that never reach the peak zone are
// reported as `partial` reps (useful for "go lower" style coaching) but do not
// increment the count.
//
// The engine is pure and framework-free: feed it numbers, read events back.

export class RepEngine {
  /**
   * @param {object} opts
   * @param {number} opts.enterPeak  progress at/above which the peak zone is reached (default 0.70)
   * @param {number} opts.exitRest   progress at/below which we are back at rest (default 0.25)
   * @param {number} opts.deadband   min progress delta to register a direction (default 0.02)
   */
  constructor({ enterPeak = 0.70, exitRest = 0.25, deadband = 0.02 } = {}) {
    this.enterPeak = enterPeak;
    this.exitRest = exitRest;
    this.deadband = deadband;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.partials = 0;
    this._inExcursion = false;
    this._reachedPeak = false;
    this._peakProgress = 0;
    this._prev = null;
    this.phase = 'rest';       // 'rest' | 'active'
    this.direction = 'hold';   // 'up' | 'down' | 'hold'
    this.progress = 0;
  }

  /**
   * Advance the machine by one measured `progress` value.
   * @returns {{phase:string, direction:string, progress:number,
   *            peakProgress:number, repCompleted:boolean, partial:boolean, count:number}}
   */
  update(progress) {
    const p = clamp01(progress);
    // direction from smoothed-input delta
    if (this._prev != null) {
      const d = p - this._prev;
      this.direction = d > this.deadband ? 'up' : d < -this.deadband ? 'down' : 'hold';
    }
    this._prev = p;
    this.progress = p;

    let repCompleted = false;
    let partial = false;

    if (!this._inExcursion) {
      // waiting at rest for movement to begin
      if (p > this.exitRest) {
        this._inExcursion = true;
        this._reachedPeak = p >= this.enterPeak;
        this._peakProgress = p;
        this.phase = 'active';
      }
    } else {
      // inside an excursion
      if (p >= this.enterPeak) this._reachedPeak = true;
      if (p > this._peakProgress) this._peakProgress = p;

      if (p <= this.exitRest) {
        // excursion finished — decide whether it was a full rep
        const peak = this._peakProgress;
        if (this._reachedPeak) {
          this.count += 1;
          repCompleted = true;
        } else {
          this.partials += 1;
          partial = true;
        }
        this._inExcursion = false;
        this._reachedPeak = false;
        this._peakProgress = 0;
        this.phase = 'rest';
        return {
          phase: this.phase,
          direction: this.direction,
          progress: p,
          peakProgress: peak,
          repCompleted,
          partial,
          count: this.count,
        };
      }
    }

    return {
      phase: this.phase,
      direction: this.direction,
      progress: p,
      peakProgress: this._peakProgress,
      repCompleted,
      partial,
      count: this.count,
    };
  }
}

function clamp01(v) {
  if (v == null || Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

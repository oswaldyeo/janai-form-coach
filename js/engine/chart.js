// Tiny dependency-free line-chart renderer — pure, deterministic, no DOM.
//
// The whole app has NO runtime dependencies (see README), so we do not pull in
// a charting library. `chartGeometry` does the scaling math (unit-tested) and
// `lineChartSVG` assembles an SVG *string* the browser layer injects with
// innerHTML. Both are pure: string in, string/objects out, no `document`.
//
// Design notes:
//   - y-axis grows UP, but SVG y grows DOWN, so we flip: higher value → smaller y.
//   - a flat series (all equal, or a single point) draws a centred horizontal
//     line rather than dividing by a zero range.
//   - x is evenly spaced by index (session ordinal), not by real time — a
//     Strong-style "per session" progression, which reads cleanly whether
//     sessions are a day or a month apart.

/**
 * Map an ordered array of numbers to plotted coordinates inside a padded box.
 * @param {number[]} values  oldest→newest; non-finite entries are dropped
 * @returns {{
 *   points: {x:number,y:number,v:number}[],
 *   min:number, max:number, width:number, height:number, pad:object,
 *   polyline:string   // "x,y x,y ..." ready for <polyline points=…>
 * } | null}  null when there is nothing finite to plot
 */
export function chartGeometry(values, opts = {}) {
  const width = opts.width ?? 320;
  const height = opts.height ?? 140;
  const pad = { top: 12, right: 10, bottom: 18, left: 10, ...(opts.pad || {}) };
  // drop null/undefined BEFORE Number() — otherwise Number(null)===0 would plot
  // a "no external load" session as a real 0 kg point.
  const nums = (values || [])
    .filter((v) => v != null)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;

  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min;
  const n = nums.length;

  const xAt = (i) => (n === 1 ? pad.left + innerW / 2 : pad.left + (innerW * i) / (n - 1));
  // flat series → centre line; else flip so max sits at the top (small y).
  const yAt = (v) => (range === 0 ? pad.top + innerH / 2 : pad.top + innerH * (1 - (v - min) / range));

  const points = nums.map((v, i) => ({ x: round2(xAt(i)), y: round2(yAt(v)), v }));
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  return { points, min, max, width, height, pad, polyline };
}

/**
 * Build an SVG line chart as a markup string. Caller passes already-extracted
 * numbers (e.g. each session's top-set weight) plus display options.
 * Safe for innerHTML: all interpolated values are numbers or from `fmt`, which
 * the caller controls — callers must not pass unsanitised user text as a label.
 *
 * @param {number[]} values  oldest→newest
 * @param {object} opts
 *   width,height,pad          box dimensions
 *   fmt(v)                    format a value for the min/max labels (default: as-is + unit)
 *   unit                      appended to default-formatted labels (e.g. 'kg')
 *   ariaLabel                 accessible chart description
 * @returns {string} SVG markup, or an empty-state SVG when there's no data
 */
export function lineChartSVG(values, opts = {}) {
  const width = opts.width ?? 320;
  const height = opts.height ?? 140;
  const geo = chartGeometry(values, { width, height, pad: opts.pad });
  const aria = esc(opts.ariaLabel || 'Progress chart');

  if (!geo) {
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${aria}: no data yet" preserveAspectRatio="none">`
      + `<text x="${width / 2}" y="${height / 2}" class="chart-empty" text-anchor="middle" dominant-baseline="middle">No data yet</text>`
      + `</svg>`;
  }

  const fmt = typeof opts.fmt === 'function'
    ? opts.fmt
    : (v) => `${trim(v)}${opts.unit ? ' ' + opts.unit : ''}`;

  const { points, min, max, polyline, pad } = geo;
  const last = points[points.length - 1];
  const baseY = height - pad.bottom;

  // area fill under the line (down to the baseline) for a touch of weight
  const area = `${pad.left},${baseY} ${polyline} ${last.x},${baseY}`;

  const dots = points
    .map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${i === points.length - 1 ? 3.2 : 2}" class="chart-dot${i === points.length - 1 ? ' last' : ''}" />`)
    .join('');

  // min/max value guides (labels only; the line carries the shape)
  const maxLabel = `<text x="${pad.left}" y="${pad.top - 2}" class="chart-tick">${esc(fmt(max))}</text>`;
  const minLabel = max === min ? '' : `<text x="${pad.left}" y="${baseY + 14}" class="chart-tick">${esc(fmt(min))}</text>`;

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${aria}" preserveAspectRatio="none">`
    + `<polygon points="${area}" class="chart-area" />`
    + `<polyline points="${polyline}" class="chart-line" fill="none" />`
    + dots
    + maxLabel
    + minLabel
    + `</svg>`;
}

// ── utils (local; keep this module self-contained) ───────────────────────────
function round2(v) { return Math.round(v * 100) / 100; }
function trim(v) { return String(Math.round(v * 100) / 100); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

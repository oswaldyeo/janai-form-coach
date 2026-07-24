// Browser-side interaction layer: ripple, swipe navigation, drag-reorder
// sessions with an integrated long-press. I/O only — every *decision* (is this
// a swipe? which index does the drag land on? was that a long press?) is pure
// math in ./engine/gestures.js and unit-tested there.
//
// All handlers are event-driven; nothing here runs inside the camera frame loop.

import {
  classifySwipe, shouldCommitSwipeBack, dropIndexFromOffset, clampDragOffset,
} from './engine/gestures.js';

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── ripple ───────────────────────────────────────────────────────────────────
// Subtle Material-style touch feedback on every button/chip. Skipped entirely
// under prefers-reduced-motion; `currentColor` keeps it on-brand everywhere.
export function attachRipple(root = document) {
  root.addEventListener('pointerdown', (e) => {
    if (reducedMotion()) return;
    const btn = e.target.closest('button, .chip');
    if (!btn || btn.disabled || btn.classList.contains('no-ripple')) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.width = r.style.height = `${size}px`;
    r.style.left = `${e.clientX - rect.left - size / 2}px`;
    r.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
    setTimeout(() => r.remove(), 600); // safety if the animation never fires
  }, { passive: true });
}

// ── drag-reorder session (with built-in long-press) ──────────────────────────
// One pointerdown on a handle owns the whole gesture:
//   move past the slop  → visual drag; drop calls onDrop(from, to)
//   hold still `holdMs` → onLongPress() and the drag is abandoned
//   release before both → plain tap, nothing happens
let dragActive = false;
export function isDragActive() { return dragActive; }

export function dragSession(e, {
  handle, items, index, onDrop, onLongPress = null, holdMs = 500, slopPx = 8,
}) {
  const h = handle || e.currentTarget;
  const dragged = items[index];
  if (!dragged) return;
  const rects = items.map((el) => el.getBoundingClientRect());
  const sizes = rects.map((r) => r.height);
  const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
  const startY = e.clientY;
  let lastY = startY;
  let moved = false;
  let raf = 0;
  let to = index;

  try { h.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  e.preventDefault(); // suppress text selection / focus steal on the handle

  // brief hold shows a "grabbed" affordance before anything commits
  const hintTimer = setTimeout(() => h.classList.add('hold-hint'), 120);
  const pressTimer = onLongPress ? setTimeout(() => {
    if (moved) return;
    cleanup(false);
    try { navigator.vibrate?.(10); } catch { /* optional */ }
    onLongPress();
  }, holdMs) : 0;

  function apply() {
    raf = 0;
    const rawDy = lastY - startY;
    if (!moved) {
      if (Math.abs(rawDy) <= slopPx) return;
      moved = true;
      dragActive = true;
      clearTimeout(pressTimer);
      dragged.classList.add('dragging');
      items.forEach((el) => { if (el !== dragged) el.classList.add('drag-shift'); });
    }
    const dy = clampDragOffset(rawDy, index, sizes, gap);
    to = dropIndexFromOffset(index, dy, sizes, gap);
    dragged.style.transform = `translateY(${dy}px)`;
    items.forEach((el, i) => {
      if (el === dragged) return;
      let shift = 0;
      if (i > index && i <= to) shift = -(sizes[index] + gap);
      else if (i < index && i >= to) shift = sizes[index] + gap;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function onMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    lastY = ev.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  }

  function cleanup(fireDrop) {
    clearTimeout(pressTimer);
    clearTimeout(hintTimer);
    h.classList.remove('hold-hint');
    h.removeEventListener('pointermove', onMove);
    h.removeEventListener('pointerup', onUp);
    h.removeEventListener('pointercancel', onCancel);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!moved) return;
    dragActive = false;
    const changed = fireDrop && to !== index;
    dragged.classList.remove('dragging');
    items.forEach((el) => { el.style.transform = ''; });
    // let non-dropping releases spring back before losing their transition class
    setTimeout(() => items.forEach((el) => el.classList.remove('drag-shift')), 200);
    if (changed) onDrop(index, to);
  }

  function onUp(ev) { if (ev.pointerId === e.pointerId) cleanup(true); }
  function onCancel(ev) { if (ev.pointerId === e.pointerId) cleanup(false); }

  h.addEventListener('pointermove', onMove);
  h.addEventListener('pointerup', onUp);
  h.addEventListener('pointercancel', onCancel);
}

// ── swipe navigation ─────────────────────────────────────────────────────────
// Touch/pen only (mouse users have real back buttons). Vertical scrolling wins
// the gesture the moment it dominates; on full-screen modes the screen "peels"
// with the finger for a native-feeling swipe-back.
export function attachSwipeNav(el, {
  enabled, ignore, getScreenEl, getBackEl, onBack, onTabSwipe, backEdgeWidth = 36,
}) {
  let s = null; // { x, y, t, id, locked, follow, behind, behindWasHidden }

  el.addEventListener('pointerdown', (e) => {
    s = null;
    if (e.pointerType === 'mouse') return;
    if (isDragActive() || !enabled()) return;
    if (ignore && e.target.closest && ignore(e.target)) return;
    const screen = getScreenEl && getScreenEl();
    // Match iOS/Telegram: page-back begins at the left edge. Tab swipes still
    // begin anywhere because they are lateral navigation, not history-back.
    if (screen && e.clientX > backEdgeWidth) return;
    s = {
      x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId,
      locked: false, follow: null, behind: null, behindWasHidden: false,
    };
  }, { passive: true });

  el.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        s.locked = true;
        s.follow = (!reducedMotion() && getScreenEl) ? getScreenEl() : null;
        if (s.follow && dx > 0 && getBackEl) {
          s.behind = getBackEl();
          if (s.behind) {
            s.behindWasHidden = s.behind.classList.contains('hidden');
            s.behind.classList.remove('hidden');
            s.behind.classList.add('swipe-back-underlay');
            s.follow.classList.add('swipe-back-foreground');
          }
        }
      } else if (Math.abs(dy) > 14) { s = null; return; } // scroll wins
    }
    if (s.locked && s.follow && dx > 0) {
      const width = Math.max(1, el.clientWidth || window.innerWidth);
      const travel = Math.min(dx, width);
      const progress = travel / width;
      // Foreground follows the finger 1:1; previous page eases in from -22%,
      // recreating iOS's interactive navigation transition.
      s.follow.style.transform = `translate3d(${travel}px,0,0)`;
      s.follow.style.boxShadow = `-${Math.round(18 * (1 - progress))}px 0 28px rgba(0,0,0,${(0.38 * (1 - progress)).toFixed(3)})`;
      if (s.behind) {
        s.behind.style.transform = `translate3d(${(-22 + progress * 22).toFixed(2)}%,0,0)`;
        s.behind.style.opacity = String(0.72 + progress * 0.28);
      }
    }
  }, { passive: true });

  const finish = (e, cancelled) => {
    if (!s || e.pointerId !== s.id) return;
    const g = s; s = null;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = performance.now() - g.t;
    const cleanup = ({ restoreBehind = true } = {}) => {
      if (g.follow) {
        g.follow.classList.remove('swipe-back-foreground');
        g.follow.style.transition = '';
        g.follow.style.transform = '';
        g.follow.style.boxShadow = '';
      }
      if (g.behind) {
        g.behind.classList.remove('swipe-back-underlay');
        g.behind.style.transition = '';
        g.behind.style.transform = '';
        g.behind.style.opacity = '';
        if (restoreBehind && g.behindWasHidden) g.behind.classList.add('hidden');
      }
    };

    if (g.follow) {
      const width = Math.max(1, el.clientWidth || window.innerWidth);
      const commit = !cancelled && Math.abs(dx) > Math.abs(dy) * 1.2
        && shouldCommitSwipeBack({ dx, dt, width });
      g.follow.style.transition = 'transform .2s cubic-bezier(.22,.75,.2,1), box-shadow .2s ease';
      if (g.behind) g.behind.style.transition = 'transform .2s cubic-bezier(.22,.75,.2,1), opacity .2s ease';
      g.follow.style.transform = `translate3d(${commit ? width : 0}px,0,0)`;
      g.follow.style.boxShadow = '';
      if (g.behind) {
        g.behind.style.transform = `translate3d(${commit ? 0 : -22}%,0,0)`;
        g.behind.style.opacity = commit ? '1' : '.72';
      }
      setTimeout(() => {
        if (commit) onBack();
        cleanup({ restoreBehind: !commit });
      }, reducedMotion() ? 0 : 205);
      return;
    }

    if (cancelled) return;
    const dir = classifySwipe({ dx, dy, dt });
    if (dir) onTabSwipe(dir);
  };

  el.addEventListener('pointerup', (e) => finish(e, false), { passive: true });
  el.addEventListener('pointercancel', (e) => finish(e, true), { passive: true });
}

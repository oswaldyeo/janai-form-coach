// Browser-side interaction layer: ripple, swipe navigation, drag-reorder
// sessions with an integrated long-press. I/O only — every *decision* (is this
// a swipe? which index does the drag land on? was that a long press?) is pure
// math in ./engine/gestures.js and unit-tested there.
//
// All handlers are event-driven; nothing here runs inside the camera frame loop.

import {
  classifySwipe, shouldCommitSwipeBack, dropIndexFromOffset, clampDragOffset,
} from './engine/gestures.js';
import { edgeAutoScroll, autoScrollChanged, HAPTIC } from './engine/haptics.js';

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fire-and-forget haptic. navigator.vibrate is a progressive enhancement — a
// no-op (or absent) on iOS Safari / Home Screen PWA — so we never depend on it.
function buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } }

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
  let loop = 0;         // continuous rAF while dragging (drives edge auto-scroll)
  let scrollComp = 0;   // px the viewport auto-scrolled — folded into the drag delta
  let lastScroll = null; // last edgeAutoScroll() result, for tier-change haptics
  let to = index;

  try { h.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  e.preventDefault(); // suppress text selection / focus steal on the handle

  // brief hold shows a "grabbed" affordance before anything commits
  const hintTimer = setTimeout(() => h.classList.add('hold-hint'), 120);
  const pressTimer = onLongPress ? setTimeout(() => {
    if (moved) return;
    cleanup(false);
    buzz(10);
    onLongPress();
  }, holdMs) : 0;

  // Position the dragged item + its displaced neighbours. `scrollComp` keeps the
  // item under the finger even as the viewport auto-scrolls: content shifts up by
  // scrollComp, so the item's transform grows by the same amount. Fires a subtle
  // haptic each time the drag crosses into a new drop slot.
  function render() {
    const rawDy = (lastY - startY) + scrollComp;
    if (!moved) {
      if (Math.abs(rawDy) <= slopPx) return;
      moved = true;
      dragActive = true;
      clearTimeout(pressTimer);
      dragged.classList.add('dragging');
      items.forEach((el) => { if (el !== dragged) el.classList.add('drag-shift'); });
      startLoop();
    }
    const dy = clampDragOffset(rawDy, index, sizes, gap);
    const nextTo = dropIndexFromOffset(index, dy, sizes, gap);
    if (nextTo !== to) { to = nextTo; buzz(HAPTIC.cross); } // crossed a slot
    dragged.style.transform = `translateY(${dy}px)`;
    items.forEach((el, i) => {
      if (el === dragged) return;
      let shift = 0;
      if (i > index && i <= to) shift = -(sizes[index] + gap);
      else if (i < index && i >= to) shift = sizes[index] + gap;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  // While dragging, a single rAF loop pulls the viewport when the finger nears an
  // edge (so off-screen list items become reachable) and re-renders every frame,
  // so a still finger parked in the edge zone keeps scrolling.
  function startLoop() {
    if (loop) return;
    const frame = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const s = edgeAutoScroll(lastY, vh);
      if (autoScrollChanged(lastScroll, s)) buzz(HAPTIC.scrollEdge);
      lastScroll = s;
      if (s.step) {
        const before = window.scrollY;
        window.scrollBy(0, s.step);
        scrollComp += window.scrollY - before; // only count what actually moved
      }
      render();
      loop = requestAnimationFrame(frame);
    };
    loop = requestAnimationFrame(frame);
  }

  function onMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    lastY = ev.clientY;
    // Before the drag arms, the loop isn't running yet — schedule a one-shot
    // render so we still detect the slop crossing.
    if (!moved && !raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function cleanup(fireDrop) {
    clearTimeout(pressTimer);
    clearTimeout(hintTimer);
    h.classList.remove('hold-hint');
    h.removeEventListener('pointermove', onMove);
    h.removeEventListener('pointerup', onUp);
    h.removeEventListener('pointercancel', onCancel);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (loop) { cancelAnimationFrame(loop); loop = 0; }
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

// The swipe-back peel writes inline transform/opacity/box-shadow + peel classes
// onto the current and previous screen. Stripping them lives here so *every*
// teardown path — normal release, an interrupted gesture, or a navigation that
// happens mid-swipe — clears exactly the same styling and can never strand a
// screen translated off-viewport (which clipped its right edge: the "cards /
// Done button cut off" bug). `restoreBehind` re-hides the previous screen only
// when the swipe did NOT commit.
function stripSwipeStyle(elm) {
  if (!elm) return;
  elm.classList.remove('swipe-back-foreground', 'swipe-back-underlay');
  elm.style.transition = '';
  elm.style.transform = '';
  elm.style.boxShadow = '';
  elm.style.opacity = '';
}
function resetPeel(follow, behind, { restoreBehind = true, behindWasHidden = false } = {}) {
  stripSwipeStyle(follow);
  if (behind) {
    stripSwipeStyle(behind);
    if (restoreBehind && behindWasHidden) behind.classList.add('hidden');
  }
}

// Belt-and-suspenders: sweep any leftover peel artifacts under `root`. Called by
// the app on every screen/tab change so a stale transform from an interrupted
// swipe can never survive into the next view. Idempotent and safe to over-call.
export function clearSwipeArtifacts(root = document) {
  root.querySelectorAll('.swipe-back-foreground, .swipe-back-underlay')
    .forEach((elm) => stripSwipeStyle(elm));
}

export function attachSwipeNav(el, {
  enabled, ignore, getScreenEl, getBackEl, onBack, onTabSwipe, backEdgeWidth = 36,
}) {
  let s = null; // { x, y, t, id, locked, follow, behind, behindWasHidden }

  el.addEventListener('pointerdown', (e) => {
    // A new pointerdown mid-swipe (2nd finger, accidental re-tap) must not just
    // drop `s` — that would orphan the in-flight peel, stranding its inline
    // transform on the current screen forever. Roll it back first.
    if (s) { resetPeel(s.follow, s.behind, { restoreBehind: true, behindWasHidden: s.behindWasHidden }); s = null; }
    if (e.pointerType === 'mouse') return;
    if (isDragActive() || !enabled()) return;
    if (ignore && e.target.closest && ignore(e.target)) return;
    const screen = getScreenEl && getScreenEl();
    // Match iOS/Telegram: page-back begins at the left edge. Tab swipes still
    // begin anywhere because they are lateral navigation, not history-back.
    if (screen && e.clientX > backEdgeWidth) return;
    // Capture the pointer so the release fires here even if the finger drifts off
    // #main (onto the header/nav) — otherwise finish() never runs and the peel leaks.
    try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
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
    try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = performance.now() - g.t;
    const cleanup = ({ restoreBehind = true } = {}) =>
      resetPeel(g.follow, g.behind, { restoreBehind, behindWasHidden: g.behindWasHidden });

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

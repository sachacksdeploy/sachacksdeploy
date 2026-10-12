import { useEffect } from "react";

/**
 * Scroll-driven dissolve shared by the page sections and the background decor
 * (clouds, stars, blobs) so everything fades and blurs in perfect sync.
 *
 * One rAF-throttled scroll handler measures every target once per frame and
 * writes two custom properties:
 *   --p           1 at the viewport centre, 0 at the edges
 *   --panel-blur  the matching blur radius
 *
 * Cheap by design: values are quantised (coarser for decor and on low-end
 * devices) so most frames write nothing at all.
 *
 * Velocity-aware: fast scrolls get a stronger blur (clearly visible) while
 * slow scrolls keep content crisp (barely noticeable). The blur ceiling and
 * the dissolve ramp both scale with the smoothed scroll velocity.
 */
export type DissolveGroup = { selector: string; className: string; decor?: boolean };

/** Baseline (slow-scroll) blur ceiling. Fast scrolls can reach up to this. */
const MAX_BLUR = 10;
/** Velocity (px/frame) at which the effect is fully ramped up. */
const V_FAST = 26;

export function isLowEndDevice() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    window.matchMedia("(pointer:coarse) and (max-width:860px)").matches
  );
}

export function useScrollDissolve(groups: DissolveGroup[]) {
  useEffect(() => {
    const items = groups.flatMap((g) =>
      Array.from(document.querySelectorAll<HTMLElement>(g.selector)).map((el) => ({
        el,
        className: g.className,
        decor: !!g.decor,
      })),
    );
    if (!items.length) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowEnd = isLowEndDevice();
    document.documentElement.classList.toggle("low-end", lowEnd);

    if (reduced) {
      items.forEach(({ el }) => el.style.setProperty("--p", "1"));
      return;
    }

    const maxBlur = lowEnd ? 0 : MAX_BLUR;
    // Quantisation step per item: coarse for decor / low-end, so fast scrolls
    // repaint far fewer times.
    const stepFor = (decor: boolean) => (lowEnd ? 0.25 : decor ? 0.125 : 0.05);

    const state = new WeakMap<HTMLElement, string>();
    // Section-arrival tracking for the scroll glitch (inversion flicker + shake).
    const entered = new WeakMap<HTMLElement, boolean>();
    let lastEnter = 0;
    let ticking = false;

    // Geometry is measured once (and on resize) instead of every frame: reading
    // getBoundingClientRect for ~40 nodes per scroll frame forces a layout and
    // is the single biggest source of scroll jank here.
    type Metric = { el: HTMLElement; decor: boolean; centre: number };
    let metrics: Metric[] = [];

    const measure = () => {
      const scrollY = window.scrollY;
      metrics = items.map(({ el, decor }) => {
        const r = el.getBoundingClientRect();
        return { el, decor, centre: r.top + scrollY + r.height / 2 };
      });
    };

    // Velocity tracking — smoothed so a single fast flick ratchets the effect up
    // and a slow glide lets it settle back to "barely there".
    let lastY = window.scrollY;
    let lastT = performance.now();
    let vel = 0; // smoothed px/frame

    // Sharp plateau then a smoothstep ramp: content stays fully crisp while it
    // is anywhere near the viewport centre, and only dissolves over the last
    // stretch before it leaves. Avoids the "everything is blurred" dead zones.
    const PLATEAU = 0.28; // fraction of vh that stays at p = 1
    const RAMP = 0.42; // fraction of vh over which it fades to 0

    // Frame budget: low-end devices paint at most every other frame. The
    // dissolve is a slow visual, so 30fps of property writes is invisible while
    // halving style/paint work during fast scrolls.
    const frameSkip = lowEnd ? 2 : 1;
    let frameCount = 0;

    const paint = () => {
      ticking = false;
      const now = performance.now();
      const dt = Math.max(now - lastT, 1);
      const inst = Math.abs(window.scrollY - lastY) / dt * 16.67; // px/frame @60fps
      lastY = window.scrollY;
      lastT = now;
      // Exponential smoothing: fast scrolls push vel up fast, slow scrolls
      // decay it back toward zero. This is what makes the effect "visible to a
      // fast scroller but not to a slow scroller".
      vel += (inst - vel) * 0.35;

      const vh = window.innerHeight;
      const viewCentre = window.scrollY + vh / 2;
      // Velocity factor 0..1: barely any blur when slow, full blur when fast.
      const vf = Math.max(0, Math.min(1, vel / V_FAST));
      // Slow scroll → shrink the blur ceiling so it stays crisp & subtle;
      // fast scroll → full ceiling so the dissolve is unmistakable.
      const blurCeil = maxBlur * (0.12 + 0.88 * vf);
      // Fast scroll also widens the dissolve ramp a touch so it registers earlier;
      // slow scroll keeps the plateau wide and ramp tight (subtle).
      const rampW = RAMP * (0.65 + 0.55 * vf);
      const plateauW = PLATEAU * (1.25 - 0.55 * vf);
      const plateauPx = vh * plateauW;
      const outerPx = plateauPx + vh * rampW;
      const rampPx = vh * rampW;

      for (const { el, decor, centre } of metrics) {
        const dist = centre > viewCentre ? centre - viewCentre : viewCentre - centre;
        let p: number;
        if (dist >= outerPx) {
          p = 0;
        } else if (dist <= plateauPx) {
          p = 1;
        } else {
          const t = (dist - plateauPx) / rampPx; // 0 -> 1
          const smooth = 1 - t * t * (3 - 2 * t); // smoothstep, eased both ends
          const step = stepFor(decor);
          p = Math.round(smooth / step) * step;
        }
        // Section arrival: the panel has just resolved at the viewport centre.
        // Fire a short text shake — once per entry.
        if (!decor) {
          const settled = dist <= plateauPx;
          if (settled !== entered.get(el)) {
            entered.set(el, settled);
            if (settled && now - lastEnter > 450) {
              lastEnter = now;
              el.classList.remove("sv-section-enter");
              void el.offsetWidth;
              el.classList.add("sv-section-enter");
              window.setTimeout(() => el.classList.remove("sv-section-enter"), 1050);
            }
          }
        }
        const blurred = maxBlur && !decor;
        const blur = blurred ? ((1 - p) * blurCeil).toFixed(1) : "";
        const key = `${p.toFixed(3)}|${blur}`;
        if (state.get(el) === key) continue;
        state.set(el, key);
        el.style.setProperty("--p", p.toFixed(3));
        if (blurred) el.style.setProperty("--panel-blur", `${blur}px`);
      }
    };

    // Single rAF driver: one loop handles both scroll-driven repaints and the
    // post-scroll settle, so we never have two rAF chains racing each other.
    let rafId = 0;
    const tick = () => {
      rafId = 0;
      frameCount++;
      const due = frameCount % frameSkip === 0;
      if (due) paint();
      // Keep ticking while velocity is decaying so the effect eases back to
      // crisp even after the user stops scrolling. Stops itself when settled.
      if (vel > 0.6) {
        vel *= 0.82;
        rafId = requestAnimationFrame(tick);
      } else {
        ticking = false;
      }
    };

    const onScrollVel = () => {
      if (!ticking) {
        ticking = true;
        rafId = requestAnimationFrame(tick);
      }
    };

    let resizeId = 0;
    const onResize = () => {
      if (resizeId) cancelAnimationFrame(resizeId);
      resizeId = requestAnimationFrame(() => {
        resizeId = 0;
        measure();
        paint();
      });
    };

    items.forEach(({ el, className }) => el.classList.add(className));
    measure();
    paint();
    window.addEventListener("scroll", onScrollVel, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    const ro = "ResizeObserver" in window ? new ResizeObserver(onResize) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScrollVel);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeId) cancelAnimationFrame(resizeId);
      items.forEach(({ el, className }) => {
        el.classList.remove(className);
        el.style.removeProperty("--p");
        el.style.removeProperty("--panel-blur");
      });
    };
    // groups is a static literal at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}


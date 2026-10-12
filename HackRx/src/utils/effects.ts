import type { MouseEvent } from "react";

/* ---------------- performance safeguards ---------------- */

/**
 * Glitch effects are purely decorative, so they must never fight the browser
 * for frames. Two safeguards:
 *  1. Background tabs — `document.hidden` skips every effect outright and
 *     pauses all decorative CSS animations.
 *  2. Sustained low FPS — a lightweight rAF sampler tracks the frame rate.
 *     A single slow second is normal (a glitch is playing, an image decodes),
 *     so the budget only degrades after several consecutive slow samples and
 *     recovers on the first healthy one. This keeps activation glitches reliable.
 */
let fps = 60;
let lowStreak = 0;
let rafId = 0;

const FPS_REDUCED = 40; // below this for a while -> drop the expensive echo
const FPS_OFF = 24; // below this for a while -> no glitches at all
const LOW_SAMPLES = 3; // consecutive slow seconds required before degrading

function sampleFps() {
  let frames = 0;
  let last = performance.now();
  const loop = (now: number) => {
    frames++;
    if (now - last >= 1000) {
      fps = (frames * 1000) / (now - last);
      lowStreak = fps < FPS_REDUCED ? lowStreak + 1 : 0;
      frames = 0;
      last = now;
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

/** Starts FPS sampling (pauses while the tab is hidden). Returns cleanup. */
export function startPerfMonitor() {
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      document.documentElement.classList.add("sv-effects-paused");
    } else {
      fps = 60; // assume healthy again; the sampler re-measures within a second
      lowStreak = 0;
      document.documentElement.classList.remove("sv-effects-paused");
      if (!rafId) sampleFps();
    }
  };
  if (!document.hidden) sampleFps();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    cancelAnimationFrame(rafId);
    rafId = 0;
  };
}

/** "off" = skip entirely, "reduced" = cheaper/shorter, "full" = everything. */
export function effectBudget(): "off" | "reduced" | "full" {
  if (typeof document === "undefined") return "off";
  if (document.hidden) return "off";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "off";
  if (lowStreak < LOW_SAMPLES) return "full";
  return fps < FPS_OFF ? "off" : "reduced";
}


function dialogOpen() {
  return !!document.querySelector('[role="dialog"][data-state="open"]');
}

/* ---------------- full-screen colour inversion flash ---------------- */

let invertEl: HTMLDivElement | null = null;
let invertTimer: number | undefined;

function invertLayer() {
  if (invertEl?.isConnected) return invertEl;
  invertEl = document.createElement("div");
  invertEl.className = "sv-invert-flash";
  invertEl.setAttribute("aria-hidden", "true");
  // Above page content but below modals/dialogs so the inversion reads as a
  // full-screen glitch without trapping pointer events.
  invertEl.style.zIndex = "9998";
  document.body.appendChild(invertEl);
  return invertEl;
}

/**
 * Inverts every pixel on screen (255 − RGB) for `duration` ms, then eases back.
 * Used as the prominent half of the glitch: 500ms on button activation
 * (hover / keyboard focus / touch) and on the ambient 45s pulse.
 *
 * Fully re-entrant: a new trigger cancels any in-flight fade and restarts the
 * inversion from scratch, so the flash always fires regardless of how fast
 * events arrive. There is no "busy" lock that would swallow a trigger.
 */
function flashInvert(duration = 500, force = false) {
  // `force` = user-initiated (hover / focus / touch): always fires, so it only
  // respect the hard blockers: hidden tab, reduced motion, open dialog.
  if (document.hidden) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!force && effectBudget() === "off") return;
  // Never invert while the registration dialog is open.
  if (dialogOpen()) return;
  const el = invertLayer();
  el.style.setProperty("--sv-invert-dur", `${duration}ms`);
  el.classList.remove("is-on");
  void el.offsetWidth; // restart the animation
  el.classList.add("is-on");
  window.clearTimeout(invertTimer);
  invertTimer = window.setTimeout(() => {
    el.classList.remove("is-on");
  }, duration);
}

/* ---------------- double / triple vision echo ---------------- */

let echoTimer: number | undefined;

/**
 * Short "double / triple vision" echo: the whole page is ghosted twice with
 * chromatic offsets so you briefly see 2-3 copies of everything.
 */
function flashEcho(duration = 250, force = false) {
  if (document.hidden) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // The echo is the most expensive effect (multi-layer filters), so ambient
  // triggers drop it as soon as the frame budget degrades. User-initiated
  // echoes still play unless the tab is hidden or the user prefers reduced motion.
  if (!force && effectBudget() !== "full") return;
  if (dialogOpen()) return;
  const page = document.querySelector<HTMLElement>(".hackrx-page");
  if (!page) return;
  page.style.setProperty("--sv-echo-dur", `${duration}ms`);
  page.classList.remove("sv-echo");
  void page.offsetWidth;
  page.classList.add("sv-echo");
  window.clearTimeout(echoTimer);
  echoTimer = window.setTimeout(() => page.classList.remove("sv-echo"), duration);
}

/**
 * Combined glitch flourish: colour inversion (0.5s) + echo (0.25s).
 * Durations are fixed — never scale them with anything else.
 *
 * Its own short cooldown (shorter than the page-glitch lock) means every real
 * activation fires the burst, while the fast in/out flicker at a button's edge
 * is still absorbed.
 */
const BURST_INVERT = 500;
const BURST_ECHO = 250;
const BURST_COOLDOWN = 550;
let lastBurst = 0;

function flashGlitchBurst(force = false) {
  const now = performance.now();
  if (now - lastBurst < BURST_COOLDOWN) return;
  lastBurst = now;
  flashInvert(BURST_INVERT, force);
  flashEcho(BURST_ECHO, force);
}


/* ---------------- site-wide one-shot glitch ---------------- */

let timer: number | undefined;
let locked = false;

const DURATION = 1800; // effect length in ms — keep in sync with styles.css
const COOLDOWN = 700; // ignore re-triggers for a moment after it ends

/**
 * Fires a brief, site-wide Spider-Verse glitch. Used whenever a register
 * button is activated by any input: mouse hover, keyboard focus, or touch.
 */
export function triggerPageGlitch(duration = DURATION) {
  const page = document.querySelector(".hackrx-page");
  if (!page) return;

  // The inversion + echo burst fires on every activation (guarded only by its
  // own 550ms cooldown), even if the longer page-shift animation is still locked.
  flashGlitchBurst(true);

  if (effectBudget() === "off") return;

  if (locked) return; // hover flicker on the button edge must not restart the long effect

  locked = true;
  page.classList.remove("sv-page-glitch");
  void (page as HTMLElement).offsetWidth; // force reflow so the animation restarts
  page.classList.add("sv-page-glitch");

  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    page.classList.remove("sv-page-glitch");
    window.setTimeout(() => {
      locked = false;
    }, COOLDOWN);
  }, duration);
}


/* ---------------- register-button hover theme ---------------- */

let hoverCount = 0;

/**
 * Shared active-state theme for every register button (hover, keyboard focus
 * or touch): the whole page background
 * goes black and yellow/cream element fills swap.
 */
export function setRegisterHover(on: boolean) {
  hoverCount = Math.max(0, hoverCount + (on ? 1 : -1));
  const active = hoverCount > 0;
  const root = document.documentElement;
  const page = document.querySelector(".hackrx-page");
  root.style.setProperty("--void", active ? "#141414" : "#341539");
  root.style.setProperty("--paper", active ? "#141414" : "#341539");
  page?.classList.toggle("hero-accent-yellow", active);
}

/**
 * Force-clears the register hover theme. Use on route changes / unmount so a
 * button whose release event never fired (e.g. clicking through to navigate)
 * doesn't leave the page stuck on the dark hover background.
 */
export function clearRegisterHover() {
  hoverCount = 0;
  const root = document.documentElement;
  const page = document.querySelector(".hackrx-page");
  root.style.setProperty("--void", "#341539");
  root.style.setProperty("--paper", "#341539");
  page?.classList.remove("hero-accent-yellow");
}

/* ---------------- anchor navigation ---------------- */

/**
 * Anchor navigation that survives layout shifts: the hero is a tall sticky
 * section whose inner blocks animate their height, so we re-measure while we
 * travel instead of committing to a destination up front.
 */
let routerNavigate: ((to: string) => void) | null = null;

/** Lets non-React code perform client-side navigation (no full page reload). */
export function setRouterNavigate(fn: ((to: string) => void) | null) {
  routerNavigate = fn;
}

export function scrollToSection(e: MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  const target = document.getElementById(id);
  if (!target) {
    // Section lives on the home page (e.g. we're on the 404 route). Navigate
    // client-side so the app doesn't pay for a full document reload.
    if (routerNavigate) routerNavigate(`/#${id}`);
    else window.location.href = `/#${id}`;
    return;
  }


  const startY = window.scrollY;
  const startTime = performance.now();
  const DUR = 900;
  const SETTLE = 700;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const step = (now: number) => {
    const elapsed = now - startTime;
    const destination = target.getBoundingClientRect().top + window.scrollY;

    if (elapsed < DUR) {
      const t = ease(elapsed / DUR);
      window.scrollTo(0, startY + (destination - startY) * t);
      requestAnimationFrame(step);
    } else {
      window.scrollTo(0, destination);
      if (elapsed < DUR + SETTLE) requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

/* ---------------- ambient inversion pulse ---------------- */

/**
 * Fires a 0.5s full-screen colour inversion every 60s. Deliberately rare so the
 * effect stays a flourish rather than a photosensitivity hazard.
 * Returns a cleanup function.
 */
export function startInvertCycle(period = 45000, duration = 500) {
  const id = window.setInterval(() => {
    if (effectBudget() === "off") return;
    flashInvert(duration);
    flashEcho(250);
  }, period);
  return () => window.clearInterval(id);
}


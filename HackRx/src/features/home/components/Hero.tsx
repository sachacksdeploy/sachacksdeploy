import { setRegisterHover } from "@/utils/effects";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { useEffect, useRef, useCallback, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useMotionTemplate,
  useMotionValue,
} from "framer-motion";
import { mascot, mascotYellow, HERO_PHOTOS, sachackslogo } from "@/assets/images";
import { useRegistrationDialog } from "@/components/layout/Layout";


// ---------------------------------------------------------------------------
// Image data — aspect ratios from original CDN, CSS offsets from source
// ---------------------------------------------------------------------------

interface HeroImage {
  id: number;
  w: number;
  h: number;
  top: string;
  left: string;
  /** Individual parallax magnitude in vw. null = no individual parallax */
  parallax: number | null;
  /** true = moves WITH grid direction at keyframe 0, false = moves OPPOSITE */
  parallaxPositive: boolean;
}

const IMAGES: HeroImage[] = [
  { id: 1, w: 633, h: 944, top: "-5.4vw", left: "-7.6vw", parallax: 1, parallaxPositive: false },
  { id: 2, w: 705, h: 489, top: "7.1vw", left: "-6.8vw", parallax: null, parallaxPositive: true },
  { id: 3, w: 523, h: 781, top: "-7vw", left: "2vw", parallax: 2, parallaxPositive: false },
  { id: 4, w: 523, h: 784, top: "4.2vw", left: "-2.1vw", parallax: null, parallaxPositive: true },
  { id: 5, w: 523, h: 784, top: "-8.7vw", left: "-2.1vw", parallax: 4, parallaxPositive: true },
  { id: 6, w: 507, h: 761, top: "9.2vw", left: "-4.3vw", parallax: 2, parallaxPositive: true },
  { id: 7, w: 451, h: 676, top: "-11.1vw", left: "10.4vw", parallax: 2, parallaxPositive: true },
  { id: 8, w: 375, h: 563, top: "-3.7vw", left: "13.2vw", parallax: 5, parallaxPositive: true },
  { id: 9, w: 523, h: 784, top: "-9vw", left: "-10.6vw", parallax: null, parallaxPositive: true },
  { id: 10, w: 422, h: 632, top: "7.1vw", left: "1.8vw", parallax: 2, parallaxPositive: false },
  { id: 11, w: 523, h: 370, top: "-8.2vw", left: "0.7vw", parallax: 3, parallaxPositive: true },
  { id: 12, w: 423, h: 620, top: "5.4vw", left: "3.3vw", parallax: null, parallaxPositive: true },
];

// ---------------------------------------------------------------------------
// Lerp utility — replicates Webflow smoothing: 97 (factor = 0.03)
// ---------------------------------------------------------------------------

const LERP_FACTOR = 0.03;

/** Sub-pixel threshold: below this the parallax is visually settled, so we snap
 *  to the target and stop writing transforms instead of easing forever. */
const EPS = 0.0002;

function lerp(current: number, target: number): number {
  return current + (target - current) * LERP_FACTOR;
}

// ---------------------------------------------------------------------------
// Color interpolation for color-bg (mouse X driven)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Placeholder component
// ---------------------------------------------------------------------------

function HeroImage({
  w,
  h,
  src,
  className,
  style,
}: {
  w: number;
  h: number;
  src: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="eager"
      className={`object-cover collage-photo ${className ?? ""}`}
      style={{ aspectRatio: `${w}/${h}`, ...style, maxWidth: "none" }}
    />
  );
}

// ---------------------------------------------------------------------------
// HeroSection
// ---------------------------------------------------------------------------

export function Hero({ gridInView = false }: { gridInView?: boolean }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const { setOpen } = useRegistrationDialog();

  // ---- Mouse state (normalised 0-1, resting at 0.5) ----

  const mouseTarget = useRef({ x: 0.5, y: 0.5 });
  const mouseCurrent = useRef({ x: 0.5, y: 0.5 });

  // ---- Grid + individual image transforms (vw) ----
  const gridRef = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ---- Grid intro animation state (a-18: opacity 0→1, scale 0.8→1, 800ms delay, 1400ms ease) ----
  const introStartTime = useRef<number | null>(null);
  const introScale = useRef(0.8);
  const introOpacity = useRef(0);
  const introDone = useRef(false);

  // ---- Color-bg ----
  const [buttonHovered, setButtonHovered] = useState(false);
  // Mouse hover + keyboard focus + touch all drive the same glitch/theme swap.
  const ctaTriggers = useGlitchTriggers(setButtonHovered);

  // ---- Scroll-based parallax ----
  // Original Webflow event e-2 config (line 20146):
  //   smoothing: 97, startsEntering: false, startsExiting: false
  //   Progress 0% = section top at viewport top
  //   Progress 100% = section bottom at viewport bottom
  //   smoothing: 97 = heavy lerp on scroll progress (same as mouse parallax)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Apply smoothing: 97 equivalent — heavy spring that prevents instant jumps
  // (e.g. on page load with scroll restoration)
  const smoothProgress = useSpring(scrollYProgress, {
    damping: 50,
    stiffness: 20,
    restDelta: 0.0001,
  });

  // Original template motion curve
  const imgY = useTransform(smoothProgress, [0, 1], ["0%", "-250%"]);
  const imgScale = useTransform(smoothProgress, [0, 1], [1, 1.3]);
  const imgBlur = useTransform(smoothProgress, [0, 1], [0, 30]);
  const imgOpacity = useTransform(smoothProgress, [0, 1], [1, 0]);
  const filterBlur = useMotionTemplate`blur(${imgBlur}px)`;

  // ---- Mouse tracking (page-level, replicating Webflow's PAGE MOUSE_MOVE) ----
  const handleMouseMove = useCallback((e: MouseEvent) => {
    mouseTarget.current = {
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
    };
  }, []);

  // Pre-warm both mascot artworks so the hover swap never flashes.
  useEffect(() => {
    [mascot, mascotYellow].forEach((src) => {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    });
  }, []);

  useEffect(() => {
    // Skip mouse parallax on touch/coarse-pointer devices — saves battery and rAF work.
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!mql.matches) return;
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  // ---- RAF lerp loop for mouse parallax + grid intro ----
  useEffect(() => {
    function tick(timestamp: number) {
      // ---- Grid intro animation (a-18): 800ms delay, 1400ms ease ----
      if (!introDone.current) {
        if (introStartTime.current === null) {
          introStartTime.current = timestamp;
        }
        const elapsed = timestamp - introStartTime.current;
        const DELAY = 800;
        const DURATION = 1400;

        if (elapsed < DELAY) {
          introScale.current = 0.8;
          introOpacity.current = 0;
        } else {
          const t = Math.min((elapsed - DELAY) / DURATION, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          introScale.current = 0.8 + 0.2 * eased;
          introOpacity.current = eased;
          if (t >= 1) introDone.current = true;
        }
      }

      // ---- Mouse parallax lerp ----
      // A plain lerp approaches its target asymptotically and never actually
      // arrives, so writing transforms unconditionally kept repainting the grid
      // and every hero image on EVERY frame for the life of the page — a
      // permanent ~60% frame-rate loss the moment the pointer moved once.
      // Snap once we're within a sub-pixel epsilon, then stop writing entirely.
      const prev = mouseCurrent.current;
      const target = mouseTarget.current;

      let nx = lerp(prev.x, target.x);
      let ny = lerp(prev.y, target.y);
      if (Math.abs(target.x - nx) < EPS) nx = target.x;
      if (Math.abs(target.y - ny) < EPS) ny = target.y;

      const moved = nx !== prev.x || ny !== prev.y;
      mouseCurrent.current = { x: nx, y: ny };

      // Only touch the DOM when the parallax actually changed or the intro is
      // still running. A settled hero costs zero layout/paint work.
      if (moved || !introDone.current) {
        // Grid: maps [0,1] -> [+20, -20] vw
        const gridX = 20 - nx * 40;
        const gridY = 20 - ny * 40;

        // Combine intro scale + mouse translate on the SAME element (matches original)
        if (gridRef.current) {
          const s = introScale.current;
          gridRef.current.style.transform = `translate3d(${gridX}vw, ${gridY}vw, 0px) scale3d(${s}, ${s}, 1)`;
          gridRef.current.style.opacity = String(introOpacity.current);
        }

        // Individual images
        if (moved) {
          imgRefs.current.forEach((el, id) => {
            const img = IMAGES.find((i) => i.id === id);
            if (!img || img.parallax === null) return;

            const mag = img.parallax;
            const sign = img.parallaxPositive ? 1 : -1;

            // At mouse 0 (left/top): positive images get +mag, negative get -mag
            // At mouse 1 (right/bottom): positive images get -mag, negative get +mag
            const ix = sign * (mag - nx * mag * 2);
            const iy = sign * (mag - ny * mag * 2);

            el.style.transform = `translate3d(${ix}vw, ${iy}vw, 0)`;
          });
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    // The loop is decorative: it must not burn frames while the hero is
    // scrolled away or the tab is in the background.
    const start = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };

    let visible = true;
    const sync = () => (visible && !document.hidden ? start() : stop());

    const el = sectionRef.current;
    const io = el
      ? new IntersectionObserver(
        ([e]) => {
          visible = e.isIntersecting;
          sync();
        },
        { threshold: 0 },
      )
      : null;
    io?.observe(el!);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, []);

  // ---- Ref callback for individual images ----
  const setImgRef = useCallback((id: number) => (el: HTMLDivElement | null) => {
    if (el) imgRefs.current.set(id, el);
    else imgRefs.current.delete(id);
  }, []);

  // ---- Hero entry glitch shake (stronger sibling of the section shake) ----
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let last = 0;
    const fire = () => {
      const now = performance.now();
      if (now - last < 1400) return;
      last = now;
      el.classList.remove("sv-hero-enter");
      void el.offsetWidth;
      el.classList.add("sv-hero-enter");
      window.setTimeout(() => el.classList.remove("sv-hero-enter"), 1050);
    };
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) fire(); },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ---- Hovering the register button darkens the whole page background ----
  useEffect(() => {
    if (!buttonHovered) return;
    setRegisterHover(true);
    return () => setRegisterHover(false);
  }, [buttonHovered]);

  return (
    <>
      {/* Hero section */}
      <div
        ref={sectionRef}
        className="relative hero-scroll"
      >
        {/* Sticky viewport */}
        <div
          className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden"
          style={{ perspective: "1000px" }}
        >
          {/* ---- 1. Minimal text layer (z-200) ---- */}
          <div className="relative z-[200] flex flex-col justify-start items-center text-center px-[7%] md:px-0">
            <motion.div
              className="overflow-hidden"
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              transition={{ delay: 0.1, duration: 0.7, ease: "easeInOut" }}
            >
              <div className="flex items-center justify-center">
                <h1>
                  <img
                    src={sachackslogo}
                    alt="Sachacks Logo"
                    style={{ transform: 'scale(1.1)', transformOrigin: 'top left' }}
                  />
                </h1>
              </div>
              <div className="w-[92vw] max-w-[92vw] lg:max-w-[900px] flex items-center justify-center py-[2vw]">
                <h1 className="collage-title">
                  Prescribe <em>Innovation.</em>
                </h1>
              </div>
            </motion.div>

            <motion.div
              className="mascot hero-mascot-inline z-[200]"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: gridInView ? 0 : 1, y: gridInView ? 40 : 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <div className="bubble">Let's build something<br />that heals!</div>
              <span className="mascot-stack">
                <img
                  src={mascot}
                  alt="HackRx mascot in a lab coat and surgical mask, waving"
                />
                <img
                  src={mascotYellow}
                  alt=""
                  aria-hidden="true"
                  className="mascot-alt"
                />
              </span>
            </motion.div>

            <motion.div
              className="flex flex-col justify-start items-center overflow-hidden"
              initial={{ height: 0 }}
              animate={{ height: gridInView ? 0 : "auto" }}
              transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="pt-6">
                <a
                  href="#register"
                  className="btn btn-primary"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(true);
                  }}
                  {...ctaTriggers}
                >
                  Register Now →
                </a>

              </div>
            </motion.div>
          </div>

          {/* ---- 2. block-img-hero: absolute inset-0, flex col center ---- */}
          <motion.div
            className="absolute inset-0 z-0 flex flex-col items-center justify-center"
            style={{
              y: imgY,
              scale: imgScale,
              opacity: imgOpacity,
              filter: filterBlur,
              transformStyle: "preserve-3d",
              willChange: "opacity, filter, transform",
            }}
          >
            {/* grid-img-hero: scale + translate combined on same element (matches original a-18)
                Desktop: gap 10vw, images 20vw
                ≤991px:  gap 15vw, images 30vw
                ≤479px:  gap 15vw, images 40vw
                Tailwind is mobile-first, so base=479, md=768, lg=992 */}
            <div
              ref={gridRef}
              className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-[15vw] lg:gap-[10vw] absolute"
              style={{
                gridTemplateRows: "auto auto",
                gridAutoColumns: "1fr",
                placeItems: "center stretch",
                opacity: 0,
                transform: "translate3d(0,0,0) scale3d(0.8, 0.8, 1)",
                willChange: "transform, opacity",
              }}
            >
              {IMAGES.map((img) => (
                <div
                  key={img.id}
                  ref={setImgRef(img.id)}
                  className="will-change-transform"
                  style={{ transform: "translate3d(0,0,0)" }}
                >
                  <HeroImage
                    w={img.w}
                    h={img.h}
                    src={HERO_PHOTOS[img.id - 1]}
                    className="w-[40vw] md:w-[30vw] lg:w-[20vw]"
                    style={{
                      maxWidth: "none",
                      position: "relative",
                      top: img.top,
                      left: img.left,
                    }}
                  />
                </div>
              ))}
            </div>
          </motion.div>

          {/* ---- 3. Scroll indicator (z-50, bottom) ----
               a-12: grid enters view → height auto→0 (400ms ease)
               a-13: grid leaves view → height 0→auto (400ms ease) */}
          <motion.div
            className="absolute bottom-[30px] z-50 flex flex-col justify-end items-center overflow-hidden"
            initial={{ opacity: 0, height: "auto" }}
            animate={{
              opacity: gridInView ? 0 : 1,
              height: gridInView ? 0 : "auto",
            }}
            transition={{
              opacity: { duration: gridInView ? 0.4 : 0.7, delay: gridInView ? 0 : 0.1, ease: "easeOut" },
              height: { duration: 0.4, ease: "easeInOut" },
            }}
          >
            {/* Scroll line container */}
            <div
              className="overflow-hidden"
              style={{
                width: 1,
                height: 26,
                backgroundColor: "var(--line)",
              }}
            >
              {/* Animated line — looping slide-through */}
              <motion.div
                style={{
                  width: 1,
                  height: 26,
                  backgroundColor: "var(--crimson)",
                }}
                animate={{
                  y: ["-100%", "-100%", "100%", "-120%"],
                }}
                transition={{
                  duration: 2.1,
                  times: [0, 0.33, 0.66, 0.67],
                  ease: ["easeInOut", "easeInOut", "easeInOut", "linear"],
                  repeat: Infinity,
                  repeatDelay: 0,
                }}
              />
            </div>

            {/* Scroll text with pulsing opacity */}
            <motion.span
              className="mt-3 text-[13px] uppercase font-medium leading-[120%]"
              style={{
                letterSpacing: "1.85px",
                fontFamily: "var(--mono)",
              }}
              animate={{
                color: [
                  "rgba(242,236,225,0.35)",
                  "rgba(242,236,225,0.35)",
                  "rgba(242,236,225,1)",
                  "rgba(242,236,225,0.35)",
                ],
              }}
              transition={{
                duration: 2.1,
                times: [0, 0.33, 0.66, 0.67],
                ease: "easeInOut",
                repeat: Infinity,
              }}
            >
              Scroll
            </motion.span>
          </motion.div>
        </div>
      </div>
    </>
  );
}

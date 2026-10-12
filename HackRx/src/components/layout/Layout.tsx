import {
  useEffect,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  scrollToSection,
  setRegisterHover,
  startInvertCycle,
  startPerfMonitor,
  setRouterNavigate,
} from "@/utils/effects";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { useNavigate, useLocation } from "react-router-dom";
import { AuthDialog } from "@/features/auth/components/AuthDialog";
import { useAuth } from "@/context/auth-context";
import { signOut } from "@/services/auth.service";
import { useAdmin } from "@/hooks/useAdmin";
import { useAcceptance } from "@/hooks/useAcceptance";
import { Button } from "@/components/ui/button";
import "@/styles/hackrx.css";

/* ============================ shared SVG bits ============================ */

export const SvgDefs = () => (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
    <defs>
      <filter id="paintRough" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves={2} seed={7} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={7} xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="grainFilter" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={4} stitchTiles="stitch" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0" />
      </filter>
    </defs>
  </svg>
);

export const Amoeba = ({
  tone,
  size,
  style,
}: {
  tone: "crimson" | "violet" | "gold" | "ink";
  size: "tiny" | "sm" | "md" | "lg";
  style?: CSSProperties;
}) => <div className={`amoeba ${tone} ${size}`} style={style} aria-hidden="true" />;

export const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

/* ====================== registration dialog context ====================== */

import { RegistrationContext, useRegistrationDialog, type AuthDialogMode } from "@/context/registration-context";

export { useRegistrationDialog };

/* ================================== nav ================================== */

const LINKS = [
  { id: "prizes", label: "Track & Prizes" },
  { id: "timeline", label: "Timeline" },
  { id: "faq", label: "FAQ" },
  { id: "team", label: "About" },
];

const SPY_IDS = [...LINKS.map((l) => l.id), "register"];

const Wordmark = () => {
  const [glitching, setGlitching] = useState(false);
  const pulse = () => {
    setGlitching(false);
    window.requestAnimationFrame(() => setGlitching(true));
    window.setTimeout(() => setGlitching(false), 360);
  };
  return (
    <a
      href="/"
      className={`nav-word${glitching ? " is-glitching" : ""}`}
      onMouseEnter={pulse}
      onFocus={pulse}
      onTouchStart={pulse}
      onClick={(e) => {
        e.preventDefault();
        if (window.location.pathname === "/") window.scrollTo({ top: 0, behavior: "smooth" });
        else window.location.assign("/");
      }}
      aria-label="HackRx — back to top"
    >
      Hack<em data-letter="R">R</em>x
    </a>
  );
};

const NavBurger = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className={`nav-burger${open ? " is-open" : ""}`}
    aria-label={open ? "Close menu" : "Open menu"}
    aria-expanded={open}
    onClick={onToggle}
  >
    <span />
    <span />
    <span />
  </Button>
);

export const Nav = () => {
  const [active, setActive] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const ctaTriggers = useGlitchTriggers(setRegisterHover);
  const { openAuth } = useRegistrationDialog();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.42;
      let current: string | null = null;
      for (const id of SPY_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current === "register" ? "team" : current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <nav className="nav">
      <div className="nav-left">
        <Wordmark />
      </div>
      <ul className="nav-links">
        {LINKS.map((l) => (
          <li key={l.id}>
            <a
              href={`#${l.id}`}
              className={active === l.id ? "is-active" : undefined}
              aria-current={active === l.id ? "true" : undefined}
              onClick={(e) => scrollToSection(e, l.id)}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
      <NavBurger open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
      <div className="nav-actions">
        {user ? (
          <a
            href="/dashboard"
            className="nav-cta"
            {...ctaTriggers}
            onClick={(e) => {
              e.preventDefault();
              navigate("/dashboard");
            }}
          >
            Hacker Hub
          </a>
        ) : (
          <a
            href="#login"
            className="nav-cta"
            {...ctaTriggers}
            onClick={(e) => {
              e.preventDefault();
              openAuth("login");
            }}
          >
            Log In
          </a>
        )}
      </div>
      <div className={`nav-drawer${menuOpen ? " is-open" : ""}`} hidden={!menuOpen}>
        <ul>
          {LINKS.map((l) => (
            <li key={l.id}>
              <a
                href={`#${l.id}`}
                className={active === l.id ? "is-active" : undefined}
                onClick={(e) => {
                  setMenuOpen(false);
                  scrollToSection(e, l.id);
                }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
};

/* ============================== portal nav =============================== */

const PORTAL_LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/teams", label: "Teams" },
  { to: "/account", label: "Account" },
];

export const PortalNav = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctaTriggers = useGlitchTriggers(setRegisterHover);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isAdmin } = useAdmin();
  const { accepted } = useAcceptance();
  const portalLinks = isAdmin
    ? [
      { to: "/", label: "Home" },
      { to: "/admin", label: "Dashboard" },
    ]
    // Teams only appears once the participant is accepted (has a team_id).
    : PORTAL_LINKS.filter((l) => l.to !== "/teams" || accepted);

  const onLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <nav className="nav">
      <div className="nav-left">
        <Wordmark />
      </div>
      <ul className="nav-links">
        {portalLinks.map((l) => (
          <li key={l.to}>
            <a
              href={l.to}
              className={pathname === l.to ? "is-active" : undefined}
              aria-current={pathname === l.to ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(l.to);
              }}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
      <NavBurger open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
      <div className="nav-actions">
        <a
          href="#logout"
          className="nav-cta"
          {...ctaTriggers}
          onClick={(e) => {
            e.preventDefault();
            void onLogout();
          }}
        >
          Log Out
        </a>
      </div>
      <div className={`nav-drawer${menuOpen ? " is-open" : ""}`} hidden={!menuOpen}>
        <ul>
          {portalLinks.map((l) => (
            <li key={l.to}>
              <a
                href={l.to}
                className={pathname === l.to ? "is-active" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                  navigate(l.to);
                }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
};

/* ================================ layout ================================= */

export const Layout = ({
  children,
  portal = false,
}: {
  children: ReactNode;
  portal?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthDialogMode>("signup");
  const navigate = useNavigate();

  // Ambient glitch pulse: runs on every page (home + 404).
  useEffect(() => startInvertCycle(45000, 500), []);

  // Pause / downgrade glitches in background tabs and when frames get tight.
  useEffect(() => startPerfMonitor(), []);

  // Let effects.ts navigate without a full page reload (404 -> /#section).
  useEffect(() => {
    setRouterNavigate((to) => navigate(to));
    return () => setRouterNavigate(null);
  }, [navigate]);

  const openAuth = (next: AuthDialogMode) => {
    setMode(next);
    setOpen(true);
  };

  return (
    <RegistrationContext.Provider
      value={{
        open,
        mode,
        setOpen: (v: boolean) => {
          if (v) setMode("signup");
          setOpen(v);
        },
        openAuth,
      }}
    >
      <div className="hackrx-page">
        <SvgDefs />
        <div className="grain-overlay" aria-hidden="true" />
        {portal ? <PortalNav /> : <Nav />}
        {children}
      </div>
      <AuthDialog open={open} mode={mode} onOpenChange={setOpen} onModeChange={setMode} />
    </RegistrationContext.Provider>
  );
};


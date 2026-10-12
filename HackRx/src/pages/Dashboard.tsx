import { useEffect, useState } from "react";
import { Layout, Amoeba } from "@/components/layout/Layout";
import { PortalDecor } from "@/components/layout/PortalDecor";
import { useAuth } from "@/context/auth-context";
import { fetchProfile, type Profile } from "@/services/auth.service";
import { Countdown } from "@/features/home/components/Countdown";
import { useNavigate } from "react-router";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { fetchApplicationStatus, type ApplicationStatus } from "@/services/application.service";
import { useAcceptance } from "@/hooks/useAcceptance";
import { X } from "lucide-react";

const APPEAL_VIDEO = "https://www.youtube.com/embed/8RFbx4lK-Qs?si=2Spwih1i9thvaOdt";

// Midnight Pacific at the start of each day. November dates use PST (UTC-8):
// daylight saving ends Nov 1, 2026.
const APPLICATIONS_CLOSE = "2026-11-08T00:00:00-08:00";
const EVENT_START = "2026-11-15T00:00:00-08:00";

/** "loading" until Firestore answers; null means the user hasn't applied. */
type StatusState = ApplicationStatus | null | "loading";

const STATUS_DISPLAY: Record<ApplicationStatus | "none", { label: string; dot: string }> = {
  none: { label: "Not submitted", dot: "bg-orange-400" },
  pending: { label: "Pending...", dot: "bg-blue-400" },
  approved: { label: "Accepted", dot: "bg-green-400" },
  rejected: { label: "DECLINED 🫵😂", dot: "bg-red-400" },
};

const Dashboard = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<StatusState>("loading");
  // Accepted = users/{uid}.team_id has a value. Picks which dashboard to show.
  const { accepted, loading: acceptanceLoading } = useAcceptance();

  useEffect(() => {
    if (!user) return;
    let active = true;
    setStatus("loading");
    // Both read users/{uid}: the profile for the greeting, and its
    // `application` field for whether (and how) they've applied.
    void fetchProfile(user.uid).then((p) => { if (active) setProfile(p); });
    void fetchApplicationStatus(user.uid).then((s) => { if (active) setStatus(s); });
    return () => { active = false; };
  }, [user]);

  const name = profile?.username || profile?.full_name || user?.email?.split("@")[0] || "hacker";
  
  const loading = status === "loading" || acceptanceLoading;
  const submitted = status !== "loading" && status !== null;
  const display = STATUS_DISPLAY[status === "loading" || status === null ? "none" : status];

  const navigate = useNavigate();
  const applyTriggers = useGlitchTriggers();
  const teamsTriggers = useGlitchTriggers();
  const appealTriggers = useGlitchTriggers();
  const [appealOpen, setAppealOpen] = useState(false);

  // While the appeal video is up: lock page scroll and let Escape close it.
  useEffect(() => {
    if (!appealOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAppealOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [appealOpen]);
  const toApplicationForm = () => {
    navigate("/apply")
  }

  const pillClass =
    "inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2.5 font-sans text-sm text-[var(--cream)]";

  const statusPill = (label: string, dot: string) => (
    <span className={pillClass} aria-live="polite">
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      Status: {label}
    </span>
  );

  /* ---- Accepted: has a team_id ---- */
  const acceptedView = (
    <>
      <p className="chapter-sub">You're in! Head to Teams to meet your teammates before the event.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          className="nav-cta cursor-pointer !px-7 !py-3 !text-base"
          {...teamsTriggers}
          onClick={() => navigate("/teams")}
        >
          Go to Teams
        </button>
        {statusPill("Accepted", "bg-green-400")}
      </div>
    </>
  );

  /* ---- Waiting on acceptance: no team_id yet ---- */
  const waitingView = (
    <>
      <p className="chapter-sub">
        {submitted ? "Thanks for applying! Your status updates here." : "Applications open! Apply now!"}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        {/* Same pill style + glitch hover as the nav's Hacker Hub button, sized up */}
        {/* Only offer Apply once we know they haven't — one application per account. */}
        {!submitted && (
          <button
            type="button"
            className="nav-cta cursor-pointer !px-7 !py-3 !text-base"
            {...applyTriggers}
            onClick={toApplicationForm}
          >
            Apply
          </button>
        )}
        {statusPill(display.label, display.dot)}
        {status === "rejected" && (
          <button
            type="button"
            className="nav-cta cursor-pointer !px-7 !py-3 !text-base"
            {...appealTriggers}
            onClick={() => setAppealOpen(true)}
          >
            Appeal
          </button>
        )}
      </div>
    </>
  );

  const loadingView = (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
      {statusPill("Checking...", "bg-white/30 animate-pulse")}
    </div>
  );

  return (
    <Layout portal>
      <section className="panel chapter portal">
        <PortalDecor />
        <Amoeba tone="violet" size="sm" style={{ top: "18%", left: "6%", animationDelay: "-2s, -5s" }} />
        <Amoeba tone="gold" size="tiny" style={{ bottom: "18%", right: "8%", animationDelay: "-6s, -1s" }} />
        <span className="eyebrow">Hacker Hub</span>
        <h1 className="chapter-title">Welcome, {name}</h1>
        {loading ? loadingView : accepted ? acceptedView : waitingView}
        {/* Not accepted yet: count down to the application deadline. Accepted: to the event. */}
        {!loading && (accepted
          ? <Countdown label="Event starts in" target={EVENT_START} />
          : <Countdown label="Applications close in" target={APPLICATIONS_CLOSE} />)}
        {/* Only shown once the user's application has come back rejected. */}
      </section>

      {/* Appeal: the video takes over the whole screen until closed. */}
      {appealOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Appeal"
          className="fixed inset-0 z-[1000] bg-black"
        >
          <iframe
            className="h-full w-full"
            src={`${APPEAL_VIDEO}&autoplay=1`}
            title="Appeal video"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <button
            type="button"
            autoFocus
            onClick={() => setAppealOpen(false)}
            aria-label="Close"
            title="Close (Esc)"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="h-6 w-6" strokeWidth={3} />
          </button>
        </div>
      )}
    </Layout>
  );
};

export default Dashboard;
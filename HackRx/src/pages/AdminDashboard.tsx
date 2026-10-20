/**
 * Admin control room — the roster design wired to the real Firebase services.
 *
 * Fonts: add to index.html <head> (or keep the @import in STYLES below):
 *   <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
 *
 * Still placeholders, because nothing in Firestore backs them yet — each is
 * marked PLACEHOLDER inline:
 *   · team leaders (no leader field anywhere)
 *   · the "Waiting on you" request queue
 *   · team bulk actions (no service functions exist for them)
 *   · the awards list and event dates/venue (hardcoded constants)
 *
 * Not shown at all (no placeholder line): per-hacker pitch, logistics and class
 * year from the design — applications don't store those fields.
 *
 * SECURITY — every string on this page (names, emails, institutions, demo
 * titles and links) was typed by a participant, so it is treated as untrusted.
 * Guardrails added here are each marked SECURITY inline:
 *   · demo links are only clickable if they are http(s)
 *   · emails are validated before going into a mailto: link
 *   · CSV export neutralises spreadsheet formulas
 *   · bulk actions only touch rows that are visible, ask before changing
 *     several records, can't be double-fired, and never issue a duplicate cert
 * These protect the admin's browser and guard against mistakes. They are NOT
 * access control: who may read or write these collections has to be enforced
 * by Firestore Security Rules, which this file cannot do.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { PortalDecor } from "@/components/layout/PortalDecor";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAdminWorkspace,
  issueCertification,
  reviewApplication,
  type AdminWorkspace,
} from "@/services/admin.service";
import {
  MAX_DECLINE_COMMENT,
  type DeclineDetails,
  sendDeclineEmail,
  type DeclineReason,
} from "@/services/email.service";
import { MAX_TEAM_SIZE } from "@/services/team.service";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/** The old dashboard said "HackRx", the design says "SacHacks VIII". Pick one here. */
const EVENT_NAME = "Admin Control Room";
// PLACEHOLDER — the event's dates, printed on the certificate preview. Should come
// from an event/settings document in Firestore; hardcoded because none exists.
// Seen: Certificates tab → Prizes panel → top line of the PREVIEW card.
const EVENT_DATES = "15 November 2026";
// PLACEHOLDER — the venue/host line printed on the certificate preview. Same story:
// belongs on an event/settings document, hardcoded until there is one.
// Seen: Certificates tab → Prizes panel → PREVIEW card, sentence under the recipient.
const EVENT_VENUE =
  "Awarded at SacHacks VIII, hosted at the University of California, Davis in partnership with UC Davis Health.";
const DEFAULT_CERT_TITLE = "HackRx Participant"; // matches issueCertification's fallback

const EMPTY: AdminWorkspace = { applications: [], teams: [], demos: [], members: [], certifications: [] };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Lens = "signups" | "teams" | "demos" | "certs";
type SignupStatus = "pending" | "accepted" | "declined" | "none";
type Tone = "accepted" | "declined" | "pend" | "off";

interface Row {
  /** Stable key: "member:<id>" or "app:<id>". */
  key: string;
  name: string;
  email: string;
  school: string;
  signup: SignupStatus;
  cert: string | null;
  /** Null when this person registered but never submitted an application. */
  applicationId: string | null;
  /** Null when an application has no matching user account — can't be certified. */
  memberId: string | null;
  /** The `team_id` on their user document, or null when they have none. */
  teamId: string | null;
  /** Every answer from their submitted application, or null if they haven't submitted one. */
  answers: Record<string, unknown> | null;
}

interface TeamRow {
  id: string;
  name: string;
  track: string | null;
  /** Everyone on the roster whose `team_id` is this team. */
  members: Row[];
}

interface DemoRow {
  id: string;
  title: string;
  status: string;
  url: string | null;
}

interface Award {
  id: string;
  num: string;
  label: string;
  desc: string;
  everyone?: boolean;
}

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */

const C = {
  bg: "#221029",
  surface: "#2C1434",
  sunken: "#1B0C21",
  ink: "#F2EDE4",
  ink75: "rgba(242,237,228,.75)",
  ink70: "rgba(242,237,228,.7)",
  ink60: "rgba(242,237,228,.6)",
  ink50: "rgba(242,237,228,.5)",
  ink45: "rgba(242,237,228,.45)",
  ink40: "rgba(242,237,228,.4)",
  ink35: "rgba(242,237,228,.35)",
  line: "rgba(242,237,228,.1)",
  line09: "rgba(242,237,228,.09)",
  border: "rgba(242,237,228,.12)",
  border18: "rgba(242,237,228,.18)",
  border28: "rgba(242,237,228,.28)",
  pink: "#E838A6",
  pinkSoft: "rgba(232,56,166,.12)",
  lilac: "#B79CE8",
  lilacSoft: "rgba(183,156,232,.16)",
  gold: "#F5E27B",
} as const;

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";
const SANS = "'Space Grotesk', system-ui, -apple-system, sans-serif";
/** The site's comic heading face (Bangers), from hackrx.css. */
const DISPLAY = "var(--comic-display)";

const headingStyle: CSSProperties = {
  margin: 0,
  fontFamily: DISPLAY,
  fontSize: 22,
  fontWeight: 400,
  lineHeight: 1.1,
  letterSpacing: ".04em",
};

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap');

.sh-admin, .sh-admin * { box-sizing: border-box; }
.sh-admin {
  background: ${C.bg};
  color: ${C.ink};
  font-family: ${SANS};
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
  /* Clears the fixed site nav and contains <PortalDecor />, like .admin-portal did. */
  position: relative;
  overflow: hidden;
  padding-top: 100px;
  -webkit-font-smoothing: antialiased;
}
.sh-admin a { color: ${C.pink}; text-decoration: none; }
.sh-admin a:hover { color: ${C.gold}; }
.sh-admin button, .sh-admin input, .sh-admin select { font: inherit; color: inherit; }
.sh-admin :focus-visible { outline: 2px solid ${C.pink}; outline-offset: 2px; }
.sh-admin table { border-collapse: collapse; }
.sh-admin ::placeholder { color: rgba(242,237,228,.35); }
.sh-admin input[type=checkbox] { width: 15px; height: 15px; accent-color: ${C.pink}; cursor: pointer; }
.sh-admin input[type=radio] { accent-color: ${C.pink}; }
.sh-admin input[type=text]:focus, .sh-admin input[type=search]:focus { border-color: rgba(242,237,228,.4); }
.sh-admin select {
  appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, rgba(242,237,228,.5) 50%),
    linear-gradient(135deg, rgba(242,237,228,.5) 50%, transparent 50%);
  background-position: calc(100% - 15px) calc(50% - 2px), calc(100% - 10px) calc(50% - 2px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.sh-admin button:disabled { opacity: .5; cursor: not-allowed; }

.sh-lens:hover { border-color: rgba(242,237,228,.3) !important; }
.sh-row[data-on="false"]:hover { background: rgba(242,237,228,.045); }
.sh-row[data-on="true"]:hover  { background: rgba(232,56,166,.16); }
.sh-ghost:hover:not(:disabled) { background: rgba(242,237,228,.07); }
.sh-solid:hover:not(:disabled) { filter: brightness(1.12); }
.sh-award:hover { border-color: rgba(242,237,228,.3) !important; }
.sh-reason:hover { border-color: rgba(242,237,228,.3) !important; }
.sh-admin textarea:focus { border-color: rgba(242,237,228,.4); }
.sh-spin { animation: sh-rotate 1s linear infinite; }
@keyframes sh-rotate { to { transform: rotate(360deg); } }
`;

/* ------------------------------------------------------------------ */
/* Awards                                                              */
/* ------------------------------------------------------------------ */

// PLACEHOLDER — the prizes an admin can issue. Represents what would be an `awards`
// collection (one doc per prize: label, description, whether everyone is eligible).
// Hardcoded because no such collection exists; `label` is what gets saved as the
// certification's `title`, so the per-award tallies match on that string.
// Seen: Certificates tab → Prizes panel (the six radio options), the PREVIEW card
// title, and the "Issue …" buttons in the bulk bar and under the preview.
const AWARDS: Award[] = [
  { id: "trans", num: "01", label: "Best Translational Science", desc: "For the team moving discovery to bedside fastest." },
  { id: "clin", num: "02", label: "Best Clinical Impact", desc: "Best Clinical Science Prize — care that measurably improves outcomes." },
  { id: "bio", num: "03", label: "Best Biotech Innovation", desc: "Hardware, wetware, and data pushed somewhere new." },
  { id: "equity", num: "04", label: "Health Equity Award", desc: "For the build that widens access to care." },
  { id: "inter", num: "05", label: "Best Interdisciplinary Hack", desc: "Best overall hack across disciplines." },
  { id: "part", num: "06", label: DEFAULT_CERT_TITLE, desc: "Every hacker who checked in and submitted.", everyone: true },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The service types are `{ id: string; [key: string]: unknown }`, so read defensively. */
const text = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * SECURITY — demo links are submitted by participants. A `javascript:` or `data:`
 * URL in an href would run script in the admin's session when clicked, so only
 * absolute http(s) URLs are allowed through; anything else is shown as "No link".
 */
function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * SECURITY — emails come from participant-entered data. Unchecked, a value like
 * "a@b.co?bcc=attacker@x.com&body=…" would smuggle extra recipients or text into
 * the admin's mail client. Only plain single addresses pass, and they are
 * URL-encoded before being placed in a mailto: link.
 */
const EMAIL_RE = /^[^\s@,;:<>?&#%"'()\\]+@[^\s@,;:<>?&#%"'()\\]+\.[^\s@,;:<>?&#%"'()\\]+$/;
const isSafeEmail = (email: string) => email.length <= 254 && EMAIL_RE.test(email);
const mailtoHref = (email: string): string | null =>
  isSafeEmail(email) ? `mailto:${encodeURIComponent(email)}` : null;

/**
 * SECURITY — CSV/formula injection. A name such as `=HYPERLINK(...)` would be
 * executed as a formula when the export is opened in Excel or Sheets. Cells that
 * start with a formula trigger are prefixed with an apostrophe so they stay text.
 */
function csvCell(value: string): string {
  const inert = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${inert.replace(/"/g, '""')}"`;
}

/** SECURITY — bulk writes above this many records ask for confirmation first. */
const CONFIRM_ABOVE = 1;

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The application answers shown in the detail panel, in form order. Any other
 * field found on an application is listed after these under its raw key.
 */
const ANSWER_LABELS: [key: string, label: string][] = [
  ["full_name", "Full name"],
  ["phone", "Phone"],
  ["age_range", "Age"],
  ["gender", "Gender"],
  ["gender_self", "Gender (own words)"],
  ["ethnicity", "Ethnicity"],
  ["institution", "Institution"],
  ["academic_standing", "Standing"],
  ["high_school_case", "High school statement"],
  ["major", "Major"],
  ["first_hackathon", "First hackathon"],
  ["interests", "Interests"],
  ["motivations", "Motivations"],
  ["resume_link", "Resume"],
  ["github", "GitHub"],
  ["team_status", "Team"],
  ["tshirt_size", "T-shirt"],
  ["dietary", "Dietary"],
  ["dietary_other", "Dietary (other)"],
  ["referral_source", "Heard via"],
  ["goals", "Goals"],
  ["additional_info", "Additional info"],
  ["code_of_conduct", "Code of conduct"],
  ["signature", "Signature"],
  ["created_at", "Submitted"],
  ["reviewed_at", "Reviewed"],
];

/** Bookkeeping fields that are shown elsewhere or mean nothing to an admin. */
const HIDDEN_ANSWERS = new Set([
  "id", "user_id", "app_id", "email", "status", "reviewed_by", "institution_choice", "institution_other",
]);

/** Answers rendered as links (SECURITY — still only if they are http(s)). */
const LINK_ANSWERS = new Set(["resume_link", "github"]);

function formatAnswer(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatAnswer).filter(Boolean).join(", ");
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

/** The non-empty answers on an application, as [key, label, text] in display order. */
function answerRows(answers: Record<string, unknown>): [string, string, string][] {
  const known = new Set(ANSWER_LABELS.map(([k]) => k));
  const extra = Object.keys(answers)
    .filter((k) => !known.has(k) && !HIDDEN_ANSWERS.has(k))
    .sort()
    .map((k): [string, string] => [k, k.replace(/_/g, " ")]);
  return [...ANSWER_LABELS, ...extra]
    .map(([k, label]): [string, string, string] => [k, label, formatAnswer(answers[k])])
    .filter(([, , v]) => v !== "");
}

function toSignupStatus(raw: unknown): SignupStatus {
  const s = text(raw).toLowerCase();
  if (s === "approved" || s === "accepted") return "accepted";
  if (s === "rejected" || s === "declined") return "declined";
  return "pending";
}

function statusTone(s: SignupStatus): { label: string; bg: string; fg: string } {
  switch (s) {
    case "accepted": return { label: "Accepted", bg: C.lilacSoft, fg: C.lilac };
    case "declined": return { label: "Declined", bg: "rgba(242,237,228,.08)", fg: "rgba(242,237,228,.55)" };
    case "none": return { label: "No application", bg: "rgba(242,237,228,.08)", fg: "rgba(242,237,228,.55)" };
    default: return { label: "Awaiting decision", bg: "rgba(245,226,123,.14)", fg: C.gold };
  }
}

function tone(t: Tone): { bg: string; fg: string } {
  switch (t) {
    case "accepted": return { bg: C.lilacSoft, fg: C.lilac };
    case "declined": return { bg: "rgba(242,237,228,.08)", fg: "rgba(242,237,228,.55)" };
    case "off": return { bg: "rgba(242,237,228,.08)", fg: "rgba(242,237,228,.55)" };
    default: return { bg: "rgba(245,226,123,.14)", fg: C.gold };
  }
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

const cardStyle: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  overflow: "hidden",
};

const cardHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "16px 20px",
  borderBottom: `1px solid ${C.line}`,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  fontFamily: MONO,
  fontWeight: 500,
  fontSize: 11,
  lineHeight: 1,
  letterSpacing: ".1em",
  color: C.ink40,
  padding: "13px 16px",
  borderBottom: `1px solid ${C.line}`,
  whiteSpace: "nowrap",
};

const selectStyle: CSSProperties = {
  background: C.sunken,
  border: `1px solid ${C.border18}`,
  borderRadius: 8,
  padding: "7px 30px 7px 11px",
  fontSize: 13.5,
  cursor: "pointer",
  outline: "none",
};

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 99,
        fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap",
        background: bg, color: fg,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: fg }} />
      {label}
    </span>
  );
}

function GhostButton({
  children, onClick, disabled,
}: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="sh-ghost"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none", border: `1px solid ${C.border28}`, borderRadius: 8,
        padding: "5px 10px", fontSize: 12.5, fontWeight: 500, color: C.ink, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DetailRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 14,
        padding: "11px 0", borderBottom: last ? "none" : `1px solid ${C.line}`,
      }}
    >
      <span style={{ width: 104, flex: "none", fontSize: 13, color: C.ink45 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13.5 }}>{children}</span>
    </div>
  );
}

function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ padding: "46px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</div>
      <div style={{ fontSize: 13, color: C.ink50, marginTop: 6 }}>{note}</div>
    </div>
  );
}

/** The checkboxes in the decline dialog, in display order. */
const DECLINE_OPTIONS: { key: DeclineReason; label: string }[] = [
  { key: "bot", label: "Bot / automated registration" },
  { key: "incomplete", label: "Incomplete registration" },
  { key: "not_student", label: "Not a university student" },
];

/**
 * Asks why the application(s) are being declined. The ticked reasons and the
 * comment go into the email the applicant receives.
 */
function DeclineDialog({
  rows, busy, onCancel, onConfirm,
}: {
  rows: Row[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (details: DeclineDetails) => void;
}) {
  const [reasons, setReasons] = useState<Partial<Record<DeclineReason, true>>>({});
  const [comment, setComment] = useState("");
  const chosen = DECLINE_OPTIONS.map((o) => o.key).filter((k) => reasons[k]);
  const canSubmit = !busy && (chosen.length > 0 || comment.trim().length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const who = rows.length === 1 ? rows[0].name : `${rows.length} applicants`;

  return (
    <div
      onClick={() => { if (!busy) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(12,4,16,.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sh-decline-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480, maxHeight: "calc(100vh - 32px)", overflowY: "auto",
          background: C.surface, border: `1px solid ${C.border18}`, borderRadius: 12, padding: 22,
        }}
      >
        <h2 id="sh-decline-title" style={headingStyle}>Decline {who}</h2>
        <p style={{ margin: "8px 0 18px", fontSize: 13, color: C.ink60 }}>
          Why is this application being declined? Your answers are emailed to{" "}
          {rows.length === 1 ? <span style={{ color: C.ink }}>{rows[0].email}</span> : "each applicant"}.
        </p>

        <div style={{ fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1, letterSpacing: ".12em", color: C.ink40, marginBottom: 10 }}>
          REASONS
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {DECLINE_OPTIONS.map((o) => (
            <label
              key={o.key}
              className="sh-reason"
              style={{
                display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                border: `1px solid ${reasons[o.key] ? C.pink : C.border}`, borderRadius: 8,
                background: reasons[o.key] ? C.pinkSoft : "transparent",
                padding: "10px 12px", fontSize: 13.5,
              }}
            >
              <input
                type="checkbox"
                checked={!!reasons[o.key]}
                disabled={busy}
                onChange={(e) =>
                  setReasons((prev) => {
                    const next = { ...prev };
                    if (e.target.checked) next[o.key] = true;
                    else delete next[o.key];
                    return next;
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>

        <label
          htmlFor="sh-decline-comment"
          style={{ display: "block", fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1, letterSpacing: ".12em", color: C.ink40, margin: "18px 0 10px" }}
        >
          COMMENTS
        </label>
        <textarea
          id="sh-decline-comment"
          value={comment}
          disabled={busy}
          maxLength={MAX_DECLINE_COMMENT}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything else the applicant should know (optional)"
          rows={4}
          style={{
            width: "100%", resize: "vertical", background: C.sunken, color: C.ink,
            border: `1px solid ${C.border18}`, borderRadius: 8, padding: "9px 12px",
            font: "inherit", fontSize: 13.5, outline: "none",
          }}
        />
        <div style={{ fontSize: 12, color: C.ink45, marginTop: 6 }}>
          Tick at least one reason or leave a comment.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <GhostButton onClick={onCancel} disabled={busy}>Cancel</GhostButton>
          <button
            type="button"
            className="sh-solid"
            disabled={!canSubmit}
            onClick={() => onConfirm({ reasons: chosen, comment: comment.trim() })}
            style={{
              background: C.pink, border: `1px solid ${C.pink}`, color: "#fff",
              borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            {busy ? "Declining…" : "Decline & send email"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const AdminDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [workspace, setWorkspace] = useState<AdminWorkspace>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // SECURITY — `busy` state only updates on the next render, so a fast double
  // click could start the same bulk write twice. This ref flips synchronously.
  const inFlight = useRef(false);
  /** The applicants the decline dialog is open for, or null when it's closed. */
  const [declining, setDeclining] = useState<Row[] | null>(null);

  const [lens, setLens] = useState<Lens>("signups");
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [selectedTeams, setSelectedTeams] = useState<Record<string, true>>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);
  const [chosenAward, setChosenAward] = useState(AWARDS[0].id);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All hackers");
  const [schoolFilter, setSchoolFilter] = useState("All schools");

  // The signed-in admin's uid, recorded as reviewed_by / issued_by. <AdminOnly>
  // guarantees a Firebase user here; the fallback is only for the type checker.
  const actor = user?.uid ?? "unknown";
  const adminName = text(user?.displayName, text(user?.email, "Admin"));

  /* ---------------- Load ---------------- */

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchAdminWorkspace();
    setLoading(false);
    // Show whatever did load, even if some collections were refused.
    setWorkspace(result.data);
    if (result.error) {
      toast({ title: "Couldn't load everything", description: result.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  /* ---------------- Shape the data ---------------- */

  const roster = useMemo<Row[]>(() => {
    // Certificates, keyed by the user they were issued to.
    const certByUser = new Map<string, string>();
    workspace.certifications.forEach((c) => {
      const uid = text(c.user_id);
      const title = text(c.title);
      if (uid && title && !certByUser.has(uid)) certByUser.set(uid, title);
    });

    // Applications, keyed by the applicant's uid, and by email as a fallback.
    const appById = new Map(workspace.applications.map((a) => [a.id, a]));
    const appByEmail = new Map<string, (typeof workspace.applications)[number]>();
    workspace.applications.forEach((a) => {
      const e = text(a.email).toLowerCase();
      if (e && !appByEmail.has(e)) appByEmail.set(e, a);
    });

    const rows: Row[] = [];
    const matchedApps = new Set<string>();

    // Everyone with an account.
    workspace.members.forEach((m) => {
      const email = text(m.email);
      const app = appById.get(m.id) ?? (email ? appByEmail.get(email.toLowerCase()) : undefined);
      if (app) matchedApps.add(app.id);
      // Organisers aren't participants, so they (and any application of theirs) stay off the roster.
      if (m.admin === true) {
        matchedApps.add(m.id);
        return;
      }
      rows.push({
        key: `member:${m.id}`,
        // The application's name is what they signed with; profiles often have no name set.
        name: text(app?.full_name, text(m.full_name, text(m.username, text(m.display_name, email.split("@")[0] || "Unnamed member")))),
        email: text(email, "Email unavailable"),
        school: text(app?.institution, "No institution"),
        signup: app ? toSignupStatus(app.status) : "none",
        cert: certByUser.get(m.id) ?? null,
        applicationId: app ? app.id : null,
        memberId: m.id,
        teamId: text(m.team_id) || null,
        answers: app ?? null,
      });
    });

    // Applications with no matching account yet.
    workspace.applications.forEach((a) => {
      if (matchedApps.has(a.id)) return;
      rows.push({
        key: `app:${a.id}`,
        name: text(a.full_name, "Unnamed applicant"),
        email: text(a.email, "Email unavailable"),
        school: text(a.institution, "No institution"),
        signup: toSignupStatus(a.status),
        cert: null,
        applicationId: a.id,
        memberId: null,
        teamId: null,
        answers: a,
      });
    });

    return rows.sort((x, y) => x.name.localeCompare(y.name));
  }, [workspace]);

  // A team is any `team_id` held by someone on the roster, plus any teams
  // document. The document, when there is one, supplies the name and track.
  const teams = useMemo<TeamRow[]>(() => {
    const byId = new Map<string, TeamRow>();
    workspace.teams.forEach((t) => {
      byId.set(t.id, { id: t.id, name: text(t.name, `Team ${t.id}`), track: text(t.track) || null, members: [] });
    });
    roster.forEach((r) => {
      if (!r.teamId) return;
      const team = byId.get(r.teamId) ?? { id: r.teamId, name: `Team ${r.teamId}`, track: null, members: [] };
      team.members.push(r);
      byId.set(r.teamId, team);
    });
    return Array.from(byId.values()).sort((x, y) => x.name.localeCompare(y.name));
  }, [workspace.teams, roster]);

  const teamNames = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const demos = useMemo<DemoRow[]>(
    () =>
      workspace.demos.map((d) => ({
        id: d.id,
        title: text(d.title, "Untitled demo"),
        status: text(d.status, "unknown"),
        url: safeHttpUrl(text(d.demo_url)), // SECURITY — http(s) links only
      })),
    [workspace.demos],
  );

  const schools = useMemo(() => {
    const set = new Set<string>();
    roster.forEach((r) => { if (r.school && r.school !== "No institution") set.add(r.school); });
    return Array.from(set).sort();
  }, [roster]);

  const visibleRoster = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((r) => {
      // Certificates only go to accepted hackers, so that tab lists nobody else.
      if (lens === "certs" && r.signup !== "accepted") return false;
      if (q && ![r.name, r.email, r.school].some((f) => f.toLowerCase().includes(q))) return false;
      if (schoolFilter !== "All schools" && r.school !== schoolFilter) return false;
      if (statusFilter === "Awaiting decision" && r.signup !== "pending") return false;
      if (statusFilter === "Accepted" && r.signup !== "accepted") return false;
      if (statusFilter === "Declined" && r.signup !== "declined") return false;
      if (statusFilter === "Certified" && !r.cert) return false;
      return true;
    });
  }, [roster, lens, query, statusFilter, schoolFilter]);

  const visibleTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) =>
      [t.name, t.id, t.track ?? "", ...t.members.map((m) => m.name)].some((f) => f.toLowerCase().includes(q)),
    );
  }, [teams, query]);

  const visibleDemos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return demos;
    return demos.filter((d) => [d.title, d.status].some((f) => f.toLowerCase().includes(q)));
  }, [demos, query]);

  const stats = useMemo(() => ({
    total: roster.length,
    awaiting: roster.filter((r) => r.signup === "pending").length,
    accepted: roster.filter((r) => r.signup === "accepted").length,
    declined: roster.filter((r) => r.signup === "declined").length,
    teams: teams.length,
    demos: demos.length,
    issued: workspace.certifications.length,
  }), [roster, teams, demos, workspace.certifications]);

  /* ---------------- Derived view state ---------------- */

  const isSignups = lens === "signups";
  const isTeams = lens === "teams";
  const isDemos = lens === "demos";
  const isCerts = lens === "certs";
  const isPeopleTable = isSignups || isCerts;

  const dim = (col: Lens) => (col === lens ? 1 : 0.38);

  const selectedKeys = Object.keys(selected).filter((k) => visibleRoster.some((r) => r.key === k));
  const nSel = isTeams ? Object.keys(selectedTeams).length : selectedKeys.length;
  // SECURITY — only rows that are currently visible count as selected. Before, a
  // row ticked and then hidden by a search or filter was still accepted, declined
  // or certified by a bulk action, even though the admin could no longer see it
  // and the "N selected" count didn't include it.
  const selectedRows = visibleRoster.filter((r) => selected[r.key]);

  // SECURITY — every (user, certificate title) pair already issued, so the same
  // award can't be written twice for one person by a repeat click or re-selection.
  const issuedPairs = new Set(
    workspace.certifications.map((c) => `${text(c.user_id)}|${text(c.title)}`),
  );

  const award = AWARDS.find((a) => a.id === chosenAward) ?? AWARDS[0];
  // On the Certificates tab the detail panel can't show someone who isn't accepted.
  const focusable = isCerts ? roster.filter((r) => r.signup === "accepted") : roster;
  const person = focusable.find((r) => r.key === focusedKey) ?? visibleRoster[0] ?? null;
  const personStatus = statusTone(person ? person.signup : "none");
  const team = teams.find((t) => t.id === focusedTeamId) ?? visibleTeams[0] ?? null;

  const certRecipient =
    selectedRows.length === 1
      ? selectedRows[0].name
      : selectedRows.length > 1
        ? `${selectedRows.length} recipients`
        : "No one selected yet";

  /* ---------------- Actions ---------------- */

  const clearSelection = () => { setSelected({}); setSelectedTeams({}); };

  // PLACEHOLDER — the handler behind every button whose action has no service function
  // or Firestore collection yet. It only shows a toast; replace each call site with
  // a real admin.service call once the backing data exists.
  // Seen: as a "Not available yet" toast after clicking any of the placeholder
  // buttons below (Teams bulk bar, team detail panel, "Extend to whole teams").
  const notWired = (what: string) =>
    toast({
      title: "Not available yet",
      description: `${what} isn't backed by a Firestore collection yet.`,
    });

  const runReview = async (
    status: "approved" | "rejected",
    rows: Row[] = selectedRows,
    decline?: DeclineDetails,
  ) => {
    const targets = rows.filter((r) => r.applicationId);
    const skipped = rows.length - targets.length;
    if (targets.length === 0) {
      toast({
        title: "Nothing to review",
        description: "None of the selected people have a submitted application.",
        variant: "destructive",
      });
      return;
    }
    // Declining always goes through the reasons dialog first, which also
    // serves as the confirmation step.
    if (status === "rejected" && !decline) {
      setDeclining(targets);
      return;
    }
    // SECURITY — confirm before changing several applications in one click.
    if (
      status === "approved" &&
      targets.length > CONFIRM_ABOVE &&
      !window.confirm(`Accept ${targets.length} applications?`)
    ) return;
    if (inFlight.current) return; // SECURITY — block a second run while one is in progress
    inFlight.current = true;
    setBusy(true);
    const errors = (
      await Promise.all(targets.map(async (r) => {
        const error = await reviewApplication(r.applicationId as string, status, actor);
        if (error || !decline) return error;
        // The decline is saved; now tell the applicant why. SECURITY — only
        // well-formed addresses are sent to (see isSafeEmail).
        if (!isSafeEmail(r.email)) return `Declined ${r.name}, but they have no usable email address.`;
        const mailError = await sendDeclineEmail(r.email, r.name, decline);
        return mailError && `Declined ${r.name}, but the email wasn't sent. ${mailError}`;
      }))
    ).filter(Boolean) as string[];
    setBusy(false);
    inFlight.current = false;
    setDeclining(null);

    if (errors.length) {
      toast({
        title: errors.length === targets.length ? "Reviews failed" : "Some reviews failed",
        description: errors.length > 1 ? `${errors[0]} (+${errors.length - 1} more)` : errors[0],
        variant: "destructive",
      });
    } else {
      toast({
        title: status === "approved" ? "Accepted" : "Declined",
        description:
          `${plural(targets.length, "application", "applications")} updated` +
          (decline ? ` · ${plural(targets.length, "email", "emails")} sent` : "") +
          (skipped ? ` · ${skipped} skipped (no application on file)` : ""),
      });
    }
    clearSelection();
    void load();
  };

  const runCertify = async () => {
    const withAccount = selectedRows.filter((r) => r.memberId);
    const skipped = selectedRows.length - withAccount.length;
    // SECURITY — drop anyone who already holds this exact certificate.
    const targets = withAccount.filter((r) => !issuedPairs.has(`${r.memberId}|${award.label}`));
    const already = withAccount.length - targets.length;
    if (targets.length === 0) {
      toast({
        title: "Nothing to issue",
        description: already
          ? `Everyone selected already holds “${award.label}”.`
          : "Certificates can only go to people with a registered account.",
        variant: "destructive",
      });
      return;
    }
    // SECURITY — confirm before issuing several certificates in one click.
    if (
      targets.length > CONFIRM_ABOVE &&
      !window.confirm(`Issue “${award.label}” to ${targets.length} hackers?`)
    ) return;
    if (inFlight.current) return; // SECURITY — block a second run while one is in progress
    inFlight.current = true;
    setBusy(true);
    const errors = (
      await Promise.all(targets.map((r) => issueCertification(r.memberId as string, actor, award.label)))
    ).filter(Boolean) as string[];
    setBusy(false);
    inFlight.current = false;

    if (errors.length) {
      toast({ title: "Certificate failed", description: errors[0], variant: "destructive" });
    } else {
      toast({
        title: "Certification assigned",
        description:
          `“${award.label}” issued to ${plural(targets.length, "hacker", "hackers")}` +
          (skipped ? ` · ${skipped} skipped (no account)` : "") +
          (already ? ` · ${already} skipped (already issued)` : ""),
      });
    }
    clearSelection();
    void load();
  };

  const emailSelected = () => {
    // SECURITY — only well-formed addresses reach the mail client (see isSafeEmail).
    const addresses = selectedRows
      .map((r) => r.email)
      .filter(isSafeEmail);
    if (addresses.length === 0) {
      toast({ title: "No email addresses", description: "The selected rows have no usable email.", variant: "destructive" });
      return;
    }
    window.location.href = `mailto:?bcc=${encodeURIComponent(addresses.join(","))}`;
  };

  const exportCsv = () => {
    const header = ["Name", "Email", "Institution", "Signup", "Certificate"];
    const body = visibleRoster.map((r) => [
      r.name, r.email, r.school, statusTone(r.signup).label, r.cert ?? "",
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => csvCell(String(cell))).join(",")) // SECURITY — see csvCell
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${EVENT_NAME.toLowerCase().replace(/\s+/g, "-")}-roster.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bulkActions: { label: string; primary?: boolean; quiet?: boolean; run: () => void }[] = [
    ...(isSignups
      ? [
        { label: "Accept", primary: true, run: () => void runReview("approved") },
        { label: "Decline", run: () => void runReview("rejected") },
      ]
      : isTeams
        ? [
          // PLACEHOLDER — approves the selected teams' pending join/removal requests.
          // Needs a team-requests collection and a service function to resolve them.
          // Seen: Teams tab → tick a team → pink bulk bar above the table.
          { label: "Approve team change", primary: true, run: () => notWired("Team change approval") },
          // PLACEHOLDER — promotes a member to team leader. Needs a leader field on
          // the team doc (e.g. `leader_id`) and a service function to set it.
          // Seen: Teams tab → tick a team → pink bulk bar above the table.
          { label: "Make leader", run: () => notWired("Team leaders") },
          // PLACEHOLDER — removes a member from a team. Needs team membership stored
          // (a `members` array on the team, or `team_id` on each user) to edit.
          // Seen: Teams tab → tick a team → pink bulk bar above the table.
          { label: "Remove from team", run: () => notWired("Team membership") },
        ]
        : [
          { label: `Issue “${award.label}”`, primary: true, run: () => void runCertify() },
          // PLACEHOLDER — issues the chosen award to every teammate of the selected
          // hackers. Needs team membership in Firestore to know who the teammates are.
          // Seen: Certificates tab → tick a hacker → pink bulk bar above the table.
          { label: "Extend to whole teams", run: () => notWired("Team-wide certificates") },
        ]),
    { label: "Email selected", run: emailSelected },
    { label: "Clear", quiet: true, run: clearSelection },
  ];

  const lensCards = [
    { key: "signups" as Lens, title: "Signups", count: plural(stats.awaiting, "waiting", "waiting"), figure: String(stats.total), note: "Accept or decline registrations", fg: C.pink },
    // PLACEHOLDER — the Teams card's "0 waiting" badge is the number of pending team
    // requests (joins/removals). Hardcoded to 0 until a requests collection exists.
    // Seen: top of the page → "Teams" card → pill in its top-right corner.
    { key: "teams" as Lens, title: "Teams", count: plural(0, "waiting", "waiting"), figure: String(stats.teams), note: "Teams as participants form them", fg: C.lilac },
    { key: "demos" as Lens, title: "Demos", count: plural(stats.demos, "submitted", "submitted"), figure: String(stats.demos), note: "Project demos and review states", fg: C.ink },
    { key: "certs" as Lens, title: "Certificates", count: plural(stats.issued, "issued", "issued"), figure: String(stats.accepted), note: "Assign and issue awards by hand", fg: C.gold },
  ];

  const titles: Record<Lens, [string, string]> = {
    signups: ["Roster", `${plural(stats.total, "hacker", "hackers")} · ${stats.awaiting} awaiting a decision`],
    teams: ["Formed teams", `${plural(stats.teams, "team", "teams")} · from each hacker's team code`],
    demos: ["Demo submissions", plural(stats.demos, "submission", "submissions")],
    certs: ["Roster", `${stats.accepted} accepted · ${plural(stats.issued, "certificate", "certificates")} issued`],
  };

  const shownCount = isTeams
    ? `Showing ${visibleTeams.length} of ${teams.length}`
    : isDemos
      ? `Showing ${visibleDemos.length} of ${demos.length}`
      : `Showing ${visibleRoster.length} of ${isCerts ? stats.accepted : roster.length}`;

  /* ---------------- Render ---------------- */

  return (
    <Layout portal>
      <main className="sh-admin">
        <style>{STYLES}</style>
        <PortalDecor />

        {declining && (
          <DeclineDialog
            rows={declining}
            busy={busy}
            onCancel={() => setDeclining(null)}
            onConfirm={(details) => void runReview("rejected", declining, details)}
          />
        )}

        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 28px 56px", position: "relative" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "20px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>{EVENT_NAME}</span>
              <span
                style={{
                  fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1, letterSpacing: ".14em",
                  color: C.ink45, border: `1px solid ${C.border18}`, borderRadius: 5, padding: "5px 8px",
                }}
              >
                ADMIN
              </span>
            </div>

            <span style={{ flex: 1 }} />

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hackers, teams, emails…"
              aria-label="Search"
              style={{
                width: 280, maxWidth: "100%", background: C.sunken,
                border: `1px solid ${C.border18}`, borderRadius: 8,
                padding: "8px 12px", fontSize: 13.5, outline: "none",
              }}
            />

            <button
              type="button"
              className="sh-ghost"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh admin data"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: "none", border: `1px solid ${C.border28}`, borderRadius: 8,
                padding: "7px 12px", fontSize: 13, fontWeight: 500, color: C.ink, cursor: "pointer",
              }}
            >
              <RefreshCw size={14} className={loading ? "sh-spin" : undefined} /> Refresh
            </button>

            <div
              style={{
                display: "flex", alignItems: "center", gap: 9,
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "6px 12px 6px 7px", fontSize: 13.5,
              }}
            >
              <span
                style={{
                  width: 26, height: 26, borderRadius: "50%", background: C.pink, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11.5, fontWeight: 600,
                }}
              >
                {initialsOf(adminName)}
              </span>
              <span>{adminName}</span>
              <span style={{ color: C.ink45, fontSize: 12.5 }}>· Admin</span>
            </div>
          </div>

          {/* Lens cards */}
          <div
            role="group"
            aria-label="Choose what to work on"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, marginBottom: 22 }}
          >
            {lensCards.map((L) => {
              const on = L.key === lens;
              return (
                <button
                  key={L.key}
                  type="button"
                  className="sh-lens"
                  onClick={() => { setLens(L.key); clearSelection(); }}
                  aria-pressed={on}
                  style={{
                    textAlign: "left", borderRadius: 14, padding: "18px 20px", cursor: "pointer",
                    display: "block", width: "100%",
                    background: on ? C.pinkSoft : C.surface,
                    border: `1px solid ${on ? C.pink : C.border}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                    <span style={headingStyle}>{L.title}</span>
                    <span
                      style={{
                        fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1, letterSpacing: ".06em",
                        padding: "5px 9px", borderRadius: 99,
                        background: on ? "rgba(232,56,166,.22)" : "rgba(242,237,228,.08)",
                        color: on ? C.pink : C.ink60,
                      }}
                    >
                      {L.count}
                    </span>
                  </div>
                  <div style={{ fontFamily: MONO, fontWeight: 500, fontSize: 34, lineHeight: 1.05, letterSpacing: "-.03em", color: L.fg }}>
                    {loading ? "–" : L.figure}
                  </div>
                  <div style={{ fontSize: 13, color: C.ink60, marginTop: 8 }}>{L.note}</div>
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
            {/* ---------------- Table ---------------- */}
            <div style={{ ...cardStyle, flex: "1 1 520px", minWidth: 0 }}>
              <div style={cardHeadStyle}>
                <h2 style={headingStyle}>{titles[lens][0]}</h2>
                <span style={{ fontSize: 13, color: C.ink45 }}>{titles[lens][1]}</span>
                <span style={{ flex: 1 }} />
                {isPeopleTable && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      aria-label="Filter roster"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      style={selectStyle}
                    >
                      <option>All hackers</option>
                      <option>Awaiting decision</option>
                      <option>Accepted</option>
                      <option>Declined</option>
                      <option>Certified</option>
                    </select>
                    <select
                      aria-label="Filter by school"
                      value={schoolFilter}
                      onChange={(e) => setSchoolFilter(e.target.value)}
                      style={selectStyle}
                    >
                      <option>All schools</option>
                      {schools.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {nSel > 0 && (
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                    padding: "12px 20px", background: C.pinkSoft,
                    borderBottom: "1px solid rgba(232,56,166,.35)",
                  }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: C.pink }}>
                    {isTeams
                      ? `${nSel} ${nSel === 1 ? "team" : "teams"} selected`
                      : `${nSel} ${nSel === 1 ? "hacker" : "hackers"} selected`}
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
                    {bulkActions.map((a) => (
                      <button
                        key={a.label}
                        type="button"
                        className="sh-solid"
                        onClick={a.run}
                        disabled={busy && !a.quiet}
                        style={{
                          borderRadius: 8, padding: "5px 10px", fontSize: 12.5,
                          fontWeight: a.primary ? 600 : 500, cursor: "pointer",
                          background: a.primary ? C.pink : "transparent",
                          color: a.primary ? "#fff" : a.quiet ? C.ink60 : C.ink,
                          border: `1px solid ${a.primary ? C.pink : a.quiet ? "transparent" : C.border28}`,
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                {/* People */}
                {isPeopleTable && (
                  <>
                    <table style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 44, padding: "11px 0 11px 16px", borderBottom: `1px solid ${C.line}` }}>
                            <input
                              type="checkbox"
                              aria-label="Select all"
                              checked={visibleRoster.length > 0 && selectedKeys.length === visibleRoster.length}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? Object.fromEntries(visibleRoster.map((r) => [r.key, true as const]))
                                    : {},
                                )
                              }
                            />
                          </th>
                          <th style={thStyle}>HACKER</th>
                          <th style={{ ...thStyle, opacity: dim("signups") }}>SIGNUP</th>
                          <th style={{ ...thStyle, opacity: dim("teams") }}>TEAM</th>
                          <th style={{ ...thStyle, opacity: dim("certs") }}>CERTIFICATE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRoster.map((r, i) => {
                          const on = !!selected[r.key];
                          const st = statusTone(r.signup);
                          const rule = i === visibleRoster.length - 1 ? "transparent" : C.line09;
                          const td: CSSProperties = { padding: "13px 16px", borderBottom: `1px solid ${rule}`, verticalAlign: "middle" };
                          return (
                            <tr
                              key={r.key}
                              className="sh-row"
                              data-on={on}
                              onClick={() => setFocusedKey(r.key)}
                              style={{ cursor: "pointer", background: on ? C.pinkSoft : "transparent" }}
                            >
                              <td style={{ width: 44, padding: "0 0 0 16px", borderBottom: `1px solid ${rule}` }}>
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${r.name}`}
                                  checked={on}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() =>
                                    setSelected((prev) => {
                                      const next = { ...prev };
                                      if (next[r.key]) delete next[r.key];
                                      else next[r.key] = true;
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td style={td}>
                                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span
                                    style={{
                                      width: 30, height: 30, borderRadius: "50%", flex: "none",
                                      background: "rgba(242,237,228,.08)", color: C.ink75,
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1,
                                    }}
                                  >
                                    {initialsOf(r.name)}
                                  </span>
                                  <span style={{ minWidth: 0 }}>
                                    <span style={{ display: "block", fontWeight: 500, letterSpacing: "-.005em" }}>{r.name}</span>
                                    <span style={{ display: "block", fontSize: 12.5, color: C.ink45 }}>
                                      {r.email} · {r.school}
                                    </span>
                                  </span>
                                </span>
                              </td>
                              <td style={{ ...td, opacity: dim("signups") }}>
                                <Pill label={st.label} bg={st.bg} fg={st.fg} />
                              </td>
                              <td style={{ ...td, opacity: dim("teams") }}>
                                {r.teamId
                                  ? <span style={{ fontSize: 13.5 }}>{teamNames.get(r.teamId) ?? r.teamId}</span>
                                  : <span style={{ color: C.ink35, fontSize: 13.5 }}>No team</span>}
                              </td>
                              <td style={{ ...td, opacity: dim("certs") }}>
                                {r.cert
                                  ? <Pill label={r.cert} bg="rgba(232,56,166,.14)" fg={C.pink} />
                                  : <span style={{ color: C.ink35, fontSize: 13.5 }}>None issued</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!loading && visibleRoster.length === 0 && (
                      <EmptyState
                        title={roster.length === 0 ? "No registered members yet" : "Nothing matches those filters"}
                        note={roster.length === 0 ? "Registrations will appear here as they come in." : "Try clearing the search or filters."}
                      />
                    )}
                  </>
                )}

                {/* Teams */}
                {isTeams && (
                  <>
                    <table style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 44, padding: "11px 0 11px 16px", borderBottom: `1px solid ${C.line}` }}>
                            <input
                              type="checkbox"
                              aria-label="Select all teams"
                              checked={visibleTeams.length > 0 && Object.keys(selectedTeams).length === visibleTeams.length}
                              onChange={(e) =>
                                setSelectedTeams(
                                  e.target.checked
                                    ? Object.fromEntries(visibleTeams.map((t) => [t.id, true as const]))
                                    : {},
                                )
                              }
                            />
                          </th>
                          <th style={thStyle}>TEAM</th>
                          <th style={thStyle}>TRACK</th>
                          <th style={thStyle}>MEMBERS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTeams.map((t, i) => {
                          const on = !!selectedTeams[t.id];
                          const rule = i === visibleTeams.length - 1 ? "transparent" : C.line09;
                          const td: CSSProperties = { padding: "13px 16px", borderBottom: `1px solid ${rule}`, verticalAlign: "middle" };
                          const tt = tone(t.track ? "accepted" : "pend");
                          return (
                            <tr
                              key={t.id}
                              className="sh-row"
                              data-on={on}
                              onClick={() => setFocusedTeamId(t.id)}
                              style={{ cursor: "pointer", background: on ? C.pinkSoft : "transparent" }}
                            >
                              <td style={{ width: 44, padding: "0 0 0 16px", borderBottom: `1px solid ${rule}` }}>
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${t.name}`}
                                  checked={on}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() =>
                                    setSelectedTeams((prev) => {
                                      const next = { ...prev };
                                      if (next[t.id]) delete next[t.id];
                                      else next[t.id] = true;
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td style={td}>
                                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span
                                    style={{
                                      width: 30, height: 30, borderRadius: 8, flex: "none",
                                      background: C.lilacSoft, color: C.lilac,
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1,
                                    }}
                                  >
                                    {t.name.slice(0, 2).toUpperCase()}
                                  </span>
                                  <span style={{ fontWeight: 500, letterSpacing: "-.005em" }}>{t.name}</span>
                                </span>
                              </td>
                              <td style={td}>
                                <Pill label={t.track ?? "Track not selected"} bg={tt.bg} fg={tt.fg} />
                              </td>
                              <td style={td}>
                                <span style={{ fontSize: 13.5 }}>{t.members.length} of {MAX_TEAM_SIZE}</span>
                                {t.members.length > 0 && (
                                  <span style={{ color: C.ink45, fontSize: 13 }}>
                                    {" · "}{t.members.map((m) => m.name.split(" ")[0]).join(", ")}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!loading && visibleTeams.length === 0 && (
                      <EmptyState title="No teams formed yet" note="Teams appear here as participants form them." />
                    )}
                  </>
                )}

                {/* Demos */}
                {isDemos && (
                  <>
                    <table style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, paddingLeft: 20 }}>DEMO</th>
                          <th style={thStyle}>STATUS</th>
                          <th style={thStyle}>LINK</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDemos.map((d, i) => {
                          const rule = i === visibleDemos.length - 1 ? "transparent" : C.line09;
                          const td: CSSProperties = { padding: "13px 16px", borderBottom: `1px solid ${rule}`, verticalAlign: "middle" };
                          const dt = tone(d.status.toLowerCase() === "approved" ? "accepted" : "pend");
                          return (
                            <tr key={d.id}>
                              <td style={{ ...td, paddingLeft: 20, fontWeight: 500 }}>{d.title}</td>
                              <td style={td}><Pill label={d.status} bg={dt.bg} fg={dt.fg} /></td>
                              <td style={td}>
                                {d.url
                                  ? <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5 }}>Open demo</a>
                                  : <span style={{ color: C.ink35, fontSize: 13.5 }}>No link</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!loading && visibleDemos.length === 0 && (
                      <EmptyState title="No demos submitted yet" note="Submissions appear here during the event." />
                    )}
                  </>
                )}

                {loading && (
                  <div style={{ padding: "46px 20px", textAlign: "center", fontSize: 13, color: C.ink50 }}>
                    Loading…
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
                  padding: "16px 20px", borderTop: `1px solid ${C.line}`, fontSize: 13, color: C.ink45,
                }}
              >
                <span>{shownCount}</span>
                <span style={{ flex: 1 }} />
                <GhostButton onClick={exportCsv} disabled={isPeopleTable ? visibleRoster.length === 0 : true}>
                  Export CSV
                </GhostButton>
              </div>
            </div>

            {/* ---------------- Side panels ---------------- */}
            <div style={{ flex: "1 1 372px", maxWidth: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Person detail */}
              {isPeopleTable && (
                <div style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13, padding: 20, borderBottom: `1px solid ${C.line}` }}>
                    <span
                      style={{
                        width: 44, height: 44, borderRadius: "50%", flex: "none",
                        background: "rgba(232,56,166,.16)", color: C.pink,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: MONO, fontWeight: 500, fontSize: 15, lineHeight: 1,
                      }}
                    >
                      {person ? initialsOf(person.name) : "—"}
                    </span>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.015em" }}>
                        {person ? person.name : "No hacker selected"}
                      </div>
                      <div style={{ fontSize: 13, color: C.ink45 }}>
                        {person ? person.school : "Pick a row to see their record"}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: "6px 20px 16px" }}>
                    <DetailRow label="Application status">
                      <Pill label={person ? personStatus.label : "—"} bg={personStatus.bg} fg={personStatus.fg} />
                    </DetailRow>
                    <DetailRow label="Email">
                      {person
                        ? (() => {
                          // SECURITY — only link the address if it is a plain, valid email.
                          const href = mailtoHref(person.email);
                          return href ? <a href={href}>{person.email}</a> : person.email;
                        })()
                        : "—"}
                    </DetailRow>
                    <DetailRow label="Institution">
                      {person ? person.school : "—"}
                    </DetailRow>
                    <DetailRow label="Certificate">
                      <span style={{ color: person?.cert ? C.ink : C.ink35 }}>
                        {person ? person.cert ?? "None issued" : "—"}
                      </span>
                    </DetailRow>
                    <DetailRow label="Team">
                      <span style={{ color: person?.teamId ? C.ink : C.ink35 }}>
                        {person ? (person.teamId ? teamNames.get(person.teamId) ?? person.teamId : "No team") : "—"}
                      </span>
                    </DetailRow>
                    <DetailRow label="Account" last>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.ink60 }}>
                        {person?.memberId ?? "No account — application only"}
                      </span>
                    </DetailRow>
                  </div>

                  {person && (
                    <div style={{ padding: "0 20px 16px", borderTop: `1px solid ${C.line}` }}>
                      <div style={{ margin: "16px 0 4px", fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1, letterSpacing: ".12em", color: C.ink40 }}>
                        APPLICATION
                      </div>
                      {person.answers ? (
                        answerRows(person.answers).map(([key, label, value], i, all) => {
                          // SECURITY — participant links are only clickable if they are http(s).
                          const href = LINK_ANSWERS.has(key) ? safeHttpUrl(value) : null;
                          return (
                            <DetailRow key={key} label={label} last={i === all.length - 1}>
                              <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                {href ? <a href={href} target="_blank" rel="noopener noreferrer">{value}</a> : value}
                              </span>
                            </DetailRow>
                          );
                        })
                      ) : (
                        <div style={{ padding: "12px 0 4px", fontSize: 13, color: C.ink50 }}>
                          They haven't submitted an application yet.
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "16px 20px", borderTop: `1px solid ${C.line}` }}>
                    <GhostButton
                      // SECURITY — disabled unless the address passes isSafeEmail.
                      onClick={() => {
                        const href = person && mailtoHref(person.email);
                        if (href) window.location.href = href;
                      }}
                      disabled={!person || !isSafeEmail(person.email)}
                    >
                      Email
                    </GhostButton>
                    <GhostButton
                      onClick={() => person && void runReview("approved", [person])}
                      disabled={!person?.applicationId || person.signup === "accepted" || busy}
                    >
                      Accept
                    </GhostButton>
                    <GhostButton
                      onClick={() => person && void runReview("rejected", [person])}
                      disabled={!person?.applicationId || person.signup === "declined" || busy}
                    >
                      Decline
                    </GhostButton>
                  </div>
                </div>
              )}

              {/* Team detail */}
              {isTeams && (
                <div style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13, padding: 20, borderBottom: `1px solid ${C.line}` }}>
                    <span
                      style={{
                        width: 44, height: 44, borderRadius: 10, flex: "none",
                        background: C.lilacSoft, color: C.lilac,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: MONO, fontWeight: 500, fontSize: 15, lineHeight: 1,
                      }}
                    >
                      {team ? team.name.slice(0, 2).toUpperCase() : "—"}
                    </span>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.015em" }}>
                        {team ? team.name : "No team selected"}
                      </div>
                      <div style={{ fontSize: 13, color: C.ink45 }}>
                        {team ? team.track ?? "Track not selected" : "Pick a row to see the team"}
                      </div>
                    </div>
                  </div>

                  {team && team.members.length > 0 ? (
                    <div style={{ padding: "6px 20px" }}>
                      {team.members.map((m, i) => (
                        <DetailRow key={m.key} label={m.name} last={i === team.members.length - 1}>
                          <span style={{ color: C.ink60, fontSize: 13 }}>{m.email}</span>
                        </DetailRow>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: "36px 20px", textAlign: "center", fontSize: 13, color: C.ink50, lineHeight: 1.6 }}>
                      {team ? "Nobody on the roster has this team code." : "Pick a row to see its members."}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "16px 20px", borderTop: `1px solid ${C.line}` }}>
                    {/* PLACEHOLDER — should let the admin pick a new leader for the focused
                        team. Needs a leader field on the team doc and a service function.
                        Seen: Teams tab → right-hand detail panel → footer buttons. */}
                    <GhostButton onClick={() => notWired("Team leaders")}>Change leader</GhostButton>
                  </div>
                </div>
              )}

              {/* Signup stats */}
              {isSignups && (
                <div style={cardStyle}>
                  <div style={cardHeadStyle}>
                    <h2 style={headingStyle}>Where Applications stand</h2>
                  </div>
                  <div style={{ padding: "6px 20px 16px" }}>
                    <DetailRow label="Awaiting">
                      <span style={{ fontFamily: MONO, fontWeight: 500, color: C.gold }}>{stats.awaiting}</span>
                    </DetailRow>
                    <DetailRow label="Accepted">
                      <span style={{ fontFamily: MONO, fontWeight: 500, color: C.lilac }}>{stats.accepted}</span>
                    </DetailRow>
                    <DetailRow label="Declined" last>
                      <span style={{ fontFamily: MONO, fontWeight: 500, color: C.ink60 }}>{stats.declined}</span>
                    </DetailRow>
                  </div>
                </div>
              )}

              {/* PLACEHOLDER — the "Waiting on you" queue: pending team requests (join,
                  leave, removal) with Approve / Decline on each. Always empty, and the
                  "0 requests waiting" count is hardcoded, because Firestore has no
                  requests collection to read them from.
                  Seen: Teams tab → right-hand column → "Waiting on you" card, below
                  the team detail panel. */}
              {isTeams && (
                <div style={cardStyle}>
                  <div style={cardHeadStyle}>
                    <h2 style={headingStyle}>Waiting on you</h2>
                    <span style={{ fontSize: 13, color: C.ink45 }}>0 requests waiting</span>
                  </div>
                  <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: C.ink50 }}>
                    Join and removal requests will appear here once there’s a collection for them.
                  </div>
                </div>
              )}

              {/* Demo summary */}
              {isDemos && (
                <div style={cardStyle}>
                  <div style={cardHeadStyle}>
                    <h2 style={headingStyle}>Submissions at a glance</h2>
                  </div>
                  <div style={{ padding: "6px 20px 16px" }}>
                    <DetailRow label="Submitted">
                      <span style={{ fontFamily: MONO, fontWeight: 500 }}>{stats.demos}</span>
                    </DetailRow>
                    <DetailRow label="With a link">
                      <span style={{ fontFamily: MONO, fontWeight: 500 }}>{demos.filter((d) => d.url).length}</span>
                    </DetailRow>
                    <DetailRow label="Teams" last>
                      <span style={{ fontFamily: MONO, fontWeight: 500 }}>{stats.teams}</span>
                    </DetailRow>
                  </div>
                </div>
              )}

              {/* Prizes */}
              {isCerts && (
                <div style={cardStyle}>
                  <div style={cardHeadStyle}>
                    <h2 style={headingStyle}>Prizes</h2>
                    <span style={{ fontSize: 13, color: C.ink45 }}>Five awards plus a participant prize</span>
                  </div>

                  <div style={{ padding: 20 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {AWARDS.map((a) => {
                        const on = a.id === chosenAward;
                        const issued = workspace.certifications.filter((c) => text(c.title) === a.label).length;
                        const tally = a.everyone ? `${stats.accepted} eligible` : plural(issued, "issued", "issued");
                        return (
                          <label
                            key={a.id}
                            className="sh-award"
                            style={{
                              display: "flex", alignItems: "flex-start", gap: 11,
                              borderRadius: 8, padding: "12px 14px", cursor: "pointer",
                              background: on ? C.pinkSoft : "transparent",
                              border: `1px solid ${on ? C.pink : "rgba(242,237,228,.14)"}`,
                            }}
                          >
                            <input
                              type="radio"
                              name="award"
                              value={a.id}
                              checked={on}
                              onChange={() => setChosenAward(a.id)}
                              style={{ marginTop: 3 }}
                            />
                            <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1.4, color: C.ink40, marginTop: 2, flex: "none" }}>
                              {a.num}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", fontWeight: 500, fontSize: 13.5 }}>{a.label}</span>
                              <span style={{ display: "block", fontSize: 12.5, color: C.ink60, marginTop: 4, lineHeight: 1.5 }}>{a.desc}</span>
                            </span>
                            <span style={{ marginLeft: "auto", fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1.4, color: C.ink40, whiteSpace: "nowrap" }}>
                              {tally}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div style={{ margin: "18px 0 12px", fontFamily: MONO, fontWeight: 500, fontSize: 11, lineHeight: 1, letterSpacing: ".12em", color: C.ink40 }}>
                      PREVIEW
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(242,237,228,.14)", borderRadius: 8,
                        padding: "26px 22px", textAlign: "center",
                        background: "linear-gradient(180deg,#331839,#2A1231)",
                      }}
                    >
                      <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1, color: C.ink45, letterSpacing: ".08em" }}>
                        {EVENT_NAME} · {EVENT_DATES}
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 600, margin: "12px 0 4px", letterSpacing: "-.015em" }}>
                        {award.label}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em", color: C.pink, margin: "14px 0 4px" }}>
                        {certRecipient}
                      </div>
                      <div style={{ fontSize: 12.5, color: "rgba(242,237,228,.65)", lineHeight: 1.6, maxWidth: "34ch", margin: "8px auto 0" }}>
                        {EVENT_VENUE}
                      </div>
                      <div style={{ height: 1, background: "rgba(242,237,228,.14)", margin: "18px 0 12px" }} />
                      <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.4, color: C.ink40 }}>
                        Issued by {adminName} · code generated on save
                      </div>
                    </div>

                    <div style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="sh-solid"
                        onClick={() => void runCertify()}
                        disabled={busy || selectedRows.length === 0}
                        style={{
                          width: "100%", background: C.pink, border: `1px solid ${C.pink}`, color: "#fff",
                          borderRadius: 8, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        {busy ? "Issuing…" : `Issue “${award.label}”`}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default AdminDashboard;

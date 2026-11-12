import { useEffect, useState } from "react";

/**
 * Key HackRx dates, in Pacific time. November dates use PST (UTC-8):
 * daylight saving ends Nov 1, 2026.
 */

/**
 * The exact cutoff: at this moment no more accounts or applications are
 * accepted. Applications are open through the end of Thursday, so the
 * cutoff is Friday, Nov 13 at 12:00am. Keep in sync with applicationsOpen()
 * in firestore.rules.
 */
export const APPLICATIONS_CLOSE = "2026-11-13T00:00:00-08:00";
/** Midnight at the start of event day. */
export const EVENT_START = "2026-11-15T00:00:00-08:00";

/**
 * Set VITE_APPLICATIONS_CLOSED=true in .env.local to preview the closed
 * state before the deadline. (Firestore rules still enforce the real date.)
 */
const FORCE_CLOSED = import.meta.env.VITE_APPLICATIONS_CLOSED === "true";

const CLOSE_MS = new Date(APPLICATIONS_CLOSE).getTime();

/**
 * The last minute applications were open, in Pacific time, for messages:
 * a midnight cutoff reads as e.g. "Thursday, November 12 at 11:59 PM PST",
 * which matches the deadline advertised on the site.
 */
export const APPLICATIONS_CLOSE_LABEL = (() => {
  const when = new Date(CLOSE_MS - 60_000);
  const tz = "America/Los_Angeles";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${day.format(when)} at ${time.format(when)}`;
})();

export const REGISTRATION_CLOSED_MESSAGE =
  `Applications for HackRx closed on ${APPLICATIONS_CLOSE_LABEL}. Already registered? Log in to reach your Hacker Hub.`;

/** True until the application deadline passes. */
export function applicationsOpen(now: number = Date.now()): boolean {
  return !FORCE_CLOSED && now < CLOSE_MS;
}

/**
 * Same as applicationsOpen(), but re-renders the component the moment the
 * deadline passes, so a page left open at the cutoff closes on its own.
 */
export function useApplicationsOpen(): boolean {
  const [open, setOpen] = useState(() => applicationsOpen());

  useEffect(() => {
    if (!open) return;
    // setTimeout caps out around 24.8 days; re-check at least that often.
    const wait = Math.min(Math.max(0, CLOSE_MS - Date.now()), 2_000_000_000);
    const id = window.setTimeout(() => setOpen(applicationsOpen()), wait + 250);
    return () => window.clearTimeout(id);
  }, [open]);

  return open;
}

/**
 * Opens the "applications closed" pop-up from anywhere (services, route
 * guards, pages). <ApplicationsClosedNotice /> in App.tsx listens and shows it.
 */

export type ClosedNoticeReason =
  | "visitor" // landing page, signed out
  | "just-closed" // the deadline passed while the page was open
  | "apply" // tried to open the application form
  | "submit" // tried to submit an application
  | "signup" // tried to create an account
  | "missed"; // signed in, never applied

export const CLOSED_NOTICE_EVENT = "hackrx:applications-closed";

export function showClosedNotice(reason: ClosedNoticeReason): void {
  window.dispatchEvent(new CustomEvent<ClosedNoticeReason>(CLOSED_NOTICE_EVENT, { detail: reason }));
}

/** Like showClosedNotice, but at most once per browser tab session for this reason. */
export function showClosedNoticeOnce(reason: ClosedNoticeReason): void {
  const key = `hackrx-closed-notice:${reason}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked (private mode etc.): just show it.
  }
  showClosedNotice(reason);
}

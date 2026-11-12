import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { APPLICATIONS_CLOSE_LABEL, useApplicationsOpen } from "@/config/deadlines";
import {
  CLOSED_NOTICE_EVENT,
  showClosedNotice,
  showClosedNoticeOnce,
  type ClosedNoticeReason,
} from "@/lib/closed-notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const COPY: Record<ClosedNoticeReason, { title: string; body: string }> = {
  visitor: {
    title: "Applications are closed",
    body: `Applications for HackRx closed on ${APPLICATIONS_CLOSE_LABEL}. Thank you to everyone who applied! Already registered? Log in to check your status and find your team.`,
  },
  "just-closed": {
    title: "Applications just closed",
    body: `The application window closed on ${APPLICATIONS_CLOSE_LABEL}. New accounts and applications can no longer be submitted.`,
  },
  apply: {
    title: "The application window has closed",
    body: `The application form closed on ${APPLICATIONS_CLOSE_LABEL}. If you already applied, your status is on your Hacker Hub.`,
  },
  submit: {
    title: "Your application wasn't submitted",
    body: `The application window closed on ${APPLICATIONS_CLOSE_LABEL}, so this application couldn't be accepted.`,
  },
  signup: {
    title: "Registration is closed",
    body: `New accounts can't be created because applications closed on ${APPLICATIONS_CLOSE_LABEL}. Already have an account? Log in instead.`,
  },
  missed: {
    title: "Applications are closed",
    body: `The application window closed on ${APPLICATIONS_CLOSE_LABEL} before you submitted an application, so you can no longer apply. We hope to see you at a future SacHacks event!`,
  },
};

/**
 * The site-wide "applications closed" pop-up. Opened by showClosedNotice()
 * calls, plus two cases it watches for itself: a signed-out visitor on the
 * landing page (once per visit), and the deadline passing while a page is open.
 */
export const ApplicationsClosedNotice = () => {
  const [reason, setReason] = useState<ClosedNoticeReason | null>(null);
  const triggers = useGlitchTriggers();
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const open = useApplicationsOpen();
  const wasOpen = useRef(open);

  // If one notice is already showing, keep it rather than swapping mid-read.
  useEffect(() => {
    const onNotice = (e: Event) => {
      const next = (e as CustomEvent<ClosedNoticeReason>).detail;
      setReason((current) => current ?? next);
    };
    window.addEventListener(CLOSED_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(CLOSED_NOTICE_EVENT, onNotice);
  }, []);

  // The deadline passed while this tab was open.
  useEffect(() => {
    if (wasOpen.current && !open) showClosedNotice("just-closed");
    wasOpen.current = open;
  }, [open]);

  // Signed-out visitors on the landing page, once per visit.
  useEffect(() => {
    if (!open && !loading && !user && pathname === "/") showClosedNoticeOnce("visitor");
  }, [open, loading, user, pathname]);

  const copy = reason ? COPY[reason] : null;

  return (
    <Dialog open={reason !== null} onOpenChange={(v) => { if (!v) setReason(null); }}>
      <DialogContent className="venom-dialog venom-notice sm:max-w-md">
        <div className="venom-blobs" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
        <DialogHeader>
          <DialogTitle className="venom-title text-3xl">{copy?.title}</DialogTitle>
          <DialogDescription className="venom-notice-body">{copy?.body}</DialogDescription>
        </DialogHeader>
        <Button
          type="button"
          autoFocus
          onClick={() => setReason(null)}
          {...triggers}
          className="venom-submit"
        >
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default ApplicationsClosedNotice;

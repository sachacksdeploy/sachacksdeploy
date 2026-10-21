/**
 * Outgoing email, sent straight from the admin's browser through EmailJS
 * (https://www.emailjs.com). There is no backend, and nothing here touches
 * Firestore.
 *
 * Configure in .env (PLACEHOLDERS until the account is set up):
 *   VITE_EMAILJS_SERVICE_ID   the EmailJS email service, connected to the
 *                             status@sachacks.io mailbox (EMAIL_FROM)
 *   VITE_EMAILJS_TEMPLATE_ID  the template both emails (accept and decline)
 *                             go through; subject and body come from here
 *   VITE_EMAILJS_PUBLIC_KEY   the account's public key
 *
 * The EmailJS template should be set up as:
 *   To Email   {{to_email}}
 *   From Email {{from_email}}
 *   Reply To   {{reply_to}}
 *   Subject    {{subject}}
 *   Content    {{{message_html}}}   (triple braces: it's already escaped HTML)
 * Also sent, for a custom layout: {{to_name}}, {{reasons}}, {{comment}},
 * and {{message}} (plain-text body).
 *
 * The email wording lives in ACCEPT_TEMPLATE and DECLINE_TEMPLATE below, with {{placeholder}}
 * markers filled in by renderTemplate(). Values are HTML-escaped in the html
 * version, so anything an admin types can't change the email's markup.
 *
 * SECURITY — the public key ships in the frontend, so anyone can call this
 * template. Restrict it in the EmailJS dashboard (Account → Security: allowed
 * origins, and keep the template's recipient as {{to_email}} only).
 */

const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";

/** PLACEHOLDER — the event name printed in every email. */
export const EMAIL_EVENT_NAME = "SacHacks VIII";

/** Where applicants are told to write back. */
export const EMAIL_CONTACT = "status@sachacks.io";

/** The address accept and decline emails are sent from. */
export const EMAIL_FROM = "status@sachacks.io";

/**
 * Reasons an admin can tick when declining an application. The label is the
 * sentence the applicant reads in their email.
 */
export const DECLINE_REASONS = {
  bot: "Your registration appeared to be automated (bot activity).",
  incomplete: "Your registration was incomplete.",
  not_student: "You don't appear to be a current university student.",
} as const;

export type DeclineReason = keyof typeof DECLINE_REASONS;

export interface DeclineDetails {
  reasons: DeclineReason[];
  /** Free-text note from the admin, included in the email. May be empty. */
  comment: string;
}

/** Longest admin comment accepted. */
export const MAX_DECLINE_COMMENT = 2000;

/**
 * The decline email.
 *
 * Placeholders:
 *   {{name}}      applicant's name ("there" when unknown)
 *   {{event}}     EMAIL_EVENT_NAME
 *   {{contact}}   EMAIL_CONTACT
 *   {{reasons}}   the "Reason(s)" section, or nothing if none were ticked
 *   {{comment}}   the "Comments" section, or nothing if left blank
 */
export const DECLINE_TEMPLATE = {
  subject: "Your {{event}} application",
  text: `Hi {{name}},

Thank you for applying to {{event}}. After reviewing your application, we're sorry to let you know that it was not accepted.
{{reasons}}{{comment}}
If you believe this was a mistake, contact us at {{contact}} and our team will take another look.

— The {{event}} team`,
  html: `<p>Hi {{name}},</p>
<p>Thank you for applying to {{event}}. After reviewing your application, we're sorry to let you know that it was not accepted.</p>
{{reasons}}{{comment}}
<p>If you believe this was a mistake, contact us at <a href="mailto:{{contact}}">{{contact}}</a> and our team will take another look.</p>
<p>— The {{event}} team</p>`,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replaces every {{key}} in `template` with `values[key]` (unknown keys become ""). */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

/** Builds the decline email: { subject, text, html }. */
export function declineEmail(name: string, details: DeclineDetails) {
  const reasons = details.reasons.map((r) => DECLINE_REASONS[r]);
  const comment = details.comment.trim();
  const base = { name: name || "there", event: EMAIL_EVENT_NAME, contact: EMAIL_CONTACT };
  const esc = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, escapeHtml(v)]));

  return {
    subject: renderTemplate(DECLINE_TEMPLATE.subject, base),
    text: renderTemplate(DECLINE_TEMPLATE.text, {
      ...base,
      reasons: reasons.length ? `\nReason(s):\n${reasons.map((r) => `- ${r}`).join("\n")}\n` : "",
      comment: comment ? `\nComments from the organizers:\n${comment}\n` : "",
    }),
    html: renderTemplate(DECLINE_TEMPLATE.html, {
      ...esc(base),
      reasons: reasons.length
        ? `<p><strong>Reason(s):</strong></p><ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>\n`
        : "",
      comment: comment
        ? `<p><strong>Comments from the organizers:</strong></p><p style="white-space:pre-wrap">${escapeHtml(comment)}</p>\n`
        : "",
    }),
  };
}

/**
 * The acceptance email.
 *
 * Placeholders:
 *   {{name}}       applicant's name ("there" when unknown)
 *   {{event}}      EMAIL_EVENT_NAME
 *   {{contact}}    EMAIL_CONTACT
 *   {{dashboard}}  link to the Hacker Hub dashboard
 */
export const ACCEPT_TEMPLATE = {
  subject: "You're accepted to {{event}}! 🎉",
  text: `Hi {{name}},

Congratulations — you've been accepted to {{event}}! We're excited to have you.

Head to your dashboard for next steps: {{dashboard}}

From there you can:
- Start a team and invite others to join it
- Accept an invite to join someone else's team
- Keep an eye on event updates and the countdown

Questions? Reach us at {{contact}}.

See you there,
— The {{event}} team`,
  html: `<p>Hi {{name}},</p>
<p>Congratulations — you've been accepted to <strong>{{event}}</strong>! We're excited to have you.</p>
<p>Head to your <a href="{{dashboard}}">dashboard</a> for next steps. From there you can:</p>
<ul>
<li>Start a team and invite others to join it</li>
<li>Accept an invite to join someone else's team</li>
<li>Keep an eye on event updates and the countdown</li>
</ul>
<p>Questions? Reach us at <a href="mailto:{{contact}}">{{contact}}</a>.</p>
<p>See you there,<br>— The {{event}} team</p>`,
};

/** The live site, linked from emails. */
export const SITE_URL = "https://sachacks.io";

/** Builds the acceptance email: { subject, text, html }. */
export function acceptEmail(name: string) {
  const base = {
    name: name || "there",
    event: EMAIL_EVENT_NAME,
    contact: EMAIL_CONTACT,
    dashboard: `${SITE_URL}/dashboard`,
  };
  const esc = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, escapeHtml(v)]));
  return {
    subject: renderTemplate(ACCEPT_TEMPLATE.subject, base),
    text: renderTemplate(ACCEPT_TEMPLATE.text, base),
    html: renderTemplate(ACCEPT_TEMPLATE.html, esc),
  };
}

/** Posts one email through EmailJS. Returns an error message, or null on success. */
async function sendEmail(
  to: string,
  name: string,
  email: { subject: string; text: string; html: string },
  extraParams: Record<string, string> = {},
): Promise<string | null> {
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
  if (!serviceId || !templateId || !publicKey) {
    return "Email isn't set up: add the VITE_EMAILJS_* keys to .env.";
  }

  try {
    const res = await fetch(EMAILJS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: to,
          from_email: EMAIL_FROM,
          reply_to: EMAIL_CONTACT,
          to_name: name,
          subject: email.subject,
          reasons: "",
          comment: "",
          ...extraParams,
          message: email.text,
          message_html: email.html,
        },
      }),
    });
    if (res.ok) return null;
    const detail = (await res.text()).slice(0, 200);
    return `EmailJS returned ${res.status}${detail ? `: ${detail}` : ""}`;
  } catch (error) {
    return error instanceof Error ? error.message : "EmailJS request failed";
  }
}

/** Sends the acceptance email. Returns an error message, or null on success. */
export function sendAcceptEmail(to: string, name: string): Promise<string | null> {
  return sendEmail(to, name, acceptEmail(name));
}

/** Sends the decline email. Returns an error message, or null on success. */
export function sendDeclineEmail(
  to: string,
  name: string,
  details: DeclineDetails,
): Promise<string | null> {
  const comment = details.comment.trim().slice(0, MAX_DECLINE_COMMENT);
  return sendEmail(to, name, declineEmail(name, { reasons: details.reasons, comment }), {
    reasons: details.reasons.map((r) => `- ${DECLINE_REASONS[r]}`).join("\n"),
    comment,
  });
}

// Emails everyone who signed up but hasn't submitted an application, every
// 3 days after they signed up (day 3, 6, 9, …), until applications close.
//
// Runs once a day from .github/workflows/application-reminders.yml. It keeps
// no state: a user is due when the number of whole days since their Firebase
// Auth account was created is a positive multiple of REMIND_EVERY_DAYS, so a
// daily run sends each reminder exactly once (a missed run skips that one).
//
// Env:
//   FIREBASE_SERVICE_ACCOUNT  service account JSON (Firebase console → Project
//                             settings → Service accounts → Generate key)
//   EMAILJS_SERVICE_ID        same values as VITE_EMAILJS_* in .env
//   EMAILJS_TEMPLATE_ID
//   EMAILJS_PUBLIC_KEY
//   EMAILJS_PRIVATE_KEY       Account → API keys. Calling EmailJS from a
//                             server also needs Account → Security → "Allow
//                             EmailJS API for non-browser applications".
//   SITE_URL                  optional, defaults to https://sachacks.io
//   DRY_RUN=1                 log who would be emailed, send nothing
//
// Run locally:  cd scripts/reminders && npm install && DRY_RUN=1 node send-application-reminders.mjs
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const REMIND_EVERY_DAYS = 3;
/** Keep in sync with APPLICATIONS_CLOSE in src/pages/Dashboard.tsx. */
const APPLICATIONS_CLOSE = new Date("2026-11-08T00:00:00-08:00");
/** Keep in sync with src/services/email.service.ts. */
const EVENT_NAME = "SacHacks VIII";
const CONTACT = "status@sachacks.io";
const FROM = "status@sachacks.io";

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";
const DRY_RUN = process.env.DRY_RUN === "1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const closesOn = APPLICATIONS_CLOSE.toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles",
});

function reminderEmail(name, applyUrl) {
  const n = name || "there";
  return {
    subject: `Finish your ${EVENT_NAME} application`,
    text: `Hi ${n},

You signed up for ${EVENT_NAME} but haven't submitted your application yet. It only takes a few minutes:

${applyUrl}

Applications close ${closesOn}, so don't wait too long! Once you're accepted you can form a team and invite friends to join you.

Questions? Reach us at ${CONTACT}.

— The ${EVENT_NAME} team`,
    html: `<p>Hi ${escapeHtml(n)},</p>
<p>You signed up for <strong>${EVENT_NAME}</strong> but haven't submitted your application yet. It only takes a few minutes:</p>
<p><a href="${escapeHtml(applyUrl)}">Finish your application</a></p>
<p>Applications close <strong>${closesOn}</strong>, so don't wait too long! Once you're accepted you can form a team and invite friends to join you.</p>
<p>Questions? Reach us at <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<p>— The ${EVENT_NAME} team</p>`,
  };
}

async function sendEmail(to, name, email) {
  const res = await fetch(EMAILJS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: requireEnv("EMAILJS_SERVICE_ID"),
      template_id: requireEnv("EMAILJS_TEMPLATE_ID"),
      user_id: requireEnv("EMAILJS_PUBLIC_KEY"),
      accessToken: requireEnv("EMAILJS_PRIVATE_KEY"),
      template_params: {
        to_email: to,
        from_email: FROM,
        reply_to: CONTACT,
        to_name: name,
        subject: email.subject,
        reasons: "",
        comment: "",
        message: email.text,
        message_html: email.html,
      },
    }),
  });
  if (!res.ok) throw new Error(`EmailJS returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const now = new Date();
  if (now >= APPLICATIONS_CLOSE) {
    console.log("Applications are closed; no reminders sent.");
    return;
  }

  const app = initializeApp({ credential: cert(JSON.parse(requireEnv("FIREBASE_SERVICE_ACCOUNT"))) });
  const db = getFirestore(app);
  const auth = getAuth(app);
  const applyUrl = `${(process.env.SITE_URL || "https://sachacks.io").replace(/\/+$/, "")}/apply`;

  // Signed up (has a users doc), not an admin, no application, not accepted.
  const snapshot = await db.collection("users").get();
  const candidates = snapshot.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((u) => !u.admin && !u.app_id && !u.team_id);

  // Signup time comes from the Auth account (getUsers takes 100 at a time).
  const authByUid = new Map();
  for (let i = 0; i < candidates.length; i += 100) {
    const { users } = await auth.getUsers(candidates.slice(i, i + 100).map((u) => ({ uid: u.uid })));
    for (const record of users) authByUid.set(record.uid, record);
  }

  const due = candidates.filter((u) => {
    const record = authByUid.get(u.uid);
    if (!record || record.disabled) return false;
    const days = Math.floor((now - new Date(record.metadata.creationTime)) / DAY_MS);
    return days > 0 && days % REMIND_EVERY_DAYS === 0;
  });

  console.log(`${candidates.length} without an application, ${due.length} due today${DRY_RUN ? " (dry run)" : ""}.`);

  let failed = 0;
  for (const u of due) {
    const record = authByUid.get(u.uid);
    const to = record.email || u.email;
    if (!to) continue;
    const name = record.displayName || "";
    if (DRY_RUN) {
      console.log(`would email ${u.uid}`);
      continue;
    }
    try {
      await sendEmail(to, name, reminderEmail(name, applyUrl));
      console.log(`emailed ${u.uid}`);
    } catch (error) {
      failed++;
      console.error(`failed ${u.uid}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 1100)); // EmailJS allows ~1 request/second
  }
  if (failed) {
    console.error(`${failed} of ${due.length} reminders failed.`);
    process.exitCode = 1;
  }
}

await main();

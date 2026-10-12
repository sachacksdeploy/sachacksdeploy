/**
 * Participant application: the answer options for every question, the
 * validation schema, and the Firestore reads/writes behind the /apply form.
 *
 * Firestore structure — the application lives on the applicant's own profile:
 *
 * users/{userId}.app_id       id of the application, set when it's submitted
 * users/{userId}.application
 *   status ("pending" | "approved" | "rejected"), created_at,
 *   reviewed_by / reviewed_at (set by an admin), plus every answer from the form
 *
 * firestore.rules only let a user add `app_id` + `application` to their own
 * profile once, with status "pending" — a second submit is refused server-side, and
 * only admins can change it afterwards.
 */

import { z } from "zod";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "@/integrations/firebase/client";

/* ------------------------------------------------------------------ */
/* Answer options                                                      */
/* ------------------------------------------------------------------ */

export const AGE_RANGES = ["Under 18", "18-20", "21-24", "25-29", "30+"];
export const GENDER_SELF_DESCRIBE = "Prefer to self-describe";
export const GENDERS = ["Male", "Female", "Non-binary", GENDER_SELF_DESCRIBE, "Prefer not to say"];
export const ETHNICITY_DECLINE = "Prefer not to say";
export const ETHNICITIES = [
  "Asian",
  "Black / African American",
  "Hispanic / Latino",
  "White",
  "Middle Eastern / North African",
  "Native American / Alaska Native",
  "Native Hawaiian / Pacific Islander",
  "Other",
  ETHNICITY_DECLINE,
];
export const INSTITUTION_OTHER = "Other (please specify)";
export const INSTITUTIONS = [
  "UC Davis",
  "Sacramento State",
  "Community College",
  INSTITUTION_OTHER,
  "Not currently a student",
];
export const HIGH_SCHOOL = "High School";
export const ACADEMIC_STANDINGS = [
  HIGH_SCHOOL,
  "Freshman",
  "Sophomore",
  "Junior",
  "Senior",
  "Graduate / Professional Student",
  "Medical Student",
  "Recent Graduate / Working Professional",
];
export const HACKATHON_EXPERIENCE = [
  "Yes",
  "No, I've attended 1-2",
  "No, I've attended 3 or more",
];
export const INTEREST_AREAS = [
  "AI / Machine Learning",
  "Software / Web Development",
  "Data Science",
  "UI/UX Design",
  "Hardware / Engineering",
  "Healthcare / Medicine",
  "Biotechnology / Biomedical Research",
  "Business / Entrepreneurship",
  "Other",
];
export const MAX_MOTIVATIONS = 3;
export const MOTIVATIONS = [
  "Building a project",
  "Learning new skills",
  "Networking / Meeting people",
  "Exploring healthcare innovation",
  "Competing for prizes",
  "Finding internship / Career opportunities",
  "Having fun with friends",
];
export const TEAM_STATUSES = [
  "Yes, I would like to join a team",
  "No, I prefer working solo",
];
export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
export const DIETARY_NONE = "None";
export const DIETARY_OTHER = "Other (please specify)";
export const DIETARY_OPTIONS = [
  DIETARY_NONE,
  "Vegetarian",
  "Vegan",
  "Halal",
  "Kosher",
  "Gluten-free",
  "Nut allergy",
  DIETARY_OTHER,
];
export const REFERRAL_SOURCES = [
  "Instagram / Social Media",
  "Email from SacHacks",
  "University email / Newsletter",
  "Friends / Word of mouth",
  "Student club / Organization",
  "Professor / Faculty",
  "Flyers / Campus promotion",
  "Previous SacHacks event",
  "Online search",
  "Luma",
  "Other",
];

export const CODE_OF_CONDUCT_URL =
  "https://github.com/SacHacksHackathon/sachacks-policies/blob/main/code-of-conduct.md";

export const SHORT_ANSWER_MAX = 100;
export const LONG_ANSWER_MAX = 2000;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const REQUIRED = "This is a required question";

const text = (max = SHORT_ANSWER_MAX) =>
  z.string().trim().max(max, `Keep this under ${max} characters`);

const requiredText = (max = SHORT_ANSWER_MAX) => text(max).min(1, REQUIRED);

/** One answer from `options`; "" means unanswered. */
const choice = (options: string[], required = false) =>
  z
    .string()
    .refine((v) => !required || v !== "", REQUIRED)
    .refine((v) => v === "" || options.includes(v), "Choose one of the listed options");

/** Any number of answers from `options`. */
const choices = (options: string[]) =>
  z.array(z.string()).refine((list) => list.every((v) => options.includes(v)), "Choose from the listed options");

/** SECURITY — only http(s) links are stored, so admins never get a javascript: link. */
const isWebUrl = (value: string) => {
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === "https:" || protocol === "http:") && hostname.includes(".");
  } catch {
    return false;
  }
};

/** A web link; "drive.google.com/…" is accepted and stored as "https://drive.google.com/…". */
const webLink = (required: boolean) =>
  z
    .string()
    .trim()
    .max(500, "Keep this under 500 characters")
    .transform((v) => (v && !/^[a-z][a-z\d+.-]*:/i.test(v) ? `https://${v}` : v))
    .refine((v) => !required || v !== "", REQUIRED)
    .refine((v) => v === "" || isWebUrl(v), "Enter a full link, e.g. https://…");

const phone = z
  .string()
  .trim()
  .max(30, "Enter a valid phone number")
  .refine(
    (v) => v === "" || (/^[+()\d\s.-]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7),
    "Enter a valid phone number",
  );

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

const baseSchema = z.object({
  full_name: requiredText(),
  phone,
  age_range: choice(AGE_RANGES, true),
  gender: choice(GENDERS),
  gender_self: text(),
  ethnicity: choices(ETHNICITIES),
  institution: choice(INSTITUTIONS, true),
  institution_other: text(150),
  academic_standing: choice(ACADEMIC_STANDINGS, true),
  high_school_case: text(LONG_ANSWER_MAX),
  major: requiredText(),
  first_hackathon: choice(HACKATHON_EXPERIENCE, true),
  interests: choices(INTEREST_AREAS).refine((list) => list.length > 0, REQUIRED),
  motivations: choices(MOTIVATIONS)
    .refine((list) => list.length > 0, REQUIRED)
    .refine((list) => list.length <= MAX_MOTIVATIONS, `Choose up to ${MAX_MOTIVATIONS}`),
  resume_link: webLink(true),
  github: webLink(false),
  team_status: choice(TEAM_STATUSES, true),
  tshirt_size: choice(TSHIRT_SIZES, true),
  dietary: choices(DIETARY_OPTIONS),
  dietary_other: text(),
  referral_source: choice(REFERRAL_SOURCES, true),
  goals: text(LONG_ANSWER_MAX),
  additional_info: text(LONG_ANSWER_MAX),
  code_of_conduct: z.boolean().refine((v) => v, "You must agree to the Code of Conduct to apply"),
  signature: requiredText(),
});

export type ApplicationValues = z.infer<typeof baseSchema>;

/**
 * Answers that are only required because of another answer (a follow-up
 * question), plus the signature check. Zod only runs these once every other
 * field parses, so the form also calls this directly to flag them on the
 * section they belong to.
 */
export function followUpIssues(v: ApplicationValues): { field: keyof ApplicationValues; message: string }[] {
  const issues: { field: keyof ApplicationValues; message: string }[] = [];
  if (v.institution === INSTITUTION_OTHER && !v.institution_other.trim()) {
    issues.push({ field: "institution_other", message: "Tell us which school or institution" });
  }
  if (v.academic_standing === HIGH_SCHOOL && !v.high_school_case.trim()) {
    issues.push({ field: "high_school_case", message: "High school applicants must complete this statement" });
  }
  if (v.dietary.includes(DIETARY_OTHER) && !v.dietary_other.trim()) {
    issues.push({ field: "dietary_other", message: "Please specify your dietary restriction" });
  }
  if (v.signature.trim() && v.full_name.trim() && !sameName(v.signature, v.full_name)) {
    issues.push({ field: "signature", message: "Type your full name exactly as you entered it in section 1" });
  }
  return issues;
}

export const applicationSchema = baseSchema.superRefine((values, ctx) => {
  followUpIssues(values).forEach(({ field, message }) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message }),
  );
});

/* ------------------------------------------------------------------ */
/* Firestore                                                           */
/* ------------------------------------------------------------------ */

export type ApplicationStatus = "pending" | "approved" | "rejected";

export const ALREADY_APPLIED = "You've already submitted an application.";

/**
 * The status of this user's application, or null if they haven't applied
 * (or it couldn't be read).
 */
export async function fetchApplicationStatus(userId: string): Promise<ApplicationStatus | null> {
  try {
    const snapshot = await getDoc(doc(db, "users", userId));
    const application = snapshot.data()?.application;
    if (!application || typeof application !== "object") {
      // An app_id without answers still counts as submitted.
      return snapshot.data()?.app_id ? "pending" : null;
    }
    const status = (application as { status?: unknown }).status;
    return status === "approved" || status === "rejected" ? status : "pending";
  } catch {
    return null;
  }
}

/**
 * Saves the signed-in user's application onto their users/{uid} document.
 * Returns an error message, or null on success.
 */
export async function submitApplication(values: ApplicationValues): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return "Your session has expired. Please log in again and resubmit.";

  // Answers to follow-up questions that were later hidden are dropped.
  const institutionOther = values.institution === INSTITUTION_OTHER ? values.institution_other : "";
  const answers: ApplicationValues = {
    ...values,
    gender_self: values.gender === GENDER_SELF_DESCRIBE ? values.gender_self : "",
    institution_other: institutionOther,
    high_school_case: values.academic_standing === HIGH_SCHOOL ? values.high_school_case : "",
    dietary_other: values.dietary.includes(DIETARY_OTHER) ? values.dietary_other : "",
  };

  try {
    await updateDoc(doc(db, "users", user.uid), {
      // Set once, together with the answers; firestore.rules refuse a second submit.
      app_id: crypto.randomUUID(),
      application: {
        ...answers,
        // The admin roster shows `institution`, so store the school's actual name.
        institution: institutionOther || values.institution,
        institution_choice: values.institution,
        status: "pending",
        created_at: serverTimestamp(),
      },
      updated_at: serverTimestamp(),
    });
    return null;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    console.error("submitApplication failed:", code, error);
    if (code === "permission-denied") {
      if (await fetchApplicationStatus(user.uid)) return ALREADY_APPLIED;
      return import.meta.env.DEV
        ? "Firestore denied the write (permission-denied). The rules in firestore.rules are probably not deployed: paste them into Firebase console → Firestore Database → Rules and publish."
        : "We couldn't save your application. Please try again, or contact the organisers if this keeps happening.";
    }
    if (code === "not-found") {
      return "Your account profile is missing. Please log out, log back in and try again, or contact the organisers.";
    }
    return error instanceof Error ? error.message : "Unable to submit your application";
  }
}

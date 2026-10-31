/**
 * Admin workspace data access layer.
 *
 * This module contains the application-facing admin operations.
 * It communicates with Firestore rather than exposing Firebase SDK
 * operations to React components.
 */

import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import {
  auth,
  db,
} from "@/integrations/firebase/client";

import {
  signIn,
  signOut,
  type LoginValues,
} from "@/services/auth.service";

import {
  TEAMS,
  USERS,
  freshTeamCode,
  idOf,
  leaveTeamWrites,
  soloTeam,
  strList,
} from "@/services/team.service";

/**
 * These types intentionally remain flexible during the migration.
 *
 * The old versions were generated from Supabase's database schema.
 * Firestore does not generate equivalent relational table types, and
 * we should not guess fields that the admin UI may depend on.
 *
 * Once we inspect the admin components, these can be tightened into
 * explicit application models.
 */

export type Application = {
  id: string;
  [key: string]: unknown;
};

export type Team = {
  id: string;
  [key: string]: unknown;
};

export type Demo = {
  id: string;
  [key: string]: unknown;
};

export type Member = {
  id: string;
  [key: string]: unknown;
};

export type Certification = {
  id: string;
  [key: string]: unknown;
};

export interface AdminWorkspace {
  applications: Application[];
  teams: Team[];
  demos: Demo[];
  members: Member[];
  certifications: Certification[];
}

export type ApplicationStatus = "approved" | "rejected";


/**
 * Checks whether a user is an admin.
 *
 * Firestore structure:
 *
 * users/{userId}
 *   admin: true
 *
 * Only an explicit `true` counts; a missing field, `false`, or any other
 * value means "not an admin". The flag is granted from the Firebase console
 * (or the Admin SDK) — firestore.rules stop users from setting it on
 * themselves. This client-side check only controls the UI; the rules are
 * what actually protect the data.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const snapshot = await getDoc(doc(db, USERS, userId));
    return snapshot.exists() && snapshot.data().admin === true;
  } catch {
    return false;
  }
}

/**
 * Signs in through the admin dialog: a normal Firebase email sign-in,
 * followed by a check of the account's `admin` flag. Non-admin accounts
 * are signed straight back out so they don't land in a half-logged-in state.
 */
export async function signInAsAdmin(values: LoginValues): Promise<string | null> {
  const error = await signIn(values);
  if (error) return error;

  const uid = auth.currentUser?.uid;
  if (uid && (await isAdmin(uid))) return null;

  await signOut();
  return "This account doesn't have admin access.";
}

/** Firestore Timestamp (or anything else) -> millis, for newest-first sorting. */
function toMillis(value: unknown): number {
  const ts = value as { toMillis?: () => number } | null | undefined;
  return typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
}

/**
 * Reads a whole collection, newest first.
 *
 * Sorting happens here rather than with a Firestore `orderBy`, because
 * `orderBy` silently drops every document that is missing the sort field.
 */
async function readCollection<T extends { id: string }>(
  name: string,
  sortField: string,
): Promise<T[]> {
  const snapshot = await getDocs(collection(db, name));
  const rows = snapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data(),
  })) as unknown as (T & Record<string, unknown>)[];
  return rows.sort((x, y) => toMillis(y[sortField]) - toMillis(x[sortField]));
}

/**
 * Fetches all datasets displayed by the admin workspace.
 *
 * Firestore collections replace the old Supabase tables:
 *
 * users (applications are the `application` field on each user, and
 *        certificates the `certifications` list on each user)
 * teams
 * demos
 *
 * Each collection is read independently, so one that is empty, missing or
 * denied by Security Rules does not hide the others. `error` describes
 * whatever could not be loaded; `data` always holds what could.
 */
export async function fetchAdminWorkspace(): Promise<{
  data: AdminWorkspace;
  error: string | null;
}> {
  // Only `users` and `teams` exist in Firestore; demos aren't stored yet.
  const sources = [
    [TEAMS, "formed_at"],
    [USERS, "created_at"],
  ] as const;

  const results = await Promise.allSettled(
    sources.map(([name, sortField]) =>
      readCollection<{ id: string }>(name, sortField),
    ),
  );

  const rows = results.map((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = sources
    .filter((_, i) => results[i].status === "rejected")
    .map(([name]) => name);

  let error: string | null = null;
  if (failed.length) {
    const denied = results.some(
      (r) =>
        r.status === "rejected" &&
        (r.reason as { code?: string } | null)?.code === "permission-denied",
    );
    if (denied && !auth.currentUser) {
      error =
        "Firestore refused the request because no Firebase account is signed in. " +
        "Log in with an account whose users document has admin: true to see participants.";
    } else if (denied) {
      error = `This account isn't allowed to read: ${failed.join(", ")}. Check that its users document has admin: true and that firestore.rules are deployed.`;
    } else {
      error = `Unable to load: ${failed.join(", ")}.`;
    }
  }

  const members = rows[1] as Member[];

  // Applications are stored on the applicant's user document. Each one is
  // flattened into its own row, keyed by the applicant's uid, with the
  // account's email so the roster can match it to the member.
  const applications = members
    .filter((m) => m.application && typeof m.application === "object")
    .map((m): Application => ({
      ...(m.application as Record<string, unknown>),
      id: m.id,
      user_id: m.id,
      app_id: m.app_id ?? null,
      email: m.email,
    }))
    .sort((x, y) => toMillis(y.created_at) - toMillis(x.created_at));

  // Certificates are a list on the holder's user document. Each one is
  // flattened into its own row carrying the holder's uid.
  const certifications = members
    .flatMap((m) =>
      (Array.isArray(m.certifications) ? m.certifications : [])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c): Certification => ({
          ...c,
          id: `${m.id}:${String(c.certificate_code ?? c.title)}`,
          user_id: m.id,
        })),
    )
    .sort((x, y) => toMillis(y.issued_at) - toMillis(x.issued_at));

  return {
    data: {
      applications,
      teams: rows[0] as Team[],
      demos: [],
      members,
      certifications,
    },
    error,
  };
}

/**
 * Reviews an application.
 *
 * Approving accepts the applicant: it creates a new team in `teams` that they
 * own (members: [them], pending: [], autofill: false) and sets their
 * `team_id` to it. Someone who already has a team keeps it.
 *
 * Rejecting clears their `team_id`. If they were on a team, they come off it
 * (the team is deleted if they were its last member, and ownership passes to
 * the first remaining member if they owned it).
 */
export async function reviewApplication(
  id: string,
  status: ApplicationStatus,
  reviewerId: string,
): Promise<string | null> {
  try {
    // `id` is the applicant's uid; the application is a field on their user doc.
    const ref = doc(db, USERS, id);
    const review = {
      "application.status": status,
      "application.reviewed_by": reviewerId,
      "application.reviewed_at": serverTimestamp(),
    };

    await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error("That applicant's account no longer exists.");
      const current = idOf(snapshot.data().team_id);
      const currentTeamRef = current ? doc(db, TEAMS, current) : null;
      const currentTeam = currentTeamRef ? await tx.get(currentTeamRef) : null;

      if (status !== "approved") {
        if (currentTeamRef && currentTeam?.exists()) {
          leaveTeamWrites(tx, id, currentTeamRef, currentTeam.data());
        }
        tx.update(ref, { ...review, team_id: null });
        return;
      }

      // Re-approving must not replace a team the applicant is already on.
      if (current && currentTeam?.exists()) {
        tx.update(ref, review);
        return;
      }
      // A team_id with no team behind it gets its team filed under that id.
      const teamId = current ?? (await freshTeamCode(tx));
      tx.set(doc(db, TEAMS, teamId), soloTeam(teamId, id));
      tx.update(ref, { ...review, team_id: teamId });
    });

    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Unable to review application";
  }
}

/**
 * Issues a certification to a user, by adding it to the `certifications`
 * list on their user document.
 */
export async function issueCertification(
  userId: string,
  issuedBy: string,
  title: string,
): Promise<string | null> {
  try {
    const certificateCode = `HRX-${crypto
      .randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;

    // serverTimestamp() isn't allowed inside arrayUnion, hence the client clock.
    await updateDoc(doc(db, USERS, userId), {
      certifications: arrayUnion({
        issued_by: issuedBy,
        title,
        certificate_code: certificateCode,
        issued_at: Timestamp.now(),
      }),
    });

    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Unable to issue certification";
  }
}
/**
 * Admin edit of one team: its leader (the `owner` field, who can invite,
 * remove members and toggle autofill) and its autofill setting.
 *
 * The new leader must already be a member. Read inside a transaction so a
 * member who leaves at the same moment can't be made leader of a team they're
 * no longer on.
 */
export async function updateTeamSettings(
  teamId: string,
  changes: { owner?: string; autofill?: boolean },
): Promise<string | null> {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, TEAMS, teamId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error("That team no longer exists. Refresh to see the latest teams.");
      const update: Record<string, unknown> = {};
      if (changes.owner !== undefined) {
        if (!strList(snapshot.data().members).includes(changes.owner)) {
          throw new Error("The new leader has to be on the team. Refresh and try again.");
        }
        update.owner = changes.owner;
      }
      if (changes.autofill !== undefined) update.autofill = changes.autofill;
      if (Object.keys(update).length) tx.update(ref, update);
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Unable to update the team";
  }
}

/** Turns autofill on or off for several teams. Returns one message per team that failed. */
export async function setTeamsAutofill(teamIds: string[], autofill: boolean): Promise<string[]> {
  const results = await Promise.allSettled(
    teamIds.map((id) => updateDoc(doc(db, TEAMS, id), { autofill })),
  );
  return results.flatMap((r, i) =>
    r.status === "rejected"
      ? [`Team ${teamIds[i]}: ${r.reason instanceof Error ? r.reason.message : "update failed"}`]
      : [],
  );
}

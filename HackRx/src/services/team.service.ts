/**
 * Team planning data access.
 *
 * Firestore structure (the only two collections):
 *
 * users/{uid}
 *   user_id      the account's uid
 *   email        sign-in email
 *   team_id      the team they're on; null until their application is accepted
 *   invitations  list of team_ids that have invited this user
 *
 * teams/{teamId}
 *   team_id      same as the document id
 *   owner        uid of the team owner (always one of `members`)
 *   members      uids on the team, owner included
 *   pending      uids invited but not joined yet
 *   autofill     whether open spots get filled with random hackers
 *
 * A user is accepted once their users doc has a team_id, and an accepted user
 * is always on exactly one team (a team of one to start with). Every write
 * below touches both sides (users + teams) in one transaction or batch, and
 * firestore.rules reject any write that would leave the two out of sync.
 */

import {
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    runTransaction,
    setDoc,
    updateDoc,
    where,
    type DocumentData,
    type DocumentReference,
    type Transaction,
} from "firebase/firestore";

import { db } from "@/integrations/firebase/client";

export const USERS = "users";
export const TEAMS = "teams";

/** Max members + pending on one team, owner included. Keep in sync with maxTeamSize() in firestore.rules. */
export const MAX_TEAM_SIZE = 3;

export type TeamPerson = {
    /** uid */
    id: string;
    /** The user's email, or null when their user doc couldn't be read. */
    email: string | null;
    owner: boolean;
    pending: boolean;
    /** This is the signed-in user. */
    self: boolean;
};

export type IncomingInvite = {
    teamId: string;
    /** Owner's email when it can be read. */
    ownerEmail: string | null;
};

export type TeamPlanningData = {
    teamId: string | null;
    /** The signed-in user owns their team. */
    isOwner: boolean;
    autofill: boolean;
    /** Owner first, then pending invites, then members. */
    people: TeamPerson[];
    invites: IncomingInvite[];
};

/** Result of a team action: null on success, otherwise a message to show. */
export type ActionResult = string | null;

/* ------------------------------------------------------------------ */
/* Small helpers (shared with admin.service)                           */
/* ------------------------------------------------------------------ */

export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : [];
/** team_id may have been typed into the console as a number. */
export const idOf = (v: unknown): string | null => str(v) ?? (typeof v === "number" ? String(v) : null);

const userRef = (uid: string) => doc(db, USERS, uid);
const teamRef = (id: string) => doc(db, TEAMS, id);

/** A new team doc where `owner` is the only member. */
export function soloTeam(teamId: string, owner: string) {
    return { team_id: teamId, owner, members: [owner], pending: [], autofill: false };
}

const TEAM_CODE_LENGTH = 6;
const TEAM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** A random 6-character code of capital letters and digits. */
function randomTeamCode(): string {
    let code = "";
    while (code.length < TEAM_CODE_LENGTH) {
        const [byte] = crypto.getRandomValues(new Uint8Array(1));
        // 252 is the largest multiple of 36 that fits in a byte; skipping the rest keeps it unbiased.
        if (byte < 252) code += TEAM_CODE_ALPHABET[byte % TEAM_CODE_ALPHABET.length];
    }
    return code;
}

/**
 * A team id that isn't taken, read inside the transaction so two teams can't
 * be filed under the same code. Call before any tx writes.
 */
export async function freshTeamCode(tx: Transaction): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomTeamCode();
        if (!(await tx.get(teamRef(code))).exists()) return code;
    }
    throw new Error("Couldn't pick a team code. Please try again.");
}

/**
 * Takes `uid` off `team`: deletes the team if they were its last member,
 * otherwise removes them and, if they owned it, makes the first remaining
 * member the owner. The caller updates the user doc in the same transaction.
 */
export function leaveTeamWrites(
    tx: Transaction,
    uid: string,
    ref: DocumentReference,
    team: DocumentData | undefined,
): void {
    if (!team) return; // no team doc: nothing to take them off
    const members = strList(team.members);
    if (!members.includes(uid)) return;
    const remaining = members.filter((m) => m !== uid);
    if (remaining.length === 0) {
        tx.delete(ref);
        return;
    }
    tx.update(ref, team.owner === uid ? { members: remaining, owner: remaining[0] } : { members: remaining });
}

class TeamError extends Error {}

/** Turns a thrown error into a message for the page. */
function messageFor(error: unknown, fallback: string): string {
    if (error instanceof TeamError) return error.message;
    const code = (error as { code?: string } | null)?.code;
    if (code === "permission-denied")
        return "Firestore refused that change. Refresh the page and try again; if it keeps happening, make sure the latest firestore.rules are deployed.";
    console.error(fallback, error);
    return `${fallback} Check your connection and try again.`;
}

async function readDoc(path: typeof USERS | typeof TEAMS, id: string) {
    try {
        const snapshot = await getDoc(doc(db, path, id));
        return snapshot.exists() ? snapshot.data() : null;
    } catch {
        // Missing permission (e.g. another user's doc) is treated like a missing doc.
        return null;
    }
}

/** Emails for a set of uids. Unreadable users map to null. */
async function emailsFor(uids: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(uids)];
    const users = await Promise.all(unique.map((uid) => readDoc(USERS, uid)));
    return new Map(unique.map((uid, i) => [uid, str(users[i]?.email)]));
}

/* ------------------------------------------------------------------ */
/* Loading the page                                                    */
/* ------------------------------------------------------------------ */

/**
 * Loads everything the Team Planning page shows for this user:
 * their team (users/{uid}.team_id -> teams/{team_id}) and the teams
 * that have invited them (users/{uid}.invitations -> teams/{id}).
 *
 * Invitations from teams that no longer exist, or that no longer list the
 * user as pending, are dropped from the user's doc on the way.
 */
export async function fetchTeamPlanning(uid: string): Promise<TeamPlanningData | null> {
    const me = await readDoc(USERS, uid);
    if (!me) return null;

    const teamId = idOf(me.team_id);
    const invitationIds = [...new Set(strList(me.invitations))];

    const [team, invitingTeams] = await Promise.all([
        teamId ? readDoc(TEAMS, teamId) : Promise.resolve(null),
        Promise.all(invitationIds.map((id) => readDoc(TEAMS, id))),
    ]);

    const live = invitationIds
        .map((id, i) => ({ id, team: invitingTeams[i] }))
        .filter(({ id, team: t }) => id !== teamId && t && strList(t.pending).includes(uid));
    const stale = invitationIds.filter((id) => !live.some((l) => l.id === id));
    if (stale.length) {
        void updateDoc(userRef(uid), { invitations: arrayRemove(...stale) }).catch(() => undefined);
    }

    // No team doc (e.g. a team_id typed into the console): the user is a party of one and owns it.
    const owner = str(team?.owner) ?? (team ? null : teamId ? uid : null);
    const pending = strList(team?.pending).filter((id) => id !== owner);
    const members = strList(team?.members).filter((id) => id !== owner && !pending.includes(id));

    const inviteOwners = live.map(({ team: t }) => str(t?.owner));
    const emails = await emailsFor([
        ...(owner ? [owner] : []),
        ...pending,
        ...members,
        ...inviteOwners.filter((o): o is string => !!o),
    ]);
    // Always know our own email, even if it's only on the auth account.
    if (str(me.email)) emails.set(uid, str(me.email));

    const person = (id: string, flags: Pick<TeamPerson, "owner" | "pending">): TeamPerson => ({
        id,
        email: emails.get(id) ?? null,
        self: id === uid,
        ...flags,
    });

    return {
        teamId,
        isOwner: !!teamId && owner === uid,
        autofill: team?.autofill === true,
        people: [
            ...(owner ? [person(owner, { owner: true, pending: false })] : []),
            ...pending.map((id) => person(id, { owner: false, pending: true })),
            ...members.map((id) => person(id, { owner: false, pending: false })),
        ],
        invites: live.map(({ id }, i) => ({
            teamId: id,
            ownerEmail: inviteOwners[i] ? emails.get(inviteOwners[i]!) ?? null : null,
        })),
    };
}

/* ------------------------------------------------------------------ */
/* Owner: invites                                                      */
/* ------------------------------------------------------------------ */

/**
 * Finds the users doc with this email (one doc at most; that's all the rules
 * allow). Tries the lowercased email first, then exactly as typed.
 */
async function findUserByEmail(email: string) {
    const typed = email.trim();
    for (const candidate of [...new Set([typed.toLowerCase(), typed])]) {
        const result = await getDocs(
            query(collection(db, USERS), where("email", "==", candidate), limit(1)),
        );
        if (!result.empty) return result.docs[0];
    }
    return null;
}

export type InviteResult =
    | { status: "sent"; person: TeamPerson }
    /** The email isn't on the accepted user list. */
    | { status: "warning"; message: string }
    | { status: "error"; message: string };

/**
 * Owner invites `email` to their team:
 *   · checks the email belongs to an accepted user (team_id is set)
 *   · adds their uid to teams/{teamId}.pending
 *   · adds teamId to users/{theirUid}.invitations
 * The last two happen in one transaction, so they always agree.
 */
export async function sendInvite(uid: string, teamId: string, email: string): Promise<InviteResult> {
    const key = email.trim().toLowerCase();
    try {
        const invitee = await findUserByEmail(email);
        const inviteeId = invitee?.id ?? null; // users doc id is the uid
        if (!invitee || !inviteeId || !idOf(invitee.data().team_id)) {
            return {
                status: "warning",
                message: `${key} isn't an accepted hacker. Only accepted participants can be invited, so check the spelling.`,
            };
        }
        if (inviteeId === uid) return { status: "error", message: "You can't invite yourself." };

        // A team_id with no team doc behind it (set by hand in the console): file the team first.
        if (!(await getDoc(teamRef(teamId))).exists()) {
            await setDoc(teamRef(teamId), soloTeam(teamId, uid));
        }

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(teamRef(teamId));
            const team = snap.data();
            const members = strList(team?.members);
            const pending = strList(team?.pending);

            if (!team || team.owner !== uid) throw new TeamError("Only the team owner can send invites.");
            if (members.includes(inviteeId)) throw new TeamError(`${key} is already on your team.`);
            if (pending.includes(inviteeId)) throw new TeamError(`${key} has already been invited.`);
            if (members.length + pending.length >= MAX_TEAM_SIZE)
                throw new TeamError(`Your team is full (${MAX_TEAM_SIZE} including pending invites).`);

            tx.update(teamRef(teamId), { pending: [...pending, inviteeId] });
            tx.update(userRef(inviteeId), { invitations: arrayUnion(teamId) });
        });

        return { status: "sent", person: { id: inviteeId, email: key, owner: false, pending: true, self: false } };
    } catch (error) {
        return { status: "error", message: messageFor(error, "Couldn't send the invite.") };
    }
}

/** Owner withdraws an invite: off teams.pending and off the invitee's invitations. */
export async function cancelInvite(uid: string, teamId: string, inviteeId: string): Promise<ActionResult> {
    try {
        await runTransaction(db, async (tx) => {
            const team = (await tx.get(teamRef(teamId))).data();
            if (!team || team.owner !== uid) throw new TeamError("Only the team owner can cancel invites.");
            const pending = strList(team.pending);
            if (!pending.includes(inviteeId)) return; // already gone
            tx.update(teamRef(teamId), { pending: pending.filter((p) => p !== inviteeId) });
            tx.update(userRef(inviteeId), { invitations: arrayRemove(teamId) });
        });
        return null;
    } catch (error) {
        return messageFor(error, "Couldn't cancel that invite.");
    }
}

/* ------------------------------------------------------------------ */
/* Owner: members and autofill                                         */
/* ------------------------------------------------------------------ */

/**
 * Owner removes a member. The member stays accepted, so they move into a new
 * team of their own (they become its owner).
 */
export async function removeMember(uid: string, teamId: string, memberId: string): Promise<ActionResult> {
    try {
        await runTransaction(db, async (tx) => {
            const team = (await tx.get(teamRef(teamId))).data();
            if (!team || team.owner !== uid) throw new TeamError("Only the team owner can remove members.");
            if (memberId === uid) throw new TeamError("You can't remove yourself. Use Leave team instead.");
            const members = strList(team.members);
            if (!members.includes(memberId)) return; // already gone

            const code = await freshTeamCode(tx);
            tx.set(teamRef(code), soloTeam(code, memberId));
            tx.update(userRef(memberId), { team_id: code });
            tx.update(teamRef(teamId), { members: members.filter((m) => m !== memberId) });
        });
        return null;
    } catch (error) {
        return messageFor(error, "Couldn't remove that member.");
    }
}

/** Owner turns autofill on or off. */
export async function setAutofill(teamId: string, autofill: boolean): Promise<ActionResult> {
    try {
        await updateDoc(teamRef(teamId), { autofill });
        return null;
    } catch (error) {
        return messageFor(error, "Couldn't change autofill.");
    }
}

/* ------------------------------------------------------------------ */
/* Members: leaving                                                    */
/* ------------------------------------------------------------------ */

/**
 * Leaves the current team for a new team of one (the user stays accepted).
 * If the user owned the team, the first remaining member becomes owner.
 */
export async function leaveTeam(uid: string): Promise<ActionResult> {
    try {
        await runTransaction(db, async (tx) => {
            const me = (await tx.get(userRef(uid))).data();
            const teamId = idOf(me?.team_id);
            if (!teamId) throw new TeamError("You're not on a team.");

            const ref = teamRef(teamId);
            const team = (await tx.get(ref)).data();
            if (strList(team?.members).filter((m) => m !== uid).length === 0)
                throw new TeamError("You're the only member of this team, so there's nothing to leave.");

            const code = await freshTeamCode(tx);
            tx.set(teamRef(code), soloTeam(code, uid));
            leaveTeamWrites(tx, uid, ref, team);
            tx.update(userRef(uid), { team_id: code });
        });
        return null;
    } catch (error) {
        return messageFor(error, "Couldn't leave the team.");
    }
}

/* ------------------------------------------------------------------ */
/* Invitees: accept / decline                                          */
/* ------------------------------------------------------------------ */

/**
 * Accepts an invitation:
 *   · leaves the current team (deleted if they were its last member; if they
 *     owned it, the first remaining member becomes owner)
 *   · on the new team, moves them from pending to members
 *   · on the user, sets team_id and drops the invitation
 * Returns null on success, or a message.
 */
export async function acceptInvite(uid: string, teamId: string): Promise<ActionResult> {
    try {
        const outcome = await runTransaction(db, async (tx) => {
            const me = (await tx.get(userRef(uid))).data();
            const current = idOf(me?.team_id);
            if (!current) throw new TeamError("You need to be accepted before you can join a team.");

            const targetRef = teamRef(teamId);
            const target = (await tx.get(targetRef)).data();
            const pending = strList(target?.pending);
            if (current === teamId || !target || !pending.includes(uid)) {
                // Already on it, or the invite no longer stands: just tidy the invitation.
                tx.update(userRef(uid), { invitations: arrayRemove(teamId) });
                return current === teamId ? "joined" : "expired";
            }

            const oldRef = teamRef(current);
            const oldTeam = (await tx.get(oldRef)).data();

            leaveTeamWrites(tx, uid, oldRef, oldTeam);
            tx.update(targetRef, {
                pending: pending.filter((p) => p !== uid),
                members: [...strList(target.members), uid],
            });
            tx.update(userRef(uid), { team_id: teamId, invitations: arrayRemove(teamId) });
            return "joined";
        });
        return outcome === "expired" ? "That invitation is no longer open." : null;
    } catch (error) {
        return messageFor(error, "Couldn't join that team.");
    }
}

/** Declines an invitation: off the team's pending and off the user's invitations. */
export async function declineInvite(uid: string, teamId: string): Promise<ActionResult> {
    try {
        await runTransaction(db, async (tx) => {
            const ref = teamRef(teamId);
            const team = (await tx.get(ref)).data();
            const pending = strList(team?.pending);
            if (team && pending.includes(uid)) {
                tx.update(ref, { pending: pending.filter((p) => p !== uid) });
            }
            tx.update(userRef(uid), { invitations: arrayRemove(teamId) });
        });
        return null;
    } catch (error) {
        return messageFor(error, "Couldn't decline that invitation.");
    }
}

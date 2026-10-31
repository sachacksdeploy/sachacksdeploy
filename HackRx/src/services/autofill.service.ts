/**
 * Team autofill: loads users + teams, plans with autofill.planner, saves the plan.
 *
 * Saving: the plan is split into write groups (see autofill.planner). Each group
 * is one transaction that re-reads its documents and only writes if they still
 * match what the preview was built from. A group whose documents changed in
 * the meantime is skipped, never half-applied, so the data stays consistent
 * either way and running autofill again picks up whatever was skipped.
 *
 * Groups are usually a handful of documents (one person moving and the teams
 * on either side), which keeps each transaction well under the security-rules
 * limit of 20 get() lookups per transaction. firestore.rules checks the admin
 * flag first, so each admin write costs one lookup.
 *
 * Only `users` and `teams` are read or written. No new collections.
 */

import { collection, doc, getDocs, runTransaction, type DocumentData } from "firebase/firestore";

import { db } from "@/integrations/firebase/client";
import { planAutofill, type AutofillPlan, type TeamDoc, type UserDoc, type WriteGroup } from "@/services/autofill.planner";
import { TEAMS, USERS, idOf, str, strList } from "@/services/team.service";

export type { AutofillPlan } from "@/services/autofill.planner";

const toTeam = (id: string, d: DocumentData): TeamDoc => ({
    id,
    owner: str(d.owner),
    members: strList(d.members),
    pending: strList(d.pending),
    autofill: d.autofill === true,
});

const toUser = (id: string, d: DocumentData): UserDoc => ({
    id,
    teamId: idOf(d.team_id),
    invitations: strList(d.invitations),
});

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Reads every team and user (admins may list both) and plans autofill for `teamIds`. */
export async function previewAutofill(teamIds: string[]): Promise<{ plan: AutofillPlan } | { error: string }> {
    try {
        const [teamSnap, userSnap] = await Promise.all([
            getDocs(collection(db, TEAMS)),
            getDocs(collection(db, USERS)),
        ]);
        const teams = teamSnap.docs.map((d) => toTeam(d.id, d.data()));
        const users = userSnap.docs.map((d) => toUser(d.id, d.data()));
        return { plan: planAutofill(teams, users, teamIds) };
    } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        return {
            error:
                code === "permission-denied"
                    ? "Firestore refused to list users and teams. Make sure this account has admin: true."
                    : "Couldn't load teams. Check your connection and try again.",
        };
    }
}

export type AutofillResult = {
    /** Groups saved. */
    saved: number;
    /** Groups skipped because their documents changed after the preview. */
    stale: number;
    /** Groups that failed for another reason (first message kept). */
    failed: number;
    error: string | null;
};

class Stale extends Error {}

async function saveGroup(group: WriteGroup): Promise<void> {
    await runTransaction(db, async (tx) => {
        const teamRefs = group.teams.map((w) => doc(db, TEAMS, w.id));
        const userRefs = group.users.map((w) => doc(db, USERS, w.id));
        const [teamSnaps, userSnaps] = await Promise.all([
            Promise.all(teamRefs.map((r) => tx.get(r))),
            Promise.all(userRefs.map((r) => tx.get(r))),
        ]);

        group.teams.forEach((w, i) => {
            const snap = teamSnaps[i];
            const now = snap.exists() ? toTeam(w.id, snap.data()) : null;
            if (!now || !sameList(now.members, w.before.members) || !sameList(now.pending, w.before.pending)) throw new Stale();
        });
        group.users.forEach((w, i) => {
            const snap = userSnaps[i];
            const now = snap.exists() ? toUser(w.id, snap.data()) : null;
            if (!now || now.teamId !== w.before.team_id || !sameList(now.invitations, w.before.invitations)) throw new Stale();
        });

        group.teams.forEach((w, i) => {
            if (w.after) tx.update(teamRefs[i], { members: w.after.members, pending: w.after.pending });
            else tx.delete(teamRefs[i]);
        });
        group.users.forEach((w, i) => {
            tx.update(userRefs[i], { team_id: w.after.team_id, invitations: w.after.invitations });
        });
    });
}

/** Saves a previewed plan, a few groups at a time. */
export async function runAutofill(plan: AutofillPlan, parallel = 6): Promise<AutofillResult> {
    const result: AutofillResult = { saved: 0, stale: 0, failed: 0, error: null };
    let next = 0;
    const worker = async () => {
        while (next < plan.groups.length) {
            const group = plan.groups[next++];
            try {
                await saveGroup(group);
                result.saved++;
            } catch (error) {
                if (error instanceof Stale) {
                    result.stale++;
                } else {
                    result.failed++;
                    if (!result.error) {
                        const code = (error as { code?: string } | null)?.code;
                        result.error =
                            code === "permission-denied"
                                ? "Firestore refused a change. Make sure the latest firestore.rules are deployed and this account has admin: true."
                                : error instanceof Error
                                    ? error.message
                                    : "Couldn't save a change.";
                        console.error("Autofill group failed", error);
                    }
                }
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, plan.groups.length) }, worker));
    return result;
}

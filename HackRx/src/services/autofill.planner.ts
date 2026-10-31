/**
 * Team autofill planner. Pure: no Firebase, no I/O, so it can be previewed
 * and unit-tested. autofill.service.ts loads the data and saves the plan.
 *
 * The admin picks some teams. Of those, the ones with autofill on form the pool.
 * A team's size is members + pending (invited seats are held), max MAX_TEAM_SIZE.
 *
 * Step 1: people alone on a pool team who have open invitations
 *   An invitation is open if the inviting team still exists and still lists
 *   them as pending. The inviting team doesn't need autofill on.
 *   People are taken in order of fewest open invitations, then fewest
 *   outgoing invites (pending on their own team), then at random. Each one:
 *     · joins one inviting team at random (pending -> members)
 *     · declines every other invitation (off those teams' pending)
 *     · leaves their solo team, which is deleted; anyone it had invited loses
 *       that invitation
 *   When someone joins a team whose owner was also waiting alone, that owner
 *   now has a teammate and leaves the queue.
 *
 * Step 2: random merging, toward 3
 *   The pool teams that are still 1 or 2 people are shuffled. Each 2 gets a 1,
 *   the remaining 1s are grouped in threes, and a leftover pair of 1s is put
 *   together. If a single person would be left alone, the last group is
 *   split into two pairs instead, so nobody stays alone when that can be avoided.
 *   The larger team keeps its id and owner (a random one among solos); the
 *   others' members move in and their team docs are deleted.
 *
 * Cost: O(teams + users + invitations), i.e. O(n), since each team holds at most
 * 2 invites. The step-1 queue is a bucket queue keyed by
 * (open invitations, outgoing invites); counts only go down during a run, so
 * every update moves someone to a lower bucket in O(1).
 *
 * Writes: the plan only describes the final state of each document it changes,
 * so every document is written at most once. Changes are grouped so each group
 * holds both sides of every relationship it changes (user.team_id <-> team.members,
 * user.invitations <-> team.pending). A group can be saved on its own and still
 * leave the data consistent.
 */

/** Max members + pending on one team. Same value as MAX_TEAM_SIZE in team.service.ts. */
const SIZE = 3;

export type TeamDoc = {
    id: string;
    owner: string | null;
    members: string[];
    pending: string[];
    autofill: boolean;
};

export type UserDoc = {
    id: string;
    teamId: string | null;
    invitations: string[];
};

export type TeamFields = { members: string[]; pending: string[] };
export type UserFields = { team_id: string | null; invitations: string[] };

/** `after: null` deletes the team. */
export type TeamWrite = { id: string; before: TeamFields; after: TeamFields | null };
export type UserWrite = { id: string; before: UserFields; after: UserFields };
export type WriteGroup = { teams: TeamWrite[]; users: UserWrite[] };

export type Placement = { userId: string; fromTeam: string; toTeam: string; declined: string[] };
export type Merge = { teamId: string; joined: { userId: string; fromTeam: string }[]; size: number };
export type SkipReason = "not-found" | "autofill-off" | "out-of-sync";

export type AutofillPlan = {
    /** Step 1, in the order they were made. */
    placements: Placement[];
    /** Step 2. */
    merges: Merge[];
    /** Pool teams step 2 found nobody for, so they stay under SIZE (merged teams aren't listed again). */
    unfilled: { teamId: string; size: number }[];
    /** Selected teams left out of the pool, and why. */
    skipped: { teamId: string; reason: SkipReason }[];
    groups: WriteGroup[];
    updates: number;
    deletes: number;
};

type Team = TeamDoc & { deleted: boolean };

const seats = (t: Team) => t.members.length + t.pending.length;

function removeOne(list: string[], x: string): void {
    const i = list.indexOf(x);
    if (i >= 0) list.splice(i, 1);
}

function shuffle<T>(list: T[], random: () => number): T[] {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Min bucket queue over small integer keys with O(1) insert / remove /
 * pick-random-from-min. Keys only decrease while a run is in progress, so the
 * min pointer moves O(total decreases + max key) overall.
 */
class BucketQueue {
    private buckets: string[][] = [];
    private where = new Map<string, { key: number; index: number }>();
    private min = 0;

    has(id: string) {
        return this.where.has(id);
    }

    insert(id: string, key: number) {
        while (this.buckets.length <= key) this.buckets.push([]);
        const bucket = this.buckets[key];
        this.where.set(id, { key, index: bucket.length });
        bucket.push(id);
        if (key < this.min) this.min = key;
    }

    remove(id: string) {
        const at = this.where.get(id);
        if (!at) return;
        const bucket = this.buckets[at.key];
        const last = bucket.pop()!;
        if (last !== id) {
            bucket[at.index] = last;
            this.where.get(last)!.index = at.index;
        }
        this.where.delete(id);
    }

    /** Moves an id that is already queued to `key`. Ids not in the queue are ignored. */
    update(id: string, key: number) {
        const at = this.where.get(id);
        if (!at || at.key === key) return;
        this.remove(id);
        this.insert(id, key);
    }

    /** Removes and returns a random id from the lowest non-empty bucket. */
    popRandomMin(random: () => number): string | null {
        while (this.min < this.buckets.length && this.buckets[this.min].length === 0) this.min++;
        if (this.min >= this.buckets.length) return null;
        const bucket = this.buckets[this.min];
        const id = bucket[Math.floor(random() * bucket.length)];
        this.remove(id);
        return id;
    }
}

/** Union-find over "t:<id>" / "u:<id>" keys, used to group writes. */
class Groups {
    private parent = new Map<string, string>();

    find(x: string): string {
        let root = x;
        while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
        // Path compression.
        for (let at = x; at !== root; ) {
            const next = this.parent.get(at)!;
            this.parent.set(at, root);
            at = next;
        }
        return root;
    }

    private size = new Map<string, number>();

    /** Union by size, so finds stay near O(1). */
    link(a: string, b: string) {
        let ra = this.find(a);
        let rb = this.find(b);
        if (ra === rb) return;
        const sa = this.size.get(ra) ?? 1;
        const sb = this.size.get(rb) ?? 1;
        if (sa > sb) [ra, rb] = [rb, ra];
        this.parent.set(ra, rb);
        this.size.set(rb, sa + sb);
    }
}

export function planAutofill(
    teamDocs: TeamDoc[],
    userDocs: UserDoc[],
    selectedIds: Iterable<string>,
    random: () => number = Math.random,
): AutofillPlan {
    const teams = new Map<string, Team>();
    for (const t of teamDocs) {
        teams.set(t.id, { ...t, members: [...t.members], pending: [...t.pending], deleted: false });
    }
    const users = new Map<string, UserDoc>();
    for (const u of userDocs) users.set(u.id, { ...u, invitations: [...new Set(u.invitations)] });

    // Original field values of every doc the plan touches, captured before the first change.
    const teamBefore = new Map<string, TeamFields>();
    const userBefore = new Map<string, UserFields>();
    const touchTeam = (t: Team) => {
        if (!teamBefore.has(t.id)) teamBefore.set(t.id, { members: [...t.members], pending: [...t.pending] });
    };
    const touchUser = (u: UserDoc) => {
        if (!userBefore.has(u.id)) userBefore.set(u.id, { team_id: u.teamId, invitations: [...u.invitations] });
    };
    const groups = new Groups();
    const link = (userId: string, teamId: string) => groups.link(`u:${userId}`, `t:${teamId}`);

    /* ---------------- The pool ---------------- */

    /** Selected teams with autofill on whose data is consistent. Full teams too: a solo owner with 2 invites out still gets placed in step 1. */
    const pool: Team[] = [];
    const skipped: AutofillPlan["skipped"] = [];
    for (const id of new Set(selectedIds)) {
        const t = teams.get(id);
        if (!t) skipped.push({ teamId: id, reason: "not-found" });
        else if (!t.autofill) skipped.push({ teamId: id, reason: "autofill-off" });
        // Every member must have a user doc pointing back here, or moving them would break the link.
        else if (t.members.length === 0 || t.members.some((m) => users.get(m)?.teamId !== id))
            skipped.push({ teamId: id, reason: "out-of-sync" });
        else pool.push(t);
    }

    /* ---------------- Step 1: solo people with open invitations ---------------- */

    /** Solo pool team id -> the person on it, for people waiting in the queue. */
    const waiting = new Map<string, string>();
    /** Person -> their solo team, and the teams whose invitations are still open to them. */
    const soloTeamOf = new Map<string, Team>();
    const openInvites = new Map<string, Set<string>>();

    const isOpen = (userId: string, teamId: string) => {
        const t = teams.get(teamId);
        return !!t && !t.deleted && teamId !== users.get(userId)?.teamId && t.pending.includes(userId);
    };
    const keyOf = (userId: string) =>
        openInvites.get(userId)!.size * SIZE + Math.min(soloTeamOf.get(userId)!.pending.length, SIZE - 1);

    const queue = new BucketQueue();
    for (const t of pool) {
        if (t.members.length !== 1) continue;
        const person = t.members[0];
        const open = new Set(users.get(person)!.invitations.filter((id) => isOpen(person, id)));
        if (open.size === 0) continue;
        soloTeamOf.set(person, t);
        openInvites.set(person, open);
        waiting.set(t.id, person);
        queue.insert(person, keyOf(person));
    }

    const placements: Placement[] = [];
    for (let person = queue.popRandomMin(random); person !== null; person = queue.popRandomMin(random)) {
        const me = users.get(person)!;
        const solo = soloTeamOf.get(person)!;
        const invites = [...openInvites.get(person)!];
        const target = teams.get(invites[Math.floor(random() * invites.length)])!;
        waiting.delete(solo.id);
        touchUser(me);
        touchTeam(solo);
        touchTeam(target);

        // Join the chosen team.
        removeOne(target.pending, person);
        target.members.push(person);
        link(person, target.id);
        // If its owner was waiting alone, they now have a teammate and stay put.
        const owner = waiting.get(target.id);
        if (owner !== undefined) {
            queue.remove(owner);
            waiting.delete(target.id);
        }

        // Decline the rest. Each of those teams frees a seat.
        const declined: string[] = [];
        for (const id of invites) {
            if (id === target.id) continue;
            const other = teams.get(id)!;
            touchTeam(other);
            removeOne(other.pending, person);
            link(person, id);
            declined.push(id);
            const otherOwner = waiting.get(id);
            if (otherOwner !== undefined) queue.update(otherOwner, keyOf(otherOwner)); // one fewer outgoing invite
        }

        me.teamId = target.id;
        me.invitations = [];

        // The solo team goes away, along with the invitations it had sent.
        solo.deleted = true;
        link(person, solo.id);
        for (const invitee of solo.pending) {
            const them = users.get(invitee);
            if (!them) continue;
            touchUser(them);
            them.invitations = them.invitations.filter((id) => id !== solo.id);
            link(invitee, solo.id);
            const open = openInvites.get(invitee);
            if (!open || !queue.has(invitee)) continue;
            open.delete(solo.id);
            if (open.size === 0) {
                queue.remove(invitee); // goes to step 2 instead
                waiting.delete(soloTeamOf.get(invitee)!.id);
            } else {
                queue.update(invitee, keyOf(invitee));
            }
        }

        placements.push({ userId: person, fromTeam: solo.id, toTeam: target.id, declined });
    }

    /* ---------------- Step 2: random merging ---------------- */

    const ones: Team[] = [];
    const twos: Team[] = [];
    for (const t of pool) {
        if (t.deleted) continue;
        if (seats(t) === 1) ones.push(t);
        else if (seats(t) === 2) twos.push(t);
    }
    shuffle(ones, random);
    shuffle(twos, random);

    const paired = Math.min(ones.length, twos.length);
    const sets: Team[][] = [];
    for (let i = 0; i < paired; i++) sets.push([twos[i], ones[i]]);
    let i = paired;
    for (; ones.length - i >= 3; i += 3) sets.push(ones.slice(i, i + 3));
    const left = ones.slice(i);
    if (left.length === 2) {
        sets.push(left);
    } else if (left.length === 1) {
        // Don't leave one person alone: 3 + 1 becomes 2 + 2, or 2+1 and 1 become 2 and 1+1.
        const last = sets[sets.length - 1];
        if (last && last.length === 3) {
            sets.pop();
            sets.push([last[0], last[1]], [last[2], left[0]]);
        } else if (last) {
            sets.pop();
            sets.push([last[1], left[0]]); // last is [two, one]; the two stays as it is
        }
    }

    const merges: Merge[] = [];
    for (const set of sets) {
        const keep = set.find((t) => seats(t) === 2) ?? set[0];
        touchTeam(keep);
        const joined: Merge["joined"] = [];
        for (const t of set) {
            if (t === keep) continue;
            const person = t.members[0]; // a 1-seat team is one member, nobody pending
            const them = users.get(person)!;
            touchTeam(t);
            touchUser(them);
            keep.members.push(person);
            them.teamId = keep.id;
            t.deleted = true;
            link(person, t.id);
            link(person, keep.id);
            joined.push({ userId: person, fromTeam: t.id });
        }
        merges.push({ teamId: keep.id, joined, size: seats(keep) });
    }

    const merged = new Set(merges.map((m) => m.teamId));
    const unfilled = pool
        .filter((t) => !t.deleted && !merged.has(t.id) && seats(t) < SIZE)
        .map((t) => ({ teamId: t.id, size: seats(t) }));

    /* ---------------- Writes, grouped ---------------- */

    const byRoot = new Map<string, WriteGroup>();
    const groupFor = (key: string) => {
        const root = groups.find(key);
        let g = byRoot.get(root);
        if (!g) byRoot.set(root, (g = { teams: [], users: [] }));
        return g;
    };
    let updates = 0;
    let deletes = 0;
    for (const [id, before] of teamBefore) {
        const t = teams.get(id)!;
        const after = t.deleted ? null : { members: [...t.members], pending: [...t.pending] };
        if (after && sameList(after.members, before.members) && sameList(after.pending, before.pending)) continue;
        if (after) updates++;
        else deletes++;
        groupFor(`t:${id}`).teams.push({ id, before, after });
    }
    for (const [id, before] of userBefore) {
        const u = users.get(id)!;
        const after = { team_id: u.teamId, invitations: [...u.invitations] };
        if (after.team_id === before.team_id && sameList(after.invitations, before.invitations)) continue;
        updates++;
        groupFor(`u:${id}`).users.push({ id, before, after });
    }

    return { placements, merges, unfilled, skipped, groups: [...byRoot.values()], updates, deletes };
}

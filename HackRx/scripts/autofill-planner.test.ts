// Unit tests for the team autofill planner. Run from the project root:
//   npm run test:autofill
import { test } from "node:test";
import assert from "node:assert/strict";
import { planAutofill, type TeamDoc, type UserDoc, type AutofillPlan } from "../src/services/autofill.planner.ts";

type DB = { teams: Map<string, TeamDoc>; users: Map<string, UserDoc> };

function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Builds a consistent db from a compact description. */
function build(spec: Record<string, { members: string[]; pending?: string[]; autofill?: boolean }>): DB {
    const teams = new Map<string, TeamDoc>();
    const users = new Map<string, UserDoc>();
    for (const [id, t] of Object.entries(spec)) {
        teams.set(id, { id, owner: t.members[0], members: [...t.members], pending: [...(t.pending ?? [])], autofill: !!t.autofill });
        for (const m of t.members) users.set(m, { id: m, teamId: id, invitations: [] });
    }
    for (const t of teams.values()) for (const p of t.pending) users.get(p)!.invitations.push(t.id);
    return { teams, users };
}

function run(db: DB, selected: string[], seed = 1) {
    return planAutofill([...db.teams.values()], [...db.users.values()], selected, mulberry32(seed));
}

function clone(db: DB): DB {
    return {
        teams: new Map([...db.teams].map(([k, t]) => [k, { ...t, members: [...t.members], pending: [...t.pending] }])),
        users: new Map([...db.users].map(([k, u]) => [k, { ...u, invitations: [...u.invitations] }])),
    };
}

function apply(db: DB, plan: AutofillPlan, keep: (i: number) => boolean = () => true): DB {
    const out = clone(db);
    plan.groups.forEach((g, i) => {
        if (!keep(i)) return;
        for (const w of g.teams) {
            const t = out.teams.get(w.id)!;
            assert.deepEqual({ members: t.members, pending: t.pending }, w.before, "before matches");
            if (!w.after) out.teams.delete(w.id);
            else out.teams.set(w.id, { ...t, members: [...w.after.members], pending: [...w.after.pending] });
        }
        for (const w of g.users) {
            const u = out.users.get(w.id)!;
            assert.deepEqual({ team_id: u.teamId, invitations: u.invitations }, w.before, "before matches");
            out.users.set(w.id, { ...u, teamId: w.after.team_id, invitations: [...w.after.invitations] });
        }
    });
    return out;
}

function assertConsistent(db: DB) {
    const seen = new Set<string>();
    for (const t of db.teams.values()) {
        assert.ok(t.members.length >= 1, `team ${t.id} not empty`);
        assert.ok(t.members.length + t.pending.length <= 3, `team ${t.id} size ${t.members.length}+${t.pending.length}`);
        assert.ok(t.members.includes(t.owner!), `team ${t.id} owner is a member`);
        for (const m of t.members) {
            assert.ok(!seen.has(m), `${m} on one team`);
            seen.add(m);
            assert.equal(db.users.get(m)!.teamId, t.id, `${m}.team_id -> ${t.id}`);
        }
        for (const p of t.pending) {
            assert.ok(!t.members.includes(p), `${p} not both member and pending of ${t.id}`);
            assert.ok(db.users.get(p)!.invitations.includes(t.id), `${p}.invitations has ${t.id}`);
        }
    }
    for (const u of db.users.values()) {
        if (u.teamId) assert.ok(db.teams.get(u.teamId)?.members.includes(u.id), `${u.id} listed on ${u.teamId}`);
        for (const x of u.invitations) assert.ok(db.teams.get(x)?.pending.includes(u.id), `${x}.pending has ${u.id}`);
    }
}

const sizeOf = (db: DB, team: string) => db.teams.get(team)!.members.length + db.teams.get(team)!.pending.length;

test("a solo person joins their only inviter; the solo team is deleted", () => {
    const db = build({ S: { members: ["a"], autofill: true }, T: { members: ["t1"], pending: ["a"] } });
    const plan = run(db, ["S"]);
    const after = apply(db, plan);
    assertConsistent(after);
    assert.deepEqual(after.teams.get("T")!.members, ["t1", "a"]);
    assert.equal(after.teams.has("S"), false);
    assert.equal(plan.placements.length, 1);
});

test("other invitations are declined, freeing those seats", () => {
    const db = build({
        S: { members: ["a"], autofill: true },
        T1: { members: ["x"], pending: ["a"] },
        T2: { members: ["y"], pending: ["a"] },
        T3: { members: ["z"], pending: ["a"] },
    });
    const after = apply(db, run(db, ["S"]));
    assertConsistent(after);
    const joined = ["T1", "T2", "T3"].filter((t) => after.teams.get(t)!.members.includes("a"));
    assert.equal(joined.length, 1);
    for (const t of ["T1", "T2", "T3"]) assert.deepEqual(after.teams.get(t)!.pending, []);
    assert.deepEqual(after.users.get("a")!.invitations, []);
});

test("autofill off or unselected solo people are left alone", () => {
    const db = build({ S: { members: ["a"], autofill: false }, R: { members: ["b"], autofill: true }, T: { members: ["t"], pending: ["a", "b"] } });
    const plan = run(db, ["S"]);
    assert.equal(plan.placements.length, 0);
    assert.deepEqual(plan.skipped, [{ teamId: "S", reason: "autofill-off" }]);
    assert.equal(plan.groups.length, 0);
});

test("the inviting team doesn't need autofill or to be selected", () => {
    const db = build({ S: { members: ["a"], autofill: true }, T: { members: ["t1", "t2"], pending: ["a"], autofill: false } });
    const after = apply(db, run(db, ["S"]));
    assert.deepEqual(after.teams.get("T")!.members, ["t1", "t2", "a"]);
});

test("ties on invitations: fewer outgoing invites goes first, so the inviter keeps their invitee", () => {
    // a and b are both alone with 1 open invite. a invited b (outgoing 1); b has none.
    // b goes first and joins a, so a now has a teammate and isn't moved to C.
    const db = build({
        A: { members: ["a"], pending: ["b"], autofill: true },
        B: { members: ["b"], autofill: true },
        C: { members: ["c"], pending: ["a"] },
    });
    for (let seed = 1; seed < 30; seed++) {
        const plan = run(db, ["A", "B"], seed);
        const after = apply(db, plan);
        assertConsistent(after);
        assert.deepEqual(after.teams.get("A")!.members, ["a", "b"]);
        assert.deepEqual(after.teams.get("C")!.pending, ["a"], "a's invite from C is untouched");
        assert.equal(plan.placements.length, 1);
    }
});

test("fewest invitations first, and a mover's deleted team cancels the invites it sent", () => {
    // a: 1 invite (from T), 1 outgoing (b) -> key 4. b: 2 invites (A, Z), 0 outgoing -> key 6.
    // a moves to T first; A is deleted, so b's invite from A disappears and b joins Z.
    const db = build({
        A: { members: ["a"], pending: ["b"], autofill: true },
        B: { members: ["b"], autofill: true },
        T: { members: ["t"], pending: ["a"] },
        Z: { members: ["z"], pending: ["b"] },
    });
    for (let seed = 1; seed < 30; seed++) {
        const plan = run(db, ["A", "B"], seed);
        const after = apply(db, plan);
        assertConsistent(after);
        assert.deepEqual(plan.placements.map((p) => [p.userId, p.toTeam]), [["a", "T"], ["b", "Z"]]);
        assert.equal(after.teams.has("A"), false);
    }
});

test("step 2: each 2 gets a 1, then 1s in threes", () => {
    const db = build({
        P: { members: ["p1", "p2"], autofill: true },
        S1: { members: ["s1"], autofill: true },
        S2: { members: ["s2"], autofill: true },
        S3: { members: ["s3"], autofill: true },
        S4: { members: ["s4"], autofill: true },
    });
    const plan = run(db, ["P", "S1", "S2", "S3", "S4"]);
    const after = apply(db, plan);
    assertConsistent(after);
    assert.deepEqual([...after.teams.values()].map((t) => t.members.length).sort(), [3, 3]);
    assert.equal(after.teams.get("P")!.members.length, 3, "the pair keeps its id");
    assert.deepEqual(plan.unfilled, []);
});

test("step 2: two leftover solo people are paired, and not listed as unmatched", () => {
    const db = build({ S1: { members: ["a"], autofill: true }, S2: { members: ["b"], autofill: true } });
    const plan = run(db, ["S1", "S2"]);
    const after = apply(db, plan);
    assert.deepEqual([...after.teams.values()].map((t) => t.members.length), [2]);
    assert.deepEqual(plan.unfilled, []);
});

test("unmatched teams are listed: extra pairs and a lone solo", () => {
    const db = build({ P: { members: ["p1", "p2"], autofill: true }, Q: { members: ["q1", "q2"], autofill: true }, S: { members: ["s"], autofill: true } });
    const plan = run(db, ["P", "Q", "S"]);
    assert.equal(plan.merges.length, 1);
    assert.equal(plan.unfilled.length, 1);
    assert.equal(plan.unfilled[0].size, 2);
    const lone = build({ S: { members: ["s"], autofill: true } });
    assert.deepEqual(run(lone, ["S"]).unfilled, [{ teamId: "S", size: 1 }]);
});

test("step 2: nobody is left alone when it can be avoided (4 solos -> 2 + 2)", () => {
    const db = build({ S1: { members: ["a"], autofill: true }, S2: { members: ["b"], autofill: true }, S3: { members: ["c"], autofill: true }, S4: { members: ["d"], autofill: true } });
    const after = apply(db, run(db, ["S1", "S2", "S3", "S4"]));
    assertConsistent(after);
    assert.deepEqual([...after.teams.values()].map((t) => t.members.length).sort(), [2, 2]);
});

test("step 2: 2 + 1 with one extra solo -> the pair stays, solos pair up", () => {
    const db = build({ P: { members: ["p1", "p2"], autofill: true }, S1: { members: ["a"], autofill: true }, S2: { members: ["b"], autofill: true } });
    const plan = run(db, ["P", "S1", "S2"]);
    const after = apply(db, plan);
    assertConsistent(after);
    assert.deepEqual([...after.teams.values()].map((t) => t.members.length).sort(), [2, 2]);
});

test("step 2: pending invites count as seats; a team of 1 + 1 pending takes one more", () => {
    const db = build({
        P: { members: ["p"], pending: ["q"], autofill: true },
        Q: { members: ["q"] }, // q's own team: not selected, so q stays pending
        S1: { members: ["a"], autofill: true },
        S2: { members: ["b"], autofill: true },
        S3: { members: ["c"], autofill: true },
        S4: { members: ["d"], autofill: true },
    });
    const plan = run(db, ["P", "S1", "S2", "S3", "S4"]);
    const after = apply(db, plan);
    assertConsistent(after);
    assert.equal(sizeOf(after, "P"), 3);
    assert.deepEqual(after.teams.get("P")!.pending, ["q"]);
});

test("full teams aren't touched; unknown ids are reported", () => {
    const db = build({ F: { members: ["a", "b"], pending: ["c"], autofill: true }, C: { members: ["c"] } });
    const plan = run(db, ["F", "nope"]);
    assert.deepEqual(plan.skipped, [{ teamId: "nope", reason: "not-found" }]);
    assert.equal(plan.groups.length, 0);
});

test("a solo owner whose team is full of outgoing invites is still placed", () => {
    const db = build({
        A: { members: ["a"], pending: ["b", "c"], autofill: true },
        B: { members: ["b"] }, C: { members: ["c"] },
        T: { members: ["t"], pending: ["a"] },
    });
    const after = apply(db, run(db, ["A"]));
    assertConsistent(after);
    assert.deepEqual(after.teams.get("T")!.members, ["t", "a"]);
    assert.deepEqual(after.users.get("b")!.invitations, []);
});

test("a declined invite frees a seat that step 2 can then fill", () => {
    // a has invites from T and X (X selected, autofill, 1 member + a pending). If a picks T,
    // X drops to 1 seat and is merged in step 2.
    const db = build({
        S: { members: ["a"], autofill: true },
        T: { members: ["t"], pending: ["a"] },
        X: { members: ["x"], pending: ["a"], autofill: true },
        Y: { members: ["y1", "y2"], autofill: true },
    });
    for (let seed = 1; seed < 40; seed++) {
        const plan = run(db, ["S", "X", "Y"], seed);
        const after = apply(db, plan);
        assertConsistent(after);
        if (plan.placements[0].toTeam === "T") assert.equal(after.teams.get("Y")!.members.length, 3, "x merged into Y");
    }
});

/* ---------------- Randomized ---------------- */

function randomDb(n: number, random: () => number): { db: DB; selected: string[] } {
    const ids = Array.from({ length: n }, (_, i) => `u${i}`);
    const spec: Record<string, { members: string[]; pending: string[]; autofill: boolean }> = {};
    let k = 0;
    for (let i = 0; i < ids.length; ) {
        const size = 1 + Math.floor(random() * (random() < 0.6 ? 1 : 3));
        spec[`T${k++}`] = { members: ids.slice(i, i + size), pending: [], autofill: random() < 0.6 };
        i += size;
    }
    const teamIds = Object.keys(spec);
    for (let tries = 0; tries < n * 2; tries++) {
        const t = spec[teamIds[Math.floor(random() * teamIds.length)]];
        const u = ids[Math.floor(random() * ids.length)];
        if (t.members.length + t.pending.length >= 3 || t.members.includes(u) || t.pending.includes(u)) continue;
        t.pending.push(u);
    }
    const db = build(spec);
    const selected = teamIds.filter(() => random() < 0.85);
    return { db, selected };
}

test("randomized: consistent after the full plan and after any subset of groups", () => {
    for (let seed = 1; seed <= 400; seed++) {
        const random = mulberry32(seed);
        const { db, selected } = randomDb(5 + Math.floor(random() * 60), random);
        assertConsistent(db);
        const plan = run(db, selected, seed);

        // Every doc is written at most once.
        const keys = plan.groups.flatMap((g) => [...g.teams.map((t) => `t:${t.id}`), ...g.users.map((u) => `u:${u.id}`)]);
        assert.equal(new Set(keys).size, keys.length, "each doc in one group, once");
        assert.equal(plan.updates + plan.deletes, keys.length);

        const after = apply(db, plan);
        assertConsistent(after);

        // Any subset of groups also leaves the data consistent.
        const pick = mulberry32(seed * 7);
        assertConsistent(apply(db, plan, () => pick() < 0.5));

        const sel = new Set(selected);
        for (const t of after.teams.values()) {
            if (!sel.has(t.id) || !t.autofill) continue;
            // No selected autofill solo is left with an open invitation.
            if (t.members.length === 1) {
                const person = after.users.get(t.members[0])!;
                assert.equal(person.invitations.filter((x) => after.teams.get(x)?.pending.includes(person.id)).length, 0, `seed ${seed}: ${person.id} still has open invites`);
            }
        }
        // Among pool teams that are still under 3, at most one is alone, and only if nothing could be merged.
        const poolLeft = plan.unfilled.map((u) => u.size);
        const alone = poolLeft.filter((s) => s === 1).length;
        assert.ok(alone <= 1, `seed ${seed}: ${alone} left alone`);
        if (alone === 1) assert.equal(plan.merges.length, 0, `seed ${seed}: someone alone despite merges`);
    }
});

test("roughly linear time", () => {
    const time = (n: number) => {
        const { db, selected } = randomDb(n, mulberry32(n));
        const t0 = performance.now();
        run(db, selected);
        return performance.now() - t0;
    };
    time(20000); // warm up
    const a = time(50000);
    const b = time(200000);
    console.log(`  50k users: ${a.toFixed(0)} ms, 200k users: ${b.toFixed(0)} ms (x${(b / a).toFixed(1)} for x4 input)`);
    assert.ok(b / a < 8, "should scale about linearly");
});

// Emulator tests for firestore.rules: every users/teams flow the app performs.
//
// Run from the project root (needs Java, which the Firestore emulator uses):
//   npm i -D @firebase/rules-unit-testing firebase-tools
//   npx firebase emulators:exec --only firestore --project demo-hackrx "node scripts/firestore-rules.test.mjs"
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-hackrx",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.com` }).firestore();
const user = (uid, extra = {}) => ({ user_id: uid, email: `${uid}@x.com`, admin: false, team_id: null, app_id: null, invitations: [], ...extra });
const team = (id, owner, extra = {}) => ({ team_id: id, owner, members: [owner], pending: [], autofill: false, ...extra });

async function seed(users, teams = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, data] of Object.entries(users)) await setDoc(doc(db, "users", id), data);
    for (const [id, data] of Object.entries(teams)) await setDoc(doc(db, "teams", id), data);
  });
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

// ---- sign up ---------------------------------------------------------------
await seed({});
await test("sign up creates own doc", () =>
  assertSucceeds(setDoc(doc(as("a"), "users/a"), user("a"))));
await test("sign up minimal (user_id, email, admin)", () =>
  assertSucceeds(setDoc(doc(as("m"), "users/m"), { user_id: "m", email: "m@x.com", admin: false })));
await test("sign up can't make self admin", () =>
  assertFails(setDoc(doc(as("b"), "users/b"), user("b", { admin: true }))));
await test("sign up can't set team_id", () =>
  assertFails(setDoc(doc(as("b"), "users/b"), user("b", { team_id: "T" }))));
await test("sign up can't use someone else's email", () =>
  assertFails(setDoc(doc(as("b"), "users/b"), user("b", { email: "a@x.com" }))));

// ---- apply -----------------------------------------------------------------
await seed({ a: user("a") });
const application = () => ({ full_name: "A", status: "pending", created_at: serverTimestamp() });
await test("submit application sets app_id", () =>
  assertSucceeds(updateDoc(doc(as("a"), "users/a"), { app_id: "app-1", application: application(), updated_at: serverTimestamp() })));
await test("can't resubmit", () =>
  assertFails(updateDoc(doc(as("a"), "users/a"), { app_id: "app-2", application: application() })));
await test("can't accept self", () =>
  assertFails(updateDoc(doc(as("a"), "users/a"), { team_id: "T" })));
await test("profile edit ok", () =>
  assertSucceeds(updateDoc(doc(as("a"), "users/a"), { full_name: "Alice", updated_at: serverTimestamp() })));

// ---- admin accepts ---------------------------------------------------------
await seed({
  boss: user("boss", { admin: true }),
  a: user("a", { app_id: "x", application: { status: "pending" } }),
});
await test("admin approve creates team + sets team_id", async () => {
  const db = as("boss");
  const b = writeBatch(db);
  b.update(doc(db, "users/a"), { "application.status": "approved", "application.reviewed_by": "boss", "application.reviewed_at": serverTimestamp(), team_id: "TA" });
  b.set(doc(db, "teams/TA"), team("TA", "a"));
  await assertSucceeds(b.commit());
});
await test("admin can list users", () => assertSucceeds(getDocs(collection(as("boss"), "users"))));
await test("non-admin can't create a team for someone else", async () => {
  await seed({ a: user("a"), c: user("c") });
  const db = as("c");
  const b = writeBatch(db);
  b.set(doc(db, "teams/TX"), team("TX", "a"));
  await assertFails(b.commit());
});

// ---- invite / cancel / decline / accept ------------------------------------
const base = () => seed(
  {
    a: user("a", { team_id: "TA" }),
    b: user("b", { team_id: "TB" }),
    c: user("c", { team_id: "TA" }),
    n: user("n"), // not accepted
  },
  {
    TA: team("TA", "a", { members: ["a", "c"] }),
    TB: team("TB", "b"),
  },
);

await base();
await test("accepted user can look up by email (limit 1)", () =>
  assertSucceeds(getDocs(query(collection(as("a"), "users"), where("email", "==", "b@x.com"), limit(1)))));
await test("lookup without limit is refused", () =>
  assertFails(getDocs(query(collection(as("a"), "users"), where("email", "==", "b@x.com")))));

const invite = (by, teamId, invitee, pendingAfter) => {
  const db = as(by);
  const b = writeBatch(db);
  b.update(doc(db, `teams/${teamId}`), { pending: pendingAfter });
  b.update(doc(db, `users/${invitee}`), { invitations: arrayUnion(teamId) });
  return b.commit();
};
await test("owner invites accepted user", () => assertSucceeds(invite("b", "TB", "a", ["a"])));
await test("owner can read invitee doc", () => assertSucceeds(getDoc(doc(as("b"), "users/a"))));
await test("invitee can read inviting owner's doc", () => assertSucceeds(getDoc(doc(as("a"), "users/b"))));
await test("member (non-owner) can't invite", async () => {
  await base();
  await assertFails(invite("c", "TA", "b", ["b"]));
});
await test("can't invite unaccepted user", async () => {
  await base();
  await assertFails(invite("b", "TB", "n", ["n"]));
});
await test("can't exceed team size", async () => {
  await seed(
    { a: user("a", { team_id: "TA" }), b: user("b", { team_id: "TB" }), c: user("c", { team_id: "TA" }), d: user("d", { team_id: "TD" }), e: user("e", { team_id: "TE" }) },
    { TA: team("TA", "a", { members: ["a", "c"], pending: ["d"] }), TB: team("TB", "b"), TD: team("TD", "d"), TE: team("TE", "e") },
  );
  await assertFails(invite("a", "TA", "e", ["d", "e"]));
});
await test("pending-only write without invitee doc is refused", async () => {
  await base();
  await assertFails(updateDoc(doc(as("b"), "teams/TB"), { pending: ["a"] }));
});

await base();
await invite("b", "TB", "a", ["a"]);
await test("owner cancels invite", async () => {
  const db = as("b");
  const b = writeBatch(db);
  b.update(doc(db, "teams/TB"), { pending: [] });
  b.update(doc(db, "users/a"), { invitations: arrayRemove("TB") });
  await assertSucceeds(b.commit());
});

await base();
await invite("b", "TB", "a", ["a"]);
await test("invitee declines", async () => {
  const db = as("a");
  const b = writeBatch(db);
  b.update(doc(db, "teams/TB"), { pending: [] });
  b.update(doc(db, "users/a"), { invitations: arrayRemove("TB") });
  await assertSucceeds(b.commit());
});

await base();
await invite("b", "TB", "a", ["a"]);
await test("owner (a) accepts: leaves TA (c becomes owner), joins TB", async () => {
  const db = as("a");
  const b = writeBatch(db);
  b.update(doc(db, "teams/TA"), { members: ["c"], owner: "c" });
  b.update(doc(db, "teams/TB"), { pending: [], members: ["b", "a"] });
  b.update(doc(db, "users/a"), { team_id: "TB", invitations: arrayRemove("TB") });
  await assertSucceeds(b.commit());
});

await base();
await invite("b", "TB", "a", ["a"]);
await test("accept without ownership transfer is refused", async () => {
  const db = as("a");
  const b = writeBatch(db);
  b.update(doc(db, "teams/TA"), { members: ["c"] });
  b.update(doc(db, "teams/TB"), { pending: [], members: ["b", "a"] });
  b.update(doc(db, "users/a"), { team_id: "TB", invitations: arrayRemove("TB") });
  await assertFails(b.commit());
});

await base();
await invite("a", "TA", "b", ["b"]);
await test("last member accepts: old team deleted", async () => {
  const db = as("b");
  const b = writeBatch(db);
  b.delete(doc(db, "teams/TB"));
  b.update(doc(db, "teams/TA"), { pending: [], members: ["a", "c", "b"] });
  b.update(doc(db, "users/b"), { team_id: "TA", invitations: arrayRemove("TA") });
  await assertSucceeds(b.commit());
});

await base();
await test("can't join a team without an invite", async () => {
  const db = as("b");
  const b = writeBatch(db);
  b.delete(doc(db, "teams/TB"));
  b.update(doc(db, "teams/TA"), { members: ["a", "c", "b"] });
  b.update(doc(db, "users/b"), { team_id: "TA" });
  await assertFails(b.commit());
});

// ---- leave / remove / autofill ---------------------------------------------
await base();
await test("member leaves into a new solo team", async () => {
  const db = as("c");
  const b = writeBatch(db);
  b.set(doc(db, "teams/NEWC"), team("NEWC", "c"));
  b.update(doc(db, "teams/TA"), { members: ["a"] });
  b.update(doc(db, "users/c"), { team_id: "NEWC" });
  await assertSucceeds(b.commit());
});

await base();
await test("owner removes member into a new solo team", async () => {
  const db = as("a");
  const b = writeBatch(db);
  b.set(doc(db, "teams/NEWC"), team("NEWC", "c"));
  b.update(doc(db, "users/c"), { team_id: "NEWC" });
  b.update(doc(db, "teams/TA"), { members: ["a"] });
  await assertSucceeds(b.commit());
});
await test("member can't remove the owner", async () => {
  await base();
  const db = as("c");
  const b = writeBatch(db);
  b.set(doc(db, "teams/NEWA"), team("NEWA", "a"));
  b.update(doc(db, "users/a"), { team_id: "NEWA" });
  b.update(doc(db, "teams/TA"), { members: ["c"], owner: "c" });
  await assertFails(b.commit());
});

await base();
await test("owner toggles autofill", () => assertSucceeds(updateDoc(doc(as("a"), "teams/TA"), { autofill: true })));
await test("member can't toggle autofill", () => assertFails(updateDoc(doc(as("c"), "teams/TA"), { autofill: false })));
await test("no other collections", () => assertFails(setDoc(doc(as("a"), "demos/x"), { a: 1 })));

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
await env.cleanup();

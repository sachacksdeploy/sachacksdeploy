import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { fetchProfile } from "@/services/auth.service";

/**
 * Whether the signed-in participant has been accepted.
 *
 * A participant counts as accepted once `users/{uid}.team_id` has a value.
 * This one flag decides:
 *   · whether the Teams tab appears in the portal navbar
 *   · whether the /teams route can be opened
 *   · which Hacker Hub dashboard is shown (waiting on acceptance vs accepted)
 */

// Last known team_id per user, so the navbar doesn't flicker on every page
// change. It is still re-read from Firestore each time a page mounts.
const lastKnown = new Map<string, string | null>();

export function useAcceptance() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;
  // undefined = not known yet
  const [teamId, setTeamId] = useState<string | null | undefined>(() =>
    uid ? lastKnown.get(uid) : undefined,
  );

  useEffect(() => {
    if (authLoading) return;
    if (!uid) {
      setTeamId(null);
      return;
    }

    let active = true;
    setTeamId(lastKnown.has(uid) ? lastKnown.get(uid) : undefined);
    void fetchProfile(uid).then((profile) => {
      if (!active) return;
      const next = profile?.team_id ?? null;
      lastKnown.set(uid, next);
      setTeamId(next);
    });
    return () => { active = false; };
  }, [authLoading, uid]);

  return {
    accepted: Boolean(teamId),
    teamId: teamId ?? null,
    loading: authLoading || teamId === undefined,
  };
}

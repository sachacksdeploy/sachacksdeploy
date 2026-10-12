import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { isAdmin } from "@/services/admin.service";

/** Whether the signed-in user's `users/{uid}` document has `admin: true`. */
export function useAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (authLoading) return;
    if (!user) {
      setAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    void isAdmin(user.uid).then((allowed) => {
      if (!active) return;
      setAdmin(allowed);
      setLoading(false);
    });
    return () => { active = false; };
  }, [authLoading, user]);

  return { isAdmin: admin, loading: authLoading || loading };
}

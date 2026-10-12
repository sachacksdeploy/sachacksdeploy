/**
 * Authentication context.
 *
 * This file connects Firebase Authentication to React's component tree.
 * Components should use `useAuth()` rather than communicating directly
 * with the Firebase Auth SDK.
 *
 * Firebase replaces the old Supabase session listener that previously
 * lived here.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "@/integrations/firebase/client";

/**
 * Authentication state exposed to the rest of the application.
 *
 * `user` is Firebase's authenticated user object.
 *
 * `session` is retained temporarily for compatibility with components
 * that may still expect the old Supabase-shaped context. Firebase does
 * not have a direct equivalent to Supabase's Session object, so this
 * remains null until we determine whether anything in the application
 * actually depends on it.
 */
type AuthCtx = {
  session: null;
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
});

/**
 * Hook used by React components to access the current authentication state.
 */
export const useAuth = () => useContext(AuthContext);

/**
 * Provides Firebase authentication state to the entire React application.
 *
 * Firebase automatically persists the authenticated user's state in the
 * browser. `onAuthStateChanged` lets React react to sign-in, sign-out,
 * account creation, and restored sessions after a page reload.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /**
     * Subscribe to Firebase authentication changes.
     *
     * The callback runs once when Firebase determines the current
     * authentication state and again whenever that state changes.
     */
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    /**
     * Remove the Firebase listener when AuthProvider unmounts.
     * This prevents stale listeners from remaining active after navigation
     * or hot module replacement during development.
     */
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session: null,
        user,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
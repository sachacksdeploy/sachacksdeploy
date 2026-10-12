import { createContext, useContext } from "react";

export type AuthDialogMode = "signup" | "login" | "forgot" | "admin" | "contact";

export type RegistrationCtx = {
  open: boolean;
  mode: AuthDialogMode;
  /** Legacy helper: opening without a mode means "create an account". */
  setOpen: (v: boolean) => void;
  openAuth: (mode: AuthDialogMode) => void;
};

export const RegistrationContext = createContext<RegistrationCtx | null>(null);

export const useRegistrationDialog = (): RegistrationCtx => {
  const ctx = useContext(RegistrationContext);
  // Fallback keeps the app alive (e.g. during HMR) instead of crashing the tree.
  return ctx ?? { open: false, mode: "signup", setOpen: () => {}, openAuth: () => {} };
};

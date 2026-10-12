import { useEffect, useState } from "react";
import { signInAsAdmin } from "@/services/admin.service";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import type { AuthDialogMode } from "@/context/registration-context";
import {
  signUpSchema,
  loginSchema,
  forgotSchema,
  signUp,
  signIn,
  signInWithGoogle,
  sendPasswordReset,
  type SignUpValues,
  type LoginValues,
  type ForgotValues,
} from "@/services/auth.service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AuthDialogProps {
  open: boolean;
  mode: AuthDialogMode;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: AuthDialogMode) => void;
}

const COPY: Record<AuthDialogMode, { title: string; sub: string; cta: string }> = {
  signup: {
    title: "Create your account",
    sub: "Own your HackRx portal.",
    cta: "Register now",
  },
  login: {
    title: "Log in",
    sub: "Welcome back.",
    cta: "Log in",
  },
  forgot: {
    title: "Reset password",
    sub: "We'll email you a link to set a new password.",
    cta: "Send reset link",
  },
  admin: {
    title: "Admin log in",
    sub: "Organiser access to the HackRx control room.",
    cta: "Log in as admin",
  },
  contact: {
    title: "Contact us",
    sub: "Questions, sponsorship, or press — reach the HackRx team.",
    cta: "Close",
  },
};

const GoogleButton = ({ onClick, busy }: { onClick: () => void; busy: boolean }) => (
  <button type="button" className="venom-google" onClick={onClick} disabled={busy}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.67 4.1-5.5 4.1A6.2 6.2 0 1 1 12 5.8c1.77 0 2.96.75 3.64 1.4l2.48-2.4C16.5 3.3 14.45 2.4 12 2.4a9.6 9.6 0 1 0 0 19.2c5.54 0 9.2-3.9 9.2-9.38 0-.63-.07-1.1-.16-1.58H12z" />
    </svg>
    Continue with Google
  </button>
);

export const AuthDialog = ({ open, mode, onOpenChange, onModeChange }: AuthDialogProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const submitTriggers = useGlitchTriggers();
  const copy = COPY[mode];

  const signupForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });
  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const forgotForm = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (!open) {
      signupForm.reset();
      loginForm.reset();
      forgotForm.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const handleGoogle = async () => {
    setBusy(true);
    const error = await signInWithGoogle();
    setBusy(false);
    if (error === "") return; // popup closed by the user
    if (error) {
      toast({ title: "Google sign-in failed", description: error, variant: "destructive" });
      return;
    }
    onOpenChange(false);
    navigate("/dashboard");
  };

  const onSignUp = async (values: SignUpValues) => {
    setBusy(true);
    const error = await signUp(values);
    setBusy(false);
    if (error) {
      toast({ title: "Sign up failed", description: error, variant: "destructive" });
      return;
    }
    toast({
      title: "Account created",
      description: "Check your inbox to confirm your email, then log in.",
    });
    onModeChange("login");
  };

  const onLogin = async (values: LoginValues) => {
    if (mode === "admin") {
      setBusy(true);
      const error = await signInAsAdmin(values);
      setBusy(false);
      if (error) {
        toast({ title: "Login failed", description: error, variant: "destructive" });
        return;
      }
      toast({ title: "Welcome, admin" });
      onOpenChange(false);
      navigate("/admin");
      return;
    }

    setBusy(true);
    const error = await signIn(values);
    setBusy(false);
    if (error) {
      toast({ title: "Login failed", description: error, variant: "destructive" });
      return;
    }
    onOpenChange(false);
    navigate("/dashboard");
  };

  const onForgot = async (values: ForgotValues) => {
    setBusy(true);
    const error = await sendPasswordReset(values);
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't send reset link", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Reset link sent", description: "Check your email for the link." });
    onModeChange("login");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="venom-dialog sm:max-w-md">
        <div className="venom-blobs" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
        <DialogHeader>
          <DialogTitle className="venom-title text-3xl">{copy.title}</DialogTitle>
          <DialogDescription className="opacity-80">{copy.sub}</DialogDescription>
        </DialogHeader>

        {mode === "signup" && (
          <Form {...signupForm}>
            <form onSubmit={signupForm.handleSubmit(onSignUp)} className="space-y-4 pt-2">
              <FormField
                control={signupForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={signupForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" placeholder="At least 8 characters" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={signupForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" placeholder="Repeat your password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={busy} {...submitTriggers} className="venom-submit">
                {busy ? "Working..." : copy.cta}
              </Button>
              <GoogleButton onClick={handleGoogle} busy={busy} />
              <p className="venom-switch">
                Already have an account?{" "}
                <button type="button" onClick={() => onModeChange("login")}>Log in instead</button>
              </p>
            </form>
          </Form>
        )}

        {mode === "login" && (
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4 pt-2">
              <FormField
                control={loginForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email or username</FormLabel>
                    <FormControl>
                      <Input type="text" autoComplete="username" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" placeholder="Your password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={busy} {...submitTriggers} className="venom-submit">
                {busy ? "Working..." : copy.cta}
              </Button>
              <GoogleButton onClick={handleGoogle} busy={busy} />
              <p className="venom-switch">
                <button type="button" onClick={() => onModeChange("forgot")}>Forgot password?</button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => onModeChange("signup")}>Register now</button>
              </p>
            </form>
          </Form>
        )}

        {mode === "forgot" && (
          <Form {...forgotForm}>
            <form onSubmit={forgotForm.handleSubmit(onForgot)} className="space-y-4 pt-2">
              <FormField
                control={forgotForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={busy} {...submitTriggers} className="venom-submit">
                {busy ? "Working..." : copy.cta}
              </Button>
              <p className="venom-switch">
                <button type="button" onClick={() => onModeChange("login")}>Back to log in</button>
              </p>
            </form>
          </Form>
        )}

        {mode === "admin" && (
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4 pt-2">
              <FormField
                control={loginForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="username" placeholder="admin@hackrx.org" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" placeholder="Your password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={busy} {...submitTriggers} className="venom-submit">
                {busy ? "Working..." : copy.cta}
              </Button>
            </form>
          </Form>
        )}

        {mode === "contact" && (
          <div className="space-y-4 pt-2 venom-contact">
            <dl>
              <dt>Email</dt>
              <dd>contact@sachacks.io</dd>
              <dt>Sponsorship</dt>
              <dd>finance@sachacks.io</dd>
              <dt>Press</dt>
              <dd>contact@sachacks.io</dd>
              <dt>Where</dt>
              <dd>UC Davis, Davis, CA — November 15th, 2026</dd>
            </dl>
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              {...submitTriggers}
              className="venom-submit"
            >
              {copy.cta}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

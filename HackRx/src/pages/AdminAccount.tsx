import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PortalDecor } from "@/components/layout/PortalDecor";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdmin } from "@/hooks/useAdmin";
import {
  fetchProfile,
  updateProfile,
  updateEmail,
  updatePassword,
} from "@/services/auth.service";

const Account = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isAdmin } = useAdmin();
  const profileTriggers = useGlitchTriggers();
  const emailTriggers = useGlitchTriggers();
  const passwordTriggers = useGlitchTriggers();

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    fetchProfile(user.uid).then((p) => {
      setFullName(p?.full_name ?? "");
      setUsername(p?.username ?? "");
    });
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setBusy(true);
    const error = await updateProfile(user.uid, { full_name: fullName, username });
    setBusy(false);
    toast(
      error
        ? { title: "Couldn't save profile", description: error, variant: "destructive" }
        : { title: "Profile saved" },
    );
  };

  const saveEmail = async () => {
    setBusy(true);
    const error = await updateEmail(email);
    setBusy(false);
    toast(
      error
        ? { title: "Couldn't update email", description: error, variant: "destructive" }
        : { title: "Check your inbox", description: "Confirm the change from the email we sent." },
    );
  };

  const savePassword = async () => {
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setBusy(true);
    const error = await updatePassword(password);
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't update password", description: error, variant: "destructive" });
      return;
    }
    setPassword("");
    setConfirm("");
    toast({ title: "Password updated" });
  };

  return (
    <Layout portal>
      <section className="panel chapter portal">
        <PortalDecor />
        <span className="eyebrow">{isAdmin ? "Admin account" : "Account"}</span>
        <h1 className="chapter-title">{isAdmin ? "Organiser settings" : "Settings"}</h1>
        <p className="chapter-sub">{isAdmin ? "Manage your organiser identity and secure access." : "Update the details we use to reach you."}</p>

        <div className="portal-forms">
          <article className="portal-card">
            <h2>Profile</h2>
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="janedoe" />
            <Button className="venom-submit" disabled={busy} {...profileTriggers} onClick={saveProfile}>
              Save profile
            </Button>
          </article>

          <article className="portal-card">
            <h2>Email</h2>
            <Label htmlFor="email">Email address</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="venom-submit" disabled={busy} {...emailTriggers} onClick={saveEmail}>
              Update email
            </Button>
          </article>

          <article className="portal-card">
            <h2>Password</h2>
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button className="venom-submit" disabled={busy} {...passwordTriggers} onClick={savePassword}>
              Update password
            </Button>
          </article>
        </div>
      </section>
    </Layout>
  );
};

export default Account;
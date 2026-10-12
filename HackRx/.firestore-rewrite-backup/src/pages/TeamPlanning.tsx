import { useEffect, useState, type FormEvent } from "react";
import { CircleArrowRight, Crown, Hourglass, Send, TriangleAlert, X } from "lucide-react";
import { Layout, Amoeba } from "@/components/layout/Layout";
import { PortalDecor } from "@/components/layout/PortalDecor";
import { useAuth } from "@/context/auth-context";
import {
    MAX_TEAM_SIZE,
    fetchTeamPlanning,
    sendInvite,
    type IncomingInvite,
    type InviteResult,
    type TeamPerson,
} from "@/services/team.service";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Person = TeamPerson;

/** Email when readable, otherwise a short form of the uid. */
const displayName = (p: Person) => p.email ?? `User ${p.id.slice(0, 8)}…`;
const inviteLabel = (i: IncomingInvite) => i.ownerEmail ?? `Team ${i.teamId}`;

// Shared row + icon-button styles so both lists line up the same way.
const rowClass =
    "flex items-center justify-between gap-3 rounded-[3px] border border-white/10 bg-black/25 px-3 py-2";
const iconBtnClass =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const removeBtnClass = `${iconBtnClass} text-red-500 hover:bg-red-500/15 hover:text-red-400`;
const joinBtnClass = `${iconBtnClass} text-[var(--sv-cyan)] hover:bg-[var(--sv-cyan)]/15`;

const SectionBox = ({
    title,
    action,
    className = "",
    children,
}: {
    title: string;
    action?: React.ReactNode; // optional control pinned to the far right of the title row
    className?: string;
    children: React.ReactNode;
}) => (
    <article className={`portal-card min-w-0 ${className}`}>
        <header className="flex items-center justify-between gap-3">
            <h2 className="!font-sans !font-bold">{title}</h2>
            {action}
        </header>
        {children}
    </article>
);

const AUTOFILL_HINT =
    "If checked, random hackers will be added to your team until it has 3 members, if it isn't already full.";

const AutofillToggle = ({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <label className="flex shrink-0 cursor-pointer select-none items-center gap-2">
                Autofill
                <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-[var(--sv-cyan)]"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    aria-describedby="autofill-hint"
                />
                <span id="autofill-hint" className="sr-only">
                    {AUTOFILL_HINT}
                </span>
            </label>
        </TooltipTrigger>
        <TooltipContent
            side="bottom"
            align="end"
            className="max-w-[240px] rounded-[3px] border-2 border-black bg-[rgba(20,8,32,.95)] font-sans text-[13px] leading-snug text-[var(--cream)] shadow-[4px_4px_0_rgba(0,0,0,.45)]"
        >
            {AUTOFILL_HINT}
        </TooltipContent>
    </Tooltip>
);

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
    <p className="py-2 text-center">{children}</p>
);

const TeamSection = ({
    people,
    loading,
    onRemove,
    autofill,
    onAutofillChange,
}: {
    people: Person[];
    loading: boolean;
    onRemove: (id: string) => void;
    autofill: boolean;
    onAutofillChange: (checked: boolean) => void;
}) => (
    <SectionBox
        title="My Team"
        className="flex-1 !h-auto"
        action={<AutofillToggle checked={autofill} onChange={onAutofillChange} />}
    >
        {loading ? (
            <EmptyNote>Loading your team…</EmptyNote>
        ) : people.length === 0 ? (
            <EmptyNote>No teammates yet.</EmptyNote>
        ) : (
            <ul className="flex flex-col gap-2">
                {people.map((person) => (
                    <li key={person.id} className={rowClass}>
                        <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate" title={person.email ?? person.id}>
                                {displayName(person)}
                            </span>
                            {person.pending && (
                                <Hourglass
                                    className="h-4 w-4 shrink-0 text-[var(--sv-yellow)]"
                                    aria-label="Pending invitation"
                                >
                                    <title>Pending invitation</title>
                                </Hourglass>
                            )}
                        </span>

                        {person.owner ? (
                            // Same 32px slot as the remove button so the crown lines up with the red crosses.
                            <span className={`${iconBtnClass} text-[var(--sv-yellow)]`} title="Owner">
                                <Crown className="h-5 w-5" aria-label="Owner" />
                            </span>
                        ) : (
                            <button
                                type="button"
                                className={removeBtnClass}
                                title={person.pending ? "Cancel invitation" : "Remove member"}
                                aria-label={`${person.pending ? "Cancel invitation for" : "Remove"} ${displayName(person)}`}
                                onClick={() => onRemove(person.id)}
                            >
                                <X className="h-5 w-5" strokeWidth={3} />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        )}
    </SectionBox>
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Notice = { tone: "error" | "warning" | "success"; text: string };

const SendInviteSection = ({
    people,
    onInvite,
}: {
    people: Person[];
    onInvite: (email: string) => Promise<InviteResult>;
}) => {
    const [email, setEmail] = useState("");
    const [notice, setNotice] = useState<Notice | null>(null);
    const [sending, setSending] = useState(false);
    const full = people.length >= MAX_TEAM_SIZE;
    const error = notice && notice.tone !== "success" ? notice : null;

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (full || sending) return;
        const value = email.trim().toLowerCase();
        if (!EMAIL_RE.test(value)) return setNotice({ tone: "error", text: "Enter a valid email address." });
        if (people.some((p) => p.email?.toLowerCase() === value))
            return setNotice({ tone: "error", text: "That person is already on your team or invited." });

        setSending(true);
        setNotice(null);
        const result = await onInvite(value);
        setSending(false);
        if (result.status === "sent") {
            setEmail("");
            setNotice({ tone: "success", text: `Invite sent to ${value}.` });
        } else {
            setNotice({ tone: result.status, text: result.message });
        }
    };

    return (
        <SectionBox title="Invite Teammates" className="!h-auto">
            <form onSubmit={submit} className="flex items-center gap-2" noValidate>
                <label htmlFor="invite-email" className="sr-only">
                    Teammate email
                </label>
                <input
                    id="invite-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="teammate@email.com"
                    value={email}
                    onChange={(e) => {
                        setEmail(e.target.value);
                        if (notice) setNotice(null);
                    }}
                    disabled={full || sending}
                    aria-invalid={!!error}
                    aria-describedby={error ? "invite-email-error" : full ? "invite-full-note" : undefined}
                    className="h-10 min-w-0 flex-1 rounded-[3px] border px-3 text-sm placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={full || sending}
                    aria-busy={sending}
                    className={`${joinBtnClass} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
                    title={full ? "Team is full" : sending ? "Sending…" : "Send invite"}
                    aria-label="Send invite"
                >
                    <Send className={`h-5 w-5 ${sending ? "animate-pulse" : ""}`} />
                </button>
            </form>
            {full && (
                <p id="invite-full-note">
                    Your team is full ({MAX_TEAM_SIZE}/{MAX_TEAM_SIZE}, including pending invites). Remove someone
                    or cancel an invite to add another person.
                </p>
            )}
            {error?.tone === "warning" && (
                <p
                    id="invite-email-error"
                    role="alert"
                    className="flex items-start gap-2 rounded-[3px] border border-[var(--sv-yellow)]/40 bg-[var(--sv-yellow)]/10 px-3 py-2 !text-[var(--sv-yellow)]"
                >
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error.text}</span>
                </p>
            )}
            {error?.tone === "error" && (
                <p id="invite-email-error" role="alert" className="!text-red-400">
                    {error.text}
                </p>
            )}
            {notice?.tone === "success" && (
                <p role="status" className="!text-green-400">
                    {notice.text}
                </p>
            )}
        </SectionBox>
    );
};

const InviteSection = ({
    invites,
    loading,
    onDecline,
    onJoin,
}: {
    invites: IncomingInvite[];
    loading: boolean;
    onDecline: (teamId: string) => void;
    onJoin: (teamId: string) => void;
}) => (
    <SectionBox title="Incoming Invitations">
        {loading ? (
            <EmptyNote>Loading invitations…</EmptyNote>
        ) : invites.length === 0 ? (
            <EmptyNote>No pending invitations.</EmptyNote>
        ) : (
            <ul className="flex flex-col gap-2">
                {invites.map((invite) => (
                    <li key={invite.teamId} className={rowClass}>
                        <span className="min-w-0 truncate" title={`Team ${invite.teamId}`}>
                            {inviteLabel(invite)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                className={removeBtnClass}
                                title="Decline invite"
                                aria-label={`Decline invite from ${inviteLabel(invite)}`}
                                onClick={() => onDecline(invite.teamId)}
                            >
                                <X className="h-5 w-5" strokeWidth={3} />
                            </button>
                            <button
                                type="button"
                                className={joinBtnClass}
                                title="Leave current team and join"
                                aria-label={`Leave current team and join ${inviteLabel(invite)}`}
                                onClick={() => onJoin(invite.teamId)}
                            >
                                <CircleArrowRight className="h-6 w-6" />
                            </button>
                        </span>
                    </li>
                ))}
            </ul>
        )}
    </SectionBox>
);

const TeamPlanning = () => {
    const { user } = useAuth();

    // Pulled from users/{uid} (team_id, invitations) and teams/{id} (owner, members, pending, autofill).
    // Owner at top, followed by any pending, then members.
    const [people, setPeople] = useState<Person[]>([]);
    const [invites, setInvites] = useState<IncomingInvite[]>([]);
    const [teamId, setTeamId] = useState<string | null>(null);
    const [autofill, setAutofill] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;
        let active = true;
        setLoading(true);
        void fetchTeamPlanning(user.uid).then((data) => {
            if (!active) return;
            setTeamId(data?.teamId ?? null);
            setPeople(data?.people ?? []);
            setInvites(data?.invites ?? []);
            setAutofill(data?.autofill ?? false);
            setLoading(false);
        });
        return () => { active = false; };
    }, [user]);

    // Checks the accepted user list, then writes teams.pending + the invitee's invitations.
    const invitePerson = async (email: string): Promise<InviteResult> => {
        if (!user || !teamId)
            return { status: "error", message: "You need to be accepted onto a team before inviting people." };
        const result = await sendInvite(user.uid, teamId, email);
        if (result.status === "sent") {
            setPeople((prev) => {
                // Keep owner first, then pending invites, then confirmed members.
                const lastPending = prev.reduce((idx, p, i) => (p.owner || p.pending ? i : idx), -1);
                const next = [...prev];
                next.splice(lastPending + 1, 0, result.person);
                return next;
            });
        }
        return result;
    };
    // TODO: persist the autofill preference once the backend is wired up.
    // TODO: these only update the page for now; write them back to Firestore next.
    const removePerson = (id: string) =>
        setPeople((prev) => prev.filter((p) => p.id !== id));
    const declineInvite = (teamId: string) =>
        setInvites((prev) => prev.filter((i) => i.teamId !== teamId));
    const joinTeam = (teamId: string) => {
        // TODO: leave current team and join the inviting team via the backend.
        setInvites((prev) => prev.filter((i) => i.teamId !== teamId));
    };

    return (
        <Layout portal>
            <section className="panel chapter portal" style={{ "padding": 0 }}>
                <PortalDecor />
                <Amoeba tone="violet" size="sm" style={{ top: "18%", left: "6%", animationDelay: "-2s, -5s" }} />
                <Amoeba tone="gold" size="tiny" style={{ bottom: "18%", right: "8%", animationDelay: "-6s, -1s" }} />

                <div className="grid w-[86vw] grid-cols-1 items-stretch gap-6 text-left md:min-h-[72svh] md:grid-cols-2 md:gap-15">
                    <div className="flex min-w-0 flex-col gap-6">
                        <TeamSection
                            people={people}
                            loading={loading}
                            onRemove={removePerson}
                            autofill={autofill}
                            onAutofillChange={setAutofill}
                        />
                        {!loading && <SendInviteSection people={people} onInvite={invitePerson} />}
                    </div>
                    <InviteSection invites={invites} loading={loading} onDecline={declineInvite} onJoin={joinTeam} />
                </div>
            </section>
        </Layout>
    );
};

export default TeamPlanning;

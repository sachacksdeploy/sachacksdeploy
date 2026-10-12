import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Control, type FieldErrors } from "react-hook-form";
import { Layout } from "@/components/layout/Layout";
import { PortalDecor } from "@/components/layout/PortalDecor";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { fetchProfile } from "@/services/auth.service";
import {
  ACADEMIC_STANDINGS,
  ALREADY_APPLIED,
  AGE_RANGES,
  CODE_OF_CONDUCT_URL,
  DIETARY_NONE,
  DIETARY_OPTIONS,
  DIETARY_OTHER,
  ETHNICITIES,
  ETHNICITY_DECLINE,
  GENDERS,
  GENDER_SELF_DESCRIBE,
  HACKATHON_EXPERIENCE,
  HIGH_SCHOOL,
  INSTITUTIONS,
  INSTITUTION_OTHER,
  INTEREST_AREAS,
  LONG_ANSWER_MAX,
  MAX_MOTIVATIONS,
  MOTIVATIONS,
  REFERRAL_SOURCES,
  TEAM_STATUSES,
  TSHIRT_SIZES,
  applicationSchema,
  fetchApplicationStatus,
  followUpIssues,
  submitApplication,
  type ApplicationValues,
} from "@/services/application.service";

/** Multi-select questions hold a list of answers; everything else below is a string. */
type ListFieldName = "ethnicity" | "interests" | "motivations" | "dietary";
type TextFieldName = Exclude<keyof ApplicationValues, ListFieldName | "code_of_conduct">;

/** The form is answered one section at a time; `fields` are validated before moving on. */
const STEPS: { title: string; fields: (keyof ApplicationValues)[] }[] = [
  {
    title: "Basic information",
    fields: ["full_name", "phone", "age_range", "gender", "gender_self", "ethnicity"],
  },
  {
    title: "Education & background",
    fields: ["institution", "institution_other", "academic_standing", "high_school_case", "major"],
  },
  {
    title: "Hackathon experience & interests",
    fields: ["first_hackathon", "interests", "motivations", "resume_link", "github"],
  },
  {
    title: "Team & event logistics",
    fields: ["team_status", "tshirt_size", "dietary", "dietary_other"],
  },
  {
    title: "Final questions",
    fields: ["referral_source", "goals", "additional_info"],
  },
  {
    title: "Agreements & submission",
    fields: ["code_of_conduct", "signature"],
  },
];

const DEFAULT_VALUES: ApplicationValues = {
  full_name: "",
  phone: "",
  age_range: "",
  gender: "",
  gender_self: "",
  ethnicity: [],
  institution: "",
  institution_other: "",
  academic_standing: "",
  high_school_case: "",
  major: "",
  first_hackathon: "",
  interests: [],
  motivations: [],
  resume_link: "",
  github: "",
  code_of_conduct: false,
  signature: "",
  team_status: "",
  tshirt_size: "",
  dietary: [],
  dietary_other: "",
  referral_source: "",
  goals: "",
  additional_info: "",
};

/** Runs after React has painted the next frame, so a just-shown section is in the DOM. */
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

const QuestionTitle = ({ label, required }: { label: string; required?: boolean }) => (
  <FormLabel className="gform-title">
    {label}
    {required && <span className="gform-required" aria-hidden="true"> *</span>}
  </FormLabel>
);

type QuestionProps = {
  control: Control<ApplicationValues>;
  label: string;
  required?: boolean;
  /** Follow-up questions render inside the card of the answer that revealed them. */
  nested?: boolean;
  /** Follow-up questions revealed by this one's answer. */
  children?: ReactNode;
};

const QuestionCard = ({ nested, children }: { nested?: boolean; children: ReactNode }) => (
  <div className={nested ? "gform-followup" : "gform-q"}>{children}</div>
);

type TextQuestionProps = QuestionProps & {
  name: TextFieldName;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
};

const TextQuestion = ({
  control, name, label, required, nested, children, type = "text", autoComplete, placeholder = "Your answer",
}: TextQuestionProps) => (
  <QuestionCard nested={nested}>
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <QuestionTitle label={label} required={required} />
          <FormControl>
            <Input
              className="gform-input"
              type={type}
              autoComplete={autoComplete}
              placeholder={placeholder}
              aria-required={required || undefined}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
    {children}
  </QuestionCard>
);

const LongQuestion = ({ control, name, label, required, nested }: QuestionProps & { name: TextFieldName }) => (
  <QuestionCard nested={nested}>
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <QuestionTitle label={label} required={required} />
          <FormControl>
            <Textarea
              className="gform-input"
              rows={3}
              maxLength={LONG_ANSWER_MAX}
              placeholder="Your answer"
              aria-required={required || undefined}
              {...field}
            />
          </FormControl>
          <div className="gform-foot">
            <FormMessage />
            <span className="gform-count">{field.value.length} / {LONG_ANSWER_MAX}</span>
          </div>
        </FormItem>
      )}
    />
  </QuestionCard>
);

type ChoiceQuestionProps = QuestionProps & {
  name: TextFieldName;
  options: string[];
  /** Short answers (sizes, ranges) read better as a row of chips than a list. */
  chips?: boolean;
};

const ChoiceQuestion = ({ control, name, label, required, options, chips, children }: ChoiceQuestionProps) => (
  <QuestionCard>
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <QuestionTitle label={label} required={required} />
          <FormControl>
            <div
              className={chips ? "gform-chips" : "gform-options"}
              role="radiogroup"
              aria-label={label}
              aria-required={required || undefined}
            >
              {options.map((o) => (
                <label key={o} className={`gform-option${field.value === o ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name={field.name}
                    value={o}
                    checked={field.value === o}
                    onChange={() => field.onChange(o)}
                    onBlur={field.onBlur}
                  />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          </FormControl>
          <div className="gform-foot">
            <FormMessage />
            {!required && field.value && (
              <button type="button" className="gform-clear" onClick={() => field.onChange("")}>
                Clear selection
              </button>
            )}
          </div>
        </FormItem>
      )}
    />
    {children}
  </QuestionCard>
);

const DropdownQuestion = ({ control, name, label, required, options }: ChoiceQuestionProps) => (
  <QuestionCard>
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <QuestionTitle label={label} required={required} />
          <FormControl>
            <select className="gform-select" aria-required={required || undefined} {...field}>
              <option value="">Choose</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  </QuestionCard>
);

type CheckQuestionProps = QuestionProps & {
  name: ListFieldName;
  options: string[];
  /** Once this many are ticked, the remaining boxes are disabled. */
  max?: number;
  /** Answers that can't be combined with others ("None", "Prefer not to say"). */
  exclusive?: string[];
};

const CheckQuestion = ({ control, name, label, required, options, max, exclusive = [], children }: CheckQuestionProps) => (
  <QuestionCard>
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value: string[] = field.value;
        const toggle = (o: string, on: boolean) => {
          if (!on) return field.onChange(value.filter((v) => v !== o));
          // Ticking an exclusive answer clears the rest, and vice versa.
          if (exclusive.includes(o)) return field.onChange([o]);
          field.onChange([...value.filter((v) => !exclusive.includes(v)), o]);
        };
        return (
          <FormItem>
            <QuestionTitle label={label} required={required} />
            <FormControl>
              <div className="gform-options" role="group" aria-label={label}>
                {options.map((o) => {
                  const checked = value.includes(o);
                  const disabled = !checked && max !== undefined && value.length >= max;
                  return (
                    <label
                      key={o}
                      className={`gform-option${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => toggle(o, e.target.checked)}
                        onBlur={field.onBlur}
                      />
                      <span>{o}</span>
                    </label>
                  );
                })}
              </div>
            </FormControl>
            <div className="gform-foot">
              <FormMessage />
              {max !== undefined && (
                <span className="gform-count" aria-live="polite">{value.length} of {max} selected</span>
              )}
            </div>
          </FormItem>
        );
      }}
    />
    {children}
  </QuestionCard>
);

const SignupPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const submitTriggers = useGlitchTriggers();
  const [busy, setBusy] = useState(false);
  // Whether this account has applied yet; the form waits for the answer.
  const [status, setStatus] = useState<"checking" | "open" | "applied">("checking");
  const [step, setStep] = useState(0);
  // Sections already reached can be revisited from the step markers.
  const [furthest, setFurthest] = useState(0);
  const topRef = useRef<HTMLFormElement>(null);

  const form = useForm<ApplicationValues>({
    resolver: zodResolver(applicationSchema),
    defaultValues: DEFAULT_VALUES,
  });
  const gender = form.watch("gender");
  const institution = form.watch("institution");
  const standing = form.watch("academic_standing");
  const dietary = form.watch("dietary");

  useEffect(() => {
    if (!user) return;
    let active = true;
    void fetchApplicationStatus(user.uid).then((s) => {
      if (active) setStatus(s ? "applied" : "open");
    });
    void fetchProfile(user.uid).then((p) => {
      const name = p?.full_name || user.displayName;
      if (active && name && !form.getValues("full_name")) {
        form.setValue("full_name", name);
      }
    });
    return () => { active = false; };
  }, [user, form]);

  // An answer's error goes away as soon as that answer is edited.
  useEffect(() => {
    const subscription = form.watch((_, { name }) => {
      if (name) form.clearErrors(name);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // One application per hacker — resubmitting would overwrite a reviewed one.
  if (status === "applied") return <Navigate to="/dashboard" replace />;

  const isLast = step === STEPS.length - 1;

  const goTo = (next: number) => {
    setStep(next);
    setFurthest((f) => Math.max(f, next));
    afterPaint(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const showFirstError = () =>
    afterPaint(() => {
      const card = document.querySelector<HTMLElement>('.gform-q:has([aria-invalid="true"])');
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      // Radio and checkbox groups mark their wrapper invalid; focus the first box inside it.
      const invalid = card?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const target = invalid?.matches("input, textarea, select")
        ? invalid
        : invalid?.querySelector<HTMLElement>("input:not(:disabled)");
      target?.focus({ preventScroll: true });
    });

  /** Follow-up answers on this section that are required by an earlier answer. */
  const checkFollowUps = () => {
    const missing = followUpIssues(form.getValues()).filter((i) => STEPS[step].fields.includes(i.field));
    missing.forEach(({ field, message }) => form.setError(field, { type: "manual", message }));
    return missing.length === 0;
  };

  const onNext = async () => {
    let ok = await form.trigger(STEPS[step].fields);
    if (!checkFollowUps()) ok = false;
    if (ok) goTo(step + 1);
    else showFirstError();
  };

  const onSubmit = async (values: ApplicationValues) => {
    setBusy(true);
    const error = await submitApplication(values);
    if (error === ALREADY_APPLIED) {
      toast({ title: "Already applied", description: "Your application is already in. Check its status in the Hacker Hub." });
      navigate("/dashboard", { replace: true });
      return;
    }
    if (error) {
      setBusy(false);
      toast({ title: "Application not submitted", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Application submitted", description: "Your application is awaiting a decision." });
    navigate("/dashboard", { replace: true });
  };

  // Jump back to the first section that still has a problem.
  const onInvalid = (errors: FieldErrors<ApplicationValues>) => {
    const invalid = STEPS.findIndex((s) => s.fields.some((f) => errors[f]));
    if (invalid >= 0 && invalid !== step) setStep(invalid);
    showFirstError();
  };

  const control = form.control;

  return (
    <Layout portal>
      <section className="panel chapter portal apply">
        <PortalDecor />
        <span className="eyebrow">Application submission</span>
        <h1 className="chapter-title">Participant application</h1>

        {status === "checking" ? (
          <p className="gform-loading" role="status">Loading your application…</p>
        ) : (
          <Form {...form}>
            <form
              ref={topRef}
              className="gform"
              onSubmit={(e) => {
                // Enter in a text answer moves on rather than submitting half a form.
                if (isLast) return void form.handleSubmit(onSubmit, onInvalid)(e);
                e.preventDefault();
                void onNext();
              }}
              noValidate
            >
              <header className="gform-head">
                <div className="gform-head-row">
                  <h2>{STEPS[step].title}</h2>
                  <span className="gform-count">Section {step + 1} of {STEPS.length}</span>
                </div>
                <div
                  className="gform-progress"
                  role="progressbar"
                  aria-label="Application progress"
                  aria-valuemin={1}
                  aria-valuemax={STEPS.length}
                  aria-valuenow={step + 1}
                  aria-valuetext={`Section ${step + 1} of ${STEPS.length}`}
                >
                  <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
                </div>
                <ol className="gform-steps">
                  {STEPS.map((s, i) => (
                    <li key={s.title}>
                      <button
                        type="button"
                        className={i === step ? "is-current" : i <= furthest ? "is-done" : undefined}
                        disabled={i > furthest || busy}
                        aria-current={i === step ? "step" : undefined}
                        aria-label={`Section ${i + 1}: ${s.title}`}
                        title={s.title}
                        onClick={() => goTo(i)}
                      >
                        {i + 1}
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="gform-hint"><span className="gform-required">*</span> Indicates a required question</p>
              </header>

              <div className="gform-section" key={step}>
                {step === 0 && (
                  <>
                    <TextQuestion control={control} name="full_name" label="Full legal name" required autoComplete="name" />
                    <TextQuestion control={control} name="phone" label="Telephone number" type="tel" autoComplete="tel" placeholder="(530) 555-0123" />
                    <ChoiceQuestion control={control} name="age_range" label="Please indicate your age range" required options={AGE_RANGES} chips />
                    <ChoiceQuestion control={control} name="gender" label="Gender identity" options={GENDERS}>
                      {gender === GENDER_SELF_DESCRIBE && (
                        <TextQuestion control={control} name="gender_self" label="Please describe your gender identity" nested />
                      )}
                    </ChoiceQuestion>
                    <CheckQuestion
                      control={control}
                      name="ethnicity"
                      label="Race / ethnicity (select all that apply)"
                      options={ETHNICITIES}
                      exclusive={[ETHNICITY_DECLINE]}
                    />
                  </>
                )}

                {step === 1 && (
                  <>
                    <ChoiceQuestion control={control} name="institution" label="Which school or institution do you currently attend?" required options={INSTITUTIONS}>
                      {institution === INSTITUTION_OTHER && (
                        <TextQuestion control={control} name="institution_other" label="Please specify your school or institution" required nested autoComplete="organization" />
                      )}
                    </ChoiceQuestion>
                    <ChoiceQuestion control={control} name="academic_standing" label="What is your current academic standing?" required options={ACADEMIC_STANDINGS}>
                      {standing === HIGH_SCHOOL && (
                        <LongQuestion
                          control={control}
                          name="high_school_case"
                          label="As a high school applicant, please explain why you would be a strong fit for this event"
                          required
                          nested
                        />
                      )}
                    </ChoiceQuestion>
                    <TextQuestion control={control} name="major" label="What is your major or field of study?" required placeholder="Enter N/A if not applicable" />
                  </>
                )}

                {step === 2 && (
                  <>
                    <ChoiceQuestion control={control} name="first_hackathon" label="Will this be your first hackathon?" required options={HACKATHON_EXPERIENCE} />
                    <CheckQuestion control={control} name="interests" label="Which areas are of greatest interest to you? (select all that apply)" required options={INTEREST_AREAS} />
                    <CheckQuestion
                      control={control}
                      name="motivations"
                      label={`What do you most look forward to at SacHacks? (select up to ${MAX_MOTIVATIONS})`}
                      required
                      options={MOTIVATIONS}
                      max={MAX_MOTIVATIONS}
                    />
                    <TextQuestion
                      control={control}
                      name="resume_link"
                      label="Please provide a link to your résumé (e.g. Google Drive or Dropbox, with viewing access enabled)"
                      required
                      type="url"
                      placeholder="https://drive.google.com/..."
                    />
                    <TextQuestion control={control} name="github" label="GitHub profile link (if applicable)" type="url" placeholder="https://github.com/username" />
                  </>
                )}

                {step === 3 && (
                  <>
                    <ChoiceQuestion control={control} name="team_status" label="Would you prefer to be on a team or solo?" required options={TEAM_STATUSES} />
                    <ChoiceQuestion control={control} name="tshirt_size" label="What is your T-shirt size?" required options={TSHIRT_SIZES} chips />
                    <CheckQuestion
                      control={control}
                      name="dietary"
                      label="Do you have any dietary restrictions? (select all that apply)"
                      options={DIETARY_OPTIONS}
                      exclusive={[DIETARY_NONE]}
                    >
                      {dietary.includes(DIETARY_OTHER) && (
                        <TextQuestion control={control} name="dietary_other" label="Please specify your dietary restriction" required nested />
                      )}
                    </CheckQuestion>
                  </>
                )}

                {step === 4 && (
                  <>
                    <DropdownQuestion control={control} name="referral_source" label="How did you learn about SacHacks?" required options={REFERRAL_SOURCES} />
                    <LongQuestion control={control} name="goals" label="What do you hope to gain from this experience?" />
                    <LongQuestion control={control} name="additional_info" label="Is there anything else you would like us to know?" />
                  </>
                )}

                {step === 5 && (
                  <>
                    <div className="gform-q">
                      <FormField
                        control={control}
                        name="code_of_conduct"
                        render={({ field }) => (
                          <FormItem>
                            <QuestionTitle label="SacHacks Code of Conduct" required />
                            <p className="gform-hint">
                              <a href={CODE_OF_CONDUCT_URL} target="_blank" rel="noopener noreferrer">
                                Read the Code of Conduct
                              </a>
                            </p>
                            <FormControl>
                              <div className="gform-options" role="group" aria-label="SacHacks Code of Conduct">
                                <label className={`gform-option${field.value ? " is-selected" : ""}`}>
                                  <input
                                    type="checkbox"
                                    checked={field.value}
                                    onChange={(e) => field.onChange(e.target.checked)}
                                    onBlur={field.onBlur}
                                  />
                                  <span>I have read and agree to the SacHacks Code of Conduct.</span>
                                </label>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="gform-q">
                      <p className="gform-title">By typing your full name below, you agree to the following statements:</p>
                      <ul className="gform-list">
                        <li>
                          I authorise SacHacks to send me occasional emails regarding relevant events,
                          career opportunities, and community announcements.
                        </li>
                        <li>
                          I authorise SacHacks to share my résumé with sponsors who may be interested in
                          hiring me.
                        </li>
                        <li>
                          I understand that SacHacks does not guarantee employment, interviews, or any
                          further communication from its sponsors.
                        </li>
                      </ul>
                      <TextQuestion control={control} name="signature" label="Full name (electronic signature)" required nested placeholder="Type your full name" />
                    </div>
                  </>
                )}
              </div>

              <div className="gform-nav">
                {step > 0 && (
                  <button type="button" className="gform-back" disabled={busy} onClick={() => goTo(step - 1)}>
                    Back
                  </button>
                )}
                <Button type="submit" className="venom-submit" disabled={busy} {...submitTriggers}>
                  {isLast ? (busy ? "Submitting..." : "Submit application") : "Next"}
                </Button>
              </div>
              <p className="venom-switch">
                <button type="button" disabled={busy} onClick={() => navigate("/dashboard")}>Back to Hacker Hub</button>
              </p>
            </form>
          </Form>
        )}
      </section>
    </Layout>
  );
};

export default SignupPage;

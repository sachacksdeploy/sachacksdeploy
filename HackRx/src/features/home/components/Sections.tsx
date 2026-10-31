import { Amoeba, useRegistrationDialog } from "@/components/layout/Layout";
import { setRegisterHover } from "@/utils/effects";
import { useGlitchTriggers } from "@/hooks/useGlitchTriggers";
import { useScrollDissolve } from "@/hooks/useScrollDissolve";
import {
  comicCloudGrey,
  comicCloudOutline,
  comicStarYellow,
} from "@/assets/images";

const S = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* ------------------------------ decorations ------------------------------ */

type DecorItem = {
  src: string;
  kind: "cloud" | "star";
  tint?: string;
  style: React.CSSProperties;
};

/**
 * Backdrop art, comic-poster style: big flat cloud silhouettes hugging the
 * left / right page edges, with small crisp stars sprinkled between them.
 * Roughly a quarter of the clouds are tinted yellow, and a quarter of the
 * stars are white, so the layer never reads as one flat colour.
 */
const CLOUD_ART = [comicCloudGrey, comicCloudOutline];

const CLOUD_COUNT = 50;
const STAR_COUNT = 44;

const CLOUDS: DecorItem[] = Array.from({ length: CLOUD_COUNT }, (_, i) => {
  const right = i % 2 === 1;
  // mix of small / medium / very large silhouettes, like the poster reference
  const w = [30, 18, 40, 24, 34, 14, 46, 22, 28, 16][i % 10];
  const rot = [-8, 6, -3, 12, -14, 4, 9, -11][i % 8];
  const inset = [-12, -6, -18, 0, -9][i % 5];
  return {
    src: CLOUD_ART[i % 2],
    kind: "cloud",
    // every 4th cloud goes yellow → 25%
    tint: i % 4 === 2 ? "tint-yellow" : undefined,
    style: {
      top: `${1 + (i * 98) / CLOUD_COUNT + ((i % 3) - 1) * 0.6}%`,
      ...(right ? { right: `${inset}%` } : { left: `${inset}%` }),
      width: `${w}%`,
      rotate: `${rot}deg`,
      animationDelay: `${-(i % 9)}s`,
    },
  };
});

const STARS: DecorItem[] = Array.from({ length: STAR_COUNT }, (_, i) => ({
  src: comicStarYellow,
  kind: "star",
  // every 4th star goes white → 25%
  tint: i % 4 === 1 ? "tint-white" : undefined,
  style: {
    top: `${2 + (i * 96) / STAR_COUNT + ((i % 4) - 1.5) * 0.5}%`,
    left: i % 2 === 0 ? `${4 + ((i * 17) % 34)}%` : `${58 + ((i * 11) % 36)}%`,
    width: `${2.4 + (i % 4) * 1.3}%`,
    rotate: `${[-12, 9, -4, 16, 22, -19][i % 6]}deg`,
    animationDelay: `${-(i % 7)}s`,
  },
}));


const PageDecor = () => (
  <div className="page-decor" aria-hidden="true">
    {[...CLOUDS, ...STARS].map((d, i) => (
      <img
        key={i}
        src={d.src}
        alt=""
        className={`decor-${d.kind}${d.tint ? ` ${d.tint}` : ""}`}
        style={d.style}
        loading="lazy"
      />
    ))}
  </div>
);






/* --------------------------------- icons --------------------------------- */

const BrainIcon = (
  <svg className="icon" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 20c-16 0-26 12-26 26 0 12 7 19 7 26 0 3 3 5 6 5h26c3 0 6-2 6-5 0-7 7-14 7-26 0-14-10-26-26-26Z" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" />
    <path d="M40 38c-2 4-2 8 0 12M60 38c2 4 2 8 0 12" stroke="var(--crimson)" strokeWidth="3" {...S} />
  </svg>
);
const PulseIcon = (
  <svg className="icon" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="30" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" />
    <path d="M20 50 h12 l5 -13 l8 26 l6 -18 l5 13 h24" stroke="var(--violet)" strokeWidth="3.4" {...S} />
  </svg>
);
const DnaIcon = (
  <svg className="icon" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M35 15 Q65 30 35 50 Q65 70 35 85" stroke="var(--ink-black)" strokeWidth="3.4" {...S} />
    <path d="M65 15 Q35 30 65 50 Q35 70 65 85" stroke="var(--crimson)" strokeWidth="3.4" {...S} />
    <line x1="37" y1="22" x2="63" y2="22" stroke="var(--ink-black)" strokeWidth="3" />
    <line x1="37" y1="78" x2="63" y2="78" stroke="var(--ink-black)" strokeWidth="3" />
  </svg>
);
const AccessIcon = (
  <svg className="icon" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="30" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" />
    <circle cx="50" cy="34" r="6" fill="var(--crimson)" />
    <path d="M50 41 v10 M50 51 c-11 0-13 9-13 17 M50 51 c11 0 13 9 13 17" stroke="var(--crimson)" strokeWidth="3.4" {...S} />
  </svg>
);
const ShieldIcon = (
  <svg className="icon" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 12 L82 24 v26c0 20-14 31-32 38C32 81 18 70 18 50V24Z" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" {...S} />
    <path d="M50 34 v26 M37 47 h26" stroke="var(--crimson)" strokeWidth="3.4" {...S} />
  </svg>
);

/* --------------------------------- data ---------------------------------- */

const prizes = [
  { place: "1st Place", amount: "Best Translational Science", body: "For the team moving discovery to bedside fastest." },
  { place: "1st Place", amount: "Best Clinical Impact", body: "Best Clinical Science Prize — care that measurably improves outcomes." },
  { place: "1st Place", amount: "Best Biotech Innovation", body: "Hardware, wetware, and data pushed somewhere new." },
  { place: "1st Place", amount: "Health Equity Award", body: "For the build that widens access to care." },
  { place: "1st Place", amount: "Best Interdisciplinary Hack", body: "Best overall hack across disciplines." },
];

const timeline = [
  {
    date: "October 12", what: "Applications open", body: "Registration goes live — grab a spot before they run out.", icon: (
      <svg className="icon" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--ink-black)" strokeWidth="4" /><path d="M50 26 v26 l18 12" stroke="var(--ink-black)" strokeWidth="4" {...S} /></svg>
    )
  },
  {
    date: "November 8", what: "Applications close", body: "Last call — applications shut at end of day.", icon: (
      <svg className="icon" viewBox="0 0 100 100" aria-hidden="true"><circle cx="35" cy="38" r="12" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" /><circle cx="65" cy="38" r="12" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" /><path d="M18 78c2-14 10-22 17-22M82 78c-2-14-10-22-17-22" stroke="var(--ink-black)" strokeWidth="3.4" {...S} /></svg>
    )
  },
  {
    date: "November 15", what: "Hack!", body: "Day of the event", icon: (
      <svg className="icon" viewBox="0 0 100 100" aria-hidden="true"><rect x="20" y="30" width="60" height="42" rx="6" fill="none" stroke="var(--ink-black)" strokeWidth="3.4" /><path d="M35 46 l10 10 20 -20" stroke="var(--crimson)" strokeWidth="3.2" {...S} /></svg>
    )
  },
];

const sponsorTiers = [
  {
    key: "jubilee",
    label: "Jubilee",
    items: [
      { name: "M.S. Program of Medical Device Development Program", logo: "/sponsors/medical-device.png", url: "https://bme.ucdavis.edu/graduate/medical-device" },
      { name: "Abridge", logo: "/sponsors/abridge.png", url: "https://www.abridge.com/" },
    ],
  },
  {
    key: "platinum",
    label: "Platinum",
    items: [
      { name: "UC Davis College of Letters & Sciences", logo: "/sponsors/letters-sciences.png", url: "https://lettersandscience.ucdavis.edu/" },
      { name: "UC Davis Graduate School of Management MSBA", logo: "/sponsors/gsm-msba.png", url: "https://gsm.ucdavis.edu/master-science-business-analytics" },
      { name: "UC Davis Health Betty Irene Moore School of Nursing", logo: "/sponsors/nursing.png", url: "https://health.ucdavis.edu/nursing/" },
    ],
  },
  {
    key: "gold",
    label: "Gold",
    items: [
      { name: "NordVPN", logo: "/sponsors/nordvpn.svg", url: "https://nordvpn.com/" },
      { name: "UC Davis Department of Computer Science", logo: "/sponsors/computer-science.png", url: "https://cs.ucdavis.edu/" },
    ],
  },
];

const faqs = [
  { q: "When and where?", a: "Betty Irene Moore (Link Map) in Sacramento, CA. Date is Sunday, Novemeber 15th" },
  { q: "Who can attend?", a: "Any college student or recent graduate is welcome to participate in SacHacks!" },
  { q: "When is the application deadline?", a: "Friday, November 8th at 11:59pm" },
  { q: "What is a hackathon?", a: "A hackathon is a 24-hour event where students collaborate to build creative projects and compete for prizes." },
  { q: "What is the maximum team size?", a: "Teams should be of 1-3 members. No more than 3 allowed on a single team." },
];

const team = [
  { role: "President", name: "Daivik (Dave) Bhardwaj" },
  { role: "Vice-President & VP of Logistics", name: " Munneth Gill" },
  { role: "VP of Software", name: "Shlok Khare" },
  { role: "VP of Marketing", name: "Melissa Li" },
  { role: "Director of Logistics", name: "Shaffana Mustafa" },
  { role: "Director of Logistics", name: "Aditi Dantaluri" },
  { role: "Director of Software", name: "Vedant Chaudhary" },
  { role: "Director of Software", name: "Ryan Mathur" },
  { role: "Director of Software", name: "Jeremy Phan" },
  { role: "Director of Logistics", name: "Kartik Yedumbaka" },
  { role: "Director of Logistics", name: "Rigo Lemus" },
  { role: "Director of Logistics", name: "Maisie Wong" },

];


/* ------------------------------- components ------------------------------- */

const Chapter = ({ id, title, sub, children }: { id: string; title: string; sub: string; children?: React.ReactNode }) => (
  <section className="panel chapter" id={id}>
    {children}
    <Amoeba tone="violet" size="sm" style={{ top: "18%", left: "6%", animationDelay: "-2s, -5s" }} />
    <Amoeba tone="gold" size="tiny" style={{ bottom: "20%", right: "8%", animationDelay: "-7s, -2s" }} />
    <h2 className="chapter-title">{title}</h2>
    <p className="chapter-sub">{sub}</p>
  </section>
);

const CTAButton = () => {
  const { setOpen } = useRegistrationDialog();
  const triggers = useGlitchTriggers(setRegisterHover);
  return (
    <a
      href="#register"
      className="register-btn"
      {...triggers}
      onClick={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      <svg className="burst" viewBox="0 0 200 200" aria-hidden="true">
        <polygon
          points="100,2 112,35 142,15 138,50 172,42 155,72 190,78 160,98 190,118 155,124 172,154 138,146 142,181 112,161 100,194 88,161 58,181 62,146 28,154 45,124 10,118 40,98 10,78 45,72 28,42 62,50 58,15 88,35"
          fill="currentColor"
          stroke="#141414"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </svg>
      <span>Register<br />Now!</span>
    </a>
  );
};

const DISSOLVE_GROUPS = [
  { selector: ".content .panel", className: "panel-dissolve" },
  { selector: ".page-decor > *", className: "decor-dissolve", decor: true },
];



export const Content = () => {
  useScrollDissolve(DISSOLVE_GROUPS);
  const { openAuth } = useRegistrationDialog();

  return (
    <div className="content">
      <PageDecor />

      <section className="panel" id="intro">


        <div className="section-head">
          <p className="eyebrow">AI-Era Medical Hackathon</p>
          <span className="meta-label">Sunday, November 15 · In-Person</span>
        </div>
        <h2 className="h2">Diagnose the problem. Prescribe the fix.</h2>
        <p>
          We have diagnosed the problem: healthcare needs technologies, platforms, and workflows that
          accelerate translational medicine and make biomedical research more efficient, accessible,
          and impactful. What fix would you prescribe?
        </p>
      </section>

      <section className="panel" id="sponsors">
        <Amoeba tone="gold" size="sm" style={{ top: "14%", left: "3%", animationDelay: "-3s, -6s" }} />
        <p className="eyebrow">Sponsors</p>
        <h2 className="h2">Backed by builders.</h2>

        <div className="sponsor-pyramid">
          {sponsorTiers.map((tier) => (
            <div
              className={`sponsor-tier tier-${tier.key}`}
              key={tier.key}
              role="group"
              aria-label={`${tier.label} sponsors`}
            >
              <div className="tier-row">
                {tier.items.map((s) => (
                  <a className="sponsor-chip" key={s.name} href={s.url} target="_blank" rel="noopener noreferrer">
                    <img src={s.logo} alt={s.name} loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Chapter id="prizes" title="Track & Prizes" sub="Five first-place awards (prizes to be revealed soon)" />


      {prizes.map((p, i) => (
        <section className={`panel spotlight${i % 2 === 1 ? " flip" : ""}`} key={p.amount}>
          <div>
            <p className="spotlight-index">{String(i + 1).padStart(2, "0")}</p>
            <h3>{p.amount}</h3>
            <p className="spotlight-tag">{p.place}</p>
            <p>{p.body}</p>
          </div>
          <div className="spotlight-art">
            <svg className="icon" viewBox="0 0 100 100" aria-hidden="true">
              <path d="M50 8 L61 38 L93 38 L67 57 L77 88 L50 68 L23 88 L33 57 L7 38 L39 38 Z" fill="none" stroke="var(--crimson)" strokeWidth="3.4" strokeLinejoin="round" />
              <text x="50" y="60" textAnchor="middle" fontFamily="var(--comic-display)" fontSize="28" fill="var(--ink-black)">{i + 1}</text>
            </svg>
          </div>
        </section>
      ))}

      <section className="panel" id="timeline">


        <Amoeba tone="crimson" size="tiny" style={{ top: "12%", right: "6%", animationDelay: "-4s, -1s" }} />
        <div className="section-head">
          <p className="eyebrow">Timeline</p>
          <span className="meta-label">6 milestones</span>
        </div>
        <h2 className="h2">Your journey starts here.</h2>
        <ol className="timeline-road">
          {timeline.map((t) => (
            <li className="road-stop" key={t.what}>
              <div className="road-node">{t.icon}</div>
              <div className="road-card">
                <span className="date">{t.date}</span>
                <h3>{t.what}</h3>
                <p>{t.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel" id="faq">
        <Amoeba tone="violet" size="tiny" style={{ top: "10%", right: "3%", animationDelay: "-5s, -2s" }} />
        <p className="eyebrow">FAQ</p>
        <h2 className="h2">Questions, answered.</h2>
        {faqs.map((f, i) => (
          <details className="faq-item" key={f.q} open={i === 0}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section className="panel" id="team">
        <Amoeba tone="gold" size="tiny" style={{ bottom: "12%", left: "4%", animationDelay: "-1s, -7s" }} />
        <p className="eyebrow">SacHacks Staff</p>
        <h2 className="h2">The people behind the panel.</h2>

        <div className="people-marquee">
          <div className="people-track">
            {[...team, ...team].map((p, i) => (
              <div
                className="person-card"
                key={`${p.name}-${i}`}
                aria-hidden={i >= team.length ? true : undefined}
              >
                <span className="role">{p.role}</span>
                <h4>{p.name}</h4>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel cta-section" id="register">
        <Amoeba tone="crimson" size="md" style={{ top: "12%", left: "6%", animationDelay: "-4s, -2s" }} />
        <Amoeba tone="violet" size="sm" style={{ bottom: "14%", right: "8%", animationDelay: "-9s, -5s" }} />
        <p className="eyebrow" style={{ textAlign: "center" }}>Join the response team</p>
        <h2 className="h2">The world needs new heroes.<br />Will you answer?</h2>
        <p className="lead">One day. Endless possibilities. Build, innovate, heal.</p>
        <CTAButton />
      </section>

      <footer className="footer">
        <span>HackRx 2026</span>
        <nav className="footer-links" aria-label="Footer">
          <button type="button" onClick={() => openAuth("admin")}>Admin</button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => openAuth("contact")}>Contact us</button>
        </nav>
        <span>Building the future of healthcare, together.</span>
      </footer>
    </div>
  );
};

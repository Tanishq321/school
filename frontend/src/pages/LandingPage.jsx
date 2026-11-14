import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, CircleDot, MessageSquareText, Mic, MonitorUp, PenTool, PhoneOff, Users, Video } from 'lucide-react';
import LacquerCanvas from '../components/brand/LacquerCanvas.jsx';
import Armillary from '../components/brand/Armillary.jsx';
import { Avatar, Logo, Monogram } from '../components/ui/index.jsx';
import MemberCard from '../components/brand/MemberCard.jsx';
import { Rosette, WaveBand } from '../components/brand/Guilloche.jsx';
import { ThemeButton } from '../components/AppShell.jsx';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 0 → 1 as the element travels from entering the viewport to its centre. */
function useScrollProgress(ref) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      setP(Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75))));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

const CHAPTERS = [
  {
    n: 'I',
    title: 'A room for two.',
    body: 'Every lesson is one-to-one. The seat opposite the teacher holds exactly one student, and the server refuses anyone else.',
    side: 'right',
  },
  {
    n: 'II',
    title: 'Yours, entirely.',
    body: 'Classes run on infrastructure you own, from the media server to the relay. No outside video company sits between a teacher and a student.',
    side: 'left',
  },
  {
    n: 'III',
    title: 'Kept only with consent.',
    body: 'A lesson is recorded only when the student agrees, and the film stays private to the teacher until they choose to share it.',
    side: 'right',
  },
  {
    n: 'IV',
    title: 'Made for long sessions.',
    body: 'Each picture is sent at the size it is shown. Connections mend themselves. Sound cues are quiet. Nothing to install.',
    side: 'left',
  },
];
// Where each layer is fully visible, as fractions of the story's scroll.
const WINDOWS = [
  [0.19, 0.29],
  [0.41, 0.51],
  [0.63, 0.73],
  [0.85, 0.97],
];
const FADE = 0.045;

const SPEC = [
  ['Class size', 'One teacher, one student. Always. A private tutorial, never a crowd.'],
  ['Infrastructure', 'Your servers. Audio and video travel through your own media server and relay, never a third-party video service.'],
  ['Encryption', 'Every stream is encrypted in transit. We say exactly that, and no more.'],
  ['Security', 'Two-step sign-in, device control, automatic lockout and a complete audit trail.'],
  ['Devices', 'Any modern browser. Android and iOS apps from the same code.'],
  ['Teaching tools', 'A shared board with pen, shapes and text; presentation; chat; recording with consent.'],
  ['Authority', 'Admit, mute, remove and lock, decided by the teacher and enforced by the server.'],
  ['Records', 'Attendance, transcripts, private notes and a film of each lesson, kept on your servers.'],
];

/**
 * The scroll story. A tall section whose stage stays pinned to the viewport while you scroll
 * through it: the instrument turns and the camera travels, and four chapters cross-fade in turn.
 * Text layers are moved imperatively (no React re-render per frame); the 3D scene reads the same
 * progress value. With reduced motion the story becomes an ordinary, static page.
 */
function Story() {
  const sectionRef = useRef(null);
  const heroRef = useRef(null);
  const cueRef = useRef(null);
  const chapterRefs = useRef([]);
  const railRefs = useRef([]);
  const progress = useRef(0);
  const [still] = useState(reducedMotion);

  useEffect(() => {
    if (still) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / span));
      progress.current = p;
      // Hero: leaves as the story begins.
      const h = Math.min(1, p / 0.11);
      if (heroRef.current) {
        heroRef.current.style.opacity = String(1 - h);
        heroRef.current.style.transform = `translateY(${-h * 60}px)`;
        heroRef.current.style.pointerEvents = h > 0.5 ? 'none' : '';
      }
      if (cueRef.current) cueRef.current.style.opacity = String(Math.max(0, 1 - p / 0.04));
      CHAPTERS.forEach((_, i) => {
        const [a, b] = WINDOWS[i];
        const inn = Math.min(1, Math.max(0, (p - (a - FADE)) / FADE));
        const out = i === CHAPTERS.length - 1 ? 1 : Math.min(1, Math.max(0, ((b + FADE) - p) / FADE));
        const v = Math.min(inn, out);
        const node = chapterRefs.current[i];
        if (node) {
          node.style.opacity = String(v);
          node.style.transform = `translateY(${(1 - v) * (p < a ? 40 : -40)}px)`;
          node.style.visibility = v < 0.01 ? 'hidden' : 'visible';
        }
        railRefs.current[i]?.setAttribute('data-active', p >= a - FADE && p <= b + FADE ? 'true' : 'false');
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [still]);

  const getProgress = useCallback(() => progress.current, []);
  const goTo = (i) => {
    const el = sectionRef.current;
    const span = el.offsetHeight - window.innerHeight;
    const [a, b] = WINDOWS[i];
    window.scrollTo({ top: el.offsetTop + span * ((a + b) / 2), behavior: 'smooth' });
  };

  const header = (
    <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center px-6 py-6 sm:px-10">
      <Logo />
      <nav className="ml-auto flex items-center gap-1 text-sm sm:gap-2">
        <ThemeButton className="!text-hi/70 hover:!bg-hi/5 hover:!text-hi" />
        <Link viewTransition to="/login" className="rounded-full px-4 py-2 whitespace-nowrap text-hi/80 transition hover:text-hi">
          Sign in
        </Link>
        <Link viewTransition to="/register" data-sheen className="sheen hidden rounded-full border border-brass/40 px-5 py-2 whitespace-nowrap text-hi transition hover:border-brass sm:inline-flex">
          Create an account
        </Link>
      </nav>
    </header>
  );

  const hero = (
    <>
      <div className="hairline mb-6 w-48 sm:mb-10" />
      <h1 className="animate-reveal font-display text-[clamp(2.9rem,8.6vw,8.4rem)] leading-[0.92] font-normal tracking-[-0.025em]">
        The private
        <br />
        room.
      </h1>
      <p className="mt-6 max-w-lg text-[clamp(1rem,1.4vw,1.22rem)] leading-relaxed text-hi/70 sm:mt-9">
        Private one-to-one tutoring for families and institutions that expect discretion, clarity and calm. One teacher, one student, on servers you control.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-4 sm:mt-10">
        <Link
          to="/register"
          data-sheen
          className="sheen inline-flex h-13 items-center rounded-full bg-[linear-gradient(180deg,#a8864f_0%,#86663a_100%)] px-8 text-[15px] font-medium text-vellum shadow-[inset_0_1px_0_rgba(255,240,210,.35),0_14px_30px_-14px_rgba(110,83,44,.9)] transition hover:brightness-110"
        >
          Open your first room
        </Link>
        <Link viewTransition to="/login" className="text-[15px] text-hi/70 underline decoration-hi/25 underline-offset-[6px] transition hover:text-hi hover:decoration-brass">
          I already have an account
        </Link>
      </div>
    </>
  );

  if (still) {
    // Reduced motion: no pinning, no travel. The same content, laid out plainly.
    return (
      <section className="relative overflow-hidden">
        <LacquerCanvas />
        {header}
        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-6 pt-10 pb-24 sm:px-10 lg:grid-cols-[1.1fr_1fr]">
          <div>{hero}</div>
          <Armillary className="aspect-square w-full" idle />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl gap-x-16 gap-y-14 px-6 pb-24 sm:px-10 lg:grid-cols-2">
          {CHAPTERS.map((c) => (
            <ChapterText key={c.n} c={c} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="relative h-[520vh] max-sm:h-[440vh]" data-testid="story">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <LacquerCanvas />
        <Armillary className="!absolute inset-0" getProgress={getProgress} label="A brass armillary sphere, the emblem of scholarship, turning as you scroll" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ground/80 to-transparent sm:hidden" />
        <div className="relative flex h-full flex-col">
          {header}
          <div ref={heroRef} className="relative z-10 mx-auto mt-auto w-full max-w-7xl px-6 pb-[5vh] will-change-transform sm:px-10 sm:pb-[13vh]">
            <div className="max-w-2xl">{hero}</div>
          </div>
        </div>

        {CHAPTERS.map((c, i) => (
          <div
            key={c.n}
            ref={(el) => (chapterRefs.current[i] = el)}
            className={`invisible absolute inset-x-0 bottom-[10vh] z-10 mx-auto flex max-w-7xl px-6 opacity-0 will-change-transform sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:px-10 ${c.side === 'right' ? 'sm:justify-end' : 'sm:justify-start'}`}
          >
            <div className="relative max-w-md">
              {/* a soft veil of the page colour keeps the words legible over the brass */}
              <div className="pointer-events-none absolute -inset-x-16 -inset-y-14 -z-10 bg-[radial-gradient(closest-side,var(--ground)_35%,transparent)] opacity-80" />
              <ChapterText c={c} />
            </div>
          </div>
        ))}

        <nav className="absolute top-1/2 right-5 z-20 hidden -translate-y-1/2 flex-col gap-4 lg:flex" aria-label="Chapters">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.n}
              ref={(el) => (railRefs.current[i] = el)}
              data-active="false"
              onClick={() => goTo(i)}
              className="group flex items-center justify-end gap-3 font-display text-sm text-hi/35 transition data-[active=true]:text-brass"
              aria-label={`Chapter ${c.n}: ${c.title}`}
            >
              <span className="pointer-events-none rounded-full bg-ground/85 px-3 py-1 opacity-0 backdrop-blur transition group-hover:opacity-100">{c.title.replace(/\.$/, '')}</span>
              <span className="w-6 text-right italic">{c.n}</span>
            </button>
          ))}
        </nav>

        <div ref={cueRef} className="absolute bottom-7 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] tracking-[0.3em] text-hi/45 uppercase sm:flex">
          Scroll
          <span className="relative h-10 w-px overflow-hidden bg-hi/15">
            <span className="absolute inset-x-0 top-0 h-1/2 animate-[cue_2.2s_ease-in-out_infinite] bg-brass" />
          </span>
        </div>
      </div>
    </section>
  );
}

function ChapterText({ c }) {
  return (
    <article>
      <p className="font-display text-[1.6rem] text-brass italic">{c.n}</p>
      <div className="hairline mt-4 mb-7 w-24" />
      <h2 className="font-display text-[clamp(2.3rem,4.2vw,3.6rem)] leading-[1.02] font-normal">{c.title}</h2>
      <p className="mt-5 text-[17px] leading-[1.75] text-hi/70">{c.body}</p>
    </article>
  );
}

export default function LandingPage() {
  const stageRef = useRef(null);
  const progress = useScrollProgress(stageRef);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (progress > 0.55) setDrawn(true);
  }, [progress]);

  return (
    <div className="bg-ground text-hi">
      <div className="scroll-progress fixed inset-x-0 top-0 z-50 h-[2px] bg-[linear-gradient(90deg,#8d6c3b,#d8be8c)]" aria-hidden="true" />

      <Story />

      {/* ---------------------------------------------------------------- the product as the centrepiece */}
      <section className="relative px-4 pt-28 pb-28 sm:px-10" style={{ perspective: '1600px' }}>
        <div className="reveal mx-auto mb-16 max-w-3xl text-center">
          <p className="text-[11px] font-medium tracking-[0.3em] text-brass uppercase">The room</p>
          <h2 className="mt-5 font-display text-[clamp(2.4rem,4.5vw,3.6rem)] leading-[1.04] font-normal">The board in the centre, the two of you, nothing in the way.</h2>
        </div>
        <div
          ref={stageRef}
          className="mx-auto max-w-6xl will-change-transform"
          style={{
            transform: `rotateX(${(1 - progress) * 16}deg) scale(${0.9 + progress * 0.1})`,
            opacity: 0.35 + progress * 0.65,
            transformOrigin: '50% 0%',
          }}
        >
          <ProductStage drawn={drawn} />
        </div>
      </section>

      {/* ---------------------------------------------------------------- membership & security */}
      <section className="relative overflow-hidden border-y border-brass/15">
        <div className="drift pointer-events-none absolute top-1/2 -left-[420px] -translate-y-1/2" style={{ '--drift-from': '120px', '--drift-to': '-120px' }}>
          <Rosette size={1100} dense className="opacity-[0.16]" />
        </div>
        <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 py-28 sm:px-10 lg:grid-cols-[1fr_1.05fr]">
          <div className="reveal mx-auto w-full max-w-[460px]">
            <MemberCard user={{ id: '00000000a41c7e92', name: 'Eleanor Whitcombe', role: 'teacher', createdAt: '2026-01-01', twoFactor: { enabled: true } }} />
          </div>
          <div>
            <p className="reveal text-[11px] font-medium tracking-[0.3em] text-brass uppercase">Membership</p>
            <h2 className="reveal mt-5 font-display text-[clamp(2.4rem,4.5vw,3.6rem)] leading-[1.04] font-normal">
              Guarded like a <span className="foil italic">private bank.</span>
            </h2>
            <WaveBand className="rule-draw my-8 max-w-sm" />
            <dl className="reveal-stagger space-y-6 text-[17px] leading-relaxed text-hi/75">
              <div>
                <dt className="font-display text-xl text-hi">Two-step sign-in</dt>
                <dd className="mt-1">A password alone opens nothing. Each sign-in is confirmed with a code from the member’s own phone.</dd>
              </div>
              <div>
                <dt className="font-display text-xl text-hi">Every device, accounted for</dt>
                <dd className="mt-1">Members see where they are signed in and close any of them with one touch. Repeated wrong passwords lock the door.</dd>
              </div>
              <div>
                <dt className="font-display text-xl text-hi">Stewardship without intrusion</dt>
                <dd className="mt-1">Your administrators manage accounts and watch the system’s health. What is said in a lesson stays between teacher and student.</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- specification */}
      <section className="mx-auto max-w-5xl px-6 py-28 sm:px-10">
        <h2 className="reveal font-display text-[clamp(2.4rem,4.5vw,3.6rem)] leading-tight font-normal">Specification</h2>
        <div className="rule-draw mt-12 h-px bg-brass/30" />
        <dl>
          {SPEC.map(([k, v]) => (
            <div key={k} className="reveal grid gap-2 border-b border-brass/15 py-7 sm:grid-cols-[14rem_1fr] sm:gap-10">
              <dt className="font-display text-xl text-brass">{k}</dt>
              <dd className="text-[17px] leading-relaxed text-hi/75">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------------------------------------------------------- close */}
      <section className="relative overflow-hidden">
        <LacquerCanvas intensity={0.8} speed={0.6} />
        <div className="reveal relative mx-auto flex max-w-4xl flex-col items-center px-6 py-36 text-center">
          <Monogram size={64} />
          <p className="mt-10 font-display text-[clamp(2.8rem,6vw,5rem)] leading-[1.02] font-normal">Open your first room.</p>
          <p className="mt-6 max-w-md text-hi/65">An account takes a minute. Your first class can begin straight away.</p>
          <Link
            to="/register"
            data-sheen
            className="sheen mt-10 inline-flex h-13 items-center rounded-full bg-ink px-9 text-[15px] font-medium text-vellum shadow-[0_18px_40px_-18px_rgba(22,28,44,.6)] transition hover:bg-[#232b40] dark:bg-vellum dark:text-ink dark:shadow-[0_18px_40px_-18px_rgba(236,230,218,.6)] dark:hover:bg-white"
          >
            Create an account
          </Link>
        </div>
      </section>

      <footer className="border-t border-hi/[0.08]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-10 text-sm text-hi/50 sm:px-10">
          <Logo className="text-hi/80" />
          <span>Private one-to-one tutoring, on your own servers.</span>
          <nav className="ml-auto flex gap-6">
            <Link viewTransition to="/login" className="hover:text-hi">
              Sign in
            </Link>
            <Link viewTransition to="/register" className="hover:text-hi">
              Create an account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** A faithful, static rendition of the classroom, with the teacher's annotations drawing themselves in. */
function ProductStage({ drawn }) {
  const people = [
    { name: 'Meera Sen', host: true, speaking: true },
    { name: 'Arjun Kapoor' },
  ];
  const stroke = (len, delay) => ({
    strokeDasharray: len,
    strokeDashoffset: drawn ? 0 : len,
    transition: `stroke-dashoffset 1.4s cubic-bezier(.22,1,.36,1) ${delay}s`,
  });
  return (
    <div className="dark lacquer relative overflow-hidden rounded-[30px] border border-vellum/10 shadow-[0_60px_140px_-50px_rgba(0,0,0,.95),inset_0_1px_0_rgba(236,230,218,.06)]">
      <div className="flex items-center gap-3 px-5 py-4 text-sm">
        <Monogram size={24} />
        <span className="font-display text-lg">Calculus, session 7</span>
        <span className="ml-auto flex items-center gap-2 text-vellum/50">
          <span className="size-2 rounded-full bg-emerald-400" /> Good
        </span>
        <span className="text-vellum/50 tabular-nums">42:17</span>
      </div>
      <div className="grid gap-3 px-4 pb-4 md:grid-cols-[1fr_15rem]">
        <div className="space-y-3">
          {/* The board */}
          <div
            className="relative aspect-[16/9] overflow-hidden rounded-[18px] shadow-[inset_0_0_0_1px_rgba(154,116,64,.35)]"
            style={{ backgroundColor: '#f3efe6', backgroundImage: 'radial-gradient(rgba(27,37,61,.13) .9px, transparent 1.1px)', backgroundSize: '18px 18px' }}
          >
            <svg viewBox="0 0 800 450" className="absolute inset-0 h-full w-full">
              <text x="110" y="190" fontFamily="Bodoni Moda Variable, Didot, serif" fontStyle="italic" fontSize="74" fill="#1b253d">
                ∫
              </text>
              <text x="150" y="122" fontFamily="Bodoni Moda Variable, serif" fontStyle="italic" fontSize="26" fill="#1b253d">
                π
              </text>
              <text x="140" y="214" fontFamily="Bodoni Moda Variable, serif" fontStyle="italic" fontSize="26" fill="#1b253d">
                0
              </text>
              <text x="190" y="180" fontFamily="Bodoni Moda Variable, Didot, serif" fontStyle="italic" fontSize="58" fill="#1b253d">
                sin x dx
              </text>
              <text x="440" y="180" fontFamily="Bodoni Moda Variable, Didot, serif" fontSize="58" fontWeight="600" fill="#1b253d">
                = 2
              </text>
              <text x="190" y="260" fontFamily="Hanken Grotesk Variable, sans-serif" fontSize="22" fill="#5a5a5a">
                the area under one arch
              </text>
              {/* hand annotations */}
              <path d="M186 122 C 226 96, 342 98, 362 138 C 378 174, 310 200, 252 198 C 192 196, 156 156, 186 122 Z" fill="none" stroke="#9a7440" strokeWidth="3.2" strokeLinecap="round" style={stroke(520, 0.1)} />
              <path d="M600 300 C 580 250, 560 215, 528 196" fill="none" stroke="#8e2f28" strokeWidth="3.2" strokeLinecap="round" style={stroke(150, 0.7)} />
              <path d="M544 194 L 526 195 L 534 212" fill="none" stroke="#8e2f28" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={stroke(50, 1.1)} />
              <path d="M450 340 C 520 300, 600 300, 680 340" fill="none" stroke="#1b253d" strokeWidth="2.6" strokeLinecap="round" style={stroke(260, 1.2)} />
              <path d="M450 340 L 680 340" fill="none" stroke="#1b253d" strokeWidth="1.6" strokeDasharray="4 6" opacity={drawn ? 0.6 : 0} style={{ transition: 'opacity .8s 1.8s' }} />
              <text x="470" y="390" fontFamily="Hanken Grotesk Variable, sans-serif" fontSize="18" fill="#8e2f28" opacity={drawn ? 1 : 0} style={{ transition: 'opacity .8s 1.9s' }}>
                two halves, one each
              </text>
            </svg>
          </div>
          {/* Filmstrip */}
          <div className="flex justify-center gap-3">
            {people.map((p) => (
              <div
                key={p.name}
                className={`lamplight relative flex aspect-video w-[30%] max-w-[13rem] items-center justify-center rounded-[14px] ${p.speaking ? 'shadow-[0_0_0_2px_var(--color-brand-300),0_0_28px_-6px_rgba(216,190,140,.6)]' : 'shadow-[inset_0_0_0_1px_rgba(236,230,218,.07)]'}`}
              >
                <Avatar name={p.name} size={38} />
                <span className="absolute bottom-1.5 left-2.5 truncate text-[11px] text-vellum/85">{p.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Chat sheet */}
        <div className="hidden flex-col rounded-[18px] border border-vellum/[0.08] bg-night-2/80 p-4 text-[13px] md:flex">
          <div className="mb-3 flex gap-1 rounded-full bg-night/60 p-1 text-xs">
            <span className="flex-1 rounded-full py-1 text-center text-vellum/60">People 2</span>
            <span className="flex-1 rounded-full bg-vellum py-1 text-center text-ink">Chat</span>
          </div>
          {[
            ['Arjun', 'Why is it exactly 2?'],
            ['Meera Sen', 'Look at each half of the arch.'],
            ['Arjun', 'Oh. One plus one.'],
          ].map(([who, text]) => (
            <div key={text} className="pt-3">
              <p className={`font-semibold ${who === 'Meera Sen' ? 'text-brand-300' : 'text-vellum'}`}>{who}</p>
              <p className="text-vellum/80">{text}</p>
            </div>
          ))}
          <div className="mt-auto flex items-center gap-2 rounded-2xl border border-vellum/10 bg-night-3/70 px-3 py-2 text-vellum/40">
            <MessageSquareText size={13} /> Message Meera
          </div>
        </div>
      </div>
      {/* Dock */}
      <div className="flex justify-center pb-5">
        <div className="flex items-center gap-2 rounded-full border border-vellum/10 bg-night-2/70 p-2 backdrop-blur">
          {[Mic, Video, MonitorUp, PenTool, CircleDot, MessageSquareText, Users].map((Icon, i) => (
            <span key={i} className={`flex size-9 items-center justify-center rounded-full ${i === 3 ? 'bg-brand-300 text-ink' : 'bg-vellum/[0.07] text-vellum/80'}`}>
              <Icon size={15} strokeWidth={1.6} />
            </span>
          ))}
          <span className="ml-1 flex h-9 items-center gap-1.5 rounded-full bg-danger px-4 text-xs text-vellum">
            <PhoneOff size={14} /> Leave
          </span>
        </div>
      </div>
    </div>
  );
}

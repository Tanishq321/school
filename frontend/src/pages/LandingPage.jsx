import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDot, MessageSquareText, Mic, MonitorUp, PenTool, PhoneOff, Users, Video } from 'lucide-react';
import LacquerCanvas from '../components/brand/LacquerCanvas.jsx';
import { Avatar, Logo, Monogram } from '../components/ui/index.jsx';
import MemberCard from '../components/brand/MemberCard.jsx';
import { Rosette, WaveBand } from '../components/brand/Guilloche.jsx';

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

export default function LandingPage() {
  const stageRef = useRef(null);
  const progress = useScrollProgress(stageRef);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (progress > 0.55) setDrawn(true);
  }, [progress]);

  return (
    <div className="dark bg-night text-vellum">
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative flex min-h-[100svh] flex-col overflow-hidden">
        <LacquerCanvas />
        <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center px-6 py-6 sm:px-10">
          <Logo />
          <nav className="ml-auto flex items-center gap-2 text-sm">
            <Link viewTransition to="/login" className="rounded-full px-4 py-2 whitespace-nowrap text-vellum/80 transition hover:text-vellum">
              Sign in
            </Link>
            <Link viewTransition to="/register" data-sheen className="sheen hidden rounded-full border border-brand-300/40 px-5 py-2 whitespace-nowrap text-vellum transition hover:border-brand-300 sm:inline-flex">
              Create an account
            </Link>
          </nav>
        </header>

        <div className="relative z-10 mx-auto mt-auto w-full max-w-7xl px-6 pb-[12vh] sm:px-10">
          <div className="hairline mb-10 w-48" />
          <h1 className="animate-reveal font-display text-[clamp(3.6rem,9.5vw,9rem)] leading-[0.92] font-normal tracking-[-0.025em]">
            The private
            <br />
            room.
          </h1>
          <p className="mt-10 max-w-xl text-[clamp(1.05rem,1.4vw,1.25rem)] leading-relaxed text-vellum/70">
            Private one-to-one tutoring for families and institutions that expect discretion, clarity and calm. One teacher, one student, on servers you control.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/register"
              data-sheen
              className="sheen inline-flex h-13 items-center rounded-full bg-[linear-gradient(180deg,#a8864f_0%,#86663a_100%)] px-8 text-[15px] font-medium text-vellum shadow-[inset_0_1px_0_rgba(255,240,210,.35),0_14px_30px_-14px_rgba(110,83,44,.9)] transition hover:brightness-110"
            >
              Open your first room
            </Link>
            <Link viewTransition to="/login" className="text-[15px] text-vellum/70 underline decoration-vellum/25 underline-offset-[6px] transition hover:text-vellum hover:decoration-brand-300">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the product as the centrepiece */}
      <section className="relative px-4 pt-10 pb-28 sm:px-10" style={{ perspective: '1600px' }}>
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
        <p className="mx-auto mt-10 max-w-md text-center text-sm text-vellum/50">The lesson as your student sees it: the board in the centre, the two of you, nothing in the way.</p>
      </section>

      {/* ---------------------------------------------------------------- editorial */}
      <section className="mx-auto grid max-w-7xl gap-x-16 gap-y-20 px-6 py-24 sm:px-10 lg:grid-cols-2">
        <Chapter title="A room for two." body="Every lesson is one-to-one. The seat opposite the teacher holds exactly one student, and the server refuses anyone else: no crowding, no strangers, no distractions." />
        <Chapter title="Yours, entirely." body="Classes run on infrastructure you own, from the media server to the relay. No outside video company sits between a teacher and a student, and the sessions answer only to you." />
        <Chapter title="Made for long sessions." body="Each picture is sent at the size it is shown. Connections mend themselves after a dropped network. Sound cues are quiet. Shortcuts keep hands on the material, not the interface." />
        <Chapter title="Nothing to install." body="It opens in the browser on a laptop, tablet or phone. Your student follows the invitation, and is let straight in." />
      </section>

      {/* ---------------------------------------------------------------- membership & security */}
      <section className="relative overflow-hidden border-y border-brand-300/10">
        <Rosette size={1100} dense className="pointer-events-none absolute top-1/2 -left-[420px] -translate-y-1/2 opacity-[0.16]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 py-28 sm:px-10 lg:grid-cols-[1fr_1.05fr]">
          <div className="mx-auto w-full max-w-[460px]">
            <MemberCard user={{ id: '00000000a41c7e92', name: 'Eleanor Whitcombe', role: 'teacher', createdAt: '2026-01-01', twoFactor: { enabled: true } }} />
          </div>
          <div>
            <p className="text-[11px] font-medium tracking-[0.3em] text-brand-300/90 uppercase">Membership</p>
            <h2 className="mt-5 font-display text-[clamp(2.4rem,4.5vw,3.6rem)] leading-[1.04] font-normal">
              Guarded like a <span className="foil italic">private bank.</span>
            </h2>
            <WaveBand className="my-8 max-w-sm" />
            <dl className="space-y-6 text-[17px] leading-relaxed text-vellum/75">
              <div>
                <dt className="font-display text-xl text-vellum">Two-step sign-in</dt>
                <dd className="mt-1">A password alone opens nothing. Each sign-in is confirmed with a code from the member’s own phone.</dd>
              </div>
              <div>
                <dt className="font-display text-xl text-vellum">Every device, accounted for</dt>
                <dd className="mt-1">Members see where they are signed in and close any of them with one touch. Repeated wrong passwords lock the door.</dd>
              </div>
              <div>
                <dt className="font-display text-xl text-vellum">Stewardship without intrusion</dt>
                <dd className="mt-1">Your administrators manage accounts and watch the system’s health. What is said in a lesson stays between teacher and student.</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- specification */}
      <section className="mx-auto max-w-5xl px-6 py-24 sm:px-10">
        <h2 className="font-display text-[clamp(2.4rem,4.5vw,3.6rem)] leading-tight font-normal">Specification</h2>
        <dl className="mt-12 border-t border-brand-300/25">
          {SPEC.map(([k, v]) => (
            <div key={k} className="grid gap-2 border-b border-brand-300/15 py-7 sm:grid-cols-[14rem_1fr] sm:gap-10">
              <dt className="font-display text-xl text-brand-300">{k}</dt>
              <dd className="text-[17px] leading-relaxed text-vellum/75">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------------------------------------------------------- close */}
      <section className="relative overflow-hidden">
        <LacquerCanvas intensity={0.8} speed={0.6} />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 py-36 text-center">
          <Monogram size={64} />
          <p className="mt-10 font-display text-[clamp(2.8rem,6vw,5rem)] leading-[1.02] font-normal">Open your first room.</p>
          <p className="mt-6 max-w-md text-vellum/65">An account takes a minute. Your first class can begin straight away.</p>
          <Link
            to="/register"
            data-sheen
            className="sheen mt-10 inline-flex h-13 items-center rounded-full bg-vellum px-9 text-[15px] font-medium text-ink shadow-[0_18px_40px_-18px_rgba(236,230,218,.6)] transition hover:bg-white"
          >
            Create an account
          </Link>
        </div>
      </section>

      <footer className="border-t border-vellum/[0.07]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-10 text-sm text-vellum/50 sm:px-10">
          <Logo className="text-vellum/80" />
          <span>Self-hosted live classrooms.</span>
          <nav className="ml-auto flex gap-6">
            <Link viewTransition to="/login" className="hover:text-vellum">
              Sign in
            </Link>
            <Link viewTransition to="/register" className="hover:text-vellum">
              Create an account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Chapter({ title, body }) {
  return (
    <article>
      <div className="hairline mb-8 w-24" />
      <h3 className="font-display text-[clamp(2rem,3.4vw,2.9rem)] leading-[1.05] font-normal">{title}</h3>
      <p className="mt-5 max-w-lg text-[17px] leading-[1.75] text-vellum/70">{body}</p>
    </article>
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
    <div className="lamplight relative overflow-hidden rounded-[30px] border border-vellum/10 shadow-[0_60px_140px_-50px_rgba(0,0,0,.95),inset_0_1px_0_rgba(236,230,218,.06)]">
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

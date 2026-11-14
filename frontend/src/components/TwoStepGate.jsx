import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Rosette } from './brand/Guilloche.jsx';

/** Shown to an administrator whose account has no second step: the console stays closed until it does. */
export default function TwoStepGate() {
  return (
    <article className="lamplight elevated relative mx-auto mt-6 max-w-2xl overflow-hidden rounded-[28px] p-10 text-hi sm:p-12" data-testid="two-step-gate">
      <Rosette size={460} dense className="pointer-events-none absolute -top-36 -right-40 opacity-[0.22]" />
      <span className="relative flex size-12 items-center justify-center rounded-full border border-brass/40 text-brass">
        <ShieldCheck size={22} strokeWidth={1.4} />
      </span>
      <p className="relative mt-8 text-[11px] font-medium tracking-[0.28em] text-brass uppercase">Administration</p>
      <h1 className="relative mt-3 font-display text-[2.4rem] leading-[1.05]">The console opens with two-step sign-in.</h1>
      <p className="relative mt-4 max-w-lg text-hi/70">
        The console reaches every account in the house. Before it opens, add an authenticator app to your account, so a stolen password alone can never reach it.
      </p>
      <Link
        to="/profile#two-step"
        viewTransition
        className="sheen relative mt-9 inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(180deg,#a8864f_0%,#86663a_100%)] px-6 text-[15px] font-medium text-vellum shadow-[inset_0_1px_0_rgba(255,240,210,.35),0_10px_24px_-14px_rgba(110,83,44,.9)] transition hover:brightness-110"
      >
        Set up two-step sign-in <ArrowRight size={17} strokeWidth={1.6} />
      </Link>
    </article>
  );
}

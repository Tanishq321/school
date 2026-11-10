import { useEffect, useRef, useState } from 'react';
import { Check, CircleDot, Clock, ShieldCheck, Square, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Modal } from '../ui/index.jsx';
import { fmtClock } from '../../utils/format.js';

function useSince(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  return iso ? now - new Date(iso).getTime() : 0;
}

/**
 * The red lamp. Shown to everyone while recording, with the running time; participants see
 * whether they personally are included and can change it; the host sees who has agreed.
 */
export function RecIndicator({ state, client, isHost, toast }) {
  const rec = state.recording;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const elapsed = useSince(rec?.active ? rec.startedAt : null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (!rec?.active) return null;
  const mine = rec.myConsent;
  const consents = state.recordingConsents || [];
  const counts = consents.reduce((a, c) => ({ ...a, [c.decision]: (a[c.decision] || 0) + 1 }), {});
  const change = (accept) =>
    client
      .setRecordingConsent(accept)
      .then(() => toast(accept ? 'You are included in the recording' : 'You are no longer being recorded'))
      .catch((e) => toast(e.message, { tone: 'error' }));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-danger/40 bg-danger/15 py-1 pr-3 pl-2 text-[12px] font-semibold tracking-[0.14em] text-[#f3b1aa] uppercase"
        aria-label="Recording in progress"
        aria-expanded={open}
        data-testid="rec-indicator"
      >
        <span className="relative flex size-2.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-danger opacity-60 [animation-duration:2s]" />
          <span className="relative size-2.5 rounded-full bg-[#e0574c]" />
        </span>
        Rec <span className="font-normal tracking-normal tabular-nums">{fmtClock(elapsed)}</span>
        {!isHost && mine && mine !== 'pending' && (
          <span className={`ml-1 rounded-full px-1.5 py-px text-[10px] tracking-wider ${mine === 'accepted' ? 'bg-vellum/15 text-vellum' : 'bg-black/30 text-vellum/70'}`}>
            {mine === 'accepted' ? 'Included' : 'Not you'}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-40 w-[300px] rounded-2xl border border-night-line bg-night-2/95 p-4 text-sm text-vellum shadow-2xl backdrop-blur-xl sm:left-0 sm:right-auto">
          <p className="font-display text-lg">Recording</p>
          <p className="mt-1 text-xs text-slate-400">Started by {rec.startedBy}. Only people who agreed are captured.</p>
          {isHost ? (
            <>
              <div className="mt-4 flex gap-4 text-xs text-slate-300">
                <span>{counts.accepted || 0} included</span>
                <span>{counts.declined || 0} declined</span>
                <span>{counts.pending || 0} deciding</span>
              </div>
              <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
                {consents.map((c) => (
                  <li key={c.userId} className="flex items-center gap-2">
                    {c.decision === 'accepted' ? <Check size={14} className="text-brand-300" /> : c.decision === 'declined' ? <X size={14} className="text-slate-500" /> : <Clock size={14} className="text-slate-500" />}
                    <span className={c.decision === 'accepted' ? '' : 'text-slate-400'}>{c.name}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-slate-300">
                {mine === 'accepted' ? 'Your voice and camera are included.' : 'You are not being recorded. Your voice and camera are left out.'}
              </p>
              <Button size="sm" variant="secondary" onClick={() => change(mine !== 'accepted')} className="w-full">
                {mine === 'accepted' ? 'Stop recording me' : 'Include me'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Host: the record button in the instrument panel. */
export function RecordButton({ state, client, toast, ToolButton }) {
  const { config } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = state.recording;
  if (!rec?.available && !rec?.active) return null;
  const start = async () => {
    setBusy(true);
    try {
      await client.startRecording();
      setConfirm(false);
    } catch (e) {
      toast(e.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const stop = () => client.stopRecording().catch((e) => toast(e.message, { tone: 'error' }));
  return (
    <>
      <ToolButton
        onClick={() => (rec.active ? stop() : setConfirm(true))}
        label={rec.active ? 'Stop recording' : 'Record this class'}
        Icon={rec.active ? Square : CircleDot}
        active={rec.active}
        danger={rec.active}
      />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Record this class?">
        <div className="space-y-4 text-[15px] text-ink-2 dark:text-slate-300">
          <p>Your student is told, sees the red lamp, and is asked for consent. They are not captured until they agree, and can change their mind at any time.</p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2.5">
              <ShieldCheck size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-brand-500" /> Recorded on this server only, private to you until you share it.
            </li>
            <li className="flex gap-2.5">
              <Clock size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-brand-500" />
              Kept for {config.recording?.retentionDays ?? 30} days; stops on its own after {Math.round((config.recording?.maxMinutes ?? 240) / 60)} hours.
            </li>
          </ul>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Not now
          </Button>
          <Button onClick={start} loading={busy} className="!bg-none !bg-danger !shadow-none hover:!bg-danger-600">
            <CircleDot size={16} strokeWidth={1.8} /> Begin recording
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Participant: the consent request. It has to be answered; nothing of theirs is captured meanwhile. */
export function ConsentDialog({ state, client, onLeave, toast }) {
  const rec = state.recording;
  const [busy, setBusy] = useState(null);
  if (!rec?.active || rec.myConsent !== 'pending' || state.self?.isHost) return null;
  const answer = async (accept) => {
    setBusy(accept ? 'yes' : 'no');
    try {
      await client.setRecordingConsent(accept);
    } catch (e) {
      toast(e.message, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="alertdialog" aria-modal="true" aria-labelledby="consent-title" data-testid="consent-dialog">
      <div className="animate-fade-up lamplight relative w-full overflow-hidden rounded-t-[28px] p-8 text-vellum shadow-2xl sm:max-w-[460px] sm:rounded-[28px]">
        <div className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(216,190,140,.18)]" />
        <span className="relative flex size-12 items-center justify-center rounded-full border border-danger/40 bg-danger/15">
          <span className="size-3 animate-pulse rounded-full bg-[#e0574c]" />
        </span>
        <h2 id="consent-title" className="relative mt-6 font-display text-[2rem] leading-tight">This class is being recorded</h2>
        <p className="relative mt-3 text-vellum/70">
          {rec.startedBy} would like to record. Your voice and camera are only captured if you agree, and you can change your mind at any time from the red lamp at the top.
        </p>
        <div className="relative mt-8 grid gap-2.5">
          <Button size="lg" onClick={() => answer(true)} loading={busy === 'yes'} disabled={Boolean(busy)} data-testid="consent-accept">
            Include me
          </Button>
          <button
            onClick={() => answer(false)}
            disabled={Boolean(busy)}
            className="h-12 rounded-full border border-vellum/15 text-[15px] text-vellum/90 transition hover:border-brand-300/50 disabled:opacity-50"
            data-testid="consent-decline"
          >
            {busy === 'no' ? 'One moment…' : 'Stay, but don’t record me'}
          </button>
          <button onClick={onLeave} className="h-11 text-sm text-vellum/55 transition hover:text-vellum">
            Leave the class
          </button>
        </div>
      </div>
    </div>
  );
}

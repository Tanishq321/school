import { useState } from 'react';
import { Check, Crown, Lock, Mic, MicOff, MoreHorizontal, Video, VideoOff, WifiOff, X } from 'lucide-react';
import { Avatar, Toggle } from '../ui/index.jsx';

function HostMenu({ p, onMute, onRemove }) {
  const [open, setOpen] = useState(false);
  const run = (fn) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded-full p-1.5 text-slate-300 hover:bg-night-line hover:text-vellum" aria-label={`Actions for ${p.name}`} aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={17} strokeWidth={1.6} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-2xl border border-night-line bg-night-2 py-1 text-sm shadow-2xl">
          {p.audio && (
            <button role="menuitem" onClick={run(onMute)} className="block w-full px-4 py-2.5 text-left hover:bg-night-3">
              Mute
            </button>
          )}
          <button role="menuitem" onClick={run(onRemove)} className="block w-full px-4 py-2.5 text-left text-red-300 hover:bg-night-3">
            Remove from class
          </button>
        </div>
      )}
    </div>
  );
}

/** One-to-one: the teacher, their student, and (for the teacher) anyone knocking. */
export default function ParticipantsPanel({ client, state, self, participants, waiting, isHost, toastError }) {
  const [busy, setBusy] = useState(null);
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toastError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const meeting = state.meeting || {};
  const everyone = [self, ...participants].filter(Boolean).sort((a, b) => b.isHost - a.isHost);
  const seatTaken = participants.some((p) => !p.isHost);
  const perms = meeting.permissions || {};
  const setPerm = (key, value) => act(key, () => client.setPermissions({ [key]: value }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isHost && (
        <details className="group mx-4 mb-2 rounded-2xl border border-night-line bg-night-3/60 open:pb-4" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-vellum marker:hidden">
            Class controls
            <span className="text-xs text-slate-400 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="space-y-3.5 px-4">
            <Toggle
              checked={Boolean(perms.allowScreenShare)}
              onChange={(v) => setPerm('allowScreenShare', v)}
              label="Student may share their screen"
              description="One of you presents at a time. You can always take over."
            />
            <Toggle checked={Boolean(perms.allowDrawing)} onChange={(v) => setPerm('allowDrawing', v)} label="Student may draw on the board" />
            <Toggle checked={perms.chatMode !== 'host'} onChange={(v) => setPerm('chatMode', v ? 'everyone' : 'host')} label="Student may chat" />
            <Toggle
              checked={Boolean(meeting.locked)}
              onChange={(v) => act('lock', () => client.setLocked(v))}
              label="Lock the room"
              description="Nobody else can ask to join. Your student can still reconnect."
            />
            {state.screenSharer && state.screenSharer !== self?.userId && (
              <button onClick={() => act('stopScreen', () => client.hostStopScreen())} className="w-full rounded-full border border-night-line py-2 text-sm hover:border-brand-500/60">
                Stop the student’s presentation
              </button>
            )}
          </div>
        </details>
      )}

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {isHost && waiting.length > 0 && (
          <section>
            <h3 className="mb-2 px-2 text-sm text-brand-300">Waiting to join ({waiting.length})</h3>
            {seatTaken && <p className="mb-2 px-2 text-xs text-slate-400">Classes are one-to-one and your student is here. Remove them first to let someone else in.</p>}
            <ul className="space-y-1">
              {waiting.map((w) => (
                <li key={w.userId} className="flex items-center gap-3 rounded-2xl bg-night-3 px-3 py-2.5">
                  <Avatar name={w.name} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm">{w.name}</span>
                  <button
                    onClick={() => act(w.userId, () => client.deny(w.userId))}
                    disabled={busy === w.userId}
                    className="rounded-full p-1.5 text-slate-300 hover:bg-danger/20 hover:text-red-300"
                    aria-label={`Deny ${w.name}`}
                  >
                    <X size={17} strokeWidth={1.6} />
                  </button>
                  <button
                    onClick={() => act(w.userId, () => client.admit(w.userId))}
                    disabled={busy === w.userId || seatTaken}
                    className="inline-flex items-center gap-1 rounded-full bg-vellum px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white disabled:opacity-40"
                    aria-label={`Admit ${w.name}`}
                  >
                    <Check size={14} strokeWidth={2} /> Admit
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 px-2 text-sm text-slate-400">
            In the room
            {meeting.locked && <Lock size={12} className="ml-2 inline text-brand-300" aria-label="Locked" />}
          </h3>
          <ul className="space-y-0.5">
            {everyone.map((p) => {
              const isSelf = p.userId === self?.userId;
              return (
                <li key={p.userId} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-night-3" data-participant={p.name}>
                  <Avatar name={p.name} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {p.name} {isSelf && <span className="text-slate-400">(you)</span>}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      {p.isHost && <Crown size={12} className="text-brand-300" />} {p.isHost ? 'Teacher' : 'Student'}
                      {p.reconnecting && (
                        <span className="ml-1 inline-flex items-center gap-1 text-brand-300">
                          <WifiOff size={12} /> reconnecting
                        </span>
                      )}
                    </span>
                  </span>
                  {p.audio ? <Mic size={16} strokeWidth={1.6} className="text-slate-300" aria-label="Mic on" /> : <MicOff size={16} strokeWidth={1.6} className="text-red-300" aria-label="Muted" />}
                  {p.video ? <Video size={16} strokeWidth={1.6} className="text-slate-300" aria-label="Camera on" /> : <VideoOff size={16} strokeWidth={1.6} className="text-slate-500" aria-label="Camera off" />}
                  {isHost && !isSelf && !p.isHost && (
                    <HostMenu
                      p={p}
                      onMute={() => act(p.userId, () => client.mute(p.userId))}
                      onRemove={() => {
                        if (window.confirm(`Remove ${p.name} from this class? They won't be able to rejoin it.`)) act(p.userId, () => client.remove(p.userId));
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

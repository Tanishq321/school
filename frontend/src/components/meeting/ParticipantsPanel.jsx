import { useState } from 'react';
import { Check, Crown, Hand, Lock, Mic, MicOff, MoreHorizontal, Video, VideoOff, WifiOff, X } from 'lucide-react';
import { Avatar, Toggle } from '../ui/index.jsx';

function HostMenu({ p, allowSelfUnmute, onMute, onGrant, onLowerHand, onRemove }) {
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
          {!allowSelfUnmute && (
            <button role="menuitem" onClick={run(() => onGrant(!p.canSpeak))} className="block w-full px-4 py-2.5 text-left hover:bg-night-3">
              {p.canSpeak ? 'Stop allowing to speak' : 'Allow to speak'}
            </button>
          )}
          {p.handRaised && (
            <button role="menuitem" onClick={run(onLowerHand)} className="block w-full px-4 py-2.5 text-left hover:bg-night-3">
              Lower hand
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

export default function ParticipantsPanel({ client, state, self, participants, waiting, isHost, onClose, toastError }) {
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
  const allowSelfUnmute = meeting.permissions?.allowSelfUnmute ?? true;
  // Raised hands first (oldest first), then host, then everyone else by name.
  const everyone = [self, ...participants]
    .filter(Boolean)
    .sort((a, b) => (b.handRaised - a.handRaised) || (a.handRaised && new Date(a.handRaisedAt) - new Date(b.handRaisedAt)) || (b.isHost - a.isHost) || a.name.localeCompare(b.name));
  const hands = everyone.filter((p) => p.handRaised).length;

  return (
    <aside className="flex h-full w-full flex-col bg-night-2 text-vellum md:w-[22rem] md:rounded-[22px] md:border md:border-night-line" aria-label="People">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-display text-2xl font-normal">People</h2>
        <button onClick={onClose} className="rounded-full p-1.5 text-slate-300 hover:bg-night-3" aria-label="Close panel">
          <X size={18} strokeWidth={1.6} />
        </button>
      </div>

      {isHost && (
        <div className="mx-5 mb-2 space-y-3 rounded-2xl border border-night-line bg-night-3/60 p-4">
          <Toggle
            checked={allowSelfUnmute}
            onChange={(v) => act('perm', () => client.setAllowSelfUnmute(v))}
            label="Students may unmute themselves"
            description={allowSelfUnmute ? 'Anyone can speak.' : 'Students speak only when you allow them.'}
          />
          <Toggle
            checked={Boolean(meeting.locked)}
            onChange={(v) => act('lock', () => client.setLocked(v))}
            label="Lock the room"
            description="Nobody new can join. People already here can reconnect."
          />
          <button
            onClick={() => act('muteAll', () => client.muteAll())}
            disabled={busy === 'muteAll'}
            className="w-full rounded-full border border-night-line py-2 text-sm hover:border-brand-500/60"
          >
            Mute everyone
          </button>
        </div>
      )}

      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {isHost && waiting.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between px-2">
              <h3 className="text-sm text-brand-300">Waiting to join ({waiting.length})</h3>
              {waiting.length > 1 && (
                <button onClick={() => act('all', () => client.admitAll())} className="text-sm text-brand-300 underline-offset-4 hover:underline">
                  Admit all
                </button>
              )}
            </div>
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
                    disabled={busy === w.userId}
                    className="inline-flex items-center gap-1 rounded-full bg-vellum px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white"
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
            In the room ({everyone.length}){hands > 0 && <span className="text-brand-300"> with {hands} {hands === 1 ? 'hand' : 'hands'} up</span>}
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
                    <span className="flex items-center gap-1 text-xs text-slate-400 capitalize">
                      {p.isHost && <Crown size={12} className="text-brand-300" />} {p.isHost ? 'Host' : p.role}
                      {!p.isHost && !allowSelfUnmute && p.canSpeak && <span className="ml-1 text-brand-300 normal-case">may speak</span>}
                      {p.reconnecting && (
                        <span className="ml-1 inline-flex items-center gap-1 text-brand-300 normal-case">
                          <WifiOff size={12} /> reconnecting
                        </span>
                      )}
                    </span>
                  </span>
                  {p.handRaised && <Hand size={16} strokeWidth={1.8} className="text-brand-300" aria-label="Hand raised" />}
                  {p.audio ? <Mic size={16} strokeWidth={1.6} className="text-slate-300" aria-label="Mic on" /> : <MicOff size={16} strokeWidth={1.6} className="text-red-300" aria-label="Muted" />}
                  {p.video ? <Video size={16} strokeWidth={1.6} className="text-slate-300" aria-label="Camera on" /> : <VideoOff size={16} strokeWidth={1.6} className="text-slate-500" aria-label="Camera off" />}
                  {isHost && !isSelf && !p.isHost && (
                    <HostMenu
                      p={p}
                      allowSelfUnmute={allowSelfUnmute}
                      onMute={() => act(p.userId, () => client.mute(p.userId))}
                      onGrant={(g) => act(p.userId, () => client.grantSpeak(p.userId, g))}
                      onLowerHand={() => act(p.userId, () => client.lowerHand(p.userId))}
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
    </aside>
  );
}

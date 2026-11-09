import { useState } from 'react';
import { Check, Crown, Mic, MicOff, Video, VideoOff, WifiOff, X } from 'lucide-react';
import { Avatar } from '../ui/index.jsx';

export default function ParticipantsPanel({ self, participants, waiting, isHost, onAdmit, onDeny, onClose }) {
  const [busy, setBusy] = useState(null);
  const act = async (fn, id) => {
    setBusy(id);
    try {
      await fn(id);
    } finally {
      setBusy(null);
    }
  };
  const everyone = [self, ...participants].filter(Boolean);
  return (
    <aside className="flex h-full w-full flex-col bg-night-2 text-stone-100 md:w-80 md:rounded-2xl md:border md:border-night-line" aria-label="Participants">
      <div className="flex items-center justify-between border-b border-night-line px-4 py-3">
        <h2 className="font-semibold">People</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-night-3" aria-label="Close panel">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {isHost && waiting.length > 0 && (
          <section>
            <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-saffron uppercase">Waiting to join ({waiting.length})</h3>
            <ul className="space-y-1">
              {waiting.map((w) => (
                <li key={w.userId} className="flex items-center gap-3 rounded-xl bg-night-3 px-3 py-2">
                  <Avatar name={w.name} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm">{w.name}</span>
                  <button
                    onClick={() => act(onDeny, w.userId)}
                    disabled={busy === w.userId}
                    className="rounded-lg p-1.5 text-stone-300 hover:bg-danger/20 hover:text-red-300"
                    aria-label={`Deny ${w.name}`}
                  >
                    <X size={17} />
                  </button>
                  <button
                    onClick={() => act(onAdmit, w.userId)}
                    disabled={busy === w.userId}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold hover:bg-brand-500"
                    aria-label={`Admit ${w.name}`}
                  >
                    <Check size={14} /> Admit
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-stone-400 uppercase">In class ({everyone.length})</h3>
          <ul className="space-y-1">
            {everyone.map((p) => (
              <li key={p.userId} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-night-3">
                <Avatar name={p.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {p.name} {p.userId === self?.userId && <span className="text-stone-400">(you)</span>}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-stone-400 capitalize">
                    {p.isHost && <Crown size={12} className="text-saffron" />} {p.isHost ? 'Host' : p.role}
                    {p.reconnecting && (
                      <span className="ml-1 inline-flex items-center gap-1 text-saffron normal-case">
                        <WifiOff size={12} /> reconnecting
                      </span>
                    )}
                  </span>
                </span>
                {p.audio ? <Mic size={16} className="text-stone-300" aria-label="Mic on" /> : <MicOff size={16} className="text-danger" aria-label="Muted" />}
                {p.video ? <Video size={16} className="text-stone-300" aria-label="Camera on" /> : <VideoOff size={16} className="text-stone-500" aria-label="Camera off" />}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

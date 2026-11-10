import { X } from 'lucide-react';
import ParticipantsPanel from './ParticipantsPanel.jsx';
import ChatPanel from './ChatPanel.jsx';

/** Right-hand sheet with two tabs: the people in the room and the class chat. */
export default function SidePanel({ tab, onTab, onClose, client, state, self, participants, isHost, toastError }) {
  const count = participants.length + 1;
  const tabs = [
    { id: 'people', label: 'People', meta: count },
    { id: 'chat', label: 'Chat', meta: state.chatUnread || null },
  ];
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-night-2/95 text-vellum backdrop-blur-xl md:w-[23rem] md:rounded-[24px] md:border md:border-vellum/[0.08] md:shadow-[0_30px_80px_-40px_rgba(0,0,0,.9)]" aria-label="Side panel">
      <div className="flex items-center gap-1 px-4 pt-4 pb-3">
        <div className="flex flex-1 gap-1 rounded-full bg-night/60 p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${tab === t.id ? 'bg-vellum text-ink shadow' : 'text-slate-300 hover:text-vellum'}`}
            >
              {t.label}
              {t.meta != null && (
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === t.id ? 'bg-ink/10' : t.id === 'chat' ? 'bg-brand-300 font-semibold text-ink' : 'bg-vellum/10'}`}>{t.meta}</span>
              )}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="rounded-full p-2 text-slate-300 hover:bg-night-3" aria-label="Close panel">
          <X size={18} strokeWidth={1.6} />
        </button>
      </div>
      {tab === 'chat' ? (
        <ChatPanel client={client} state={state} isHost={isHost} toastError={toastError} />
      ) : (
        <ParticipantsPanel client={client} state={state} self={self} participants={participants} waiting={state.waiting} isHost={isHost} toastError={toastError} />
      )}
    </aside>
  );
}

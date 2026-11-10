import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crown, SendHorizontal, Trash2 } from 'lucide-react';

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Plain text with safe, clickable http(s) links. Never renders HTML from messages. */
function MessageText({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-300 underline decoration-brand-300/40 underline-offset-2 hover:decoration-brand-300">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function ChatPanel({ client, state, isHost, toastError }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const stick = useRef(true);
  const selfId = state.self?.userId;
  const canChat = isHost || state.meeting?.permissions?.chatMode !== 'host';
  const messages = state.chat;

  useEffect(() => {
    client.setChatVisible(true);
    return () => client.setChatVisible(false);
  }, [client]);

  // Keep pinned to the newest message unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (e) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await client.sendChat(value);
      setText('');
      stick.current = true;
    } catch (err) {
      toastError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-5 py-3"
        aria-live="polite"
        data-testid="chat-list"
      >
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-400">No messages yet. Everything written here is seen by the whole class.</p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.userId === m.userId && new Date(m.at) - new Date(prev.at) < 3 * 60_000;
          return (
            <div key={m.id} className={`group relative ${grouped ? '' : 'pt-3'}`} data-testid="chat-message">
              {!grouped && (
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className={`text-[13px] font-semibold ${m.userId === selfId ? 'text-brand-300' : 'text-vellum'}`}>{m.userId === selfId ? 'You' : m.name}</span>
                  {m.isHost && <Crown size={11} className="translate-y-px text-brand-300" aria-label="Host" />}
                  <span className="text-[11px] text-slate-500 tabular-nums">{time(m.at)}</span>
                </div>
              )}
              <p className="pr-7 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-vellum/90">
                <MessageText text={m.text} />
              </p>
              {isHost && (
                <button
                  onClick={() => client.deleteChat(m.id).catch((err) => toastError(err.message))}
                  className="absolute top-1/2 right-0 rounded-full p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-red-300 focus:opacity-100"
                  aria-label={`Delete message from ${m.name}`}
                  title="Delete for everyone"
                >
                  <Trash2 size={13} strokeWidth={1.7} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="border-t border-night-line p-3">
        {canChat ? (
          <div className="flex items-end gap-2 rounded-2xl border border-night-line bg-night-3/70 p-1.5 focus-within:border-brand-400/60">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e);
              }}
              rows={Math.min(5, text.split('\n').length)}
              placeholder="Message the class"
              aria-label="Message the class"
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-vellum outline-none placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-300 text-ink transition disabled:opacity-30"
              aria-label="Send message"
            >
              <SendHorizontal size={16} strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <p className="px-2 py-2 text-center text-sm text-slate-400">Only the host can send messages right now.</p>
        )}
      </form>
    </div>
  );
}

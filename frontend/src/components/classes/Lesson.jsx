import { useEffect, useRef, useState } from 'react';
import { Check, Mail, Plus, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { Button } from '../ui/index.jsx';
import { SectionTitle } from './index.jsx';

const sheet =
  'rounded-[22px] border border-line/80 bg-[#fbf8f1] shadow-[inset_0_1px_0_rgba(255,255,255,.7),0_24px_50px_-34px_rgba(22,28,44,.45)] dark:border-night-line dark:bg-night-2/80 dark:shadow-[0_24px_50px_-30px_rgba(5,8,16,.9)]';
const ruled = { backgroundImage: 'repeating-linear-gradient(transparent 0 29px, rgba(173,136,81,.13) 29px 30px)', backgroundPositionY: '19px' };
const savedAt = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null);

/** A homework tick: a brass ring that fills when done. */
function Tick({ done, onClick, disabled, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`mt-[3px] flex size-[22px] shrink-0 items-center justify-center rounded-full border transition duration-300 ${
        done ? 'border-transparent bg-[linear-gradient(180deg,#b8955a,#86663a)] text-vellum shadow-[0_4px_12px_-4px_rgba(134,102,58,.8)]' : 'border-brand-400/60 hover:border-brand-500'
      } disabled:cursor-default`}
    >
      {done && <Check size={13} strokeWidth={2.4} />}
    </button>
  );
}

/**
 * The student's page: what the teacher wrote, and the homework to tick off. Ticks are saved at once
 * and the teacher sees them.
 */
export function LessonView({ code, lesson, hostName, onChange }) {
  const toast = useToast();
  const [items, setItems] = useState(lesson.homework);
  useEffect(() => setItems(lesson.homework), [lesson.homework]);
  const empty = !lesson.summary && items.length === 0;
  const done = items.filter((h) => h.done).length;

  const toggle = async (item) => {
    const next = !item.done;
    setItems((list) => list.map((h) => (h.id === item.id ? { ...h, done: next } : h)));
    try {
      const { lesson: saved } = await api(`/meetings/${code}/homework/${item.id}`, { method: 'POST', body: { done: next } });
      setItems(saved.homework);
      onChange?.(saved);
      if (next && saved.homework.every((h) => h.done)) toast('All homework done. Well done.', { tone: 'success' });
    } catch (err) {
      setItems((list) => list.map((h) => (h.id === item.id ? { ...h, done: item.done } : h)));
      toast(err.message, { tone: 'error' });
    }
  };

  return (
    <section className="reveal" data-testid="lesson-view">
      <SectionTitle eyebrow={hostName ? `From ${hostName}` : 'From your teacher'} title="After the lesson" />
      {empty ? (
        <p className="text-ink-2 dark:text-slate-400">Your teacher's notes and any homework will appear here after the lesson.</p>
      ) : (
        <div className={`${sheet} overflow-hidden`}>
          {lesson.summary && (
            <div className="px-7 pt-7 pb-6 sm:px-9" style={ruled}>
              <p className="font-display text-[18px] leading-[30px] whitespace-pre-line text-ink dark:text-vellum">{lesson.summary}</p>
            </div>
          )}
          {items.length > 0 && (
            <div className={`px-7 py-6 sm:px-9 ${lesson.summary ? 'border-t border-line/70 dark:border-night-line' : ''}`}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">Homework</h3>
                <span className="text-xs text-ink-2 tabular-nums dark:text-slate-400">
                  {done} of {items.length} done
                </span>
              </div>
              <div className="mb-5 h-[3px] overflow-hidden rounded-full bg-line/70 dark:bg-night-line">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#86663a,#d8be8c)] transition-[width] duration-700 ease-out" style={{ width: `${(done / items.length) * 100}%` }} />
              </div>
              <ul className="space-y-3.5">
                {items.map((h) => (
                  <li key={h.id} className="flex gap-3.5">
                    <Tick done={h.done} onClick={() => toggle(h)} label={h.text} />
                    <span className={`text-[16px] leading-relaxed transition ${h.done ? 'text-ink-2 line-through decoration-brand-400/60 dark:text-slate-500' : ''}`}>{h.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lesson.updatedAt && <p className="border-t border-line/60 px-7 py-3 text-xs text-ink-2 sm:px-9 dark:border-night-line dark:text-slate-500">Written {savedAt(lesson.updatedAt)}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * The teacher's side: a summary for the student and a homework list. The student's ticks show here.
 * Saving can also email the notes to the student.
 */
export function LessonEditor({ code, lesson, studentEmail, studentName, onSaved }) {
  const toast = useToast();
  const [summary, setSummary] = useState(lesson.summary);
  const [items, setItems] = useState(lesson.homework);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(null);
  const [savedOn, setSavedOn] = useState(lesson.updatedAt);
  const addRef = useRef(null);
  const base = useRef(JSON.stringify([lesson.summary, lesson.homework.map((h) => h.text)]));
  const dirty = JSON.stringify([summary, items.map((h) => h.text)]) !== base.current || draft.trim() !== '';

  useEffect(() => {
    const warn = (e) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (items.length >= 20) return toast('At most 20 pieces of homework', { tone: 'error' });
    setItems((l) => [...l, { id: null, key: `n${Date.now()}`, text, done: false }]);
    setDraft('');
    addRef.current?.focus();
    return undefined;
  };

  const save = async (notify) => {
    const pending = draft.trim() ? [...items, { id: null, text: draft.trim() }] : items;
    setBusy(notify ? 'notify' : 'save');
    try {
      const { lesson: saved } = await api(`/meetings/${code}/lesson`, {
        method: 'PUT',
        body: { summary: summary.trim(), homework: pending.filter((h) => h.text.trim()).map((h) => (h.id ? { id: h.id, text: h.text.trim() } : { text: h.text.trim() })), notify },
      });
      setItems(saved.homework);
      setSummary(saved.summary);
      setDraft('');
      setSavedOn(saved.updatedAt);
      base.current = JSON.stringify([saved.summary, saved.homework.map((h) => h.text)]);
      onSaved?.(saved);
      toast(notify ? `Saved and sent to ${studentName || studentEmail}.` : 'Saved. Your student can see it on the class page.', { tone: 'success' });
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="reveal" data-testid="lesson-editor">
      <SectionTitle
        eyebrow={studentName || studentEmail ? `For ${studentName || studentEmail}` : 'For your student'}
        title="After the lesson"
        action={<span className="text-xs text-ink-2 dark:text-slate-400">{dirty ? 'Not yet saved' : savedOn ? `Saved ${savedAt(savedOn)}` : ''}</span>}
      />
      <div className={`${sheet} overflow-hidden`}>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={5000}
          aria-label="Summary for your student"
          placeholder="What you covered, what went well, what to focus on next. Your student reads this on the class page."
          className="block min-h-[170px] w-full resize-y bg-transparent px-7 pt-7 pb-6 font-display text-[18px] leading-[30px] text-ink outline-none placeholder:text-ink-2/50 sm:px-9 dark:text-vellum dark:placeholder:text-vellum/30"
          style={ruled}
        />
        <div className="border-t border-line/70 px-7 py-6 sm:px-9 dark:border-night-line">
          <h3 className="mb-4 text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">Homework</h3>
          <ul className="space-y-2.5">
            {items.map((h, i) => (
              <li key={h.id || h.key} className="group flex items-start gap-3">
                <Tick done={h.done} disabled label={h.done ? 'Done by your student' : 'Not done yet'} />
                <input
                  value={h.text}
                  maxLength={300}
                  aria-label={`Homework ${i + 1}`}
                  onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  className={`min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-[16px] outline-none focus:border-brand-400/50 ${h.done ? 'text-ink-2 line-through decoration-brand-400/60 dark:text-slate-500' : ''}`}
                />
                <button type="button" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label="Remove" className="rounded-full p-1 text-ink-2/60 opacity-60 transition hover:bg-paper-2 hover:text-ink group-hover:opacity-100 dark:hover:bg-night-3">
                  <X size={15} strokeWidth={1.6} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-brand-400/50 text-brand-600 dark:text-brand-300">
              <Plus size={13} strokeWidth={2} />
            </span>
            <input
              ref={addRef}
              value={draft}
              maxLength={300}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add homework and press Enter"
              aria-label="New homework"
              className="min-w-0 flex-1 border-b border-line/70 bg-transparent py-1 text-[16px] outline-none placeholder:text-ink-2/50 focus:border-brand-400/60 dark:border-night-line dark:placeholder:text-vellum/30"
            />
          </form>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-paper-2/40 px-7 py-4 sm:px-9 dark:border-night-line dark:bg-night/30">
          <Button variant="ghost" size="sm" onClick={() => save(false)} loading={busy === 'save'} disabled={Boolean(busy)}>
            Save
          </Button>
          {studentEmail && (
            <Button size="sm" onClick={() => save(true)} loading={busy === 'notify'} disabled={Boolean(busy)}>
              <Mail size={14} strokeWidth={1.6} /> Save and send to {studentName?.split(' ')[0] || 'student'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

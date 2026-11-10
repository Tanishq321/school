import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, PencilLine, ShieldCheck, Trash2, UserX, Users } from 'lucide-react';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Button, FullPageSpinner, Monogram, Toggle } from '../components/ui/index.jsx';
import { fmtLen, mediaSrc } from '../components/classes/index.jsx';
import { fmtTime } from '../utils/format.js';

/** The screening room: one recording, played on a lacquered stage. */
export default function RecordingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [rec, setRec] = useState(null);
  const [urls, setUrls] = useState(null);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState(null); // non-null while renaming

  const load = useCallback(async () => {
    try {
      const { recording } = await api(`/recordings/${id}`);
      setRec(recording);
      if (recording.status === 'ready') setUrls(await api(`/recordings/${id}/playback`, { method: 'POST' }));
      return recording;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [id]);

  useEffect(() => {
    let timer;
    const tick = async () => {
      const r = await load();
      if (r && ['recording', 'processing'].includes(r.status)) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [load]);

  const patch = async (body) => {
    try {
      const { recording } = await api(`/recordings/${id}`, { method: 'PATCH', body });
      setRec((r) => ({ ...r, ...recording }));
      return true;
    } catch (err) {
      toast(err.message, { tone: 'error' });
      return false;
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this recording permanently? This cannot be undone.')) return;
    try {
      await api(`/recordings/${id}`, { method: 'DELETE' });
      toast('Recording deleted');
      navigate('/recordings', { replace: true });
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <Back />
        <Alert>{error}</Alert>
      </div>
    );
  }
  if (!rec) return <FullPageSpinner label="Opening the archive" />;
  const accepted = rec.consent?.filter((c) => c.decision === 'accepted') ?? [];
  const declined = rec.consent?.filter((c) => c.decision === 'declined') ?? [];
  const start = new Date(rec.startedAt);

  return (
    <div className="space-y-10">
      <Back />

      <section className="lamplight relative -mx-5 overflow-hidden px-3 py-6 sm:mx-0 sm:rounded-[30px] sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute inset-0 hidden rounded-[30px] shadow-[inset_0_0_0_1px_rgba(216,190,140,.14)] sm:block" />
        <div className="relative mx-auto aspect-video w-full max-w-[1100px] overflow-hidden rounded-[14px] bg-black shadow-[0_50px_100px_-40px_rgba(0,0,0,1),0_0_0_1px_rgba(216,190,140,.18)]">
          {rec.status === 'ready' && urls ? (
            <video
              key={urls.mediaUrl}
              src={mediaSrc(urls.mediaUrl)}
              poster={mediaSrc(urls.posterUrl)}
              controls
              playsInline
              preload="metadata"
              controlsList="noremoteplayback"
              className="h-full w-full bg-black"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-vellum/80">
              <span className="relative inline-flex">
                <Monogram size={54} />
                {rec.status !== 'failed' && (
                  <svg viewBox="0 0 50 50" className="absolute -inset-[8px] h-[70px] w-[70px] animate-spin [animation-duration:1.8s]" aria-hidden="true">
                    <circle cx="25" cy="25" r="23" fill="none" stroke="var(--color-brand-400)" strokeWidth="1" strokeLinecap="round" strokeDasharray="28 120" />
                  </svg>
                )}
              </span>
              <p className="font-display text-xl italic">
                {rec.status === 'recording' ? 'This class is being recorded right now' : rec.status === 'processing' ? 'The film is being prepared' : 'This recording could not be saved'}
              </p>
              <p className="max-w-sm text-center text-sm text-vellum/55">
                {rec.status === 'processing' ? 'It usually takes about a quarter of the class length. This page updates on its own.' : rec.error || ''}
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">
            {start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {fmtTime(start)}
          </p>
          {title !== null ? (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (title.trim() && (await patch({ title: title.trim() }))) setTitle(null);
              }}
            >
              <input autoFocus className="input max-w-xl font-display text-2xl" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} aria-label="Recording title" />
              <Button type="submit" size="sm">
                <Check size={14} /> Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setTitle(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <h1 className="group mt-3 flex items-start gap-3 font-display text-[2.6rem] leading-[1.05] font-normal sm:text-[3.2rem]">
              {rec.title || rec.meetingTitle || 'Class recording'}
              {rec.mine && (
                <button onClick={() => setTitle(rec.title || rec.meetingTitle || '')} className="mt-3 rounded-lg p-1.5 text-ink-2 opacity-0 transition group-hover:opacity-100 hover:bg-paper-2 focus:opacity-100 dark:hover:bg-night-3" aria-label="Rename">
                  <PencilLine size={17} strokeWidth={1.5} />
                </button>
              )}
            </h1>
          )}
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-ink-2 dark:text-slate-400">
            {rec.durationSec != null && <span className="tabular-nums">{fmtLen(rec.durationSec)}</span>}
            {rec.hostName && !rec.mine && <span>with {rec.hostName}</span>}
            {rec.mine && rec.meetingCode && (
              <Link to={`/classes/${rec.meetingCode}`} className="underline decoration-brand-400/50 underline-offset-4 hover:text-ink dark:hover:text-vellum">
                {rec.meetingTitle || 'Class'} — notes & attendance
              </Link>
            )}
            {rec.sizeBytes ? <span>{(rec.sizeBytes / 1048576).toFixed(rec.sizeBytes > 1e9 ? 0 : 1)} MB</span> : null}
          </p>
          {urls && (
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={mediaSrc(urls.downloadUrl)} className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white/70 px-5 text-sm font-medium transition hover:border-brand-400/60 dark:border-night-line dark:bg-night-3/70">
                <Download size={15} strokeWidth={1.6} /> Download MP4
              </a>
              {rec.mine && (
                <Button variant="ghost" onClick={remove}>
                  <Trash2 size={15} strokeWidth={1.6} /> Delete
                </Button>
              )}
            </div>
          )}
          {!urls && rec.mine && rec.status === 'failed' && (
            <div className="mt-8">
              <Button variant="ghost" onClick={remove}>
                <Trash2 size={15} strokeWidth={1.6} /> Remove
              </Button>
            </div>
          )}
        </div>

        {rec.mine && (
          <aside className="space-y-8">
            <div className="card p-5">
              <Toggle
                checked={Boolean(rec.shareWithParticipants)}
                onChange={(v) => patch({ shareWithParticipants: v }).then((ok) => ok && toast(v ? 'Shared with the class' : 'Now private to you'))}
                label="Share with the class"
                description="Everyone who attended or was invited can watch and download. Turning this off revokes access immediately."
              />
            </div>
            <section>
              <h3 className="mb-4 flex items-center gap-2 text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">
                <ShieldCheck size={14} strokeWidth={1.6} /> Consent ledger
              </h3>
              <ul className="space-y-2 text-sm">
                {accepted.map((c) => (
                  <li key={c.user} className="flex items-center gap-2.5">
                    <Users size={14} strokeWidth={1.5} className="text-brand-500" /> {c.name}
                    <span className="ml-auto text-xs text-ink-2 dark:text-slate-400">agreed {c.at ? fmtTime(c.at) : ''}</span>
                  </li>
                ))}
                {declined.map((c) => (
                  <li key={c.user} className="flex items-center gap-2.5 text-ink-2 dark:text-slate-400">
                    <UserX size={14} strokeWidth={1.5} /> {c.name}
                    <span className="ml-auto text-xs">declined · not captured</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-ink-2 dark:text-slate-400">
                Only people who agreed were captured, from the moment they agreed. Anyone who declined or never answered was left out of both sound and picture.
              </p>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

const Back = () => (
  <Link to="/recordings" viewTransition className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum">
    <ArrowLeft size={15} strokeWidth={1.5} /> The archive
  </Link>
);

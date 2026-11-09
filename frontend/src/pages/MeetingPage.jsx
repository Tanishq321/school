import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Hourglass,
  Mic,
  MicOff,
  MoreVertical,
  PhoneOff,
  RefreshCw,
  Settings,
  ShieldCheck,
  SwitchCamera,
  Users,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { api } from '../services/api.js';
import { LocalMedia } from '../services/localMedia.js';
import { MeetingClient } from '../services/meetingClient.js';
import { useEventState } from '../hooks/useEventState.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { Alert, Button, Field, FullPageSpinner, Logo, Spinner } from '../components/ui/index.jsx';
import VideoTile, { RemoteAudio } from '../components/meeting/VideoTile.jsx';
import DeviceSettings, { MicMeter } from '../components/meeting/DeviceSettings.jsx';
import ParticipantsPanel from '../components/meeting/ParticipantsPanel.jsx';
import { copyText, fmtClock, fmtDateTime } from '../utils/format.js';

const RELAY_KEY = 'vp.forceRelay';
const readRelay = () => {
  try {
    return localStorage.getItem(RELAY_KEY) === '1';
  } catch {
    return false;
  }
};

export default function MeetingPage() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const invite = params.get('invite') || undefined;
  const [info, setInfo] = useState({ loading: true });
  const [localMedia] = useState(() => new LocalMedia());
  const [client, setClient] = useState(null);
  const media = useEventState(localMedia, (lm) => lm.snapshot());
  const state = useEventState(client, (c) => c.state);

  useEffect(() => {
    api(`/meetings/${encodeURIComponent(code)}`)
      .then(({ meeting }) => setInfo({ meeting }))
      .catch((err) => setInfo({ error: err }));
  }, [code]);

  useEffect(() => {
    localMedia.start();
    return () => localMedia.stop();
  }, [localMedia]);

  useEffect(() => () => client?.destroy(), [client]);

  // Keep the screen awake during a class (mobile).
  useEffect(() => {
    if (state?.phase !== 'in-meeting' || !navigator.wakeLock) return undefined;
    let lock;
    navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
    return () => lock?.release().catch(() => {});
  }, [state?.phase]);

  const join = useCallback(
    async (password) => {
      const c = client && ['idle', 'error'].includes(client.state.phase) && !client.socket ? client : new MeetingClient({ code, localMedia, forceRelay: readRelay() });
      if (c !== client) {
        client?.destroy();
        setClient(c);
      }
      await c.join({ password, invite });
    },
    [client, code, localMedia, invite],
  );

  if (info.loading) return <FullPageSpinner label="Finding your class…" />;
  if (info.error) return <MeetingError error={info.error} />;

  const phase = state?.phase ?? 'idle';
  if (['in-meeting', 'reconnecting'].includes(phase)) return <Room client={client} state={state} media={media} localMedia={localMedia} />;
  if (phase === 'waiting') return <WaitingRoom state={state} media={media} localMedia={localMedia} client={client} meeting={info.meeting} />;
  if (['ended', 'denied', 'replaced', 'left'].includes(phase)) return <EndScreen phase={phase} reason={state.endedReason} meeting={info.meeting} onRejoin={() => join()} />;
  return (
    <PreJoin
      meeting={info.meeting}
      media={media}
      localMedia={localMedia}
      onJoin={join}
      joining={phase === 'joining'}
      error={state?.error}
      hasInvite={Boolean(invite)}
    />
  );
}

function MeetingError({ error }) {
  const msg = error.status === 404 || error.code === 'bad_request' ? 'We couldn’t find a class with that code. Check the link or ask your teacher for a new one.' : error.message;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-semibold">Can’t open this class</h1>
        <p className="mt-2 text-ink-2 dark:text-stone-400">{msg}</p>
      </div>
      <Link to="/">
        <Button variant="secondary">
          <ArrowLeft size={16} /> Back to dashboard
        </Button>
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ pre-join lobby

function Preview({ media, localMedia, name }) {
  return (
    <div className="relative">
      <VideoTile
        name={name}
        stream={media.videoTrack ? localMedia.stream : null}
        version={media.videoTrack?.id}
        videoOn={media.videoEnabled}
        audioOn={media.audioEnabled}
        audioTrack={media.audioTrack}
        isLocal
        mirrored={media.facingMode !== 'environment'}
        fit="cover"
        className="aspect-video w-full"
      />
      {media.busy && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 text-white">
          <Spinner />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
        <RoundButton on={media.audioEnabled} onClick={() => localMedia.toggleAudio()} labelOn="Turn off microphone" labelOff="Turn on microphone" IconOn={Mic} IconOff={MicOff} />
        <RoundButton on={media.videoEnabled} onClick={() => localMedia.toggleVideo()} labelOn="Turn off camera" labelOff="Turn on camera" IconOn={Video} IconOff={VideoOff} />
      </div>
    </div>
  );
}

function PreJoin({ meeting, media, localMedia, onJoin, joining, error, hasInvite }) {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forceRelay, setForceRelay] = useState(readRelay);
  const needsPassword = meeting.hasPassword && !meeting.isHost && !hasInvite;
  const passwordError = error?.code === 'invalid_meeting_password' || error?.code === 'password_required';
  const startsLater = meeting.status === 'scheduled' && new Date(meeting.scheduledStart) > Date.now() + 60_000;

  const submit = (e) => {
    e.preventDefault();
    onJoin(needsPassword ? password : undefined).catch(() => {});
  };

  return (
    <div className="min-h-full bg-paper dark:bg-night">
      <header className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
        <Link to="/" aria-label="Dashboard">
          <Logo />
        </Link>
        <span className="ml-auto text-sm text-ink-2 dark:text-stone-400">{user.name}</span>
      </header>
      <main className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 sm:px-6 lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <Preview media={media} localMedia={localMedia} name={user.name} />
          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center gap-2 text-xs text-ink-2 dark:text-stone-400">
              <Mic size={14} />
              <div className="w-32">
                <MicMeter track={media.audioTrack} enabled={media.audioEnabled} />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings size={15} /> Check devices
            </Button>
          </div>
          {media.errors.video && <Alert tone="info">{media.errors.video.message}</Alert>}
          {media.errors.audio && media.errors.audio !== media.errors.video && <Alert tone="info">{media.errors.audio.message}</Alert>}
        </div>

        <form onSubmit={submit} className="space-y-5 text-center lg:text-left">
          <div>
            <p className="text-sm font-medium text-brand-600 dark:text-brand-400">{meeting.isHost ? 'Your class' : `Hosted by ${meeting.hostName}`}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{meeting.title}</h1>
            <p className="mt-2 text-sm text-ink-2 dark:text-stone-400">
              {meeting.status === 'live' ? 'Class is in progress' : startsLater ? `Scheduled for ${fmtDateTime(meeting.scheduledStart)}` : 'Ready when you are'}
            </p>
          </div>
          {needsPassword && (
            <Field
              label="Meeting password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={passwordError ? error.message : undefined}
              required
            />
          )}
          {error && !passwordError && <Alert>{error.message}</Alert>}
          <Button type="submit" size="lg" className="w-full lg:w-auto lg:min-w-48" loading={joining} disabled={needsPassword && !password}>
            {meeting.isHost ? (meeting.status === 'live' ? 'Rejoin class' : 'Start class') : 'Join class'}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-2 lg:justify-start dark:text-stone-400">
            <ShieldCheck size={14} /> Audio and video are encrypted in transit.
          </p>
        </form>
      </main>
      <DeviceSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        media={media}
        localMedia={localMedia}
        forceRelay={forceRelay}
        onForceRelay={(v) => {
          setForceRelay(v);
          try {
            localStorage.setItem(RELAY_KEY, v ? '1' : '0');
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}

function RoundButton({ on, onClick, labelOn, labelOff, IconOn, IconOff, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? labelOn : labelOff}
      title={on ? labelOn : labelOff}
      className={`flex size-12 items-center justify-center rounded-full transition active:scale-95 ${
        danger ? 'bg-danger text-white hover:bg-danger-600' : on ? 'bg-white/15 text-white backdrop-blur hover:bg-white/25' : 'bg-danger text-white hover:bg-danger-600'
      }`}
    >
      {on ? <IconOn size={20} /> : <IconOff size={20} />}
    </button>
  );
}

// ------------------------------------------------------------------ waiting room

function WaitingRoom({ state, media, localMedia, client, meeting }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const text = {
    host_not_started: ['Waiting for the host to start', 'You’ll be let in automatically when the class begins.'],
    awaiting_approval: ['Asking to join…', 'The host will let you in soon.'],
    meeting_full: ['This class is full', 'You’ll be let in when a seat frees up.'],
  }[state.waitingReason] || ['Waiting…', ''];
  return (
    <div className="min-h-full bg-paper dark:bg-night">
      <main className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 sm:px-6 lg:min-h-full lg:grid-cols-[1.4fr_1fr]">
        <Preview media={media} localMedia={localMedia} name={user.name} />
        <div className="space-y-4 text-center lg:text-left" role="status" aria-live="polite">
          <Hourglass className="mx-auto animate-pulse text-brand-600 lg:mx-0" size={32} />
          <h1 className="font-display text-3xl font-semibold">{text[0]}</h1>
          <p className="text-ink-2 dark:text-stone-400">{text[1]}</p>
          <p className="text-sm text-ink-2 dark:text-stone-400">{meeting.title}</p>
          <Button
            variant="secondary"
            onClick={async () => {
              await client.leave();
              navigate('/');
            }}
          >
            Cancel
          </Button>
        </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ end screens

function EndScreen({ phase, reason, meeting, onRejoin }) {
  const content = {
    ended: ['The class has ended', reason === 'idle' ? 'It closed after being empty for a while.' : 'The host ended the class for everyone.'],
    denied: ['You weren’t let in', 'The host declined your request to join.'],
    replaced: ['You joined from another device', 'This tab was disconnected because you joined somewhere else.'],
    left: ['You left the class', ''],
  }[phase];
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div>
        <h1 className="font-display text-3xl font-semibold">{content[0]}</h1>
        {content[1] && <p className="mt-2 text-ink-2 dark:text-stone-400">{content[1]}</p>}
        <p className="mt-1 text-sm text-ink-2 dark:text-stone-400">{meeting.title}</p>
      </div>
      <div className="flex gap-3">
        {['left', 'replaced'].includes(phase) && (
          <Button variant="secondary" onClick={onRejoin}>
            <RefreshCw size={16} /> Rejoin
          </Button>
        )}
        <Link to="/">
          <Button>Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the room

function useElapsed(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return since ? now - new Date(since).getTime() : 0;
}

function Room({ client, state, media, localMedia }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveMenu, setLeaveMenu] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const joinedAt = useRef(Date.now());
  const elapsed = useElapsed(joinedAt.current);
  const isHost = state.self?.isHost;
  const remotes = state.participants;

  useEffect(() => {
    const onNotice = ({ detail }) => {
      if (detail.type === 'joined') toast(`${detail.name} joined`);
      if (detail.type === 'left') toast(`${detail.name} left`);
      if (detail.type === 'waiting') {
        toast(`${detail.name} is waiting to join`, { duration: 6000 });
        setPanel(true);
      }
    };
    client.addEventListener('notice', onNotice);
    return () => client.removeEventListener('notice', onNotice);
  }, [client, toast]);

  // Keyboard shortcuts: Ctrl/⌘+D mic, Ctrl/⌘+E camera.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'd') {
        e.preventDefault();
        localMedia.toggleAudio();
      } else if (e.key === 'e') {
        e.preventDefault();
        localMedia.toggleVideo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [localMedia]);

  const onBlocked = useCallback(() => setAudioBlocked(true), []);
  const unblockAudio = () => {
    document.querySelectorAll('audio[data-remote-audio]').forEach((a) => a.play().catch(() => {}));
    setAudioBlocked(false);
  };

  const leave = async () => {
    await client.leave();
    navigate('/');
  };
  const endForAll = async () => {
    try {
      await client.endForAll();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };
  const copyInvite = async () => {
    try {
      const { meeting } = await api(`/meetings/${client.code}`);
      const link = meeting.inviteUrl || `${window.location.origin}/m/${client.code}`;
      toast((await copyText(link)) ? 'Invite link copied' : link);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };

  const localTile = (props) => (
    <VideoTile
      name={state.self?.name}
      stream={media.videoTrack ? localMedia.stream : null}
      version={media.videoTrack?.id}
      videoOn={media.videoEnabled}
      audioOn={media.audioEnabled}
      audioTrack={media.audioTrack}
      isLocal
      isHost={isHost}
      mirrored={media.facingMode !== 'environment'}
      fit="cover"
      {...props}
    />
  );
  const remoteTile = (p, props) => (
    <VideoTile
      key={p.userId}
      name={p.name}
      stream={p.stream}
      version={p.streamVersion}
      videoOn={p.video}
      audioOn={p.audio}
      audioTrack={p.stream?.getAudioTracks()[0]}
      isHost={p.isHost}
      reconnecting={p.reconnecting}
      connecting={!p.reconnecting && p.connectionState !== 'connected'}
      quality={p.stats?.quality}
      {...props}
    />
  );

  const sinkId = media.prefs.audiooutput;
  const statsFor = remotes[0]?.stats;

  return (
    <div className="flex h-dvh flex-col bg-night text-stone-100" data-testid="meeting-room">
      {remotes.map((p) => (
        <RemoteAudio key={p.userId} stream={p.stream} version={p.streamVersion} sinkId={sinkId} onBlocked={onBlocked} />
      ))}

      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        <span className="truncate font-semibold">{state.meeting?.title}</span>
        <span className="hidden font-mono text-sm text-stone-400 sm:inline">{client.code}</span>
        <span className="ml-auto flex items-center gap-3 text-sm text-stone-400">
          <ConnectionBadge phase={state.phase} stats={statsFor} />
          <span className="tabular-nums">{fmtClock(elapsed)}</span>
        </span>
      </header>

      {state.phase === 'reconnecting' && (
        <div className="mx-4 mb-2 rounded-xl bg-saffron/15 px-4 py-2 text-center text-sm text-amber-200" role="status">
          Connection lost. Reconnecting…
        </div>
      )}
      {audioBlocked && (
        <button onClick={unblockAudio} className="mx-4 mb-2 flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold">
          <Volume2 size={16} /> Click to turn on sound
        </button>
      )}

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <div className="relative min-w-0 flex-1">
          {remotes.length === 0 ? (
            <div className="grid h-full place-items-center">
              <div className="w-full max-w-3xl space-y-4">
                {localTile({ className: 'aspect-video w-full' })}
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-stone-300">{isHost ? 'You’re the only one here. Share the invite to bring students in.' : 'Waiting for others to join…'}</p>
                  {isHost && (
                    <Button variant="secondary" onClick={copyInvite} className="!border-night-line !bg-night-3 !text-stone-100">
                      <Copy size={16} /> Copy invite link
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : remotes.length === 1 ? (
            <>
              {remoteTile(remotes[0], { className: 'h-full w-full' })}
              <div className="absolute right-3 bottom-3 w-32 sm:w-56">{localTile({ className: 'aspect-[3/4] w-full shadow-2xl sm:aspect-video', compact: true })}</div>
            </>
          ) : (
            <div className={`grid h-full gap-3 ${remotes.length + 1 <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'} auto-rows-fr`}>
              {localTile({ className: 'h-full w-full', compact: true })}
              {remotes.map((p) => remoteTile(p, { className: 'h-full w-full', compact: true, fit: 'cover' }))}
            </div>
          )}
        </div>
        {panel && (
          <div className="fixed inset-0 z-40 md:static md:z-auto">
            <ParticipantsPanel
              self={state.self ? { ...state.self, audio: media.audioEnabled, video: media.videoEnabled } : null}
              participants={remotes}
              waiting={state.waiting}
              isHost={isHost}
              onAdmit={(id) => client.admit(id).catch((e) => toast(e.message, { tone: 'error' }))}
              onDeny={(id) => client.deny(id).catch((e) => toast(e.message, { tone: 'error' }))}
              onClose={() => setPanel(false)}
            />
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-2 px-3 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-3">
        <RoundButton on={media.audioEnabled} onClick={() => localMedia.toggleAudio()} labelOn="Mute (Ctrl+D)" labelOff="Unmute (Ctrl+D)" IconOn={Mic} IconOff={MicOff} />
        <RoundButton on={media.videoEnabled} onClick={() => localMedia.toggleVideo()} labelOn="Turn off camera (Ctrl+E)" labelOff="Turn on camera (Ctrl+E)" IconOn={Video} IconOff={VideoOff} />
        {media.canSwitchCamera && media.videoEnabled && <ToolButton onClick={() => localMedia.switchCamera()} label="Switch camera" Icon={SwitchCamera} />}
        <ToolButton onClick={() => setPanel((v) => !v)} label="People" Icon={Users} active={panel} badge={isHost ? state.waiting.length : 0} />
        <ToolButton onClick={() => setSettingsOpen(true)} label="Settings" Icon={Settings} />
        <div className="relative">
          <button
            onClick={() => (isHost ? setLeaveMenu((v) => !v) : leave())}
            className="flex h-12 items-center gap-2 rounded-full bg-danger px-5 font-semibold text-white transition hover:bg-danger-600 active:scale-95"
            aria-label="Leave class"
            aria-haspopup={isHost ? 'menu' : undefined}
          >
            <PhoneOff size={20} /> <span className="hidden sm:inline">Leave</span>
            {isHost && <MoreVertical size={16} className="-mr-2 opacity-70" />}
          </button>
          {leaveMenu && (
            <div role="menu" className="absolute right-0 bottom-14 w-56 overflow-hidden rounded-xl border border-night-line bg-night-2 shadow-2xl">
              <button role="menuitem" onClick={leave} className="block w-full px-4 py-3 text-left text-sm hover:bg-night-3">
                Leave class
                <span className="block text-xs text-stone-400">Students can stay</span>
              </button>
              <button role="menuitem" onClick={endForAll} className="block w-full px-4 py-3 text-left text-sm text-red-300 hover:bg-night-3">
                End class for everyone
              </button>
            </div>
          )}
        </div>
      </footer>

      <DeviceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} media={media} localMedia={localMedia} />
    </div>
  );
}

function ToolButton({ onClick, label, Icon, active, badge }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`relative flex size-12 items-center justify-center rounded-full transition active:scale-95 ${active ? 'bg-brand-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
    >
      <Icon size={20} />
      {badge > 0 && <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-saffron text-[11px] font-bold text-ink">{badge}</span>}
    </button>
  );
}

function ConnectionBadge({ phase, stats }) {
  const label = useMemo(() => {
    if (phase === 'reconnecting') return { text: 'Reconnecting', cls: 'bg-saffron' };
    if (!stats) return null;
    const q = { good: ['Good', 'bg-brand-400'], fair: ['Fair', 'bg-saffron'], poor: ['Poor', 'bg-danger'] }[stats.quality];
    return { text: `${q[0]}${stats.relayed ? ' · relayed' : ''}`, cls: q[1], title: `RTT ${stats.rttMs ?? '?'} ms · loss ${stats.lossPct}%${stats.video ? ` · ${stats.video.width}×${stats.video.height}@${Math.round(stats.video.fps || 0)}` : ''}` };
  }, [phase, stats]);
  if (!label) return null;
  return (
    <span className="flex items-center gap-1.5" title={label.title} data-testid="connection-badge">
      <span className={`size-2 rounded-full ${label.cls}`} />
      {label.text}
    </span>
  );
}


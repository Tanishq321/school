import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  MessageSquareText,
  MonitorUp,
  MonitorX,
  PenTool,
  Copy,
  GalleryHorizontalEnd,
  Hand,
  Hourglass,
  LayoutGrid,
  Lock,
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
import { ConsentDialog, RecIndicator, RecordButton } from '../components/meeting/Recording.jsx';
import { Alert, Button, Field, FullPageSpinner, Logo, Monogram, Spinner } from '../components/ui/index.jsx';
import VideoTile, { RemoteAudio } from '../components/meeting/VideoTile.jsx';
import DeviceSettings, { MicMeter } from '../components/meeting/DeviceSettings.jsx';
import SidePanel from '../components/meeting/SidePanel.jsx';
import Whiteboard from '../components/meeting/Whiteboard.jsx';
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
  if (['ended', 'denied', 'replaced', 'left', 'removed'].includes(phase)) return <EndScreen phase={phase} reason={state.endedReason} meeting={info.meeting} onRejoin={() => join()} />;
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
        <h1 className="font-display text-3xl font-normal">Can’t open this class</h1>
        <p className="mt-2 text-ink-2 dark:text-slate-400">{msg}</p>
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
        <span className="ml-auto text-sm text-ink-2 dark:text-slate-400">{user.name}</span>
      </header>
      <main className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 sm:px-6 lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <Preview media={media} localMedia={localMedia} name={user.name} />
          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center gap-2 text-xs text-ink-2 dark:text-slate-400">
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
            <p className="text-sm text-brand-600 dark:text-brand-300">{meeting.isHost ? 'Your class' : `Hosted by ${meeting.hostName}`}</p>
            <h1 className="mt-2 font-display text-[2.6rem] leading-tight font-normal">{meeting.title}</h1>
            <p className="mt-2 text-sm text-ink-2 dark:text-slate-400">
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
            {meeting.isHost ? (meeting.status === 'live' ? 'Return to the room' : 'Start class') : 'Join class'}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-2 lg:justify-start dark:text-slate-400">
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

function RoundButton({ on, onClick, labelOn, labelOff, IconOn, IconOff, danger, locked }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? labelOn : labelOff}
      title={on ? labelOn : labelOff}
      className={`relative flex size-12 items-center justify-center rounded-full border transition active:scale-95 ${
        danger || !on
          ? 'border-danger bg-danger text-vellum hover:bg-danger-600'
          : 'border-vellum/10 bg-vellum/[0.07] text-vellum backdrop-blur hover:border-brand-400/40 hover:bg-vellum/[0.12]'
      } ${locked ? 'opacity-70' : ''}`}
    >
      {on ? <IconOn size={19} strokeWidth={1.6} /> : <IconOff size={19} strokeWidth={1.6} />}
      {locked && <Lock size={11} className="absolute -right-0.5 -bottom-0.5 rounded-full bg-night p-0.5 text-brand-300" />}
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
          <Hourglass className="mx-auto animate-pulse text-brand-500 lg:mx-0" size={30} strokeWidth={1.4} />
          <h1 className="font-display text-4xl font-normal">{text[0]}</h1>
          <p className="text-ink-2 dark:text-slate-400">{text[1]}</p>
          <p className="text-sm text-ink-2 dark:text-slate-400">{meeting.title}</p>
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
    removed: ['You were removed from the class', 'The host removed you. You can’t rejoin this class.'],
    left: ['You left the class', ''],
  }[phase];
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div>
        <h1 className="font-display text-4xl font-normal">{content[0]}</h1>
        {content[1] && <p className="mt-2 text-ink-2 dark:text-slate-400">{content[1]}</p>}
        <p className="mt-1 text-sm text-ink-2 dark:text-slate-400">{meeting.title}</p>
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

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Columns and tile width so every 16:9 tile fits on screen without scrolling (up to ~20 people). */
function gridGeometry(count, { width, height }, gap = 12) {
  if (!width || !height) return { cols: 1, tileWidth: 0 };
  let best = { cols: 1, tileWidth: 0 };
  for (let cols = 1; cols <= Math.min(count, 6); cols += 1) {
    const rows = Math.ceil(count / cols);
    const w = Math.min((width - gap * (cols - 1)) / cols, ((height - gap * (rows - 1)) / rows) * (16 / 9));
    if (w > best.tileWidth) best = { cols, tileWidth: Math.floor(w) };
  }
  return best;
}

function Room({ client, state, media, localMedia }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('people');
  const openPanel = (t) => {
    if (panel && tab === t) setPanel(false);
    else {
      setTab(t);
      setPanel(true);
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveMenu, setLeaveMenu] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [layout, setLayout] = useState('grid'); // grid | speaker (used with 2+ others)
  const [pinned, setPinned] = useState(null);
  const stageRef = useRef(null);
  const stage = useSize(stageRef);
  const joinedAt = useRef(Date.now());
  const elapsed = useElapsed(joinedAt.current);
  const self = state.self;
  const isHost = self?.isHost;
  const remotes = state.participants;
  const canSpeak = self?.canSpeak !== false;
  const hands = remotes.filter((p) => p.handRaised).length;

  useEffect(() => {
    const onNotice = ({ detail }) => {
      const msg = {
        joined: `${detail.name} joined`,
        left: `${detail.name} left`,
        waiting: `${detail.name} is waiting to join`,
        hand: isHost ? `${detail.name} raised a hand` : null,
        mutedByHost: 'The host muted your microphone',
        speakGranted: 'The host has invited you to speak',
        speakRevoked: 'The host has turned your microphone off',
        unmute_refused: detail.message,
        mediaError: detail.message,
        chat: detail.type === 'chat' ? `${detail.name}: ${detail.text.length > 70 ? `${detail.text.slice(0, 70)}…` : detail.text}` : null,
        screenStopped: 'Your presentation was stopped',
        recordingStarted: isHost ? 'Recording. Everyone has been asked for consent.' : null,
        recordingStopped:
          detail.reason === 'time_limit'
            ? 'Recording stopped at its time limit'
            : isHost
              ? 'Recording stopped. The film will appear in your archive shortly.'
              : 'Recording stopped',
      }[detail.type];
      if (msg) toast(msg, { duration: detail.type === 'waiting' ? 6000 : 4000, tone: detail.type === 'mediaError' ? 'error' : 'info' });
      if (detail.type === 'waiting') {
        setTab('people');
        setPanel(true);
      }
    };
    client.addEventListener('notice', onNotice);
    return () => client.removeEventListener('notice', onNotice);
  }, [client, toast, isHost]);

  const toggleMic = useCallback(() => {
    if (!media.audioEnabled && !canSpeak) {
      toast('The host has turned off unmuting. Raise your hand to ask to speak.');
      return;
    }
    localMedia.toggleAudio();
  }, [media.audioEnabled, canSpeak, localMedia, toast]);

  // Keyboard shortcuts: Ctrl/⌘+D mic, Ctrl/⌘+E camera.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'd') {
        e.preventDefault();
        toggleMic();
      } else if (e.key === 'e') {
        e.preventDefault();
        localMedia.toggleVideo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [localMedia, toggleMic]);

  // Stage priority: a presentation, then the board, then the people layouts.
  const n = remotes.length;
  const sharer = state.screenSharer;
  const presenting = sharer && (sharer === self?.userId ? 'self' : remotes.find((p) => p.userId === sharer)) ? 'screen' : null;
  const view = presenting || (state.boardOpen ? 'board' : n === 0 ? 'solo' : n === 1 ? 'pair' : layout);
  const presenter = remotes.find((p) => p.userId === sharer);
  const toggleShare = async () => {
    try {
      if (state.sharingScreen) await client.stopScreenShare();
      else await client.startScreenShare();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };
  const canDraw = isHost || Boolean(state.meeting?.permissions?.allowDrawing);
  const present = (id) => remotes.some((p) => p.userId === id);
  const focusId =
    (pinned && present(pinned) && pinned) ||
    (state.activeSpeaker && present(state.activeSpeaker) && state.activeSpeaker) ||
    remotes.find((p) => p.isHost)?.userId ||
    remotes[0]?.userId;

  // Ask the SFU for the simulcast layer each tile actually needs (saves everyone's bandwidth).
  const remoteIds = remotes.map((p) => p.userId).join(',');
  useEffect(() => {
    for (const p of remotes) {
      const layer = view === 'pair' ? 2 : view === 'speaker' ? (p.userId === focusId ? 2 : 0) : view === 'grid' ? (n + 1 <= 4 ? 1 : 0) : 0;
      client.setVideoQuality(p.userId, layer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, view, focusId, remoteIds, n]);

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
      toast((await copyText(link)) ? 'Invitation link copied' : link);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };

  const localTile = (props) => (
    <VideoTile
      name={self?.name}
      stream={media.videoTrack ? localMedia.stream : null}
      version={media.videoTrack?.id}
      videoOn={media.videoEnabled}
      audioOn={media.audioEnabled}
      audioTrack={media.audioTrack}
      isLocal
      isHost={isHost}
      handRaised={self?.handRaised}
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
      handRaised={p.handRaised}
      pinned={pinned === p.userId}
      onPin={n > 1 ? () => setPinned((cur) => (cur === p.userId ? null : p.userId)) : undefined}
      reconnecting={p.reconnecting}
      connecting={!p.reconnecting && p.connectionState !== 'connected'}
      quality={p.stats?.quality}
      {...props}
    />
  );

  const sinkId = media.prefs.audiooutput;
  const network = state.network || remotes[0]?.stats;
  const grid = gridGeometry(n + 1, stage);
  const focus = remotes.find((p) => p.userId === focusId);

  return (
    <div className="dark lamplight flex h-dvh flex-col text-vellum" data-testid="meeting-room" data-layout={view}>
      {remotes.map((p) => (
        <RemoteAudio key={p.userId} stream={p.stream} version={p.streamVersion} sinkId={sinkId} onBlocked={onBlocked} />
      ))}

      <header className="flex h-16 shrink-0 items-center gap-4 px-5">
        <Monogram size={28} className="hidden sm:block" />
        <span className="truncate font-display text-xl font-normal">{state.meeting?.title}</span>
        {state.meeting?.locked && <Lock size={15} strokeWidth={1.6} className="shrink-0 text-brand-300" aria-label="Room locked" />}
        <span className="hidden text-sm tracking-[0.08em] text-slate-400 tabular-nums sm:inline">{client.code}</span>
        <RecIndicator state={state} client={client} isHost={isHost} toast={toast} />
        <span className="ml-auto flex items-center gap-4 text-sm text-slate-400">
          <ConnectionBadge phase={state.phase} stats={network} />
          <span className="tabular-nums">{fmtClock(elapsed)}</span>
        </span>
      </header>

      {state.phase === 'reconnecting' && (
        <div className="mx-5 mb-2 rounded-full bg-brand-300/15 px-4 py-2 text-center text-sm text-brand-100" role="status">
          Connection lost. Reconnecting…
        </div>
      )}
      {audioBlocked && (
        <button onClick={unblockAudio} className="mx-5 mb-2 flex items-center justify-center gap-2 rounded-full bg-vellum px-4 py-2 text-sm font-semibold text-ink">
          <Volume2 size={16} /> Click to turn on sound
        </button>
      )}

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 sm:px-5">
        <div ref={stageRef} className="relative min-w-0 flex-1">
          {(view === 'screen' || view === 'board') && (
            <div className="flex h-full flex-col gap-3">
              <div className="min-h-0 flex-1">
                {view === 'board' ? (
                  <Whiteboard client={client} canDraw={canDraw} isHost={isHost} toastError={(m) => toast(m, { tone: 'error' })} />
                ) : sharer === self?.userId ? (
                  <div className="flex h-full flex-col items-center justify-center gap-6 text-center" data-testid="presenting-self">
                    <div className="hairline w-32" />
                    <p className="font-display text-4xl font-normal">You are presenting.</p>
                    <p className="max-w-sm text-slate-400">Everyone in the room sees your screen. Your camera tile stays visible below.</p>
                    <Button onClick={toggleShare} className="!bg-none !bg-danger">
                      <MonitorX size={17} strokeWidth={1.6} /> Stop presenting
                    </Button>
                  </div>
                ) : (
                  <div className="relative h-full w-full overflow-hidden rounded-[24px] bg-black/60 shadow-[inset_0_0_0_1px_rgba(216,190,140,.25)]" data-testid="screen-stage">
                    <ScreenVideo stream={presenter?.screenStream} version={presenter?.streamVersion} />
                    <span className="absolute top-4 left-4 rounded-full bg-night/70 px-3 py-1.5 text-xs text-vellum backdrop-blur">{presenter?.name}’s screen</span>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 justify-center gap-3 overflow-x-auto pb-1" data-testid="filmstrip">
                {localTile({ className: 'aspect-video w-36 shrink-0 sm:w-44', compact: true })}
                {remotes.map((p) => remoteTile(p, { className: 'aspect-video w-36 shrink-0 sm:w-44', compact: true, fit: 'cover' }))}
              </div>
            </div>
          )}

          {view === 'solo' && (
            <div className="grid h-full place-items-center">
              <div className="w-full max-w-3xl space-y-6">
                {localTile({ className: 'aspect-video w-full' })}
                <div className="flex flex-col items-center gap-4 text-center">
                  <p className="font-display text-2xl font-normal text-vellum/90">{isHost ? 'The room is ready.' : 'Waiting for others to join.'}</p>
                  {isHost && (
                    <Button variant="secondary" onClick={copyInvite} className="!border-night-line !bg-night-3/70 !text-vellum">
                      <Copy size={16} strokeWidth={1.6} /> Copy invitation link
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'pair' && (
            <>
              {remoteTile(remotes[0], { className: 'h-full w-full' })}
              <div className="absolute right-4 bottom-4 w-32 sm:w-60">{localTile({ className: 'aspect-[3/4] w-full shadow-2xl sm:aspect-video', compact: true })}</div>
            </>
          )}

          {view === 'grid' && (
            <div className="flex h-full items-center justify-center">
              {/* Flex-wrap (not CSS grid) so an incomplete last row sits centred. */}
              <div className="flex flex-wrap content-center justify-center gap-3" style={{ maxWidth: grid.cols * grid.tileWidth + (grid.cols - 1) * 12 }} data-testid="grid">
                {localTile({ className: 'aspect-video', compact: n + 1 > 4, style: { width: grid.tileWidth } })}
                {remotes.map((p) => remoteTile(p, { className: 'aspect-video', compact: n + 1 > 4, fit: 'cover', style: { width: grid.tileWidth } }))}
              </div>
            </div>
          )}

          {view === 'speaker' && focus && (
            <div className="flex h-full flex-col gap-3">
              <div className="min-h-0 flex-1">{remoteTile(focus, { className: 'h-full w-full' })}</div>
              <div className="flex shrink-0 gap-3 overflow-x-auto pb-1" data-testid="filmstrip">
                {localTile({ className: 'aspect-video w-40 shrink-0 sm:w-48', compact: true })}
                {remotes.filter((p) => p.userId !== focusId).map((p) => remoteTile(p, { className: 'aspect-video w-40 shrink-0 sm:w-48', compact: true, fit: 'cover' }))}
              </div>
            </div>
          )}
        </div>
        {panel && (
          <div className="fixed inset-0 z-40 md:static md:z-auto">
            <SidePanel
              tab={tab}
              onTab={setTab}
              onClose={() => setPanel(false)}
              client={client}
              state={state}
              self={self ? { ...self, audio: media.audioEnabled, video: media.videoEnabled } : null}
              participants={remotes}
              isHost={isHost}
              toastError={(m) => toast(m, { tone: 'error' })}
            />
          </div>
        )}
      </div>

      <footer className="flex shrink-0 justify-center px-3 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* The instrument panel: one floating sheet of smoked glass with a brass hairline. */}
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-vellum/[0.09] bg-night-2/70 p-2 shadow-[0_24px_60px_-28px_rgba(0,0,0,.95),inset_0_1px_0_rgba(236,230,218,.06)] backdrop-blur-xl sm:gap-2" role="toolbar" aria-label="Class controls">
        <RoundButton
          on={media.audioEnabled}
          onClick={toggleMic}
          labelOn="Mute (Ctrl+D)"
          labelOff={canSpeak ? 'Unmute (Ctrl+D)' : 'Unmuting is off. Raise your hand to speak'}
          IconOn={Mic}
          IconOff={MicOff}
          locked={!canSpeak && !media.audioEnabled}
        />
        <RoundButton on={media.videoEnabled} onClick={() => localMedia.toggleVideo()} labelOn="Turn off camera (Ctrl+E)" labelOff="Turn on camera (Ctrl+E)" IconOn={Video} IconOff={VideoOff} />
        {media.canSwitchCamera && media.videoEnabled && <ToolButton onClick={() => localMedia.switchCamera()} label="Switch camera" Icon={SwitchCamera} />}
        {!isHost && (
          <ToolButton
            onClick={() => client.raiseHand(!self?.handRaised).catch((e) => toast(e.message, { tone: 'error' }))}
            label={self?.handRaised ? 'Lower hand' : 'Raise hand'}
            Icon={Hand}
            active={self?.handRaised}
          />
        )}
        {n >= 2 && (
          <ToolButton
            onClick={() => setLayout((l) => (l === 'grid' ? 'speaker' : 'grid'))}
            label={layout === 'grid' ? 'Speaker view' : 'Grid view'}
            Icon={layout === 'grid' ? GalleryHorizontalEnd : LayoutGrid}
          />
        )}
        {(client.canShareScreen || state.sharingScreen) && (
          <ToolButton onClick={toggleShare} label={state.sharingScreen ? 'Stop presenting' : 'Present your screen'} Icon={state.sharingScreen ? MonitorX : MonitorUp} active={state.sharingScreen} />
        )}
        {isHost && (
          <ToolButton
            onClick={() => client.openBoard(!state.boardOpen).catch((e) => toast(e.message, { tone: 'error' }))}
            label={state.boardOpen ? 'Close the board' : 'Open the board'}
            Icon={PenTool}
            active={state.boardOpen}
          />
        )}
        {isHost && <RecordButton state={state} client={client} toast={toast} ToolButton={ToolButton} />}
        <ToolButton onClick={() => openPanel('chat')} label="Chat" Icon={MessageSquareText} active={panel && tab === 'chat'} badge={state.chatUnread} />
        <ToolButton onClick={() => openPanel('people')} label="People" Icon={Users} active={panel && tab === 'people'} badge={isHost ? state.waiting.length + hands : 0} />
        <ToolButton onClick={() => setSettingsOpen(true)} label="Settings" Icon={Settings} />
        <div className="relative">
          <button
            onClick={() => (isHost ? setLeaveMenu((v) => !v) : leave())}
            className="ml-1 flex h-12 shrink-0 items-center gap-2 rounded-full bg-danger px-6 font-medium text-vellum transition hover:bg-danger-600 active:scale-95"
            aria-label="Leave class"
            aria-haspopup={isHost ? 'menu' : undefined}
          >
            <PhoneOff size={19} strokeWidth={1.7} /> <span className="hidden sm:inline">Leave</span>
            {isHost && <MoreVertical size={16} className="-mr-2 opacity-70" />}
          </button>
          {leaveMenu && (
            <div role="menu" className="absolute right-0 bottom-14 w-60 overflow-hidden rounded-2xl border border-night-line bg-night-2 shadow-2xl">
              <button role="menuitem" onClick={leave} className="block w-full px-4 py-3 text-left text-sm hover:bg-night-3">
                Leave the class
                <span className="block text-xs text-slate-400">Students can stay in the room</span>
              </button>
              <button role="menuitem" onClick={endForAll} className="block w-full px-4 py-3 text-left text-sm text-red-300 hover:bg-night-3">
                End class for everyone
              </button>
            </div>
          )}
        </div>
        </div>
      </footer>

      <DeviceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} media={media} localMedia={localMedia} />
      <ConsentDialog state={state} client={client} onLeave={leave} toast={toast} />
    </div>
  );
}

/** A shared screen: always contained (never cropped), so slides and code stay readable. */
function ScreenVideo({ stream, version }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    if (stream) el.play().catch(() => {});
  }, [stream, version]);
  return <video ref={ref} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" />;
}

function ToolButton({ onClick, label, Icon, active, badge, danger }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`relative flex size-12 items-center justify-center rounded-full border transition active:scale-95 ${
        active && danger ? 'border-danger bg-danger text-vellum' : active ? 'border-brand-300 bg-brand-300 text-ink' : 'border-vellum/10 bg-vellum/[0.07] text-vellum backdrop-blur hover:border-brand-400/40 hover:bg-vellum/[0.12]'
      }`}
    >
      <Icon size={19} strokeWidth={1.6} />
      {badge > 0 && <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-brand-300 text-[11px] font-bold text-ink">{badge}</span>}
    </button>
  );
}

function ConnectionBadge({ phase, stats }) {
  const label = useMemo(() => {
    if (phase === 'reconnecting') return { text: 'Reconnecting', cls: 'bg-brand-300' };
    if (!stats) return null;
    const q = { good: ['Good', 'bg-emerald-400'], fair: ['Fair', 'bg-brand-300'], poor: ['Poor', 'bg-danger'] }[stats.quality];
    return { text: `${q[0]}${stats.relayed ? ', relayed' : ''}`, cls: q[1], title: `Round trip ${stats.rttMs ?? '?'} ms, packet loss ${stats.lossPct}%${stats.video ? `, ${stats.video.width}×${stats.video.height} at ${Math.round(stats.video.fps || 0)} fps` : ''}` };
  }, [phase, stats]);
  if (!label) return null;
  return (
    <span className="flex items-center gap-1.5" title={label.title} data-testid="connection-badge">
      <span className={`size-2 rounded-full ${label.cls}`} />
      {label.text}
    </span>
  );
}


import { useEffect, useRef } from 'react';
import { Crown, Loader2, MicOff, WifiOff } from 'lucide-react';
import { Avatar } from '../ui/index.jsx';
import { useAudioLevel } from '../../hooks/useAudioLevel.js';

/** Binds a MediaStream to a <video>. Remote audio is played by <RemoteAudio>, so video is always muted. */
function StreamVideo({ stream, version, mirrored, fit }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    if (stream) el.play().catch(() => {});
  }, [stream, version]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`absolute inset-0 h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${mirrored ? '-scale-x-100' : ''}`}
    />
  );
}

export default function VideoTile({
  name,
  stream,
  version,
  videoOn,
  audioOn,
  audioTrack,
  isLocal,
  isHost,
  mirrored,
  fit = 'contain',
  reconnecting,
  connecting,
  quality,
  className = '',
  style,
  compact,
}) {
  const level = useAudioLevel(audioTrack, audioOn);
  const speaking = audioOn && level > 0.08;
  const hasVideo = videoOn && stream?.getVideoTracks().length > 0;
  return (
    <div
      className={`group relative overflow-hidden rounded-[22px] bg-night-3 transition-[box-shadow] duration-200 ${
        speaking
          ? 'shadow-[0_0_0_2px_var(--color-brand-300),0_0_32px_-6px_rgba(216,190,140,.55)]'
          : 'shadow-[inset_0_0_0_1px_rgba(236,230,218,.06)]'
      } ${className}`}
      style={style}
      data-testid={isLocal ? 'tile-local' : 'tile-remote'}
      data-user={name}
      data-speaking={speaking || undefined}
    >
      {hasVideo ? (
        <StreamVideo stream={stream} version={version} mirrored={mirrored} fit={fit} />
      ) : (
        <div className="lamplight absolute inset-0 flex items-center justify-center">
          <Avatar name={name} size={compact ? 52 : 104} />
        </div>
      )}

      {(reconnecting || connecting) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-night/60 text-sm text-vellum backdrop-blur-[2px]">
          {reconnecting ? <WifiOff size={22} strokeWidth={1.5} /> : <Loader2 size={22} strokeWidth={1.5} className="animate-spin" />}
          {reconnecting ? 'Reconnecting…' : 'Connecting…'}
        </div>
      )}


      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-night/85 via-night/30 to-transparent px-3 pt-8 pb-2.5 text-vellum">
        {!audioOn && (
          <span className="rounded-full bg-danger/90 p-1" title="Muted" aria-label="Muted">
            <MicOff size={compact ? 11 : 13} strokeWidth={2} />
          </span>
        )}
        {isHost && (
          <span className="rounded-full bg-brand-300/95 p-1 text-ink" title="Host" aria-label="Host">
            <Crown size={compact ? 11 : 13} strokeWidth={2} />
          </span>
        )}
        <span className={`truncate font-medium tracking-[0.01em] drop-shadow ${compact ? 'text-xs' : 'text-sm'}`}>{isLocal ? `${name} (you)` : name}</span>
        {quality && quality !== 'good' && !compact && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${quality === 'poor' ? 'bg-danger' : 'bg-brand-300 text-ink'}`}>
            {quality === 'poor' ? 'Poor connection' : 'Unstable'}
          </span>
        )}
      </div>
    </div>
  );
}

/** Plays a remote participant's audio; reports autoplay blocks so the UI can ask for a click. */
export function RemoteAudio({ stream, version, sinkId, onBlocked }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch((err) => err.name === 'NotAllowedError' && onBlocked?.());
  }, [stream, version, onBlocked]);
  useEffect(() => {
    if (sinkId && ref.current?.setSinkId) ref.current.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay className="hidden" data-remote-audio />;
}

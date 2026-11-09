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
  compact,
}) {
  const level = useAudioLevel(audioTrack, audioOn);
  const speaking = audioOn && level > 0.08;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-night-3 transition-shadow duration-150 ${speaking ? 'ring-[3px] ring-brand-400' : 'ring-1 ring-white/5'} ${className}`}
      data-testid={isLocal ? 'tile-local' : 'tile-remote'}
      data-speaking={speaking || undefined}
    >
      {videoOn && stream ? (
        <StreamVideo stream={stream} version={version} mirrored={mirrored} fit={fit} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar name={name} size={compact ? 48 : 96} />
        </div>
      )}

      {(reconnecting || connecting) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-sm text-white backdrop-blur-[2px]">
          {reconnecting ? <WifiOff size={22} /> : <Loader2 size={22} className="animate-spin" />}
          {reconnecting ? 'Reconnecting…' : 'Connecting…'}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 text-white">
        {!audioOn && (
          <span className="rounded-full bg-danger p-1" title="Muted" aria-label="Muted">
            <MicOff size={compact ? 11 : 13} />
          </span>
        )}
        {isHost && (
          <span className="rounded-full bg-saffron/90 p-1 text-ink" title="Host" aria-label="Host">
            <Crown size={compact ? 11 : 13} />
          </span>
        )}
        <span className={`truncate font-medium drop-shadow ${compact ? 'text-xs' : 'text-sm'}`}>{isLocal ? `${name} (you)` : name}</span>
        {quality && quality !== 'good' && !compact && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${quality === 'poor' ? 'bg-danger' : 'bg-saffron text-ink'}`}>
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

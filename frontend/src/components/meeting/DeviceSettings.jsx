import { useState } from 'react';
import { Modal, Select, Toggle } from '../ui/index.jsx';
import { playCue, setSoundsEnabled, soundsEnabled } from '../../services/sounds.js';
import { useAudioLevel } from '../../hooks/useAudioLevel.js';

export function MicMeter({ track, enabled }) {
  const level = useAudioLevel(track, enabled);
  return (
    <div className="flex h-2 gap-0.5" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className={`flex-1 rounded-full transition-colors ${level * 12 > i ? 'bg-brand-400' : 'bg-line dark:bg-night-line'}`} />
      ))}
    </div>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(soundsEnabled);
  return (
    <div className="border-t border-line pt-4 dark:border-night-line">
      <Toggle
        checked={on}
        onChange={(v) => {
          setSoundsEnabled(v);
          setOn(v);
          if (v) playCue('admitted');
        }}
        label="Sound cues"
        description="Quiet chimes when people join or leave, raise a hand, or write in chat."
      />
    </div>
  );
}

export default function DeviceSettings({ open, onClose, media, localMedia, forceRelay, onForceRelay }) {
  const sel = (list, current) => [
    ...(current && !list.some((d) => d.deviceId === current) ? [{ value: '', label: 'Default' }] : []),
    ...list.map((d) => ({ value: d.deviceId, label: d.label })),
  ];
  const currentMic = media.audioTrack?.getSettings?.().deviceId || media.prefs.audioinput || '';
  const currentCam = media.videoTrack?.getSettings?.().deviceId || media.prefs.videoinput || '';
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        <div className="space-y-2">
          <Select
            label="Microphone"
            options={media.devices.audioinput.length ? sel(media.devices.audioinput, currentMic) : [{ value: '', label: 'No microphone found' }]}
            value={currentMic}
            onChange={(e) => localMedia.selectDevice('audioinput', e.target.value)}
            disabled={!media.devices.audioinput.length}
          />
          <MicMeter track={media.audioTrack} enabled={media.audioEnabled} />
        </div>
        <Select
          label="Camera"
          options={media.devices.videoinput.length ? sel(media.devices.videoinput, currentCam) : [{ value: '', label: 'No camera found' }]}
          value={currentCam}
          onChange={(e) => localMedia.selectDevice('videoinput', e.target.value)}
          disabled={!media.devices.videoinput.length}
        />
        {media.canSelectOutput ? (
          <Select
            label="Speaker"
            options={[{ value: '', label: 'System default' }, ...media.devices.audiooutput.map((d) => ({ value: d.deviceId, label: d.label }))]}
            value={media.prefs.audiooutput || ''}
            onChange={(e) => localMedia.setOutputDevice(e.target.value)}
          />
        ) : (
          <p className="text-xs text-ink-2 dark:text-slate-400">This browser picks the speaker automatically (output selection isn’t supported here).</p>
        )}
        <SoundToggle />
        {onForceRelay && (
          <div className="border-t border-line pt-4 dark:border-night-line">
            <Toggle
              checked={forceRelay}
              onChange={onForceRelay}
              label="Always use relay server"
              description="Troubleshooting: send media through our TURN server even when a direct path exists. Applies the next time you join."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

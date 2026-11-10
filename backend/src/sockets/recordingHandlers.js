import { z } from 'zod';
import { setConsent, startRecording, stopRecording } from '../services/recordingService.js';

const schemas = {
  consent: z.object({ accept: z.boolean() }).strict(),
};

/**
 * Recording controls. Only the host starts/stops; every participant answers for themselves.
 * Nobody is captured until they agree, and they can change their mind at any time.
 */
export function registerRecordingHandlers({ io, on, requireMember, requireHost }) {
  on('recording:start', null, async () => {
    const { room, member } = requireHost();
    return { recording: await startRecording(io, room, member) };
  });

  on('recording:stop', null, async () => {
    const { room, member } = requireHost();
    const out = await stopRecording(io, room, { by: member.userId });
    return { stopped: Boolean(out), id: out?.id };
  });

  on('recording:consent', schemas.consent, async ({ accept }) => {
    const { room, member } = requireMember();
    return { recording: await setConsent(io, room, member, accept) };
  });
}

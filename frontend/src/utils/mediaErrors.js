/** Turns getUserMedia / getDisplayMedia errors into messages people can act on. */
export function describeMediaError(err, kind = 'camera') {
  const device = kind === 'microphone' ? 'microphone' : 'camera';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'denied',
        message: `${cap(device)} access is blocked. Allow it in your browser's site settings (the icon left of the address bar), then try again.`,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { code: 'not_found', message: `No ${device} found. Connect one and try again.` };
    case 'NotReadableError':
    case 'TrackStartError':
      return { code: 'in_use', message: `Your ${device} is in use by another app or tab, or it isn't responding. Close other apps using it and try again.` };
    case 'OverconstrainedError':
      return { code: 'overconstrained', message: `The selected ${device} isn't available any more. Pick another device.` };
    case 'AbortError':
      return { code: 'aborted', message: `Starting the ${device} was interrupted. Try again.` };
    case 'TypeError':
      if (!window.isSecureContext) return { code: 'insecure', message: 'Camera and microphone need a secure (https) connection.' };
      return { code: 'unsupported', message: `This browser can't access the ${device}.` };
    default:
      return { code: 'unknown', message: `Couldn't start the ${device}${err?.message ? `: ${err.message}` : '.'}` };
  }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

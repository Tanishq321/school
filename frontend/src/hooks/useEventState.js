import { useEffect, useReducer } from 'react';

/** Re-render whenever `target` dispatches `event`, returning `read(target)`. */
export function useEventState(target, read, event = 'change') {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!target) return undefined;
    target.addEventListener(event, bump);
    return () => target.removeEventListener(event, bump);
  }, [target, event]);
  return target ? read(target) : null;
}

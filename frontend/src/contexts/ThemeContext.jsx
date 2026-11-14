import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Theme preference: 'system' (follow the device, live), 'light' or 'dark'.
 * `theme` is what is actually showing right now.
 */
const ThemeContext = createContext({ preference: 'system', theme: 'light', setPreference: () => {}, toggle: () => {} });
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function apply(theme) {
  const root = document.documentElement;
  const dark = theme === 'dark';
  // Cross-fade colours for a moment so the switch feels deliberate rather than a flash.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1628' : '#f4f1ea');
  window.clearTimeout(apply.t);
  apply.t = window.setTimeout(() => root.classList.remove('theme-switching'), 450);
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export function ThemeProvider({ children }) {
  const [preference, setPref] = useState(() => {
    try {
      return localStorage.getItem('vp.theme') || 'system';
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(() => Boolean(media()?.matches));

  // Follow the device as it changes (sunset, a scheduled dark mode, the user flipping it).
  useEffect(() => {
    const mq = media();
    if (!mq) return undefined;
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    if (document.documentElement.classList.contains('dark') !== (theme === 'dark')) apply(theme);
    else window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }, [theme]);

  const setPreference = useCallback((p) => {
    setPref(p);
    try {
      if (p === 'system') localStorage.removeItem('vp.theme');
      else localStorage.setItem('vp.theme', p);
    } catch {
      /* ignore */
    }
  }, []);
  // Quick switch: flips what is showing; going back to what the device wants returns to "follow device".
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setPreference(next === (systemDark ? 'dark' : 'light') ? 'system' : next);
  }, [theme, systemDark, setPreference]);

  const value = useMemo(() => ({ preference, theme, setPreference, toggle }), [preference, theme, setPreference, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** The current theme for non-React code paths (e.g. WebGL), kept in sync via the 'themechange' event. */
export const currentTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

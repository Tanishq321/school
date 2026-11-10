import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** True inside the Android/iOS app (a web view on its own origin, where cookies are unreliable). */
export const isNative = Capacitor.isNativePlatform();

const KEY = 'schole.session';

/**
 * In the apps the refresh token is kept in the app's private storage (not reachable by other
 * apps or by web pages) and sent in the request body. In browsers it stays an httpOnly cookie
 * that scripts cannot read at all, and these functions do nothing.
 */
export const sessionStore = {
  async get() {
    if (!isNative) return null;
    return (await Preferences.get({ key: KEY })).value;
  },
  async set(token) {
    if (!isNative) return;
    if (token) await Preferences.set({ key: KEY, value: token });
    else await Preferences.remove({ key: KEY });
  },
};

export const platformHeaders = isNative ? { 'X-Client-Platform': 'native' } : {};

# Android and iOS apps (Capacitor)

The apps are the same web application wrapped in a native shell (Capacitor 8). The projects are in `frontend/android` and `frontend/ios`.

> **Status: scaffolded, not yet run on a device.** The projects were generated and the web bundle syncs into them, but this environment has no Android SDK or Xcode, so nothing here has been compiled or tested on a phone. Treat the first device build as a test, using the checklist in §5.

## 1. How the apps differ from the website

| | Website | Apps |
|---|---|---|
| Where the pages come from | your server | bundled in the app (`https://localhost` on Android, `capacitor://localhost` on iOS) |
| Server address | same origin | set at build time: `VITE_API_URL`, `VITE_SOCKET_URL` |
| Session | httpOnly cookie | the app sends `X-Client-Platform: native`; the refresh token arrives in the response body and is kept in the app's private storage (Capacitor Preferences) |
| Camera / microphone | browser prompt | OS prompt (declared in `AndroidManifest.xml` and `Info.plist`) |
| Screen sharing | yes | not available (mobile web views have no `getDisplayMedia`) |

## 2. Server settings

```ini
NATIVE_APP_ORIGINS=capacitor://localhost,https://localhost
```

This adds the app origins to CORS and to the Socket.IO allow-list. Leave it empty if you don't ship apps.

## 3. Build

```bash
cd frontend
cp env.app.example .env.app      # set VITE_API_URL and VITE_SOCKET_URL to your HTTPS server
npm ci
npm run app:android              # builds the web bundle, syncs it, opens Android Studio
npm run app:ios                  # same, opens Xcode (macOS only)
```

Requirements: Android Studio (SDK 35+, JDK 21) for Android; Xcode 16+ and an Apple Developer account for iOS. The build refuses to run without `VITE_API_URL`, so an app can't ship pointing nowhere.

## 4. Before publishing

- **Icons and splash screens** are still Capacitor's defaults. Generate branded ones with `npx @capacitor/assets generate` from a 1024×1024 icon.
- **App ID** is `app.schole.classroom` (`capacitor.config.json`). Change it to a domain you own before the first store upload; it can't be changed afterwards.
- **Invitation links** open in the browser, not the app. Opening them in the app needs Android App Links / iOS Universal Links (a verified file on your domain).
- **Token storage:** Capacitor Preferences is private to the app but is not the hardware keystore. For stricter requirements, swap `sessionStore` in `frontend/src/services/platform.js` for a Keychain/Keystore plugin; it is the only place that touches the token.
- **Background:** iOS is allowed to keep audio running in the background; video pauses when the app is backgrounded (OS behaviour).
- Android backups are disabled (`allowBackup="false"`) so the session never lands in a cloud backup.

## 5. First device test

| Check | Android | iOS |
|---|---|---|
| Sign in, close the app, reopen: still signed in | ☐ | ☐ |
| Two-step sign-in | ☐ | ☐ |
| Camera and microphone prompts appear and the class connects | ☐ | ☐ |
| Front/rear camera switch | ☐ | ☐ |
| Sound through speaker and through headphones / Bluetooth | ☐ | ☐ |
| Wi-Fi → mobile data mid-class: the call recovers | ☐ | ☐ |
| Recording consent prompt; playback of a shared recording | ☐ | ☐ |
| Sign out, reopen: signed out | ☐ | ☐ |

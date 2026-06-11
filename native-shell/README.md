# JobDone Native Shell

Tiny Android spike for issue #152.

The first shell deliberately loads the deployed staging app directly:

```text
https://jobdone-staging.vercel.app
```

It has:

- one Kotlin Activity;
- JavaScript and DOM storage enabled;
- no `addJavascriptInterface` bridge;
- external navigation opened outside the privileged WebView;
- a `jobdone-staging://auth-callback` auth callback that reopens the staging
  WebView with the Supabase query/fragment intact;
- WebView remote debugging only in debug builds.

Build with the Field Relay Gradle wrapper until this repo has its own Android
wrapper. This machine currently uses a user-writable Android SDK because the
system SDK is root-owned:

```bash
ANDROID_HOME=/home/peter/Android/Sdk \
ANDROID_SDK_ROOT=/home/peter/Android/Sdk \
  /home/peter/field-relay/gradlew -p native-shell :app:testDebugUnitTest :app:assembleDebug
```

Install on the dev phone:

```bash
adb install -r native-shell/app/build/outputs/apk/debug/app-debug.apk
```

Verified on `RF8N6017PKY`:

- app opens staging in portrait;
- IndexedDB data survives app force-stop/reopen;
- text Capture can be confirmed;
- burger menu no longer shows Reviews, Inbox, or My Work.
- Team navigation reaches the Create Team/login-required screen;
- feedback can be sent from the Share idea screen.

Still to test manually:

- full login callback path after the Supabase redirect allow-list includes
  `jobdone-staging://auth-callback`.

Supabase setup needed for auth callback testing:

1. Add `jobdone-staging://auth-callback` to the project's Auth redirect URLs.
2. Keep staging web redirects too: `https://jobdone-staging.vercel.app/**`.
3. Magic link and Google OAuth should then return to the shell through the
   custom scheme, and the shell maps the callback to
   `https://jobdone-staging.vercel.app/` for Supabase JS session detection.

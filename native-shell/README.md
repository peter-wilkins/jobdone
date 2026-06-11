# JobDone Native Shell

Tiny Android spike for issue #152.

The shell has staging and production flavors.

```text
staging:    https://jobdone-staging.vercel.app
production: https://jobdone.continuumkit.org
```

It has:

- one Kotlin Activity;
- JavaScript and DOM storage enabled;
- no `addJavascriptInterface` bridge;
- external navigation opened outside the privileged WebView;
- environment-specific auth callbacks that reopen the WebView with the Supabase
  query/fragment intact;
- WebView remote debugging only in debug builds.

Build with the Field Relay Gradle wrapper until this repo has its own Android
wrapper. This machine currently uses a user-writable Android SDK because the
system SDK is root-owned:

```bash
ANDROID_HOME=/home/peter/Android/Sdk \
ANDROID_SDK_ROOT=/home/peter/Android/Sdk \
  /home/peter/field-relay/gradlew -p native-shell :app:testStagingDebugUnitTest :app:assembleStagingDebug :app:testProductionDebugUnitTest :app:assembleProductionDebug
```

Install on the dev phone:

```bash
adb install -r native-shell/app/build/outputs/apk/staging/debug/app-staging-debug.apk
adb install -r native-shell/app/build/outputs/apk/production/debug/app-production-debug.apk
```

Verified on `RF8N6017PKY`:

- app opens staging in portrait;
- IndexedDB data survives app force-stop/reopen;
- text Capture can be confirmed;
- burger menu no longer shows Reviews, Inbox, or My Work.
- Team navigation reaches the Create Team/login-required screen;
- feedback can be sent from the Share idea screen.

Supabase setup needed for auth callback testing:

1. Staging project: add `jobdone-staging://auth-callback`.
2. Production project: add `jobdone://auth-callback`.
3. Keep web redirects too:
   - `https://jobdone-staging.vercel.app/**`
   - `https://jobdone.continuumkit.org/**`
4. Magic link and Google OAuth should then return to the matching shell through
   the custom scheme, and the shell maps the callback to its web URL for
   Supabase JS session detection.
